import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPageGeometry,
  buildScene,
} from "../src/geometry/build";
import {
  CLUSTERS_PER_PAGE,
  INDICES_PER_CLUSTER,
  LOD_CELLS,
  pageTriangleCount,
  pageVertexCount,
} from "../src/geometry/types";

const scene = buildScene();

test("fixed-seed source mesh is four million triangles", () => {
  assert.equal(scene.pages.length, 488);
  assert.equal(scene.sourceTriangles, 3_997_696);
  assert.equal(scene.sourceTriangles, 488 * LOD_CELLS[0]! * LOD_CELLS[0]! * 2);
});

test("candidate meshlets cover every LOD", () => {
  const counts = [0, 1, 2, 3].map(
    (lod) => scene.clusters.filter((cluster) => cluster.lod === lod).length,
  );
  assert.deepEqual(counts, [31_232, 7_808, 1_952, 488]);
  assert.equal(
    scene.clusters.length,
    scene.pages.length * CLUSTERS_PER_PAGE.reduce((sum, count) => sum + count, 0),
  );
});

test("all meshlets have finite bounds and conservative normal cones", () => {
  for (const cluster of scene.clusters) {
    assert.ok(cluster.radius > 0 && Number.isFinite(cluster.radius));
    assert.ok(cluster.center.every(Number.isFinite));
    assert.ok(cluster.coneAxis.every(Number.isFinite));
    assert.ok(cluster.coneCos >= -1 && cluster.coneCos <= 1);
  }
});

test("geometry generation is deterministic for the same page and LOD", () => {
  const page = scene.pages[203]!;
  const a = buildPageGeometry(page, 0);
  const b = buildPageGeometry(page, 0);
  assert.equal(a.indices.length, pageTriangleCount(0) * 3);
  assert.equal(a.vertices.length, pageVertexCount(0) * 8);
  assert.deepEqual(a.indices, b.indices);
  assert.deepEqual(a.vertices, b.vertices);
});

test("static and resident cluster address ranges are in bounds", () => {
  for (const cluster of scene.clusters) {
    if (cluster.lod >= 2) {
      assert.ok(cluster.indexOffset + INDICES_PER_CLUSTER <= scene.staticIndexCount);
      assert.ok(cluster.vertexOffset + pageVertexCount(cluster.lod) <= scene.staticVertexCount);
    } else {
      const localIndexLimit = cluster.lod === 0 ? 24_576 : 30_720;
      assert.ok(cluster.indexOffset + INDICES_PER_CLUSTER <= localIndexLimit);
      assert.ok(cluster.vertexOffset + pageVertexCount(cluster.lod) <= 5_314);
    }
  }
});
