// CPU-side geometry: unit cube, terrain grid bent onto the planet, and
// debug line geometry (horizon sphere rings + camera horizon circle).

import type { Vec3 } from "../math/vec3.ts";
import { normalize, scale, add, cross, sub } from "../math/vec3.ts";
import { Terrain } from "../scene/terrain.ts";

export interface MeshData {
  positions: Float32Array<ArrayBuffer>;
  normals: Float32Array<ArrayBuffer>;
  indices: Uint32Array<ArrayBuffer>;
}

/** Unit cube centred at origin, side 1, 24 verts (flat normals). */
export function unitCube(): MeshData {
  const p: number[] = [];
  const n: number[] = [];
  const idx: number[] = [];
  const faces: { nrm: Vec3; corners: Vec3[] }[] = [
    { nrm: [1, 0, 0], corners: [[0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5]] },
    { nrm: [-1, 0, 0], corners: [[-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, -0.5]] },
    { nrm: [0, 1, 0], corners: [[-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5]] },
    { nrm: [0, -1, 0], corners: [[-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5]] },
    { nrm: [0, 0, 1], corners: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
    { nrm: [0, 0, -1], corners: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
  ];
  for (const f of faces) {
    const base = p.length / 3;
    for (const c of f.corners) {
      p.push(c[0], c[1], c[2]);
      n.push(f.nrm[0], f.nrm[1], f.nrm[2]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return {
    positions: new Float32Array(p),
    normals: new Float32Array(n),
    indices: new Uint32Array(idx),
  };
}

/**
 * Terrain grid: `verts` x `verts` samples over `sizeM` metres of tangent
 * plane around the crater centre, bent onto the sphere with heights.
 */
export function terrainMesh(terrain: Terrain, sizeM = 560, verts = 180): MeshData {
  const p: number[] = [];
  const idx: number[] = [];
  const half = sizeM / 2;
  const dirs: Vec3[] = [];
  for (let j = 0; j < verts; j++) {
    for (let i = 0; i < verts; i++) {
      const east = -half + (sizeM * i) / (verts - 1);
      const north = -half + (sizeM * j) / (verts - 1);
      const dir = terrain.offsetDirection(terrain.craterDir, east, north);
      dirs.push(dir);
      const pt = terrain.surfacePoint(dir);
      p.push(pt[0], pt[1], pt[2]);
    }
  }
  for (let j = 0; j < verts - 1; j++) {
    for (let i = 0; i < verts - 1; i++) {
      const a = j * verts + i;
      const b = a + 1;
      const c = a + verts;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // Normals: radial plus height-gradient correction via neighbours.
  const n = new Float32Array(p.length);
  const posAt = (k: number): Vec3 => [p[k * 3]!, p[k * 3 + 1]!, p[k * 3 + 2]!];
  for (let j = 0; j < verts; j++) {
    for (let i = 0; i < verts; i++) {
      const k = j * verts + i;
      const iP = i < verts - 1 ? k + 1 : k;
      const iM = i > 0 ? k - 1 : k;
      const jP = j < verts - 1 ? k + verts : k;
      const jM = j > 0 ? k - verts : k;
      const di = sub(posAt(iP), posAt(iM));
      const dj = sub(posAt(jP), posAt(jM));
      const nrm = normalize(cross(dj, di));
      // orient outward
      const up = dirs[k]!;
      const s = nrm[0] * up[0] + nrm[1] * up[1] + nrm[2] * up[2] >= 0 ? 1 : -1;
      n[k * 3] = nrm[0] * s;
      n[k * 3 + 1] = nrm[1] * s;
      n[k * 3 + 2] = nrm[2] * s;
    }
  }
  return {
    positions: new Float32Array(p),
    normals: n,
    indices: new Uint32Array(idx),
  };
}

export interface LineData {
  positions: Float32Array<ArrayBuffer>;
  colors: Float32Array<ArrayBuffer>;
}

/** Wireframe sphere (lat/long rings) for the horizon debug sphere. */
export function sphereRings(radius: number, color: [number, number, number, number]): LineData {
  const p: number[] = [];
  const c: number[] = [];
  const SEG = 96;
  const push = (a: Vec3, b: Vec3) => {
    p.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    c.push(...color, ...color);
  };
  const rings = 7;
  for (let r = 0; r < rings; r++) {
    const phi = (Math.PI * (r + 1)) / (rings + 1);
    const y = Math.cos(phi) * radius;
    const rr = Math.sin(phi) * radius;
    for (let s = 0; s < SEG; s++) {
      const a0 = (2 * Math.PI * s) / SEG;
      const a1 = (2 * Math.PI * (s + 1)) / SEG;
      push(
        [rr * Math.cos(a0), y, rr * Math.sin(a0)],
        [rr * Math.cos(a1), y, rr * Math.sin(a1)],
      );
    }
  }
  for (let m = 0; m < 6; m++) {
    const lon = (Math.PI * m) / 6;
    for (let s = 0; s < SEG; s++) {
      const t0 = (2 * Math.PI * s) / SEG;
      const t1 = (2 * Math.PI * (s + 1)) / SEG;
      const rot = (v: Vec3): Vec3 => [
        v[0] * Math.cos(lon) + v[2] * Math.sin(lon),
        v[1],
        -v[0] * Math.sin(lon) + v[2] * Math.cos(lon),
      ];
      push(
        rot([radius * Math.sin(t0), radius * Math.cos(t0), 0]),
        rot([radius * Math.sin(t1), radius * Math.cos(t1), 0]),
      );
    }
  }
  return { positions: new Float32Array(p), colors: new Float32Array(c) };
}

/**
 * Camera horizon circle: the ring of tangent points from the camera to the
 * planet, plus 4 tangent rays. Recomputed per frame when debug is on.
 */
export function horizonCircle(camera: Vec3, planetRadius: number): LineData {
  const p: number[] = [];
  const c: number[] = [];
  const d = Math.hypot(camera[0], camera[1], camera[2]);
  const ringColor: [number, number, number, number] = [0.2, 0.9, 1.0, 1.0];
  const rayColor: [number, number, number, number] = [1.0, 0.8, 0.2, 1.0];
  if (d <= planetRadius) {
    return { positions: new Float32Array(), colors: new Float32Array() };
  }
  // circle centre = O + (R^2/d^2) * C, radius = R * L / d
  const k = (planetRadius * planetRadius) / (d * d);
  const center: Vec3 = [camera[0] * k, camera[1] * k, camera[2] * k];
  const L = Math.sqrt(d * d - planetRadius * planetRadius);
  const ringR = (planetRadius * L) / d;
  const axis = normalize(camera); // O -> C
  const ref: Vec3 = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = normalize(cross(ref, axis));
  const e2 = normalize(cross(axis, e1));
  const SEG = 128;
  const ringPt = (t: number): Vec3 =>
    add(center, add(scale(e1, Math.cos(t) * ringR), scale(e2, Math.sin(t) * ringR)));
  for (let s = 0; s < SEG; s++) {
    const a = ringPt((2 * Math.PI * s) / SEG);
    const b = ringPt((2 * Math.PI * (s + 1)) / SEG);
    p.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    c.push(...ringColor, ...ringColor);
  }
  for (let q = 0; q < 8; q++) {
    const tp = ringPt((2 * Math.PI * q) / 8);
    p.push(camera[0], camera[1], camera[2], tp[0], tp[1], tp[2]);
    c.push(...rayColor, ...rayColor);
  }
  return { positions: new Float32Array(p), colors: new Float32Array(c) };
}
