import type { MapId, MipLevel, ViewMode } from "../types";
import { createProgram, uniformLocation } from "./glUtils";

const thumbVertexShader = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p * 0.5;
  gl_Position = vec4(p - 1.0, 0.0, 1.0);
}`;

const thumbFragmentShader = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uRaw;
uniform sampler2D uDecoded;
uniform int uMode;
uniform int uMap;

out vec4 outColor;

vec3 heatRamp(float value) {
  vec3 cold = vec3(0.055, 0.105, 0.10);
  vec3 mid = vec3(0.84, 0.57, 0.18);
  vec3 hot = vec3(0.73, 0.10, 0.035);
  float t = clamp(value, 0.0, 1.0);
  if (t < 0.5) return mix(cold, mid, smoothstep(0.03, 0.5, t));
  return mix(mid, hot, smoothstep(0.5, 1.0, t));
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec4 raw = texture(uRaw, uv);
  vec4 decoded = texture(uDecoded, uv);
  vec3 color;
  float gain = uMap == 0 ? 5.2 : uMap == 1 ? 6.4 : 4.8;

  if (uMode == 2) {
    vec3 delta = abs(raw.rgb - decoded.rgb);
    if (uMap == 0) delta = vec3(max(delta.r, abs(raw.a - decoded.a) * 0.7));
    else if (uMap == 1) delta = vec3(max(delta.r, delta.g));
    float errorValue = max(max(delta.r, delta.g), delta.b) * gain;
    color = heatRamp(errorValue);
  } else {
    vec4 sampleValue = uMode == 0 ? raw : decoded;
    if (uMap == 0) {
      color = mix(vec3(0.28, 0.265, 0.23), sampleValue.rgb, sampleValue.a);
    } else if (uMap == 1) {
      vec2 xy = sampleValue.rg * 2.0 - 1.0;
      vec3 normal = vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));
      color = normal * 0.5 + 0.5;
    } else {
      color = vec3(sampleValue.r);
      color.g = sampleValue.r * 0.9 + sampleValue.g * 0.1;
      color.b = sampleValue.r * 0.76 + sampleValue.b * 0.24;
    }
  }
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

export class ThumbRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly rawTexture: WebGLTexture;
  private readonly decodedTexture: WebGLTexture;
  private readonly uniforms: Record<string, WebGLUniformLocation>;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
    if (!gl) throw new Error("纹理检查器需要 WebGL2");
    this.gl = gl;
    this.program = createProgram(gl, thumbVertexShader, thumbFragmentShader, "texture inspector");
    const vao = gl.createVertexArray();
    const rawTexture = gl.createTexture();
    const decodedTexture = gl.createTexture();
    if (!vao || !rawTexture || !decodedTexture) throw new Error("无法创建纹理检查器资源");
    this.vao = vao;
    this.rawTexture = rawTexture;
    this.decodedTexture = decodedTexture;
    this.uniforms = {
      raw: uniformLocation(gl, this.program, "uRaw"),
      decoded: uniformLocation(gl, this.program, "uDecoded"),
      mode: uniformLocation(gl, this.program, "uMode"),
      map: uniformLocation(gl, this.program, "uMap"),
    };
    for (const [unit, texture] of [[0, rawTexture], [1, decodedTexture]] as const) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }

  private upload(texture: WebGLTexture, level: MipLevel, unit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      level.width,
      level.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      level.data,
    );
  }

  draw(
    raw: MipLevel,
    decoded: MipLevel,
    map: MapId,
    mode: ViewMode,
  ): void {
    const gl = this.gl;
    this.upload(this.rawTexture, raw, 0);
    this.upload(this.decodedTexture, decoded, 1);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform1i(this.uniforms.raw, 0);
    gl.uniform1i(this.uniforms.decoded, 1);
    gl.uniform1i(this.uniforms.mode, mode === "raw" ? 0 : mode === "decoded" ? 1 : 2);
    gl.uniform1i(this.uniforms.map, map === "albedo" ? 0 : map === "normal" ? 1 : 2);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
