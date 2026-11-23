import commonShader from "./shaders/common.wgsl?raw";
import rasterShader from "./shaders/raster.wgsl?raw";
import restirShader from "./shaders/restir.wgsl?raw";
import referenceShader from "./shaders/reference.wgsl?raw";
import tonemapShader from "./shaders/tonemap.wgsl?raw";
import denoiseShader from "./shaders/denoise.wgsl?raw";
import { buildScene } from "./scene/buildScene";
import type { SceneData, Vec3 } from "./scene/types";
import { lookAt, multiply, normalize, perspective, subtract } from "./math";

const UNIFORM_FLOATS = 84;
const RESERVOIR_BYTES = 32;
const STATS_BYTES = 64;
const LIGHT_GRID_DIM = 20;
const LIGHT_GRID_K = 32;

type GpuTextureSet = {
  position: GPUTexture;
  normal: GPUTexture;
  albedo: GPUTexture;
  emission: GPUTexture;
};

export interface StatsSnapshot {
  frame: number;
  lightCount: number;
  acceptRate: number;
  historyRejectRate: number;
  meanWeight: number;
  meanLuminance: number;
  referenceError: number;
  validPixels: number;
  temporalAttempts: number;
  spatialAttempts: number;
  gpuTimeMs: number;
}

export interface PublicSnapshot extends StatsSnapshot {
  ready: boolean;
  mode: number;
  spatial: boolean;
  historyCap: number;
  paused: boolean;
  pathTime: number;
  triangleCount: number;
  referenceSampled: boolean;
}

export interface RestirApi {
  snapshot: () => PublicSnapshot;
  setMode: (mode: number) => void;
  setSpatial: (enabled: boolean) => void;
  setHistoryCap: (size: number) => void;
  setPaused: (paused: boolean) => void;
  setPathTime: (seconds: number) => void;
  resetHistory: () => void;
  requestReference: () => void;
  step: (deltaSeconds?: number, frameCount?: number) => Promise<PublicSnapshot>;
  setManual: (manual: boolean) => void;
}

export class RestirRenderer implements RestirApi {
  readonly scene: SceneData;
  readonly canvas: HTMLCanvasElement;
  ready = false;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private width = 1;
  private height = 1;
  private resolutionOverride: [number, number] | null = null;

  private uniformBuffer!: GPUBuffer;
  private lightBuffer!: GPUBuffer;
  private occluderBuffer!: GPUBuffer;
  private lightGridBuffer!: GPUBuffer;
  private reservoirBuffers: GPUBuffer[] = [];
  private temporalBuffer!: GPUBuffer;
  private statsBuffer!: GPUBuffer;
  private statsCapture!: GPUBuffer;
  private vertexBuffer!: GPUBuffer;
  private indexBuffer!: GPUBuffer;
  private indexCount = 0;

  private gbufferSets: GpuTextureSet[] = [];
  private depthTexture!: GPUTexture;
  private hdrTexture!: GPUTexture;
  private referenceTexture!: GPUTexture;
  private denoiseTexture!: GPUTexture;

  private rasterPipeline!: GPURenderPipeline;
  private temporalPipeline!: GPUComputePipeline;
  private spatialPipeline!: GPUComputePipeline;
  private shadePipeline!: GPUComputePipeline;
  private denoisePipeline!: GPUComputePipeline;
  private referencePipeline!: GPUComputePipeline;
  private comparePipeline!: GPUComputePipeline;
  private tonemapPipeline!: GPURenderPipeline;

  private restirLayout!: GPUBindGroupLayout;
  private referenceLayout!: GPUBindGroupLayout;
  private compareFrameLayout!: GPUBindGroupLayout;
  private compareDataLayout!: GPUBindGroupLayout;
  private tonemapLayout!: GPUBindGroupLayout;
  private denoiseLayout!: GPUBindGroupLayout;
  private restirBindGroups: GPUBindGroup[] = [];
  private referenceBindGroups: GPUBindGroup[] = [];
  private compareBindGroup!: GPUBindGroup;
  private tonemapBindGroup!: GPUBindGroup;
  private denoiseBindGroups: GPUBindGroup[] = [];
  private rasterBindGroup!: GPUBindGroup;
  private compareDataBindGroup!: GPUBindGroup;
  private linearSampler!: GPUSampler;

  private frameSlot = 0;
  private frameIndex = 0;
  private historyValid = false;
  private previousViewProjection: Float32Array = new Float32Array(16);
  private cameraPathTime = 6.2;
  private lastTimestamp = 0;
  private paused = false;
  private manual = false;
  private mode = 0;
  private spatial = true;
  private historyCap = 32;
  private referenceDirty = false;
  private referenceSampled = false;
  private statsPending = false;
  private statsPromise: Promise<StatsSnapshot> | null = null;
  private latestStats: StatsSnapshot;
  private uiStatsHandler: ((stats: StatsSnapshot) => void) | null = null;
  private readyHandler: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, resolutionOverride: [number, number] | null = null) {
    this.canvas = canvas;
    this.scene = buildScene();
    this.resolutionOverride = resolutionOverride;
    this.latestStats = {
      frame: 0,
      lightCount: this.scene.lights.length,
      acceptRate: 0,
      historyRejectRate: 0,
      meanWeight: 0,
      meanLuminance: 0,
      referenceError: 0,
      validPixels: 0,
      temporalAttempts: 0,
      spatialAttempts: 0,
      gpuTimeMs: 0,
    };
  }

  async initialize(): Promise<void> {
    if (!navigator.gpu) {
      throw new Error("WebGPU is unavailable in this browser.");
    }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) {
      throw new Error("No WebGPU adapter was found.");
    }
    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext("webgpu") as GPUCanvasContext;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "opaque",
    });
    this.createPipelines();
    this.createSceneBuffers();
    this.resize(true);
    this.ready = true;
    this.readyHandler?.();
  }

  onReady(handler: () => void): void {
    this.readyHandler = handler;
  }

  onStats(handler: (stats: StatsSnapshot) => void): void {
    this.uiStatsHandler = handler;
  }

  private createPipelines(): void {
    const visibility = GPUShaderStage.COMPUTE;
    const restirEntries: GPUBindGroupLayoutEntry[] = [
      { binding: 0, visibility, buffer: { type: "uniform" } },
      ...[1, 2, 3, 4, 5, 6].map((binding) => ({
        binding,
        visibility,
        texture: { sampleType: "float" as const, viewDimension: "2d" as const },
      })),
      { binding: 7, visibility, buffer: { type: "read-only-storage" } },
      { binding: 8, visibility, buffer: { type: "read-only-storage" } },
      { binding: 9, visibility, buffer: { type: "read-only-storage" } },
      { binding: 10, visibility, buffer: { type: "storage" } },
      { binding: 11, visibility, buffer: { type: "storage" } },
      {
        binding: 12,
        visibility,
        storageTexture: { access: "write-only", format: "rgba16float", viewDimension: "2d" },
      },
      { binding: 13, visibility, buffer: { type: "storage" } },
      { binding: 14, visibility, buffer: { type: "read-only-storage" } },
    ];
    this.restirLayout = this.device.createBindGroupLayout({ entries: restirEntries });

    const referenceEntries: GPUBindGroupLayoutEntry[] = [
      { binding: 0, visibility, buffer: { type: "uniform" } },
      ...[1, 2, 3, 4].map((binding) => ({
        binding,
        visibility,
        texture: { sampleType: "float" as const, viewDimension: "2d" as const },
      })),
      { binding: 5, visibility, buffer: { type: "read-only-storage" } },
      { binding: 6, visibility, buffer: { type: "read-only-storage" } },
      {
        binding: 7,
        visibility,
        storageTexture: { access: "write-only", format: "rgba16float", viewDimension: "2d" },
      },
    ];
    this.referenceLayout = this.device.createBindGroupLayout({ entries: referenceEntries });

    this.compareFrameLayout = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility, buffer: { type: "uniform" } }],
    });
    this.compareDataLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility,
          texture: { sampleType: "float", viewDimension: "2d" },
        },
        {
          binding: 1,
          visibility,
          texture: { sampleType: "float", viewDimension: "2d" },
        },
        { binding: 2, visibility, buffer: { type: "storage" } },
      ],
    });

    this.tonemapLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "2d" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "2d" },
        },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      ],
    });
    this.denoiseLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility, buffer: { type: "uniform" } },
        ...[1, 2, 3].map((binding) => ({
          binding,
          visibility,
          texture: { sampleType: "float" as const, viewDimension: "2d" as const },
        })),
        {
          binding: 4,
          visibility,
          storageTexture: { access: "write-only", format: "rgba16float", viewDimension: "2d" },
        },
      ],
    });

    const restirModule = this.device.createShaderModule({
      code: `${commonShader}\n${restirShader}`,
      label: "ReSTIR direct-light module",
    });
    const referenceModule = this.device.createShaderModule({
      code: `${commonShader}\n${referenceShader}`,
      label: "Reference and comparison module",
    });
    const rasterModule = this.device.createShaderModule({
      code: rasterShader,
      label: "G-buffer module",
    });
    const tonemapModule = this.device.createShaderModule({
      code: `${commonShader}\n${tonemapShader}`,
      label: "ACES composition module",
    });
    const denoiseModule = this.device.createShaderModule({
      code: `${commonShader}\n${denoiseShader}`,
      label: "Edge-aware reservoir filter",
    });

    this.rasterPipeline = this.device.createRenderPipeline({
      label: "G-buffer raster",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.device.createBindGroupLayout({
          entries: [{
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: "uniform" },
          }],
        })],
      }),
      vertex: {
        module: rasterModule,
        entryPoint: "vsMain",
        buffers: [{
          arrayStride: 64,
          stepMode: "vertex",
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32" },
            { shaderLocation: 2, offset: 16, format: "float32x3" },
            { shaderLocation: 3, offset: 28, format: "float32" },
            { shaderLocation: 4, offset: 32, format: "float32x3" },
            { shaderLocation: 5, offset: 44, format: "float32" },
            { shaderLocation: 6, offset: 48, format: "float32x3" },
            { shaderLocation: 7, offset: 60, format: "float32" },
          ],
        }],
      },
      fragment: {
        module: rasterModule,
        entryPoint: "fsMain",
        targets: [
          { format: "rgba16float" },
          { format: "rgba16float" },
          { format: "rgba16float" },
          { format: "rgba16float" },
        ],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });

    this.temporalPipeline = this.device.createComputePipeline({
      label: "ReSTIR temporal reuse",
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.restirLayout] }),
      compute: { module: restirModule, entryPoint: "temporalMain" },
    });
    this.spatialPipeline = this.device.createComputePipeline({
      label: "ReSTIR spatial reuse",
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.restirLayout] }),
      compute: { module: restirModule, entryPoint: "spatialMain" },
    });
    this.shadePipeline = this.device.createComputePipeline({
      label: "Reservoir shading",
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.restirLayout] }),
      compute: { module: restirModule, entryPoint: "shadeMain" },
    });
    this.denoisePipeline = this.device.createComputePipeline({
      label: "Edge-aware reservoir filter",
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.denoiseLayout] }),
      compute: { module: denoiseModule, entryPoint: "denoiseMain" },
    });
    this.referencePipeline = this.device.createComputePipeline({
      label: "220-light reference",
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.referenceLayout] }),
      compute: { module: referenceModule, entryPoint: "referenceMain" },
    });
    this.comparePipeline = this.device.createComputePipeline({
      label: "Reference comparison",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.compareFrameLayout, this.compareDataLayout],
      }),
      compute: { module: referenceModule, entryPoint: "compareMain" },
    });
    this.tonemapPipeline = this.device.createRenderPipeline({
      label: "ACES tonemap",
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.tonemapLayout] }),
      vertex: { module: tonemapModule, entryPoint: "vsMain" },
      fragment: {
        module: tonemapModule,
        entryPoint: "fsMain",
        targets: [{ format: this.format }],
      },
      primitive: { topology: "triangle-list" },
    });
    this.linearSampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
  }

  private createSceneBuffers(): void {
    const vertexData = this.scene.vertices;
    this.vertexBuffer = this.device.createBuffer({
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(
      this.vertexBuffer, 0, vertexData.buffer as ArrayBuffer, vertexData.byteOffset, vertexData.byteLength,
    );
    this.indexBuffer = this.device.createBuffer({
      size: this.scene.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(
      this.indexBuffer, 0, this.scene.indices.buffer as ArrayBuffer,
      this.scene.indices.byteOffset, this.scene.indices.byteLength,
    );
    this.indexCount = this.scene.indices.length;

    const lightData = new Float32Array(this.scene.lights.length * 8);
    for (let i = 0; i < this.scene.lights.length; i++) {
      const light = this.scene.lights[i];
      lightData.set([...light.position, light.range, ...light.color, light.intensity * 2.8], i * 8);
    }
    this.lightBuffer = this.device.createBuffer({
      size: lightData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.lightBuffer, 0, lightData);

    const occluderData = new Float32Array(this.scene.occluders.length * 8);
    for (let i = 0; i < this.scene.occluders.length; i++) {
      const box = this.scene.occluders[i];
      occluderData.set([...box.min, 0, ...box.max, 0], i * 8);
    }
    this.occluderBuffer = this.device.createBuffer({
      size: occluderData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.occluderBuffer, 0, occluderData);
    const lightGrid = this.buildLightGrid();
    this.lightGridBuffer = this.device.createBuffer({
      label: "Local light candidate grid",
      size: lightGrid.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(
      this.lightGridBuffer, 0, lightGrid.buffer as ArrayBuffer, lightGrid.byteOffset, lightGrid.byteLength,
    );
    this.uniformBuffer = this.device.createBuffer({
      size: UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.statsBuffer = this.device.createBuffer({
      size: STATS_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    this.statsCapture = this.device.createBuffer({
      size: STATS_BYTES,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
  }

  private buildLightGrid(): Uint32Array {
    const cells = LIGHT_GRID_DIM * LIGHT_GRID_DIM;
    const grid = new Uint32Array(cells * LIGHT_GRID_K);
    grid.fill(0xffffffff);
    for (let gz = 0; gz < LIGHT_GRID_DIM; gz++) {
      for (let gx = 0; gx < LIGHT_GRID_DIM; gx++) {
        const centerX = -40 + (gx + 0.5) / LIGHT_GRID_DIM * 80;
        const centerZ = -40 + (gz + 0.5) / LIGHT_GRID_DIM * 80;
        const indices = this.scene.lights.map((light, index) => {
          const dx = light.position[0] - centerX;
          const dz = light.position[2] - centerZ;
          const heightPenalty = Math.abs(light.position[1] - 4.5) * 0.9;
          return { index, distance: Math.hypot(dx, dz) + heightPenalty };
        });
        indices.sort((a, b) => a.distance - b.distance);
        const base = (gz * LIGHT_GRID_DIM + gx) * LIGHT_GRID_K;
        for (let i = 0; i < LIGHT_GRID_K && i < indices.length; i++) {
          grid[base + i] = indices[i].index;
        }
      }
    }
    return grid;
  }

  resize(force = false): void {
    if (!this.device) return;
    const cssWidth = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const cssHeight = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    let targetWidth = this.resolutionOverride?.[0] ?? Math.min(1120, Math.round(cssWidth));
    let targetHeight = this.resolutionOverride?.[1] ??
      Math.max(1, Math.round(targetWidth * cssHeight / cssWidth));
    targetWidth = Math.max(64, targetWidth);
    targetHeight = Math.max(64, targetHeight);
    if (!force && targetWidth === this.width && targetHeight === this.height) {
      return;
    }
    this.width = targetWidth;
    this.height = targetHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "opaque",
    });

    for (const set of this.gbufferSets) {
      set.position.destroy();
      set.normal.destroy();
      set.albedo.destroy();
      set.emission.destroy();
    }
    this.depthTexture?.destroy();
    this.hdrTexture?.destroy();
    this.referenceTexture?.destroy();
    this.denoiseTexture?.destroy();
    for (const buffer of this.reservoirBuffers) buffer.destroy();
    this.temporalBuffer?.destroy();

    this.gbufferSets = [this.createGbufferSet(), this.createGbufferSet()];
    this.depthTexture = this.device.createTexture({
      label: "Depth",
      size: [this.width, this.height],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.hdrTexture = this.createStorageTexture("ReSTIR HDR");
    this.referenceTexture = this.createStorageTexture("Reference HDR");
    this.denoiseTexture = this.createStorageTexture("Filtered ReSTIR HDR");
    const reservoirSize = this.width * this.height * RESERVOIR_BYTES;
    this.reservoirBuffers = [0, 1].map((index) =>
      this.device.createBuffer({
        label: `Reservoir history ${index}`,
        size: reservoirSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      }),
    );
    this.temporalBuffer = this.device.createBuffer({
      label: "Temporal reservoir",
      size: reservoirSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    this.frameSlot = 0;
    this.historyValid = false;
    this.referenceDirty = true;
    this.referenceSampled = false;
    this.buildBindGroups();
  }

  private createGbufferSet(): GpuTextureSet {
    const create = (label: string): GPUTexture => this.device.createTexture({
      label,
      size: [this.width, this.height],
      format: "rgba16float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    return {
      position: create("G-buffer position"),
      normal: create("G-buffer normal"),
      albedo: create("G-buffer albedo"),
      emission: create("G-buffer emission"),
    };
  }

  private createStorageTexture(label: string): GPUTexture {
    return this.device.createTexture({
      label,
      size: [this.width, this.height],
      format: "rgba16float",
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  private buildBindGroups(): void {
    const statsEntry: GPUBindGroupEntry = { binding: 13, resource: { buffer: this.statsBuffer } };
    this.restirBindGroups = [0, 1].map((slot) => {
      const current = this.gbufferSets[slot];
      const previous = this.gbufferSets[1 - slot];
      return this.device.createBindGroup({
        label: `ReSTIR bind group ${slot}`,
        layout: this.restirLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: current.position.createView() },
          { binding: 2, resource: current.normal.createView() },
          { binding: 3, resource: current.albedo.createView() },
          { binding: 4, resource: current.emission.createView() },
          { binding: 5, resource: previous.position.createView() },
          { binding: 6, resource: previous.normal.createView() },
          { binding: 7, resource: { buffer: this.lightBuffer } },
          { binding: 8, resource: { buffer: this.occluderBuffer } },
          { binding: 9, resource: { buffer: this.reservoirBuffers[1 - slot] } },
          { binding: 10, resource: { buffer: this.temporalBuffer } },
          { binding: 11, resource: { buffer: this.reservoirBuffers[slot] } },
          { binding: 12, resource: this.hdrTexture.createView() },
          statsEntry,
          { binding: 14, resource: { buffer: this.lightGridBuffer } },
        ],
      });
    });
    this.referenceBindGroups = [0, 1].map((slot) => {
      const current = this.gbufferSets[slot];
      return this.device.createBindGroup({
        label: `Reference bind group ${slot}`,
        layout: this.referenceLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: current.position.createView() },
          { binding: 2, resource: current.normal.createView() },
          { binding: 3, resource: current.albedo.createView() },
          { binding: 4, resource: current.emission.createView() },
          { binding: 5, resource: { buffer: this.lightBuffer } },
          { binding: 6, resource: { buffer: this.occluderBuffer } },
          { binding: 7, resource: this.referenceTexture.createView() },
        ],
      });
    });

    const compareFrameGroup = this.device.createBindGroup({
      layout: this.compareFrameLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
    this.compareBindGroup = compareFrameGroup;
    this.tonemapBindGroup = this.device.createBindGroup({
      layout: this.tonemapLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.denoiseTexture.createView() },
        { binding: 2, resource: this.referenceTexture.createView() },
        { binding: 3, resource: this.linearSampler },
      ],
    });
    this.rasterBindGroup = this.device.createBindGroup({
      layout: this.rasterPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
    this.compareDataBindGroup = this.createCompareDataGroup();
    this.denoiseBindGroups = [0, 1].map((slot) => this.device.createBindGroup({
      layout: this.denoiseLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.gbufferSets[slot].position.createView() },
        { binding: 2, resource: this.gbufferSets[slot].normal.createView() },
        { binding: 3, resource: this.hdrTexture.createView() },
        { binding: 4, resource: this.denoiseTexture.createView() },
      ],
    }));
  }

  private createCompareDataGroup(): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.compareDataLayout,
      entries: [
        { binding: 0, resource: this.hdrTexture.createView() },
        { binding: 1, resource: this.referenceTexture.createView() },
        { binding: 2, resource: { buffer: this.statsBuffer } },
      ],
    });
  }

  private cameraAt(time: number): { eye: Vec3; target: Vec3 } {
    const angle = -2.62 + time * 0.11;
    const radiusX = 42.5 + Math.sin(time * 0.067) * 2.6;
    const radiusZ = 46.5 + Math.cos(time * 0.051) * 2.8;
    return {
      eye: [
        Math.cos(angle) * radiusX,
        6.1 + Math.sin(time * 0.19) * 0.68,
        Math.sin(angle) * radiusZ,
      ],
      target: [0, 2.15, 0],
    };
  }

  private writeUniforms(deltaSeconds: number): { viewProjection: Float32Array } {
    const { eye, target } = this.cameraAt(this.cameraPathTime);
    const aspect = this.width / this.height;
    const projection = perspective(46 * Math.PI / 180, aspect, 0.12, 210);
    const view = lookAt(eye, target, [0, 1, 0]);
    const viewProjection = multiply(projection, view);
    const forward = normalize(subtract(target, eye));
    const data = new ArrayBuffer(UNIFORM_FLOATS * 4);
    const floats = new Float32Array(data);
    const integers = new Uint32Array(data);
    floats.set(view, 0);
    floats.set(projection, 16);
    floats.set([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ], 32);
    floats.set(this.previousViewProjection, 48);
    floats.set([eye[0], eye[1], eye[2], 1], 64);
    floats.set([forward[0], forward[1], forward[2], 0], 68);
    floats.set([this.width, this.height], 72);
    floats[74] = 1.22;
    floats[75] = this.cameraPathTime + deltaSeconds;
    integers[76] = this.frameIndex;
    integers[77] = this.scene.lights.length;
    integers[78] = this.historyCap;
    integers[79] = this.mode;
    integers[80] = this.spatial ? 1 : 0;
    integers[81] = (this.frameIndex * 747796405 + 2891336453) >>> 0;
    floats[82] = 1;
    integers[83] = this.historyValid ? 1 : 0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    return { viewProjection };
  }

  private dispatchCompute(
    encoder: GPUCommandEncoder,
    pipeline: GPUComputePipeline,
    bindGroup: GPUBindGroup,
  ): void {
    const pass = encoder.beginComputePass({ label: pipeline.label });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8));
    pass.end();
  }

  tick(deltaSeconds: number): void {
    if (!this.ready || this.manual) return;
    const delta = Math.min(Math.max(deltaSeconds, 0), 0.1);
    if (!this.paused) {
      this.cameraPathTime += delta;
    }
    this.renderFrame(delta);
    if (!this.statsPending && performance.now() - this.lastTimestamp > 180) {
      this.lastTimestamp = performance.now();
      void this.refreshStats();
    }
  }

  private renderFrame(deltaSeconds: number): void {
    if (!this.ready) return;
    const started = performance.now();
    const slot = this.frameSlot;
    const restirGroup = this.restirBindGroups[slot];
    const { viewProjection } = this.writeUniforms(deltaSeconds);
    const encoder = this.device.createCommandEncoder({ label: `Frame ${this.frameIndex}` });
    encoder.clearBuffer(this.statsBuffer);
    const current = this.gbufferSets[slot];
    const renderPass = encoder.beginRenderPass({
      label: "G-buffer raster",
      colorAttachments: [
        {
          view: current.position.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
        {
          view: current.normal.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
        {
          view: current.albedo.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
        {
          view: current.emission.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    renderPass.setPipeline(this.rasterPipeline);
    renderPass.setBindGroup(0, this.rasterBindGroup);
    renderPass.setVertexBuffer(0, this.vertexBuffer);
    renderPass.setIndexBuffer(this.indexBuffer, "uint32");
    renderPass.drawIndexed(this.indexCount);
    renderPass.end();

    this.dispatchCompute(encoder, this.temporalPipeline, restirGroup);
    this.dispatchCompute(encoder, this.spatialPipeline, restirGroup);
    this.dispatchCompute(encoder, this.shadePipeline, restirGroup);
    this.dispatchCompute(encoder, this.denoisePipeline, this.denoiseBindGroups[slot]);

    var sampledReference = false;
    if ((this.mode === 1 || this.mode === 2) && this.referenceDirty) {
      this.dispatchCompute(encoder, this.referencePipeline, this.referenceBindGroups[slot]);
      const comparePass = encoder.beginComputePass({ label: "Reference comparison" });
      comparePass.setPipeline(this.comparePipeline);
      comparePass.setBindGroup(0, this.compareBindGroup);
      comparePass.setBindGroup(1, this.compareDataBindGroup);
      comparePass.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8));
      comparePass.end();
      sampledReference = true;
    }

    const compositePass = encoder.beginRenderPass({
      label: "ACES composite",
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.01, g: 0.014, b: 0.016, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    compositePass.setPipeline(this.tonemapPipeline);
    compositePass.setBindGroup(0, this.tonemapBindGroup);
    compositePass.draw(3);
    compositePass.end();
    this.device.queue.submit([encoder.finish()]);

    this.historyValid = true;
    this.previousViewProjection = viewProjection;
    this.frameSlot = 1 - slot;
    this.frameIndex += 1;
    if (sampledReference) {
      this.referenceDirty = false;
      this.referenceSampled = true;
    }
    this.latestStats.gpuTimeMs = performance.now() - started;
  }

  private async refreshStats(): Promise<StatsSnapshot> {
    if (!this.ready) return this.latestStats;
    if (this.statsPromise) return this.statsPromise;
    this.statsPending = true;
    const encoder = this.device.createCommandEncoder({ label: "Stats readback" });
    encoder.copyBufferToBuffer(this.statsBuffer, 0, this.statsCapture, 0, STATS_BYTES);
    this.device.queue.submit([encoder.finish()]);
    this.statsPromise = (async () => {
      await this.statsCapture.mapAsync(GPUMapMode.READ);
      const values = new Uint32Array(this.statsCapture.getMappedRange().slice(0));
      this.statsCapture.unmap();
      const attempts = values[0] + values[3];
      const accepts = values[1] + values[4];
      const valid = Math.max(values[5], 1);
      const referenceCount = Math.max(values[9], 1);
      this.latestStats = {
        frame: this.frameIndex,
        lightCount: this.scene.lights.length,
        acceptRate: attempts > 0 ? accepts / attempts : 0,
        historyRejectRate: values[0] > 0 ? values[2] / values[0] : 0,
        meanWeight: values[6] / 128 / valid,
        meanLuminance: values[7] / 256 / valid,
        referenceError: values[9] > 0 ? values[8] / 1000 / referenceCount : 0,
        validPixels: values[5],
        temporalAttempts: values[0],
        spatialAttempts: values[3],
        gpuTimeMs: this.latestStats.gpuTimeMs,
      };
      this.uiStatsHandler?.(this.latestStats);
      return this.latestStats;
    })().finally(() => {
      this.statsPending = false;
      this.statsPromise = null;
    });
    return this.statsPromise;
  }

  snapshot(): PublicSnapshot {
    return {
      ...this.latestStats,
      ready: this.ready,
      mode: this.mode,
      spatial: this.spatial,
      historyCap: this.historyCap,
      paused: this.paused,
      pathTime: this.cameraPathTime,
      triangleCount: this.scene.triangleCount,
      referenceSampled: this.referenceSampled,
    };
  }

  setMode(mode: number): void {
    this.mode = Math.max(0, Math.min(3, Math.floor(mode)));
    if (this.mode === 1 || this.mode === 2) {
      this.referenceDirty = true;
      this.paused = true;
    }
  }

  setSpatial(enabled: boolean): void {
    this.spatial = enabled;
  }

  setHistoryCap(size: number): void {
    this.historyCap = Math.max(1, Math.min(128, Math.round(size)));
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setPathTime(seconds: number): void {
    const next = Math.max(0, seconds);
    if (Math.abs(next - this.cameraPathTime) > 1e-5) {
      this.referenceDirty = true;
      this.referenceSampled = false;
    }
    this.cameraPathTime = next;
  }

  resetHistory(): void {
    this.historyValid = false;
  }

  requestReference(): void {
    this.referenceDirty = true;
    this.referenceSampled = false;
  }

  setManual(manual: boolean): void {
    this.manual = manual;
  }

  async step(deltaSeconds = 1 / 60, frameCount = 1): Promise<PublicSnapshot> {
    const count = Math.max(1, Math.floor(frameCount));
    const delta = Math.max(0, deltaSeconds);
    for (let i = 0; i < count; i++) {
      this.cameraPathTime += delta;
      if (this.mode === 1 || this.mode === 2) {
        this.referenceDirty = true;
      }
      this.renderFrame(delta);
    }
    await this.device.queue.onSubmittedWorkDone();
    await this.refreshStats();
    return this.snapshot();
  }
}
