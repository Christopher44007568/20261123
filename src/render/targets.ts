export interface HdrTarget {
  framebuffer: WebGLFramebuffer;
  color: WebGLTexture;
  depth: WebGLTexture;
  width: number;
  height: number;
}

export function createHdrTarget(gl: WebGL2RenderingContext, width: number, height: number): HdrTarget {
  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) throw new Error('Failed to allocate framebuffer.');
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

  const color = gl.createTexture();
  if (!color) throw new Error('Failed to allocate color texture.');
  gl.bindTexture(gl.TEXTURE_2D, color);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);

  const depth = gl.createTexture();
  if (!depth) throw new Error('Failed to allocate depth texture.');
  gl.bindTexture(gl.TEXTURE_2D, depth);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, width, height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Incomplete HDR framebuffer: 0x${status.toString(16)}`);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { framebuffer, color, depth, width, height };
}

export function deleteHdrTarget(gl: WebGL2RenderingContext, target: HdrTarget): void {
  gl.deleteFramebuffer(target.framebuffer);
  gl.deleteTexture(target.color);
  gl.deleteTexture(target.depth);
}
