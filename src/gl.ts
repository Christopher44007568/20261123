export function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`shader compile failed:\n${gl.getShaderInfoLog(sh)}\n${src}`);
  }
  return sh;
}

export function linkProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(prog)}`);
  }
  return prog;
}

export interface GBuffer {
  fbo: WebGLFramebuffer;
  albedoFlag: WebGLTexture; // RGBA8: albedo rgb + style flag (1 terrain, 0 water/unstyled)
  normalDepth: WebGLTexture; // RGBA16F: world normal xyz + view depth
  heightLava: WebGLTexture; // RG16F: world height + lava mask
  depth: WebGLRenderbuffer;
  width: number;
  height: number;
}

function makeTexture(
  gl: WebGL2RenderingContext, w: number, h: number,
  internal: number, format: number, type: number
): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export function createGBuffer(gl: WebGL2RenderingContext, w: number, h: number): GBuffer {
  const albedoFlag = makeTexture(gl, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
  const normalDepth = makeTexture(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
  const heightLava = makeTexture(gl, w, h, gl.RG16F, gl.RG, gl.HALF_FLOAT);
  const depth = gl.createRenderbuffer()!;
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, albedoFlag, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, normalDepth, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, heightLava, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("G-buffer framebuffer incomplete");
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, albedoFlag, normalDepth, heightLava, depth, width: w, height: h };
}

export function destroyGBuffer(gl: WebGL2RenderingContext, gb: GBuffer): void {
  gl.deleteFramebuffer(gb.fbo);
  gl.deleteTexture(gb.albedoFlag);
  gl.deleteTexture(gb.normalDepth);
  gl.deleteTexture(gb.heightLava);
  gl.deleteRenderbuffer(gb.depth);
}
