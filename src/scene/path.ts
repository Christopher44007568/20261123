// Inspection walk path: starts on the crater rim crest and descends into the
// bowl, staying at eye height above the terrain. Shared by the WebGPU app
// and the headless validation walk.

import type { Vec3 } from "../math/vec3.ts";
import { add, scale } from "../math/vec3.ts";
import { Terrain } from "./terrain.ts";

export interface WalkFrame {
  /** Camera world position. */
  eye: Vec3;
  /** Look-at target (ahead along the path, toward the crater centre). */
  target: Vec3;
  up: Vec3;
  /** Surface distance from the crater centre (metres). */
  craterDistance: number;
}

export interface WalkParams {
  eyeHeight: number;
  /** Start surface-distance from crater centre (beyond the rim crest). */
  startDistance: number;
  /** End surface-distance (near the bowl floor centre). */
  endDistance: number;
}

export const DEFAULT_WALK: WalkParams = {
  eyeHeight: 1.8,
  startDistance: 150, // outside the 120 m rim crest
  endDistance: 8,
};

/** Direction at a given surface distance from the crater centre, heading east. */
function dirAtDistance(terrain: Terrain, dist: number): Vec3 {
  // Start from the crater centre and walk "east" by dist metres.
  return terrain.offsetDirection(terrain.craterDir, dist, 0);
}

export function walkFrame(terrain: Terrain, params: WalkParams, t: number): WalkFrame {
  const dist = params.startDistance + (params.endDistance - params.startDistance) * t;
  const dir = dirAtDistance(terrain, dist);
  const surface = terrain.surfacePoint(dir);
  const up = terrain.surfaceNormal(dir);
  const eye = add(surface, scale(up, params.eyeHeight));
  // Look ahead toward the crater centre (and slightly down the slope).
  const aheadDist = Math.max(params.endDistance, dist - 12);
  const aheadDir = dirAtDistance(terrain, aheadDist);
  const aheadSurface = terrain.surfacePoint(aheadDir);
  const target = add(aheadSurface, scale(terrain.surfaceNormal(aheadDir), params.eyeHeight * 0.5));
  return { eye, target, up, craterDistance: dist };
}

/** Total walk length in metres. */
export function walkLength(params: WalkParams): number {
  return Math.abs(params.startDistance - params.endDistance);
}
