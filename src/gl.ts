export function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error("shader: " + gl.getShaderInfoLog(sh) + "\n" + src);
  }
  return sh;
}

export function createProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error("link: " + gl.getProgramInfoLog(p));
  }
  return p;
}

export function uniformMap(gl: WebGL2RenderingContext, prog: WebGLProgram): Map<string, WebGLUniformLocation> {
  const map = new Map<string, WebGLUniformLocation>();
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i)!;
    map.set(info.name.replace(/\[0\]$/, ""), gl.getUniformLocation(prog, info.name)!);
  }
  return map;
}

export interface Mesh {
  vao: WebGLVertexArrayObject;
  count: number;
  mode: number;
  indexed: boolean;
  instances?: number;
}

export interface AttrSpec {
  loc: number;
  size: number;
  stride: number;
  offset: number;
  divisor?: number;
}

export function createMesh(
  gl: WebGL2RenderingContext,
  vertices: Float32Array,
  attrs: AttrSpec[],
  indices: Uint32Array | null,
  mode: number,
  instances = 0,
): Mesh {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  for (const a of attrs) {
    gl.enableVertexAttribArray(a.loc);
    gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, a.stride * 4, a.offset * 4);
    if (a.divisor) gl.vertexAttribDivisor(a.loc, a.divisor);
  }
  let count = vertices.length;
  let indexed = false;
  if (indices) {
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    count = indices.length;
    indexed = true;
  }
  gl.bindVertexArray(null);
  return { vao, count, mode, indexed, instances: instances || undefined };
}

export function drawMesh(gl: WebGL2RenderingContext, m: Mesh): void {
  gl.bindVertexArray(m.vao);
  if (m.indexed) {
    if (m.instances) gl.drawElementsInstanced(m.mode, m.count, gl.UNSIGNED_INT, 0, m.instances);
    else gl.drawElements(m.mode, m.count, gl.UNSIGNED_INT, 0);
  } else {
    if (m.instances) gl.drawArraysInstanced(m.mode, 0, m.count, m.instances);
    else gl.drawArrays(m.mode, 0, m.count);
  }
  gl.bindVertexArray(null);
}
