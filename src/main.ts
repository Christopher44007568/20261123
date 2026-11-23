import "./style.css";
import { compareLevels, compressedBytes, decodeMipChain, encodeMipChain } from "./compression/bc";
import { buildDds, levelsByteEqual, parseDds } from "./compression/dds";
import { normalDirectionError } from "./compression/mips";
import { MaterialGenerator } from "./gl/generator";
import { MaterialRenderer } from "./gl/renderer";
import { ThumbRenderer } from "./gl/thumbRenderer";
import { mountShell } from "./ui";
import { MATERIALS, MAPS } from "./types";
import type {
  CodecId,
  CompressionResult,
  MapId,
  MapTexture,
  MaterialId,
  MaterialSettings,
  ReloadCheck,
  ViewMode,
} from "./types";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("缺少 #app 根节点");
mountShell(root);

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`缺少界面元素: ${selector}`);
  return found;
}

const canvas = element<HTMLCanvasElement>("#viewport");
const gpuStatus = element<HTMLElement>("#gpu-status");
const busy = element<HTMLElement>("#busy");
const toast = element<HTMLElement>("#toast");
const stageTitle = element<HTMLElement>("#stage-title");
const stageSubtitle = element<HTMLElement>("#stage-subtitle");
const stageEyebrow = element<HTMLElement>("#stage-eyebrow");
const scaleSlider = element<HTMLInputElement>("#scale-slider");
const wearSlider = element<HTMLInputElement>("#wear-slider");
const saltSlider = element<HTMLInputElement>("#salt-slider");
const scaleOutput = element<HTMLOutputElement>("#scale-output");
const wearOutput = element<HTMLOutputElement>("#wear-output");
const saltOutput = element<HTMLOutputElement>("#salt-output");
const mipSlider = element<HTMLInputElement>("#mip-slider");
const mipCountLabel = element<HTMLElement>("#mip-count");
const analysisMip = element<HTMLElement>("#analysis-mip");
const summaryCodec = element<HTMLElement>("#summary-codec");
const summaryMap = element<HTMLElement>("#summary-map");
const statBytes = element<HTMLElement>("#stat-bytes");
const statPsnr = element<HTMLElement>("#stat-psnr");
const statDelta = element<HTMLElement>("#stat-delta");
const statRatio = element<HTMLElement>("#stat-ratio");
const ratioFill = element<HTMLElement>("#ratio-fill");
const summaryFoot = element<HTMLElement>("#summary-foot");
const cpuToggle = element<HTMLInputElement>("#cpu-toggle");
const uploadPathLabel = element<HTMLElement>("#upload-path-label");
const reloadNote = element<HTMLElement>("#reload-note");
const obliqueButton = element<HTMLButtonElement>("#oblique-button");
const viewportModeLabel = element<HTMLElement>("#viewport-mode-label");
const thumbCanvases: Record<ViewMode, HTMLCanvasElement> = {
  raw: element<HTMLCanvasElement>('[data-thumb="raw"]'),
  decoded: element<HTMLCanvasElement>('[data-thumb="decoded"]'),
  heat: element<HTMLCanvasElement>('[data-thumb="heat"]'),
};
const thumbRenderers: Record<ViewMode, ThumbRenderer> = {
  raw: new ThumbRenderer(thumbCanvases.raw),
  decoded: new ThumbRenderer(thumbCanvases.decoded),
  heat: new ThumbRenderer(thumbCanvases.heat),
};

const settings: MaterialSettings = {
  material: "brick",
  scale: 4,
  wear: 0.58,
  salt: 0.46,
};

let codec: CodecId = "bc1";
let viewMode: ViewMode = "raw";
let activeMap: MapId = "albedo";
let currentMip = 0;
let forceCpu = false;
let oblique = false;
let result: CompressionResult | null = null;
let activeUploadIsCompressed = false;
let rebuildTicket = 0;
let rebuildTimer = 0;
let toastTimer = 0;
let lastReload: ReloadCheck | null = null;

let renderer: MaterialRenderer;
let generator: MaterialGenerator;
try {
  const gl = canvas.getContext("webgl2");
  if (!gl) throw new Error("当前浏览器不支持 WebGL2");
  renderer = new MaterialRenderer(canvas);
  generator = new MaterialGenerator(gl, 1024);
} catch (error) {
  gpuStatus.classList.remove("is-ready");
  gpuStatus.innerHTML = `<i></i><span>WebGL2 初始化失败</span>`;
  summaryFoot.textContent = String(error);
  throw error;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatPsnr(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(2)} dB` : "∞ dB";
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function setBusy(active: boolean): void {
  busy.classList.toggle("is-visible", active);
}

function mapTexture(compression: CompressionResult, map: MapId): MapTexture {
  return compression[map];
}

function mapsRecord(compression: CompressionResult): Record<MapId, MapTexture> {
  return {
    albedo: compression.albedo,
    normal: compression.normal,
    roughness: compression.roughness,
  };
}

function updateMaterialText(): void {
  const material = MATERIALS.find((item) => item.id === settings.material) ?? MATERIALS[0];
  stageTitle.textContent = material.name;
  stageSubtitle.textContent = material.note;
  stageEyebrow.textContent = `MATERIAL SAMPLE / ${material.index}`;
}

function updateUploadPath(): void {
  if (activeUploadIsCompressed) {
    uploadPathLabel.textContent = `GPU S3TC · ${codec.toUpperCase()}`;
    gpuStatus.innerHTML = `<i></i><span>WEBGL2 READY · GPU ${codec.toUpperCase()}</span>`;
  } else if (!renderer.gpuCompressionSupported) {
    uploadPathLabel.textContent = "S3TC 不可用 · CPU BC 解码";
    gpuStatus.innerHTML = `<i></i><span>WEBGL2 READY · CPU BC</span>`;
  } else if (forceCpu) {
    uploadPathLabel.textContent = "强制 CPU BC 解码 / RGBA 上传";
    gpuStatus.innerHTML = `<i></i><span>WEBGL2 READY · CPU BC</span>`;
  } else {
    uploadPathLabel.textContent = "自动检测 S3TC";
    gpuStatus.innerHTML = `<i></i><span>WEBGL2 READY · AUTO</span>`;
  }
  gpuStatus.classList.add("is-ready");
}

function applyTextureSets(
  rawMaps: Record<MapId, MapTexture>,
  decodedMaps: Record<MapId, MapTexture>,
): void {
  const useGpu = renderer.gpuCompressionSupported && !forceCpu;
  try {
    renderer.setTextures(rawMaps, decodedMaps, codec, useGpu);
    activeUploadIsCompressed = useGpu;
  } catch (error) {
    renderer.setTextures(rawMaps, decodedMaps, codec, false);
    activeUploadIsCompressed = false;
    showToast(`GPU 压缩上传失败，已回退 CPU：${String(error)}`);
  }
  updateUploadPath();
}

function applyGpuTextures(): void {
  if (!result) return;
  const decodedMaps: Record<MapId, MapTexture> = {
    albedo: { ...result.albedo, levels: result.albedo.decoded, base: result.albedo.decoded[0] },
    normal: { ...result.normal, levels: result.normal.decoded, base: result.normal.decoded[0] },
    roughness: { ...result.roughness, levels: result.roughness.decoded, base: result.roughness.decoded[0] },
  };
  applyTextureSets(mapsRecord(result), decodedMaps);
}

async function rebuild(): Promise<void> {
  const ticket = ++rebuildTicket;
  setBusy(true);
  await yieldToBrowser();
  const started = performance.now();
  try {
    const chains = generator.generateChains(settings);
    const albedo: MapTexture = {
      levels: chains.albedo,
      encoded: encodeMipChain(chains.albedo, codec),
      decoded: [],
      base: chains.albedo[0],
    };
    albedo.decoded = decodeMipChain(albedo.encoded, codec);
    const normal: MapTexture = {
      levels: chains.normal,
      encoded: encodeMipChain(chains.normal, codec),
      decoded: [],
      base: chains.normal[0],
    };
    normal.decoded = decodeMipChain(normal.encoded, codec);
    const roughness: MapTexture = {
      levels: chains.roughness,
      encoded: encodeMipChain(chains.roughness, codec),
      decoded: [],
      base: chains.roughness[0],
    };
    roughness.decoded = decodeMipChain(roughness.encoded, codec);
    if (ticket !== rebuildTicket) return;

    const mapMetrics = {} as CompressionResult["metrics"];
    let totalCompressedBytes = 0;
    let totalRawBytes = 0;
    for (const map of ["albedo", "normal", "roughness"] as MapId[]) {
      const texture = map === "albedo" ? albedo : map === "normal" ? normal : roughness;
      const metrics = compareLevels(texture.levels[0], texture.decoded[0]);
      metrics.compressedBytes = compressedBytes(texture.encoded);
      metrics.rawBytes = texture.levels.reduce((sum, level) => sum + level.data.length, 0);
      mapMetrics[map] = metrics;
      totalCompressedBytes += metrics.compressedBytes;
      totalRawBytes += metrics.rawBytes;
    }

    result = {
      codec,
      albedo,
      normal,
      roughness,
      metrics: mapMetrics,
      totalCompressedBytes,
      totalRawBytes,
      elapsedMs: performance.now() - started,
    };
    lastReload = null;
    reloadNote.className = "reload-note";
    reloadNote.textContent = "导出后将解析文件并比对 mip、尺度与法线朝向。";
    const maxMip = albedo.levels.length - 1;
    currentMip = Math.min(currentMip, maxMip);
    mipSlider.max = String(maxMip);
    mipSlider.value = String(currentMip);
    mipCountLabel.textContent = `${albedo.levels.length} LEVELS`;
    renderer.setMip(currentMip);
    renderer.setHeatMap(activeMap);
    applyGpuTextures();
    refreshInterface();
  } catch (error) {
    console.error(error);
    showToast(`材质编译失败：${String(error)}`);
    summaryFoot.textContent = String(error);
  } finally {
    if (ticket === rebuildTicket) setBusy(false);
  }
}

function scheduleRebuild(delay = 170): void {
  window.clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(() => void rebuild(), delay);
}

function updateStats(): void {
  if (!result) return;
  const texture = mapTexture(result, activeMap);
  const raw = texture.levels[currentMip];
  const decoded = texture.decoded[currentMip];
  const metrics = compareLevels(raw, decoded);
  const bytes = compressedBytes(texture.encoded);
  const rawBytes = texture.levels.reduce((sum, level) => sum + level.data.length, 0);
  const ratio = rawBytes > 0 ? bytes / rawBytes : 0;
  const mapInfo = MAPS.find((map) => map.id === activeMap) ?? MAPS[0];

  summaryCodec.textContent = codec.toUpperCase();
  summaryMap.textContent = `${mapInfo.label} · ${activeMap === "albedo" ? "sRGB" : "LINEAR"}`;
  statBytes.textContent = formatBytes(bytes);
  statPsnr.textContent = formatPsnr(metrics.psnr);
  statDelta.textContent = `Δ ${metrics.maxDelta}`;
  statRatio.textContent = `${(ratio * 100).toFixed(1)}%`;
  ratioFill.style.width = `${Math.min(100, ratio * 100)}%`;
  analysisMip.textContent = `MIP ${currentMip} · ${raw.width}²`;
  const uploadText = activeUploadIsCompressed ? `GPU ${codec.toUpperCase()}` : "CPU BC 解码";
  summaryFoot.textContent = `全链 ${formatBytes(result.totalCompressedBytes)} / 原始 ${formatBytes(result.totalRawBytes)} · ${result.elapsedMs.toFixed(0)} ms · ${uploadText}`;
}

function refreshThumbnails(): void {
  if (!result) return;
  const texture = mapTexture(result, activeMap);
  const raw = texture.levels[currentMip];
  const decoded = texture.decoded[currentMip];
  for (const mode of ["raw", "decoded", "heat"] as ViewMode[]) {
    thumbRenderers[mode].draw(raw, decoded, activeMap, mode);
  }
}

function updateViewButtons(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === viewMode);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-view-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.viewMode === viewMode);
  });
  viewportModeLabel.textContent =
    viewMode === "raw" ? "RAW RGBA" : viewMode === "decoded" ? "BC DECODE" : "ERROR HEATMAP";
}

function updateMapTabs(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-map]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.map === activeMap);
  });
}

function updateMaterialButtons(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-material]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.material === settings.material);
  });
}

function updateCodecButtons(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-codec]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.codec === codec);
  });
}

function refreshInterface(): void {
  updateMaterialText();
  updateUploadPath();
  updateViewButtons();
  updateMapTabs();
  updateMaterialButtons();
  updateCodecButtons();
  updateStats();
  refreshThumbnails();
}

function ddsBuffers(compression: CompressionResult): Record<MapId, ArrayBuffer> {
  return {
    albedo: buildDds(compression.albedo.encoded, compression.codec, "albedo"),
    normal: buildDds(compression.normal.encoded, compression.codec, "normal"),
    roughness: buildDds(compression.roughness.encoded, compression.codec, "roughness"),
  };
}

function downloadBuffer(buffer: ArrayBuffer, filename: string): void {
  const blob = new Blob([buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportDds(): void {
  if (!result) {
    showToast("材质尚未完成编码");
    return;
  }
  const buffers = ddsBuffers(result);
  const prefix = `salt-${settings.material}-${settings.scale.toFixed(2)}x-${result.codec}`;
  for (const map of ["albedo", "normal", "roughness"] as MapId[]) {
    downloadBuffer(buffers[map], `${prefix}-${map}.dds`);
  }
  showToast(
    `已导出 3 个 DDS · ${formatBytes(result.totalCompressedBytes)} · ${result.albedo.encoded.length} mips`,
  );
}

function validateReload(): void {
  if (!result) {
    showToast("材质尚未完成编码");
    return;
  }
  try {
    const buffers = ddsBuffers(result);
    let byteExact = true;
    let dimensionOk = true;
    let srgbOk = true;
    let meanDelta = 0;
    let normalAngle = 0;
    const reloadedMaps = {} as Record<MapId, MapTexture>;
    for (const map of ["albedo", "normal", "roughness"] as MapId[]) {
      const parsed = parseDds(buffers[map]);
      const texture = mapTexture(result, map);
      byteExact = byteExact && levelsByteEqual(texture.encoded, parsed.levels);
      dimensionOk =
        dimensionOk &&
        parsed.width === texture.base.width &&
        parsed.height === texture.base.height &&
        parsed.mipCount === texture.encoded.length;
      srgbOk = srgbOk && parsed.srgb === (map === "albedo") && parsed.codec === result.codec;
      const reloaded = decodeMipChain(parsed.levels, parsed.codec);
      reloadedMaps[map] = {
        levels: reloaded,
        encoded: parsed.levels,
        decoded: reloaded,
        base: reloaded[0],
      };
      meanDelta += compareLevels(texture.decoded[0], reloaded[0]).meanDelta;
      if (map === "normal") {
        normalAngle = normalDirectionError(texture.levels[0], reloaded[0]);
      }
    }
    const dot = Math.cos(normalAngle);
    const ok = byteExact && dimensionOk && srgbOk && dot > 0.99;
    lastReload = {
      ok,
      dimensions: `${result.albedo.base.width}×${result.albedo.base.height}`,
      mipCount: result.albedo.encoded.length,
      byteExact,
      normalDot: dot,
      meanDelta,
      message: `${result.codec.toUpperCase()} · ${result.albedo.base.width}×${result.albedo.base.height} · ${result.albedo.encoded.length} mips · ${
        byteExact ? "3/3 字节一致" : "字节不一致"
      } · 法线 dot ${dot.toFixed(5)} · sRGB ${srgbOk ? "OK" : "ERR"}`,
    };
    applyTextureSets(mapsRecord(result), reloadedMaps);
    viewMode = "decoded";
    renderer.setViewMode(viewMode);
    updateViewButtons();
    updateStats();
    reloadNote.textContent = lastReload.message;
    reloadNote.className = `reload-note ${ok ? "is-good" : "is-bad"}`;
    showToast(ok ? "DDS 已回放：尺度、mip 与法线方向一致" : "DDS 重载校验未通过");
  } catch (error) {
    lastReload = null;
    reloadNote.textContent = `重载失败：${String(error)}`;
    reloadNote.className = "reload-note is-bad";
    showToast("DDS 重载校验失败");
  }
}

document.querySelectorAll<HTMLButtonElement>("[data-material]").forEach((button) => {
  button.addEventListener("click", () => {
    const material = button.dataset.material as MaterialId | undefined;
    if (!material || material === settings.material) return;
    settings.material = material;
    updateMaterialButtons();
    updateMaterialText();
    scheduleRebuild(70);
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-codec]").forEach((button) => {
  button.addEventListener("click", () => {
    const next = button.dataset.codec as CodecId | undefined;
    if (!next || next === codec) return;
    codec = next;
    updateCodecButtons();
    summaryCodec.textContent = codec.toUpperCase();
    void rebuild();
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    const next = button.dataset.view as ViewMode | undefined;
    if (!next) return;
    viewMode = next;
    renderer.setViewMode(viewMode);
    updateViewButtons();
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-view-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    const next = button.dataset.viewMode as ViewMode | undefined;
    if (!next) return;
    viewMode = next;
    renderer.setViewMode(viewMode);
    updateViewButtons();
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-map]").forEach((button) => {
  button.addEventListener("click", () => {
    const next = button.dataset.map as MapId | undefined;
    if (!next) return;
    activeMap = next;
    renderer.setHeatMap(activeMap);
    updateMapTabs();
    updateStats();
    refreshThumbnails();
  });
});

scaleSlider.addEventListener("input", () => {
  settings.scale = Number(scaleSlider.value);
  scaleOutput.textContent = `${settings.scale.toFixed(2)}×`;
  scheduleRebuild(220);
});

wearSlider.addEventListener("input", () => {
  settings.wear = Number(wearSlider.value);
  wearOutput.textContent = `${Math.round(settings.wear * 100)}%`;
  scheduleRebuild(220);
});

saltSlider.addEventListener("input", () => {
  settings.salt = Number(saltSlider.value);
  saltOutput.textContent = `${Math.round(settings.salt * 100)}%`;
  scheduleRebuild(220);
});

mipSlider.addEventListener("input", () => {
  currentMip = Number(mipSlider.value);
  renderer.setMip(currentMip);
  updateStats();
  refreshThumbnails();
});

cpuToggle.addEventListener("change", () => {
  forceCpu = cpuToggle.checked;
  applyGpuTextures();
  updateStats();
});

obliqueButton.addEventListener("click", () => {
  oblique = !oblique;
  obliqueButton.classList.toggle("is-active", oblique);
  renderer.setOblique(oblique);
});

element<HTMLButtonElement>("#export-button").addEventListener("click", exportDds);
element<HTMLButtonElement>("#reload-button").addEventListener("click", validateReload);

new ResizeObserver(() => renderer.queueRender()).observe(canvas);
window.addEventListener("resize", () => renderer.queueRender());

interface SaltLabSnapshot {
  material: MaterialId;
  scale: number;
  wear: number;
  salt: number;
  codec: CodecId;
  view: ViewMode;
  map: MapId;
  mip: number;
  mipCount: number;
  mipSize: number;
  uploadPath: "gpu" | "cpu";
  gpuSupported: boolean;
  stats: {
    bytes: string;
    psnr: string;
    maxDelta: string;
    totalCompressedBytes: number;
    totalRawBytes: number;
  };
  reload: ReloadCheck | null;
}

interface SaltLabApi {
  snapshot(): SaltLabSnapshot;
  validateReload(): ReloadCheck | null;
  getDds(map: MapId): ArrayBuffer | null;
}

const api: SaltLabApi = {
  snapshot() {
    const texture = result ? mapTexture(result, activeMap) : null;
    return {
      material: settings.material,
      scale: settings.scale,
      wear: settings.wear,
      salt: settings.salt,
      codec,
      view: viewMode,
      map: activeMap,
      mip: currentMip,
      mipCount: texture?.levels.length ?? 0,
      mipSize: texture?.levels[currentMip]?.width ?? 0,
      uploadPath: activeUploadIsCompressed ? "gpu" : "cpu",
      gpuSupported: renderer.gpuCompressionSupported,
      stats: {
        bytes: statBytes.textContent ?? "",
        psnr: statPsnr.textContent ?? "",
        maxDelta: statDelta.textContent ?? "",
        totalCompressedBytes: result?.totalCompressedBytes ?? 0,
        totalRawBytes: result?.totalRawBytes ?? 0,
      },
      reload: lastReload,
    };
  },
  validateReload() {
    validateReload();
    return lastReload;
  },
  getDds(map: MapId) {
    if (!result) return null;
    return ddsBuffers(result)[map];
  },
};

(window as unknown as { __SALT_LAB__: SaltLabApi }).__SALT_LAB__ = api;

scaleOutput.textContent = `${settings.scale.toFixed(2)}×`;
wearOutput.textContent = `${Math.round(settings.wear * 100)}%`;
saltOutput.textContent = `${Math.round(settings.salt * 100)}%`;
refreshInterface();
renderer.render();
void rebuild();
