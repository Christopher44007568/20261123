// Procedural volcanic teaching-sandbox terrain:
// cone volcano + crater, sinuous lava channels, fault cliff, cinder cone.
export interface TerrainMesh {
  positions: Float32Array;
  normals: Float32Array;
  heights: Float32Array;
  lava: Float32Array;
  indices: Uint32Array;
}

export const WORLD_SIZE = 200;
export const WATER_LEVEL = 1.5;

const VOLCANO = { x: -18, z: -14, radius: 46, height: 44, craterR: 10, craterDepth: 13 };
const CINDER = { x: 52, z: 42, radius: 17, height: 15 };
const CLIFF = { amp: 14, zBase: 34, zWobble: 7, xMin: -85, xMax: 45 };

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Lava channel centerlines: azimuth rays from the crater that meander with radius.
const CHANNELS = [0.5, 2.4, 4.3];

function channelOffset(baseAngle: number, r: number): number {
  return baseAngle + 0.28 * Math.sin(r * 0.16 + baseAngle * 3.0);
}

export function sampleTerrain(x: number, z: number): { h: number; lava: number } {
  // Gentle rolling base plain.
  let h = 2.2 + 1.4 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.05 - 0.6)
        + 0.5 * Math.sin(x * 0.13) * Math.sin(z * 0.11 + 2.0);
  let lava = 0;

  // Main stratovolcano cone with crater.
  {
    const dx = x - VOLCANO.x, dz = z - VOLCANO.z;
    const r = Math.hypot(dx, dz);
    if (r < VOLCANO.radius) {
      const t = 1 - r / VOLCANO.radius;
      h += VOLCANO.height * Math.pow(t, 1.25);
      if (r < VOLCANO.craterR) {
        const c = 1 - (r / VOLCANO.craterR) ** 2;
        h -= VOLCANO.craterDepth * c;
      }
      // Rim jitter gives the summit rock layers a jagged silhouette.
      const rim = Math.exp(-((r - VOLCANO.craterR) ** 2) / 6);
      h += rim * 1.0 * Math.sin(Math.atan2(dz, dx) * 9.0);
    }
    // Lava channels carved from the rim down the flank.
    if (r > 6 && r < 62) {
      const ang = Math.atan2(dz, dx);
      for (const base of CHANNELS) {
        const center = channelOffset(base, r);
        let da = ang - center;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        const width = 0.09 + r * 0.0012;
        const across = Math.exp(-(da * da) / (2 * width * width));
        const along = smoothstep(6, 12, r) * (1 - smoothstep(38, 62, r));
        const carve = across * along;
        h -= 3.2 * carve * Math.min(1, r / 30);
        lava = Math.max(lava, Math.min(1, carve * 1.6));
      }
    }
  }

  // Secondary sharp cinder cone (steep rocky peak).
  {
    const dx = x - CINDER.x, dz = z - CINDER.z;
    const r = Math.hypot(dx, dz);
    if (r < CINDER.radius) {
      const t = 1 - r / CINDER.radius;
      h += CINDER.height * Math.pow(t, 1.7);
    }
  }

  // Fault cliff: abrupt step across a wobbling line.
  {
    const zLine = CLIFF.zBase + CLIFF.zWobble * Math.sin(x * 0.06 + 0.8);
    const inX = smoothstep(CLIFF.xMin, CLIFF.xMin + 6, x) * (1 - smoothstep(CLIFF.xMax - 6, CLIFF.xMax, x));
    h += CLIFF.amp * smoothstep(zLine - 2.0, zLine + 2.0, z) * inX;
  }

  return { h, lava };
}

export function buildTerrain(grid: number): TerrainMesh {
  const n = grid + 1;
  const positions = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  const heights = new Float32Array(n * n);
  const lava = new Float32Array(n * n);
  const step = WORLD_SIZE / grid;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -WORLD_SIZE / 2 + i * step;
      const z = -WORLD_SIZE / 2 + j * step;
      const s = sampleTerrain(x, z);
      const idx = j * n + i;
      positions[idx * 3] = x;
      positions[idx * 3 + 1] = s.h;
      positions[idx * 3 + 2] = z;
      heights[idx] = s.h;
      lava[idx] = s.lava;
    }
  }
  // Smoothed normals via central differences (stable, flicker-free).
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const idx = j * n + i;
      const il = j * n + Math.max(0, i - 1), ir = j * n + Math.min(grid, i + 1);
      const jd = Math.max(0, j - 1) * n + i, ju = Math.min(grid, j + 1) * n + i;
      const sx = (heights[ir] - heights[il]) / ((ir - il) * step || 1);
      const sz = (heights[ju] - heights[jd]) / ((ju - jd) * step || 1);
      const inv = 1 / Math.hypot(sx, 1, sz);
      normals[idx * 3] = -sx * inv;
      normals[idx * 3 + 1] = inv;
      normals[idx * 3 + 2] = -sz * inv;
    }
  }
  const indices = new Uint32Array(grid * grid * 6);
  let k = 0;
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      indices[k++] = a; indices[k++] = c; indices[k++] = b;
      indices[k++] = b; indices[k++] = c; indices[k++] = d;
    }
  }
  return { positions, normals, heights, lava, indices };
}

export function buildWaterPlane(): { positions: Float32Array; indices: Uint32Array } {
  const h = WORLD_SIZE / 2;
  const positions = new Float32Array([
    -h, WATER_LEVEL, -h, h, WATER_LEVEL, -h, h, WATER_LEVEL, h, -h, WATER_LEVEL, h,
  ]);
  const indices = new Uint32Array([0, 2, 1, 0, 3, 2]);
  return { positions, indices };
}
