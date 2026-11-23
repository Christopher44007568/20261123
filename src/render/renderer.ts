import {
  createDropletField,
  MAX_DROPLETS,
  packDroplets,
  stepDroplets,
  toGpuRecords,
  updateDropletLens,
  type Droplet,
  type DropletGpuRecord,
  type LensSettings,
  type RainMode,
} from "./droplets";
import { BLOOM_BLUR_FRAGMENT, BLOOM_EXTRACT_FRAGMENT } from "./bloom-shader";
import { DROPLET_FRAGMENT } from "./droplet-shader";
import { SCENE_FRAGMENT } from "./scene-shader";
import {
  compileProgram,
  createRenderTarget,
  deleteRenderTarget,
  drawFullscreen,
  type RenderTarget,
} from "./gl";

export interface RendererState {
  mode: RainMode;
  showMask: boolean;
  lens: LensSettings;
  exposure: number;
}

export interface RainDiagnostics {
  mode: RainMode;
  showMask: boolean;
  dropCount: number;
  focusDistanceM: number;
  focalLengthMm: number;
  aperture: number;
  viewport: [number, number];
  droplets: DropletGpuRecord[];
}

const DEFAULT_LENS: LensSettings = {
  focalLengthMm: 50,
  aperture: 2.8,
  focusDistanceM: 0.12,
  sensorWidthMm: 36,
};

export class RainRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly state: RendererState;

  private readonly gl: WebGL2RenderingContext;
  private readonly sceneProgram: WebGLProgram;
  private readonly bloomExtractProgram: WebGLProgram;
  private readonly bloomBlurProgram: WebGLProgram;
  private readonly dropletProgram: WebGLProgram;
  private readonly dropTexture: WebGLTexture;
  private readonly dropData = new Float32Array(MAX_DROPLETS * 16);
  private readonly droplets: Droplet[];
  private sceneTarget!: RenderTarget;
  private bloomExtractTarget!: RenderTarget;
  private bloomBlurTarget!: RenderTarget;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private dropCount = 0;
  private lastFrameMs = performance.now();
  private startMs = performance.now();
  private dirtyDrops = true;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, initialMode: RainMode = "drift") {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 is required for the procedural lens rain.");
    this.gl = gl;
    if (!gl.getExtension("EXT_color_buffer_float")) {
      throw new Error("EXT_color_buffer_float is required for the HDR scene.");
    }

    this.state = {
      mode: initialMode,
      showMask: false,
      lens: { ...DEFAULT_LENS },
      exposure: 1.18,
    };

    this.sceneProgram = compileProgram(gl, SCENE_FRAGMENT, "Harbor HDR scene");
    this.bloomExtractProgram = compileProgram(gl, BLOOM_EXTRACT_FRAGMENT, "Bloom extract");
    this.bloomBlurProgram = compileProgram(gl, BLOOM_BLUR_FRAGMENT, "Bloom blur");
    this.dropletProgram = compileProgram(gl, DROPLET_FRAGMENT, "Lens droplet composite");

    const dropTexture = gl.createTexture();
    if (!dropTexture) throw new Error("Unable to create droplet data texture");
    this.dropTexture = dropTexture;
    gl.bindTexture(gl.TEXTURE_2D, dropTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.droplets = createDropletField(
      this.state.lens,
      Math.max(240, canvas.clientHeight || window.innerHeight),
      MAX_DROPLETS - 6,
    );
    this.resize();
    this.setLens(this.state.lens);
    this.uploadDroplets();
  }

  setMode(mode: RainMode): void {
    if (this.state.mode === mode) return;
    this.state.mode = mode;
    this.dirtyDrops = true;
  }

  setShowMask(showMask: boolean): void {
    this.state.showMask = showMask;
  }

  setLens(patch: Partial<LensSettings>): void {
    this.state.lens = { ...this.state.lens, ...patch };
    updateDropletLens(this.droplets, this.state.lens, this.height);
    this.dirtyDrops = true;
  }

  setExposure(exposure: number): void {
    this.state.exposure = Math.min(3, Math.max(0.35, exposure));
  }

  resize(): void {
    const cssWidth = Math.max(320, this.canvas.clientWidth || window.innerWidth);
    const cssHeight = Math.max(240, this.canvas.clientHeight || window.innerHeight);
    const maxDpr = cssWidth * cssHeight > 2_200_000 ? 1.25 : 1.6;
    this.dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const nextWidth = Math.max(1, Math.round(cssWidth * this.dpr));
    const nextHeight = Math.max(1, Math.round(cssHeight * this.dpr));
    if (nextWidth === this.width && nextHeight === this.height && this.sceneTarget) return;

    this.width = nextWidth;
    this.height = nextHeight;
    this.canvas.width = nextWidth;
    this.canvas.height = nextHeight;

    if (this.sceneTarget) {
      deleteRenderTarget(this.gl, this.sceneTarget);
      deleteRenderTarget(this.gl, this.bloomExtractTarget);
      deleteRenderTarget(this.gl, this.bloomBlurTarget);
    }

    const gl = this.gl;
    const hdrFormat = gl.RGBA16F;
    const hdrType = gl.HALF_FLOAT;
    this.sceneTarget = createRenderTarget(gl, this.width, this.height, hdrFormat, hdrType, true);
    const bloomWidth = Math.max(1, Math.floor(this.width / 2));
    const bloomHeight = Math.max(1, Math.floor(this.height / 2));
    this.bloomExtractTarget = createRenderTarget(gl, bloomWidth, bloomHeight, hdrFormat, hdrType);
    this.bloomBlurTarget = createRenderTarget(gl, bloomWidth, bloomHeight, hdrFormat, hdrType);
    if (this.droplets) {
      updateDropletLens(this.droplets, this.state.lens, this.height);
      this.dirtyDrops = true;
    }
  }

  render(nowMs = performance.now()): void {
    if (this.disposed) return;
    const dt = Math.min(0.05, Math.max(0, (nowMs - this.lastFrameMs) / 1000));
    this.lastFrameMs = nowMs;
    const elapsed = (nowMs - this.startMs) / 1000;
    if (this.state.mode === "drift") {
      stepDroplets(this.droplets, this.state.mode, dt, elapsed, this.height);
      this.dirtyDrops = true;
    }
    if (this.dirtyDrops) this.uploadDroplets();
    this.renderScene(elapsed);
    this.renderBloom();
    this.renderComposite(elapsed);
  }

  getDiagnostics(): RainDiagnostics {
    return {
      mode: this.state.mode,
      showMask: this.state.showMask,
      dropCount: this.state.mode === "off" ? 0 : this.dropCount,
      focusDistanceM: this.state.lens.focusDistanceM,
      focalLengthMm: this.state.lens.focalLengthMm,
      aperture: this.state.lens.aperture,
      viewport: [this.width, this.height],
      droplets: toGpuRecords(this.droplets, this.state.mode),
    };
  }

  readPixelCss(x: number, yFromTop: number): [number, number, number, number] {
    this.render(performance.now());
    const gl = this.gl;
    const px = Math.max(0, Math.min(this.width - 1, Math.round(x * this.dpr)));
    const py = Math.max(0, Math.min(this.height - 1, Math.round(this.height - yFromTop * this.dpr)));
    const pixel = new Uint8Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]!];
  }

  dispose(): void {
    this.disposed = true;
    const gl = this.gl;
    if (this.sceneTarget) {
      deleteRenderTarget(gl, this.sceneTarget);
      deleteRenderTarget(gl, this.bloomExtractTarget);
      deleteRenderTarget(gl, this.bloomBlurTarget);
    }
    gl.deleteTexture(this.dropTexture);
    gl.deleteProgram(this.sceneProgram);
    gl.deleteProgram(this.bloomExtractProgram);
    gl.deleteProgram(this.bloomBlurProgram);
    gl.deleteProgram(this.dropletProgram);
  }

  private uploadDroplets(): void {
    this.dropCount = packDroplets(this.droplets, this.state.mode, this.dropData);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.dropTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      4,
      MAX_DROPLETS,
      0,
      gl.RGBA,
      gl.FLOAT,
      this.dropData,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.dirtyDrops = false;
  }

  private renderScene(elapsed: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneTarget.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.sceneProgram);
    gl.uniform2f(gl.getUniformLocation(this.sceneProgram, "uResolution"), this.width, this.height);
    gl.uniform1f(gl.getUniformLocation(this.sceneProgram, "uTime"), elapsed);
    gl.uniform1f(
      gl.getUniformLocation(this.sceneProgram, "uRainAmount"),
      this.state.mode === "off" ? 0 : 1,
    );
    drawFullscreen(gl);

    gl.bindTexture(gl.TEXTURE_2D, this.sceneTarget.texture);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private renderBloom(): void {
    const gl = this.gl;
    gl.useProgram(this.bloomExtractProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomExtractTarget.framebuffer);
    gl.viewport(0, 0, this.bloomExtractTarget.width, this.bloomExtractTarget.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTarget.texture);
    gl.uniform1i(gl.getUniformLocation(this.bloomExtractProgram, "uScene"), 0);
    gl.uniform2f(
      gl.getUniformLocation(this.bloomExtractProgram, "uTexel"),
      1 / this.width,
      1 / this.height,
    );
    drawFullscreen(gl);

    gl.useProgram(this.bloomBlurProgram);
    gl.uniform1i(gl.getUniformLocation(this.bloomBlurProgram, "uSource"), 0);
    const direction = gl.getUniformLocation(this.bloomBlurProgram, "uDirection");

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomBlurTarget.framebuffer);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomExtractTarget.texture);
    gl.uniform2f(direction, 1, 0);
    drawFullscreen(gl);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomExtractTarget.framebuffer);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomBlurTarget.texture);
    gl.uniform2f(direction, 0, 1);
    drawFullscreen(gl);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private renderComposite(elapsed: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.dropletProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTarget.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomExtractTarget.texture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.dropTexture);
    const program = this.dropletProgram;
    gl.uniform1i(gl.getUniformLocation(program, "uScene"), 0);
    gl.uniform1i(gl.getUniformLocation(program, "uBloom"), 1);
    gl.uniform1i(gl.getUniformLocation(program, "uDrops"), 2);
    gl.uniform2f(gl.getUniformLocation(program, "uResolution"), this.width, this.height);
    gl.uniform1f(gl.getUniformLocation(program, "uTime"), elapsed);
    gl.uniform1i(gl.getUniformLocation(program, "uMode"), this.state.mode === "off" ? 0 : 1);
    gl.uniform1i(gl.getUniformLocation(program, "uDropCount"), this.dropCount);
    gl.uniform1f(gl.getUniformLocation(program, "uShowMask"), this.state.showMask ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(program, "uFocalLengthMm"), this.state.lens.focalLengthMm);
    gl.uniform1f(gl.getUniformLocation(program, "uAperture"), this.state.lens.aperture);
    gl.uniform1f(gl.getUniformLocation(program, "uFocusM"), this.state.lens.focusDistanceM);
    gl.uniform1f(gl.getUniformLocation(program, "uExposure"), this.state.exposure);
    gl.uniform3f(gl.getUniformLocation(program, "uCockpitTint"), 0.05, 0.12, 0.13);
    drawFullscreen(gl);
    gl.activeTexture(gl.TEXTURE0);
  }
}
