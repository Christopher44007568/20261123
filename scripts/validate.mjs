import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PORT = 4174;
const ROOT = process.cwd();
const EVIDENCE_DIR = join(ROOT, "artifacts", "evidence");
mkdirSync(EVIDENCE_DIR, { recursive: true });

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync("/home/hj/.cache/ms-playwright")) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = "/home/hj/.cache/ms-playwright";
}
const { chromium } = await import("playwright");

const waitForServer = async (url, timeoutMs = 15_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  throw new Error(`Timed out waiting for ${url}`);
};

const assertClose = (actual, expected, tolerance, message) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
};

const server = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
  { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
);
let serverLog = "";
server.stdout.on("data", (chunk) => {
  serverLog += String(chunk);
});
server.stderr.on("data", (chunk) => {
  serverLog += String(chunk);
});

let browser;
try {
  await waitForServer(`http://127.0.0.1:${PORT}/`);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__lensRain?.ready === true);
  await page.waitForTimeout(1200);
  assert.equal(pageErrors.length, 0, `Page errors: ${pageErrors.join("; ")}`);
  assert.equal(consoleErrors.length, 0, `Console errors: ${consoleErrors.join("; ")}`);

  const initial = await page.evaluate(() => window.__lensRain.getDiagnostics());
  assert.equal(initial.dropCount, 58);
  assert.equal(initial.mode, "drift");

  await page.evaluate(() => window.__lensRain.setMode("off"));
  assert.equal((await page.evaluate(() => window.__lensRain.getDiagnostics())).dropCount, 0);
  await page.screenshot({ path: join(EVIDENCE_DIR, "mode-no-rain.png") });

  await page.evaluate(() => window.__lensRain.setMode("static"));
  await page.waitForTimeout(250);
  const staticA = await page.evaluate(() => window.__lensRain.getDiagnostics());
  await page.waitForTimeout(650);
  const staticB = await page.evaluate(() => window.__lensRain.getDiagnostics());
  for (let index = 0; index < staticA.droplets.length; index += 1) {
    assertClose(staticB.droplets[index].x, staticA.droplets[index].x, 1e-9, "static x drifted");
    assertClose(staticB.droplets[index].y, staticA.droplets[index].y, 1e-9, "static y drifted");
  }
  await page.screenshot({ path: join(EVIDENCE_DIR, "mode-static.png") });

  await page.evaluate(() => window.__lensRain.setMode("drift"));
  const driftA = await page.evaluate(() => window.__lensRain.getDiagnostics());
  await page.waitForTimeout(1300);
  const driftB = await page.evaluate(() => window.__lensRain.getDiagnostics());
  const moved = driftA.droplets.filter((drop, index) => {
    const after = driftB.droplets[index];
    return after && Math.hypot(after.x - drop.x, after.y - drop.y) > 0.001;
  });
  assert.ok(moved.length > 12, `Expected sliding drops, moved=${moved.length}`);
  assert.ok(driftB.droplets.some((drop) => drop.trailPx > 8), "Expected wet trails in drift mode");
  await page.screenshot({ path: join(EVIDENCE_DIR, "mode-drift.png") });

  await page.evaluate(() => {
    window.__lensRain.setMode("static");
    window.__lensRain.setFocus(0.09);
  });
  await page.waitForTimeout(80);
  const nearFocus = await page.evaluate(() => window.__lensRain.getDiagnostics());
  await page.evaluate(() => window.__lensRain.setFocus(0.34));
  await page.waitForTimeout(80);
  const farFocus = await page.evaluate(() => window.__lensRain.getDiagnostics());
  let maxRadiusDelta = 0;
  let maxBlurDelta = 0;
  for (let index = 0; index < nearFocus.droplets.length; index += 1) {
    maxRadiusDelta = Math.max(
      maxRadiusDelta,
      Math.abs(nearFocus.droplets[index].radiusPx - farFocus.droplets[index].radiusPx),
    );
    maxBlurDelta = Math.max(
      maxBlurDelta,
      Math.abs(nearFocus.droplets[index].focusBlurPx - farFocus.droplets[index].focusBlurPx),
    );
  }
  assert.ok(maxRadiusDelta < 1e-6, `Focus changed projected radius by ${maxRadiusDelta}px`);
  assert.ok(maxBlurDelta > 2, "Focus did not change circle-of-confusion");

  const rapidFocusRadiusDelta = await page.evaluate(() => {
    const baseline = window.__lensRain.getDiagnostics().droplets.map((drop) => drop.radiusPx);
    let largestDelta = 0;
    for (let index = 0; index < 40; index += 1) {
      window.__lensRain.setFocus(index % 2 === 0 ? 0.08 : 0.36);
      const current = window.__lensRain.getDiagnostics().droplets;
      for (let dropIndex = 0; dropIndex < current.length; dropIndex += 1) {
        largestDelta = Math.max(largestDelta, Math.abs(current[dropIndex].radiusPx - baseline[dropIndex]));
      }
    }
    return largestDelta;
  });
  assert.ok(rapidFocusRadiusDelta < 1e-6, `Rapid focus changed radius by ${rapidFocusRadiusDelta}px`);

  await page.evaluate(() => window.__lensRain.setFocus(0.135));
  const focal50 = await page.evaluate(() => window.__lensRain.getDiagnostics());
  await page.evaluate(() => window.__lensRain.setFocalLength(85));
  const focal85 = await page.evaluate(() => window.__lensRain.getDiagnostics());
  let maxRatioError = 0;
  for (let index = 0; index < focal50.droplets.length; index += 1) {
    const ratio = focal85.droplets[index].radiusPx / focal50.droplets[index].radiusPx;
    maxRatioError = Math.max(maxRatioError, Math.abs(ratio - 85 / 50));
  }
  assert.ok(maxRatioError < 1e-5, `Focal projection ratio error ${maxRatioError}`);
  await page.evaluate(() => window.__lensRain.setFocalLength(50));

  await page.evaluate(() => {
    window.__lensRain.setMode("static");
    window.__lensRain.setShowMask(true);
  });
  await page.waitForTimeout(250);
  const maskState = await page.evaluate(() => window.__lensRain.getDiagnostics());
  const candidate = maskState.droplets
    .filter((drop) => drop.radiusPx > 16 && drop.x < 0.72)
    .sort((a, b) => b.radiusPx - a.radiusPx)[0];
  assert.ok(candidate, "No large occluder found outside the control panel");
  const maskPixel = await page.evaluate(
    ({ x, y }) => window.__lensRain.readPixel(x * 1440, (1 - y) * 900),
    { x: candidate.x, y: candidate.y },
  );
  assert.ok(
    maskPixel[0] > 150 && maskPixel[0] > maskPixel[1] + 20 && maskPixel[1] > maskPixel[2] + 20,
    `Large-drop occlusion mask was not opaque orange: ${maskPixel.join(",")}`,
  );
  await page.screenshot({ path: join(EVIDENCE_DIR, "occlusion-mask.png") });

  await page.evaluate(() => window.__lensRain.setShowMask(false));
  await page.waitForTimeout(120);
  const coveredPixel = await page.evaluate(
    ({ x, y }) => window.__lensRain.readPixel(x * 1440, (1 - y) * 900),
    { x: candidate.x, y: candidate.y },
  );
  await page.evaluate(() => window.__lensRain.setMode("off"));
  await page.waitForTimeout(120);
  const uncoveredPixel = await page.evaluate(
    ({ x, y }) => window.__lensRain.readPixel(x * 1440, (1 - y) * 900),
    { x: candidate.x, y: candidate.y },
  );
  const dropContrast =
    Math.abs(coveredPixel[0] - uncoveredPixel[0]) +
    Math.abs(coveredPixel[1] - uncoveredPixel[1]) +
    Math.abs(coveredPixel[2] - uncoveredPixel[2]);
  assert.ok(dropContrast > 8, `Large drop did not replace background: contrast=${dropContrast}`);

  await page.evaluate(() => {
    window.__lensRain.setMode("drift");
    window.__lensRain.setFocus(0.135);
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(EVIDENCE_DIR, "final-1440x900.png") });

  const report = {
    status: "PASS",
    viewport: initial.viewport,
    modes: {
      noRainDrops: 0,
      staticDriftPx: 0,
      driftingDrops: moved.length,
      wetTrails: driftB.droplets.filter((drop) => drop.trailPx > 8).length,
    },
    optics: {
      focusRadiusDeltaPx: maxRadiusDelta,
      rapidFocusRadiusDeltaPx: rapidFocusRadiusDelta,
      rapidFocusSamples: 40,
      focusBlurDeltaPx: maxBlurDelta,
      focalLengthRatioError: maxRatioError,
    },
    occlusion: {
      selectedLargeDropRadiusPx: candidate.radiusPx,
      maskPixel,
      coveredPixel,
      uncoveredPixel,
      backgroundReplacementContrast: dropContrast,
      lensSampleContinuity: "covered by tests/droplets.test.ts",
    },
    errors: { console: consoleErrors, page: pageErrors },
  };
  writeFileSync(join(EVIDENCE_DIR, "validation.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  writeFileSync(join(EVIDENCE_DIR, "validation-failure.txt"), `${message}\n\n${serverLog}\n`);
  console.error(message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
