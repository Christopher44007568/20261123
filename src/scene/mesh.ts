import { Vec3, add, cross, normalize, scale, sub } from '../math/vec3.js';

export interface Mesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

interface Accumulator {
  positions: number[];
  normals: number[];
  indices: number[];
}

function quad(acc: Accumulator, a: Vec3, b: Vec3, c: Vec3, d: Vec3, normalHint?: Vec3): void {
  const base = acc.positions.length / 3;
  const n = normalHint ?? normalize(cross(sub(b, a), sub(c, a)));
  for (const p of [a, b, c, d]) acc.positions.push(p[0], p[1], p[2]);
  for (let i = 0; i < 4; i++) acc.normals.push(n[0], n[1], n[2]);
  acc.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

export function boxMesh(size: Vec3, center: Vec3 = [0, 0, 0]): Mesh {
  const hx = size[0] / 2;
  const hy = size[1] / 2;
  const hz = size[2] / 2;
  const cx = center[0];
  const cy = center[1];
  const cz = center[2];
  const p = (x: number, y: number, z: number): Vec3 => [cx + x, cy + y, cz + z];
  const acc: Accumulator = { positions: [], normals: [], indices: [] };
  quad(acc, p(-hx, -hy, hz), p(hx, -hy, hz), p(hx, hy, hz), p(-hx, hy, hz), [0, 0, 1]);
  quad(acc, p(hx, -hy, -hz), p(-hx, -hy, -hz), p(-hx, hy, -hz), p(hx, hy, -hz), [0, 0, -1]);
  quad(acc, p(hx, -hy, hz), p(hx, -hy, -hz), p(hx, hy, -hz), p(hx, hy, hz), [1, 0, 0]);
  quad(acc, p(-hx, -hy, -hz), p(-hx, -hy, hz), p(-hx, hy, hz), p(-hx, hy, -hz), [-1, 0, 0]);
  quad(acc, p(-hx, hy, hz), p(hx, hy, hz), p(hx, hy, -hz), p(-hx, hy, -hz), [0, 1, 0]);
  quad(acc, p(-hx, -hy, -hz), p(hx, -hy, -hz), p(hx, -hy, hz), p(-hx, -hy, hz), [0, -1, 0]);
  return finalize(acc);
}

export function cylinderBetween(a: Vec3, b: Vec3, radius: number, segments = 8): Mesh {
  const axis = sub(b, a);
  const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const dir = scale(axis, 1 / len);
  const ref: Vec3 = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize(cross(ref, dir));
  const v = normalize(cross(dir, u));
  const acc: Accumulator = { positions: [], normals: [], indices: [] };
  for (let ring = 0; ring < 2; ring++) {
    const center = ring === 0 ? a : b;
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const radial = add(scale(u, Math.cos(angle)), scale(v, Math.sin(angle)));
      const pos = add(center, scale(radial, radius));
      acc.positions.push(pos[0], pos[1], pos[2]);
      acc.normals.push(radial[0], radial[1], radial[2]);
    }
  }
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    acc.indices.push(i, j, segments + j, i, segments + j, segments + i);
  }
  return finalize(acc);
}

export function terrainMesh(size: number, segments: number, heightFn: (x: number, z: number) => number): Mesh {
  const acc: Accumulator = { positions: [], normals: [], indices: [] };
  const half = size / 2;
  const step = size / segments;
  for (let iz = 0; iz <= segments; iz++) {
    for (let ix = 0; ix <= segments; ix++) {
      const x = -half + ix * step;
      const z = -half + iz * step;
      const y = heightFn(x, z);
      acc.positions.push(x, y, z);
      const dx = (heightFn(x + 0.5, z) - heightFn(x - 0.5, z)) / 1;
      const dz = (heightFn(x, z + 0.5) - heightFn(x, z - 0.5)) / 1;
      const n = normalize([-dx, 1, -dz]);
      acc.normals.push(n[0], n[1], n[2]);
    }
  }
  const row = segments + 1;
  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = iz * row + ix;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      acc.indices.push(a, c, b, b, c, d);
    }
  }
  return finalize(acc);
}

export function mergeMeshes(meshes: Mesh[]): Mesh {
  const acc: Accumulator = { positions: [], normals: [], indices: [] };
  for (const mesh of meshes) {
    const offset = acc.positions.length / 3;
    acc.positions.push(...mesh.positions);
    acc.normals.push(...mesh.normals);
    for (const idx of mesh.indices) acc.indices.push(idx + offset);
  }
  return finalize(acc);
}

function finalize(acc: Accumulator): Mesh {
  return {
    positions: new Float32Array(acc.positions),
    normals: new Float32Array(acc.normals),
    indices: new Uint32Array(acc.indices),
  };
}
