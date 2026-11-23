import type { MapId, MipLevel } from "../types";

const SRGB_TO_LINEAR = new Float32Array(256);
const LINEAR_TO_SRGB = new Uint8Array(8193);

function srgbToLinear(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

for (let i = 0; i < 256; i++) SRGB_TO_LINEAR[i] = srgbToLinear(i);
for (let i = 0; i <= 8192; i++) {
  const c = i / 8192;
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  LINEAR_TO_SRGB[i] = Math.round(Math.min(1, Math.max(0, s)) * 255);
}

function linearToSrgbByte(value: number): number {
  const index = Math.round(Math.min(1, Math.max(0, value)) * 8192);
  return LINEAR_TO_SRGB[index];
}

export function flipRowsY(level: MipLevel): MipLevel {
  const rowBytes = level.width * 4;
  const data = new Uint8Array(level.data.length);
  for (let y = 0; y < level.height; y++) {
    const source = (level.height - 1 - y) * rowBytes;
    data.set(level.data.subarray(source, source + rowBytes), y * rowBytes);
  }
  return { width: level.width, height: level.height, data };
}

function downsampleAlbedo(source: MipLevel): MipLevel {
  const width = Math.max(1, Math.floor(source.width / 2));
  const height = Math.max(1, Math.floor(source.height / 2));
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const y0 = Math.min(y * 2, source.height - 1);
    const y1 = Math.min(y * 2 + 1, source.height - 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.min(x * 2, source.width - 1);
      const x1 = Math.min(x * 2 + 1, source.width - 1);
      let lr = 0;
      let lg = 0;
      let lb = 0;
      let alphaSum = 0;
      let weightSum = 0;
      const taps = [
        [x0, y0],
        [x1, y0],
        [x0, y1],
        [x1, y1],
      ];
      for (const [sx, sy] of taps) {
        const offset = (sy * source.width + sx) * 4;
        const alpha = source.data[offset + 3] / 255;
        const weight = alpha;
        lr += SRGB_TO_LINEAR[source.data[offset]] * weight;
        lg += SRGB_TO_LINEAR[source.data[offset + 1]] * weight;
        lb += SRGB_TO_LINEAR[source.data[offset + 2]] * weight;
        alphaSum += alpha;
        weightSum += weight;
      }
      const output = (y * width + x) * 4;
      if (weightSum > 0.00001) {
        data[output] = linearToSrgbByte(lr / weightSum);
        data[output + 1] = linearToSrgbByte(lg / weightSum);
        data[output + 2] = linearToSrgbByte(lb / weightSum);
      }
      data[output + 3] = Math.round((alphaSum / 4) * 255);
    }
  }
  return { width, height, data };
}

function downsampleNormal(source: MipLevel): MipLevel {
  const width = Math.max(1, Math.floor(source.width / 2));
  const height = Math.max(1, Math.floor(source.height / 2));
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const y0 = Math.min(y * 2, source.height - 1);
    const y1 = Math.min(y * 2 + 1, source.height - 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.min(x * 2, source.width - 1);
      const x1 = Math.min(x * 2 + 1, source.width - 1);
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (const [sx, sy] of [
        [x0, y0],
        [x1, y0],
        [x0, y1],
        [x1, y1],
      ]) {
        const offset = (sy * source.width + sx) * 4;
        const tx = (source.data[offset] / 255) * 2 - 1;
        const ty = (source.data[offset + 1] / 255) * 2 - 1;
        nx += tx;
        ny += ty;
        nz += Math.sqrt(Math.max(0, 1 - tx * tx - ty * ty));
      }
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= length;
      ny /= length;
      const output = (y * width + x) * 4;
      data[output] = Math.round((nx * 0.5 + 0.5) * 255);
      data[output + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[output + 2] = 255;
      data[output + 3] = 255;
    }
  }
  return { width, height, data };
}

function downsampleLinear(source: MipLevel): MipLevel {
  const width = Math.max(1, Math.floor(source.width / 2));
  const height = Math.max(1, Math.floor(source.height / 2));
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const y0 = Math.min(y * 2, source.height - 1);
    const y1 = Math.min(y * 2 + 1, source.height - 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.min(x * 2, source.width - 1);
      const x1 = Math.min(x * 2 + 1, source.width - 1);
      const output = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        const a = source.data[(y0 * source.width + x0) * 4 + channel];
        const b = source.data[(y0 * source.width + x1) * 4 + channel];
        const c = source.data[(y1 * source.width + x0) * 4 + channel];
        const d = source.data[(y1 * source.width + x1) * 4 + channel];
        data[output + channel] = Math.round((a + b + c + d) / 4);
      }
    }
  }
  return { width, height, data };
}

export function buildMipChain(base: MipLevel, map: MapId): MipLevel[] {
  const levels: MipLevel[] = [base];
  let current = base;
  while (current.width > 1 || current.height > 1) {
    if (map === "albedo") current = downsampleAlbedo(current);
    else if (map === "normal") current = downsampleNormal(current);
    else current = downsampleLinear(current);
    levels.push(current);
  }
  return levels;
}

export function averageNormal(level: MipLevel): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  const pixels = level.width * level.height;
  for (let i = 0; i < pixels; i++) {
    const offset = i * 4;
    const nx = (level.data[offset] / 255) * 2 - 1;
    const ny = (level.data[offset + 1] / 255) * 2 - 1;
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    x += nx;
    y += ny;
    z += nz;
  }
  const length = Math.sqrt(x * x + y * y + z * z) || 1;
  return [x / length, y / length, z / length];
}

export function normalDirectionError(a: MipLevel, b: MipLevel): number {
  const na = averageNormal(a);
  const nb = averageNormal(b);
  const dot = na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2];
  return Math.acos(Math.min(1, Math.max(-1, dot)));
}

