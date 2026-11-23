import { buildStarCatalog } from "./catalog.js";
import {
  GRID_COLS,
  GRID_ROWS,
  TILE_GUTTER,
  computeTileLayout,
  type HfRect,
  type TileLayout,
} from "./foveation.js";
import {
  bindTexture,
  createEmptyVertexArray,
  createProgram,
  createTarget,
  resizeTarget,
  uniform,
  type RenderTarget,
} from "./gl.js";
import {
  compositeFragment,
  errorMetricsFragment,
  finalFragment,
} from "./shaders/composite.js";
import { sceneFragment, sceneVertex, starFragment, starVertex } from "./shaders/scene.js";

export type RenderMode = "foveated" | "reference" | "split" | "error";

export interface RenderStats {
  mode: RenderMode;
  layout: TileLayout;
  referencePixels: number;
  sampledPixels: number;
  savedFraction: number;
  meanError: number;
  edgeError: number;
  meanSeamError: number;
  maxSeamError: number;
  edgeDensity: number;
  renderMs: number;
  retileMs: number;
  frameWidth: number;
  frameHeight: number;
}

interface SceneUniforms {
  sceneMin: WebGLUniformLocation;
  sceneMax: WebGLUniformLocation;
  resolution: WebGLUniformLocation;
  time: WebGLUniformLocation;
}

interface StarUniforms {
  sceneMin: WebGLUniformLocation;
  sceneMax: WebGLUniformLocation;
  tileScale: WebGLUniformLocation;
  time: WebGLUniformLocation;
}

interface CompositeUniforms {
  atlas: WebGLUniformLocation;
  atlasSize: WebGLUniformLocation;
  grid: WebGLUniformLocation;
  gutter: WebGLUniformLocation;
  tileRects: WebGLUniformLocation;
  tileScales: WebGLUniformLocation;
  resolution: WebGLUniformLocation;
  time: WebGLUniformLocation;
}

interface FinalUniforms {
  result: WebGLUniformLocation;
  reference: WebGLUniformLocation;
  mode: WebGLUniformLocation;
  split: WebGLUniformLocation;
  resolution: WebGLUniformLocation;
  time: WebGLUniformLocation;
}

interface ErrorUniforms {
  result: WebGLUniformLocation;
  reference: WebGLUniformLocation;
  grid: WebGLUniformLocation;
  resolution: WebGLUniformLocation;
}

export class FoveatedRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  layout: TileLayout;
  mode: RenderMode = "foveated";
  split = 0.5;
  retileMs = 0;
  renderMs = 0;

  private readonly emptyVao: WebGLVertexArrayObject;
  private readonly starVao: WebGLVertexArrayObject;
  private readonly starCount: number;
  private readonly sceneProgram: WebGLProgram;
  private readonly starProgram: WebGLProgram;
  private readonly compositeProgram: WebGLProgram;
  private readonly finalProgram: WebGLProgram;
  private readonly errorProgram: WebGLProgram;
  private readonly sceneUniforms: SceneUniforms;
  private readonly starUniforms: StarUniforms;
  private readonly compositeUniforms: CompositeUniforms;
  private readonly finalUniforms: FinalUniforms;
  private readonly errorUniforms: ErrorUniforms;
  private readonly tileRectData = new Float32Array(GRID_COLS * GRID_ROWS * 4);
  private readonly tileScaleData = new Float32Array(GRID_COLS * GRID_ROWS);
  private readonly metricPixels = new Uint8Array(GRID_COLS * GRID_ROWS * 4);
  private atlasTarget: RenderTarget | null = null;
  private resultTarget: RenderTarget | null = null;
  private referenceTarget: RenderTarget | null = null;
  private metricsTarget: RenderTarget | null = null;
  private hfRects: HfRect[] = [];
  private gaze: [number, number] = [0.5, 0.5];
  private width = 1;
  private height = 1;
  private lastMetricsAt = -1e9;
  private lastReferenceAt = -1e9;
  private referenceValid = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 is unavailable. Enable hardware or SwiftShader acceleration.");
    this.gl = gl;

    this.sceneProgram = createProgram(gl, sceneVertex, sceneFragment, "scene");
    this.starProgram = createProgram(gl, starVertex, starFragment, "stars");
    this.compositeProgram = createProgram(gl, sceneVertex, compositeFragment, "composite");
    this.finalProgram = createProgram(gl, sceneVertex, finalFragment, "final");
    this.errorProgram = createProgram(gl, sceneVertex, errorMetricsFragment, "error metrics");

    this.sceneUniforms = {
      sceneMin: uniform(gl, this.sceneProgram, "u_sceneMin"),
      sceneMax: uniform(gl, this.sceneProgram, "u_sceneMax"),
      resolution: uniform(gl, this.sceneProgram, "u_resolution"),
      time: uniform(gl, this.sceneProgram, "u_time"),
    };
    this.starUniforms = {
      sceneMin: uniform(gl, this.starProgram, "u_sceneMin"),
      sceneMax: uniform(gl, this.starProgram, "u_sceneMax"),
      tileScale: uniform(gl, this.starProgram, "u_tileScale"),
      time: uniform(gl, this.starProgram, "u_time"),
    };
    this.compositeUniforms = {
      atlas: uniform(gl, this.compositeProgram, "u_atlas"),
      atlasSize: uniform(gl, this.compositeProgram, "u_atlasSize"),
      grid: uniform(gl, this.compositeProgram, "u_grid"),
      gutter: uniform(gl, this.compositeProgram, "u_gutter"),
      tileRects: uniform(gl, this.compositeProgram, "u_tileRects[0]"),
      tileScales: uniform(gl, this.compositeProgram, "u_tileScales[0]"),
      resolution: uniform(gl, this.compositeProgram, "u_resolution"),
      time: uniform(gl, this.compositeProgram, "u_time"),
    };
    this.finalUniforms = {
      result: uniform(gl, this.finalProgram, "u_result"),
      reference: uniform(gl, this.finalProgram, "u_reference"),
      mode: uniform(gl, this.finalProgram, "u_mode"),
      split: uniform(gl, this.finalProgram, "u_split"),
      resolution: uniform(gl, this.finalProgram, "u_resolution"),
      time: uniform(gl, this.finalProgram, "u_time"),
    };
    this.errorUniforms = {
      result: uniform(gl, this.errorProgram, "u_result"),
      reference: uniform(gl, this.errorProgram, "u_reference"),
      grid: uniform(gl, this.errorProgram, "u_grid"),
      resolution: uniform(gl, this.errorProgram, "u_resolution"),
    };

    this.emptyVao = createEmptyVertexArray(gl);
    const catalog = buildStarCatalog();
    this.starCount = catalog.count;
    const starVao = gl.createVertexArray();
    const starBuffer = gl.createBuffer();
    if (!starVao || !starBuffer) throw new Error("Unable to create star geometry");
    this.starVao = starVao;
    gl.bindVertexArray(starVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, starBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, catalog.data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 32, 20);
    gl.bindVertexArray(null);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DITHER);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.layout = computeTileLayout(1, 1, this.gaze, this.hfRects);
    this.resize();
  }

  setHfRects(rects: readonly HfRect[]): void {
    this.hfRects = rects.map((rect) => ({ ...rect }));
    this.rebuildLayout();
  }

  setGaze(x: number, y: number): void {
    const clampedX = Math.min(1, Math.max(0, x));
    const clampedY = Math.min(1, Math.max(0, y));
    if (Math.abs(clampedX - this.gaze[0]) < 1e-5 && Math.abs(clampedY - this.gaze[1]) < 1e-5) return;
    this.gaze = [clampedX, clampedY];
    this.rebuildLayout();
  }

  getGaze(): readonly [number, number] {
    return this.gaze;
  }

  setMode(mode: RenderMode): void {
    this.mode = mode;
    if (mode !== "foveated") this.referenceValid = false;
  }

  setSplit(value: number): void {
    this.split = Math.min(0.9, Math.max(0.1, value));
  }
