import { cross, dot, length, normalize, type Vec3 } from "../math";
import {
  buildGridIndices,
  buildInterleavedVertices,
  generatePageGrid,
  pageFlip,
  type GridData,
} from "./grid";
import { buildPages, evaluatePage } from "./scene";
import {
  CLUSTERS_PER_PAGE,
  INDICES_PER_CLUSTER,
  LOD_CELLS,
  MESHLET_CELLS,
  STATIC_LODS,
  TRIANGLES_PER_CLUSTER,
  pageVertexCount,
  pageTriangleCount,
  type ClusterRecord,
  type PageGeometry,
  type PageMeta,
  type PageRecord,
} from "./types";

export interface BuiltScene {
  pages: PageRecord[];
  pageMetas: PageMeta[];
  clusters: ClusterRecord[];
  staticVertices: Float32Array;
  staticIndices: Uint32Array;
  staticVertexCount: number;
  staticIndexCount: number;
  sourceTriangles: number;
  candidateClusters: number;
}

interface ClusterStats {
  center: Vec3;
  radius: number;
  axis: Vec3;
  cosTheta: number;
}

function triangleNormal(a: Vec3, b: Vec3, c: Vec3, flip: boolean): Vec3 {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = cross(ab, ac);
  return flip ? [-n[0], -n[1], -n[2]] : n;
}

function clusterStats(
  grid: GridData,
  clusterX: number,
  clusterY: number,
  flip: boolean,
): ClusterStats {
  const x0 = clusterX * MESHLET_CELLS;
  const y0 = clusterY * MESHLET_CELLS;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  const n = grid.vertsPerAxis;

  for (let iy = 0; iy <= MESHLET_CELLS; iy++) {
    for (let ix = 0; ix <= MESHLET_CELLS; ix++) {
      const index = (y0 + iy) * n + x0 + ix;
      const x = grid.positions[index * 3]!;
      const y = grid.positions[index * 3 + 1]!;
      const z = grid.positions[index * 3 + 2]!;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }
  const center: Vec3 = [(minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5];
  let radiusSq = 0;
  let axisX = 0;
  let axisY = 0;
  let axisZ = 0;
  const faceNormals: Vec3[] = [];

  for (let iy = 0; iy <= MESHLET_CELLS; iy++) {
    for (let ix = 0; ix <= MESHLET_CELLS; ix++) {
      const index = (y0 + iy) * n + x0 + ix;
      const dx = grid.positions[index * 3]! - center[0];
      const dy = grid.positions[index * 3 + 1]! - center[1];
      const dz = grid.positions[index * 3 + 2]! - center[2];
      radiusSq = Math.max(radiusSq, dx * dx + dy * dy + dz * dz);
    }
  }
  for (let iy = 0; iy < MESHLET_CELLS; iy++) {
    for (let ix = 0; ix < MESHLET_CELLS; ix++) {
      const a = (y0 + iy) * n + x0 + ix;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      for (const [i0, i1, i2] of flip
        ? ([[a, c, b], [b, c, d]] as const)
        : ([[a, b, c], [b, d, c]] as const)) {
        const p0: Vec3 = [
          grid.positions[i0 * 3]!,
          grid.positions[i0 * 3 + 1]!,
          grid.positions[i0 * 3 + 2]!,
        ];
        const p1: Vec3 = [
          grid.positions[i1 * 3]!,
          grid.positions[i1 * 3 + 1]!,
          grid.positions[i1 * 3 + 2]!,
        ];
        const p2: Vec3 = [
          grid.positions[i2 * 3]!,
          grid.positions[i2 * 3 + 1]!,
          grid.positions[i2 * 3 + 2]!,
        ];
        const raw = triangleNormal(p0, p1, p2, flip);
        const area = length(raw);
        if (area > 1e-9) {
          axisX += raw[0];
          axisY += raw[1];
          axisZ += raw[2];
          faceNormals.push([raw[0] / area, raw[1] / area, raw[2] / area]);
        }
      }
    }
  }
  let axis = normalize([axisX, axisY, axisZ]);
  let cosTheta = 1;
  if (faceNormals.length === 0) {
    axis = [0, 0, 1];
    cosTheta = -1;
  } else {
    for (const normal of faceNormals) cosTheta = Math.min(cosTheta, dot(normal, axis));
  }
  return { center, radius: Math.sqrt(radiusSq) * 1.002 + 1e-4, axis, cosTheta: Math.max(-1, cosTheta) };
}

function clusteredIndices(grid: GridData, flip: boolean): Uint32Array {
  const built = buildGridIndices(grid, flip);
  const lod = LOD_CELLS.indexOf(grid.cells as (typeof LOD_CELLS)[number]);
  const clusters = CLUSTERS_PER_PAGE[lod]!;
  if (clusters === 1) return built;

  const clustersAxis = 1 << (3 - lod);
  const clusterCells = grid.cells / clustersAxis;
  const out = new Uint32Array(built.length);
  let dst = 0;
  for (let cy = 0; cy < clustersAxis; cy++) {
    for (let cx = 0; cx < clustersAxis; cx++) {
      for (let iy = 0; iy < clusterCells; iy++) {
        for (let ix = 0; ix < clusterCells; ix++) {
          const baseCell = (cy * clusterCells + iy) * grid.cells + cx * clusterCells + ix;
          const src = baseCell * 6;
          for (let k = 0; k < 6; k++) out[dst++] = built[src + k]!;
        }
      }
    }
  }
  return out;
}

export function buildPageGeometry(page: PageRecord, lod: number): PageGeometry {
  const grid = generatePageGrid(page, lod);
  const vertices = buildInterleavedVertices(grid);
  const indices = clusteredIndices(grid, pageFlip(page));
  return { page: page.id, lod, indices, vertices };
}

function computePageMeta(page: PageRecord): PageMeta {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let iy = 0; iy <= 4; iy++) {
    for (let ix = 0; ix <= 4; ix++) {
      const u = page.u0 + (page.u1 - page.u0) * (ix / 4);
      const v = page.v0 + (page.v1 - page.v0) * (iy / 4);
      const p = evaluatePage(page, u, v);
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      minZ = Math.min(minZ, p[2]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
      maxZ = Math.max(maxZ, p[2]);
    }
  }
  const center: Vec3 = [(minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5];
  const radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * 0.5 + 0.05;
  const scale = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  return {
    page: page.id,
    center,
    radius,
    errors: [scale * 0.006, scale * 0.012, scale * 0.025, scale * 0.052],
  };
}

function makeClusters(
  page: PageRecord,
  lod: number,
  grid: GridData,
  indexOffsetBase: number,
  vertexOffsetBase: number,
  local: boolean,
): ClusterRecord[] {
  const clusters = CLUSTERS_PER_PAGE[lod]!;
  const clustersAxis = 1 << (3 - lod);
  const flip = pageFlip(page);
  const records: ClusterRecord[] = [];
  for (let cy = 0; cy < clustersAxis; cy++) {
    for (let cx = 0; cx < clustersAxis; cx++) {
      const ordinal = cy * clustersAxis + cx;
      const stats = clusterStats(grid, cx, cy, flip);
      records.push({
        id: -1,
        page: page.id,
        lod,
        material: page.material,
        center: stats.center,
        radius: stats.radius,
        coneAxis: stats.axis,
        coneCos: stats.cosTheta,
        indexOffset: local
          ? (lod === 0 ? 0 : 24576) + ordinal * INDICES_PER_CLUSTER
          : indexOffsetBase + ordinal * INDICES_PER_CLUSTER,
        vertexOffset: local
          ? lod === 0
            ? 0
            : pageVertexCount(0)
          : vertexOffsetBase,
        isFallback: false,
      });
    }
  }
  if (records.length !== clusters) throw new Error(`cluster count mismatch for page ${page.id}`);
  return records;
}

export function buildScene(): BuiltScene {
  const pages = buildPages();
  if (pages.length !== 488) throw new Error(`expected 488 pages, got ${pages.length}`);
  const pageMetas = pages.map(computePageMeta);
  const clusters: ClusterRecord[] = [];
  const staticVertexCount = pages.length * (pageVertexCount(2) + pageVertexCount(3));
  const staticIndexCount = pages.length * (pageTriangleCount(2) + pageTriangleCount(3)) * 3;
  const staticVertices = new Float32Array(staticVertexCount * 8);
  const staticIndices = new Uint32Array(staticIndexCount);
  let vertexCursor = 0;
  let indexCursor = 0;

  for (const page of pages) {
    for (const lod of STATIC_LODS) {
      const grid = generatePageGrid(page, lod);
      const vertices = buildInterleavedVertices(grid);
      const indices = clusteredIndices(grid, pageFlip(page));
      const pageClusters = makeClusters(page, lod, grid, indexCursor, vertexCursor, false);
      clusters.push(...pageClusters);
      staticVertices.set(vertices, vertexCursor * 8);
      staticIndices.set(indices, indexCursor);
      vertexCursor += vertices.length / 8;
      indexCursor += indices.length;
    }
  }
  if (vertexCursor !== staticVertexCount || indexCursor !== staticIndexCount) {
    throw new Error("static geometry cursor mismatch");
  }

  for (const page of pages) {
    for (const lod of [0, 1] as const) {
      const grid = generatePageGrid(page, lod);
      clusters.push(...makeClusters(page, lod, grid, 0, 0, true));
    }
  }

  for (let i = 0; i < clusters.length; i++) clusters[i]!.id = i;
  return {
    pages,
    pageMetas,
    clusters,
    staticVertices,
    staticIndices,
    staticVertexCount,
    staticIndexCount,
    sourceTriangles: pages.length * LOD_CELLS[0]! * LOD_CELLS[0]! * 2,
    candidateClusters: clusters.length,
  };
}
