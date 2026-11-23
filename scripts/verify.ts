import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { URL } from "node:url";
import { chromium, type Page } from "playwright";
import { PNG } from "pngjs";

const APP_URL = "http://127.0.0.1:4173/";
const OUT = new URL("../artifacts/", import.meta.url);

interface CaptureReport {
  progress: number;
  mode: number;
  residentPages: number;
  gpu: { stats: number[]; visible: number[]; triangles: number; drawArgs: number[] };
  cpu: { stats: number[]; triangles: number; fallbackClusters: number };
  comparison: {
    match: boolean;
    statsMatch: boolean;
    gpuVisible: number;
    cpuVisible: number;
    missingFromGpu: number[];
    extraOnGpu: number[];
  };
  lodSwitches: [number, number, number, number];
  adapterInfo: string;
}

interface PathReport {
  checkpoints: CaptureReport[];
  lodSwitches: [number, number, number, number];
  transitions: number[][];
  totalSwitches: number;
  maxTriangles: number;
  peakClusters: number;
  adapterInfo: string;
}

async function serverIsUp(): Promise<boolean> {
  try {
    const response = await fetch(APP_URL, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureServer(): Promise<ChildProcess | null> {
  if (await serverIsUp()) return null;
  const child = spawn("npm", ["run", "dev"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let i = 0; i < 80; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (await serverIsUp()) return child;
  }
  child.kill("SIGTERM");
  throw new Error("Vite server did not start");
}

async function decodeDataUrl(dataUrl: string): Promise<PNG> {
  const base64 = dataUrl.split(",")[1];
  if (!base64) throw new Error("GPU readback did not return PNG data");
  return PNG.sync.read(Buffer.from(base64, "base64"));
}

async function saveCapture(page: Page, name: string, dataUrl: string): Promise<void> {
  await writeFile(new URL(`${name}.png`, OUT), Buffer.from(dataUrl.split(",")[1]!, "base64"));
  await page.waitForFunction(() => {
    const image = document.querySelector<HTMLImageElement>("#readback-image");
    return image !== null && image.complete && image.naturalWidth > 0;
  });
  await page.screenshot({ path: new URL(`${name}-frame.png`, OUT).pathname });
}

function foregroundMask(png: PNG): Uint8Array {
  const mask = new Uint8Array(png.width * png.height);
  for (let i = 0; i < mask.length; i++) {
    const offset = i * 4;
    mask[i] =
      png.data[offset]! + png.data[offset + 1]! + png.data[offset + 2]! > 384 ? 1 : 0;
  }
  return mask;
}

function maskMetrics(fallback: PNG, high: PNG): {
  fallbackPixels: number;
  highPixels: number;
  uncoveredPixels: number;
  uncoveredRatio: number;
  iou: number;
} {
  const a = foregroundMask(fallback);
  const b = foregroundMask(high);
  let fallbackPixels = 0;
  let highPixels = 0;
  let uncovered = 0;
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i]) fallbackPixels++;
    if (b[i]) highPixels++;
    if (a[i] && b[i]) intersection++;
    if (a[i] || b[i]) union++;
    if (a[i] && !b[i]) uncovered++;
  }
  return {
    fallbackPixels,
    highPixels,
    uncoveredPixels: uncovered,
    uncoveredRatio: fallbackPixels === 0 ? 0 : uncovered / fallbackPixels,
    iou: union === 0 ? 1 : intersection / union,
  };
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const server = await ensureServer();
  const browser = await chromium.launch({
    headless: false,
    executablePath: chromium.executablePath(),
    args: [
      "--enable-unsafe-webgpu",
      "--use-angle=vulkan",
      "--enable-features=Vulkan",
      "--disable-gpu-sandbox",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(180_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("404")) {
      browserErrors.push(message.text());
    }
  });

  try {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__vgeo?.ready === true, null, {
      timeout: 60_000,
    });
    const path = await page.evaluate(
      async () => await window.__vgeo!.runPathVerification(),
    );
    const failedCheckpoints = path.checkpoints.filter(
      (checkpoint) => !checkpoint.comparison.match || !checkpoint.comparison.statsMatch,
    );
    if (failedCheckpoints.length > 0) {
      throw new Error(`GPU/CPU culling mismatch at ${failedCheckpoints.length} checkpoints`);
    }

    const poses = await page.evaluate(() => window.__vgeo!.path);
    const shots: { name: string; mode: number; poseIndex: number; clearPages?: boolean }[] = [
      { name: "01-far-sea", mode: 0, poseIndex: 0, clearPages: true },
      { name: "02-approach", mode: 0, poseIndex: 2 },
      { name: "03-near-final", mode: 0, poseIndex: 4 },
      { name: "04-near-clusters", mode: 1, poseIndex: 4 },
      { name: "05-near-density", mode: 2, poseIndex: 4 },
      { name: "06-cliff-ascent", mode: 0, poseIndex: 6 },
      { name: "07-cliff-descent", mode: 0, poseIndex: 7 },
      { name: "08-fallback-only", mode: 0, poseIndex: 4, clearPages: true },
    ];
    for (const shot of shots) {
      const dataUrl = await page.evaluate(
        async ({ pose, mode, clearPages }) =>
          await window.__vgeo!.captureScreenshot(pose, {
            mode,
            clearPages,
            settleFrames: clearPages ? 2 : 4,
            loadBudget: clearPages ? 0 : 64,
            progress: 0.5,
          }),
        { pose: poses[shot.poseIndex]!, mode: shot.mode, clearPages: shot.clearPages ?? false },
      );
      await saveCapture(page, shot.name, dataUrl);
      process.stdout.write(`captured ${shot.name}\n`);
    }

    const fallbackMaskUrl = await page.evaluate(
      async (pose) =>
        await window.__vgeo!.captureScreenshot(pose, {
          mode: 3,
          clearPages: true,
          settleFrames: 2,
          loadBudget: 0,
          progress: 0.5,
        }),
      poses[4]!,
    );
    const highMaskUrl = await page.evaluate(
      async (pose) =>
        await window.__vgeo!.captureScreenshot(pose, {
          mode: 3,
          clearPages: false,
          settleFrames: 4,
          loadBudget: 64,
          progress: 0.5,
        }),
      poses[4]!,
    );
    const coverage = maskMetrics(
      await decodeDataUrl(fallbackMaskUrl),
      await decodeDataUrl(highMaskUrl),
    );
    await saveCapture(page, "09-fallback-mask", fallbackMaskUrl);
    await saveCapture(page, "10-high-mask", highMaskUrl);

    if (coverage.uncoveredRatio > 0.005) {
      throw new Error(
        `silhouette hole check failed: ${(coverage.uncoveredRatio * 100).toFixed(3)}% uncovered`,
      );
    }

    const report = {
      generatedAt: new Date().toISOString(),
      seed: "0x051C1AFF",
      sourceTriangles: 3_997_696,
      pages: 488,
      candidateMeshlets: 41_480,
      trianglesPerMeshlet: 128,
      adapter: path.adapterInfo,
      cameraPath: poses,
      culling: {
        allCheckpointsMatchCpu: true,
        checkpointCount: path.checkpoints.length,
        submittedTriangles: path.checkpoints.map((checkpoint) => ({
          progress: Number(checkpoint.progress.toFixed(3)),
          triangles: checkpoint.gpu.triangles,
          clusters: checkpoint.gpu.drawArgs[1],
          residentPages: checkpoint.residentPages,
          fallbackClusters: checkpoint.gpu.stats[5],
          coverageClusters: checkpoint.gpu.stats[11],
          lodClusters: checkpoint.gpu.stats.slice(6, 10),
        })),
        peakSubmittedTriangles: path.maxTriangles,
        peakClusters: path.peakClusters,
      },
      lod: {
        switchesToLevel: path.lodSwitches,
        totalSwitches: path.totalSwitches,
        transitionMatrix: path.transitions,
      },
      silhouette: {
        fallbackPixels: coverage.fallbackPixels,
        highLodPixels: coverage.highPixels,
        uncoveredPixels: coverage.uncoveredPixels,
        uncoveredRatio: coverage.uncoveredRatio,
        maskIoU: coverage.iou,
      },
      browserErrors,
    };
    await writeFile(
      new URL("gpu-report.json", OUT),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await browser.close();
    server?.kill("SIGTERM");
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
