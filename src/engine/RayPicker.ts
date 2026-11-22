import type { VoxelWorld } from '../world/VoxelWorld.js';
import { isSolid } from '../world/materials.js';
import type { Vec3 } from './math3.js';

export interface PickResult {
  /** Solid voxel hit by the ray. */
  voxel: Vec3;
  /** First empty voxel adjacent to the hit (useful for placement). */
  adjacent: Vec3;
  normal: Vec3;
  distance: number;
  material: number;
}

/**
 * Amanatides & Woo voxel DDA. Traversal reads the fixed voxel world
 * directly, so the picked coordinate is identical at every octree LOD.
 */
export class RayPicker {
  constructor(private readonly world: VoxelWorld) {}

  pick(origin: Vec3, dir: Vec3, maxDistance = 200): PickResult | null {
    const d = { x: dir.x, y: dir.y, z: dir.z };
    const len = Math.hypot(d.x, d.y, d.z) || 1;
    d.x /= len; d.y /= len; d.z /= len;

    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);

    const stepX = d.x > 0 ? 1 : d.x < 0 ? -1 : 0;
    const stepY = d.y > 0 ? 1 : d.y < 0 ? -1 : 0;
    const stepZ = d.z > 0 ? 1 : d.z < 0 ? -1 : 0;

    const tDeltaX = stepX !== 0 ? Math.abs(1 / d.x) : Number.POSITIVE_INFINITY;
    const tDeltaY = stepY !== 0 ? Math.abs(1 / d.y) : Number.POSITIVE_INFINITY;
    const tDeltaZ = stepZ !== 0 ? Math.abs(1 / d.z) : Number.POSITIVE_INFINITY;

    const boundary = (o: number, cell: number, step: number) =>
      step > 0 ? cell + 1 - o : o - cell;
    let tMaxX = stepX !== 0 ? boundary(origin.x, x, stepX) * tDeltaX : Number.POSITIVE_INFINITY;
    let tMaxY = stepY !== 0 ? boundary(origin.y, y, stepY) * tDeltaY : Number.POSITIVE_INFINITY;
    let tMaxZ = stepZ !== 0 ? boundary(origin.z, z, stepZ) * tDeltaZ : Number.POSITIVE_INFINITY;

    let normal: Vec3 = { x: 0, y: 0, z: 0 };
    let t = 0;
    for (let iter = 0; iter < 512 && t <= maxDistance; iter += 1) {
      if (this.world.inBounds(x, y, z) && isSolid(this.world.get(x, y, z))) {
        return {
          voxel: { x, y, z },
          adjacent: { x: x + normal.x, y: y + normal.y, z: z + normal.z },
          normal: { ...normal },
          distance: t,
          material: this.world.get(x, y, z),
        };
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
        normal = { x: -stepX, y: 0, z: 0 };
      } else if (tMaxY < tMaxZ) {
        y += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
        normal = { x: 0, y: -stepY, z: 0 };
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        normal = { x: 0, y: 0, z: -stepZ };
      }
    }
    return null;
  }
}
