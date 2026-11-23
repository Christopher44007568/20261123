import { clamp } from "./math";

export class DeterministicNoise {
  private readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
  }

  hash2(ix: number, iy: number, salt = 0): number {
    let h = (ix * 374761393 + iy * 668265263 + this.seed * 1442695041 + salt * 3266489917) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }

  value2(x: number, y: number, salt = 0): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = this.hash2(ix, iy, salt);
    const b = this.hash2(ix + 1, iy, salt);
    const c = this.hash2(ix, iy + 1, salt);
    const d = this.hash2(ix + 1, iy + 1, salt);
    const ab = a + (b - a) * ux;
    const cd = c + (d - c) * ux;
    return ab + (cd - ab) * uy;
  }

  fbm2(x: number, y: number, octaves = 4, salt = 0): number {
    let value = 0;
    let amp = 0.5;
    let norm = 0;
    let px = x;
    let py = y;
    for (let i = 0; i < octaves; i++) {
      value += this.value2(px, py, salt + i * 17) * amp;
      norm += amp;
      amp *= 0.5;
      px = px * 2.03 + 13.1;
      py = py * 2.01 - 7.7;
    }
    return value / norm;
  }

  ridged2(x: number, y: number, octaves = 4, salt = 0): number {
    let value = 0;
    let amp = 0.5;
    let norm = 0;
    let px = x;
    let py = y;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.value2(px, py, salt + i * 31) * 2 - 1);
      value += n * n * amp;
      norm += amp;
      amp *= 0.5;
      px = px * 2.07 - 3.9;
      py = py * 2.03 + 11.3;
    }
    return clamp(value / norm, 0, 1);
  }

  random01(salt: number): number {
    return this.hash2(0, 0, salt);
  }
}
