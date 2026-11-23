import { Vec3 } from '../math/vec3.js';

export const MAX_LIGHTS = 8;
export const GHOST_COUNT = 6;

export interface GhostDef {
  k: number;
  radiusNdc: number;
  intensity: number;
  blades: number;
  ring: number;
  dispersion: number;
}

export interface LightSource {
  position: Vec3;
  color: Vec3;
  intensity: number;
  radius: number;
  beacon: boolean;
}

const REFERENCE_F_NUMBER = 2.8;

const REFERENCE_GHOSTS: ReadonlyArray<{
  k: number;
  radius: number;
  weight: number;
  blades: number;
  ring: number;
  dispersion: number;
}> = [
  { k: 0.18, radius: 0.012, weight: 0.55, blades: 7, ring: 0.05, dispersion: 1.0 },
  { k: 0.38, radius: 0.018, weight: 0.46, blades: 7, ring: 0.08, dispersion: 1.4 },
  { k: 0.62, radius: 0.025, weight: 0.38, blades: 7, ring: 0.04, dispersion: 1.8 },
  { k: 0.90, radius: 0.033, weight: 0.30, blades: 7, ring: 0.10, dispersion: 2.2 },
  { k: 1.20, radius: 0.042, weight: 0.23, blades: 7, ring: 0.05, dispersion: 2.8 },
  { k: 1.55, radius: 0.052, weight: 0.16, blades: 7, ring: 0.11, dispersion: 3.4 },
];

export function buildGhostDefs(focalMm: number, fNumber: number): GhostDef[] {
  const apertureFactor = REFERENCE_F_NUMBER / fNumber;
  const focalFactor = focalMm / 35;
  const throughput = Math.pow(apertureFactor, 2);
  return REFERENCE_GHOSTS.map((g) => ({
    k: g.k * focalFactor,
    radiusNdc: g.radius * apertureFactor,
    intensity: g.weight * throughput,
    blades: g.blades,
    ring: g.ring,
    dispersion: g.dispersion,
  }));
}

export function lightAngularRadiusNdc(
  lightRadius: number,
  distance: number,
  tanHalfFovY: number,
): number {
  if (distance <= 1e-4) return 1;
  return Math.min(1, Math.atan(lightRadius / distance) / tanHalfFovY);
}

export const CHROMATIC_SHIFTS = {
  r: 0.986,
  g: 1.0,
  b: 1.016,
} as const;

export function beaconPulse(timeSeconds: number): number {
  const phase = timeSeconds % 2.4;
  const sweep = Math.exp(-Math.pow((phase - 0.6) / 0.18, 2));
  const idle = 0.12 + 0.08 * Math.sin(timeSeconds * 3.1);
  return Math.min(1, idle + sweep * 0.9);
}
