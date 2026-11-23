import {
  mat4Inverse,
  projectPixel,
  type CameraEye,
  type HeadPose,
  type Mat4,
  type Vec3,
} from "./math.ts";
import {
  STEREO,
  buildScene,
  createSceneMeshes,
  type Material,
  type MeshKey,
  type SceneSnapshot,
} from "./scene.ts";
import {
  backgroundFragmentShader,
  backgroundVertexShader,
  depthProbeFragmentShader,
  depthProbeVertexShader,
  markerFragmentShader,
  markerVertexShader,
  postFragmentShader,
  postVertexShader,
  sceneFragmentShader,
  sceneVertexShader,
} from "./shaders.ts";

export type ViewMode = "mono" | "sbs" | "anaglyph";

export interface FrameAudit {
  frameToken: number;
  sceneTime: number;
  leftToken: number;
  rightToken: number;
  leftSceneTime: number;
  rightSceneTime: number;
  sameSceneTime: boolean;
  probeSide: "front" | "behind";
  probeDepth: number;
  headYaw: number;
  headPitch: number;
  headRoll: number;
}

export interface EyeBufferInfo {
  width: number;
  height: number;
  colorFormat: "RGBA8";
  depthFormat: "DEPTH_COMPONENT24";
}

export interface ReprojectionReport {
  maxErrorPx: number;
  samples: number;
  leftMaxErrorPx: number;
  rightMaxErrorPx: number;
}

interface GpuMesh {
  vao: WebGLVertexArrayObject;
  vertexCount: number;
}

interface RenderTarget {
  framebuffer: WebGLFramebuffer;
  colorTexture: WebGLTexture;
  depthTexture: WebGLTexture;
  width: number;
  height: number;
}

interface CalibrationTarget {
  framebuffer: WebGLFramebuffer;
  colorTexture: WebGLTexture;
  width: number;
  height: number;
}

type UniformCache = Map<string, WebGLUniformLocation | null>;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to allocate WebGL shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "Unknown shader compilation error.";
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): { program: WebGLProgram; uniforms: UniformCache } {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to allocate WebGL program.");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "Unknown program link error.";
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return { program, uniforms: new Map() };
}

function getUniform(
  gl: WebGL2RenderingContext,
  info: { program: WebGLProgram; uniforms: UniformCache },
  name: string,
): WebGLUniformLocation | null {
  if (!info.uniforms.has(name)) {
    info.uniforms.set(name, gl.getUniformLocation(info.program, name));
  }
  return info.uniforms.get(name) ?? null;
}

function fitRect(
  canvasWidth: number,
  canvasHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  aspect: number,
): readonly [number, number, number, number] {
  const pixelX = x * canvasWidth;
  const pixelY = y * canvasHeight;
  const pixelWidth = width * canvasWidth;
  const pixelHeight = height * canvasHeight;
  let imageWidth = pixelWidth;
  let imageHeight = pixelWidth / aspect;
  if (imageHeight > pixelHeight) {
    imageHeight = pixelHeight;
    imageWidth = pixelHeight * aspect;
  }
  return [
    (pixelX + (pixelWidth - imageWidth) * 0.5) / canvasWidth,
    (pixelY + (pixelHeight - imageHeight) * 0.5) / canvasHeight,
    imageWidth / canvasWidth,
    imageHeight / canvasHeight,
  ];
}

export class StereoRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly meshInfo: Record<MeshKey, GpuMesh>;
  eyeBufferInfo: EyeBufferInfo;
  readonly maxTextureSize: number;

  private readonly sceneProgram: ReturnType<typeof createProgram>;
  private readonly backgroundProgram: ReturnType<typeof createProgram>;
  private readonly postProgram: ReturnType<typeof createProgram>;
  private readonly markerProgram: ReturnType<typeof createProgram>;
  private readonly depthProbeProgram: ReturnType<typeof createProgram>;
  private leftTarget!: RenderTarget;
  private rightTarget!: RenderTarget;
  private calibration!: CalibrationTarget;
  private mode: ViewMode = "sbs";
  private frameToken = 0;
  private lastSnapshot: SceneSnapshot | null = null;
  private lastAudit: FrameAudit | null = null;
  private normalMatrix = new Float32Array(9);

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
    if (!gl) throw new Error("当前浏览器或显卡驱动不支持 WebGL2。");
    this.gl = gl;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

    this.sceneProgram = createProgram(gl, sceneVertexShader, sceneFragmentShader);
    this.backgroundProgram = createProgram(gl, backgroundVertexShader, backgroundFragmentShader);
    this.postProgram = createProgram(gl, postVertexShader, postFragmentShader);
    this.markerProgram = createProgram(gl, markerVertexShader, markerFragmentShader);
    this.depthProbeProgram = createProgram(gl, depthProbeVertexShader, depthProbeFragmentShader);

    const meshData = createSceneMeshes();
    const meshEntries = Object.entries(meshData) as [MeshKey, ReturnType<typeof createSceneMeshes>[MeshKey]][];
    const meshes = {} as Record<MeshKey, GpuMesh>;
    for (const [key, data] of meshEntries) meshes[key] = this.uploadMesh(data);
    this.meshInfo = meshes;

    this.syncCanvasSize();
    this.leftTarget = this.createEyeTarget(this.targetWidth(), this.targetHeight());
    this.rightTarget = this.createEyeTarget(this.targetWidth(), this.targetHeight());
    this.calibration = this.createCalibrationTarget();
    this.eyeBufferInfo = {
      width: this.leftTarget.width,
      height: this.leftTarget.height,
      colorFormat: "RGBA8",
      depthFormat: "DEPTH_COMPONENT24",
    };
  }

  setViewMode(mode: ViewMode): void {
    this.mode = mode;
  }

  getViewMode(): ViewMode {
    return this.mode;
  }

  getLastSnapshot(): SceneSnapshot | null {
    return this.lastSnapshot;
  }

  getLastAudit(): FrameAudit | null {
    return this.lastAudit;
  }

  resize(): void {
    if (!this.syncCanvasSize()) return;
    this.destroyTarget(this.leftTarget);
    this.destroyTarget(this.rightTarget);
    this.leftTarget = this.createEyeTarget(this.targetWidth(), this.targetHeight());
    this.rightTarget = this.createEyeTarget(this.targetWidth(), this.targetHeight());
    this.eyeBufferInfo = {
      width: this.leftTarget.width,
      height: this.leftTarget.height,
      colorFormat: "RGBA8",
      depthFormat: "DEPTH_COMPONENT24",
    };
  }

  private syncCanvasSize(): boolean {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * pixelRatio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * pixelRatio));
    if (this.canvas.width === width && this.canvas.height === height) return false;
    this.canvas.width = width;
    this.canvas.height = height;
    return true;
  }

  renderFrame(time: number, head: HeadPose, probeBlend: number): FrameAudit {
    const snapshot = buildScene(time, head, probeBlend);
    this.lastSnapshot = snapshot;
    const token = ++this.frameToken;
    this.renderEye(snapshot.eyes[0], snapshot);
    this.renderEye(snapshot.eyes[1], snapshot);
    this.composite();

    const audit: FrameAudit = {
      frameToken: token,
      sceneTime: snapshot.time,
      leftToken: token,
      rightToken: token,
      leftSceneTime: snapshot.time,
      rightSceneTime: snapshot.time,
      sameSceneTime: true,
      probeSide: snapshot.probeSide,
      probeDepth: snapshot.probeCenter[2],
      headYaw: snapshot.head.yaw,
      headPitch: snapshot.head.pitch,
      headRoll: snapshot.head.roll,
    };
    this.lastAudit = audit;
    return audit;
  }

  private targetHeight(): number {
    const byDisplay = Math.max(420, Math.min(1100, Math.round(this.canvas.height * 0.95)));
    return Math.max(1, Math.min(byDisplay, Math.floor(this.maxTextureSize / STEREO.aspect)));
  }

  private targetWidth(): number {
    return Math.max(1, Math.min(this.maxTextureSize, Math.round(this.targetHeight() * STEREO.aspect)));
  }

  private uploadMesh(data: {
    positions: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    vertexCount: number;
  }): GpuMesh {
    const gl = this.gl;
    const interleaved = new Float32Array(data.vertexCount * 8);
    for (let index = 0; index < data.vertexCount; index += 1) {
      const target = index * 8;
      const source = index * 3;
      interleaved[target] = data.positions[source]!;
      interleaved[target + 1] = data.positions[source + 1]!;
      interleaved[target + 2] = data.positions[source + 2]!;
      interleaved[target + 3] = data.normals[source]!;
      interleaved[target + 4] = data.normals[source + 1]!;
      interleaved[target + 5] = data.normals[source + 2]!;
      interleaved[target + 6] = data.uvs[index * 2]!;
      interleaved[target + 7] = data.uvs[index * 2 + 1]!;
    }

    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    if (!vao || !buffer) throw new Error("Unable to allocate mesh buffers.");
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);
    const stride = 8 * Float32Array.BYTES_PER_ELEMENT;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * Float32Array.BYTES_PER_ELEMENT);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 6 * Float32Array.BYTES_PER_ELEMENT);
    gl.bindVertexArray(null);
    return { vao, vertexCount: data.vertexCount };
  }

  private createEyeTarget(width: number, height: number): RenderTarget {
    const gl = this.gl;
    const framebuffer = gl.createFramebuffer();
    const colorTexture = gl.createTexture();
    const depthTexture = gl.createTexture();
    if (!framebuffer || !colorTexture || !depthTexture) throw new Error("Unable to allocate eye render target.");

    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.DEPTH_COMPONENT24,
      width,
      height,
      0,
      gl.DEPTH_COMPONENT,
      gl.UNSIGNED_INT,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTexture, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTexture, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Eye framebuffer incomplete: 0x${status.toString(16)}`);
    return { framebuffer, colorTexture, depthTexture, width, height };
  }

  private createCalibrationTarget(): CalibrationTarget {
    const gl = this.gl;
    const width = Math.min(512, this.maxTextureSize);
    const height = Math.round(width / STEREO.aspect);
    const framebuffer = gl.createFramebuffer();
    const colorTexture = gl.createTexture();
    if (!framebuffer || !colorTexture) throw new Error("Unable to allocate calibration target.");
    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTexture, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Calibration framebuffer incomplete.");
    return { framebuffer, colorTexture, width, height };
  }

  private destroyTarget(target: RenderTarget): void {
    this.gl.deleteFramebuffer(target.framebuffer);
    this.gl.deleteTexture(target.colorTexture);
    this.gl.deleteTexture(target.depthTexture);
  }

  private renderEye(eye: CameraEye, snapshot: SceneSnapshot): void {
    const gl = this.gl;
    const target = eye.index === 0 ? this.leftTarget : this.rightTarget;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.clearColor(0.001, 0.002, 0.0025, 1);
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.backgroundProgram.program);
    gl.uniform2f(getUniform(gl, this.backgroundProgram, "u_resolution"), target.width, target.height);
    gl.uniform1f(getUniform(gl, this.backgroundProgram, "u_eyeSign"), eye.index === 0 ? -1 : 1);
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.useProgram(this.sceneProgram.program);
    gl.uniformMatrix4fv(getUniform(gl, this.sceneProgram, "u_viewProjection"), false, eye.viewProjection);
    gl.uniform3f(
      getUniform(gl, this.sceneProgram, "u_cameraPosition"),
      snapshot.head.position[0],
      snapshot.head.position[1],
      snapshot.head.position[2],
    );
    for (const object of snapshot.objects) {
      if (object.kind === "opaque") this.drawObject(object.mesh, object.model, object.material, false);
    }

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(true);
    for (const object of snapshot.objects) {
      if (object.kind === "shroud") this.drawObject(object.mesh, object.model, object.material, true);
    }
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private drawObject(meshKey: MeshKey, model: Mat4, material: Material, shroud: boolean): void {
    const gl = this.gl;
    const mesh = this.meshInfo[meshKey];
    const inverse = mat4Inverse(model);
    for (let column = 0; column < 3; column += 1) {
      for (let row = 0; row < 3; row += 1) {
        this.normalMatrix[column * 3 + row] = inverse[row * 4 + column]!;
      }
    }
    gl.uniformMatrix4fv(getUniform(gl, this.sceneProgram, "u_model"), false, model);
    gl.uniformMatrix3fv(getUniform(gl, this.sceneProgram, "u_normalMatrix"), false, this.normalMatrix);
    gl.uniform3f(
      getUniform(gl, this.sceneProgram, "u_albedo"),
      material.albedo[0],
      material.albedo[1],
      material.albedo[2],
    );
    const emissive = material.emissive ?? [0, 0, 0];
    gl.uniform3f(getUniform(gl, this.sceneProgram, "u_emissive"), emissive[0], emissive[1], emissive[2]);
    gl.uniform1f(getUniform(gl, this.sceneProgram, "u_metallic"), material.metallic);
    gl.uniform1f(getUniform(gl, this.sceneProgram, "u_roughness"), material.roughness);
    gl.uniform1f(getUniform(gl, this.sceneProgram, "u_alpha"), material.alpha ?? 1);
    gl.uniform1f(getUniform(gl, this.sceneProgram, "u_panelLines"), material.panelLines ? 1 : 0);
    gl.uniform1f(getUniform(gl, this.sceneProgram, "u_shroud"), shroud ? 1 : 0);
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.vertexCount);
  }

  private composite(): void {
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0.002, 0.003, 0.0035, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    let leftRect: readonly [number, number, number, number];
    let rightRect: readonly [number, number, number, number];
    if (this.mode === "sbs") {
      leftRect = fitRect(width, height, 0, 0, 0.5, 1, STEREO.aspect);
      rightRect = fitRect(width, height, 0.5, 0, 0.5, 1, STEREO.aspect);
    } else {
      leftRect = fitRect(width, height, 0, 0, 1, 1, STEREO.aspect);
      rightRect = leftRect;
    }

    gl.useProgram(this.postProgram.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.leftTarget.colorTexture);
    gl.uniform1i(getUniform(gl, this.postProgram, "u_leftColor"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.leftTarget.depthTexture);
    gl.uniform1i(getUniform(gl, this.postProgram, "u_leftDepth"), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.rightTarget.colorTexture);
    gl.uniform1i(getUniform(gl, this.postProgram, "u_rightColor"), 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.rightTarget.depthTexture);
    gl.uniform1i(getUniform(gl, this.postProgram, "u_rightDepth"), 3);
    gl.uniform4f(getUniform(gl, this.postProgram, "u_leftRect"), ...leftRect);
    gl.uniform4f(getUniform(gl, this.postProgram, "u_rightRect"), ...rightRect);
    gl.uniform2f(getUniform(gl, this.postProgram, "u_targetSize"), this.leftTarget.width, this.leftTarget.height);
    const modeIndex = this.mode === "mono" ? 0 : this.mode === "sbs" ? 1 : 2;
    gl.uniform1i(getUniform(gl, this.postProgram, "u_mode"), modeIndex);
    gl.uniform1f(getUniform(gl, this.postProgram, "u_k1"), -0.027);
    gl.uniform1f(getUniform(gl, this.postProgram, "u_k2"), -0.007);
    gl.uniform1f(getUniform(gl, this.postProgram, "u_near"), STEREO.near);
    gl.uniform1f(getUniform(gl, this.postProgram, "u_far"), STEREO.far);
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  measureReprojection(): ReprojectionReport {
    const snapshot = this.lastSnapshot;
    if (!snapshot) throw new Error("Render at least one frame before measuring reprojection.");
    const gl = this.gl;
    const target = this.calibration;
    const radius = 9;
    const windowSize = radius * 2 + 1;
    const pixels = new Uint8Array(windowSize * windowSize * 4);
    const errors: [number[], number[]] = [[], []];
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.markerProgram.program);
    gl.clearColor(0, 0, 0, 1);

    for (const eye of snapshot.eyes) {
      gl.uniformMatrix4fv(getUniform(gl, this.markerProgram, "u_viewProjection"), false, eye.viewProjection);
      for (const point of snapshot.calibrationPoints) {
        const expected = projectPixel(eye.viewProjection, point, target.width, target.height);
        if (
          expected.z < -1 ||
          expected.z > 1 ||
          expected.x < radius + 1 ||
          expected.y < radius + 1 ||
          expected.x > target.width - radius - 1 ||
          expected.y > target.height - radius - 1
        ) {
          continue;
        }
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform3f(getUniform(gl, this.markerProgram, "u_point"), point[0], point[1], point[2]);
        gl.bindVertexArray(null);
        gl.drawArrays(gl.POINTS, 0, 1);

        const x0 = Math.floor(expected.x) - radius;
        const y0 = Math.floor(expected.y) - radius;
        gl.readPixels(x0, y0, windowSize, windowSize, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let weightSum = 0;
        let weightedX = 0;
        let weightedY = 0;
        for (let row = 0; row < windowSize; row += 1) {
          for (let column = 0; column < windowSize; column += 1) {
            const offset = (row * windowSize + column) * 4;
            const weight = pixels[offset]! + pixels[offset + 1]! + pixels[offset + 2]!;
            if (weight === 0) continue;
            weightSum += weight;
            weightedX += (x0 + column + 0.5) * weight;
            weightedY += (y0 + row + 0.5) * weight;
          }
        }
        if (weightSum === 0) {
          errors[eye.index].push(Number.POSITIVE_INFINITY);
          continue;
        }
        const observedX = weightedX / weightSum;
        const observedY = weightedY / weightSum;
        errors[eye.index].push(Math.hypot(observedX - expected.x, observedY - expected.y));
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const leftMax = errors[0].length > 0 ? Math.max(...errors[0]) : 0;
    const rightMax = errors[1].length > 0 ? Math.max(...errors[1]) : 0;
    const all = [...errors[0], ...errors[1]];
    return {
      maxErrorPx: all.length > 0 ? Math.max(...all) : 0,
      samples: all.length,
      leftMaxErrorPx: leftMax,
      rightMaxErrorPx: rightMax,
    };
  }

  sampleEyeColor(
    eyeIndex: 0 | 1,
    point: Vec3,
    radius = 0,
  ): { rgba: readonly [number, number, number, number]; x: number; y: number; nx: number; ny: number } | null {
    const snapshot = this.lastSnapshot;
    if (!snapshot) return null;
    const eye = snapshot.eyes[eyeIndex];
    const target = eyeIndex === 0 ? this.leftTarget : this.rightTarget;
    const projected = projectPixel(eye.viewProjection, point, target.width, target.height);
    if (
      projected.x < 0 ||
      projected.y < 0 ||
      projected.x >= target.width ||
      projected.y >= target.height ||
      projected.z < -1 ||
      projected.z > 1
    ) {
      return null;
    }
    const gl = this.gl;
    const size = radius * 2 + 1;
    const pixels = new Uint8Array(size * size * 4);
    const startX = Math.max(0, Math.min(target.width - size, Math.floor(projected.x) - radius));
    const startY = Math.max(0, Math.min(target.height - size, Math.floor(projected.y) - radius));
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(startX, startY, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let bestOffset = 0;
    let bestScore = -1;
    for (let index = 0; index < size * size; index += 1) {
      const offset = index * 4;
      const score = pixels[offset + 1]! + pixels[offset + 2]! - pixels[offset]! * 0.6;
      if (score > bestScore) {
        bestScore = score;
        bestOffset = offset;
      }
    }
    return {
      rgba: [pixels[bestOffset]!, pixels[bestOffset + 1]!, pixels[bestOffset + 2]!, pixels[bestOffset + 3]!],
      x: projected.x,
      y: projected.y,
      nx: projected.x / target.width,
      ny: projected.y / target.height,
    };
  }

  readEyeMean(eyeIndex: 0 | 1): readonly [number, number, number] {
    const target = eyeIndex === 0 ? this.leftTarget : this.rightTarget;
    const pixels = new Uint8Array(target.width * target.height * 4);
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let red = 0;
    let green = 0;
    let blue = 0;
    const count = target.width * target.height;
    for (let index = 0; index < count; index += 1) {
      red += pixels[index * 4]!;
      green += pixels[index * 4 + 1]!;
      blue += pixels[index * 4 + 2]!;
    }
    return [red / count / 255, green / count / 255, blue / count / 255];
  }

  sampleEyeDepth(eyeIndex: 0 | 1, point: Vec3): number | null {
    const snapshot = this.lastSnapshot;
    if (!snapshot) return null;
    const eye = snapshot.eyes[eyeIndex];
    const target = eyeIndex === 0 ? this.leftTarget : this.rightTarget;
    const projected = projectPixel(eye.viewProjection, point, target.width, target.height);
    if (projected.x < 0 || projected.y < 0 || projected.x >= target.width || projected.y >= target.height) {
      return null;
    }
    const gl = this.gl;
    const pixel = new Uint8Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.calibration.framebuffer);
    gl.viewport(0, 0, 1, 1);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.depthProbeProgram.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.depthTexture);
    gl.uniform1i(getUniform(gl, this.depthProbeProgram, "u_depthTexture"), 0);
    gl.uniform2f(
      getUniform(gl, this.depthProbeProgram, "u_uv"),
      projected.x / target.width,
      projected.y / target.height,
    );
    gl.uniform1f(getUniform(gl, this.depthProbeProgram, "u_near"), STEREO.near);
    gl.uniform1f(getUniform(gl, this.depthProbeProgram, "u_far"), STEREO.far);
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return (pixel[0]! / 255) * STEREO.far;
  }
}
