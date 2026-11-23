import type { CodecId, EncodedMip, MapMetrics, MipLevel } from "../types";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const BLOCK_BYTES: Record<CodecId, number> = { bc1: 8, bc3: 16 };

function quantize565(r: number, g: number, b: number): number {
  const r5 = Math.round((r * 31) / 255);
  const g6 = Math.round((g * 63) / 255);
  const b5 = Math.round((b * 31) / 255);
  return ((r5 << 11) | (g6 << 5) | b5) & 0xffff;
}

function expand565(color: number): Rgb {
  const r5 = (color >> 11) & 0x1f;
  const g6 = (color >> 5) & 0x3f;
  const b5 = color & 0x1f;
  return {
    r: (r5 << 3) | (r5 >> 2),
    g: (g6 << 2) | (g6 >> 4),
    b: (b5 << 3) | (b5 >> 2),
  };
}

function packedBounds(pixels: Uint8Array, count: number, transparentMode: boolean): [number, number] {
  let minR = 255;
  let minG = 255;
  let minB = 255;
  let maxR = 0;
  let maxG = 0;
  let maxB = 0;
  for (let i = 0; i < count; i++) {
    const offset = i * 4;
    if (transparentMode && pixels[offset + 3] < 128) continue;
    minR = Math.min(minR, pixels[offset]);
    minG = Math.min(minG, pixels[offset + 1]);
    minB = Math.min(minB, pixels[offset + 2]);
    maxR = Math.max(maxR, pixels[offset]);
    maxG = Math.max(maxG, pixels[offset + 1]);
    maxB = Math.max(maxB, pixels[offset + 2]);
  }
  if (minR > maxR) return [0, 0];
  return [quantize565(minR, minG, minB), quantize565(maxR, maxG, maxB)];
}

function palette4(c0: number, c1: number): Rgb[] {
  const a = expand565(c0);
  const b = expand565(c1);
  return [
    a,
    b,
    {
      r: Math.round((2 * a.r + b.r) / 3),
      g: Math.round((2 * a.g + b.g) / 3),
      b: Math.round((2 * a.b + b.b) / 3),
    },
    {
      r: Math.round((a.r + 2 * b.r) / 3),
      g: Math.round((a.g + 2 * b.g) / 3),
      b: Math.round((a.b + 2 * b.b) / 3),
    },
  ];
}

function palette3(c0: number, c1: number): Rgb[] {
  const a = expand565(c0);
  const b = expand565(c1);
  return [
    a,
    b,
    {
      r: Math.round((a.r + b.r) / 2),
      g: Math.round((a.g + b.g) / 2),
      b: Math.round((a.b + b.b) / 2),
    },
  ];
}

function nearestRgb(pixels: Uint8Array, pixel: number, palette: Rgb[], maximum: number): number {
  const offset = pixel * 4;
  const r = pixels[offset];
  const g = pixels[offset + 1];
  const b = pixels[offset + 2];
  let best = 0;
  let bestError = Number.POSITIVE_INFINITY;
  for (let i = 0; i < maximum; i++) {
    const dr = r - palette[i].r;
    const dg = g - palette[i].g;
    const db = b - palette[i].b;
    const error = dr * dr + dg * dg + db * db;
    if (error < bestError) {
      bestError = error;
      best = i;
    }
  }
  return best;
}

function pack2BitIndices(indices: number[]): number {
  let packed = 0;
  for (let i = 0; i < 16; i++) packed |= (indices[i] & 3) << (i * 2);
  return packed >>> 0;
}

function writeU16(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >> 8) & 0xff;
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function encodeColor4Block(pixels: Uint8Array): Uint8Array {
  const output = new Uint8Array(8);
  let [c0, c1] = packedBounds(pixels, 16, false);
  if (c0 < c1) [c0, c1] = [c1, c0];
  if (c0 === c1) {
    if (c0 < 0xffff) c0 += 1;
    else c1 -= 1;
  }
  const palette = palette4(c0, c1);
  const indices = new Array<number>(16);
  for (let i = 0; i < 16; i++) indices[i] = nearestRgb(pixels, i, palette, 4);
  writeU16(output, 0, c0);
  writeU16(output, 2, c1);
  writeU32(output, 4, pack2BitIndices(indices));
  return output;
}

function encodeBc1Block(pixels: Uint8Array, allowAlpha: boolean): Uint8Array {
  const output = new Uint8Array(8);
  let hasTransparent = false;
  if (allowAlpha) {
    for (let i = 0; i < 16; i++) {
      if (pixels[i * 4 + 3] < 128) {
        hasTransparent = true;
        break;
      }
    }
  }
  if (!hasTransparent) return encodeColor4Block(pixels);

  let [c0, c1] = packedBounds(pixels, 16, true);
  if (c0 > c1) [c0, c1] = [c1, c0];
  const palette = palette3(c0, c1);
  const indices = new Array<number>(16);
  for (let i = 0; i < 16; i++) {
    indices[i] =
      pixels[i * 4 + 3] < 128 ? 3 : nearestRgb(pixels, i, palette, 3);
  }
  writeU16(output, 0, c0);
  writeU16(output, 2, c1);
  writeU32(output, 4, pack2BitIndices(indices));
  return output;
}

function alphaPalette(a0: number, a1: number): number[] {
  const values = [a0, a1];
  for (let i = 1; i <= 6; i++) {
    values.push(Math.round(((7 - i) * a0 + i * a1) / 7));
  }
  return values;
}

function encodeAlphaBlock(pixels: Uint8Array): Uint8Array {
  const output = new Uint8Array(8);
  let min = 255;
  let max = 0;
  for (let i = 0; i < 16; i++) {
    const alpha = pixels[i * 4 + 3];
    min = Math.min(min, alpha);
    max = Math.max(max, alpha);
  }
  let a0 = max;
  let a1 = min;
  if (a0 === a1) {
    if (a0 === 0) {
      a0 = 1;
      a1 = 0;
    } else {
      a1 = a0 - 1;
    }
  }
  const palette = alphaPalette(a0, a1);
  const indices = new Array<number>(16);
  for (let i = 0; i < 16; i++) {
    const value = pixels[i * 4 + 3];
    let best = 0;
    let bestError = Number.POSITIVE_INFINITY;
    for (let p = 0; p < 8; p++) {
      const error = Math.abs(value - palette[p]);
      if (error < bestError) {
        bestError = error;
        best = p;
      }
    }
    indices[i] = best;
  }

  output[0] = a0;
  output[1] = a1;
  let accumulator = 0;
  let bits = 0;
  let byteOffset = 2;
  for (let i = 0; i < 16; i++) {
    accumulator |= indices[i] << bits;
    bits += 3;
    while (bits >= 8) {
      output[byteOffset++] = accumulator & 0xff;
      accumulator >>>= 8;
      bits -= 8;
    }
  }
  output[byteOffset] = accumulator & 0xff;
  return output;
}

function extractBlock(level: MipLevel, blockX: number, blockY: number): Uint8Array {
  const block = new Uint8Array(64);
  for (let y = 0; y < 4; y++) {
    const sourceY = Math.min(blockY * 4 + y, level.height - 1);
    for (let x = 0; x < 4; x++) {
      const sourceX = Math.min(blockX * 4 + x, level.width - 1);
      const source = (sourceY * level.width + sourceX) * 4;
      const target = (y * 4 + x) * 4;
      block[target] = level.data[source];
      block[target + 1] = level.data[source + 1];
      block[target + 2] = level.data[source + 2];
      block[target + 3] = level.data[source + 3];
    }
  }
  return block;
}

export function encodeLevel(level: MipLevel, codec: CodecId): EncodedMip {
  const blocksX = Math.max(1, Math.ceil(level.width / 4));
  const blocksY = Math.max(1, Math.ceil(level.height / 4));
  const bytesPerBlock = BLOCK_BYTES[codec];
  const data = new Uint8Array(blocksX * blocksY * bytesPerBlock);
  let output = 0;

  for (let blockY = 0; blockY < blocksY; blockY++) {
    for (let blockX = 0; blockX < blocksX; blockX++) {
      const block = extractBlock(level, blockX, blockY);
      if (codec === "bc1") {
        data.set(encodeBc1Block(block, true), output);
      } else {
        data.set(encodeAlphaBlock(block), output);
        data.set(encodeColor4Block(block), output + 8);
      }
      output += bytesPerBlock;
    }
  }
  return { width: level.width, height: level.height, data };
}

export function encodeMipChain(levels: MipLevel[], codec: CodecId): EncodedMip[] {
  return levels.map((level) => encodeLevel(level, codec));
}

function readU16(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

function readU32(data: Uint8Array, offset: number): number {
  return (
    (data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)) >>>
    0
  );
}

function readAlphaIndices(data: Uint8Array, offset: number): number[] {
  const indices = new Array<number>(16);
  let accumulator = 0;
  let bits = 0;
  let byteOffset = offset;
  for (let i = 0; i < 16; i++) {
    while (bits < 3) {
      accumulator |= data[byteOffset++] << bits;
      bits += 8;
    }
    indices[i] = accumulator & 7;
    accumulator >>>= 3;
    bits -= 3;
  }
  return indices;
}

function decodeBlock(
  encoded: Uint8Array,
  offset: number,
  codec: CodecId,
  output: Uint8Array,
  levelWidth: number,
  levelHeight: number,
  blockX: number,
  blockY: number,
): void {
  const colorOffset = codec === "bc3" ? offset + 8 : offset;
  const c0 = readU16(encoded, colorOffset);
  const c1 = readU16(encoded, colorOffset + 2);
  const indices = readU32(encoded, colorOffset + 4);
  const fourColor = codec === "bc3" || c0 > c1;
  const palette = fourColor ? palette4(c0, c1) : palette3(c0, c1);
  let alphaPaletteValues: number[] | null = null;
  let alphaIndices: number[] | null = null;
  if (codec === "bc3") {
    alphaPaletteValues = alphaPalette(encoded[offset], encoded[offset + 1]);
    alphaIndices = readAlphaIndices(encoded, offset + 2);
  }

  for (let y = 0; y < 4; y++) {
    const targetY = blockY * 4 + y;
    if (targetY >= levelHeight) continue;
    for (let x = 0; x < 4; x++) {
      const targetX = blockX * 4 + x;
      if (targetX >= levelWidth) continue;
      const pixel = y * 4 + x;
      const index = (indices >>> (pixel * 2)) & 3;
      const target = (targetY * levelWidth + targetX) * 4;
      let alpha = 255;
      if (!fourColor && index === 3) {
        output[target] = 0;
        output[target + 1] = 0;
        output[target + 2] = 0;
        output[target + 3] = 0;
        continue;
      }
      const color = palette[Math.min(index, palette.length - 1)];
      output[target] = color.r;
      output[target + 1] = color.g;
      output[target + 2] = color.b;
      if (alphaPaletteValues && alphaIndices) {
        alpha = alphaPaletteValues[alphaIndices[pixel]];
      }
      output[target + 3] = alpha;
    }
  }
}

export function decodeLevel(encoded: EncodedMip, codec: CodecId): MipLevel {
  const data = new Uint8Array(encoded.width * encoded.height * 4);
  const blocksX = Math.max(1, Math.ceil(encoded.width / 4));
  const blocksY = Math.max(1, Math.ceil(encoded.height / 4));
  const bytesPerBlock = BLOCK_BYTES[codec];
  let offset = 0;
  for (let blockY = 0; blockY < blocksY; blockY++) {
    for (let blockX = 0; blockX < blocksX; blockX++) {
      decodeBlock(
        encoded.data,
        offset,
        codec,
        data,
        encoded.width,
        encoded.height,
        blockX,
        blockY,
      );
      offset += bytesPerBlock;
    }
  }
  return { width: encoded.width, height: encoded.height, data };
}

export function decodeMipChain(encoded: EncodedMip[], codec: CodecId): MipLevel[] {
  return encoded.map((level) => decodeLevel(level, codec));
}

export function compareLevels(source: MipLevel, decoded: MipLevel): MapMetrics {
  const pixels = source.width * source.height;
  let squaredError = 0;
  let absoluteError = 0;
  let maxDelta = 0;
  let samples = 0;
  for (let i = 0; i < pixels; i++) {
    const offset = i * 4;
    if (source.data[offset + 3] < 128) continue;
    for (let channel = 0; channel < 3; channel++) {
      const delta = Math.abs(source.data[offset + channel] - decoded.data[offset + channel]);
      squaredError += delta * delta;
      absoluteError += delta;
      maxDelta = Math.max(maxDelta, delta);
      samples++;
    }
  }
  const mse = samples > 0 ? squaredError / samples : 0;
  return {
    compressedBytes: 0,
    rawBytes: source.data.length,
    psnr: mse === 0 ? Number.POSITIVE_INFINITY : 10 * Math.log10((255 * 255) / mse),
    maxDelta,
    meanDelta: samples > 0 ? absoluteError / samples : 0,
  };
}

export function compressedBytes(levels: EncodedMip[]): number {
  return levels.reduce((sum, level) => sum + level.data.length, 0);
}
