import { VoxelWorld } from '../world/VoxelWorld.js';
import { isSolid } from '../world/materials.js';
import type { OctreeNode } from './Octree.js';

/**
 * Face directions. For each axis we emit quads on the low and high side.
 * Normal points toward the empty voxel.
 */
export interface FaceDef {
  axis: 0 | 1 | 2;
  sign: 1 | -1;
  normal: [number, number, number];
  /** Four corner offsets relative to the voxel min corner. */
  corners: Array<[number, number, number]>;
}

const FACES: FaceDef[] = [
  { axis: 0, sign: -1, normal: [-1, 0, 0], corners: [[0, 0, 1], [0, 0, 0], [0, 1, 0], [0, 1, 1]] },
  { axis: 0, sign: 1, normal: [1, 0, 0], corners: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]] },
  { axis: 1, sign: -1, normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { axis: 1, sign: 1, normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { axis: 2, sign: -1, normal: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
  { axis: 2, sign: 1, normal: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
];

export interface Quad {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  axis: 0 | 1 | 2;
  sign: 1 | -1;
  normal: [number, number, number];
  material: number;
}

export interface LeafMeshData {
  quads: Quad[];
  /** Distinct (material, face) batches in stable order. */
  batches: Array<{ material: number; axis: 0 | 1 | 2; sign: 1 | -1; count: number }>;
  faceCount: number;
}

/**
 * Stateless mesher over the voxel world. Geometry always lands on the global
 * integer lattice, so adjacent leaves of different sizes share exact face
 * boundaries and cannot crack or drift when LOD changes.
 */
export class Mesher {
  private readonly faceCache = new Map<number, number>();

  constructor(private readonly world: VoxelWorld) {}

  /**
   * Count exposed unit faces inside a node box. This is the metric used by
   * the octree's per-node maximum face budget.
   */
  countExposedFaces(node: OctreeNode): number {
    const cached = this.faceCache.get(node.key);
    if (cached !== undefined) {
      return cached;
    }
    const result = this.computeExposedFaces(node);
    this.faceCache.set(node.key, result);
    return result;
  }

  private computeExposedFaces(node: OctreeNode): number {
    if (node.kind === 'air') {
      return 0;
    }
    let count = 0;
    const { x: x0, y: y0, z: z0, size } = node;
    for (let x = x0; x < x0 + size; x += 1) {
      for (let y = y0; y < y0 + size; y += 1) {
        for (let z = z0; z < z0 + size; z += 1) {
          if (!isSolid(this.world.get(x, y, z))) {
            continue;
          }
          for (const face of FACES) {
            const n = this.neighborVoxel(x, y, z, face);
            if (!isSolid(n)) {
              count += 1;
            }
          }
        }
      }
    }
    return count;
  }

  private neighborVoxel(x: number, y: number, z: number, face: FaceDef): number {
    if (face.axis === 0) {
      return this.world.get(x + face.sign, y, z);
    }
    if (face.axis === 1) {
      return this.world.get(x, y + face.sign, z);
    }
    return this.world.get(x, y, z + face.sign);
  }

  /** Build greedily merged quads for one render leaf. */
  buildLeafMesh(node: OctreeNode): LeafMeshData {
    const quads: Quad[] = [];
    if (node.kind === 'air') {
      return { quads, batches: [], faceCount: 0 };
    }

    for (const face of FACES) {
      this.buildFaceLayer(node, face, quads);
    }

    const batchMap = new Map<string, { material: number; axis: 0 | 1 | 2; sign: 1 | -1; count: number }>();
    let faceCount = 0;
    for (const quad of quads) {
      const key = `${quad.material}:${quad.axis}:${quad.sign}`;
      let batch = batchMap.get(key);
      if (batch === undefined) {
        batch = { material: quad.material, axis: quad.axis, sign: quad.sign, count: 0 };
        batchMap.set(key, batch);
      }
      // A merged quad covers width * height unit faces.
      batch.count += quad.width * quad.height;
      faceCount += quad.width * quad.height;
    }
    return {
      quads,
      batches: [...batchMap.values()].sort((a, b) =>
        a.material - b.material || a.axis - b.axis || a.sign - b.sign),
      faceCount,
    };
  }

  /**
   * Greedy meshing of one face direction within the node. Only faces on the
   * node boundary facing outside air, or adjacent to air inside the node,
   * are emitted; solid-to-solid faces are culled. Quads always snap to the
   * global integer lattice so leaves of different LOD line up exactly.
   */
  private buildFaceLayer(node: OctreeNode, face: FaceDef, out: Quad[]): void {
    const { x: x0, y: y0, z: z0, size } = node;
    const uAxis = (face.axis + 1) % 3;
    const vAxis = (face.axis + 2) % 3;
    // One entry per exposed voxel face, keyed by its plane layer plus the
    // (u, v) position. Keeping the layer in the key preserves internal
    // cavity faces instead of collapsing them onto the outer shell.
    const faceKeys = new Set<number>();
    const faceMat = new Map<number, number>();
    const solidCoord = [0, 0, 0];
    for (let v = 0; v < size; v += 1) {
      for (let u = 0; u < size; u += 1) {
        for (let d = 0; d < size; d += 1) {
          solidCoord[face.axis] = d;
          solidCoord[uAxis] = u;
          solidCoord[vAxis] = v;
          const cx = x0 + solidCoord[0];
          const cy = y0 + solidCoord[1];
          const cz = z0 + solidCoord[2];
          const mat = this.world.get(cx, cy, cz);
          if (!isSolid(mat)) {
            continue;
          }
          const nx = cx + (face.axis === 0 ? face.sign : 0);
          const ny = cy + (face.axis === 1 ? face.sign : 0);
          const nz = cz + (face.axis === 2 ? face.sign : 0);
          if (!isSolid(this.world.get(nx, ny, nz))) {
            const key = (d << 14) | (v << 7) | u;
            faceKeys.add(key);
            faceMat.set(key, mat);
          }
        }
      }
    }

    // Greedy rectangle merging per plane layer; only same-layer, same-material
    // cells may merge, which keeps every face on its exact lattice plane.
    for (let d = 0; d < size; d += 1) {
      const mask = new Uint8Array(size * size);
      const matAt = new Uint8Array(size * size);
      for (let v = 0; v < size; v += 1) {
        for (let u = 0; u < size; u += 1) {
          const key = (d << 14) | (v << 7) | u;
          if (faceKeys.has(key)) {
            mask[v * size + u] = 1;
            matAt[v * size + u] = faceMat.get(key)!;
          }
        }
      }
      const usedLayer = new Uint8Array(size * size);
      for (let v = 0; v < size; v += 1) {
        for (let u = 0; u < size; u += 1) {
          const idx = v * size + u;
          if (!mask[idx] || usedLayer[idx]) {
            continue;
          }
          const material = matAt[idx];
          let width = 1;
          while (u + width < size &&
            mask[v * size + u + width] &&
            !usedLayer[v * size + u + width] &&
            matAt[v * size + u + width] === material) {
            width += 1;
          }
          let height = 1;
          let canGrow = true;
          while (canGrow && v + height < size) {
            for (let du = 0; du < width; du += 1) {
              const ni = (v + height) * size + u + du;
              if (!mask[ni] || usedLayer[ni] || matAt[ni] !== material) {
                canGrow = false;
                break;
              }
            }
            if (canGrow) {
              height += 1;
            }
          }
          for (let dv = 0; dv < height; dv += 1) {
            for (let du = 0; du < width; du += 1) {
              usedLayer[(v + dv) * size + u + du] = 1;
            }
          }
          const p = [0, 0, 0];
          p[uAxis] = u;
          p[vAxis] = v;
          p[face.axis] = d + (face.sign === 1 ? 1 : 0);
          out.push({
            x: x0 + p[0],
            y: y0 + p[1],
            z: z0 + p[2],
            width,
            height,
            axis: face.axis,
            sign: face.sign,
            normal: face.normal,
            material,
          });
        }
      }
    }
  }
}

export { FACES };
