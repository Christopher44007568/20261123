import type { CodecId, EncodedMip, MapId } from "../types";

const DDS_MAGIC = 0x20534444;
const DDS_HEADER_SIZE = 124;
const DDS_DX10_SIZE = 20;
const DDS_DATA_OFFSET = 4 + DDS_HEADER_SIZE + DDS_DX10_SIZE;

const DDSD_CAPS = 0x1;
const DDSD_HEIGHT = 0x2;
const DDSD_WIDTH = 0x4;
const DDSD_PIXELFORMAT = 0x1000;
const DDSD_MIPMAPCOUNT = 0x20000;
const DDSD_LINEARSIZE = 0x80000;
const DDPF_FOURCC = 0x4;
const DDSCAPS_COMPLEX = 0x8;
const DDSCAPS_TEXTURE = 0x1000;
const DDSCAPS_MIPMAP = 0x400000;

const DXGI_FORMATS: Record<CodecId, { linear: number; srgb: number }> = {
  bc1: { linear: 71, srgb: 72 },
  bc3: { linear: 77, srgb: 78 },
};

const FORMAT_LOOKUP = new Map<number, { codec: CodecId; srgb: boolean }>([
  [71, { codec: "bc1", srgb: false }],
  [72, { codec: "bc1", srgb: true }],
  [77, { codec: "bc3", srgb: false }],
  [78, { codec: "bc3", srgb: true }],
]);

function writeFourCC(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < 4; i++) view.setUint8(offset + i, value.charCodeAt(i));
}

function readFourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function ddsByteSize(levels: EncodedMip[], codec: CodecId): number {
  const blocks = levels.reduce(
    (sum, level) =>
      sum +
      Math.max(1, Math.ceil(level.width / 4)) *
        Math.max(1, Math.ceil(level.height / 4)),
    0,
  );
  return DDS_DATA_OFFSET + blocks * (codec === "bc1" ? 8 : 16);
}

export function buildDds(
  levels: EncodedMip[],
  codec: CodecId,
  map: MapId,
): ArrayBuffer {
  const base = levels[0];
  if (!base) throw new Error("DDS 至少需要一个 mip 层级");
  const srgb = map === "albedo";
  const dxgiFormat = DXGI_FORMATS[codec][srgb ? "srgb" : "linear"];
  const buffer = new ArrayBuffer(ddsByteSize(levels, codec));
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const headerFlags =
    DDSD_CAPS |
    DDSD_HEIGHT |
    DDSD_WIDTH |
    DDSD_PIXELFORMAT |
    DDSD_LINEARSIZE |
    (levels.length > 1 ? DDSD_MIPMAPCOUNT : 0);
  const caps =
    DDSCAPS_TEXTURE |
    (levels.length > 1 ? DDSCAPS_COMPLEX | DDSCAPS_MIPMAP : 0);

  view.setUint32(0, DDS_MAGIC, true);
  view.setUint32(4, DDS_HEADER_SIZE, true);
  view.setUint32(8, headerFlags, true);
  view.setUint32(12, base.height, true);
  view.setUint32(16, base.width, true);
  view.setUint32(20, base.data.length, true);
  view.setUint32(24, 0, true);
  view.setUint32(28, levels.length, true);
  for (let i = 0; i < 11; i++) view.setUint32(32 + i * 4, 0, true);

  view.setUint32(76, 32, true);
  view.setUint32(80, DDPF_FOURCC, true);
  writeFourCC(view, 84, "DX10");
  view.setUint32(88, 0, true);
  view.setUint32(92, 0, true);
  view.setUint32(96, 0, true);
  view.setUint32(100, 0, true);
  view.setUint32(104, 0, true);
  view.setUint32(108, caps, true);
  view.setUint32(112, 0, true);
  view.setUint32(116, 0, true);
  view.setUint32(120, 0, true);
  view.setUint32(124, 0, true);

  view.setUint32(128, dxgiFormat, true);
  view.setUint32(132, 3, true);
  view.setUint32(136, 0, true);
  view.setUint32(140, 1, true);
  view.setUint32(144, 0, true);

  let offset = DDS_DATA_OFFSET;
  for (const level of levels) {
    bytes.set(level.data, offset);
    offset += level.data.length;
  }
  return buffer;
}

export interface ParsedDds {
  width: number;
  height: number;
  mipCount: number;
  codec: CodecId;
  srgb: boolean;
  levels: EncodedMip[];
  byteLength: number;
}

export function parseDds(buffer: ArrayBuffer): ParsedDds {
  if (buffer.byteLength < 128) throw new Error("DDS 文件过短");
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== DDS_MAGIC) throw new Error("DDS 魔数无效");
  if (view.getUint32(4, true) !== DDS_HEADER_SIZE) throw new Error("DDS 头长度无效");

  const height = view.getUint32(12, true);
  const width = view.getUint32(16, true);
  const declaredMips = Math.max(1, view.getUint32(28, true));
  const fourCC = readFourCC(view, 84);
  let codec: CodecId;
  let srgb = false;
  let dataOffset = 128;

  if (fourCC === "DX10") {
    if (buffer.byteLength < DDS_DATA_OFFSET) throw new Error("DX10 扩展头缺失");
    const dxgi = view.getUint32(128, true);
    const format = FORMAT_LOOKUP.get(dxgi);
    if (!format) throw new Error(`暂不支持 DXGI 格式 ${dxgi}`);
    codec = format.codec;
    srgb = format.srgb;
    dataOffset = DDS_DATA_OFFSET;
  } else if (fourCC === "DXT1") {
    codec = "bc1";
  } else if (fourCC === "DXT5") {
    codec = "bc3";
  } else {
    throw new Error(`未知的 DDS FourCC: ${fourCC}`);
  }

  if (width === 0 || height === 0) throw new Error("DDS 尺寸无效");
  const levels: EncodedMip[] = [];
  let currentWidth = width;
  let currentHeight = height;
  let offset = dataOffset;
  for (let mip = 0; mip < declaredMips; mip++) {
    const blocksX = Math.max(1, Math.ceil(currentWidth / 4));
    const blocksY = Math.max(1, Math.ceil(currentHeight / 4));
    const blockBytes = codec === "bc1" ? 8 : 16;
    const length = blocksX * blocksY * blockBytes;
    if (offset + length > buffer.byteLength) throw new Error(`mip ${mip} 数据越界`);
    levels.push({
      width: currentWidth,
      height: currentHeight,
      data: new Uint8Array(buffer.slice(offset, offset + length)),
    });
    offset += length;
    currentWidth = Math.max(1, currentWidth >> 1);
    currentHeight = Math.max(1, currentHeight >> 1);
  }
  return {
    width,
    height,
    mipCount: levels.length,
    codec,
    srgb,
    levels,
    byteLength: buffer.byteLength,
  };
}

export function levelsByteEqual(a: EncodedMip[], b: EncodedMip[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].width !== b[i].width || a[i].height !== b[i].height) return false;
    if (a[i].data.length !== b[i].data.length) return false;
    for (let j = 0; j < a[i].data.length; j++) {
      if (a[i].data[j] !== b[i].data[j]) return false;
    }
  }
  return true;
}
