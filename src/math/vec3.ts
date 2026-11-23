// Minimal 3D vector math (erasable-syntax TS so Node can run it directly).

export type Vec3 = [number, number, number];

export function v3(x: number, y: number, z: number): Vec3 {
  return [x, y, z];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  if (len < 1e-12) return [0, 0, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

/** Angle (radians) between vectors a and b. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const la = length(a);
  const lb = length(b);
  if (la < 1e-12 || lb < 1e-12) return 0;
  let c = dot(a, b) / (la * lb);
  c = Math.min(1, Math.max(-1, c));
  return Math.acos(c);
}

/** Rodrigues rotation of v around unit axis k by angle theta. */
export function rotateAround(v: Vec3, k: Vec3, theta: number): Vec3 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const kv = cross(k, v);
  const kdv = dot(k, v) * (1 - c);
  return [
    v[0] * c + kv[0] * s + k[0] * kdv,
    v[1] * c + kv[1] * s + k[1] * kdv,
    v[2] * c + kv[2] * s + k[2] * kdv,
  ];
}
