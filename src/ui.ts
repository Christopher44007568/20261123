import { MAPS, MATERIALS } from "./types";

const materialButtons = MATERIALS.map(
  (material) => `
    <button class="material-card" data-material="${material.id}" type="button">
      <span class="material-swatch swatch-${material.id}">
        <span class="material-index">${material.index}</span>
      </span>
      <span class="material-copy">
        <strong>${material.name}</strong>
        <small>${material.en}</small>
      </span>
      <span class="material-note">${material.note}</span>
    </button>`,
).join("");

const mapTabs = MAPS.map(
  (map, index) => `
    <button class="map-tab${index === 0 ? " is-active" : ""}" data-map="${map.id}" type="button">
      <span>${map.label}</span><small>${map.en}</small>
    </button>`,
).join("");

const viewCards = [
  ["raw", "原始 RGBA", "UNCOMPRESSED"],
  ["decoded", "压缩后解码", "BC DECODE"],
  ["heat", "误差热图", "DELTA HEATMAP"],
]
  .map(
    ([mode, title, subtitle]) => `
      <button class="view-card" data-view="${mode}" type="button">
        <canvas class="view-thumb" data-thumb="${mode}" width="144" height="144"></canvas>
        <span class="view-card-copy">
          <strong>${title}</strong>
          <small>${subtitle}</small>
        </span>
        <span class="view-status">${mode === "heat" ? "Δ RGB" : "1:1"}</span>
      </button>`,
  )
  .join("");

export function mountShell(root: HTMLElement): void {
  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
          <div>
            <h1>盐雾材质台</h1>
            <p>SALT MATERIAL LAB <span>/</span> 005</p>
          </div>
        </div>
        <div class="topbar-meta">
          <span class="meta-block"><small>PIPELINE</small><strong>TS · WEBGL2 · GLSL</strong></span>
          <span class="meta-block"><small>ORIGIN</small><strong>PROCEDURAL</strong></span>
          <span class="status-pill" id="gpu-status"><i></i><span>初始化 WebGL2</span></span>
        </div>
      </header>

      <main class="workspace">
        <section class="stage">
          <div class="stage-canvas-wrap">
            <canvas id="viewport" aria-label="材质三维预览"></canvas>
            <div class="stage-heading">
              <span class="eyebrow" id="stage-eyebrow">MATERIAL SAMPLE / 01</span>
              <h2 id="stage-title">盐蚀青砖墙</h2>
              <p id="stage-subtitle">错缝砌筑 · 灰缝结晶</p>
            </div>
            <div class="stage-actions">
              <div class="view-switch" role="group" aria-label="预览模式">
                <button class="is-active" data-view-mode="raw" type="button">原始</button>
                <button data-view-mode="decoded" type="button">解码</button>
                <button data-view-mode="heat" type="button">误差</button>
              </div>
              <button class="icon-button" id="oblique-button" type="button" title="切换斜视角度">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z"/><path d="m4 8.5 8 4.5 8-4.5M12 13v7"/></svg>
                <span>斜视</span>
              </button>
            </div>
            <div class="stage-corner stage-corner-lt"></div>
            <div class="stage-corner stage-corner-rb"></div>
            <div class="canvas-caption">
              <span><i class="live-dot"></i><b id="viewport-mode-label">RAW RGBA</b></span>
              <span>拖拽旋转 · 滚轮缩放</span>
            </div>
            <div class="stage-labels">
              <span>+T</span><span>+B</span>
            </div>
          </div>

          <section class="analyzer">
            <div class="analyzer-head">
              <div>
                <span class="eyebrow">TEXTURE INSPECTOR</span>
                <h3>压缩对照</h3>
              </div>
              <div class="map-tabs">${mapTabs}</div>
              <span class="mip-readout" id="analysis-mip">MIP 0 · 1024²</span>
            </div>
            <div class="analyzer-body">
              <div class="view-grid">${viewCards}</div>
              <div class="analysis-summary">
                <div class="summary-top">
                  <span class="summary-codec" id="summary-codec">BC1</span>
                  <span id="summary-map">基础色 · sRGB</span>
                </div>
                <dl>
                  <div><dt>压缩字节</dt><dd id="stat-bytes">—</dd></div>
                  <div><dt>PSNR</dt><dd id="stat-psnr">—</dd></div>
                  <div><dt>最大色差</dt><dd id="stat-delta">—</dd></div>
                </dl>
                <div class="ratio-line">
                  <span>压缩率</span><strong id="stat-ratio">—</strong>
                </div>
                <div class="ratio-bar"><i id="ratio-fill"></i></div>
                <p class="summary-foot" id="summary-foot">正在生成程序化贴图…</p>
              </div>
            </div>
          </section>
        </section>

        <aside class="control-panel">
          <section class="panel-section material-section">
            <div class="section-heading">
              <span class="section-no">01</span>
              <div><h3>材质样本</h3><p>MATERIAL LIBRARY</p></div>
            </div>
            <div class="material-grid">${materialButtons}</div>
          </section>

          <section class="panel-section">
            <div class="section-heading">
              <span class="section-no">02</span>
              <div><h3>程序参数</h3><p>PROCEDURAL CONTROLS</p></div>
            </div>
            <label class="slider-row" for="scale-slider">
              <span class="slider-label"><b>尺度</b><small>SCALE</small></span>
              <output id="scale-output">4.00×</output>
              <input id="scale-slider" type="range" min="1.5" max="8" step="0.05" value="4" />
              <span class="range-ends"><i>细密</i><i>粗粝</i></span>
            </label>
            <label class="slider-row" for="wear-slider">
              <span class="slider-label"><b>磨损</b><small>WEAR</small></span>
              <output id="wear-output">58%</output>
              <input id="wear-slider" type="range" min="0" max="1" step="0.01" value="0.58" />
              <span class="range-ends"><i>完好</i><i>剥蚀</i></span>
            </label>
            <label class="slider-row" for="salt-slider">
              <span class="slider-label"><b>盐雾</b><small>SALT FOG</small></span>
              <output id="salt-output">46%</output>
              <input id="salt-slider" type="range" min="0" max="1" step="0.01" value="0.46" />
              <span class="range-ends"><i>洁净</i><i>结晶</i></span>
            </label>
          </section>

          <section class="panel-section codec-section">
            <div class="section-heading">
              <span class="section-no">03</span>
              <div><h3>离线编码</h3><p>OFFLINE BLOCK CODEC</p></div>
            </div>
            <div class="codec-switch" role="group" aria-label="压缩格式">
              <button class="is-active" data-codec="bc1" type="button"><b>BC1</b><small>DXT1 · 8 B/block</small></button>
              <button data-codec="bc3" type="button"><b>BC3</b><small>DXT5 · 16 B/block</small></button>
            </div>
            <label class="toggle-row" for="cpu-toggle">
              <span><b>强制 CPU 解码</b><small id="upload-path-label">自动检测 S3TC</small></span>
              <input id="cpu-toggle" type="checkbox" />
              <i aria-hidden="true"></i>
            </label>
          </section>

          <section class="panel-section mip-section">
            <div class="section-heading">
              <span class="section-no">04</span>
              <div><h3>Mip 层级</h3><p>FULL CHAIN</p></div>
              <span class="mip-count" id="mip-count">11 LEVELS</span>
            </div>
            <input id="mip-slider" class="mip-slider" type="range" min="0" max="10" step="1" value="0" />
            <div class="mip-scale"><span>1024</span><span>512</span><span>256</span><span>128</span><span>64</span><span>32</span><span>16</span><span>8</span><span>4</span><span>2</span><span>1</span></div>
          </section>

          <section class="panel-section export-section">
            <button class="primary-button" id="export-button" type="button">
              <span>导出 DDS ×3</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v3h16v-3"/></svg>
            </button>
            <button class="secondary-button" id="reload-button" type="button">重载校验</button>
            <p class="reload-note" id="reload-note">导出后将解析文件并比对 mip、尺度与法线朝向。</p>
          </section>
        </aside>
      </main>

      <div class="toast" id="toast" role="status"></div>
      <div class="busy" id="busy">
        <span class="busy-mark"></span>
        <div><strong>正在编译材质</strong><small>BC ENCODE / MIP CHAIN</small></div>
      </div>
    </div>`;
}
