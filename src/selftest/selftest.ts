import { Vec3, normalize, sub, v3 } from '../math/vec3.js';
import { createCamera, fovYFromFocal } from '../render/camera.js';
import { FlareMode, Renderer, RenderSettings } from '../render/renderer.js';
import { OrbitCamera } from '../render/camera.js';
import { SceneData } from '../scene/scene.js';

export interface SelfTestResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface SelfTestSummary {
  passed: boolean;
  results: SelfTestResult[];
}

function cameraLookingAt(eye: Vec3, target: Vec3): OrbitCamera {
  const camera = createCamera();
  const offset = sub(eye, target);
  camera.distance = Math.hypot(offset[0], offset[1], offset[2]);
  camera.yaw = Math.atan2(offset[0], offset[2]);
  camera.pitch = Math.asin(offset[1] / camera.distance);
  camera.target = target;
  return camera;
}

function totalEnergy(pixels: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
  return sum;
}

function flareEnergy(pixels: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
  return sum;
}

function channelRatio(pixels: Float32Array): { r: number; g: number; b: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    r += pixels[i];
    g += pixels[i + 1];
    b += pixels[i + 2];
  }
  const total = r + g + b || 1;
  return { r: r / total, g: g / total, b: b / total };
}

const baseSettings = (mode: FlareMode, exposure = 1): RenderSettings => ({
  mode,
  exposure,
  fNumber: 2.8,
  time: 10,
});

export function runSelfTest(renderer: Renderer, scene: SceneData): SelfTestSummary {
  const results: SelfTestResult[] = [];
  const workLight = scene.lights[0].position;
  const panel: Vec3 = v3(-2.2, 5.7, 0.6);
  const openEye: Vec3 = v3(workLight[0] - 2, workLight[1] + 3, workLight[2] - 12);
  const blockedDir = normalize(sub(panel, workLight));
  const blockedEye: Vec3 = [
    workLight[0] + blockedDir[0] * 9,
    workLight[1] + blockedDir[1] * 9,
    workLight[2] + blockedDir[2] * 9,
  ];

  const openCamera = cameraLookingAt(openEye, workLight);
  const blockedCamera = cameraLookingAt(blockedEye, workLight);

  const openFlare = renderFlare(renderer, scene, openCamera);
  const blockedFlare = renderFlare(renderer, scene, blockedCamera);
  const openEnergy = flareEnergy(openFlare);
  const blockedEnergy = flareEnergy(blockedFlare);

  results.push({
    name: '未遮挡时鬼影与光晕可见',
    passed: openEnergy > 1e-3,
    detail: `物理通道能量=${openEnergy.toFixed(4)}`,
  });
  results.push({
    name: '塔架/薄板遮挡后无残留',
    passed: blockedEnergy < openEnergy * 0.08,
    detail: `遮挡后/未遮挡能量比=${(blockedEnergy / (openEnergy || 1)).toFixed(4)}`,
  });

  const linear1 = renderer.renderLinearCapture(scene, openCamera, { ...baseSettings(FlareMode.Physical), exposure: 1 });
  const linear2 = renderer.renderLinearCapture(scene, openCamera, { ...baseSettings(FlareMode.Physical), exposure: 2 });
  const e1 = totalEnergy(linear1);
  const e2 = totalEnergy(linear2);
  const ratio = e2 / (e1 || 1);
  results.push({
    name: 'HDR 能量随曝光线性变化',
    passed: ratio > 1.75 && ratio < 2.25,
    detail: `曝光翻倍后总能量倍率=${ratio.toFixed(3)}（期望≈2.000）`,
  });

  const offPixels = renderer.renderLinearCapture(scene, openCamera, baseSettings(FlareMode.Off));
  const simplePixels = renderer.renderLinearCapture(scene, openCamera, baseSettings(FlareMode.Simple));
  const physicalPixels = renderer.renderLinearCapture(scene, openCamera, baseSettings(FlareMode.Physical));
  const offE = totalEnergy(offPixels);
  const simpleE = totalEnergy(simplePixels);
  const physicalE = totalEnergy(physicalPixels);
  results.push({
    name: '三种视图存在明确差异',
    passed: simpleE > offE * 1.005 && physicalE > offE * 1.005 && Math.abs(physicalE - simpleE) / offE > 0.005,
    detail: `能量 关闭=${offE.toFixed(3)} 简单=${simpleE.toFixed(3)} 物理=${physicalE.toFixed(3)}`,
  });

  const physicalRatio = channelRatio(physicalPixels);
  const offRatio = channelRatio(offPixels);
  const physicalShift = Math.abs(physicalRatio.b - offRatio.b) + Math.abs(physicalRatio.r - offRatio.r);
  results.push({
    name: '物理模式呈现通道色散',
    passed: physicalShift > 0.0008,
    detail: `物理模式相对关闭基准的RGB通道占比偏移=${physicalShift.toFixed(5)}`,
  });

  const teleCamera: OrbitCamera = { ...openCamera, focalMm: 70 };
  const wideFlare = renderFlare(renderer, scene, openCamera);
  const teleFlare = renderFlare(renderer, scene, teleCamera);
  const wideCentroid = energyCentroid(wideFlare, renderer.dimensions.width);
  const teleCentroid = energyCentroid(teleFlare, renderer.dimensions.width);
  const centroidDelta = Math.hypot(wideCentroid[0] - teleCentroid[0], wideCentroid[1] - teleCentroid[1]);
  const fov = fovYFromFocal(openCamera.focalMm);
  results.push({
    name: '焦距改变鬼影轴向排布',
    passed: centroidDelta > 0.01,
    detail: `35mm→70mm 能量质心位移=${centroidDelta.toFixed(4)}，FOV=${(fov * 180 / Math.PI).toFixed(1)}°→${(fovYFromFocal(70) * 180 / Math.PI).toFixed(1)}°`,
  });

  return { passed: results.every((r) => r.passed), results };
}

function renderFlare(renderer: Renderer, scene: SceneData, camera: OrbitCamera): Float32Array {
  renderer.render(scene, camera, baseSettings(FlareMode.Physical));
  return renderer.readFlarePixels();
}

function energyCentroid(pixels: Float32Array, width: number): [number, number] {
  let energy = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
    const e = pixels[i] + pixels[i + 1] + pixels[i + 2];
    energy += e;
    cx += (j % width) * e;
    cy += Math.floor(j / width) * e;
  }
  if (energy < 1e-6) return [0, 0];
  return [cx / energy / width, cy / energy / (pixels.length / 4 / width)];
}
