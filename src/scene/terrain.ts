// Moon terrain: a sphere of radius R with an impact-crater heightfield
// (raised rim, depressed bowl) plus deterministic low-frequency noise.

import type { Vec3 } from "../math/vec3.ts";
import { normalize, scale, dot, cross, length, sub } from "../math/vec3.ts";

export interface TerrainParams {
  planetRadius: number;      // R, metres
  craterRimRadius: number;   // surface distance from crater centre to rim crest
  craterFloorRadius: number; // flat-ish bowl floor radius
  rimHeight: number;         // rim crest height above sphere
  bowlDepth: number;         // bowl depth below sphere
  noiseAmplitude: number;
}

export const DEFAULT_TERRAIN: TerrainParams = {
  planetRadius: 600,
  craterRimRadius: 120,
  craterFloorRadius: 55,
  rimHeight: 9,
  bowlDepth: 16,
  noiseAmplitude: 0.6,
};

export class Terrain {
  readonly params: TerrainParams;
  /** Unit vector from planet centre to crater centre. */
  readonly craterDir: Vec3;

  constructor(params: TerrainParams = DEFAULT_TERRAIN, craterDir: Vec3 = [0, 1, 0]) {
    this.params = params;
    this.craterDir = normalize(craterDir);
  }

  get planetRadius(): number {
    return this.params.planetRadius;
  }

  /** Surface (great-circle) distance from crater centre for a unit direction. */
  craterDistance(dir: Vec3): number {
    const c = Math.min(1, Math.max(-1, dot(normalize(dir), this.craterDir)));
    return Math.acos(c) * this.params.planetRadius;
  }

  /** Deterministic value noise from a direction (cheap hash-based). */
  private noise(dir: Vec3): number {
    const p = scale(dir, 23.7);
    const s =
      Math.sin(p[0] * 12.9898 + p[1] * 78.233 + p[2] * 37.719) * 43758.5453;
    const f = s - Math.floor(s);
    const s2 =
      Math.sin(p[0] * 4.898 + p[1] * 7.23 + p[2] * 9.719) * 12543.123;
    const f2 = s2 - Math.floor(s2);
    return (f * 0.65 + f2 * 0.35) * 2 - 1; // [-1, 1]
  }

  /** Radial height offset above the base sphere for a unit direction. */
  heightOffset(dirIn: Vec3): number {
    const dir = normalize(dirIn);
    const d = this.craterDistance(dir);
    const p = this.params;
    // Rim crest: gaussian bump centred on the rim radius.
    const sigma = p.craterRimRadius * 0.16;
    const rimD = (d - p.craterRimRadius) / sigma;
    const rim = p.rimHeight * Math.exp(-0.5 * rimD * rimD);
    // Bowl: smooth depression inside the crater.
    let bowl = 0;
    if (d < p.craterRimRadius * 1.1) {
      const t = Math.min(1, d / p.craterFloorRadius);
      const smooth = 1 - t * t * (3 - 2 * t); // 1 at centre -> 0 at floor edge
      const falloff = Math.max(0, 1 - (d / (p.craterRimRadius * 1.1)) ** 4);
      bowl = -p.bowlDepth * smooth * falloff;
    }
    // Gentle ejecta blanket slope outside the rim.
    let ejecta = 0;
    if (d > p.craterRimRadius && d < p.craterRimRadius * 2.5) {
      const t = (d - p.craterRimRadius) / (p.craterRimRadius * 1.5);
      ejecta = p.rimHeight * 0.25 * (1 - t) * (1 - t);
    }
    const noise = this.noise(dir) * p.noiseAmplitude;
    return rim + bowl + ejecta + noise;
  }

  /** World-space surface point for a unit direction. */
  surfacePoint(dir: Vec3): Vec3 {
    const n = normalize(dir);
    const r = this.params.planetRadius + this.heightOffset(n);
    return scale(n, r);
  }

  /** Approximate surface normal (radial is fine for placement & camera). */
  surfaceNormal(dir: Vec3): Vec3 {
    return normalize(dir);
  }

  /** Height of terrain above the base sphere at a world position. */
  heightAtWorld(pos: Vec3): number {
    return length(pos) - this.params.planetRadius;
  }

  /** Tangent basis (east, north) at a unit direction. */
  tangentBasis(dirIn: Vec3): { east: Vec3; north: Vec3 } {
    const up = normalize(dirIn);
    const ref: Vec3 = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const east = normalize(cross(ref, up));
    const north = normalize(cross(up, east));
    return { east, north };
  }

  /** Move from `dir` across the surface by (east, north) metres. */
  offsetDirection(dirIn: Vec3, eastM: number, northM: number): Vec3 {
    const dir = normalize(dirIn);
    const { east, north } = this.tangentBasis(dir);
    const R = this.params.planetRadius;
    const moved: Vec3 = [
      dir[0] + (east[0] * eastM + north[0] * northM) / R,
      dir[1] + (east[1] * eastM + north[1] * northM) / R,
      dir[2] + (east[2] * eastM + north[2] * northM) / R,
    ];
    return normalize(moved);
  }

  /** Great-circle surface distance between two world points near the surface. */
  surfaceDistance(a: Vec3, b: Vec3): number {
    const na = normalize(a);
    const nb = normalize(b);
    const c = Math.min(1, Math.max(-1, dot(na, nb)));
    return Math.acos(c) * this.params.planetRadius;
  }

  /** Straight-line (chord) distance helper. */
  chord(a: Vec3, b: Vec3): number {
    return length(sub(a, b));
  }
}
