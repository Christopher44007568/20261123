export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export function normalize(a: Vec3): Vec3 {
  const len = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Integer log2 for powers of two. */
export function log2Int(v: number): number {
  return 31 - Math.clz32(v);
}

/** Morton-ish octree key from integer cell coordinates and node size. */
export function makeNodeKey(x: number, y: number, z: number, size: number): number {
  // Coordinates are always size-aligned, so quantized coordinates fit in 9
  // bits each; the remaining high bits store the power-of-two size exponent.
  const shift = log2Int(size);
  const ix = x >>> shift;
  const iy = y >>> shift;
  const iz = z >>> shift;
  return (ix & 0x1ff) | ((iy & 0x1ff) << 9) | ((iz & 0x1ff) << 18) | (shift << 27);
}
