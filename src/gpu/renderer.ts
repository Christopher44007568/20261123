// WebGPU renderer: instanced mesh pipeline + debug line pipeline.

import { MESH_WGSL, LINE_WGSL } from "./wgsl.ts";
import type { MeshData, LineData } from "./geometry.ts";

export interface GpuMesh {
  positions: GPUBuffer;
  normals: GPUBuffer;
  indices: GPUBuffer;
  indexCount: number;
}

export interface GpuLines {
  positions: GPUBuffer;
  colors: GPUBuffer;
  vertexCount: number;
}

const INSTANCE_FLOATS = 20; // mat4 (16) + color (4)
const MAX_INSTANCES = 4096;
const MAX_LINE_VERTS = 65536;

export class Renderer {
  device!: GPUDevice;
  context!: GPUCanvasContext;
  format!: GPUTextureFormat;
  depthTexture: GPUTexture | null = null;
  depth!: GPUTextureView;
  meshPipeline!: GPURenderPipeline;
  linePipeline!: GPURenderPipeline;
  uniformBuffer!: GPUBuffer;
  bindGroup!: GPUBindGroup;
  instanceBuffer!: GPUBuffer;
  linePosBuffer!: GPUBuffer;
  lineColorBuffer!: GPUBuffer;
  canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async init(): Promise<void> {
    if (!navigator.gpu) throw new Error("WebGPU not supported");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter");
    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext("webgpu") as GPUCanvasContext;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "opaque",
    });

    this.uniformBuffer = this.device.createBuffer({
      size: 16 * 4 + 16 + 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.instanceBuffer = this.device.createBuffer({
      size: MAX_INSTANCES * INSTANCE_FLOATS * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.linePosBuffer = this.device.createBuffer({
      size: MAX_LINE_VERTS * 3 * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.lineColorBuffer = this.device.createBuffer({
      size: MAX_LINE_VERTS * 4 * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    const layout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });
    this.bindGroup = this.device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [layout],
    });

    const meshModule = this.device.createShaderModule({ code: MESH_WGSL });
    this.meshPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: meshModule,
        entryPoint: "vsMain",
        buffers: [
          {
            arrayStride: 12,
            attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
          },
          {
            arrayStride: 12,
            attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }],
          },
          {
            arrayStride: INSTANCE_FLOATS * 4,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 2, offset: 0, format: "float32x4" },
              { shaderLocation: 3, offset: 16, format: "float32x4" },
              { shaderLocation: 4, offset: 32, format: "float32x4" },
              { shaderLocation: 5, offset: 48, format: "float32x4" },
              { shaderLocation: 6, offset: 64, format: "float32x4" },
            ],
          },
        ],
      },
      fragment: {
        module: meshModule,
        entryPoint: "fsMain",
        targets: [{ format: this.format }],
      },
      primitive: { topology: "triangle-list", cullMode: "back" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });

    const lineModule = this.device.createShaderModule({ code: LINE_WGSL });
    this.linePipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: lineModule,
        entryPoint: "vsMain",
        buffers: [
          {
            arrayStride: 12,
            attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
          },
          {
            arrayStride: 16,
            attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }],
          },
        ],
      },
      fragment: {
        module: lineModule,
        entryPoint: "fsMain",
        targets: [{ format: this.format }],
      },
      primitive: { topology: "line-list" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: false,
        depthCompare: "less-equal",
      },
    });

    this.resize();
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth * devicePixelRatio);
    const h = Math.max(1, this.canvas.clientHeight * devicePixelRatio);
    this.canvas.width = w;
    this.canvas.height = h;
    this.depthTexture?.destroy();
    this.depthTexture = this.device.createTexture({
      size: { width: w, height: h },
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depth = this.depthTexture.createView();
  }

  uploadMesh(mesh: MeshData): GpuMesh {
    const mk = (
      data: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>,
      usage: number,
    ): GPUBuffer => {
      const buf = this.device.createBuffer({
        size: Math.max(4, data.byteLength),
        usage,
        mappedAtCreation: true,
      });
      const arr = buf.getMappedRange();
      if (data instanceof Float32Array) new Float32Array(arr).set(data);
      else new Uint32Array(arr).set(data);
      buf.unmap();
      return buf;
    };
    return {
      positions: mk(mesh.positions, GPUBufferUsage.VERTEX),
      normals: mk(mesh.normals, GPUBufferUsage.VERTEX),
      indices: mk(mesh.indices, GPUBufferUsage.INDEX),
      indexCount: mesh.indices.length,
    };
  }

  uploadLinesStatic(lines: LineData): GpuLines {
    const mk = (data: Float32Array<ArrayBuffer>): GPUBuffer => {
      const buf = this.device.createBuffer({
        size: Math.max(4, data.byteLength),
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
      });
      new Float32Array(buf.getMappedRange()).set(data);
      buf.unmap();
      return buf;
    };
    return {
      positions: mk(lines.positions),
      colors: mk(lines.colors),
      vertexCount: lines.positions.length / 3,
    };
  }

  /** Write dynamic horizon-circle lines into the shared dynamic buffers. */
  writeDynamicLines(lines: LineData): number {
    const count = Math.min(MAX_LINE_VERTS, lines.positions.length / 3);
    this.device.queue.writeBuffer(this.linePosBuffer, 0, lines.positions, 0, count * 3);
    this.device.queue.writeBuffer(this.lineColorBuffer, 0, lines.colors, 0, count * 4);
    return count;
  }

  /** Write instance data; returns instance count. */
  writeInstances(data: Float32Array<ArrayBuffer>): number {
    const count = Math.min(MAX_INSTANCES, data.length / INSTANCE_FLOATS);
    this.device.queue.writeBuffer(this.instanceBuffer, 0, data, 0, count * INSTANCE_FLOATS);
    return count;
  }

  writeCamera(viewProj: Float32Array<ArrayBuffer>, sunDir: number[], eye: number[]): void {
    const data = new Float32Array(24) as Float32Array<ArrayBuffer>;
    data.set(viewProj, 0);
    data.set(sunDir, 16);
    data.set(eye, 20);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  /** One frame: terrain mesh, instanced objects, optional debug lines. */
  render(
    terrain: GpuMesh,
    terrainInstanceOffset: number,
    cube: GpuMesh,
    objectInstanceOffset: number,
    objectInstanceCount: number,
    debugSphere: GpuLines | null,
    horizonLineVerts: number,
  ): void {
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: "clear",
          clearValue: { r: 0.02, g: 0.02, b: 0.03, a: 1 },
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: this.depth,
        depthLoadOp: "clear",
        depthClearValue: 1,
        depthStoreOp: "store",
      },
    });

    pass.setBindGroup(0, this.bindGroup);

    // terrain (1 instance at offset 0)
    pass.setPipeline(this.meshPipeline);
    pass.setVertexBuffer(0, terrain.positions);
    pass.setVertexBuffer(1, terrain.normals);
    pass.setVertexBuffer(2, this.instanceBuffer, terrainInstanceOffset);
    pass.setIndexBuffer(terrain.indices, "uint32");
    pass.drawIndexed(terrain.indexCount, 1);

    // objects (instanced unit cube)
    if (objectInstanceCount > 0) {
      pass.setVertexBuffer(0, cube.positions);
      pass.setVertexBuffer(1, cube.normals);
      pass.setVertexBuffer(2, this.instanceBuffer, objectInstanceOffset);
      pass.setIndexBuffer(cube.indices, "uint32");
      pass.drawIndexed(cube.indexCount, objectInstanceCount);
    }

    // debug lines
    pass.setPipeline(this.linePipeline);
    if (debugSphere) {
      pass.setVertexBuffer(0, debugSphere.positions);
      pass.setVertexBuffer(1, debugSphere.colors);
      pass.draw(debugSphere.vertexCount);
    }
    if (horizonLineVerts > 0) {
      pass.setVertexBuffer(0, this.linePosBuffer);
      pass.setVertexBuffer(1, this.lineColorBuffer);
      pass.draw(horizonLineVerts);
    }

    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
