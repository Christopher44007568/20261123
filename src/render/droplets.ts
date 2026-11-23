export type RainMode = "off" | "static" | "drift";

export interface LensSettings {
  focalLengthMm: number;
  aperture: number;
  focusDistanceM: number;
  sensorWidthMm: number;
}

export interface Droplet {
  id: number;
  x: number;
  y: number;
  radiusMm: number;
  radiusPx: number;
  depthM: number;
  squash: number;
  normalX: number;
  normalY: number;
  seed: number;
  opacity: number;
  trailPx: number;
  trailWidthPx: number;
  focusBlurPx: number;
  speed: number;
  wobble: number;
  age: number;
  drifting: boolean;
}

export interface DropletGpuRecord {
  x: number;
  y: number;
  radiusPx: number;
  squash: number;
  normalX: number;
  normalY: number;
  depthM: number;
  seed: number;
  trailPx: number;
  trailWidthPx: number;
  opacity: number;
  focusBlurPx: number;
}

export const MAX_DROPLETS = 64;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Thin-lens projection of a drop sitting on the glass. Focus distance is
 * deliberately absent: racking focus changes the circle of confusion, never
 * the projected diameter.
 */
export function projectRadiusPx(
  radiusMm: number,
  depthM: number,
  focalLengthMm: number,
  sensorWidthMm: number,
  viewportHeightPx: number,
): number {
  const safeDepth = Math.max(0.01, depthM);
  const projectedMm = (radiusMm * focalLengthMm) / (safeDepth * 1000);
  return (projectedMm / sensorWidthMm) * viewportHeightPx;
}

export function focusBlurPx(depthM: number, lens: LensSettings): number {
  const inverseDelta = Math.abs(1 / Math.max(0.01, depthM) - 1 / lens.focusDistanceM);
  const apertureGain = 5.6 / clamp(lens.aperture, 1.2, 16);
  return clamp(inverseDelta * apertureGain * 8.5, 0, 15);
}

function makeDroplet(
  id: number,
  x: number,
  y: number,
  radiusMm: number,
  depthM: number,
  lens: LensSettings,
  viewportHeightPx: number,
  rand: () => number,
): Droplet {
  const squash = 0.78 + rand() * 0.4;
  const normalAngle = rand() * Math.PI * 2;
  const normalMagnitude = 0.1 + rand() * 0.38;
  const radiusPx = projectRadiusPx(
    radiusMm,
    depthM,
    lens.focalLengthMm,
    lens.sensorWidthMm,
    viewportHeightPx,
  );

  return {
    id,
    x,
    y,
    radiusMm,
    radiusPx,
    depthM,
    squash,
    normalX: Math.cos(normalAngle) * normalMagnitude,
    normalY: Math.sin(normalAngle) * normalMagnitude,
    seed: rand(),
    opacity: radiusPx > 16 ? 1 : 0.72 + rand() * 0.2,
    trailPx: 0,
    trailWidthPx: 0,
    focusBlurPx: focusBlurPx(depthM, lens),
    speed: 15 + rand() * 30,
    wobble: rand() * Math.PI * 2,
    age: rand(),
    drifting: false,
  };
}

export function createDropletField(
  lens: LensSettings,
  viewportHeightPx: number,
  count = 58,
  seed = 0x4a17c9,
): Droplet[] {
  const rand = mulberry32(seed);
  const droplets: Droplet[] = [];
  const total = Math.min(MAX_DROPLETS, count);

  const large = [
    [0.275, 0.61, 2.65, 0.135],
    [0.395, 0.555, 1.62, 0.182],
    [0.63, 0.47, 2.2, 0.17],
    [0.805, 0.66, 2.95, 0.115],
    [0.47, 0.76, 1.95, 0.19],
    [0.135, 0.44, 1.7, 0.21],
    [0.72, 0.79, 2.35, 0.15],
    [0.56, 0.69, 1.42, 0.205],
  ] as const;

  for (let i = 0; i < Math.min(large.length, total); i += 1) {
    const [x, y, radiusMm, depthM] = large[i]!;
    droplets.push(makeDroplet(i, x, y, radiusMm, depthM, lens, viewportHeightPx, rand));
  }

  while (droplets.length < total) {
    const i = droplets.length;
    const roll = rand();
    let radiusMm: number;
    let depthM: number;
    if (roll > 0.8 && droplets.length < 6 + 10) {
      radiusMm = 0.92 + rand() * 0.86;
      depthM = 0.09 + rand() * 0.075;
    } else {
      radiusMm = 0.2 + Math.pow(rand(), 1.6) * 0.62;
      depthM = 0.082 + rand() * 0.075;
    }
    const x = 0.055 + rand() * 0.89;
    const y = 0.24 + rand() * 0.68;
    droplets.push(makeDroplet(i, x, y, radiusMm, depthM, lens, viewportHeightPx, rand));
  }

  return droplets.sort((a, b) => a.radiusPx - b.radiusPx);
}

export function updateDropletLens(
  droplets: Droplet[],
  lens: LensSettings,
  viewportHeightPx: number,
): void {
  for (const drop of droplets) {
    drop.radiusPx = projectRadiusPx(
      drop.radiusMm,
      drop.depthM,
      lens.focalLengthMm,
      lens.sensorWidthMm,
      viewportHeightPx,
    );
    drop.focusBlurPx = focusBlurPx(drop.depthM, lens);
  }
  droplets.sort((a, b) => a.radiusPx - b.radiusPx);
}

export function stepDroplets(
  droplets: Droplet[],
  mode: RainMode,
  deltaSeconds: number,
  elapsedSeconds: number,
  viewportHeightPx: number,
): void {
  for (const drop of droplets) {
    drop.drifting = mode === "drift" && drop.radiusPx > 2.2;
    drop.age += deltaSeconds;
    if (!drop.drifting) {
      drop.trailPx += (0 - drop.trailPx) * Math.min(1, deltaSeconds * 4.5);
      drop.trailWidthPx += (0 - drop.trailWidthPx) * Math.min(1, deltaSeconds * 4.5);
      continue;
    }

    const sizeGain = clamp(1.15 - drop.radiusPx / 55, 0.28, 1);
    const travel = drop.speed * sizeGain * deltaSeconds;
    drop.y += travel / Math.max(1, viewportHeightPx);
    drop.x += Math.sin(elapsedSeconds * 0.7 + drop.wobble) * travel * 0.00032;
    drop.trailPx = Math.min(78, drop.trailPx + travel * (0.5 + drop.radiusPx / 28));
    drop.trailWidthPx = drop.radiusPx * (0.34 + 0.28 * Math.min(1, drop.trailPx / 16));

    if (drop.y > 0.9 || drop.x < 0.045 || drop.x > 0.955) {
      drop.y = 0.23 + (drop.seed * 0.11);
      drop.x = 0.065 + ((drop.seed * 7919 + drop.age * 0.017) % 0.87);
      drop.trailPx = 0;
      drop.trailWidthPx = 0;
      drop.wobble += 1.37;
    }
  }
}

export function packDroplets(
  droplets: Droplet[],
  mode: RainMode,
  target: Float32Array,
): number {
  if (mode === "off") return 0;
  const count = Math.min(droplets.length, MAX_DROPLETS);
  for (let i = 0; i < count; i += 1) {
    const drop = droplets[i]!;
    const offset = i * 16;
    target[offset] = drop.x;
    target[offset + 1] = drop.y;
    target[offset + 2] = drop.radiusPx;
    target[offset + 3] = drop.squash;
    target[offset + 4] = drop.normalX;
    target[offset + 5] = drop.normalY;
    target[offset + 6] = drop.depthM;
    target[offset + 7] = drop.seed;
    target[offset + 8] = drop.trailPx;
    target[offset + 9] = drop.trailWidthPx;
    target[offset + 10] = drop.opacity;
    target[offset + 11] = drop.focusBlurPx;
    target[offset + 12] = drop.radiusPx > 16 ? 1 : 0;
    target[offset + 13] = drop.radiusMm;
    target[offset + 14] = drop.drifting ? 1 : 0;
    target[offset + 15] = drop.age;
  }
  return count;
}

export function toGpuRecords(droplets: Droplet[], mode: RainMode): DropletGpuRecord[] {
  if (mode === "off") return [];
  return droplets.map((drop) => ({
    x: drop.x,
    y: drop.y,
    radiusPx: drop.radiusPx,
    squash: drop.squash,
    normalX: drop.normalX,
    normalY: drop.normalY,
    depthM: drop.depthM,
    seed: drop.seed,
    trailPx: drop.trailPx,
    trailWidthPx: drop.trailWidthPx,
    opacity: drop.opacity,
    focusBlurPx: drop.focusBlurPx,
  }));
}

/**
 * CPU mirror of the lens bend used by the GLSL composite. It is used by the
 * validation suite to prove the refracted sample coordinate has no seams.
 */
export function lensSampleUv(
  pixelX: number,
  pixelY: number,
  drop: Droplet,
  viewportWidthPx: number,
  viewportHeightPx: number,
  time = 0,
): [number, number] {
  const centerX = drop.x * viewportWidthPx;
  const centerY = drop.y * viewportHeightPx;
  const radiusX = Math.max(0.7, drop.radiusPx * drop.squash);
  const radiusY = Math.max(0.7, drop.radiusPx);
  const localX = (pixelX - centerX) / radiusX;
  const localY = (pixelY - centerY) / radiusY;
  const r2 = localX * localX + localY * localY;
  const wobble = 0.018 * Math.sin(time * 1.7 + drop.seed * 41 + localY * 4);
  const bendX =
    localX * (0.19 + 0.25 * r2) +
    drop.normalX * 0.31 +
    Math.sin(localY * 4.4 + drop.seed * 31 + time * 0.35) * 0.018;
  const bendY =
    localY * (0.19 + 0.25 * r2) +
    drop.normalY * 0.31 +
    Math.cos(localX * 3.7 - drop.seed * 23) * 0.018 +
    wobble * 0.02;
  return [
    (pixelX - bendX * drop.radiusPx * 0.82) / viewportWidthPx,
    (pixelY - bendY * drop.radiusPx * 0.82) / viewportHeightPx,
  ];
}
