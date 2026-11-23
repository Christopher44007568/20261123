import type { CodecId, MapId, MapTexture, ViewMode } from "../types";
import { createProgram, uniformLocation } from "./glUtils";
import {
  backgroundFragmentShader,
  backgroundVertexShader,
  floorFragmentShader,
  floorVertexShader,
  meshFragmentShader,
  meshVertexShader,
  panelFragmentShader,
  panelVertexShader,
} from "./renderShaders";
import { cameraPosition, lookAt, multiply, perspective } from "./math";

interface TextureSet {
  albedo: WebGLTexture;
  normal: WebGLTexture;
  roughness: WebGLTexture;
}

interface CameraState {
  yaw: number;
  pitch: number;
  distance: number;
}

const DEFAULT_CAMERA: CameraState = { yaw: -0.30, pitch: 0.105, distance: 6.25 };
const OBLIQUE_CAMERA: CameraState = { yaw: -0.49, pitch: 0.17, distance: 5.82 };
function createPanelGeometry(): Float32Array {
  const segmentsX = 64;
  const segmentsY = 48;
  const width = 3.16;
  const height = 2.42;
  const radius = 9.0;
  const vertices: number[] = [];

  for (let y = 0; y <= segmentsY; y++) {
    const v = y / segmentsY;
    for (let x = 0; x <= segmentsX; x++) {
      const u = x / segmentsX;
      const px = (u - 0.5) * width;
      const root = Math.sqrt(Math.max(0, radius * radius - px * px));
      const pz = root - radius;
      const dzdx = -px / Math.max(root, 0.0001);
      const tangentLength = Math.hypot(1, dzdx);
      const nx = -dzdx / tangentLength;
      const nz = 1 / tangentLength;
      vertices.push(px, (v - 0.5) * height + 0.08, pz, nx, 0, nz, 1 / tangentLength, 0, dzdx / tangentLength, u, v);
    }
  }

  const indices: number[] = [];
  for (let y = 0; y < segmentsY; y++) {
    for (let x = 0; x < segmentsX; x++) {
      const a = y * (segmentsX + 1) + x;
      const b = a + 1;
      const c = a + segmentsX + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const data = new Float32Array(indices.length * 11);
  let output = 0;
  for (const index of indices) {
    const source = index * 11;
    for (let i = 0; i < 11; i++) data[output++] = vertices[source + i];
  }
  return data;
}

function createFloorGeometry(): Float32Array {
  const y = -1.42;
  return new Float32Array([
    -9, y, 7, 9, y, 7, -9, y, -8,
    -9, y, -8, 9, y, 7, 9, y, -8,
  ]);
}

function createBoxGeometry(
  center: [number, number, number],
  size: [number, number, number],
): Float32Array {
  const [cx, cy, cz] = center;
  const [sx, sy, sz] = size;
  const x0 = cx - sx / 2;
  const x1 = cx + sx / 2;
  const y0 = cy - sy / 2;
  const y1 = cy + sy / 2;
  const z0 = cz - sz / 2;
  const z1 = cz + sz / 2;
  const faces: Array<{
    normal: [number, number, number];
    positions: [number, number, number][];
  }> = [
    {
      normal: [0, 0, 1],
      positions: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    },
    {
      normal: [0, 0, -1],
      positions: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0]],
    },
    {
      normal: [1, 0, 0],
      positions: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y0, z1], [x1, y1, z0], [x1, y1, z1]],
    },
    {
      normal: [-1, 0, 0],
      positions: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y0, z0], [x0, y1, z1], [x0, y1, z0]],
    },
    {
      normal: [0, 1, 0],
      positions: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z1], [x1, y1, z0], [x0, y1, z0]],
    },
    {
      normal: [0, -1, 0],
      positions: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    },
  ];
  const data: number[] = [];
  for (const { normal, positions } of faces) {
    for (const position of positions) {
      data.push(position[0], position[1], position[2], normal[0], normal[1], normal[2]);
    }
  }
  return new Float32Array(data);
}

export class MaterialRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly panelProgram: WebGLProgram;
  private readonly backgroundProgram: WebGLProgram;
  private readonly floorProgram: WebGLProgram;
  private readonly meshProgram: WebGLProgram;
  private readonly emptyVao: WebGLVertexArrayObject;
  private readonly panelVao: WebGLVertexArrayObject;
  private readonly floorVao: WebGLVertexArrayObject;
  private readonly backingVao: WebGLVertexArrayObject;
  private readonly plinthVao: WebGLVertexArrayObject;
  private readonly panelCount: number;
  private readonly panelUniforms: Record<string, WebGLUniformLocation>;
  private readonly floorUniforms: Record<string, WebGLUniformLocation>;
  private readonly meshUniforms: Record<string, WebGLUniformLocation>;
  private rawTextures: TextureSet | null = null;
  private decodedTextures: TextureSet | null = null;
  private viewMode: ViewMode = "raw";
  private heatMap: MapId = "albedo";
  private mip = 0;
  private camera: CameraState = { ...DEFAULT_CAMERA };
  private cameraGoal: CameraState = { ...DEFAULT_CAMERA };
  private cameraAnimation = 0;
  private readonly target: [number, number, number] = [0, -0.02, 0];
  private readonly gpuS3tc: boolean;
  private readonly gpuSrgb: boolean;
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };
  private renderQueued = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      antialias: true,
      alpha: false,
      depth: true,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("当前浏览器不支持 WebGL2");
    this.gl = gl;
    this.gpuS3tc = Boolean(gl.getExtension("WEBGL_compressed_texture_s3tc"));
    this.gpuSrgb = Boolean(gl.getExtension("WEBGL_compressed_texture_s3tc_srgb"));

    this.panelProgram = createProgram(gl, panelVertexShader, panelFragmentShader, "panel");
    this.backgroundProgram = createProgram(gl, backgroundVertexShader, backgroundFragmentShader, "background");
    this.floorProgram = createProgram(gl, floorVertexShader, floorFragmentShader, "floor");
    this.meshProgram = createProgram(gl, meshVertexShader, meshFragmentShader, "mesh");
    this.panelUniforms = {
      viewProjection: uniformLocation(gl, this.panelProgram, "uViewProjection"),
      rawAlbedo: uniformLocation(gl, this.panelProgram, "uRawAlbedo"),
      rawNormal: uniformLocation(gl, this.panelProgram, "uRawNormal"),
      rawRoughness: uniformLocation(gl, this.panelProgram, "uRawRoughness"),
      decodedAlbedo: uniformLocation(gl, this.panelProgram, "uDecodedAlbedo"),
      decodedNormal: uniformLocation(gl, this.panelProgram, "uDecodedNormal"),
      decodedRoughness: uniformLocation(gl, this.panelProgram, "uDecodedRoughness"),
      viewMode: uniformLocation(gl, this.panelProgram, "uViewMode"),
      heatMap: uniformLocation(gl, this.panelProgram, "uHeatMap"),
      mip: uniformLocation(gl, this.panelProgram, "uMip"),
      errorGain: uniformLocation(gl, this.panelProgram, "uErrorGain"),
      camera: uniformLocation(gl, this.panelProgram, "uCameraPosition"),
    };
    this.floorUniforms = {
      viewProjection: uniformLocation(gl, this.floorProgram, "uViewProjection"),
      camera: uniformLocation(gl, this.floorProgram, "uCameraPosition"),
    };
    this.meshUniforms = {
      viewProjection: uniformLocation(gl, this.meshProgram, "uViewProjection"),
      camera: uniformLocation(gl, this.meshProgram, "uCameraPosition"),
      color: uniformLocation(gl, this.meshProgram, "uColor"),
      roughness: uniformLocation(gl, this.meshProgram, "uRoughness"),
    };

    this.emptyVao = this.createEmptyVao();
    const panelGeometry = createPanelGeometry();
    this.panelCount = panelGeometry.length / 11;
    this.panelVao = this.createInterleavedVao(panelGeometry, [
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 2],
    ]);
    this.floorVao = this.createInterleavedVao(createFloorGeometry(), [[0, 3]]);
    this.backingVao = this.createInterleavedVao(
      createBoxGeometry([0, 0.08, -0.29], [3.46, 2.7, 0.14]),
      [
        [0, 3],
        [1, 3],
      ],
    );
    this.plinthVao = this.createInterleavedVao(
      createBoxGeometry([0, -1.335, -0.14], [3.62, 0.16, 0.52]),
      [
        [0, 3],
        [1, 3],
      ],
    );

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.attachInteraction();
    this.resize();
  }

  get gpuCompressionSupported(): boolean {
    return this.gpuS3tc && this.gpuSrgb;
  }

  private createEmptyVao(): WebGLVertexArrayObject {
    const vao = this.gl.createVertexArray();
    if (!vao) throw new Error("无法创建 VAO");
    return vao;
  }

  private createInterleavedVao(
    data: Float32Array,
    layout: [index: number, size: number][],
  ): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    if (!vao || !buffer) throw new Error("无法创建几何缓冲");
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const stride = layout.reduce((sum, item) => sum + item[1], 0) * 4;
    let offset = 0;
    for (const [index, size] of layout) {
      gl.enableVertexAttribArray(index);
      gl.vertexAttribPointer(index, size, gl.FLOAT, false, stride, offset);
      offset += size * 4;
    }
    gl.bindVertexArray(null);
    return vao;
  }

  setTextures(
    raw: Record<MapId, MapTexture>,
    decoded: Record<MapId, MapTexture>,
    codec: CodecId,
    useGpuCompression: boolean,
  ): void {
    this.deleteTextureSets();
    this.rawTextures = this.createTextureSet(raw, codec, false);
    if (useGpuCompression) {
      if (!this.gpuCompressionSupported) throw new Error("S3TC sRGB 扩展不可用");
      this.decodedTextures = this.createTextureSet(decoded, codec, true);
    } else {
      this.decodedTextures = this.createTextureSet(decoded, codec, false);
    }
    this.queueRender();
  }

  private createTextureSet(
    maps: Record<MapId, MapTexture>,
    codec: CodecId,
    compressed: boolean,
  ): TextureSet {
    return {
      albedo: compressed
        ? this.uploadCompressed(maps.albedo, codec, true)
        : this.uploadUncompressed(maps.albedo.levels, true),
      normal: compressed
        ? this.uploadCompressed(maps.normal, codec, false)
        : this.uploadUncompressed(maps.normal.levels, false),
      roughness: compressed
        ? this.uploadCompressed(maps.roughness, codec, false)
        : this.uploadUncompressed(maps.roughness.levels, false),
    };
  }

  private prepareTexture(levels: number): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error("无法创建材质纹理");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, levels - 1);
    return texture;
  }

  private uploadUncompressed(levels: MapTexture["levels"], srgb: boolean): WebGLTexture {
    const gl = this.gl;
    const texture = this.prepareTexture(levels.length);
    const internalFormat = srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8;
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      gl.texImage2D(
        gl.TEXTURE_2D,
        i,
        internalFormat,
        level.width,
        level.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        level.data,
      );
    }
    return texture;
  }

  private uploadCompressed(data: MapTexture, codec: CodecId, srgb: boolean): WebGLTexture {
    const gl = this.gl;
    if (!this.gpuS3tc || !this.gpuSrgb) throw new Error("设备不支持 S3TC sRGB 压缩纹理");
    const texture = this.prepareTexture(data.encoded.length);
    const rgb = codec === "bc1" ? 0x83f1 : 0x83f3;
    const srgbAlpha = codec === "bc1" ? 0x8c4d : 0x8c4f;
    const internalFormat = srgb ? srgbAlpha : rgb;
    while (gl.getError() !== gl.NO_ERROR) {
      // Clear any stale error before validating compressed upload support.
    }
    for (let i = 0; i < data.encoded.length; i++) {
      const level = data.encoded[i];
      gl.compressedTexImage2D(
        gl.TEXTURE_2D,
        i,
        internalFormat,
        level.width,
        level.height,
        0,
        level.data,
      );
    }
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      gl.deleteTexture(texture);
      throw new Error(`压缩纹理上传失败 (GL ${error})`);
    }
    return texture;
  }

  private deleteTextureSets(): void {
    const gl = this.gl;
    for (const set of [this.rawTextures, this.decodedTextures]) {
      if (!set) continue;
      gl.deleteTexture(set.albedo);
      gl.deleteTexture(set.normal);
      gl.deleteTexture(set.roughness);
    }
    this.rawTextures = null;
    this.decodedTextures = null;
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    this.queueRender();
  }

  setHeatMap(map: MapId): void {
    this.heatMap = map;
    this.queueRender();
  }

  setMip(level: number): void {
    this.mip = level;
    this.queueRender();
  }

  setOblique(active: boolean): void {
    this.cameraGoal = { ...(active ? OBLIQUE_CAMERA : DEFAULT_CAMERA) };
    this.animateCamera();
  }

  private animateCamera = (): void => {
    const damp = 0.19;
    this.camera.yaw += (this.cameraGoal.yaw - this.camera.yaw) * damp;
    this.camera.pitch += (this.cameraGoal.pitch - this.camera.pitch) * damp;
    this.camera.distance += (this.cameraGoal.distance - this.camera.distance) * damp;
    const remaining =
      Math.abs(this.cameraGoal.yaw - this.camera.yaw) +
      Math.abs(this.cameraGoal.pitch - this.camera.pitch) +
      Math.abs(this.cameraGoal.distance - this.camera.distance);
    this.render();
    if (remaining > 0.0004) {
      this.cameraAnimation = requestAnimationFrame(this.animateCamera);
    } else {
      this.cameraAnimation = 0;
    }
  };

  private attachInteraction(): void {
    this.canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.dragging = true;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.dragging) return;
      const dx = event.clientX - this.lastPointer.x;
      const dy = event.clientY - this.lastPointer.y;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.camera.yaw -= dx * 0.006;
      this.camera.pitch = Math.min(0.55, Math.max(0.015, this.camera.pitch - dy * 0.0048));
      this.cameraGoal.yaw = this.camera.yaw;
      this.cameraGoal.pitch = this.camera.pitch;
      this.queueRender();
    });
    const stopDrag = (event: PointerEvent): void => {
      this.dragging = false;
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    };
    this.canvas.addEventListener("pointerup", stopDrag);
    this.canvas.addEventListener("pointercancel", stopDrag);
    this.canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.camera.distance = Math.min(9, Math.max(4.1, this.camera.distance * Math.exp(event.deltaY * 0.0012)));
        this.cameraGoal.distance = this.camera.distance;
        this.queueRender();
      },
      { passive: false },
    );
  }

  resize(): boolean {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width === width && this.canvas.height === height) return false;
    this.canvas.width = width;
    this.canvas.height = height;
    return true;
  }

  queueRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  render(): void {
    this.resize();
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const aspect = width / Math.max(1, height);
    const projection = perspective((35 * Math.PI) / 180, aspect, 0.1, 40);
    const eye = cameraPosition(this.camera.yaw, this.camera.pitch, this.camera.distance, this.target);
    const view = lookAt(eye, this.target);
    const viewProjection = multiply(projection, view);

    gl.viewport(0, 0, width, height);
    gl.clearColor(0.69, 0.65, 0.58, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(this.backgroundProgram);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.useProgram(this.floorProgram);
    gl.uniformMatrix4fv(this.floorUniforms.viewProjection, false, viewProjection);
    gl.uniform3fv(this.floorUniforms.camera, eye);
    gl.bindVertexArray(this.floorVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.useProgram(this.meshProgram);
    gl.uniformMatrix4fv(this.meshUniforms.viewProjection, false, viewProjection);
    gl.uniform3fv(this.meshUniforms.camera, eye);
    gl.uniform3f(this.meshUniforms.color, 0.155, 0.14, 0.115);
    gl.uniform1f(this.meshUniforms.roughness, 0.58);
    gl.bindVertexArray(this.backingVao);
    gl.drawArrays(gl.TRIANGLES, 0, 36);
    gl.uniform3f(this.meshUniforms.color, 0.24, 0.22, 0.18);
    gl.uniform1f(this.meshUniforms.roughness, 0.64);
    gl.bindVertexArray(this.plinthVao);
    gl.drawArrays(gl.TRIANGLES, 0, 36);

    if (this.rawTextures && this.decodedTextures) {
      gl.useProgram(this.panelProgram);
      gl.uniformMatrix4fv(this.panelUniforms.viewProjection, false, viewProjection);
      gl.uniform3fv(this.panelUniforms.camera, eye);
      gl.uniform1f(this.panelUniforms.mip, this.mip);
      gl.uniform1i(this.panelUniforms.viewMode, this.viewMode === "raw" ? 0 : this.viewMode === "decoded" ? 1 : 2);
      gl.uniform1i(this.panelUniforms.heatMap, this.heatMap === "albedo" ? 0 : this.heatMap === "normal" ? 1 : 2);
      gl.uniform1f(
        this.panelUniforms.errorGain,
        this.heatMap === "albedo" ? 5.2 : this.heatMap === "normal" ? 7.0 : 5.0,
      );
      this.bindTextureSet(this.rawTextures, 0);
      this.bindTextureSet(this.decodedTextures, 3);
      gl.bindVertexArray(this.panelVao);
      gl.drawArrays(gl.TRIANGLES, 0, this.panelCount);
    }
    gl.bindVertexArray(null);
  }

  private bindTextureSet(set: TextureSet, baseUnit: number): void {
    const gl = this.gl;
    const textures = [set.albedo, set.normal, set.roughness];
    const names = ["uRawAlbedo", "uRawNormal", "uRawRoughness", "uDecodedAlbedo", "uDecodedNormal", "uDecodedRoughness"];
    for (let i = 0; i < textures.length; i++) {
      gl.activeTexture(gl.TEXTURE0 + baseUnit + i);
      gl.bindTexture(gl.TEXTURE_2D, textures[i]);
      const location = gl.getUniformLocation(this.panelProgram, names[baseUnit + i]);
      if (location) gl.uniform1i(location, baseUnit + i);
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.cameraAnimation);
    this.deleteTextureSets();
    const gl = this.gl;
    gl.deleteProgram(this.panelProgram);
    gl.deleteProgram(this.backgroundProgram);
    gl.deleteProgram(this.floorProgram);
    gl.deleteProgram(this.meshProgram);
    gl.deleteVertexArray(this.emptyVao);
    gl.deleteVertexArray(this.panelVao);
    gl.deleteVertexArray(this.floorVao);
    gl.deleteVertexArray(this.backingVao);
    gl.deleteVertexArray(this.plinthVao);
  }
}
