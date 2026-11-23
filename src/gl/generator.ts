import { buildMipChain, flipRowsY } from "../compression/mips";
import type { MapId, MaterialSettings, MipLevel } from "../types";
import { createProgram, uniformLocation } from "./glUtils";
import { materialFragmentShader, materialVertexShader } from "./materialShader";

const MATERIAL_INDEX = { brick: 0, tile: 1, rust: 2, screen: 3 } as const;

export class MaterialGenerator {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly framebuffer: WebGLFramebuffer;
  private readonly vao: WebGLVertexArrayObject;
  private readonly targets: WebGLTexture[] = [];
  private readonly size: number;
  private readonly uniforms: Record<string, WebGLUniformLocation>;

  constructor(gl: WebGL2RenderingContext, size = 1024) {
    this.gl = gl;
    this.size = size;
    this.program = createProgram(gl, materialVertexShader, materialFragmentShader, "material generator");
    this.vao = gl.createVertexArray();
    if (!this.vao) throw new Error("无法创建生成器 VAO");
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error("无法创建生成器 framebuffer");
    this.framebuffer = framebuffer;
    this.uniforms = {
      material: uniformLocation(gl, this.program, "uMaterial"),
      scale: uniformLocation(gl, this.program, "uScale"),
      wear: uniformLocation(gl, this.program, "uWear"),
      salt: uniformLocation(gl, this.program, "uSalt"),
      texel: uniformLocation(gl, this.program, "uTexel"),
    };

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    const attachments = [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2];
    for (let i = 0; i < attachments.length; i++) {
      const texture = gl.createTexture();
      if (!texture) throw new Error("无法创建生成器目标纹理");
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, attachments[i], gl.TEXTURE_2D, texture, 0);
      this.targets.push(texture);
    }
    gl.drawBuffers(attachments);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("材质生成 framebuffer 不完整");
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  generate(settings: MaterialSettings, baseSize = this.size): Record<MapId, MipLevel> {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, baseSize, baseSize);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform1i(this.uniforms.material, MATERIAL_INDEX[settings.material]);
    gl.uniform1f(this.uniforms.scale, settings.scale);
    gl.uniform1f(this.uniforms.wear, settings.wear);
    gl.uniform1f(this.uniforms.salt, settings.salt);
    gl.uniform2f(this.uniforms.texel, 1 / baseSize, 1 / baseSize);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    const maps: MapId[] = ["albedo", "normal", "roughness"];
    const output = {} as Record<MapId, MipLevel>;
    for (let i = 0; i < maps.length; i++) {
      const pixels = new Uint8Array(baseSize * baseSize * 4);
      gl.readBuffer(gl.COLOR_ATTACHMENT0 + i);
      gl.readPixels(0, 0, baseSize, baseSize, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const raw = { width: baseSize, height: baseSize, data: pixels };
      output[maps[i]] = flipRowsY(raw);
    }

    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return {
      albedo: output.albedo,
      normal: output.normal,
      roughness: output.roughness,
    };
  }

  generateChains(settings: MaterialSettings): Record<MapId, MipLevel[]> {
    const base = this.generate(settings);
    return {
      albedo: buildMipChain(base.albedo, "albedo"),
      normal: buildMipChain(base.normal, "normal"),
      roughness: buildMipChain(base.roughness, "roughness"),
    };
  }

  dispose(): void {
    const gl = this.gl;
    for (const texture of this.targets) gl.deleteTexture(texture);
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}
