import assert from "node:assert/strict";
import { test } from "node:test";
import { CAMERA_PATH, ERROR_THRESHOLD_PX, cameraSnapshot } from "../src/camera";
import {
  COUNTER,
  SLOT_MISSING,
  buildPageDecisions,
  compareCulling,
  cullScene,
} from "../src/culling";
import { buildScene } from "../src/geometry/build";

const scene = buildScene();

test("far pages use coarse LOD and near pages request refined LOD", () => {
  const missing = new Uint32Array(scene.pages.length).fill(SLOT_MISSING);
  const far = buildPageDecisions(
    scene,
    cameraSnapshot(CAMERA_PATH[0]!, 1440, 900),
    missing,
    ERROR_THRESHOLD_PX,
  );
  const near = buildPageDecisions(
    scene,
    cameraSnapshot(CAMERA_PATH[3]!, 1440, 900),
    missing,
    ERROR_THRESHOLD_PX,
  );
  const farAverage = far.reduce((sum, page) => sum + page.rawLod, 0) / far.length;
  const nearAverage = near.reduce((sum, page) => sum + page.rawLod, 0) / near.length;
  assert.ok(farAverage > nearAverage);
  assert.ok(far.some((page) => page.rawLod >= 2));
  assert.ok(near.some((page) => page.rawLod <= 1));
});

test("missing resident pages fall back to L2 without dropping page coverage", () => {
  const missing = new Uint32Array(scene.pages.length).fill(SLOT_MISSING);
  const camera = cameraSnapshot(CAMERA_PATH[3]!, 1440, 900);
  const decisions = buildPageDecisions(scene, camera, missing, ERROR_THRESHOLD_PX);
  const fallbackPages = decisions.filter((page) => page.fallback);
  assert.ok(fallbackPages.length > 0);
  for (const page of fallbackPages) {
    assert.equal(page.lod, 2);
    assert.ok(page.rawLod <= 1);
  }
});

test("GPU list comparison accepts the complete CPU reference set", () => {
  const missing = new Uint32Array(scene.pages.length).fill(SLOT_MISSING);
  const camera = cameraSnapshot(CAMERA_PATH[4]!, 1440, 900);
  const resident = new Uint32Array(scene.pages.length);
  for (let i = 0; i < resident.length; i++) resident[i] = i;
  const cpu = cullScene(scene, camera, resident, ERROR_THRESHOLD_PX);
  const comparison = compareCulling(cpu.visible, cpu.stats, cpu);
  assert.equal(comparison.match, true);
  assert.equal(comparison.statsMatch, true);
  assert.equal(cpu.stats[COUNTER.submitted], cpu.visible.length);
  assert.ok(cpu.stats[COUNTER.coverageClusters]! > 0);
});
