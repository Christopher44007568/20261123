import "./styles.css";
import { MAX_DROPLETS, projectRadiusPx, type LensSettings, type RainMode } from "./render/droplets";
import { RainRenderer, type RainDiagnostics } from "./render/renderer";
import { LensRainUi } from "./ui";

interface LensRainDebugApi {
  ready: boolean;
  setMode: (mode: RainMode) => void;
  setFocus: (distanceM: number) => void;
  setFocalLength: (focalLengthMm: number) => void;
  setAperture: (aperture: number) => void;
  setShowMask: (show: boolean) => void;
  setExposure: (exposure: number) => void;
  getDiagnostics: () => RainDiagnostics;
  readPixel: (x: number, y: number) => [number, number, number, number];
  projectRadius: (radiusMm: number, depthM: number, focalLengthMm: number) => number;
}

declare global {
  interface Window {
    __lensRain?: LensRainDebugApi;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>("#viewport");
const uiRoot = document.querySelector<HTMLElement>("#ui");
if (!canvas || !uiRoot) throw new Error("Application mount points are missing.");

let renderer: RainRenderer;
let ui: LensRainUi;

try {
  renderer = new RainRenderer(canvas, "drift");
  ui = new LensRainUi(
    uiRoot,
    {
      onMode: (mode) => renderer.setMode(mode),
      onLens: (patch) => renderer.setLens(patch),
      onShowMask: (show) => renderer.setShowMask(show),
    },
    renderer.state.lens,
  );
} catch (error) {
  uiRoot.innerHTML = `
    <div class="fatal-error">
      <strong>WebGL2 / HDR 初始化失败</strong>
      <p>${error instanceof Error ? error.message : String(error)}</p>
    </div>
  `;
  throw error;
}

const currentLens = (): LensSettings => ({ ...renderer.state.lens });

const syncLens = (patch: Partial<LensSettings>): void => {
  renderer.setLens(patch);
  ui.syncLens(renderer.state.lens);
};

window.__lensRain = {
  ready: true,
  setMode: (mode) => {
    renderer.setMode(mode);
    ui.setMode(mode);
  },
  setFocus: (distanceM) => {
    const focusDistanceM = Math.min(0.36, Math.max(0.08, distanceM));
    syncLens({ focusDistanceM });
  },
  setFocalLength: (focalLengthMm) => {
    syncLens({ focalLengthMm: Math.min(85, Math.max(24, focalLengthMm)) });
  },
  setAperture: (aperture) => {
    syncLens({ aperture: Math.min(8, Math.max(1.4, aperture)) });
  },
  setShowMask: (show) => {
    renderer.setShowMask(show);
    ui.setMaskVisible(show);
  },
  setExposure: (exposure) => renderer.setExposure(exposure),
  getDiagnostics: () => renderer.getDiagnostics(),
  readPixel: (x, y) => renderer.readPixelCss(x, y),
  projectRadius: (radiusMm, depthM, focalLengthMm) =>
    projectRadiusPx(radiusMm, depthM, focalLengthMm, currentLens().sensorWidthMm, renderer.canvas.height),
};

const resizeObserver = new ResizeObserver(() => renderer.resize());
resizeObserver.observe(canvas);
window.addEventListener("resize", () => renderer.resize());

const clock = document.querySelector<HTMLElement>("#clock");
const updateClock = (): void => {
  if (!clock) return;
  const now = new Date();
  clock.textContent = now.toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};
updateClock();
window.setInterval(updateClock, 1000);

let lastUiUpdate = 0;
const frame = (now: number): void => {
  renderer.resize();
  renderer.render(now);
  if (now - lastUiUpdate > 240) {
    ui.update(renderer.getDiagnostics());
    lastUiUpdate = now;
  }
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

document.documentElement.dataset.maxDrops = String(MAX_DROPLETS);
