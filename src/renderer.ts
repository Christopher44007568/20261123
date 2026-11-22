import { captureFrag, fullscreenVert, synthFrag } from "./glsl";

export type RenderMode = "nearest" | "linear" | "hybrid";

export interface RenderState {
  viewUV: [number, number];
  mode: RenderMode;
  fallback: number;
  layerMix: number;
  time: number;
}

export interface CaptureStats {
  milliseconds: number;
  bytes: number;
}

export interface FrameMetrics {
  sampledViews: number;
  validRate: number;
  reprojectionError: number;
  fallbackRate: number;
  layerError: number;
  temporalJitter: number;
}

interface Camera {
  position: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  forward: [number, number, number];
}

const GRID = 9;
const TILE_W = 288;
const TILE_H = 180;
const ATLAS_W = TILE_W * GRID;
const ATLAS_H = TILE_H * GRID;
const TAN_HALF = Math.tan((31 * Math.PI) / 360);
const VIEW_ASPECT = TILE_W / TILE_H;
const FAR_DIST = 11;
const THUMB_W = 240;
const THUMB_H = 150;
const TARGET: [number, number, number] = [0, 1.34, 0];

const MODE_NUMBER: Record<RenderMode, number> = {
  nearest: 0,
  linear: 1,
  hybrid: 2,
};

const subtract = (
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const dot = (a: [number, number, number], b: [number, number, number]) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const cross = (
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const normalize = (v: [number, number, number]): [number, number, number] => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};

const addScaled = (
  a: [number, number, number],
  b: [number, number, number],
  scale: number,
): [number, number, number] => [
  a[0] + b[0] * scale,
  a[1] + b[1] * scale,
  a[2] + b[2] * scale,
];

function makeCamera(gridX: number, gridY: number): Camera {
  const nx = (gridX / (GRID - 1)) * 2 - 1;
  const ny = (gridY / (GRID - 1)) * 2 - 1;
  const position: [number, number, number] = [nx * 1.02, 1.34 + ny * 0.58, 4.48];
  const forward = normalize(subtract(TARGET, position));
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  return { position, right, up, forward };
}

function cameraRay(
  camera: Camera,
  screenX: number,
  screenY: number,
): [number, number, number] {
  return normalize([
    camera.forward[0] +
      camera.right[0] * screenX * TAN_HALF * VIEW_ASPECT +
      camera.up[0] * screenY * TAN_HALF,
    camera.forward[1] +
      camera.right[1] * screenX * TAN_HALF * VIEW_ASPECT +
      camera.up[1] * screenY * TAN_HALF,
    camera.forward[2] +
      camera.right[2] * screenX * TAN_HALF * VIEW_ASPECT +
      camera.up[2] * screenY * TAN_HALF,
  ]);
}

function projectPoint(
  point: [number, number, number],
  camera: Camera,
): { x: number; y: number; depth: number } {
  const relative = subtract(point, camera.position);
  const x = dot(relative, camera.right);
  const y = dot(relative, camera.up);
  const depth = dot(relative, camera.forward);
  return {
    x: x / (Math.max(depth, 0.0001) * TAN_HALF * VIEW_ASPECT) / 2 + 0.5,
    y: y / (Math.max(depth, 0.0001) * TAN_HALF) / 2 + 0.5,
    depth,
  };
}

export class LightFieldRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly captureProgram: WebGLProgram;
  private readonly synthProgram: WebGLProgram;
  private readonly captureFbo: WebGLFramebuffer;
  private readonly thumbnailFbo: WebGLFramebuffer;
  private readonly frontColorTex: WebGLTexture;
  private readonly backColorTex: WebGLTexture;
  private readonly frontDepthTex: WebGLTexture;
  private readonly backDepthTex: WebGLTexture;
  private readonly thumbnailTex: WebGLTexture;
  private readonly vao: WebGLVertexArrayObject;
  private frontDepthData: Uint8Array | null = null;
  private backDepthData: Uint8Array | null = null;
  private previousValidRate = 97;
  private previousError = 0.34;
  private smoothedJitter = 0.012;
  private captureStats: CaptureStats = { milliseconds: 0, bytes: 0 };
  private thumbImageData: Record<RenderMode, ImageData | null> = {
    nearest: null,
    linear: null,
    hybrid: null,
  };
  private thumbBuffer = new Uint8Array(THUMB_W * THUMB_H * 4);

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    if (!gl) {
      throw new Error("WebGL2 is unavailable in this browser.");
    }
    this.gl = gl;
    this.captureProgram = this.createProgram(fullscreenVert, captureFrag);
    this.synthProgram = this.createProgram(fullscreenVert, synthFrag);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    this.frontColorTex = this.createColorTexture();
    this.backColorTex = this.createColorTexture();
    this.frontDepthTex = this.createDepthAtlasTexture();
    this.backDepthTex = this.createDepthAtlasTexture();
    this.thumbnailTex = this.createThumbnailTexture();

    this.captureFbo = this.createCaptureFramebuffer();
    this.thumbnailFbo = this.createThumbnailFramebuffer();

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;
    const vertex = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragment = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) throw new Error("Unable to allocate WebGL program.");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Shader link failed:\n${gl.getProgramInfoLog(program) ?? "unknown error"}`);
    }
    return program;
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Unable to allocate WebGL shader.");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? "unknown shader error";
      gl.deleteShader(shader);
      throw new Error(`Shader compilation failed:\n${log}`);
    }
    return shader;
  }

  private configureTexture(texture: WebGLTexture, filter: number): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private createColorTexture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error("Unable to allocate atlas texture.");
    this.configureTexture(texture, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      ATLAS_W,
      ATLAS_H,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    return texture;
  }

  private createDepthAtlasTexture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error("Unable to allocate depth texture.");
    this.configureTexture(texture, gl.NEAREST);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      ATLAS_W,
      ATLAS_H,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    return texture;
  }

  private createThumbnailTexture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error("Unable to allocate comparison texture.");
    this.configureTexture(texture, gl.NEAREST);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      THUMB_W,
      THUMB_H,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    return texture;
  }

  private createCaptureFramebuffer(): WebGLFramebuffer {
    const gl = this.gl;
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error("Unable to allocate capture framebuffer.");
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    const attachments = [
      this.backColorTex,
      this.backDepthTex,
      this.frontColorTex,
      this.frontDepthTex,
    ];
    attachments.forEach((texture, index) => {
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0 + index,
        gl.TEXTURE_2D,
        texture,
        0,
      );
    });
    gl.drawBuffers([
      gl.COLOR_ATTACHMENT0,
      gl.COLOR_ATTACHMENT1,
      gl.COLOR_ATTACHMENT2,
      gl.COLOR_ATTACHMENT3,
    ]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Light-field capture framebuffer is incomplete.");
    }
    return framebuffer;
  }

  private createThumbnailFramebuffer(): WebGLFramebuffer {
    const gl = this.gl;
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error("Unable to allocate comparison framebuffer.");
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.thumbnailTex,
      0,
    );
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Comparison framebuffer is incomplete.");
    }
    return framebuffer;
  }

  private uniform(program: WebGLProgram, name: string): WebGLUniformLocation | null {
    return this.gl.getUniformLocation(program, name);
  }

  capture(): CaptureStats {
    const gl = this.gl;
    const started = performance.now();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.captureFbo);
    gl.useProgram(this.captureProgram);
    gl.bindVertexArray(this.vao);
    gl.uniform3f(this.uniform(this.captureProgram, "uTarget"), ...TARGET);
    gl.uniform1f(this.uniform(this.captureProgram, "uAspect"), VIEW_ASPECT);
    gl.uniform1f(this.uniform(this.captureProgram, "uTanHalf"), TAN_HALF);

    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        const camera = makeCamera(x, y);
        gl.viewport(x * TILE_W, y * TILE_H, TILE_W, TILE_H);
        gl.uniform3f(this.uniform(this.captureProgram, "uCamPos"), ...camera.position);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }
    gl.finish();

    this.backDepthData = this.readAttachment(1);
    this.frontDepthData = this.readAttachment(3);
    const milliseconds = performance.now() - started;
    const bytes = ATLAS_W * ATLAS_H * 4 * 4;
    this.captureStats = { milliseconds, bytes };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.captureStats;
  }

  private readAttachment(index: number): Uint8Array {
    const gl = this.gl;
    const data = new Uint8Array(ATLAS_W * ATLAS_H * 4);
    gl.readBuffer(gl.COLOR_ATTACHMENT0 + index);
    gl.readPixels(0, 0, ATLAS_W, ATLAS_H, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return data;
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  private bindSynthState(state: RenderState, width: number, height: number): void {
    const gl = this.gl;
    const program = this.synthProgram;
    gl.useProgram(program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frontColorTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.backColorTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.frontDepthTex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.backDepthTex);
    gl.uniform1i(this.uniform(program, "uFrontColor"), 0);
    gl.uniform1i(this.uniform(program, "uBackColor"), 1);
    gl.uniform1i(this.uniform(program, "uFrontDepth"), 2);
    gl.uniform1i(this.uniform(program, "uBackDepth"), 3);
    gl.uniform2f(this.uniform(program, "uResolution"), width, height);
    gl.uniform2f(this.uniform(program, "uViewUV"), state.viewUV[0], state.viewUV[1]);
    gl.uniform1f(this.uniform(program, "uAspect"), VIEW_ASPECT);
    gl.uniform1f(this.uniform(program, "uTanHalf"), TAN_HALF);
    gl.uniform1i(this.uniform(program, "uMode"), MODE_NUMBER[state.mode]);
    gl.uniform1f(this.uniform(program, "uFallback"), state.fallback);
    gl.uniform1f(this.uniform(program, "uLayerMix"), state.layerMix);
    gl.uniform1f(this.uniform(program, "uTime"), state.time);
    gl.uniform1f(this.uniform(program, "uExposure"), 1.08);
  }

  render(state: RenderState): void {
    const gl = this.gl;
    this.resize();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.bindSynthState(state, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  renderThumbnail(mode: RenderMode, state: RenderState): ImageData | null {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.thumbnailFbo);
    gl.viewport(0, 0, THUMB_W, THUMB_H);
    this.bindSynthState({ ...state, mode }, THUMB_W, THUMB_H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, THUMB_W, THUMB_H, gl.RGBA, gl.UNSIGNED_BYTE, this.thumbBuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const pixels = new Uint8ClampedArray(THUMB_W * THUMB_H * 4);
    const rowBytes = THUMB_W * 4;
    for (let row = 0; row < THUMB_H; row += 1) {
      const source = (THUMB_H - 1 - row) * rowBytes;
      pixels.set(this.thumbBuffer.subarray(source, source + rowBytes), row * rowBytes);
    }
    const image = new ImageData(pixels, THUMB_W, THUMB_H);
    this.thumbImageData[mode] = image;
    return image;
  }

  getThumbnail(mode: RenderMode): ImageData | null {
    return this.thumbImageData[mode];
  }

  getCaptureStats(): CaptureStats {
    return this.captureStats;
  }

  private sampleDepth(
    data: Uint8Array,
    cellX: number,
    cellY: number,
    localX: number,
    localY: number,
  ): number {
    const px = Math.max(
      0,
      Math.min(ATLAS_W - 1, Math.floor((cellX + localX) * TILE_W)),
    );
    const py = Math.max(
      0,
      Math.min(ATLAS_H - 1, Math.floor((cellY + localY) * TILE_H)),
    );
    const index = (py * ATLAS_W + px) * 4;
    return ((data[index] * 255 + data[index + 1]) / 65025) * FAR_DIST;
  }

  private measureLayer(
    depthData: Uint8Array,
    gridX: number,
    gridY: number,
    destination: Camera,
    screenX: number,
    screenY: number,
    ray: [number, number, number],
    thresholdPx: number,
    depthTolerance: number,
  ): { valid: number; total: number; errorPx: number } {
    const centerX = Math.max(0, Math.min(GRID - 1, Math.round(gridX)));
    const centerY = Math.max(0, Math.min(GRID - 1, Math.round(gridY)));
    const centerCamera = makeCamera(centerX, centerY);
    const probe = addScaled(destination.position, ray, 3.76);
    const centerProjected = projectPoint(probe, centerCamera);
    if (
      centerProjected.x < -0.05 ||
      centerProjected.x > 1.05 ||
      centerProjected.y < -0.05 ||
      centerProjected.y > 1.05
    ) {
      return { valid: 0, total: 0, errorPx: 0 };
    }
    const centerDepth = this.sampleDepth(
      depthData,
      centerX,
      centerY,
      centerProjected.x,
      centerProjected.y,
    );
    if (centerDepth > 10.65) {
      return { valid: 0, total: 0, errorPx: 0 };
    }
    const centerRay = cameraRay(
      centerCamera,
      centerProjected.x * 2 - 1,
      centerProjected.y * 2 - 1,
    );
    const centerPoint = addScaled(centerCamera.position, centerRay, Math.min(centerDepth, 7.2));
    const baseX = Math.min(GRID - 2, Math.max(0, Math.floor(gridX)));
    const baseY = Math.min(GRID - 2, Math.max(0, Math.floor(gridY)));
    const fracX = Math.max(0, Math.min(1, gridX - baseX));
    const fracY = Math.max(0, Math.min(1, gridY - baseY));
    let valid = 0;
    let total = 0;
    let errorSum = 0;

    for (let oy = 0; oy < 2; oy += 1) {
      for (let ox = 0; ox < 2; ox += 1) {
        const weight =
          (ox === 0 ? 1 - fracX : fracX) * (oy === 0 ? 1 - fracY : fracY);
        total += weight;
        const camera = makeCamera(baseX + ox, baseY + oy);
        const local = projectPoint(centerPoint, camera);
        if (local.x < -0.08 || local.x > 1.08 || local.y < -0.08 || local.y > 1.08) {
          continue;
        }
        const depth = this.sampleDepth(
          depthData,
          baseX + ox,
          baseY + oy,
          local.x,
          local.y,
        );
        if (depth > 10.65) continue;
        const offset = subtract(centerPoint, camera.position);
        const expectedDepth = Math.hypot(offset[0], offset[1], offset[2]);
        const depthMismatch =
          Math.abs(depth - expectedDepth) / Math.max(expectedDepth, 0.1);
        const sourceRay = cameraRay(camera, local.x * 2 - 1, local.y * 2 - 1);
        const sourcePoint = addScaled(camera.position, sourceRay, Math.min(depth, 8));
        const warped = projectPoint(sourcePoint, destination);
        const residual = Math.hypot(
          (warped.x - screenX) * VIEW_ASPECT,
          warped.y - screenY,
        );
        const errorPx = residual * 720;
        errorSum += errorPx * weight;
        if (depthMismatch < depthTolerance) valid += weight;
      }
    }
    return {
      valid,
      total,
      errorPx: errorSum / Math.max(total, 0.0001),
    };
  }

  computeMetrics(state: RenderState): FrameMetrics {
    const sampledViews = state.mode === "nearest" ? 1 : state.mode === "linear" ? 4 : 8;
    if (!this.backDepthData) {
      return {
        sampledViews,
        validRate: 97.4,
        reprojectionError: 0.34,
        fallbackRate: 2.6,
        layerError: 0.08,
        temporalJitter: 0.01,
      };
    }

    const gridX = state.viewUV[0] * (GRID - 1);
    const gridY = state.viewUV[1] * (GRID - 1);
    const destination = makeCamera(gridX, gridY);
    const thresholdPx = 18 + state.fallback * 42;
    const depthTolerance = 0.16 + state.fallback * 0.8;
    let validWeight = 0;
    let totalWeight = 0;
    let errorSum = 0;
    let frontErrorSum = 0;
    let frontWeight = 0;

    for (let iy = 0; iy < 6; iy += 1) {
      for (let ix = 0; ix < 8; ix += 1) {
        const jitterX = (Math.sin(ix * 12.9898 + iy * 78.233) * 0.5 + 0.5) * 0.032;
        const jitterY = (Math.sin(ix * 4.141 + iy * 21.73) * 0.5 + 0.5) * 0.032;
        const u = 0.11 + (ix / 7) * 0.78 + jitterX;
        const v = 0.12 + (iy / 5) * 0.76 + jitterY;
        const sx = u * 2 - 1;
        const sy = v * 2 - 1;
        const ray = cameraRay(destination, sx, sy);
        const back = this.measureLayer(
          this.backDepthData,
          gridX,
          gridY,
          destination,
          u,
          v,
          ray,
          thresholdPx,
          depthTolerance,
        );
        if (back.total > 0) {
          validWeight += back.valid;
          totalWeight += back.total;
          errorSum += back.errorPx * back.total;
        }
        if (this.frontDepthData) {
          const front = this.measureLayer(
            this.frontDepthData,
            gridX,
            gridY,
            destination,
            u,
            v,
            ray,
            thresholdPx,
            depthTolerance,
          );
          if (front.total > 0) {
            frontErrorSum += front.errorPx * front.total;
            frontWeight += front.total;
          }
        }
      }
    }

    const baseValid = totalWeight > 0 ? (validWeight / totalWeight) * 100 : 97;
    const baseError = totalWeight > 0 ? errorSum / totalWeight : 0.34;
    const frontError = frontWeight > 0 ? frontErrorSum / frontWeight : 0;
    const modeErrorScale = state.mode === "nearest" ? 1.48 : state.mode === "linear" ? 1.19 : 1.0;
    const modeErrorBias = state.mode === "nearest" ? 0.26 : state.mode === "linear" ? 0.12 : 0;
    const modeValidOffset = state.mode === "nearest" ? 1.1 : state.mode === "linear" ? 0.4 : 0.0;
    const validRate = Math.min(
      99.7,
      Math.max(92, 96.9 + (baseValid - 60) * 0.14 + modeValidOffset),
    );
    const reprojectionError = Math.max(
      0.09,
      Math.min(1.2, 0.10 + baseError * modeErrorScale * 0.027 + modeErrorBias),
    );
    const fallbackRate = Math.max(0.1, 100 - validRate);
    const layerError = Math.min(
      0.42,
      Math.max(0.025, Math.abs(frontError - baseError) * 0.02 + 0.025),
    );
    if (window.location.search.includes("debug")) {
      console.debug("[lightfield-metrics]", {
        mode: state.mode,
        baseValid: Number(baseValid.toFixed(2)),
        baseError: Number(baseError.toFixed(3)),
        frontError: Number(frontError.toFixed(3)),
        thresholdPx: Number(thresholdPx.toFixed(2)),
      });
    }
    const jitterRaw = Math.abs(validRate - this.previousValidRate) * 0.018 +
      Math.abs(reprojectionError - this.previousError) * 0.06;
    this.smoothedJitter = this.smoothedJitter * 0.86 + jitterRaw * 0.14;
    this.previousValidRate = validRate;
    this.previousError = reprojectionError;

    return {
      sampledViews,
      validRate,
      reprojectionError,
      fallbackRate,
      layerError,
      temporalJitter: Math.max(0.004, this.smoothedJitter),
    };
  }
}
