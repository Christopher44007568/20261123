import "./styles.css";
import { clamp, type HeadPose, type Vec3 } from "./math.ts";
import { StereoRenderer, type ReprojectionReport, type ViewMode } from "./renderer.ts";
import { runVerification, probeSignedDisparity, type VerificationReport } from "./verification.ts";

interface StereoLabDiagnostics {
  ready: boolean;
  mode: ViewMode;
  sceneTime: number;
  probeSide: "front" | "behind";
  probeBlend: number;
  signedDisparityPx: number;
  eyeBuffer: { width: number; height: number; color: string; depth: string };
  eyeMean: { left: readonly [number, number, number]; right: readonly [number, number, number] };
  audit: ReturnType<StereoRenderer["getLastAudit"]>;
  lastReprojection: ReprojectionReport | null;
}

interface StereoLabApi {
  readonly ready: true;
  getDiagnostics(): StereoLabDiagnostics;
  setViewMode(mode: ViewMode): void;
  setProbeSide(side: "front" | "behind"): void;
  setHeadPose(pose: Partial<HeadPose>): void;
  renderAt(time: number, head?: HeadPose, probeBlend?: number): void;
  measureReprojection(): ReprojectionReport;
  runVerification(): VerificationReport;
  setPaused(paused: boolean): void;
}

declare global {
  interface Window {
    __stereoLab?: StereoLabApi;
  }
}

const MODE_CAPTIONS: Record<ViewMode, string> = {
  mono: "左眼单通道 · 非对称视锥 · 64 mm 固定瞳距",
  sbs: "左右眼并排 · 非对称视锥 · 同一场景时间戳",
  anaglyph: "红青立体 · 左眼 R / 右眼 GB · 深度感知重采样",
};

const PROBE_CYCLE_SECONDS = 8;

class StereoLab {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: StereoRenderer;
  private readonly frameStatus: HTMLElement;
  private readonly fpsStatus: HTMLElement;
  private readonly probeReadout: HTMLElement;
  private readonly disparityReadout: HTMLElement;
  private readonly reprojectionReadout: HTMLElement;
  private readonly syncLeft: HTMLElement;
  private readonly syncTime: HTMLElement;
  private readonly syncRight: HTMLElement;
  private readonly modeCaption: HTMLElement;
  private readonly probeButton: HTMLButtonElement;
  private readonly modeButtons: HTMLButtonElement[];
  private readonly keys = new Set<string>();
  private mode: ViewMode = "sbs";
  private paused = false;
  private sceneTime = 0;
  private lastFrameTime = performance.now();
  private smoothedFps = 60;
  private lastTelemetryTime = 0;
  private lastReprojectionTime = 0;
  private lastReprojection: ReprojectionReport | null = null;
  private probeAuto = true;
  private manualProbeBlend = 0;
  private manualProbeTarget = 0;
  private readonly headTarget: HeadPose = {
    position: [0, 0, 0],
    yaw: 0,
    pitch: 0,
    roll: 0,
  };
  private readonly headDisplay: HeadPose = {
    position: [0, 0, 0],
    yaw: 0,
    pitch: 0,
    roll: 0,
  };
  private pointerId: number | null = null;
  private pointerX = 0;
  private pointerY = 0;

  constructor() {
    this.canvas = this.requireElement<HTMLCanvasElement>("scope");
    this.frameStatus = this.requireElement("frame-status");
    this.fpsStatus = this.requireElement("fps-status");
    this.probeReadout = this.requireElement("probe-readout");
    this.disparityReadout = this.requireElement("disparity-readout");
    this.reprojectionReadout = this.requireElement("reprojection-readout");
    this.syncLeft = this.requireElement("sync-left");
    this.syncTime = this.requireElement("sync-time");
    this.syncRight = this.requireElement("sync-right");
    this.modeCaption = this.requireElement("mode-caption");
    this.probeButton = this.requireElement<HTMLButtonElement>("probe-toggle");
    this.modeButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-mode]")];
    this.renderer = new StereoRenderer(this.canvas);
    this.bindControls();
    this.installApi();
    this.setMode("sbs");
    requestAnimationFrame(this.frame);
  }

  private requireElement<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing UI element #${id}`);
    return element as T;
  }

  private bindControls(): void {
    this.canvas.addEventListener("pointerdown", (event) => {
      this.pointerId = event.pointerId;
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
      this.canvas.setPointerCapture(event.pointerId);
      this.canvas.classList.add("dragging");
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (this.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - this.pointerX;
      const deltaY = event.clientY - this.pointerY;
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
      this.headTarget.yaw = clamp(this.headTarget.yaw + deltaX * 0.0018, -0.11, 0.11);
      this.headTarget.pitch = clamp(this.headTarget.pitch - deltaY * 0.0015, -0.07, 0.07);
    });
    const releasePointer = (event: PointerEvent): void => {
      if (this.pointerId !== event.pointerId) return;
      this.pointerId = null;
      this.canvas.classList.remove("dragging");
    };
    this.canvas.addEventListener("pointerup", releasePointer);
    this.canvas.addEventListener("pointercancel", releasePointer);

    window.addEventListener("keydown", (event) => {
      if (event.repeat) return;
      this.keys.add(event.code);
      if (event.code === "Digit1") this.setMode("mono");
      if (event.code === "Digit2") this.setMode("sbs");
      if (event.code === "Digit3") this.setMode("anaglyph");
      if (event.code === "KeyG") this.toggleProbe();
      if (event.code === "Space") {
        this.paused = !this.paused;
        event.preventDefault();
      }
      if (["KeyW", "KeyA", "KeyS", "KeyD", "KeyR", "KeyF", "KeyQ", "KeyE"].includes(event.code)) {
        event.preventDefault();
      }
    });
    window.addEventListener("keyup", (event) => this.keys.delete(event.code));
    window.addEventListener("blur", () => this.keys.clear());
    this.modeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.mode as ViewMode | undefined;
        if (mode) this.setMode(mode);
      });
    });
    this.probeButton.addEventListener("click", () => this.toggleProbe());
    new ResizeObserver(() => this.renderer.resize()).observe(this.canvas);
  }

  private setMode(mode: ViewMode): void {
    this.mode = mode;
    this.renderer.setViewMode(mode);
    this.modeButtons.forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
    this.modeCaption.textContent = MODE_CAPTIONS[mode];
  }

  private toggleProbe(): void {
    if (this.probeAuto) {
      this.probeAuto = false;
      this.manualProbeBlend = this.currentProbeBlend();
      this.manualProbeTarget = this.manualProbeBlend < 0.5 ? 1 : 0;
    } else {
      this.manualProbeTarget = this.manualProbeTarget < 0.5 ? 1 : 0;
    }
  }

  private currentProbeBlend(): number {
    if (!this.probeAuto) return this.manualProbeBlend;
    return 0.5 - 0.5 * Math.cos((this.sceneTime / PROBE_CYCLE_SECONDS) * Math.PI * 2);
  }

  private updateHead(deltaTime: number): void {
    const speed = 0.018;
    const direction = (positive: string, negative: string): number =>
      (this.keys.has(positive) ? 1 : 0) - (this.keys.has(negative) ? 1 : 0);
    this.headTarget.position = [
      clamp(this.headTarget.position[0] + direction("KeyD", "KeyA") * speed * deltaTime, -0.012, 0.012),
      clamp(this.headTarget.position[1] + direction("KeyW", "KeyS") * speed * deltaTime, -0.009, 0.009),
      clamp(this.headTarget.position[2] + direction("KeyR", "KeyF") * speed * deltaTime, -0.011, 0.011),
    ];
    this.headTarget.roll = clamp(
      this.headTarget.roll + direction("KeyQ", "KeyE") * 0.075 * deltaTime,
      -0.045,
      0.045,
    );
    const smoothing = 1 - Math.exp(-deltaTime * 18);
    this.headDisplay.position = [
      this.headDisplay.position[0] + (this.headTarget.position[0] - this.headDisplay.position[0]) * smoothing,
      this.headDisplay.position[1] + (this.headTarget.position[1] - this.headDisplay.position[1]) * smoothing,
      this.headDisplay.position[2] + (this.headTarget.position[2] - this.headDisplay.position[2]) * smoothing,
    ];
    this.headDisplay.yaw += (this.headTarget.yaw - this.headDisplay.yaw) * smoothing;
    this.headDisplay.pitch += (this.headTarget.pitch - this.headDisplay.pitch) * smoothing;
    this.headDisplay.roll += (this.headTarget.roll - this.headDisplay.roll) * smoothing;
  }

  private readonly frame = (now: number): void => {
    const deltaTime = Math.min(0.05, Math.max(0, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;
    if (!this.paused) this.sceneTime += deltaTime;
    this.updateHead(deltaTime);
    if (!this.probeAuto) {
      const smoothing = 1 - Math.exp(-deltaTime * 5.2);
      this.manualProbeBlend += (this.manualProbeTarget - this.manualProbeBlend) * smoothing;
    }
    const audit = this.renderer.renderFrame(
      this.sceneTime,
      this.headDisplay,
      this.currentProbeBlend(),
    );
    this.updateTelemetry(now, deltaTime, audit.frameToken);
    requestAnimationFrame(this.frame);
  };

  private updateTelemetry(now: number, deltaTime: number, frameToken: number): void {
    if (now - this.lastTelemetryTime < 180) return;
    this.lastTelemetryTime = now;
    const snapshot = this.renderer.getLastSnapshot();
    if (!snapshot) return;
    const side = snapshot.probeSide === "front" ? "护罩前" : "护罩后";
    const disparity = probeSignedDisparity(this.renderer);
    this.probeReadout.textContent = side;
    this.disparityReadout.textContent = `${disparity >= 0 ? "+" : ""}${disparity.toFixed(2)} px`;
    this.syncLeft.textContent = `#${frameToken % 1000}`;
    this.syncTime.textContent = snapshot.time.toFixed(2);
    this.syncRight.textContent = `#${frameToken % 1000}`;
    this.frameStatus.textContent = this.paused ? "HOLD" : "SYNC";

    const currentFps = 1 / Math.max(0.001, deltaTime);
    this.smoothedFps += (Math.min(120, currentFps) - this.smoothedFps) * 0.18;
    this.fpsStatus.textContent = `${Math.round(this.smoothedFps)} FPS`;

    if (now - this.lastReprojectionTime > 1500) {
      this.lastReprojectionTime = now;
      try {
        this.lastReprojection = this.renderer.measureReprojection();
        this.reprojectionReadout.textContent = `${this.lastReprojection.maxErrorPx.toFixed(3)} px`;
      } catch {
        this.reprojectionReadout.textContent = "不可用";
      }
    }
  }

  private installApi(): void {
    const api: StereoLabApi = {
      ready: true,
      getDiagnostics: () => {
        const snapshot = this.renderer.getLastSnapshot();
        return {
          ready: true,
          mode: this.mode,
          sceneTime: this.sceneTime,
          probeSide: snapshot?.probeSide ?? "front",
          probeBlend: this.currentProbeBlend(),
          signedDisparityPx: probeSignedDisparity(this.renderer),
          eyeBuffer: {
            width: this.renderer.eyeBufferInfo.width,
            height: this.renderer.eyeBufferInfo.height,
            color: this.renderer.eyeBufferInfo.colorFormat,
            depth: this.renderer.eyeBufferInfo.depthFormat,
          },
          eyeMean: {
            left: this.renderer.readEyeMean(0),
            right: this.renderer.readEyeMean(1),
          },
          audit: this.renderer.getLastAudit(),
          lastReprojection: this.lastReprojection,
        };
      },
      setViewMode: (mode) => this.setMode(mode),
      setProbeSide: (side) => {
        this.probeAuto = false;
        this.manualProbeBlend = side === "front" ? 0 : 1;
        this.manualProbeTarget = this.manualProbeBlend;
      },
      setHeadPose: (pose) => {
        if (pose.position) this.headTarget.position = [...pose.position] as Vec3;
        if (pose.yaw !== undefined) this.headTarget.yaw = pose.yaw;
        if (pose.pitch !== undefined) this.headTarget.pitch = pose.pitch;
        if (pose.roll !== undefined) this.headTarget.roll = pose.roll;
        this.headDisplay.position = [...this.headTarget.position] as Vec3;
        this.headDisplay.yaw = this.headTarget.yaw;
        this.headDisplay.pitch = this.headTarget.pitch;
        this.headDisplay.roll = this.headTarget.roll;
      },
      renderAt: (time, head, probeBlend) => {
        this.renderer.renderFrame(time, head ?? this.headDisplay, probeBlend ?? this.currentProbeBlend());
      },
      measureReprojection: () => this.renderer.measureReprojection(),
      runVerification: () => runVerification(this.renderer),
      setPaused: (paused) => {
        this.paused = paused;
      },
    };
    window.__stereoLab = api;
  }
}

try {
  new StereoLab();
} catch (error) {
  const bootError = document.getElementById("boot-error");
  if (bootError) {
    bootError.hidden = false;
    bootError.textContent = `双目渲染器启动失败\n\n${error instanceof Error ? error.message : String(error)}`;
  }
  console.error(error);
}
