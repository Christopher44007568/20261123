/**
 * Deterministic, seedable PRNG utilities.
 * Everything in the mine (tunnels, pillars, platforms, color jitter) is
 * derived from these functions so two runs with the same seed are identical.
 */

export const FIXED_SEED = 0x5a17_2026;

/** 32-bit string hash (FNV-1a style), used to derive numeric seeds. */
export function hashString(text: string): number {
  let h = 0x811c_9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x0100_0193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Integer in [min, max]. */
export function randInt(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

/**
 * Stable per-cell 3D hash in [0, 1). Allows the generator to stay stateless
 * while still producing deterministic noise at arbitrary coordinates.
 */
export function hash3(seed: number, x: number, y: number, z: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (x | 0), 0x9e37_79b1);
  h = Math.imul(h ^ (y | 0), 0x85eb_ca6b);
  h = Math.imul(h ^ (z | 0), 0xc2b2_ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb_35d5);
  h ^= h >>> 15;
  return (h >>> 0) / 4_294_967_296;
}

/** Value-noise lattice sampling with smooth interpolation, periodic on [0, period). */
export function valueNoise3(
  seed: number,
  x: number,
  y: number,
  z: number,
  period: number,
): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const at = (ox: number, oy: number, oz: number) => {
    const lx = ((xi + ox) % period + period) % period;
    const ly = ((yi + oy) % period + period) % period;
    const lz = ((zi + oz) % period + period) % period;
    return hash3(seed, lx, ly, lz);
  };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const x00 = lerp(at(0, 0, 0), at(1, 0, 0), u);
  const x10 = lerp(at(0, 1, 0), at(1, 1, 0), u);
  const x01 = lerp(at(0, 0, 1), at(1, 0, 1), u);
  const x11 = lerp(at(0, 1, 1), at(1, 1, 1), u);
  const y0 = lerp(x00, x10, v);
  const y1 = lerp(x01, x11, v);
  return lerp(y0, y1, w);
}
