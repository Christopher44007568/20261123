// Lunar base object generation: habitat modules, solar panels, comm towers
// scattered on the curved terrain around the crater.

import type { Vec3 } from "../math/vec3.ts";
import { add, scale, normalize, rotateAround, cross } from "../math/vec3.ts";
import { Terrain } from "./terrain.ts";

export type ObjectType = "module" | "panel" | "tower";

export interface SceneObject {
  id: number;
  type: ObjectType;
  /** Base attachment point on the terrain surface. */
  position: Vec3;
  /** Surface up at placement. */
  up: Vec3;
  yaw: number;
  /** Local footprint/half-extents: [width, height, depth] full sizes. */
  size: Vec3;
  /** Bounding sphere (world). */
  bsCenter: Vec3;
  bsRadius: number;
  /** World-space AABB corners (8). */
  aabbCorners: Vec3[];
  /** Reference visibility sample points (corners + top-face grid). */
  refPoints: Vec3[];
}

/** Deterministic PRNG (mulberry32). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function localFrame(up: Vec3, yaw: number): { right: Vec3; fwd: Vec3; up: Vec3 } {
  const ref: Vec3 = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const right0 = normalize(cross(ref, up));
  const fwd0 = normalize(cross(up, right0));
  const right = rotateAround(right0, up, yaw);
  const fwd = rotateAround(fwd0, up, yaw);
  return { right, fwd, up };
}

/** Build the 8 world corners of the object's oriented box. */
export function objectCorners(
  position: Vec3,
  up: Vec3,
  yaw: number,
  size: Vec3,
): Vec3[] {
  const f = localFrame(up, yaw);
  const [w, h, d] = size;
  const corners: Vec3[] = [];
  for (const sy of [0, 1]) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        let p = add(position, scale(f.up, sy * h));
        p = add(p, scale(f.right, (sx * w) / 2));
        p = add(p, scale(f.fwd, (sz * d) / 2));
        corners.push(p);
      }
    }
  }
  return corners;
}

function boundingSphere(corners: Vec3[]): { center: Vec3; radius: number } {
  let c: Vec3 = [0, 0, 0];
  for (const p of corners) c = add(c, p);
  c = scale(c, 1 / corners.length);
  let r = 0;
  for (const p of corners) {
    const dx = p[0] - c[0];
    const dy = p[1] - c[1];
    const dz = p[2] - c[2];
    r = Math.max(r, Math.hypot(dx, dy, dz));
  }
  return { center: c, radius: r };
}

/** Reference sample points: 8 corners + 3x3 grid on the top face. */
function referencePoints(corners: Vec3[]): Vec3[] {
  const pts: Vec3[] = [...corners];
  // corners are ordered: y0 ring (0..3), y1 ring (4..7)
  const top = corners.slice(4, 8);
  for (let i = 1; i <= 2; i++) {
    for (let j = 1; j <= 2; j++) {
      const u = i / 3;
      const v = j / 3;
      // bilinear interpolation over the top face
      const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ];
      const e0 = lerp(top[0]!, top[1]!, u);
      const e1 = lerp(top[2]!, top[3]!, u);
      pts.push(lerp(e0, e1, v));
    }
  }
  return pts;
}

export function makeObject(
  id: number,
  type: ObjectType,
  position: Vec3,
  up: Vec3,
  yaw: number,
  size: Vec3,
): SceneObject {
  const corners = objectCorners(position, up, yaw, size);
  const bs = boundingSphere(corners);
  return {
    id,
    type,
    position,
    up,
    yaw,
    size,
    bsCenter: bs.center,
    bsRadius: bs.radius,
    aabbCorners: corners,
    refPoints: referencePoints(corners),
  };
}

export interface SceneSpec {
  count: number;
  /** Fractions must sum to ~1. */
  mix: { module: number; panel: number; tower: number };
  /** Scatter radius (surface metres) around the crater centre. */
  scatterRadius: number;
  seed: number;
}

export const DEFAULT_SCENE: SceneSpec = {
  count: 640,
  mix: { module: 0.45, panel: 0.35, tower: 0.2 },
  scatterRadius: 260,
  seed: 1337,
};

export function generateScene(terrain: Terrain, spec: SceneSpec = DEFAULT_SCENE): SceneObject[] {
  const rng = makeRng(spec.seed);
  const objects: SceneObject[] = [];
  for (let i = 0; i < spec.count; i++) {
    // Uniform-ish scatter in a disc on the tangent plane around the crater.
    const ang = rng() * Math.PI * 2;
    const rad = spec.scatterRadius * Math.sqrt(rng());
    const east = Math.cos(ang) * rad;
    const north = Math.sin(ang) * rad;
    const dir = terrain.offsetDirection(terrain.craterDir, east, north);
    const pos = terrain.surfacePoint(dir);
    const up = terrain.surfaceNormal(dir);
    const yaw = rng() * Math.PI * 2;

    const pick = rng();
    let type: ObjectType;
    let size: Vec3;
    if (pick < spec.mix.module) {
      type = "module";
      size = [6 + rng() * 6, 3 + rng() * 1.5, 3 + rng() * 2];
    } else if (pick < spec.mix.module + spec.mix.panel) {
      type = "panel";
      size = [5 + rng() * 3, 2.5 + rng() * 1.5, 0.4];
    } else {
      type = "tower";
      size = [1.2, 22 + rng() * 16, 1.2]; // tall, thin: tips emerge over horizon
    }
    objects.push(makeObject(i, type, pos, up, yaw, size));
  }
  return objects;
}
