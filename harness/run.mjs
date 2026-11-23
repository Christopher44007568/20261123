// Validation harness: renders deliverable images and computes NPR stability metrics.
import { chromium } from "playwright";
import { PNG } from "pngjs";
import fs from "node:fs";

const OUT = "artifacts";
fs.mkdirSync(OUT + "/validation", { recursive: true });

const CAM = { azimuthDeg: 35, elevationDeg: 38, distance: 175 };

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto("file://" + process.cwd() + "/index.html");
await page.waitForFunction(() => window.__npr && window.__npr.ready);

async function renderPng(opts) {
  const dataUrl = await page.evaluate((o) => window.__npr.render(o), opts);
  return PNG.sync.read(Buffer.from(dataUrl.split(",")[1], "base64"));
}

// Deliverable images (DOM screenshot keeps the unstyled legend overlay).
const modes = [[0, "01_original"], [1, "02_banded"], [2, "03_npr"]];
for (const [mode, name] of modes) {
  await page.evaluate((m) => {
    window.__npr.render({ mode: m, width: 1280, height: 800, azimuthDeg: 35, elevationDeg: 38, distance: 175 });
  }, mode);
  await page.screenshot({ path: OUT + "/" + name + ".png" });
}
console.log("deliverables saved");

// ---------- metric helpers ----------
function bandBoundaryRatio(png) {
  // mode-3 image: R = band index * 255/8, G = 255 for terrain; water/sky excluded.
  const w = png.width, h = png.height, data = png.data;
  let terrain = 0, boundary = 0;
  const bandAt = (x, y) => data[(y * w + x) * 4];
  const isTerrain = (x, y) => data[(y * w + x) * 4 + 1] > 128;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isTerrain(x, y)) continue;
      terrain++;
      const b = bandAt(x, y);
      if ((x + 1 < w && isTerrain(x + 1, y) && bandAt(x + 1, y) !== b) ||
          (y + 1 < h && isTerrain(x, y + 1) && bandAt(x, y + 1) !== b)) {
        boundary++;
      }
    }
  }
  return { terrain, boundary, ratio: boundary / terrain };
}

function diffMask(a, b, thresh) {
  const w = a.width, h = a.height;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const d = Math.max(
      Math.abs(a.data[i * 4] - b.data[i * 4]),
      Math.abs(a.data[i * 4 + 1] - b.data[i * 4 + 1]),
      Math.abs(a.data[i * 4 + 2] - b.data[i * 4 + 2])
    );
    mask[i] = d > thresh ? 1 : 0;
  }
  return { mask, w, h };
}

function chamferDistance(mask, w, h) {
  const INF = 1e9;
  const dt = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) dt[i] = mask[i] ? INF : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0) dt[i] = Math.min(dt[i], dt[i - 1] + 1);
      if (y > 0) {
        dt[i] = Math.min(dt[i], dt[i - w] + 1);
        if (x > 0) dt[i] = Math.min(dt[i], dt[i - w - 1] + 1.4142);
        if (x + 1 < w) dt[i] = Math.min(dt[i], dt[i - w + 1] + 1.4142);
      }
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x + 1 < w) dt[i] = Math.min(dt[i], dt[i + 1] + 1);
      if (y + 1 < h) {
        dt[i] = Math.min(dt[i], dt[i + w] + 1);
        if (x + 1 < w) dt[i] = Math.min(dt[i], dt[i + w + 1] + 1.4142);
        if (x > 0) dt[i] = Math.min(dt[i], dt[i + w - 1] + 1.4142);
      }
    }
  }
  return dt;
}

function strokeWidth(mask, w, h) {
  // width ~= mask area / centerline length (ridge of the distance transform)
  const dt = chamferDistance(mask, w, h);
  let area = 0, ridge = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      area++;
      let isRidge = true;
      for (let dy = -1; dy <= 1 && isRidge; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (dt[ny * w + nx] > dt[i]) { isRidge = false; break; }
        }
      }
      if (isRidge) ridge++;
    }
  }
  return { width: ridge > 0 ? area / ridge : 0, area, ridge };
}

// ---------- 1. band stability vs screen resolution ----------
const resolutions = [[512, 384], [768, 576], [1024, 768], [1536, 1152], [2048, 1536]];
const bandMaps = {};
const bandStats = [];
for (const [w, h] of resolutions) {
  const png = await renderPng({ mode: 3, width: w, height: h, ...CAM });
  bandMaps[w] = png;
  const s = bandBoundaryRatio(png);
  bandStats.push({ width: w, height: h, ...s, ratioTimesW: s.ratio * w });
}
// cross-resolution consistency: downsample 2048 map to 1024 (2x2 majority) and compare
function downsample2x(png) {
  const w = png.width / 2, h = png.height / 2;
  const out = new Uint8Array(w * h * 2); // band, terrain
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const counts = new Map();
      let terr = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const i = ((2 * y + dy) * png.width + 2 * x + dx) * 4;
          if (png.data[i + 1] > 128) {
            terr++;
            const b = png.data[i];
            counts.set(b, (counts.get(b) || 0) + 1);
          }
        }
      }
      let best = 0, bestN = -1;
      for (const [b, n] of counts) if (n > bestN) { best = b; bestN = n; }
      out[(y * w + x) * 2] = best;
      out[(y * w + x) * 2 + 1] = terr >= 2 ? 1 : 0;
    }
  }
  return { data: out, w, h };
}
function bandMismatch(hiPng, loPng) {
  const lo = downsample2x(hiPng);
  let common = 0, diff = 0;
  for (let y = 0; y < lo.h; y++) {
    for (let x = 0; x < lo.w; x++) {
      const i = (y * lo.w + x) * 4;
      const loT = loPng.data[i + 1] > 128;
      const hiT = lo.data[(y * lo.w + x) * 2 + 1] === 1;
      if (loT && hiT) {
        common++;
        if (loPng.data[i] !== lo.data[(y * lo.w + x) * 2]) diff++;
      }
    }
  }
  return { common, diff, mismatch: diff / common };
}
const mismatch1 = bandMismatch(bandMaps[2048], bandMaps[1024]);
const mismatch2 = bandMismatch(bandMaps[1024], bandMaps[512]);
console.log("band stats", JSON.stringify(bandStats));
console.log("mismatch 2048->1024", JSON.stringify(mismatch1), "1024->512", JSON.stringify(mismatch2));

// ---------- 2. stroke width + line classes ----------
async function lineStats(w, h, cam) {
  const npr = await renderPng({ mode: 2, width: w, height: h, ...cam });
  const band = await renderPng({ mode: 1, width: w, height: h, ...cam });
  const cls = await renderPng({ mode: 4, width: w, height: h, ...cam });
  const { mask } = diffMask(npr, band, 12);
  const bold = new Uint8Array(w * h);
  const fine = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    const r = cls.data[i * 4];
    if (r > 200) bold[i] = 1;
    else if (r > 60) fine[i] = 1;
  }
  const b = strokeWidth(bold, w, h);
  const f = strokeWidth(fine, w, h);
  return { bold: b, fine: f, boldPx: b.area, finePx: f.area };
}
const strokeMain = await lineStats(1024, 768, CAM);
console.log("stroke@1024", JSON.stringify(strokeMain));

// stroke width vs resolution (screen-space width must stay ~constant in px)
const strokeByRes = [];
for (const [w, h] of [[512, 384], [1024, 768], [2048, 1536]]) {
  const s = await lineStats(w, h, CAM);
  strokeByRes.push({ width: w, boldWidth: s.bold.width, fineWidth: s.fine.width });
}
console.log("stroke by res", JSON.stringify(strokeByRes));

// stroke width vs zoom (screen-space width must stay ~constant in px)
const strokeByZoom = [];
for (const dist of [120, 175, 260]) {
  const s = await lineStats(1024, 768, { ...CAM, distance: dist });
  strokeByZoom.push({ distance: dist, boldWidth: s.bold.width, fineWidth: s.fine.width });
}
console.log("stroke by zoom", JSON.stringify(strokeByZoom));

// ---------- 3. temporal stability (rotation flicker) ----------
// determinism: identical camera twice must be pixel-identical
{
  const a = await renderPng({ mode: 2, width: 640, height: 400, ...CAM });
  const b = await renderPng({ mode: 2, width: 640, height: 400, ...CAM });
  let diff = 0;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) diff++;
  console.log("determinism diff bytes:", diff);
  var determinismDiff = diff;
}
// rotation sweep: outline pixel counts must vary smoothly (no flicker spikes)
const rotCounts = [];
for (let az = 0; az < 360; az += 6) {
  const cls = await renderPng({ mode: 4, width: 640, height: 400, azimuthDeg: az, elevationDeg: 38, distance: 175 });
  let bold = 0, fine = 0;
  for (let i = 0; i < cls.width * cls.height; i++) {
    const r = cls.data[i * 4];
    if (r > 200) bold++;
    else if (r > 60) fine++;
  }
  rotCounts.push({ az, bold, fine, total: bold + fine });
}
const deltas = [];
for (let i = 1; i < rotCounts.length; i++) {
  const prev = rotCounts[i - 1].total, cur = rotCounts[i].total;
  deltas.push(Math.abs(cur - prev) / Math.max(1, (cur + prev) / 2));
}
const sorted = [...deltas].sort((a, b) => a - b);
const medianDelta = sorted[Math.floor(sorted.length / 2)];
const maxDelta = Math.max(...deltas);
console.log("rotation median delta", medianDelta, "max delta", maxDelta);
// micro-jitter: +/-0.5 deg around a fixed view
const jitter = [];
for (const az of [34.5, 35.0, 35.5]) {
  const cls = await renderPng({ mode: 4, width: 640, height: 400, azimuthDeg: az, elevationDeg: 38, distance: 175 });
  let total = 0;
  for (let i = 0; i < cls.width * cls.height; i++) if (cls.data[i * 4] > 60) total++;
  jitter.push(total);
}
console.log("jitter counts", jitter);

// ---------- 4. water baseline invariance (unstyled across modes) ----------
const waterCheck = await (async () => {
  const orig = await renderPng({ mode: 0, width: 1024, height: 768, ...CAM });
  const npr = await renderPng({ mode: 2, width: 1024, height: 768, ...CAM });
  const idx = await renderPng({ mode: 3, width: 1024, height: 768, ...CAM });
  let water = 0, maxDiff = 0;
  for (let i = 0; i < orig.width * orig.height; i++) {
    const isWater = idx.data[i * 4] === 0 && idx.data[i * 4 + 1] === 0 && idx.data[i * 4 + 2] === 0;
    if (!isWater) continue;
    water++;
    for (let c = 0; c < 3; c++) {
      maxDiff = Math.max(maxDiff, Math.abs(orig.data[i * 4 + c] - npr.data[i * 4 + c]));
    }
  }
  return { waterPixels: water, maxChannelDiff: maxDiff };
})();
console.log("water invariance", JSON.stringify(waterCheck));

// ---------- report ----------
const TARGET_BOLD = 1.5, TARGET_FINE = 1.0;
const pct = (d, b) => (100 * d / b).toFixed(1) + "%";
const report = {
  camera: CAM,
  bandBoundaryRatio: bandStats,
  crossResolutionMismatch: { "2048vs1024": mismatch1, "1024vs512": mismatch2 },
  strokeWidth: {
    target: { bold: TARGET_BOLD, fine: TARGET_FINE },
    measured1024: { bold: strokeMain.bold.width, fine: strokeMain.fine.width },
    error: {
      bold: pct(strokeMain.bold.width - TARGET_BOLD, TARGET_BOLD),
      fine: pct(strokeMain.fine.width - TARGET_FINE, TARGET_FINE),
    },
    byResolution: strokeByRes,
    byZoom: strokeByZoom,
  },
  flicker: {
    determinismDiffBytes: determinismDiff,
    rotationMedianDelta: medianDelta,
    rotationMaxDelta: maxDelta,
    jitterCounts: jitter,
  },
  waterInvariance: waterCheck,
};
fs.writeFileSync(OUT + "/metrics.json", JSON.stringify(report, null, 2));

const lines = [];
lines.push("# NPR 卡通着色验证报告");
lines.push("");
lines.push("## 色阶边界像素比例(随分辨率)");
lines.push("| 分辨率 | 地形像素 | 边界像素 | 比例 | 比例×宽度 |");
lines.push("|---|---|---|---|---|");
for (const s of bandStats) {
  lines.push(`| ${s.width}x${s.height} | ${s.terrain} | ${s.boundary} | ${(s.ratio * 100).toFixed(3)}% | ${s.ratioTimesW.toFixed(2)} |`);
}
lines.push("");
lines.push(`跨分辨率色带失配:2048→1024 = ${(mismatch1.mismatch * 100).toFixed(3)}% (${mismatch1.diff}/${mismatch1.common}),` +
  ` 1024→512 = ${(mismatch2.mismatch * 100).toFixed(3)}% (${mismatch2.diff}/${mismatch2.common})`);
lines.push("");
lines.push("## 描边宽度(目标:粗 1.5px / 细 1.0px)");
lines.push(`- 1024x768 实测:粗 ${strokeMain.bold.width.toFixed(2)}px(误差 ${pct(strokeMain.bold.width - TARGET_BOLD, TARGET_BOLD)}),` +
  ` 细 ${strokeMain.fine.width.toFixed(2)}px(误差 ${pct(strokeMain.fine.width - TARGET_FINE, TARGET_FINE)})`);
lines.push("- 随分辨率: " + strokeByRes.map((s) => `${s.width}px→粗${s.boldWidth.toFixed(2)}/细${s.fineWidth.toFixed(2)}`).join(", "));
lines.push("- 随缩放距离: " + strokeByZoom.map((s) => `d=${s.distance}→粗${s.boldWidth.toFixed(2)}/细${s.fineWidth.toFixed(2)}`).join(", "));
lines.push("");
lines.push("## 轮廓时间稳定性");
lines.push(`- 确定性重渲染差异字节: ${determinismDiff}`);
lines.push(`- 旋转 360°(步长 6°)轮廓像素数:相邻帧相对变化 中位 ${(medianDelta * 100).toFixed(2)}%,最大 ${(maxDelta * 100).toFixed(2)}%`);
lines.push(`- 微抖动 ±0.5° 轮廓像素数: ${jitter.join(", ")}`);
lines.push("");
lines.push("## 水体基线(未风格化)");
lines.push(`- 水像素 ${waterCheck.waterPixels},原材质 vs NPR 最大通道差: ${waterCheck.maxChannelDiff}`);
fs.writeFileSync(OUT + "/report.md", lines.join("\n") + "\n");

// a couple of validation stills
await page.evaluate(() => window.__npr.render({ mode: 2, width: 1280, height: 800, azimuthDeg: 215, elevationDeg: 30, distance: 130 }));
await page.screenshot({ path: OUT + "/validation/npr_rot215_zoom130.png" });
await page.evaluate(() => window.__npr.render({ mode: 2, width: 1280, height: 800, azimuthDeg: 120, elevationDeg: 55, distance: 260 }));
await page.screenshot({ path: OUT + "/validation/npr_rot120_zoom260.png" });

await browser.close();
console.log("DONE");
