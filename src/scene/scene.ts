import { Vec3, v3 } from '../math/vec3.js';
import { LightSource } from '../flare/optics.js';
import { Mesh, boxMesh, cylinderBetween, mergeMeshes, terrainMesh } from './mesh.js';

export const enum Material {
  Ground = 0,
  Wall = 1,
  Roof = 2,
  Metal = 3,
  Panel = 4,
  Emitter = 5,
}

export interface MeshBatch {
  mesh: Mesh;
  material: Material;
}

export interface SceneData {
  batches: MeshBatch[];
  lights: LightSource[];
  emitterPositions: Vec3[];
}

function ridgeHeight(x: number, z: number): number {
  const ridge = -3.2 * Math.exp(-Math.pow((z - 6) / 14, 2));
  const ripple = 0.55 * Math.sin(x * 0.23 + 1.7) * Math.cos(z * 0.19);
  return ridge + ripple - 0.6;
}

function towerTruss(): Mesh {
  const parts: Mesh[] = [];
  const baseY = 4.6;
  const height = 11.5;
  const levels = 6;
  const cornersAt = (t: number): Vec3[] => {
    const half = 1.5 * (1 - t) + 0.45 * t;
    const y = baseY + height * t;
    return [
      v3(2.6 - half, y, -1.5 - half),
      v3(2.6 + half, y, -1.5 - half),
      v3(2.6 + half, y, -1.5 + half),
      v3(2.6 - half, y, -1.5 + half),
    ];
  };
  for (let i = 0; i < levels; i++) {
    const lower = cornersAt(i / levels);
    const upper = cornersAt((i + 1) / levels);
    for (let c = 0; c < 4; c++) {
      parts.push(cylinderBetween(lower[c], upper[c], 0.07, 6));
      parts.push(cylinderBetween(lower[c], lower[(c + 1) % 4], 0.05, 6));
      parts.push(cylinderBetween(lower[c], upper[(c + 1) % 4], 0.045, 6));
    }
  }
  const top = cornersAt(1);
  for (let c = 0; c < 4; c++) parts.push(cylinderBetween(top[c], top[(c + 1) % 4], 0.05, 6));
  parts.push(cylinderBetween(v3(2.6, baseY + height, -1.5), v3(2.6, baseY + height + 2.2, -1.5), 0.09, 8));
  return mergeMeshes(parts);
}

function railing(): Mesh {
  const parts: Mesh[] = [];
  const y0 = 4.62;
  const y1 = 5.7;
  const x0 = -7;
  const x1 = 7;
  const zEdge = 3.2;
  for (let x = x0; x <= x1; x += 1.4) {
    parts.push(cylinderBetween(v3(x, y0, zEdge), v3(x, y1, zEdge), 0.045, 6));
  }
  parts.push(cylinderBetween(v3(x0, y1, zEdge), v3(x1, y1, zEdge), 0.05, 6));
  parts.push(cylinderBetween(v3(x0, y0 + 0.55, zEdge), v3(x1, y0 + 0.55, zEdge), 0.04, 6));
  return mergeMeshes(parts);
}

export function buildScene(): SceneData {
  const batches: MeshBatch[] = [];
  const lights: LightSource[] = [];
  const emitterPositions: Vec3[] = [];

  batches.push({
    mesh: terrainMesh(120, 48, ridgeHeight),
    material: Material.Ground,
  });
  batches.push({ mesh: boxMesh(v3(12, 4, 7), v3(0, 2, -0.5)), material: Material.Wall });
  batches.push({ mesh: boxMesh(v3(12.6, 0.6, 7.6), v3(0, 4.3, -0.5)), material: Material.Roof });

  const workLightXs = [-4.8, -1.6, 1.6, 4.8];
  for (const x of workLightXs) {
    const pos: Vec3 = v3(x, 4.78, 2.4);
    batches.push({ mesh: boxMesh(v3(0.7, 0.28, 0.45), pos), material: Material.Emitter });
    emitterPositions.push(pos);
    lights.push({ position: v3(x, 4.7, 2.4), color: v3(1.0, 0.93, 0.78), intensity: 90, radius: 0.34, beacon: false });
  }

  const beaconPos: Vec3 = v3(2.6, 17.6, -1.5);
  batches.push({ mesh: boxMesh(v3(0.55, 0.55, 0.55), beaconPos), material: Material.Emitter });
  emitterPositions.push(beaconPos);
  lights.push({ position: beaconPos, color: v3(1.0, 0.25, 0.18), intensity: 140, radius: 0.3, beacon: true });

  batches.push({ mesh: towerTruss(), material: Material.Metal });
  batches.push({ mesh: railing(), material: Material.Metal });

  const panel: Mesh = mergeMeshes([
    boxMesh(v3(3.4, 2.2, 0.12), v3(-2.2, 5.7, 0.6)),
    cylinderBetween(v3(-3.7, 4.6, 0.6), v3(-3.7, 6.85, 0.6), 0.06, 6),
    cylinderBetween(v3(-0.7, 4.6, 0.6), v3(-0.7, 6.85, 0.6), 0.06, 6),
  ]);
  batches.push({ mesh: panel, material: Material.Panel });

  return { batches, lights, emitterPositions };
}
