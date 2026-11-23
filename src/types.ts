export type MaterialId = "brick" | "tile" | "rust" | "screen";
export type MapId = "albedo" | "normal" | "roughness";
export type ViewMode = "raw" | "decoded" | "heat";
export type CodecId = "bc1" | "bc3";

export interface MaterialSettings {
  material: MaterialId;
  scale: number;
  wear: number;
  salt: number;
}

export interface MaterialInfo {
  id: MaterialId;
  index: string;
  name: string;
  en: string;
  note: string;
}

export interface MipLevel {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface EncodedMip {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface MapTexture {
  levels: MipLevel[];
  encoded: EncodedMip[];
  decoded: MipLevel[];
  base: MipLevel;
}

export interface MapMetrics {
  compressedBytes: number;
  rawBytes: number;
  psnr: number;
  maxDelta: number;
  meanDelta: number;
}

export interface CompressionResult {
  codec: CodecId;
  albedo: MapTexture;
  normal: MapTexture;
  roughness: MapTexture;
  metrics: Record<MapId, MapMetrics>;
  totalCompressedBytes: number;
  totalRawBytes: number;
  elapsedMs: number;
}

export interface ReloadCheck {
  ok: boolean;
  dimensions: string;
  mipCount: number;
  byteExact: boolean;
  normalDot: number;
  meanDelta: number;
  message: string;
}

export const MATERIALS: MaterialInfo[] = [
  {
    id: "brick",
    index: "01",
    name: "盐蚀青砖墙",
    en: "SALT-WORN BRICK",
    note: "错缝砌筑 · 灰缝结晶",
  },
  {
    id: "tile",
    index: "02",
    name: "风化陶瓦",
    en: "WEATHERED TERRACOTTA",
    note: "筒瓦叠压 · 釉面剥蚀",
  },
  {
    id: "rust",
    index: "03",
    name: "锈蚀铁板",
    en: "CORRODED IRON",
    note: "铆钉接缝 · 氧化斑驳",
  },
  {
    id: "screen",
    index: "04",
    name: "镂空金属屏风",
    en: "PIERCED BRONZE SCREEN",
    note: "透雕纹样 · 边缘积盐",
  },
];

export const MAPS: { id: MapId; label: string; en: string }[] = [
  { id: "albedo", label: "基础色", en: "ALBEDO · sRGB" },
  { id: "normal", label: "法线", en: "NORMAL · LINEAR" },
  { id: "roughness", label: "粗糙度", en: "ROUGHNESS · LINEAR" },
];
