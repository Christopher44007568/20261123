import { cross, normalize } from "../math";
import { evaluatePage, SURFACES } from "./scene";
import { LOD_CELLS, type PageRecord } from "./types";

export interface GridData {
  cells: number;
  vertsPerAxis: number;
  positions: Float32Array;
  normals: Float32Array;
  tints: Float32Array;
}

function accumulateNormal(
  normals: Float32Array,
  a: number,
  b: number,
  c: number,
  p: Float32Array,
): void {
  const ax = p[a * 3]!;
  const ay = p[a * 3 + 1]!;
  const az = p[a * 3 + 2]!;
  const e1x = p[b * 3]! - ax;
  const e1y = p[b * 3 + 1]! - ay;
  const e1z = p[b * 3 + 2]! - az;
  const e2x = p[c * 3]! - ax;
  const e2y = p[c * 3 + 1]! - ay;
  const e2z = p[c * 3 + 2]! - az;
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  for (const index of [a, b, c]) {
    normals[index * 3] = normals[index * 3]! + nx;
    normals[index * 3 + 1] = normals[index * 3 + 1]! + ny;
    normals[index * 3 + 2] = normals[index * 3 + 2]! + nz;
  }
}

export function generatePageGrid(page: PageRecord, lod: number): GridData {
  const cells = LOD_CELLS[lod]!;
  const vertsPerAxis = cells + 1;
  const vertexCount = vertsPerAxis * vertsPerAxis;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const tints = new Float32Array(vertexCount * 2);
  const flip = SURFACES[page.surfaceIndex]!.flipWinding === true;

  for (let iy = 0; iy < vertsPerAxis; iy++) {
    const tv = iy / cells;
    const v = page.v0 + (page.v1 - page.v0) * tv;
    for (let ix = 0; ix < vertsPerAxis; ix++) {
      const tu = ix / cells;
      const u = page.u0 + (page.u1 - page.u0) * tu;
      const index = iy * vertsPerAxis + ix;
      const p = evaluatePage(page, u, v);
      positions[index * 3] = p[0];
      positions[index * 3 + 1] = p[1];
      positions[index * 3 + 2] = p[2];
      const h = Math.sin(p[0] * 0.83 + p[1] * 1.71 + p[2] * 0.47);
      tints[index * 2] = 0.5 + 0.5 * h;
      tints[index * 2 + 1] = Math.sin(p[1] * 0.29 + p[2] * 0.61) * 0.5 + 0.5;
    }
  }

  for (let iy = 0; iy < cells; iy++) {
    for (let ix = 0; ix < cells; ix++) {
      const a = iy * vertsPerAxis + ix;
      const b = a + 1;
      const c = a + vertsPerAxis;
      const d = c + 1;
      if (flip) {
        accumulateNormal(normals, a, c, b, positions);
        accumulateNormal(normals, b, c, d, positions);
      } else {
        accumulateNormal(normals, a, b, c, positions);
        accumulateNormal(normals, b, d, c, positions);
      }
    }
  }

  for (let i = 0; i < vertexCount; i++) {
    const normal = normalize([
      normals[i * 3]!,
      normals[i * 3 + 1]!,
      normals[i * 3 + 2]!,
    ]);
    normals[i * 3] = normal[0];
    normals[i * 3 + 1] = normal[1];
    normals[i * 3 + 2] = normal[2];
  }
  return { cells, vertsPerAxis, positions, normals, tints };
}

export function buildGridIndices(grid: GridData, flip: boolean): Uint32Array {
  const { cells, vertsPerAxis } = grid;
  const indices = new Uint32Array(cells * cells * 6);
  let out = 0;
  for (let iy = 0; iy < cells; iy++) {
    for (let ix = 0; ix < cells; ix++) {
      const a = iy * vertsPerAxis + ix;
      const b = a + 1;
      const c = a + vertsPerAxis;
      const d = c + 1;
      if (flip) {
        indices[out++] = a;
        indices[out++] = c;
        indices[out++] = b;
        indices[out++] = b;
        indices[out++] = c;
        indices[out++] = d;
      } else {
        indices[out++] = a;
        indices[out++] = b;
        indices[out++] = c;
        indices[out++] = b;
        indices[out++] = d;
        indices[out++] = c;
      }
    }
  }
  return indices;
}

export function buildInterleavedVertices(grid: GridData): Float32Array {
  const count = grid.vertsPerAxis * grid.vertsPerAxis;
  const out = new Float32Array(count * 8);
  for (let i = 0; i < count; i++) {
    out[i * 8] = grid.positions[i * 3]!;
    out[i * 8 + 1] = grid.positions[i * 3 + 1]!;
    out[i * 8 + 2] = grid.positions[i * 3 + 2]!;
    out[i * 8 + 3] = grid.normals[i * 3]!;
    out[i * 8 + 4] = grid.normals[i * 3 + 1]!;
    out[i * 8 + 5] = grid.normals[i * 3 + 2]!;
    out[i * 8 + 6] = grid.tints[i * 2]!;
    out[i * 8 + 7] = grid.tints[i * 2 + 1]!;
  }
  return out;
}

export function pageFlip(page: PageRecord): boolean {
  return SURFACES[page.surfaceIndex]!.flipWinding === true;
}
