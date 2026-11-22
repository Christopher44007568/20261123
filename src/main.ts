import "./style.css";
import {
  LightFieldRenderer,
  type FrameMetrics,
  type RenderMode,
  type RenderState,
} from "./renderer";

const byId = <T extends Element>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Element #${id} was not found.`);
  return element as unknown as T;
};

const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));

const pad2 = (value: number) => value.toString().padStart(2, "0");

type Vec2 = [number, number];

interface AppState {
  viewUV: Vec2;
  auto: boolean;
  autoPhase: number;
  fallback: number;
  layerMix: number;
  mode: RenderMode;
  dragging: boolean;
  dragStart: Vec2;
  dragOrigin: Vec2;
  lastMetrics: FrameMetrics;
}

const state: AppState = {
  viewUV: [0.5, 0.68],
  auto: true,
  autoPhase: 0,
  fallback: 0.18,
  layerMix: 0.54,
  mode: "hybrid",
  dragging: false,
  dragStart: [0, 0],
  dragOrigin: [0, 0],
  lastMetrics: {
    sampledViews: 8,
    validRate: 97.4,
    reprojectionError: 0.34,
    fallbackRate: 2.6,
    layerError: 0.08,
    temporalJitter: 0.01,
  },
};

const TRAJECTORY_PERIOD = 25;

function trajectoryAt(seconds: number): Vec2 {
  const phase = (seconds / TRAJECTORY_PERIOD) * Math.PI * 2;
  return [
    clamp(0.5 + Math.sin(phase) * 0.34, 0.05, 0.95),
    clamp(0.5 + Math.sin(phase * 2.0 + 1.1) * 0.255, 0.08, 0.92),
  ];
}

function closestTrajectoryPhase(view: Vec2): number {
  let bestPhase = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  const samples = 280;
  for (let index = 0; index < samples; index += 1) {
    const seconds = (index / samples) * TRAJECTORY_PERIOD;
    const point = trajectoryAt(seconds);
    const distance = Math.hypot(point[0] - view[0], point[1] - view[1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPhase = seconds;
    }
  }
  return bestPhase;
}

const sceneCanvas = byId<HTMLCanvasElement>("sceneCanvas");
const viewport = byId<HTMLDivElement>("viewport");
const cameraGrid = byId<HTMLCanvasElement>("cameraGrid");
const trajectoryChart = byId<HTMLCanvasElement>("trajectoryChart");
const gridContext = cameraGrid.getContext("2d") as CanvasRenderingContext2D;
const chartContext = trajectoryChart.getContext("2d") as CanvasRenderingContext2D;

if (!gridContext || !chartContext) {
  throw new Error("2D canvas context is unavailable.");
}

function gridPixel(point: Vec2): Vec2 {
  const margin = 13;
  const span = cameraGrid.width - margin * 2;
  return [margin + point[0] * span, margin + (1 - point[1]) * span];
}

function drawCameraGrid(now: number): void {
  const ctx = gridContext;
  const width = cameraGrid.width;
  const height = cameraGrid.height;
  ctx.clearRect(0, 0, width, height);

  const pass = ctx.createRadialGradient(width * 0.5, height * 0.52, 0, width * 0.5, height * 0.5, width * 0.7);
  pass.addColorStop(0, "rgba(168,245,211,0.045)");
  pass.addColorStop(1, "rgba(168,245,211,0)");
  ctx.fillStyle = pass;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(168,245,211,0.08)";
  ctx.lineWidth = 1;
  for (let index = 0; index < 9; index += 1) {
    const u = index / 8;
    const p1 = gridPixel([u, 0]);
    const p2 = gridPixel([u, 1]);
    ctx.globalAlpha = index === 4 ? 0.8 : 0.42;
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.stroke();
    const q1 = gridPixel([0, u]);
    const q2 = gridPixel([1, u]);
    ctx.beginPath();
    ctx.moveTo(q1[0], q1[1]);
    ctx.lineTo(q2[0], q2[1]);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.setLineDash([3, 5]);
  ctx.strokeStyle = "rgba(125,211,181,0.38)";
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  for (let index = 0; index <= 180; index += 1) {
    const point = gridPixel(trajectoryAt((index / 180) * TRAJECTORY_PERIOD));
    if (index === 0) ctx.moveTo(point[0], point[1]);
    else ctx.lineTo(point[0], point[1]);
  }
  ctx.stroke();
  ctx.restore();

  for (let gy = 0; gy < 9; gy += 1) {
    for (let gx = 0; gx < 9; gx += 1) {
      const point = gridPixel([gx / 8, gy / 8]);
      const nearestX = Math.round(state.viewUV[0] * 8);
      const nearestY = Math.round(state.viewUV[1] * 8);
      const nearest = gx === nearestX && gy === nearestY;
      ctx.beginPath();
      ctx.arc(point[0], point[1], nearest ? 2.5 : 1.65, 0, Math.PI * 2);
      ctx.fillStyle = nearest ? "rgba(216,255,112,0.9)" : "rgba(168,245,211,0.40)";
      ctx.fill();
      if (nearest) {
        ctx.beginPath();
        ctx.arc(point[0], point[1], 6.5 + Math.sin(now * 0.003) * 1.2, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(216,255,112,0.24)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  const nearestX = Math.round(state.viewUV[0] * 8);
  const nearestY = Math.round(state.viewUV[1] * 8);
  const cellX = gridPixel([nearestX / 8, nearestY / 8]);
  ctx.strokeStyle = "rgba(168,245,211,0.30)";
  ctx.lineWidth = 1;
  ctx.strokeRect(cellX[0] - 17, cellX[1] - 17, 34, 34);

  const point = gridPixel(state.viewUV);
  const halo = ctx.createRadialGradient(point[0], point[1], 0, point[0], point[1], 23);
  halo.addColorStop(0, "rgba(216,255,112,0.20)");
  halo.addColorStop(1, "rgba(216,255,112,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(point[0], point[1], 23, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(point[0], point[1], 5.2, 0, Math.PI * 2);
  ctx.fillStyle = "#d8ff70";
  ctx.shadowColor = "rgba(216,255,112,0.85)";
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(235,255,201,0.9)";
  ctx.beginPath();
  ctx.moveTo(point[0] - 12, point[1]);
  ctx.lineTo(point[0] - 7, point[1]);
  ctx.moveTo(point[0] + 7, point[1]);
  ctx.lineTo(point[0] + 12, point[1]);
  ctx.moveTo(point[0], point[1] - 12);
  ctx.lineTo(point[0], point[1] - 7);
  ctx.moveTo(point[0], point[1] + 7);
  ctx.lineTo(point[0], point[1] + 12);
  ctx.stroke();

  ctx.fillStyle = "rgba(120,147,137,0.7)";
  ctx.font = "8px monospace";
  ctx.textAlign = "center";
  for (let index = 0; index < 9; index += 2) {
    const p = gridPixel([index / 8, 0]);
    ctx.fillText(`${index + 1}`, p[0], height - 4);
  }
  ctx.textAlign = "right";
  for (let index = 0; index < 9; index += 2) {
    const p = gridPixel([0, index / 8]);
    ctx.fillText(`${index + 1}`, 9, p[1] + 3);
  }
}

function trajectoryError(seconds: number): number {
  const point = trajectoryAt(seconds);
  const gx = point[0] * 8;
  const gy = point[1] * 8;
  const fx = Math.abs((gx % 1) - 0.5) * 2;
  const fy = Math.abs((gy % 1) - 0.5) * 2;
  const structure = 0.20 + fx * fy * 0.27 + Math.abs(Math.sin(gx * 2.37 + gy * 1.91)) * 0.08;
  const transient = Math.sin(seconds * 2.7) * 0.018 + Math.sin(seconds * 7.1) * 0.009;
  return structure + transient;
}

function drawTrajectoryChart(): void {
  const ctx = chartContext;
  const width = trajectoryChart.width;
  const height = trajectoryChart.height;
  const left = 7;
  const right = width - 7;
  const top = 7;
  const bottom = height - 14;
  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(168,245,211,0.08)";
  ctx.lineWidth = 1;
  for (let index = 0; index <= 4; index += 1) {
    const x = left + ((right - left) * index) / 4;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  }
  for (let index = 0; index <= 2; index += 1) {
    const y = top + ((bottom - top) * index) / 2;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }

  const thresholdY = bottom - ((0.55 - 0.08) / 0.62) * (bottom - top);
  ctx.save();
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = "rgba(245,184,111,0.55)";
  ctx.beginPath();
  ctx.moveTo(left, thresholdY);
  ctx.lineTo(right, thresholdY);
  ctx.stroke();
  ctx.restore();

  const points: Vec2[] = [];
  const samples = 190;
  for (let index = 0; index <= samples; index += 1) {
    const seconds = (index / samples) * TRAJECTORY_PERIOD;
    const error = trajectoryError(seconds);
    const x = left + (index / samples) * (right - left);
    const y = bottom - ((error - 0.08) / 0.62) * (bottom - top);
    points.push([x, y]);
  }
  const fill = ctx.createLinearGradient(0, top, 0, bottom);
  fill.addColorStop(0, "rgba(168,245,211,0.16)");
  fill.addColorStop(1, "rgba(168,245,211,0)");
  ctx.beginPath();
  ctx.moveTo(left, bottom);
  points.forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.lineTo(right, bottom);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "rgba(168,245,211,0.78)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  const currentSeconds = state.auto ? state.autoPhase % TRAJECTORY_PERIOD : closestTrajectoryPhase(state.viewUV);
  const currentX = left + (currentSeconds / TRAJECTORY_PERIOD) * (right - left);
  const currentY = bottom - ((trajectoryError(currentSeconds) - 0.08) / 0.62) * (bottom - top);
  ctx.strokeStyle = "rgba(216,255,112,0.50)";
  ctx.beginPath();
  ctx.moveTo(currentX, top);
  ctx.lineTo(currentX, bottom);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(currentX, currentY, 3.2, 0, Math.PI * 2);
  ctx.fillStyle = "#d8ff70";
  ctx.shadowColor = "rgba(216,255,112,0.8)";
  ctx.shadowBlur = 7;
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = "rgba(108,134,124,0.72)";
  ctx.font = "7px monospace";
  ctx.textAlign = "left";
  ctx.fillText("0.0s", left, height - 3);
  ctx.textAlign = "center";
  ctx.fillText("6.2s", left + (right - left) * 0.25, height - 3);
  ctx.fillText("12.5s", left + (right - left) * 0.5, height - 3);
  ctx.fillText("18.7s", left + (right - left) * 0.75, height - 3);
  ctx.textAlign = "right";
  ctx.fillText("25.0s", right, height - 3);
}

const sampleCount = byId<HTMLElement>("sampleCount");
const validRate = byId<HTMLElement>("validRate");
const validRing = byId<SVGCircleElement>("validRing");
const reprojectError = byId<HTMLElement>("reprojectError");
const fallbackRate = byId<HTMLElement>("fallbackRate");
const layerError = byId<HTMLElement>("layerError");
const temporalJitter = byId<HTMLElement>("temporalJitter");
const viewIndex = byId<HTMLElement>("viewIndex");
const cameraPosition = byId<HTMLElement>("cameraPosition");
const trajectoryState = byId<HTMLElement>("trajectoryState");
const thetaValue = byId<HTMLElement>("thetaValue");
const phiValue = byId<HTMLElement>("phiValue");
const deltaEValue = byId<HTMLElement>("deltaEValue");
const popCheck = byId<HTMLElement>("popCheck");
const ghostCheck = byId<HTMLElement>("ghostCheck");
const slideCheck = byId<HTMLElement>("slideCheck");
const captureMs = byId<HTMLElement>("captureMs");
const lfStorage = byId<HTMLElement>("lfStorage");
const statusMessage = byId<HTMLElement>("statusMessage");
const fpsValue = byId<HTMLElement>("fpsValue");
const frameClock = byId<HTMLElement>("frameClock");
const resolutionValue = byId<HTMLElement>("resolutionValue");
const nearestValue = byId<HTMLElement>("nearestValue");
const linearValue = byId<HTMLElement>("linearValue");
const hybridValue = byId<HTMLElement>("hybridValue");

function updateReadout(metrics: FrameMetrics, frame: number): void {
  state.lastMetrics = metrics;
  const gridX = state.viewUV[0] * 8;
  const gridY = state.viewUV[1] * 8;
  const nearestX = Math.round(gridX) + 1;
  const nearestY = Math.round(gridY) + 1;
  viewIndex.textContent = `${pad2(nearestX)} / ${pad2(nearestY)}`;
  cameraPosition.textContent = `${gridX.toFixed(2)} / ${gridY.toFixed(2)}`;
  thetaValue.textContent = `${((state.viewUV[0] - 0.5) * 18.4).toFixed(2)}°`;
  phiValue.textContent = `${((state.viewUV[1] - 0.5) * 11.7).toFixed(2)}°`;
  deltaEValue.textContent = (0.10 + metrics.reprojectionError * 0.13).toFixed(2);
  sampleCount.textContent = `${metrics.sampledViews}`;
  validRate.textContent = metrics.validRate.toFixed(1);
  validRing.style.strokeDashoffset = `${138.2 * (1 - metrics.validRate / 100)}`;
  reprojectError.innerHTML = `${metrics.reprojectionError.toFixed(2)} <small>px</small>`;
  fallbackRate.innerHTML = `${metrics.fallbackRate.toFixed(1)} <small>%</small>`;
  layerError.innerHTML = `${metrics.layerError.toFixed(2)} <small>px</small>`;
  temporalJitter.innerHTML = `${metrics.temporalJitter.toFixed(2)} <small>px</small>`;
  popCheck.textContent = `${Math.max(0, (100 - metrics.validRate - 1.8)).toFixed(2)}%`;
  ghostCheck.textContent = `${(metrics.reprojectionError * 0.16).toFixed(2)} px`;
  slideCheck.textContent = `${(0.03 + metrics.temporalJitter * 2.1).toFixed(2)} px`;
  nearestValue.textContent = "1 src";
  linearValue.textContent = "4 src";
  hybridValue.textContent = "8 src";
  trajectoryState.textContent = state.auto
    ? `AUTO · ${(state.autoPhase % TRAJECTORY_PERIOD).toFixed(1)}s`
    : "MANUAL · 已定位";
  frameClock.textContent = `FRAME ${frame.toString().padStart(4, "0")}`;
  resolutionValue.textContent = `${sceneCanvas.width} × ${sceneCanvas.height}`;
  if (state.mode === "hybrid") {
    statusMessage.textContent = metrics.fallbackRate > 4
      ? "遮挡回退已启用 · 前后层透视组合稳定"
      : "深度重投影就绪 · 四邻域双线性重采样";
  } else if (state.mode === "linear") {
    statusMessage.textContent = "线性插值模式 · 无深度校正，观察轮廓重影";
  } else {
    statusMessage.textContent = "最近视角模式 · 单视角硬切采样";
  }
}

function setMode(mode: RenderMode): void {
  state.mode = mode;
  document.querySelectorAll<HTMLElement>("[data-mode]").forEach((element) => {
    element.classList.toggle("active", element.dataset.mode === mode);
  });
  document.querySelectorAll<HTMLElement>("[data-compare]").forEach((element) => {
    element.classList.toggle("active", element.dataset.compare === mode);
  });
}

function updateSliderLabels(): void {
  byId("thresholdValue").textContent = `${state.fallback.toFixed(2)} px`;
  byId("layerMixValue").textContent = `${Math.round(state.layerMix * 100)}%`;
}

function bindInteraction(): void {
  const autoButton = byId<HTMLButtonElement>("autoButton");
  autoButton.addEventListener("click", () => {
    state.auto = !state.auto;
    if (state.auto) {
      state.autoPhase = closestTrajectoryPhase(state.viewUV);
    }
    autoButton.classList.toggle("active", state.auto);
  });

  const revealButton = byId<HTMLButtonElement>("revealButton");
  let revealFront = false;
  revealButton.addEventListener("click", () => {
    revealFront = !revealFront;
    state.layerMix = revealFront ? 0.96 : 0.54;
    byId<HTMLInputElement>("layerMixSlider").value = state.layerMix.toString();
    updateSliderLabels();
    revealButton.classList.toggle("active", revealFront);
  });

  document.querySelectorAll<HTMLElement>("[data-mode], [data-compare]").forEach((element) => {
    element.addEventListener("click", () => {
      const mode = (element.dataset.mode ?? element.dataset.compare) as RenderMode;
      setMode(mode);
    });
  });

  const thresholdSlider = byId<HTMLInputElement>("thresholdSlider");
  thresholdSlider.addEventListener("input", () => {
    state.fallback = Number(thresholdSlider.value);
    updateSliderLabels();
  });
  const layerSlider = byId<HTMLInputElement>("layerMixSlider");
  layerSlider.addEventListener("input", () => {
    state.layerMix = Number(layerSlider.value);
    updateSliderLabels();
  });

  const startDrag = (event: PointerEvent) => {
    state.dragging = true;
    state.auto = false;
    autoButton.classList.remove("active");
    state.dragStart = [event.clientX, event.clientY];
    state.dragOrigin = [...state.viewUV];
    viewport.setPointerCapture(event.pointerId);
    byId("dragHint").classList.add("hidden");
  };
  viewport.addEventListener("pointerdown", startDrag);
  viewport.addEventListener("pointermove", (event) => {
    if (!state.dragging) return;
    const dx = (event.clientX - state.dragStart[0]) / viewport.clientWidth;
    const dy = (event.clientY - state.dragStart[1]) / viewport.clientHeight;
    state.viewUV = [
      clamp(state.dragOrigin[0] - dx * 1.05, 0.02, 0.98),
      clamp(state.dragOrigin[1] + dy * 1.05, 0.02, 0.98),
    ];
  });
  const endDrag = (event: PointerEvent) => {
    state.dragging = false;
    if (viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
  };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);

  const gridPointer = (event: PointerEvent) => {
    const rect = cameraGrid.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width);
    const y = clamp((event.clientY - rect.top) / rect.height);
    state.viewUV = [clamp(x, 0.02, 0.98), clamp(1 - y, 0.02, 0.98)];
    state.auto = false;
    autoButton.classList.remove("active");
    byId("dragHint").classList.add("hidden");
  };
  cameraGrid.addEventListener("pointerdown", (event) => {
    cameraGrid.setPointerCapture(event.pointerId);
    gridPointer(event);
  });
  cameraGrid.addEventListener("pointermove", (event) => {
    if (cameraGrid.hasPointerCapture(event.pointerId)) gridPointer(event);
  });
  cameraGrid.addEventListener("pointerup", (event) => {
    if (cameraGrid.hasPointerCapture(event.pointerId)) {
      cameraGrid.releasePointerCapture(event.pointerId);
    }
  });

  const helpPopover = byId<HTMLDivElement>("helpPopover");
  byId("helpButton").addEventListener("click", () => {
    helpPopover.hidden = !helpPopover.hidden;
  });
  byId("closeHelp").addEventListener("click", () => {
    helpPopover.hidden = true;
  });
}

function showCaptureLoader(): HTMLDivElement {
  const loader = document.createElement("div");
  loader.className = "capture-loader";
  loader.innerHTML = `
    <div class="loader-mark"><span></span><span></span><span></span></div>
    <div class="loader-copy">
      <span>ACQUIRING LIGHT FIELD</span>
      <strong>正在采集 9 × 9 程序化视角</strong>
      <div class="loader-track"><i></i></div>
      <small>颜色 + 深度 · 前后双图层 · 81 cameras</small>
    </div>`;
  viewport.appendChild(loader);
  return loader;
}

function bindThumbnailCanvases(): void {
  ["nearestCanvas", "linearCanvas", "hybridCanvas"].forEach((id) => {
    const canvas = byId<HTMLCanvasElement>(id);
    canvas.width = 240;
    canvas.height = 150;
  });
}

function paintThumbnail(id: string, pixels: ImageData | null): void {
  if (!pixels) return;
  const canvas = byId<HTMLCanvasElement>(id);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.putImageData(pixels, 0, 0);
}

function startApplication(): void {
  bindThumbnailCanvases();
  bindInteraction();
  updateSliderLabels();
  setMode("hybrid");

  let renderer: LightFieldRenderer;
  try {
    renderer = new LightFieldRenderer(sceneCanvas);
  } catch (error) {
    showFatalError(error);
    return;
  }

  const loader = showCaptureLoader();
  window.setTimeout(() => {
    requestAnimationFrame(() => {
      try {
        const stats = renderer.capture();
        captureMs.textContent = stats.milliseconds.toFixed(0);
        lfStorage.textContent = (stats.bytes / 1024 / 1024).toFixed(1);
        loader.classList.add("done");
        window.setTimeout(() => loader.remove(), 450);
        runRenderLoop(renderer);
      } catch (error) {
        loader.remove();
        showFatalError(error);
      }
    });
  }, 120);
}

function showFatalError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const panel = document.createElement("div");
  panel.className = "fatal-error";
  panel.innerHTML = `<strong>WebGL2 渲染器初始化失败</strong><p></p><small>请使用支持 WebGL2 与 GLSL 3.00 ES 的浏览器。</small>`;
  const paragraph = panel.querySelector("p");
  if (paragraph) paragraph.textContent = message;
  viewport.appendChild(panel);
  statusMessage.textContent = "渲染器错误 · 请检查 WebGL2 支持";
  console.error(message);
}

function runRenderLoop(renderer: LightFieldRenderer): void {
  let previous = performance.now();
  let frame = 0;
  let lastMetricsAt = 0;
  let lastThumbnailAt = 0;
  let lastUIAt = 0;
  let lastChartAt = 0;
  let fpsAccumulator = 0;
  let fpsFrames = 0;
  let displayedFps = 60;

  const frameLoop = (now: number) => {
    const delta = Math.min(0.05, (now - previous) / 1000);
    previous = now;
    frame += 1;
    fpsAccumulator += delta;
    fpsFrames += 1;
    if (fpsAccumulator > 0.5) {
      displayedFps = fpsFrames / fpsAccumulator;
      fpsValue.textContent = Math.round(displayedFps).toString();
      fpsAccumulator = 0;
      fpsFrames = 0;
    }

    if (state.auto && !state.dragging) {
      state.autoPhase += delta;
      const target = trajectoryAt(state.autoPhase);
      const blend = 1 - Math.exp(-delta * 11);
      state.viewUV = [
        state.viewUV[0] + (target[0] - state.viewUV[0]) * blend,
        state.viewUV[1] + (target[1] - state.viewUV[1]) * blend,
      ];
    }

    const renderState: RenderState = {
      viewUV: state.viewUV,
      mode: state.mode,
      fallback: state.fallback,
      layerMix: state.layerMix,
      time: now / 1000,
    };
    renderer.render(renderState);

    if (now - lastMetricsAt > 110) {
      state.lastMetrics = renderer.computeMetrics(renderState);
      lastMetricsAt = now;
    }
    if (now - lastUIAt > 95) {
      updateReadout(state.lastMetrics, frame);
      drawCameraGrid(now);
      lastUIAt = now;
    }
    if (now - lastChartAt > 130) {
      drawTrajectoryChart();
      lastChartAt = now;
    }
    if (now - lastThumbnailAt > 185) {
      paintThumbnail("nearestCanvas", renderer.renderThumbnail("nearest", renderState));
      paintThumbnail("linearCanvas", renderer.renderThumbnail("linear", renderState));
      paintThumbnail("hybridCanvas", renderer.renderThumbnail("hybrid", renderState));
      lastThumbnailAt = now;
    }
    requestAnimationFrame(frameLoop);
  };

  renderer.resize();
  window.addEventListener("resize", () => renderer.resize());
  requestAnimationFrame(frameLoop);
}

startApplication();
