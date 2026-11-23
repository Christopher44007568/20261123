import { GHOST_COUNT, MAX_LIGHTS, LightSource, buildGhostDefs, lightAngularRadiusNdc, beaconPulse } from '../flare/optics.js';
import { Mat4, projectToNdc } from '../math/mat4.js';
import { Vec3 } from '../math/vec3.js';
import { Material, SceneData } from '../scene/scene.js';
import { OrbitCamera, cameraMatrices } from './camera.js';
import { GpuMesh, createProgram, uniformLocations, uploadMesh } from './gl.js';
import { HdrTarget, createHdrTarget, deleteHdrTarget } from './targets.js';
import { FULLSCREEN_VERTEX } from './shaders/fullscreen.js';
import { SCENE_FRAGMENT, SCENE_VERTEX } from './shaders/sceneShaders.js';
import { FLARE_FRAGMENT } from './shaders/flareShaders.js';
import { COMPOSITE_FRAGMENT } from './shaders/compositeShaders.js';
import { fullscreenQuad } from './quad.js';

export const enum FlareMode {
  Off = 0,
  Simple = 1,
  Physical = 2,
}

export interface RenderSettings {
  mode: FlareMode;
  exposure: number;
  fNumber: number;
  time: number;
}

export interface LightRuntimeInfo {
  ndc: Vec3;
  visible: boolean;
  visibility: number;
  behind: boolean;
}

const LIGHT_NAMES = Array.from({ length: MAX_LIGHTS }, (_, i) => [
  `uLightScreen[${i}]`,
  `uLightColor[${i}]`,
  `uLightAngularRadius[${i}]`,
  `uLightViewDepth[${i}]`,
  `uLightPower[${i}]`,
]).flat();

const SCENE_UNIFORMS = [
  'uViewProj', 'uMaterial', 'uCameraPos',
  ...Array.from({ length: MAX_LIGHTS }, (_, i) => `uLightPos[${i}]`),
  ...Array.from({ length: MAX_LIGHTS }, (_, i) => `uLightColor[${i}]`),
  ...Array.from({ length: MAX_LIGHTS }, (_, i) => `uLightIntensity[${i}]`),
  'uLightCount',
];

export class Renderer {
  private gl: WebGL2RenderingContext;
  private sceneProgram: WebGLProgram;
  private flareProgram: WebGLProgram;
  private compositeProgram: WebGLProgram;
  private sceneU: Record<string, WebGLUniformLocation | null>;
  private flareU: Record<string, WebGLUniformLocation | null>;
  private compositeU: Record<string, WebGLUniformLocation | null>;
  private gpuBatches: Array<{ mesh: GpuMesh; material: Material }>;
  private quad: GpuMesh;
  private sceneTarget: HdrTarget | null = null;
  private flareTarget: HdrTarget | null = null;
  private captureTarget: HdrTarget | null = null;
  private width = 0;
  private height = 0;
  readonly lightInfo: LightRuntimeInfo[] = [];

  constructor(gl: WebGL2RenderingContext, scene: SceneData) {
    this.gl = gl;
    this.sceneProgram = createProgram(gl, SCENE_VERTEX, SCENE_FRAGMENT);
    this.flareProgram = createProgram(gl, FULLSCREEN_VERTEX, FLARE_FRAGMENT);
    this.compositeProgram = createProgram(gl, FULLSCREEN_VERTEX, COMPOSITE_FRAGMENT);
    this.sceneU = uniformLocations(gl, this.sceneProgram, SCENE_UNIFORMS);
    this.flareU = uniformLocations(gl, this.flareProgram, [...LIGHT_NAMES, 'uLightCount', 'uViewport',
      ...Array.from({ length: GHOST_COUNT }, (_, i) => `uGhostK[${i}]`),
      ...Array.from({ length: GHOST_COUNT }, (_, i) => `uGhostRadius[${i}]`),
      ...Array.from({ length: GHOST_COUNT }, (_, i) => `uGhostIntensity[${i}]`),
      ...Array.from({ length: GHOST_COUNT }, (_, i) => `uGhostRing[${i}]`),
      ...Array.from({ length: GHOST_COUNT }, (_, i) => `uGhostDispersion[${i}]`),
      'uNearFar', 'uTexelSize', 'uSceneDepth']);
    this.compositeU = uniformLocations(gl, this.compositeProgram, [
      'uSceneColor', 'uFlareColor', 'uMode', 'uExposure', 'uViewport', 'uLinearCapture',
    ]);
    this.gpuBatches = scene.batches.map((batch) => ({ mesh: uploadMesh(gl, batch.mesh), material: batch.material }));
    this.quad = uploadMesh(gl, fullscreenQuad());
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height && this.sceneTarget) return;
    const gl = this.gl;
    if (this.sceneTarget) deleteHdrTarget(gl, this.sceneTarget);
    if (this.flareTarget) deleteHdrTarget(gl, this.flareTarget);
    if (this.captureTarget) deleteHdrTarget(gl, this.captureTarget);
    this.sceneTarget = createHdrTarget(gl, width, height);
    this.flareTarget = createHdrTarget(gl, width, height);
    this.captureTarget = createHdrTarget(gl, width, height);
    this.width = width;
    this.height = height;
  }

  private computeLightData(
    lights: LightSource[],
    viewProj: Mat4,
    cameraEye: Vec3,
    tanHalfFovY: number,
    time: number,
  ): {
    screen: Float32Array;
    color: Float32Array;
    angular: Float32Array;
    viewDepth: Float32Array;
    power: Float32Array;
    count: number;
  } {
    const count = Math.min(lights.length, MAX_LIGHTS);
    const screen = new Float32Array(MAX_LIGHTS * 3);
    const color = new Float32Array(MAX_LIGHTS * 3);
    const angular = new Float32Array(MAX_LIGHTS);
    const viewDepth = new Float32Array(MAX_LIGHTS);
    const power = new Float32Array(MAX_LIGHTS);
    this.lightInfo.length = 0;

    for (let i = 0; i < count; i++) {
      const light = lights[i];
      const projected = projectToNdc(viewProj, light.position);
      const distance = Math.hypot(
        light.position[0] - cameraEye[0],
        light.position[1] - cameraEye[1],
        light.position[2] - cameraEye[2],
      );
      const pulse = light.beacon ? beaconPulse(time) : 1;
      screen.set(projected.ndc, i * 3);
      color.set([light.color[0], light.color[1], light.color[2]], i * 3);
      angular[i] = lightAngularRadiusNdc(light.radius, distance, tanHalfFovY);
      viewDepth[i] = distance;
      power[i] = light.intensity * pulse;
      this.lightInfo.push({
        ndc: projected.ndc,
        visible: !projected.behind,
        visibility: projected.behind ? 0 : -1,
        behind: projected.behind,
      });
    }
    return { screen, color, angular, viewDepth, power, count };
  }

  private renderScene(scene: SceneData, camera: OrbitCamera, aspect: number, lightData: ReturnType<Renderer['computeLightData']>): { viewProj: Mat4; eye: Vec3 } {
    const gl = this.gl;
    const { viewProj, eye } = cameraMatrices(camera, aspect);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneTarget!.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(0.008, 0.012, 0.022, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.sceneProgram);
    gl.uniformMatrix4fv(this.sceneU.uViewProj, false, viewProj);
    gl.uniform3fv(this.sceneU.uCameraPos, eye);
    gl.uniform1i(this.sceneU.uLightCount, lightData.count);
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const light = scene.lights[i];
      const pos = light ? light.position : [0, 0, 0];
      const col = light ? light.color : [0, 0, 0];
      gl.uniform3f(this.sceneU[`uLightPos[${i}]`], pos[0], pos[1], pos[2]);
      gl.uniform3f(this.sceneU[`uLightColor[${i}]`], col[0], col[1], col[2]);
      gl.uniform1f(this.sceneU[`uLightIntensity[${i}]`], light ? lightData.power[i] : 0);
    }
    for (const batch of this.gpuBatches) {
      gl.uniform1i(this.sceneU.uMaterial, batch.material);
      gl.bindVertexArray(batch.mesh.vao);
      gl.drawElements(gl.TRIANGLES, batch.mesh.indexCount, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
    return { viewProj, eye };
  }

  private renderFlare(camera: OrbitCamera, settings: RenderSettings, lightData: ReturnType<Renderer['computeLightData']>): void {
    const gl = this.gl;
    const ghosts = buildGhostDefs(camera.focalMm, settings.fNumber);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.flareTarget!.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.flareProgram);
    gl.uniform2f(this.flareU.uViewport, this.width, this.height);
    gl.uniform1i(this.flareU.uLightCount, lightData.count);
    this.setVec3Array('uLightScreen', lightData.screen, MAX_LIGHTS);
    this.setVec3Array('uLightColor', lightData.color, MAX_LIGHTS);
    for (let i = 0; i < MAX_LIGHTS; i++) {
      this.setFloatArrayElement('uLightAngularRadius', i, lightData.angular[i]);
      this.setFloatArrayElement('uLightViewDepth', i, lightData.viewDepth[i]);
      this.setFloatArrayElement('uLightPower', i, lightData.power[i]);
    }
    for (let i = 0; i < GHOST_COUNT; i++) {
      this.setFloatArrayElement('uGhostK', i, ghosts[i].k);
      this.setFloatArrayElement('uGhostRadius', i, ghosts[i].radiusNdc);
      this.setFloatArrayElement('uGhostIntensity', i, ghosts[i].intensity);
      this.setFloatArrayElement('uGhostRing', i, ghosts[i].ring);
      this.setFloatArrayElement('uGhostDispersion', i, ghosts[i].dispersion);
    }
    gl.uniform2f(this.flareU.uNearFar, camera.near, camera.far);
    gl.uniform2f(this.flareU.uTexelSize, 1 / this.width, 1 / this.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTarget!.depth);
    gl.uniform1i(this.flareU.uSceneDepth, 0);
    gl.bindVertexArray(this.quad.vao);
    gl.drawElements(gl.TRIANGLES, this.quad.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  private compositePass(settings: RenderSettings, target: HdrTarget | null, linearCapture: boolean): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.compositeProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTarget!.color);
    gl.uniform1i(this.compositeU.uSceneColor, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.flareTarget!.color);
    gl.uniform1i(this.compositeU.uFlareColor, 1);
    gl.uniform1i(this.compositeU.uMode, settings.mode);
    gl.uniform1f(this.compositeU.uExposure, settings.exposure);
    gl.uniform2f(this.compositeU.uViewport, this.width, this.height);
    gl.uniform1i(this.compositeU.uLinearCapture, linearCapture ? 1 : 0);
    gl.bindVertexArray(this.quad.vao);
    gl.drawElements(gl.TRIANGLES, this.quad.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  render(scene: SceneData, camera: OrbitCamera, settings: RenderSettings): void {
    const aspect = this.width / this.height;
    const matrices = cameraMatrices(camera, aspect);
    const tanHalfFovY = Math.tan((2 * Math.atan(24 / (2 * camera.focalMm))) / 2);
    const lightData = this.computeLightData(scene.lights, matrices.viewProj, matrices.eye, tanHalfFovY, settings.time);
    this.renderScene(scene, camera, aspect, lightData);
    this.renderFlare(camera, settings, lightData);
    this.compositePass(settings, null, false);
  }

  renderLinearCapture(scene: SceneData, camera: OrbitCamera, settings: RenderSettings): Float32Array {
    const gl = this.gl;
    const aspect = this.width / this.height;
    const matrices = cameraMatrices(camera, aspect);
    const tanHalfFovY = Math.tan((2 * Math.atan(24 / (2 * camera.focalMm))) / 2);
    const lightData = this.computeLightData(scene.lights, matrices.viewProj, matrices.eye, tanHalfFovY, settings.time);
    this.renderScene(scene, camera, aspect, lightData);
    this.renderFlare(camera, settings, lightData);
    this.compositePass(settings, this.captureTarget, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.captureTarget!.framebuffer);
    const pixels = new Float32Array(this.width * this.height * 4);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.FLOAT, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return pixels;
  }

  readFlarePixels(): Float32Array {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.flareTarget!.framebuffer);
    const pixels = new Float32Array(this.width * this.height * 4);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.FLOAT, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return pixels;
  }

  readScenePixels(): Float32Array {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneTarget!.framebuffer);
    const pixels = new Float32Array(this.width * this.height * 4);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.FLOAT, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return pixels;
  }

  get dimensions(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  private setVec3Array(name: string, values: Float32Array, count: number): void {
    const gl = this.gl;
    for (let i = 0; i < count; i++) {
      const location = this.flareU[`${name}[${i}]`];
      gl.uniform3f(location, values[i * 3], values[i * 3 + 1], values[i * 3 + 2]);
    }
  }

  private setFloatArrayElement(name: string, index: number, value: number): void {
    this.gl.uniform1f(this.flareU[`${name}[${index}]`], value);
  }

  dispose(): void {
    const gl = this.gl;
    if (this.sceneTarget) deleteHdrTarget(gl, this.sceneTarget);
    if (this.flareTarget) deleteHdrTarget(gl, this.flareTarget);
    if (this.captureTarget) deleteHdrTarget(gl, this.captureTarget);
  }
}
