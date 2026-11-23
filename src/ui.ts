import type { LensSettings, RainMode } from "./render/droplets";
import type { RainDiagnostics } from "./render/renderer";

export interface UiHandlers {
  onMode: (mode: RainMode) => void;
  onLens: (patch: Partial<LensSettings>) => void;
  onShowMask: (show: boolean) => void;
}

const MODE_COPY: Record<RainMode, { zh: string; en: string }> = {
  off: { zh: "无雨", en: "NO RAIN" },
  static: { zh: "静止水滴", en: "STATIC" },
  drift: { zh: "缓慢滑落", en: "DRIFT" },
};

const modeButton = (mode: RainMode, active: boolean): string => `
  <button class="mode-button${active ? " is-active" : ""}" data-mode="${mode}" type="button">
    <span class="mode-glyph mode-glyph--${mode}" aria-hidden="true"></span>
    <span class="mode-zh">${MODE_COPY[mode].zh}</span>
    <span class="mode-en">${MODE_COPY[mode].en}</span>
  </button>
`;

export class LensRainUi {
  private readonly root: HTMLElement;
  private readonly handlers: UiHandlers;
  private readonly modeButtons: HTMLButtonElement[];
  private readonly focusInput: HTMLInputElement;
  private readonly focusValue: HTMLElement;
  private readonly focalInput: HTMLInputElement;
  private readonly focalValue: HTMLElement;
  private readonly apertureInput: HTMLInputElement;
  private readonly apertureValue: HTMLElement;
  private readonly maskInput: HTMLInputElement;
  private readonly dropCount: HTMLElement;
  private readonly focusReadout: HTMLElement;
  private readonly statusMode: HTMLElement;
  private readonly maskLegend: HTMLElement;
  private readonly panel: HTMLElement;

  constructor(root: HTMLElement, handlers: UiHandlers, lens: LensSettings) {
    this.root = root;
    this.handlers = handlers;
    this.root.innerHTML = `
      <div class="top-rail">
        <div class="identity">
          <div class="crosshair" aria-hidden="true"><i></i><i></i></div>
          <div>
            <div class="eyebrow">NIGHT WATCH&nbsp;&nbsp;/&nbsp;&nbsp;BERTH 04</div>
            <h1>港口雨幕镜片</h1>
            <p>程序化 HDR 灯群 · 无雨滴素材</p>
          </div>
        </div>
        <div class="status-cluster">
          <div class="status-chip"><span class="status-dot"></span>WEBGL2</div>
          <div class="status-chip"><span class="status-dot"></span>HDR 16F</div>
          <div class="clock" id="clock">23:48:07</div>
        </div>
      </div>

      <aside class="lens-panel" id="lens-panel">
        <div class="panel-heading">
          <span>LENS / 光学参数</span>
          <span class="panel-tag" id="focal-tag">50 MM</span>
        </div>
        <div class="control-row">
          <div class="control-label"><span>焦点</span><output id="focus-value">0.190 m</output></div>
          <input id="focus" class="slider" type="range" min="0.08" max="0.36" step="0.001" value="${lens.focusDistanceM}" />
          <div class="tick-row"><span>NEAR 0.08</span><span>FAR 0.36</span></div>
        </div>
        <div class="control-row">
          <div class="control-label"><span>焦距</span><output id="focal-value">50 mm</output></div>
          <input id="focal" class="slider" type="range" min="24" max="85" step="1" value="${lens.focalLengthMm}" />
        </div>
        <div class="control-row">
          <div class="control-label"><span>光圈</span><output id="aperture-value">f/2.8</output></div>
          <input id="aperture" class="slider" type="range" min="1.4" max="8" step="0.1" value="${lens.aperture}" />
        </div>
        <label class="toggle-row" for="mask-toggle">
          <span>
            <strong>遮挡掩码</strong>
            <small>OCCLUSION MASK · M</small>
          </span>
          <input id="mask-toggle" type="checkbox" />
          <i class="toggle-track" aria-hidden="true"></i>
        </label>
        <div class="telemetry">
          <div><span>ACTIVE DROPS</span><strong id="drop-count">058</strong></div>
          <div><span>LIQUID NORMAL</span><strong>LIVE</strong></div>
          <div><span>COMPOSITE</span><strong>GLASS 02</strong></div>
        </div>
      </aside>

      <div class="focus-readout" id="focus-readout">
        <span>FOCUS</span><strong>0.190 m</strong>
      </div>

      <div class="reticle" aria-hidden="true">
        <span class="reticle-corner reticle-corner--tl"></span>
        <span class="reticle-corner reticle-corner--tr"></span>
        <span class="reticle-corner reticle-corner--bl"></span>
        <span class="reticle-corner reticle-corner--br"></span>
      </div>

      <div class="mask-legend" id="mask-legend">
        <span class="legend-title">OCCLUSION MASK</span>
        <span><i class="swatch swatch--large"></i>大水滴 · 完全不透明</span>
        <span><i class="swatch swatch--small"></i>小水滴 · 景深采样</span>
        <span><i class="swatch swatch--trail"></i>滑落液痕</span>
      </div>

      <div class="mode-dock" role="group" aria-label="雨滴模式">
        ${modeButton("off", false)}
        ${modeButton("static", false)}
        ${modeButton("drift", true)}
        <span class="mode-shortcut">1 / 2 / 3</span>
      </div>

      <div class="pipeline">
        <span>HDR SCENE</span><i></i><span>BLOOM</span><i></i><span>LENS WATER</span>
        <small>PROCEDURAL / NO MEDIA INPUT</small>
      </div>
    `;
    this.modeButtons = Array.from(root.querySelectorAll<HTMLButtonElement>(".mode-button"));
    this.focusInput = this.require<HTMLInputElement>("#focus");
    this.focusValue = this.require("#focus-value");
    this.focalInput = this.require<HTMLInputElement>("#focal");
    this.focalValue = this.require("#focal-value");
    this.apertureInput = this.require<HTMLInputElement>("#aperture");
    this.apertureValue = this.require("#aperture-value");
    this.maskInput = this.require<HTMLInputElement>("#mask-toggle");
    this.dropCount = this.require("#drop-count");
    this.focusReadout = this.require("#focus-readout");
    this.statusMode = this.require("#focal-tag");
    this.maskLegend = this.require("#mask-legend");
    this.panel = this.require("#lens-panel");
    this.bind();
    this.setMode("drift");
    this.focusInput.dispatchEvent(new Event("input"));
    this.focalInput.dispatchEvent(new Event("input"));
    this.apertureInput.dispatchEvent(new Event("input"));
  }

  setMode(mode: RainMode): void {
    for (const button of this.modeButtons) {
      const active = button.dataset.mode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    this.root.dataset.mode = mode;
  }

  setMaskVisible(show: boolean): void {
    this.maskInput.checked = show;
    this.maskLegend.classList.toggle("is-visible", show);
    this.panel.classList.toggle("has-mask", show);
  }

  syncLens(lens: LensSettings): void {
    this.focusInput.value = String(lens.focusDistanceM);
    this.focusValue.textContent = `${lens.focusDistanceM.toFixed(3)} m`;
    this.focusReadout.querySelector("strong")!.textContent = `${lens.focusDistanceM.toFixed(3)} m`;
    this.focalInput.value = String(lens.focalLengthMm);
    this.focalValue.textContent = `${lens.focalLengthMm} mm`;
    this.apertureInput.value = String(lens.aperture);
    this.apertureValue.textContent = `f/${lens.aperture.toFixed(1)}`;
    for (const input of [this.focusInput, this.focalInput, this.apertureInput]) {
      this.updateSliderFill(input);
    }
  }

  update(diagnostics: RainDiagnostics): void {
    this.dropCount.textContent = String(diagnostics.dropCount).padStart(3, "0");
    this.statusMode.textContent = `${Math.round(diagnostics.focalLengthMm)} MM`;
    this.root.dataset.dropCount = String(diagnostics.dropCount);
  }

  pulseFocus(): void {
    this.focusReadout.classList.remove("is-pulsing");
    void this.focusReadout.offsetWidth;
    this.focusReadout.classList.add("is-pulsing");
  }

  private bind(): void {
    for (const button of this.modeButtons) {
      button.addEventListener("click", () => {
        const mode = button.dataset.mode as RainMode;
        this.setMode(mode);
        this.handlers.onMode(mode);
      });
    }

    this.focusInput.addEventListener("input", () => {
      const focus = Number(this.focusInput.value);
      this.focusValue.textContent = `${focus.toFixed(3)} m`;
      this.focusReadout.querySelector("strong")!.textContent = `${focus.toFixed(3)} m`;
      this.handlers.onLens({ focusDistanceM: focus });
      this.pulseFocus();
      this.updateSliderFill(this.focusInput);
    });

    this.focalInput.addEventListener("input", () => {
      const focal = Number(this.focalInput.value);
      this.focalValue.textContent = `${focal} mm`;
      this.handlers.onLens({ focalLengthMm: focal });
      this.updateSliderFill(this.focalInput);
    });

    this.apertureInput.addEventListener("input", () => {
      const aperture = Number(this.apertureInput.value);
      this.apertureValue.textContent = `f/${aperture.toFixed(1)}`;
      this.handlers.onLens({ aperture });
      this.updateSliderFill(this.apertureInput);
    });

    this.maskInput.addEventListener("change", () => {
      this.setMaskVisible(this.maskInput.checked);
      this.handlers.onShowMask(this.maskInput.checked);
    });

    window.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLInputElement) return;
      const map: Record<string, RainMode> = { "1": "off", "2": "static", "3": "drift" };
      const mode = map[event.key];
      if (mode) {
        this.setMode(mode);
        this.handlers.onMode(mode);
      }
      if (event.key.toLowerCase() === "m") {
        this.setMaskVisible(!this.maskInput.checked);
        this.handlers.onShowMask(this.maskInput.checked);
      }
    });
  }

  private require<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing UI element: ${selector}`);
    return element;
  }

  private updateSliderFill(input: HTMLInputElement): void {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    const fill = ((value - min) / Math.max(0.0001, max - min)) * 100;
    input.style.setProperty("--fill", `${fill.toFixed(1)}%`);
  }
}
