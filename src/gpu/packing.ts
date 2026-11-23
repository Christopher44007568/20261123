import type { CameraSnapshot } from "../camera";
import type { BuiltScene } from "../geometry/build";
import type { Mat4 } from "../math";

export const CLUSTER_STRIDE_BYTES = 64;
export const PAGE_META_STRIDE_BYTES = 32;
export const FRAME_UNIFORM_BYTES = 272;

export function packClusters(scene: BuiltScene): Uint8Array {
  const bytes = new Uint8Array(scene.clusters.length * CLUSTER_STRIDE_BYTES);
  const floats = new Float32Array(bytes.buffer);
  const uints = new Uint32Array(bytes.buffer);
  for (let i = 0; i < scene.clusters.length; i++) {
    const cluster = scene.clusters[i]!;
    const f = i * 16;
    const u = i * 16;
    floats[f] = cluster.center[0];
    floats[f + 1] = cluster.center[1];
    floats[f + 2] = cluster.center[2];
    floats[f + 3] = cluster.radius;
    floats[f + 4] = cluster.coneAxis[0];
    floats[f + 5] = cluster.coneAxis[1];
    floats[f + 6] = cluster.coneAxis[2];
    floats[f + 7] = cluster.coneCos;
    uints[u + 8] = cluster.page;
    uints[u + 9] = cluster.lod;
    uints[u + 10] = cluster.indexOffset;
    uints[u + 11] = cluster.vertexOffset;
    uints[u + 12] = cluster.isFallback ? 1 : 0;
    uints[u + 13] = cluster.material;
  }
  return bytes;
}

export function packPageMetas(scene: BuiltScene): Uint8Array {
  const bytes = new Uint8Array(scene.pageMetas.length * PAGE_META_STRIDE_BYTES);
  const floats = new Float32Array(bytes.buffer);
  for (let i = 0; i < scene.pageMetas.length; i++) {
    const meta = scene.pageMetas[i]!;
    const offset = i * 8;
    floats[offset] = meta.center[0];
    floats[offset + 1] = meta.center[1];
    floats[offset + 2] = meta.center[2];
    floats[offset + 3] = meta.radius;
    floats[offset + 4] = meta.errors[0];
    floats[offset + 5] = meta.errors[1];
    floats[offset + 6] = meta.errors[2];
    floats[offset + 7] = meta.errors[3];
  }
  return bytes;
}

export function packFrame(
  camera: CameraSnapshot,
  inverseViewProjection: Mat4,
  mode: number,
  clusterCount: number,
  pageCount: number,
  errorThresholdPx: number,
  visibleCapacity: number,
): Uint8Array {
  const bytes = new Uint8Array(FRAME_UNIFORM_BYTES);
  const floats = new Float32Array(bytes.buffer);
  const uints = new Uint32Array(bytes.buffer);
  floats.set(camera.viewProj, 0);
  floats.set(inverseViewProjection, 16);
  floats[32] = camera.position[0];
  floats[33] = camera.position[1];
  floats[34] = camera.position[2];
  floats[35] = 1;
  floats[36] = camera.width;
  floats[37] = camera.height;
  floats[38] = camera.tanHalfFov;
  floats[39] = errorThresholdPx;
  floats.set(camera.planes, 40);
  uints[64] = clusterCount;
  uints[65] = pageCount;
  uints[66] = mode;
  uints[67] = visibleCapacity;
  return bytes;
}
