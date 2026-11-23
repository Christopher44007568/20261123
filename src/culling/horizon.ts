// Planetary-curvature horizon culling.
//
// Geometry: planet centre O at the origin, radius R. Camera C with d = |C| > R.
// A point X is occluded iff segment C->X intersects the planet before reaching X.
// The occluded region is the tangent cone from C to the planet, beyond the
// tangent points:
//   - horizon half-angle alpha with sin(alpha) = R / d
//   - tangent (slant) length L = sqrt(d^2 - R^2)

import type { Vec3 } from "../math/vec3.ts";
import { length, sub } from "../math/vec3.ts";

export interface HorizonContext {
  d: number; // |C - O|
  sinAlpha: number;
  cosAlpha: number;
  alpha: number; // horizon half-angle
  tangentLength: number; // L = sqrt(d^2 - R^2)
  axisToCenter: Vec3; // unit vector C -> O
  camera: Vec3;
  planetRadius: number;
}

export function makeHorizonContext(camera: Vec3, planetRadius: number): HorizonContext {
  const d = Math.max(length(camera), planetRadius + 1e-6);
  const sinAlpha = planetRadius / d;
  const cosAlpha = Math.sqrt(Math.max(0, 1 - sinAlpha * sinAlpha));
  return {
    d,
    sinAlpha,
    cosAlpha,
    alpha: Math.asin(Math.min(1, sinAlpha)),
    tangentLength: Math.sqrt(Math.max(0, d * d - planetRadius * planetRadius)),
    axisToCenter: [-camera[0] / d, -camera[1] / d, -camera[2] / d],
    camera,
    planetRadius,
  };
}

/**
 * Exact point occlusion test (ground truth).
 * Ray C + t*u hits the sphere iff b > 0 and b*b >= c, where b = u.(O-C),
 * c = d^2 - R^2. Near root t1 = b - sqrt(b^2 - c). Occluded iff dist > t1.
 */
export function isPointOccluded(ctx: HorizonContext, x: Vec3): boolean {
  const w = sub(x, ctx.camera);
  const dist = length(w);
  if (dist < 1e-9) return false;
  const inv = 1 / dist;
  const toO: Vec3 = [-ctx.camera[0], -ctx.camera[1], -ctx.camera[2]];
  const b = (w[0] * toO[0] + w[1] * toO[1] + w[2] * toO[2]) * inv;
  if (b <= 0) return false; // planet centre behind the direction to X
  const c = ctx.d * ctx.d - ctx.planetRadius * ctx.planetRadius;
  const disc = b * b - c;
  if (disc <= 0) return false; // ray misses the planet
  const t1 = b - Math.sqrt(disc);
  return dist > t1;
}

/** Same as isPointOccluded but requires an extra slant margin (conservative). */
function isPointOccludedWithMargin(ctx: HorizonContext, x: Vec3, margin: number): boolean {
  const w = sub(x, ctx.camera);
  const dist = length(w);
  if (dist < 1e-9) return false;
  const inv = 1 / dist;
  const toO: Vec3 = [-ctx.camera[0], -ctx.camera[1], -ctx.camera[2]];
  const b = (w[0] * toO[0] + w[1] * toO[1] + w[2] * toO[2]) * inv;
  if (b <= 0) return false;
  const c = ctx.d * ctx.d - ctx.planetRadius * ctx.planetRadius;
  const disc = b * b - c;
  if (disc <= 0) return false;
  const t1 = b - Math.sqrt(disc);
  return dist > t1 + margin;
}

export type CullVerdict = "culled" | "visible" | "inconclusive";

/**
 * Conservative bounding-sphere horizon test.
 * "culled" only when the ENTIRE sphere is guaranteed occluded:
 *   (a) sphere angular extent from C fits inside the horizon cone
 *       (gamma + beta < alpha), and
 *   (b) sphere's nearest point lies beyond every possible tangent distance
 *       (dist - r > L, since t_near <= L for all directions).
 * Otherwise "visible": never culls an object peeking over the silhouette.
 */
export function testBoundingSphere(
  ctx: HorizonContext,
  center: Vec3,
  radius: number,
): CullVerdict {
  const w = sub(center, ctx.camera);
  const dist = length(w);
  if (dist <= radius) return "visible"; // camera inside the sphere
  const cosGamma =
    (w[0] * ctx.axisToCenter[0] + w[1] * ctx.axisToCenter[1] + w[2] * ctx.axisToCenter[2]) / dist;
  const gamma = Math.acos(Math.min(1, Math.max(-1, cosGamma)));
  const beta = Math.asin(Math.min(1, radius / dist));
  if (gamma + beta >= ctx.alpha) return "visible";
  if (dist - radius <= ctx.tangentLength) return "visible";
  return "culled";
}

/**
 * AABB corner fallback: cull only if ALL 8 corners are exactly occluded
 * (with a small slant margin). Tighter than the node bounding sphere when
 * the sphere is loose, still conservative for silhouette peekers.
 */
export function testAabbCorners(
  ctx: HorizonContext,
  corners: Vec3[],
  slantMargin = 0.05,
): CullVerdict {
  for (const p of corners) {
    if (!isPointOccludedWithMargin(ctx, p, slantMargin)) return "visible";
  }
  return "culled";
}


