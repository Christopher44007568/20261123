import assert from "node:assert/strict";
import test from "node:test";
import {
  createDropletField,
  focusBlurPx,
  lensSampleUv,
  packDroplets,
  projectRadiusPx,
  stepDroplets,
  type LensSettings,
} from "../src/render/droplets.ts";

const lens: LensSettings = {
  focalLengthMm: 50,
  aperture: 2.8,
  focusDistanceM: 0.135,
  sensorWidthMm: 36,
};

test("thin-lens projection is independent of focus distance", () => {
  const radius = projectRadiusPx(1.4, 0.12, 50, 36, 900);
  const nearFocus = projectRadiusPx(1.4, 0.12, 50, 36, 900);
  const farFocus = projectRadiusPx(1.4, 0.12, 50, 36, 900);
  assert.equal(radius, nearFocus);
  assert.equal(radius, farFocus);
  assert.ok(Math.abs(radius - 14.5833) < 0.001);
});

test("focal length changes projected size", () => {
  const base = projectRadiusPx(1, 0.1, 50, 36, 1000);
  const tele = projectRadiusPx(1, 0.1, 85, 36, 1000);
  assert.ok(tele / base > 1.699 && tele / base < 1.701);
});

test("focus blur peaks away from the focal plane and grows with aperture", () => {
  assert.equal(focusBlurPx(lens.focusDistanceM, lens), 0);
  const near = focusBlurPx(0.15, lens);
  const far = focusBlurPx(0.16, lens);
  assert.ok(near > 0);
  assert.ok(far > near);
  assert.ok(
    focusBlurPx(0.15, { ...lens, aperture: 1.4 }) > focusBlurPx(0.15, { ...lens, aperture: 8 }),
  );
});

test("field assigns position, radius, squash, liquid normal and depth", () => {
  const drops = createDropletField(lens, 900, 48, 1234);
  assert.equal(drops.length, 48);
  for (const drop of drops) {
    assert.ok(drop.x > 0 && drop.x < 1);
    assert.ok(drop.y > 0 && drop.y < 1);
    assert.ok(drop.radiusPx > 0);
    assert.ok(drop.squash > 0.7 && drop.squash < 1.2);
    assert.ok(Math.hypot(drop.normalX, drop.normalY) < 0.49);
    assert.ok(drop.depthM >= 0.08 && drop.depthM <= 0.22);
  }
  assert.ok(drops.some((drop) => drop.radiusPx > 20));
});

test("packing preserves the drop record layout and honors no-rain", () => {
  const drops = createDropletField(lens, 900, 8, 7);
  const target = new Float32Array(64 * 16);
  assert.equal(packDroplets(drops, "off", target), 0);
  assert.equal(packDroplets(drops, "static", target), 8);
  assert.ok(Math.abs(target[0]! - drops[0]!.x) < 1e-7);
  assert.ok(Math.abs(target[2]! - drops[0]!.radiusPx) < 1e-5);
  assert.ok(Math.abs(target[3]! - drops[0]!.squash) < 1e-7);
  assert.ok(Math.abs(target[4]! - drops[0]!.normalX) < 1e-7);
  assert.ok(Math.abs(target[16]! - drops[1]!.x) < 1e-7);
});

test("static drops hold position while drift accumulates a wet trail", () => {
  const drops = createDropletField(lens, 900, 12, 99);
  const x = drops.map((drop) => drop.x);
  stepDroplets(drops, "static", 0.5, 2, 900);
  assert.deepEqual(
    drops.map((drop) => drop.x),
    x,
  );
  const y = drops.map((drop) => drop.y);
  stepDroplets(drops, "drift", 0.5, 2, 900);
  assert.ok(drops.some((drop) => drop.trailPx > 0));
  assert.ok(drops.some((drop, index) => drop.y !== y[index]));
});

test("lens sample coordinates remain continuous across a large drop", () => {
  const drops = createDropletField(lens, 900, 48, 1234);
  const large = drops.reduce((best, drop) => (drop.radiusPx > best.radiusPx ? drop : best));
  const y = large.y * 900;
  const start = large.x * 1440 - large.radiusPx * 0.98;
  const end = large.x * 1440 + large.radiusPx * 0.98;
  let previous: [number, number] | null = null;
  let maxJump = 0;
  for (let x = start; x <= end; x += 0.25) {
    const sample = lensSampleUv(x, y, large, 1440, 900, 1.25);
    if (previous) {
      maxJump = Math.max(maxJump, Math.hypot(sample[0] - previous[0], sample[1] - previous[1]));
    }
    previous = sample;
  }
  assert.ok(maxJump < 0.5);
});
