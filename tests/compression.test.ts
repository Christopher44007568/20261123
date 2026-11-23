import assert from "node:assert/strict";
import test from "node:test";
import {
  compareLevels,
  decodeLevel,
  decodeMipChain,
  encodeLevel,
  encodeMipChain,
} from "../src/compression/bc.ts";
import { buildDds, levelsByteEqual, parseDds } from "../src/compression/dds.ts";
import { buildMipChain, normalDirectionError } from "../src/compression/mips.ts";
import type { MipLevel } from "../src/types.ts";

function fixture(size = 8): MipLevel {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = Math.round((x / Math.max(1, size - 1)) * 255);
      data[i + 1] = Math.round((y / Math.max(1, size - 1)) * 255);
      data[i + 2] = Math.round(((x + y) / Math.max(1, (size - 1) * 2)) * 255);
      data[i + 3] = x < size / 2 ? 0 : 255;
    }
  }
  return { width: size, height: size, data };
}

function readU16(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

test("BC1 encodes opaque and one-bit transparent pixels", () => {
  const source = fixture();
  const encoded = encodeLevel(source, "bc1");
  const decoded = decodeLevel(encoded, "bc1");
  assert.equal(encoded.data.length, 32);
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < 4; x++) {
      assert.equal(decoded.data[(y * source.width + x) * 4 + 3], 0);
      assert.equal(decoded.data[(y * source.width + x + 4) * 4 + 3], 255);
    }
  }
  const metrics = compareLevels(source, decoded);
  assert.ok(metrics.psnr > 18.5, `BC1 PSNR too low: ${metrics.psnr}`);
  assert.ok(metrics.maxDelta <= 80, `BC1 max delta too high: ${metrics.maxDelta}`);
});

test("BC3 uses standard alpha-first block layout and preserves smooth alpha", () => {
  const source = fixture();
  const encoded = encodeLevel(source, "bc3");
  assert.equal(encoded.data.length, 64);
  const layoutSource = {
    ...source,
    data: source.data.slice(),
  };
  for (let i = 0; i < layoutSource.data.length; i += 4) layoutSource.data[i + 3] = 255;
  const layoutEncoded = encodeLevel(layoutSource, "bc3");
  const color0 = readU16(layoutEncoded.data, 8);
  const color1 = readU16(layoutEncoded.data, 10);
  assert.equal(layoutEncoded.data[0], 255);
  assert.equal(layoutEncoded.data[1], 254);
  assert.ok(color0 > color1);

  const decoded = decodeLevel(encoded, "bc3");
  assert.equal(decoded.data[3], 0);
  assert.equal(decoded.data[(0 * source.width + 4) * 4 + 3], 255);
  const metrics = compareLevels(source, decoded);
  assert.ok(metrics.psnr > 18.5, `BC3 PSNR too low: ${metrics.psnr}`);
});

test("normal map mip chain keeps direction and power-of-two mip sizes", () => {
  const source = fixture(16);
  const levels = buildMipChain(source, "normal");
  assert.deepEqual(
    levels.map((level) => `${level.width}x${level.height}`),
    ["16x16", "8x8", "4x4", "2x2", "1x1"],
  );
  const encoded = encodeMipChain(levels, "bc3");
  const decoded = decodeMipChain(encoded, "bc3");
  assert.ok(normalDirectionError(levels[0], decoded[0]) < 0.08);
  assert.equal(levels[1].data[2], 255);
  assert.equal(levels[1].data[3], 255);
});

test("DDS round-trips every mip and records sRGB only for albedo", () => {
  const source = fixture(16);
  const levels = buildMipChain(source, "albedo");
  const bc1 = encodeMipChain(levels, "bc1");
  const albedoDds = buildDds(bc1, "bc1", "albedo");
  const albedo = parseDds(albedoDds);
  assert.equal(albedo.srgb, true);
  assert.equal(albedo.codec, "bc1");
  assert.equal(albedo.mipCount, 5);
  assert.ok(levelsByteEqual(bc1, albedo.levels));
  assert.equal(new DataView(albedoDds).getUint32(128, true), 72);

  const normalLevels = buildMipChain(source, "normal");
  const bc3 = encodeMipChain(normalLevels, "bc3");
  const normalDds = buildDds(bc3, "bc3", "normal");
  const normal = parseDds(normalDds);
  assert.equal(normal.srgb, false);
  assert.equal(normal.codec, "bc3");
  assert.ok(levelsByteEqual(bc3, normal.levels));
  assert.equal(new DataView(normalDds).getUint32(128, true), 77);
  assert.equal(normal.byteLength, 128 + 20 + bc3.reduce((sum, level) => sum + level.data.length, 0));
});

test("DDS reload preserves normal direction and decoded pixels", () => {
  const base = fixture(16);
  const levels = buildMipChain(base, "normal");
  const encoded = encodeMipChain(levels, "bc3");
  const decoded = decodeMipChain(encoded, "bc3");
  const reloaded = parseDds(buildDds(encoded, "bc3", "normal"));
  const reloadedDecoded = decodeMipChain(reloaded.levels, reloaded.codec);
  assert.ok(levelsByteEqual(encoded, reloaded.levels));
  assert.ok(normalDirectionError(decoded[0], reloadedDecoded[0]) < 1e-5);
  assert.equal(compareLevels(decoded[0], reloadedDecoded[0]).meanDelta, 0);
});
