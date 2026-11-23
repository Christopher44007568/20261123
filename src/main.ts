import "./styles.css";
import { RestirRenderer, type StatsSnapshot } from "./renderer";

const canvas = document.querySelector<HTMLCanvasElement>("#gpu-canvas");
if (!canvas) throw new Error("Canvas is missing.");

const params = new URLSearchParams(window.location.search);
const resParam = params.get("res");
let resolutionOverride: [number, number] | null = null;
if (resParam?.includes("x")) {
  const [width, height] = resParam.split("x").map(Number);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    resolutionOverride = [Math.round(width), Math.round(height)];
  }
}

const renderer = new RestirRenderer(canvas, resolutionOverride);
window.__RESTIR__ = renderer;

const element = <T extends HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing UI element: ${selector}`);
  return found;
};

const boot = element<HTMLDivElement>("#boot");
const acceptValue = element<HTMLElement>("#metric-accept");
const acceptNote = element<HTMLElement>("#metric-accept-note");
const historyValue = element<HTMLElement>("#metric-history");
const weightValue = element<HTMLElement>("#metric-weight");
const errorValue = element<HTMLElement>("#metric-error");
const chartFill = element<HTMLElement>("#chart-fill");
const chartValue = element<HTMLElement>("#chart-value");
const frameCounter = element<HTMLElement>("#frame-counter");
const cameraPhase = element<HTMLElement>("#camera-phase");
const pathHead = element<HTMLElement>("#path-head");
const resolutionLabel = element<HTMLElement>("#resolution-label");
const statusLabel = element<HTMLElement>("#status-label");
const spatialToggle = element<HTMLInputElement>("#spatial-toggle");
const viewMode = element<HTMLSelectElement>("#view-mode");
const cacheSize = element<HTMLInputElement>("#cache-size");
const cacheOutput = element<HTMLOutputElement>("#cache-output");
const pauseButton = element<HTMLButtonElement>("#pause-button");
const resetButton = element<HTMLButtonElement>("#reset-button");
const toast = element<HTMLDivElement>("#toast");

let toastTimer = 0;
const showToast = (message: string): void => {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
};

let paused = false;
const updatePauseButton = (): void => {
  pauseButton.classList.toggle("is-active", paused);
  pauseButton.innerHTML = paused ? "<span>▶</span> 继续路径" : "<span>Ⅱ</span> 暂停路径";
};

const updateStats = (stats: StatsSnapshot): void => {
  acceptValue.textContent = `${(stats.acceptRate * 100).toFixed(1)}%`;
  acceptNote.textContent =
    `${(stats.temporalAttempts / 1000).toFixed(0)}k temporal · ${(stats.spatialAttempts / 1000).toFixed(0)}k spatial`;
  historyValue.textContent = `${(stats.historyRejectRate * 100).toFixed(1)}%`;
  weightValue.textContent = stats.meanWeight > 0 ? stats.meanWeight.toFixed(1) : "—";
  errorValue.textContent = stats.referenceError > 0 ? `${stats.referenceError.toFixed(4)} L1` : "not sampled";
  const percent = Math.max(0, Math.min(100, stats.acceptRate * 100));
  chartFill.style.width = `${percent}%`;
  chartValue.textContent = `${percent.toFixed(0)}%`;
  frameCounter.textContent = String(stats.frame).padStart(4, "0");
};

const updatePathUi = (pathTime: number): void => {
  const orbit = (Math.PI * 2) / 0.11;
  const normalized = ((pathTime % orbit) + orbit) % orbit;
  pathHead.style.left = `${Math.min(100, normalized / orbit * 100)}%`;
  const degrees = ((-2.62 + pathTime * 0.11) * 180 / Math.PI % 360 + 360) % 360;
  cameraPhase.textContent = `ORBIT ${degrees.toFixed(1).padStart(5, "0")}°`;
};

renderer.onStats(updateStats);

spatialToggle.addEventListener("change", () => {
  renderer.setSpatial(spatialToggle.checked);
  showToast(spatialToggle.checked ? "空间复用已开启" : "空间复用已关闭");
});

viewMode.addEventListener("change", () => {
  const mode = Number(viewMode.value);
  renderer.setMode(mode);
  if (mode === 1 || mode === 2) {
    paused = true;
    updatePauseButton();
    showToast(mode === 1 ? "正在生成 220 灯参考图" : "参考 / ReSTIR 分割对比");
  }
});

cacheSize.addEventListener("input", () => {
  const value = Number(cacheSize.value);
  cacheOutput.textContent = String(value);
  renderer.setHistoryCap(value);
  const ratio = (value - 4) / 60;
  cacheSize.style.background =
    `linear-gradient(90deg, var(--amber-soft) 0 ${ratio * 100}%, rgba(255,255,255,.14) ${ratio * 100}%)`;
});

pauseButton.addEventListener("click", () => {
  paused = !paused;
  renderer.setPaused(paused);
  updatePauseButton();
});

resetButton.addEventListener("click", () => {
  renderer.resetHistory();
  showToast("Reservoir 历史已清空");
});

renderer.onReady(() => {
  boot.classList.add("is-hidden");
  resolutionLabel.textContent = `${canvas.width} × ${canvas.height}`;
  statusLabel.textContent = "WEBGPU / LIVE";
  let previous = performance.now();
  const frame = (now: number): void => {
    const delta = (now - previous) / 1000;
    previous = now;
    renderer.resize();
    renderer.tick(delta);
    updatePathUi(renderer.snapshot().pathTime);
    window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);
  showToast("220 盏工作灯 · 20 初始候选 / 4-neighbor 空间重采样");
});

renderer.initialize().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  boot.remove();
  const fatal = document.createElement("div");
  fatal.className = "fatal";
  fatal.innerHTML = `
    <div class="fatal-card">
      <h2>WEBGPU INITIALIZATION FAILED</h2>
      <p>${message}<br><br>请使用支持 WebGPU 的 Chromium，并启用 SwiftShader 或硬件 GPU 适配器。</p>
    </div>`;
  document.body.appendChild(fatal);
  statusLabel.textContent = "WEBGPU / OFFLINE";
});
