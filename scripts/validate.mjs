import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 4183);
const BASE_URL = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`;
const VALIDATION_RES = process.env.VALIDATION_RES ?? "480x270";
const OUTPUT_RES = process.env.OUTPUT_RES ?? "960x600";
const BROWSER_ARGS = [
  "--enable-unsafe-webgpu",
  "--use-angle=vulkan",
  "--use-vulkan=swiftshader",
  "--enable-features=Vulkan",
  "--ignore-gpu-blocklist",
  "--enable-unsafe-swiftshader",
];

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  for (const candidate of [
    "/home/hj/.cache/ms-playwright",
    `${process.env.HOME ?? ""}/.cache/ms-playwright`,
  ]) {
    if (candidate && existsSync(candidate)) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = candidate;
      break;
    }
  }
}

const { chromium } = await import("playwright");

mkdirSync(`${ROOT}/artifacts`, { recursive: true });

async function serverIsReady() {
  try {
    const response = await fetch(BASE_URL, { signal: AbortSignal.timeout(800) });
    return response.ok;
  } catch {
    return false;
  }
}

let server = null;
if (!(await serverIsReady())) {
  server = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(PORT)], {
    cwd: ROOT,
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 80; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (await serverIsReady()) break;
  }
  if (!(await serverIsReady())) {
    server.kill();
    throw new Error("Vite server did not start.");
  }
}

const browser = await chromium.launch({ headless: true, args: BROWSER_ARGS });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const runtimeErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));

await page.goto(`${BASE_URL}/?res=${VALIDATION_RES}`, { waitUntil: "networkidle" });
await page.waitForFunction(
  () => window.__RESTIR__?.snapshot().ready === true,
  null,
  { timeout: 30000 },
);
await page.evaluate(() => {
  window.__RESTIR__.setManual(true);
  window.__RESTIR__.setPaused(true);
  window.__RESTIR__.setMode(0);
  window.__RESTIR__.setSpatial(true);
  window.__RESTIR__.setHistoryCap(32);
  window.__RESTIR__.resetHistory();
});

const step = (delta = 0, count = 1) =>
  page.evaluate(({ delta, count }) => window.__RESTIR__.step(delta, count), { delta, count });
const setPathTime = (time) =>
  page.evaluate(({ time }) => window.__RESTIR__.setPathTime(time), { time });
const setMode = (mode) =>
  page.evaluate(({ mode }) => {
    window.__RESTIR__.setMode(mode);
    const select = document.querySelector("#view-mode");
    if (select) {
      select.value = ["restir", "reference", "split", "debug"][mode] ?? "restir";
    }
  }, { mode });

for (let i = 0; i < 6; i++) await step(0, 1);

const pathStart = 6.2;
const pathStep = 0.42;
const frameCount = 12;
const frames = [];
for (let i = 0; i < frameCount; i++) {
  await setPathTime(pathStart + i * pathStep);
  const restir = await step(0, 1);
  await setMode(1);
  const reference = await step(0, 1);
  await setMode(0);
  const frame = {
    frame: i,
    pathTime: Number((pathStart + i * pathStep).toFixed(3)),
    acceptRate: restir.acceptRate,
    historyRejectRate: restir.historyRejectRate,
    finalWeight: restir.meanWeight,
    meanLuminance: restir.meanLuminance,
    referenceError: reference.referenceError,
  };
  frames.push(frame);
  process.stdout.write(
    `path ${String(i).padStart(2, "0")}: accept ${(frame.acceptRate * 100).toFixed(1)}% ` +
    `history ${(frame.historyRejectRate * 100).toFixed(1)}% ` +
    `err ${frame.referenceError.toFixed(5)}\n`,
  );
}

const medianError = [...frames].map((frame) => frame.referenceError).sort((a, b) => a - b)[
  Math.floor(frames.length / 2)
];
const disocclusionFrames = [...frames]
  .sort((a, b) => b.historyRejectRate - a.historyRejectRate)
  .slice(0, 3);
const ghostRatios = disocclusionFrames.map((frame) => frame.referenceError / Math.max(medianError, 1e-6));
const maxGhostRatio = Math.max(...ghostRatios);
const ghostPass = maxGhostRatio < 1.6;

const driftCaps = [4, 16, 32, 64];
const drift = [];
for (const cap of driftCaps) {
  await page.evaluate(({ cap }) => {
    window.__RESTIR__.setHistoryCap(cap);
    window.__RESTIR__.setMode(0);
    window.__RESTIR__.setPathTime(8.30);
    window.__RESTIR__.resetHistory();
  }, { cap });
  for (let i = 0; i < 16; i++) await step(0, 1);
  const luminanceSamples = [];
  for (let i = 0; i < 12; i++) {
    luminanceSamples.push((await step(0, 1)).meanLuminance);
  }
  const snapshot = await step(0, 1);
  const averageLuminance =
    luminanceSamples.reduce((sum, value) => sum + value, 0) / luminanceSamples.length;
  drift.push({
    cap,
    meanLuminance: averageLuminance,
    luminanceSamples,
    finalWeight: snapshot.meanWeight,
    historyRejectRate: snapshot.historyRejectRate,
  });
  process.stdout.write(
    `cache ${String(cap).padStart(2, "0")}: luminance ${averageLuminance.toFixed(5)} ` +
    `W ${snapshot.meanWeight.toFixed(2)}\n`,
  );
}
const driftLuminance = drift.map((entry) => entry.meanLuminance);
const driftMean = driftLuminance.reduce((sum, value) => sum + value, 0) / driftLuminance.length;
const maxDrift = Math.max(
  ...driftLuminance.map((value) => Math.abs(value - driftMean) / Math.max(driftMean, 1e-6)),
);
const driftPass = maxDrift < 0.05;

await page.evaluate(() => {
  window.__RESTIR__.setHistoryCap(32);
  window.__RESTIR__.setSpatial(false);
  window.__RESTIR__.setPathTime(6.2);
  window.__RESTIR__.resetHistory();
});
for (let i = 0; i < 6; i++) await step(0, 1);
const spatialOffSamples = [];
for (let i = 0; i < 4; i++) {
  await page.evaluate(({ time }) => window.__RESTIR__.setPathTime(time), { time: 6.2 + i * 0.42 });
  spatialOffSamples.push(await step(0, 1));
}
const spatialOffAccept = spatialOffSamples.reduce((sum, item) => sum + item.acceptRate, 0) / 4;
await page.evaluate(() => window.__RESTIR__.setSpatial(true));

const averageAccept = frames.reduce((sum, frame) => sum + frame.acceptRate, 0) / frames.length;
const averageHistoryReject =
  frames.reduce((sum, frame) => sum + frame.historyRejectRate, 0) / frames.length;
const averageError = frames.reduce((sum, frame) => sum + frame.referenceError, 0) / frames.length;
const validationPass =
  runtimeErrors.length === 0 &&
  ghostPass &&
  driftPass &&
  averageAccept > 0.08 &&
  spatialOffAccept > 0.02;

await page.close();

const capturePage = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
capturePage.on("pageerror", (error) => runtimeErrors.push(`capture pageerror: ${error.message}`));
await capturePage.goto(`${BASE_URL}/?res=${OUTPUT_RES}`, { waitUntil: "networkidle" });
await capturePage.waitForFunction(
  () => window.__RESTIR__?.snapshot().ready === true,
  null,
  { timeout: 30000 },
);
await capturePage.evaluate(() => {
  window.__RESTIR__.setManual(true);
  window.__RESTIR__.setPaused(true);
  window.__RESTIR__.setSpatial(true);
  window.__RESTIR__.setHistoryCap(32);
  window.__RESTIR__.setMode(0);
  window.__RESTIR__.setPathTime(8.15);
  window.__RESTIR__.resetHistory();
  const select = document.querySelector("#view-mode");
  if (select) select.value = "restir";
});
for (let i = 0; i < 18; i++) {
  await capturePage.evaluate(() => window.__RESTIR__.step(0.045, 1));
}
await capturePage.waitForTimeout(150);
await capturePage.screenshot({ path: `${ROOT}/artifacts/final_restir.png`, timeout: 120000 });

await capturePage.evaluate(() => {
  window.__RESTIR__.setMode(1);
  const select = document.querySelector("#view-mode");
  if (select) select.value = "reference";
});
await capturePage.evaluate(() => window.__RESTIR__.step(0, 1));
await capturePage.waitForTimeout(150);
await capturePage.screenshot({ path: `${ROOT}/artifacts/final_reference.png`, timeout: 120000 });

await capturePage.evaluate(() => {
  window.__RESTIR__.setMode(2);
  const select = document.querySelector("#view-mode");
  if (select) select.value = "split";
});
await capturePage.evaluate(() => window.__RESTIR__.step(0, 1));
await capturePage.waitForTimeout(150);
await capturePage.screenshot({ path: `${ROOT}/artifacts/final_split.png`, timeout: 120000 });
const finalReference = await capturePage.evaluate(() => window.__RESTIR__.snapshot());

await capturePage.evaluate(() => {
  window.__RESTIR__.setMode(3);
  const select = document.querySelector("#view-mode");
  if (select) select.value = "debug";
});
await capturePage.evaluate(() => window.__RESTIR__.step(0, 1));
await capturePage.waitForTimeout(150);
await capturePage.screenshot({ path: `${ROOT}/artifacts/reservoir_debug.png`, timeout: 120000 });

const result = {
  lights: finalReference.lightCount,
  triangles: finalReference.triangleCount,
  pass: validationPass,
  acceptanceRate: averageAccept,
  averageHistoryRejectRate: averageHistoryReject,
  averageReferenceError: averageError,
  spatialToggle: {
    onAcceptRate: averageAccept,
    offAcceptRate: spatialOffAccept,
    enabledByDefault: true,
  },
  ghost: {
    path: { startTime: pathStart, stepSeconds: pathStep, frames: frameCount },
    frames,
    medianErr: medianError,
    disocclusionFrames,
    maxGhostRatio,
    pass: ghostPass,
  },
  drift: {
    mCaps: driftCaps,
    meanLums: driftLuminance,
    luminanceSamples: drift.map((entry) => entry.luminanceSamples),
    finalWeights: drift.map((entry) => entry.finalWeight),
    maxRelDev: maxDrift,
    pass: driftPass,
  },
  reference: {
    lightsTraversedPerPixel: finalReference.lightCount,
    finalError: finalReference.referenceError,
    sampled: finalReference.referenceSampled,
  },
  runtimeErrors,
};

writeFileSync(`${ROOT}/artifacts/validation.json`, JSON.stringify(result, null, 2));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

await capturePage.close();
await browser.close();
server?.kill();

if (!validationPass) {
  process.exitCode = 1;
}
