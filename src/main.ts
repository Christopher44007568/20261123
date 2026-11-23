import { mat4LookAt, mat4Multiply, mat4Perspective } from "./mat4";
import { buildTerrain, buildWaterPlane, WATER_LEVEL } from "./terrain";
import { createGBuffer, destroyGBuffer, linkProgram } from "./gl";
import { GEO_FS, GEO_VS } from "./shaders_geo";
import { QUAD_VS, SHADE_FS } from "./shaders_shade";

export interface RenderOptions {
  mode: number; // 0 original, 1 bands, 2 NPR, 3 band-index, 4 line-class
  width: number;
  height: number;
  azimuthDeg: number;
  elevationDeg: number;
  distance: number;
}

const LIGHT_DIR: [number, number, number] = [0.45, 0.75, 0.49];
const FOG_COLOR: [number, number, number] = [0.87, 0.9, 0.93];
const TARGET: [number, number, number] = [0, 12, 0];

interface MeshGpu {
  vao: WebGLVertexArrayObject;
  count: number;
}

class Renderer {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private geoProg: WebGLProgram;
  private shadeProg: WebGLProgram;
  private terrain: MeshGpu;
  private water: MeshGpu;
  private quadVao: WebGLVertexArrayObject;
  private gb: ReturnType<typeof createGBuffer> | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL2 unavailable");
    if (!gl.getExtension("EXT_color_buffer_float")) {
      throw new Error("EXT_color_buffer_float unavailable");
    }
    this.gl = gl;
    this.geoProg = linkProgram(gl, GEO_VS, GEO_FS);
    this.shadeProg = linkProgram(gl, QUAD_VS, SHADE_FS);
    const mesh = buildTerrain(256);
    this.terrain = this.uploadMesh(mesh.positions, mesh.normals, mesh.heights, mesh.lava, mesh.indices);
    const water = buildWaterPlane();
    const waterNormals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
    const waterData = new Float32Array([-1, -1, -1, -1, -1, -1, -1, -1]);
    const waterHeights = new Float32Array(4).fill(-1);
    this.water = this.uploadMesh(water.positions, waterNormals, waterHeights, waterData, water.indices);
    this.quadVao = this.createQuad();
  }

  private uploadMesh(
    positions: Float32Array, normals: Float32Array,
    heights: Float32Array, lava: Float32Array, indices: Uint32Array
  ): MeshGpu {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const data = new Float32Array((positions.length / 3) * 8);
    for (let i = 0, v = 0; i < positions.length / 3; i++) {
      data[v++] = positions[i * 3]; data[v++] = positions[i * 3 + 1]; data[v++] = positions[i * 3 + 2];
      data[v++] = normals[i * 3]; data[v++] = normals[i * 3 + 1]; data[v++] = normals[i * 3 + 2];
      data[v++] = heights[i]; data[v++] = lava[i];
    }
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const stride = 32;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: indices.length };
  }

  private createQuad(): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  render(opts: RenderOptions): void {
    const gl = this.gl;
    const { width, height } = opts;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    if (this.gb && (this.gb.width !== width || this.gb.height !== height)) {
      destroyGBuffer(gl, this.gb);
      this.gb = null;
    }
    if (!this.gb) this.gb = createGBuffer(gl, width, height);

    const az = (opts.azimuthDeg * Math.PI) / 180;
    const el = (opts.elevationDeg * Math.PI) / 180;
    const eye: [number, number, number] = [
      TARGET[0] + opts.distance * Math.cos(el) * Math.sin(az),
      TARGET[1] + opts.distance * Math.sin(el),
      TARGET[2] + opts.distance * Math.cos(el) * Math.cos(az),
    ];
    const view = mat4LookAt(eye, TARGET, [0, 1, 0]);
    const proj = mat4Perspective((42 * Math.PI) / 180, width / height, 1, 1200);
    const viewProj = mat4Multiply(proj, view);

    // Pass 1: geometry -> G-buffer.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.gb.fbo);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.geoProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.geoProg, "uViewProj"), false, viewProj);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.geoProg, "uView"), false, view);
    gl.uniform1f(gl.getUniformLocation(this.geoProg, "uWaterLevel"), WATER_LEVEL);
    gl.bindVertexArray(this.water.vao);
    gl.drawElements(gl.TRIANGLES, this.water.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(this.terrain.vao);
    gl.drawElements(gl.TRIANGLES, this.terrain.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);

    // Pass 2: fullscreen toon/NPR shading.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.shadeProg);
    const bindTex = (name: string, tex: WebGLTexture, unit: number) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(this.shadeProg, name), unit);
    };
    bindTex("uAlbedoFlag", this.gb.albedoFlag, 0);
    bindTex("uNormalDepth", this.gb.normalDepth, 1);
    bindTex("uHeightLava", this.gb.heightLava, 2);
    gl.uniform2f(gl.getUniformLocation(this.shadeProg, "uResolution"), width, height);
    gl.uniform3fv(gl.getUniformLocation(this.shadeProg, "uLightDir"), LIGHT_DIR);
    gl.uniform3fv(gl.getUniformLocation(this.shadeProg, "uFogColor"), FOG_COLOR);
    gl.uniform1i(gl.getUniformLocation(this.shadeProg, "uMode"), opts.mode);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.finish();
  }
}

declare global {
  interface Window { __npr?: unknown }
}

const canvas = document.getElementById("view") as HTMLCanvasElement;
const renderer = new Renderer(canvas);
window.__npr = {
  ready: true,
  render(opts: RenderOptions): string {
    renderer.render(opts);
    return canvas.toDataURL("image/png");
  },
};
