import {
  CAMERA_PATH,
  DEFAULT_FOV,
  ERROR_THRESHOLD_PX,
  cameraSnapshot,
  raiseCamera,
  sampleCameraPath,
  type CameraPose,
  type CameraSnapshot,
} from "./camera";
import {
  COUNTER,
  cullScene,
  compareCulling,
  type CullComparison,
  type CullResult,
} from "./culling";
import { buildScene } from "./geometry/build";
import { TRIANGLES_PER_CLUSTER } from "./geometry/types";
import { Renderer } from "./renderer";

interface CaptureReport {
  progress: number;
  mode: number;
  pose: CameraPose;
  residentPages: number;
  gpu: {
    drawArgs: number[];
    stats: number[];
    visible: number[];
    triangles: number;
  };
  cpu: {
    stats: number[];
    triangles: number;
    clusters: number;
    fallbackClusters: number;
    lodClusters: [number, number, number, number];
  };
  comparison: CullComparison;
  lodSwitches: [number, number, number, number];
  transitions: number[][];
  adapterInfo: string;
}

interface VgeoApi {
  ready: boolean;
  path: CameraPose[];
  setProgress(progress: number): Promise<void>;
  captureAtPose(
    pose: CameraPose,
    options?: {
      mode?: number;
      settleFrames?: number;
      loadBudget?: number;
      clearPages?: boolean;
      progress?: number;
    },
  ): Promise<CaptureReport>;
  captureFallback(pose: CameraPose, progress?: number): Promise<CaptureReport>;
  captureScreenshot(
    pose: CameraPose,
    options?: {
      mode?: number;
      settleFrames?: number;
      loadBudget?: number;
      clearPages?: boolean;
      progress?: number;
    },
  ): Promise<string>;
  runPathVerification(): Promise<{
    checkpoints: CaptureReport[];
    lodSwitches: [number, number, number, number];
    transitions: number[][];
    totalSwitches: number;
    maxTriangles: number;
    peakClusters: number;
    adapterInfo: string;
  }>;
  clearPages(): void;
  resetLodCounters(): void;
  pause(): void;
  resume(): void;
}

declare global {
  interface Window {
    __vgeo?: VgeoApi;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>("#gpu-canvas")!;
const readbackImage = document.querySelector<HTMLImageElement>("#readback-image")!;
const loading = document.querySelector<HTMLElement>("#loading")!;
const loadingDetail = document.querySelector<HTMLElement>("#loading-detail")!;
const errorPanel = document.querySelector<HTMLElement>("#error")!;
const statusEl = document.querySelector<HTMLElement>("#gpu-status")!;
const progressEl = document.querySelector<HTMLInputElement>("#progress")!;
const playButton = document.querySelector<HTMLButtonElement>("#play")!;
const restartButton = document.querySelector<HTMLButtonElement>("#restart")!;
const upButton = document.querySelector<HTMLButtonElement>("#up")!;
const downButton = document.querySelector<HTMLButtonElement>("#down")!;
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>(".mode")];
const verifyState = document.querySelector<HTMLElement>("#verify-state")!;
const compareState = document.querySelector<HTMLElement>("#compare-state")!;

let renderer: Renderer;
let scene: ReturnType<typeof buildScene>;
let playing = true;
let manual = false;
let progress = 0;
let pose: CameraPose = CAMERA_PATH[0]!;
let lastTime = performance.now();
let mode = 0;
let lastCpu: CullResult | null = null;
let lastComparison: CullComparison | null = null;
const lodSwitches: [number, number, number, number] = [0, 0, 0, 0];
const previousLods = new Int32Array(488).fill(-1);
const transitions: number[][] = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

function formatInt(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function renderSize(): { width: number; height: number } {
  return {
    width: Math.max(320, Math.floor(canvas.clientWidth * dpr)),
    height: Math.max(240, Math.floor(canvas.clientHeight * dpr)),
  };
}

function currentCamera(): CameraSnapshot {
  const { width, height } = renderSize();
  return cameraSnapshot(pose, width, height, DEFAULT_FOV);
}

function observeLods(cpu: CullResult): void {
  for (let page = 0; page < cpu.decisions.length; page++) {
    const lod = cpu.decisions[page]!.lod;
    const previous = previousLods[page]!;
    if (previous >= 0 && previous !== lod) {
      lodSwitches[lod]!++;
      transitions[previous]![lod]!++;
    }
    previousLods[page] = lod;
  }
}

function renderCurrent(loadBudget = 8): void {
  const camera = currentCamera();
  renderer.resize(camera.width, camera.height);
  renderer.render(camera, loadBudget);
  const cpu = cullScene(scene, camera, renderer.pageStore.slots, ERROR_THRESHOLD_PX);
  lastCpu = cpu;
  observeLods(cpu);
  updateHud(cpu);
}

function updateHud(cpu: CullResult): void {
  const clusters = cpu.stats[COUNTER.submitted]!;
  const triangles = clusters * TRIANGLES_PER_CLUSTER;
  const set = (id: string, value: string): void => {
    const el = document.querySelector<HTMLElement>(`#${id}`);
    if (el) el.textContent = value;
  };
  set("stat-triangles", formatInt(triangles));
  set("stat-clusters", `${formatInt(clusters)} clusters`);
  set("stat-source", formatInt(scene.sourceTriangles));
  set("stat-candidates", formatInt(scene.candidateClusters));
  set("stat-resident", `${renderer.pageStore.residentCount} / ${scene.pages.length}`);
  set(
    "stat-fallback",
    `${formatInt(cpu.stats[COUNTER.fallbackClusters]!)} / ${formatInt(cpu.stats[COUNTER.coverageClusters]!)}`,
  );
  for (let lod = 0; lod < 4; lod++) {
    set(`lod${lod}`, formatInt(cpu.stats[COUNTER.lod0 + lod]!));
    set(`sw${lod}`, `↻ ${formatInt(lodSwitches[lod]!)}`);
  }
  statusEl.innerHTML = "<i></i>运行中";
  statusEl.classList.add("ok");
  if (!lastComparison) {
    verifyState.textContent = "CPU 参考逐帧运行";
    compareState.textContent = "待 GPU 回读";
  }
}

function setMode(next: number): void {
  mode = next;
  renderer.setMode(next);
  for (const button of modeButtons) {
    button.classList.toggle("active", Number(button.dataset.mode) === next);
  }
  if (manual && lastCpu) {
    const camera = currentCamera();
    renderer.render(camera, 0);
    const cpu = cullScene(scene, camera, renderer.pageStore.slots, ERROR_THRESHOLD_PX);
    lastCpu = cpu;
    updateHud(cpu);
  }
}

function setPlaying(next: boolean): void {
  playing = next;
  playButton.textContent = next ? "暂停巡航" : "继续巡航";
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function jsonReport(
  gpu: Awaited<ReturnType<Renderer["captureGpuState"]>>,
  cpu: CullResult,
  options?: { progress?: number; pose?: CameraPose },
): CaptureReport {
  const comparison = compareCulling(gpu.visible, Uint32Array.from(gpu.stats), cpu);
  lastComparison = comparison;
  verifyState.textContent = comparison.match
    ? "裁剪集合 GPU = CPU"
    : `裁剪集合差异 ${comparison.missingFromGpu.length + comparison.extraOnGpu.length}`;
  compareState.textContent = comparison.match && comparison.statsMatch ? "COUNTERS ✓" : "CHECK";
  compareState.style.color = comparison.match && comparison.statsMatch ? "#73d7b3" : "#ee8a69";
  return {
    progress: options?.progress ?? progress,
    mode,
    pose: options?.pose ?? pose,
    residentPages: renderer.pageStore.residentCount,
    gpu: {
      drawArgs: gpu.drawArgs,
      stats: gpu.stats,
      visible: gpu.visible,
      triangles: gpu.drawArgs[1]! * TRIANGLES_PER_CLUSTER,
    },
    cpu: {
      stats: Array.from(cpu.stats),
      triangles: cpu.stats[COUNTER.submitted]! * TRIANGLES_PER_CLUSTER,
      clusters: cpu.stats[COUNTER.submitted]!,
      fallbackClusters: cpu.stats[COUNTER.fallbackClusters]!,
      lodClusters: [0, 1, 2, 3].map(
        (lod) => cpu.stats[COUNTER.lod0 + lod]!,
      ) as [number, number, number, number],
    },
    comparison,
    lodSwitches: [...lodSwitches],
    transitions: transitions.map((row) => [...row]),
    adapterInfo: gpu.adapterInfo,
  };
}

function resetLodCounters(): void {
  lodSwitches.fill(0);
  for (const row of transitions) row.fill(0);
  previousLods.fill(-1);
}

async function captureAtPose(
  nextPose: CameraPose,
  options: {
    mode?: number;
    settleFrames?: number;
    loadBudget?: number;
    clearPages?: boolean;
    progress?: number;
  } = {},
): Promise<CaptureReport> {
  manual = true;
  playing = false;
  setPlaying(false);
  pose = nextPose;
  if (options.progress !== undefined) {
    progress = options.progress;
    progressEl.value = String(Math.round(progress * 1000));
  }
  if (options.mode !== undefined) {
    mode = options.mode;
    renderer.setMode(mode);
    for (const button of modeButtons) {
      button.classList.toggle("active", Number(button.dataset.mode) === mode);
    }
  }
  if (options.clearPages) renderer.pageStore.clear();
  const settleFrames = options.settleFrames ?? 4;
  const loadBudget = options.loadBudget ?? 32;
  for (let frame = 0; frame < settleFrames; frame++) {
    const camera = currentCamera();
    renderer.render(camera, loadBudget);
    const cpu = cullScene(scene, camera, renderer.pageStore.slots, ERROR_THRESHOLD_PX);
    lastCpu = cpu;
    observeLods(cpu);
    await renderer.device.queue.onSubmittedWorkDone();
  }
  const gpu = await renderer.captureGpuState();
  const context = renderer.getLastFrameContext();
  const cpu = cullScene(
    scene,
    context.camera,
    context.residentSlots,
    ERROR_THRESHOLD_PX,
  );
  lastCpu = cpu;
  observeLods(cpu);
  updateHud(cpu);
  return jsonReport(gpu, cpu, { progress, pose });
}

async function captureScreenshot(
  nextPose: CameraPose,
  options: {
    mode?: number;
    settleFrames?: number;
    loadBudget?: number;
    clearPages?: boolean;
    progress?: number;
  } = {},
): Promise<string> {
  manual = true;
  playing = false;
  setPlaying(false);
  pose = nextPose;
  if (options.progress !== undefined) {
    progress = options.progress;
    progressEl.value = String(Math.round(progress * 1000));
  }
  if (options.mode !== undefined) {
    mode = options.mode;
    renderer.setMode(mode);
    for (const button of modeButtons) {
      button.classList.toggle("active", Number(button.dataset.mode) === mode);
    }
  }
  if (options.clearPages) renderer.pageStore.clear();
  for (let frame = 0; frame < (options.settleFrames ?? 4); frame++) {
    const camera = currentCamera();
    renderer.render(camera, options.loadBudget ?? 64);
    await renderer.device.queue.onSubmittedWorkDone();
  }
  const camera = currentCamera();
  const dataUrl = await renderer.renderAndCaptureImage(camera, 0);
  readbackImage.src = dataUrl;
  readbackImage.classList.add("visible");
  const cpu = cullScene(scene, camera, renderer.pageStore.slots, ERROR_THRESHOLD_PX);
  lastCpu = cpu;
  observeLods(cpu);
  updateHud(cpu);
  return dataUrl;
}

async function runPathVerification(): Promise<Awaited<ReturnType<VgeoApi["runPathVerification"]>>> {
  manual = true;
  playing = false;
  setPlaying(false);
  resetLodCounters();
  renderer.pageStore.clear();
  progress = 0;
  progressEl.value = "0";
  const checkpoints: CaptureReport[] = [];
  const checkpointStops = new Set([0, 10, 21, 32, 43, 54, 64]);
  const steps = 64;
  for (let step = 0; step <= steps; step++) {
    progress = step / steps;
    progressEl.value = String(Math.round(progress * 1000));
    pose = sampleCameraPath(progress);
    const camera = currentCamera();
    renderer.render(camera, 8);
    const cpu = cullScene(scene, camera, renderer.pageStore.slots, ERROR_THRESHOLD_PX);
    lastCpu = cpu;
    observeLods(cpu);
    updateHud(cpu);
    if (checkpointStops.has(step)) {
      for (let settle = 0; settle < 3; settle++) {
        const settledCamera = currentCamera();
        renderer.render(settledCamera, 24);
        await renderer.device.queue.onSubmittedWorkDone();
      }
      const gpu = await renderer.captureGpuState();
      const context = renderer.getLastFrameContext();
      const settledCpu = cullScene(
        scene,
        context.camera,
        context.residentSlots,
        ERROR_THRESHOLD_PX,
      );
      lastCpu = settledCpu;
      observeLods(settledCpu);
      updateHud(settledCpu);
      checkpoints.push(jsonReport(gpu, settledCpu, { progress, pose }));
    } else if (step % 8 === 0) {
      await renderer.device.queue.onSubmittedWorkDone();
    }
  }
  const maxTriangles = Math.max(...checkpoints.map((item) => item.gpu.triangles));
  const peakClusters = Math.max(...checkpoints.map((item) => item.gpu.drawArgs[1]!));
  return {
    checkpoints,
    lodSwitches: [...lodSwitches],
    transitions: transitions.map((row) => [...row]),
    totalSwitches: lodSwitches.reduce((sum, value) => sum + value, 0),
    maxTriangles,
    peakClusters,
    adapterInfo: renderer.adapterInfo,
  };
}

function animate(now: number): void {
  const delta = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (!manual) {
    if (playing) {
      progress = Math.min(1, progress + delta / 27);
      progressEl.value = String(Math.round(progress * 1000));
      pose = sampleCameraPath(progress);
      if (progress >= 1) {
        playing = false;
        setPlaying(false);
      }
    }
    renderCurrent(8);
  }
  requestAnimationFrame(animate);
}

async function boot(): Promise<void> {
  try {
    loadingDetail.textContent = "构建 488 个页面与 41,480 个 meshlet…";
    await new Promise((resolve) => setTimeout(resolve, 40));
    scene = buildScene();
    loadingDetail.textContent = "上传常驻回退页面并创建 WebGPU 管线…";
    renderer = await Renderer.create(canvas, scene);
    renderer.setMode(0);
    setPlaying(true);
    loading.classList.add("hidden");

    const api: VgeoApi = {
      ready: true,
      path: CAMERA_PATH.map((item) => ({
        position: [...item.position],
        target: [...item.target],
      })),
      async setProgress(value: number): Promise<void> {
        manual = true;
        playing = false;
        setPlaying(false);
        progress = Math.max(0, Math.min(1, value));
        progressEl.value = String(Math.round(progress * 1000));
        pose = sampleCameraPath(progress);
        renderCurrent(64);
        await renderer.device.queue.onSubmittedWorkDone();
      },
      captureAtPose,
      captureFallback(nextPose: CameraPose, captureProgress = progress) {
        return captureAtPose(nextPose, {
          mode: 0,
          clearPages: true,
          loadBudget: 0,
          settleFrames: 3,
          progress: captureProgress,
        });
      },
      captureScreenshot,
      runPathVerification,
      clearPages(): void {
        renderer.pageStore.clear();
      },
      resetLodCounters,
      pause(): void {
        manual = true;
        playing = false;
        setPlaying(false);
      },
      resume(): void {
        readbackImage.classList.remove("visible");
        manual = false;
        if (progress >= 1) {
          progress = 0;
          pose = sampleCameraPath(0);
          renderer.pageStore.clear();
          resetLodCounters();
        }
        playing = true;
        setPlaying(true);
      },
    };
    window.__vgeo = api;

    playButton.addEventListener("click", () => {
      if (manual) {
        api.resume();
      } else if (playing) {
        api.pause();
      } else {
        api.resume();
      }
    });
    restartButton.addEventListener("click", () => {
      readbackImage.classList.remove("visible");
      manual = false;
      progress = 0;
      progressEl.value = "0";
      pose = sampleCameraPath(0);
      renderer.pageStore.clear();
      resetLodCounters();
      playing = true;
      setPlaying(true);
    });
    upButton.addEventListener("click", () => {
      manual = false;
      playing = false;
      setPlaying(false);
      pose = raiseCamera(pose, 2.5);
    });
    downButton.addEventListener("click", () => {
      manual = false;
      playing = false;
      setPlaying(false);
      pose = raiseCamera(pose, -2.5);
    });
    progressEl.addEventListener("input", () => {
      manual = false;
      playing = false;
      setPlaying(false);
      progress = Number(progressEl.value) / 1000;
      pose = sampleCameraPath(progress);
    });
    for (const button of modeButtons) {
      button.addEventListener("click", () => setMode(Number(button.dataset.mode)));
    }
    window.addEventListener("keydown", (event) => {
      if (event.key === "1" || event.key === "2" || event.key === "3") {
        setMode(Number(event.key) - 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        manual = false;
        playing = false;
        setPlaying(false);
        pose = raiseCamera(pose, 2.5);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        manual = false;
        playing = false;
        setPlaying(false);
        pose = raiseCamera(pose, -2.5);
      } else if (event.key === " ") {
        event.preventDefault();
        if (playing) api.pause();
        else api.resume();
      }
    });
    renderCurrent(16);
    lastTime = performance.now();
    requestAnimationFrame(animate);
  } catch (error) {
    console.error(error);
    loading.classList.add("hidden");
    errorPanel.hidden = false;
    errorPanel.textContent = [
      "无法启动 WebGPU 渲染器",
      "",
      error instanceof Error ? error.message : String(error),
      "",
      "请使用支持 WebGPU 的 Chromium，并启用 --enable-unsafe-webgpu。",
    ].join("\n");
    statusEl.innerHTML = "<i></i>错误";
    statusEl.classList.add("bad");
  }
}

void boot();
