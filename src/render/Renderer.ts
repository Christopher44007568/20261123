import { VERT_SRC, FRAG_SRC, LINE_VERT_SRC, LINE_FRAG_SRC } from './shaders.js';
import { mat4Multiply, mat4Perspective, mat4LookAt, type Mat4 } from './mat4.js';
import type { Vec3 } from '../engine/math3.js';
import type { GpuLeafMesh, LeafMeshManager } from './LeafMeshManager.js';
import type { OctreeNode } from '../engine/Octree.js';

export type ViewMode = 'shaded' | 'lod' | 'wireframe';

export interface CameraState {
  eye: Vec3;
  target: Vec3;
  up: Vec3;
  fovy: number;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) {
    throw new Error('shader allocation failed');
  }
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile error: ${log}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const program = gl.createProgram();
  if (program === null) {
    throw new Error('program allocation failed');
  }
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`program link error: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly lineProgram: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly lineVao: WebGLVertexArrayObject;
  private viewProj: Mat4 = new Float32Array(16);
  private lineBuffer: WebGLBuffer | null = null;
  private highlightBuffer: WebGLBuffer | null = null;
  mode: ViewMode = 'shaded';
  showLeafBoxes = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private meshManager: LeafMeshManager | null,
  ) {
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      preserveDrawingBuffer: true,
    });
    if (gl === null) {
      throw new Error('WebGL2 is not available in this browser');
    }
    this.gl = gl;
    this.program = link(gl, VERT_SRC, FRAG_SRC);
    this.lineProgram = link(gl, LINE_VERT_SRC, LINE_FRAG_SRC);

    const vao = gl.createVertexArray();
    if (vao === null) {
      throw new Error('VAO allocation failed');
    }
    this.vao = vao;
    const lineVao = gl.createVertexArray();
    if (lineVao === null) {
      throw new Error('line VAO allocation failed');
    }
    this.lineVao = lineVao;

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0.05, 0.06, 0.08, 1);
  }

  attachMeshManager(manager: LeafMeshManager): void {
    this.meshManager = manager;
  }

  private get meshes(): LeafMeshManager {
    if (this.meshManager === null) {
      throw new Error('LeafMeshManager not attached');
    }
    return this.meshManager;
  }

  resize(width: number, height: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  updateCamera(camera: CameraState): void {
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const proj = mat4Perspective(camera.fovy, aspect, 0.1, 400);
    const view = mat4LookAt(camera.eye, camera.target, camera.up);
    this.viewProj = mat4Multiply(proj, view);
  }

  render(leaves: OctreeNode[], camera: CameraState, highlight: Vec3 | null): void {
    const gl = this.gl;
    this.updateCamera(camera);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (this.mode === 'wireframe') {
      this.renderLeafWireframes(leaves);
    } else {
      this.renderSolid(camera.eye);
    }
    if (this.showLeafBoxes && this.mode !== 'wireframe') {
      this.renderLeafWireframes(leaves);
    }
    if (highlight !== null) {
      this.renderHighlight(highlight);
    }
  }

  private renderSolid(eye: Vec3): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program, 'uViewProj'), false, this.viewProj);
    gl.uniform1i(gl.getUniformLocation(this.program, 'uMode'), this.mode === 'lod' ? 1 : 0);
    gl.uniform3f(gl.getUniformLocation(this.program, 'uFogColor'), 0.05, 0.06, 0.08);
    gl.uniform3f(gl.getUniformLocation(this.program, 'uCameraPos'), eye.x, eye.y, eye.z);

    gl.bindVertexArray(this.vao);
    for (const mesh of this.meshes.activeMeshes) {
      this.drawMesh(mesh);
    }
    gl.bindVertexArray(null);
  }

  private drawMesh(mesh: GpuLeafMesh): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ebo);
    const stride = 8 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 6 * 4);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 7 * 4);

    // One draw call per material batch inside the leaf.
    for (const batch of mesh.batches) {
      gl.drawElements(gl.TRIANGLES, batch.indexCount, gl.UNSIGNED_INT, batch.indexOffset * 4);
    }
  }

  private renderLeafWireframes(leaves: OctreeNode[]): void {
    const gl = this.gl;
    const built = this.meshes.buildDebugLines(leaves);
    if (built === null) {
      return;
    }
    this.lineBuffer = built.vbo;
    gl.useProgram(this.lineProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProgram, 'uViewProj'), false, this.viewProj);
    gl.uniform3f(gl.getUniformLocation(this.lineProgram, 'uColor'),
      this.mode === 'wireframe' ? 0.1 : 1.0,
      this.mode === 'wireframe' ? 0.9 : 0.85,
      this.mode === 'wireframe' ? 0.85 : 0.35);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, built.count);
    gl.bindVertexArray(null);
  }

  private renderHighlight(cell: Vec3): void {
    const gl = this.gl;
    const e = 1.002;
    const x0 = cell.x, y0 = cell.y, z0 = cell.z;
    const x1 = cell.x + e, y1 = cell.y + e, z1 = cell.z + e;
    const corners = [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ];
    const edges = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    const positions = new Float32Array(edges.length * 6);
    let k = 0;
    for (const [a, b] of edges) {
      positions[k++] = corners[a][0];
      positions[k++] = corners[a][1];
      positions[k++] = corners[a][2];
      positions[k++] = corners[b][0];
      positions[k++] = corners[b][1];
      positions[k++] = corners[b][2];
    }
    if (this.highlightBuffer === null) {
      const created = gl.createBuffer();
      if (created === null) {
        throw new Error('highlight buffer allocation failed');
      }
      this.highlightBuffer = created;
    }
    gl.useProgram(this.lineProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProgram, 'uViewProj'), false, this.viewProj);
    gl.uniform3f(gl.getUniformLocation(this.lineProgram, 'uColor'), 1.0, 0.9, 0.25);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.highlightBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, edges.length * 2);
    gl.bindVertexArray(null);
  }

  setCameraUniform(eye: Vec3): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniform3f(gl.getUniformLocation(this.program, 'uCameraPos'), eye.x, eye.y, eye.z);
  }

  dispose(): void {
    if (this.lineBuffer !== null) {
      this.gl.deleteBuffer(this.lineBuffer);
    }
    if (this.highlightBuffer !== null) {
      this.gl.deleteBuffer(this.highlightBuffer);
    }
    this.gl.deleteProgram(this.program);
    this.gl.deleteProgram(this.lineProgram);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteVertexArray(this.lineVao);
  }
}
