import type {
  AuditResult,
  LoadLevel,
  PipelineMode,
  RendererDiagnostics,
  SlotPhase,
} from "./renderer.js";

interface HudHandlers {
  setMode: (mode: PipelineMode) => void;
  setLoad: (load: LoadLevel) => void;
  togglePause: () => void;
  runAudit: () => void;
}

const phaseLabels: Record<SlotPhase, string> = {
  free: "FREE",
  computing: "COMPUTING",
  ready: "READY",
  rendering: "RENDER",
  held: "HOLD",
};

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`Missing element #${id}`);
  }
  return found as T;
}

function formatMilliseconds(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "--";
  }
  return value < 10 ? value.toFixed(2) : value.toFixed(1);
}

function timecode(seconds: number): string {
  const whole = Math.max(0, seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = Math.floor(whole % 60);
  const subframe = Math.floor((whole % 1) * 60);
  return [hours, minutes, secs, subframe]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

export class StationHud {
  private requestedMode: PipelineMode | null = null;
  private lastClockSecond = -1;
  private busy = false;

  readonly modeButtons: HTMLButtonElement[];
  readonly loadButtons: HTMLButtonElement[];
  readonly pauseButton: HTMLButtonElement;
  readonly verifyButton: HTMLButtonElement;
  readonly verifyDialog: HTMLElement;
  readonly verifyList: HTMLElement;
  readonly verifySummary: HTMLElement;
  private readonly statusPill = element("status-pill");
  private readonly statusText = element("status-text");
  private readonly statusDetail = element("status-detail");
  private readonly slotReadyCount = element("slot-ready-count");
  private readonly queueNote = element("queue-note");
  private readonly metricCompute = element("metric-compute");
  private readonly metricRender = element("metric-render");
  private readonly metricWait = element("metric-wait");
  private readonly metricTail = element("metric-tail");
  private readonly metricStale = element("metric-stale");
  private readonly metricDrops = element("metric-drops");
  private readonly computeMeter = element("compute-meter");
  private readonly renderMeter = element("render-meter");
  private readonly fenceCount = element("fence-count");
  private readonly recycleCount = element("recycle-count");
  private readonly timecodeElement = element("timecode");
  private readonly cameraFill = element("camera-fill");
  private readonly cameraPlayhead = element("camera-playhead");
  private readonly playbackState = element("playback-state");
  private readonly pauseIcon = element("pause-icon");
  private readonly fpsElement = element("fps");
  private readonly displayFrame = element("display-frame");
  private readonly ribbon = element("status-ribbon");
  private readonly ribbonText = element("ribbon-text");
  private readonly ribbonDetail = element("ribbon-detail");
  private readonly systemClock = element("system-clock");
  private readonly gpuApi = element("gpu-api");

  constructor() {
    this.modeButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-mode]")];
    this.loadButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-load]")];
    this.pauseButton = element<HTMLButtonElement>("btn-pause");
    this.verifyButton = element<HTMLButtonElement>("btn-verify");
    this.verifyDialog = element("verify-dialog");
    this.verifyList = element("verify-list");
    this.verifySummary = element("verify-summary");
  }

  bind(handlers: HudHandlers): void {
    for (const button of this.modeButtons) {
      button.addEventListener("click", () => {
        const mode = button.dataset.mode as PipelineMode;
        this.requestedMode = mode;
        this.setActiveMode(mode);
        handlers.setMode(mode);
      });
    }
    for (const button of this.loadButtons) {
      button.addEventListener("click", () => {
        const load = Number(button.dataset.load) as LoadLevel;
        for (const candidate of this.loadButtons) {
          candidate.classList.toggle("active", candidate === button);
        }
        handlers.setLoad(load);
      });
    }
    this.pauseButton.addEventListener("click", handlers.togglePause);
    this.verifyButton.addEventListener("click", handlers.runAudit);
    element("verify-close").addEventListener("click", () => {
      this.verifyDialog.hidden = true;
    });
  }

  setActiveMode(mode: PipelineMode): void {
    for (const button of this.modeButtons) {
      button.classList.toggle("active", button.dataset.mode === mode);
    }
  }

  setPaused(paused: boolean): void {
    this.playbackState.textContent = paused ? "PAUSED" : "RUNNING";
    this.pauseIcon.textContent = paused ? "▶" : "Ⅱ";
    this.pauseButton.setAttribute("aria-label", paused ? "继续相机" : "暂停相机");
  }

  update(diagnostics: RendererDiagnostics): void {
    if (diagnostics.mode === this.requestedMode) {
      this.requestedMode = null;
    }
    if (!this.requestedMode) {
      this.setActiveMode(diagnostics.mode);
    }
    this.setPaused(diagnostics.paused);
    this.updateClock();

    this.statusPill.dataset.state = diagnostics.status;
    this.statusText.textContent = diagnostics.statusText;
    this.statusDetail.textContent = diagnostics.statusDetail;
    this.slotReadyCount.textContent = String(diagnostics.validSlots);
    this.queueNote.textContent =
      diagnostics.status === "stale"
        ? "HOLD LAST VALID"
        : diagnostics.status === "draining"
          ? "WAIT FOR FENCE"
          : "NO OVERWRITE";

    diagnostics.slotStates.forEach((slot) => {
      const card = element(`slot-${slot.index}`);
      const state = card.querySelector<HTMLElement>(".slot-state");
      const frame = card.querySelector<HTMLElement>(".slot-frame");
      const fill = card.querySelector<HTMLElement>(".slot-track i");
      card.dataset.state = slot.phase;
      if (state) {
        state.textContent = phaseLabels[slot.phase];
      }
      if (frame) {
        frame.textContent = slot.frameId >= 0 ? `F${String(slot.frameId).padStart(4, "0")}` : "--";
      }
      if (fill) {
        fill.style.width = `${Math.round(slot.progress * 100)}%`;
      }
    });

    this.metricCompute.textContent = formatMilliseconds(diagnostics.computeMs);
    this.metricRender.textContent = formatMilliseconds(diagnostics.renderMs);
    this.metricWait.textContent = formatMilliseconds(diagnostics.computeWaitMs);
    this.metricTail.textContent = formatMilliseconds(diagnostics.tailP95Ms);
    this.metricStale.textContent = String(diagnostics.staleAge);
    this.metricDrops.textContent = String(diagnostics.overwriteBlocks);
    this.computeMeter.style.width = `${Math.min(100, (diagnostics.computeMs / 16.67) * 100)}%`;
    this.renderMeter.style.width = `${Math.min(100, (diagnostics.renderMs / 16.67) * 100)}%`;
    this.fenceCount.textContent = String(diagnostics.fenceChecks);
    this.recycleCount.textContent = String(diagnostics.recycleCount);
    this.gpuApi.textContent = diagnostics.timestamps ? "TIMESTAMP QUERY" : "CPU FENCE FALLBACK";
    this.fpsElement.textContent = String(diagnostics.fps);
    this.displayFrame.textContent = `F${String(Math.max(0, diagnostics.latestFrame)).padStart(4, "0")}`;

    const loopProgress = (diagnostics.playbackSeconds % 18) / 18;
    this.timecodeElement.textContent = timecode(diagnostics.playbackSeconds);
    this.cameraFill.style.width = `${loopProgress * 100}%`;
    this.cameraPlayhead.style.left = `${loopProgress * 100}%`;

    if (diagnostics.status === "stale") {
      this.ribbon.dataset.kind = "warn";
      this.ribbonText.textContent = "BOUNDED QUEUE · FRAME HOLD";
      this.ribbonDetail.textContent = `计算落后 ${diagnostics.staleAge} 帧，画面保持 F${diagnostics.latestFrame}`;
    } else if (diagnostics.status === "error") {
      this.ribbon.dataset.kind = "error";
      this.ribbonText.textContent = "PIPELINE ERROR";
      this.ribbonDetail.textContent = diagnostics.statusDetail;
    } else if (diagnostics.status === "draining") {
      this.ribbon.dataset.kind = "warn";
      this.ribbonText.textContent = "EXPLICIT FENCE DRAIN";
      this.ribbonDetail.textContent = "不复用仍在 GPU 上的帧槽";
    } else {
      this.ribbon.dataset.kind = "ok";
      this.ribbonText.textContent =
        diagnostics.mode === "async" ? "ASYNC RESULTS LOCKED" : "SYNC FRAME COMPLETE";
      this.ribbonDetail.textContent = `有效槽 ${diagnostics.validSlots}/3 · 上一有效帧保持显示`;
    }
  }

  showAudit(result: AuditResult): void {
    this.verifyDialog.hidden = false;
    this.verifyList.replaceChildren();
    for (const frame of result.frames) {
      const row = document.createElement("div");
      row.className = `verify-row${frame.match ? "" : " fail"}`;
      row.innerHTML = `
        <span>FRAME ${String(frame.frame).padStart(3, "0")}</span>
        <b>${frame.syncHash} / ${frame.asyncHash}</b>
        <i>${frame.match ? "MATCH" : "MISMATCH"} · HOLD ${frame.intermediateMatch ? "OK" : "FAIL"}</i>
      `;
      this.verifyList.append(row);
    }
    const guardRow = document.createElement("div");
    guardRow.className = "verify-row";
    guardRow.innerHTML = `
      <span>FENCE GUARD</span>
      <b>${result.overwriteBlocks} blocked · ${result.fenceChecks} checks</b>
      <i>${result.frames.every((frame) => frame.guardHeld) ? "HELD" : "VIOLATION"}</i>
    `;
    this.verifyList.append(guardRow);
    this.verifySummary.classList.toggle("fail", !result.passed);
    const status = this.verifySummary.querySelector("span");
    const text = this.verifySummary.querySelector("b");
    if (status) {
      status.textContent = result.passed ? "PASS" : "FAIL";
    }
    if (text) {
      text.textContent = result.passed
        ? `${result.frames.length} 个固定帧逐像素一致 · 上一有效帧保持`
        : "检测到画面或帧槽保护差异";
    }
  }

  setAuditBusy(busy: boolean): void {
    this.busy = busy;
    this.verifyButton.disabled = busy;
    for (const button of [...this.modeButtons, ...this.loadButtons]) {
      button.disabled = busy;
    }
    this.pauseButton.disabled = busy;
    if (busy) {
      this.verifyDialog.hidden = false;
      this.verifyList.replaceChildren();
      const row = document.createElement("div");
      row.className = "verify-row";
      row.innerHTML = "<span>GPU AUDIT</span><b>读回固定帧...</b><i>RUNNING</i>";
      this.verifyList.append(row);
      this.verifySummary.classList.remove("fail");
      const status = this.verifySummary.querySelector("span");
      const text = this.verifySummary.querySelector("b");
      if (status) {
        status.textContent = "RUNNING";
      }
      if (text) {
        text.textContent = "执行同步通道与异步围栏通道";
      }
    }
  }

  showError(message: string): void {
    this.statusPill.dataset.state = "stale";
    this.statusText.textContent = "PIPELINE ERROR";
    this.statusDetail.textContent = message;
    this.ribbon.dataset.kind = "error";
    this.ribbonText.textContent = "WEBGPU ERROR";
    this.ribbonDetail.textContent = message;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  private updateClock(): void {
    const now = new Date();
    const second = now.getSeconds();
    if (second !== this.lastClockSecond) {
      this.lastClockSecond = second;
      this.systemClock.textContent = now.toLocaleTimeString("zh-CN", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    }
  }
}
