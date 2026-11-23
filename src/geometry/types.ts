import type { Vec3 } from "../math";

export const FIXED_SEED = 0x51c1aff;
export const LOD_CELLS = [64, 32, 16, 8] as const;
export const MESHLET_CELLS = 8;
export const CLUSTERS_PER_PAGE = [64, 16, 4, 1] as const;
export const TRIANGLES_PER_CLUSTER = 128;
export const INDICES_PER_CLUSTER = 384;
export const STATIC_LODS = [2, 3] as const;

export interface SurfaceSpec {
  id: string;
  material: number;
  cols: number;
  rows: number;
  flipWinding?: boolean;
  eval: (u: number, v: number) => Vec3;
}

export interface PageRecord {
  id: number;
  surfaceId: string;
  surfaceIndex: number;
  material: number;
  col: number;
  row: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface PageMeta {
  page: number;
  center: Vec3;
  radius: number;
  errors: readonly [number, number, number, number];
}

export interface ClusterRecord {
  id: number;
  page: number;
  lod: number;
  material: number;
  center: Vec3;
  radius: number;
  coneAxis: Vec3;
  coneCos: number;
  indexOffset: number;
  vertexOffset: number;
  isFallback: boolean;
}

export interface PageGeometry {
  page: number;
  lod: number;
  indices: Uint32Array;
  vertices: Float32Array;
}

export interface PageSelection {
  page: number;
  rawLod: number;
  lod: number;
  fallback: boolean;
  resident: boolean;
  distance: number;
  projectedError: number;
}

export function pageVertsPerAxis(lod: number): number {
  return LOD_CELLS[lod]! + 1;
}

export function pageVertexCount(lod: number): number {
  const n = pageVertsPerAxis(lod);
  return n * n;
}

export function pageTriangleCount(lod: number): number {
  const n = LOD_CELLS[lod]!;
  return n * n * 2;
}
