import backgroundShader from "./shaders/background.wgsl?raw";
import cullShader from "./shaders/cull.wgsl?raw";
import sceneShader from "./shaders/scene.wgsl?raw";
import type { CameraSnapshot } from "./camera";
import { ERROR_THRESHOLD_PX } from "./camera";
import type { BuiltScene } from "./geometry/build";
import { INDICES_PER_CLUSTER } from "./geometry/types";
import {
  CLUSTER_STRIDE_BYTES,
  FRAME_UNIFORM_BYTES,
  PAGE_META_STRIDE_BYTES,
  packClusters,
  packFrame,
  packPageMetas,
} from "./gpu/packing";
import { invertMat4 } from "./math";
import { gpuView } from "./gpu/write";
import {
  PAGE_INDEX_STRIDE,
  PAGE_VERTEX_STRIDE,
  PageStore,
  SLOT_COUNT,
} from "./page-store";

export const STATIC_INDEX_BASE = 936960;
export const STATIC_VERTEX_BASE = 180560;
export const STATS_BYTES = 48;

export interface GpuCapture {
  drawArgs: number[];
  stats: number[];
  visible: number[];
  adapterInfo: string;
}

export class Renderer {
  readonly device: GPUDevice;
  readonly scene: BuiltScene;
  readonly pageStore: PageStore;
  readonly adapterInfo: string;
  readonly context: GPUCanvasContext;
  readonly canvas: HTMLCanvasElement;
  readonly format: GPUTextureFormat;
  readonly visibleCapacity: number;
  private readonly computePipeline: GPUComputePipeline;
  private readonly scenePipeline: GPURenderPipeline;
  private readonly backgroundPipeline: GPURenderPipeline;
  private readonly frameBuffer: GPUBuffer;
  private readonly clusterBuffer: GPUBuffer;
  private readonly pageMetaBuffer: GPUBuffer;
  private readonly indexBuffer: GPUBuffer;
  private readonly vertexBuffer: GPUBuffer;
  private readonly visibleBuffer: GPUBuffer;
  private readonly statsBuffer: GPUBuffer;
  private readonly drawArgsBuffer: GPUBuffer;
  private readonly computeBindGroup: GPUBindGroup;
  private readonly sceneBindGroup: GPUBindGroup;
  private readonly backgroundBindGroup: GPUBindGroup;
  private depthTexture: GPUTexture | null = null;
  private mode = 0;
  private lastCamera: CameraSnapshot | null = null;
  private lastSlots: Uint32Array | null = null;
  private width = 1;
  private height = 1;
  private renderedFrames = 0;

  private constructor(
    canvas: HTMLCanvasElement,
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    scene: BuiltScene,
    adapterInfo: string,
    pipelines: {
      compute: GPUComputePipeline;
      scene: GPURenderPipeline;
      background: GPURenderPipeline;
    },
  ) {
    this.canvas = canvas;
    this.device = device;
    this.context = context;
    this.format = format;
    this.scene = scene;
    this.adapterInfo = adapterInfo;
    this.computePipeline = pipelines.compute;
    this.scenePipeline = pipelines.scene;
    this.backgroundPipeline = pipelines.background;
    this.visibleCapacity = scene.clusters.length;
    if (scene.staticIndexCount !== STATIC_INDEX_BASE || scene.staticVertexCount !== STATIC_VERTEX_BASE) {
      throw new Error("shader static geometry constants do not match scene layout");
    }

    const totalIndices = scene.staticIndexCount + SLOT_COUNT * PAGE_INDEX_STRIDE;
    const totalVertices = scene.staticVertexCount + SLOT_COUNT * PAGE_VERTEX_STRIDE;
    this.indexBuffer = device.createBuffer({
      label: "unified-index-pages",
      size: totalIndices * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.vertexBuffer = device.createBuffer({
      label: "unified-vertex-pages",
      size: totalVertices * 8 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.indexBuffer, 0, gpuView(scene.staticIndices));
    device.queue.writeBuffer(this.vertexBuffer, 0, gpuView(scene.staticVertices));

    this.frameBuffer = device.createBuffer({
      label: "frame-uniforms",
      size: FRAME_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.clusterBuffer = device.createBuffer({
      label: "meshlet-metadata",
      size: scene.clusters.length * CLUSTER_STRIDE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.pageMetaBuffer = device.createBuffer({
      label: "page-metadata",
      size: scene.pageMetas.length * PAGE_META_STRIDE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.visibleBuffer = device.createBuffer({
      label: "visible-cluster-list",
      size: scene.clusters.length * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.statsBuffer = device.createBuffer({
      label: "cull-stats",
      size: STATS_BYTES,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });
    this.drawArgsBuffer = device.createBuffer({
      label: "indirect-draw-args",
      size: 16,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.INDIRECT |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.clusterBuffer, 0, gpuView(packClusters(scene)));
    device.queue.writeBuffer(this.pageMetaBuffer, 0, gpuView(packPageMetas(scene)));

    this.pageStore = new PageStore(device, scene, this.indexBuffer, this.vertexBuffer);
    this.computeBindGroup = device.createBindGroup({
      label: "compute-cull-bind-group",
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.frameBuffer } },
        { binding: 1, resource: { buffer: this.clusterBuffer } },
        { binding: 2, resource: { buffer: this.pageMetaBuffer } },
        { binding: 3, resource: { buffer: this.pageStore.residentSlotsBuffer } },
        { binding: 4, resource: { buffer: this.visibleBuffer } },
        { binding: 5, resource: { buffer: this.statsBuffer } },
        { binding: 6, resource: { buffer: this.drawArgsBuffer } },
      ],
    });
    this.sceneBindGroup = device.createBindGroup({
      label: "scene-bind-group",
      layout: this.scenePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.frameBuffer } },
        { binding: 1, resource: { buffer: this.clusterBuffer } },
        { binding: 2, resource: { buffer: this.pageStore.residentSlotsBuffer } },
        { binding: 3, resource: { buffer: this.indexBuffer } },
        { binding: 4, resource: { buffer: this.vertexBuffer } },
        { binding: 5, resource: { buffer: this.visibleBuffer } },
      ],
    });
    this.backgroundBindGroup = device.createBindGroup({
      label: "background-bind-group",
      layout: this.backgroundPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.frameBuffer } }],
    });
  }

  static async create(canvas: HTMLCanvasElement, scene: BuiltScene): Promise<Renderer> {
    if (!navigator.gpu) throw new Error("WebGPU is unavailable in this browser");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No WebGPU adapter found");
    const device = await adapter.requestDevice({ label: "coastal-cliff-vgeo-device" });
    device.lost.then((info) => {
      console.error("WebGPU device lost:", info.reason, info.message);
    });
    device.addEventListener("uncapturederror", (event) => {
      console.error("WebGPU validation error:", (event as GPUUncapturedErrorEvent).error.message);
    });
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("Could not create WebGPU canvas context");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format,
      alphaMode: "opaque",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
    const adapterInfo = info
      ? `${info.vendor || "unknown"} / ${info.architecture || "unknown"} / ${info.description || "WebGPU"}`
      : "WebGPU adapter";

    const computeModule = device.createShaderModule({ label: "meshlet-cull", code: cullShader });
    const sceneModule = device.createShaderModule({ label: "meshlet-scene", code: sceneShader });
    const backgroundModule = device.createShaderModule({
      label: "procedural-background",
      code: backgroundShader,
    });
    const [compute, scenePipeline, backgroundPipeline] = await Promise.all([
      device.createComputePipelineAsync({
        label: "meshlet-cull-pipeline",
        layout: "auto",
        compute: { module: computeModule, entryPoint: "main" },
      }),
      device.createRenderPipelineAsync({
        label: "meshlet-render-pipeline",
        layout: "auto",
        vertex: { module: sceneModule, entryPoint: "vs_main" },
        fragment: {
          module: sceneModule,
          entryPoint: "fs_main",
          targets: [{ format }],
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: {
          format: "depth32float",
          depthWriteEnabled: true,
          depthCompare: "less",
        },
      }),
      device.createRenderPipelineAsync({
        label: "background-pipeline",
        layout: "auto",
        vertex: { module: backgroundModule, entryPoint: "vs_main" },
        fragment: {
          module: backgroundModule,
          entryPoint: "fs_main",
          targets: [{ format }],
        },
        primitive: { topology: "triangle-list" },
        depthStencil: {
          format: "depth32float",
          depthWriteEnabled: false,
          depthCompare: "always",
        },
      }),
    ]);
    return new Renderer(canvas, device, context, format, scene, adapterInfo, {
      compute,
      scene: scenePipeline,
      background: backgroundPipeline,
    });
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this.width && h === this.height && this.depthTexture) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.depthTexture?.destroy();
    this.depthTexture = this.device.createTexture({
      label: "scene-depth",
      size: { width: w, height: h },
      format: "depth32float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  setMode(mode: number): void {
    this.mode = mode;
  }

  render(camera: CameraSnapshot, loadBudget = 8): void {
    this.submitFrame(camera, loadBudget);
  }

  async renderAndCaptureImage(camera: CameraSnapshot, loadBudget = 0): Promise<string> {
    this.resize(camera.width, camera.height);
    const bytesPerRow = Math.ceil((camera.width * 4) / 256) * 256;
    const staging = this.device.createBuffer({
      label: "frame-image-staging",
      size: bytesPerRow * camera.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    this.submitFrame(camera, loadBudget, { buffer: staging, bytesPerRow });
    await staging.mapAsync(GPUMapMode.READ);
    const source = new Uint8Array(staging.getMappedRange());
    const pixels = new Uint8ClampedArray(camera.width * camera.height * 4);
    const bgra = this.format === "bgra8unorm";
    for (let y = 0; y < camera.height; y++) {
      const row = y * bytesPerRow;
      const out = y * camera.width * 4;
      for (let x = 0; x < camera.width; x++) {
        const src = row + x * 4;
        const dst = out + x * 4;
        if (bgra) {
          pixels[dst] = source[src + 2]!;
          pixels[dst + 1] = source[src + 1]!;
          pixels[dst + 2] = source[src]!;
        } else {
          pixels[dst] = source[src]!;
          pixels[dst + 1] = source[src + 1]!;
          pixels[dst + 2] = source[src + 2]!;
        }
        pixels[dst + 3] = 255;
      }
    }
    staging.unmap();
    staging.destroy();
    const offscreen = new OffscreenCanvas(camera.width, camera.height);
    const ctx = offscreen.getContext("2d");
    if (!ctx) throw new Error("Could not create 2D readback canvas");
    ctx.putImageData(new ImageData(pixels, camera.width, camera.height), 0, 0);
    const blob = await offscreen.convertToBlob({ type: "image/png" });
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  private submitFrame(
    camera: CameraSnapshot,
    loadBudget: number,
    capture?: { buffer: GPUBuffer; bytesPerRow: number },
  ): void {
    this.resize(camera.width, camera.height);
    this.pageStore.update(camera, ERROR_THRESHOLD_PX, loadBudget);
    const frameData = packFrame(
      camera,
      invertMat4(camera.viewProj),
      this.mode,
      this.scene.clusters.length,
      this.scene.pages.length,
      ERROR_THRESHOLD_PX,
      this.visibleCapacity,
    );
    this.device.queue.writeBuffer(this.frameBuffer, 0, gpuView(frameData));
    this.device.queue.writeBuffer(this.statsBuffer, 0, gpuView(new Uint32Array(12)));
    this.device.queue.writeBuffer(
      this.drawArgsBuffer,
      0,
      gpuView(new Uint32Array([INDICES_PER_CLUSTER, 0, 0, 0])),
    );

    const encoder = this.device.createCommandEncoder({ label: "frame-encoder" });
    const computePass = encoder.beginComputePass({ label: "meshlet-cull-pass" });
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.computeBindGroup);
    computePass.dispatchWorkgroups(Math.ceil(this.scene.clusters.length / 64));
    computePass.end();

    const colorTexture = this.context.getCurrentTexture();
    const renderPass = encoder.beginRenderPass({
      label: "scene-pass",
      colorAttachments: [
        {
          view: colorTexture.createView(),
          clearValue: { r: 0.53, g: 0.67, b: 0.73, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: this.depthTexture!.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    renderPass.setPipeline(this.backgroundPipeline);
    renderPass.setBindGroup(0, this.backgroundBindGroup);
    renderPass.draw(3);
    renderPass.setPipeline(this.scenePipeline);
    renderPass.setBindGroup(0, this.sceneBindGroup);
    renderPass.drawIndirect(this.drawArgsBuffer, 0);
    renderPass.end();
    if (capture) {
      encoder.copyTextureToBuffer(
        { texture: colorTexture },
        { buffer: capture.buffer, bytesPerRow: capture.bytesPerRow },
        { width: camera.width, height: camera.height, depthOrArrayLayers: 1 },
      );
    }
    this.device.queue.submit([encoder.finish()]);
    this.lastCamera = camera;
    this.lastSlots = Uint32Array.from(this.pageStore.slots);
    this.renderedFrames++;
  }

  getLastFrameContext(): { camera: CameraSnapshot; residentSlots: Uint32Array } {
    if (!this.lastCamera || !this.lastSlots) throw new Error("No frame has been rendered");
    return { camera: this.lastCamera, residentSlots: this.lastSlots };
  }

  async captureGpuState(): Promise<GpuCapture> {
    const totalBytes = 64 + this.visibleCapacity * 4;
    const staging = this.device.createBuffer({
      label: "gpu-capture-staging",
      size: totalBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder({ label: "gpu-capture-encoder" });
    encoder.copyBufferToBuffer(this.statsBuffer, 0, staging, 0, STATS_BYTES);
    encoder.copyBufferToBuffer(this.drawArgsBuffer, 0, staging, STATS_BYTES, 16);
    encoder.copyBufferToBuffer(
      this.visibleBuffer,
      0,
      staging,
      64,
      this.visibleCapacity * 4,
    );
    this.device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    try {
      const range = new Uint8Array(staging.getMappedRange());
      const stats = Array.from(new Uint32Array(range.buffer, 0, 12));
      const drawArgs = Array.from(new Uint32Array(range.buffer, STATS_BYTES, 4));
      const count = Math.min(drawArgs[1]!, this.visibleCapacity);
      const visible = Array.from(new Uint32Array(range.buffer, 64, count));
      return { drawArgs, stats, visible, adapterInfo: this.adapterInfo };
    } finally {
      staging.unmap();
      staging.destroy();
    }
  }

  get frameCount(): number {
    return this.renderedFrames;
  }

  get currentMode(): number {
    return this.mode;
  }
}
