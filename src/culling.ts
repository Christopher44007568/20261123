import type { CameraSnapshot } from "./camera";
import type { BuiltScene } from "./geometry/build";
import type { ClusterRecord, PageMeta } from "./geometry/types";

export const SLOT_MISSING = 0xffffffff;
export const COUNTER = {
  candidates: 0,
  lodRejected: 1,
  frustumCulled: 2,
  coneCulled: 3,
  submitted: 4,
  fallbackClusters: 5,
  lod0: 6,
  lod1: 7,
  lod2: 8,
  lod3: 9,
  missingPages: 10,
  coverageClusters: 11,
} as const;
export const COUNTER_COUNT = 12;
export const FRUSTUM_EPSILON = 0.025;
export const CONE_EPSILON = 0.003;

export interface PageDecision {
  rawLod: number;
  lod: number;
  fallback: boolean;
  distance: number;
  projectedError: number;
}

export interface CullResult {
  visible: number[];
  stats: Uint32Array;
  decisions: PageDecision[];
}

const f32 = Math.fround;

function packMeta(meta: PageMeta): {
  cx: number;
  cy: number;
  cz: number;
  radius: number;
  errors: readonly [number, number, number, number];
} {
  return {
    cx: f32(meta.center[0]),
    cy: f32(meta.center[1]),
    cz: f32(meta.center[2]),
    radius: f32(meta.radius),
    errors: [
      f32(meta.errors[0]),
      f32(meta.errors[1]),
      f32(meta.errors[2]),
      f32(meta.errors[3]),
    ],
  };
}

export function decidePage(
  meta: PageMeta,
  camera: CameraSnapshot,
  residentSlots: Uint32Array,
  errorThresholdPx: number,
): PageDecision {
  const packed = packMeta(meta);
  const dx = f32(packed.cx - camera.position[0]);
  const dy = f32(packed.cy - camera.position[1]);
  const dz = f32(packed.cz - camera.position[2]);
  const centerDistance = f32(Math.sqrt(f32(dx * dx + dy * dy + dz * dz)));
  const distance = f32(Math.max(f32(centerDistance - packed.radius), 1));
  const pixelScale = f32(
    f32(camera.height) / f32(f32(2 * camera.tanHalfFov) * distance),
  );
  let rawLod = 0;
  let projectedError = 0;
  for (let lod = 3; lod >= 0; lod--) {
    const projected = f32(packed.errors[lod]! * pixelScale);
    if (projected <= errorThresholdPx) {
      rawLod = lod;
      projectedError = projected;
      break;
    }
    projectedError = projected;
  }
  let lod = rawLod;
  let fallback = false;
  if (lod <= 1 && residentSlots[meta.page] === SLOT_MISSING) {
    lod = 2;
    fallback = true;
  }
  return { rawLod, lod, fallback, distance, projectedError };
}

export function buildPageDecisions(
  scene: BuiltScene,
  camera: CameraSnapshot,
  residentSlots: Uint32Array,
  errorThresholdPx: number,
): PageDecision[] {
  return scene.pageMetas.map((meta) =>
    decidePage(meta, camera, residentSlots, errorThresholdPx),
  );
}

function sphereInFrustum(cluster: ClusterRecord, camera: CameraSnapshot): boolean {
  const px = f32(cluster.center[0]);
  const py = f32(cluster.center[1]);
  const pz = f32(cluster.center[2]);
  const radius = f32(cluster.radius) + FRUSTUM_EPSILON;
  for (let i = 0; i < 6; i++) {
    const nx = camera.planes[i * 4]!;
    const ny = camera.planes[i * 4 + 1]!;
    const nz = camera.planes[i * 4 + 2]!;
    const d = camera.planes[i * 4 + 3]!;
    const distance = f32(f32(f32(nx * px) + f32(ny * py)) + f32(nz * pz)) + d;
    if (distance > radius) return false;
  }
  return true;
}

function coneFacesCamera(cluster: ClusterRecord, camera: CameraSnapshot): boolean {
  const dx = f32(camera.position[0] - cluster.center[0]);
  const dy = f32(camera.position[1] - cluster.center[1]);
  const dz = f32(camera.position[2] - cluster.center[2]);
  const distSq = f32(f32(dx * dx) + f32(dy * dy) + f32(dz * dz));
  const radius = f32(cluster.radius);
  if (distSq <= f32(radius * radius)) return true;
  const invDist = f32(1) / f32(Math.sqrt(distSq));
  const dotAxis = f32(
    f32(f32(f32(cluster.coneAxis[0] * dx) + f32(cluster.coneAxis[1] * dy)) + f32(cluster.coneAxis[2] * dz)) *
      invDist,
  );
  const cos = f32(cluster.coneCos);
  const sinTheta = Math.sqrt(Math.max(0, f32(1) - f32(cos * cos)));
  return dotAxis >= -sinTheta - CONE_EPSILON;
}

export function cullScene(
  scene: BuiltScene,
  camera: CameraSnapshot,
  residentSlots: Uint32Array,
  errorThresholdPx: number,
): CullResult {
  const stats = new Uint32Array(COUNTER_COUNT);
  const visible: number[] = [];
  const decisions = buildPageDecisions(scene, camera, residentSlots, errorThresholdPx);
  stats[COUNTER.missingPages] = decisions.filter((d) => d.fallback).length;
  for (const cluster of scene.clusters) {
    stats[COUNTER.candidates]!++;
    const decision = decisions[cluster.page]!;
    const coverage = decision.lod < 2 && cluster.lod === 2;
    if (cluster.lod !== decision.lod && !coverage) {
      stats[COUNTER.lodRejected]!++;
      continue;
    }
    if (!sphereInFrustum(cluster, camera)) {
      stats[COUNTER.frustumCulled]!++;
      continue;
    }
    if (!coneFacesCamera(cluster, camera)) {
      stats[COUNTER.coneCulled]!++;
      continue;
    }
    visible.push(coverage ? (cluster.id | 0x80000000) >>> 0 : cluster.id);
    stats[COUNTER.submitted]!++;
    if (decision.fallback && cluster.lod === 2) stats[COUNTER.fallbackClusters]!++;
    if (coverage) {
      stats[COUNTER.coverageClusters]!++;
    } else {
      stats[COUNTER.lod0 + cluster.lod]!++;
    }
  }
  return { visible, stats, decisions };
}

export interface CullComparison {
  match: boolean;
  gpuVisible: number;
  cpuVisible: number;
  missingFromGpu: number[];
  extraOnGpu: number[];
  statsMatch: boolean;
  gpuStats: number[];
  cpuStats: number[];
}

export function compareCulling(
  gpuVisible: number[],
  gpuStats: Uint32Array,
  cpu: CullResult,
): CullComparison {
  const gpuSorted = [...gpuVisible].sort((a, b) => a - b);
  const cpuSorted = [...cpu.visible].sort((a, b) => a - b);
  let i = 0;
  let j = 0;
  const missingFromGpu: number[] = [];
  const extraOnGpu: number[] = [];
  while (i < gpuSorted.length || j < cpuSorted.length) {
    if (j >= cpuSorted.length || (i < gpuSorted.length && gpuSorted[i]! < cpuSorted[j]!)) {
      extraOnGpu.push(gpuSorted[i++]!);
    } else if (i >= gpuSorted.length || cpuSorted[j]! < gpuSorted[i]!) {
      missingFromGpu.push(cpuSorted[j++]!);
    } else {
      i++;
      j++;
    }
  }
  const comparedIndices = Array.from({ length: COUNTER_COUNT }, (_, index) => index).filter(
    (index) => index !== COUNTER.missingPages,
  );
  const gpuStatsArray = comparedIndices.map((index) => gpuStats[index] ?? 0);
  const cpuStatsArray = comparedIndices.map((index) => cpu.stats[index] ?? 0);
  return {
    match: missingFromGpu.length === 0 && extraOnGpu.length === 0,
    gpuVisible: gpuVisible.length,
    cpuVisible: cpu.visible.length,
    missingFromGpu,
    extraOnGpu,
    statsMatch: gpuStatsArray.every((value, index) => value === cpuStatsArray[index]),
    gpuStats: gpuStatsArray,
    cpuStats: cpuStatsArray,
  };
}
