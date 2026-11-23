import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const artifactDir = path.join(root, "artifacts");
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(origin, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  throw new Error(`Preview server did not start at ${origin}`);
}

async function main() {
  await mkdir(artifactDir, { recursive: true });
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const viteBinary = path.join(root, "node_modules", ".bin", "vite");
  const server = spawn(viteBinary, ["preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BROWSER: "none" },
  });
  let serverLog = "";
  server.stdout.on("data", (chunk) => {
    serverLog += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverLog += chunk.toString();
  });

  let browser;
  try {
    await waitForServer(origin);
    browser = await chromium.launch({
      headless: true,
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--disable-gpu-sandbox",
      ],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await page.goto(`${origin}/?verify=1`, { waitUntil: "networkidle" });
    try {
      await page.waitForFunction(() => window.__stereoLab?.ready === true, null, { timeout: 20000 });
    } catch (error) {
      await page.screenshot({ path: path.join(artifactDir, "startup-failure.png") });
      const bootText = await page.locator("#boot-error").textContent();
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nBoot: ${bootText}\nErrors: ${consoleErrors.join("\n")}`);
    }
    await page.waitForTimeout(700);

    const diagnostics = await page.evaluate(() => window.__stereoLab.getDiagnostics());
    await page.evaluate(() => {
      window.__stereoLab.setPaused(true);
      window.__stereoLab.setViewMode("sbs");
      window.__stereoLab.setProbeSide("front");
      window.__stereoLab.setHeadPose({ position: [0, 0, 0], yaw: 0, pitch: 0, roll: 0 });
    });
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(artifactDir, "stereo-front.png") });

    await page.evaluate(() => window.__stereoLab.setProbeSide("behind"));
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(artifactDir, "stereo-behind.png") });

    await page.evaluate(() => window.__stereoLab.setViewMode("anaglyph"));
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(artifactDir, "stereo-anaglyph.png") });

    const report = await page.evaluate(() => window.__stereoLab.runVerification());
    const output = { diagnostics, report, consoleErrors, serverLog };
    await writeFile(path.join(artifactDir, "verification.json"), JSON.stringify(output, null, 2));

    console.log(JSON.stringify(report, null, 2));
    if (consoleErrors.length > 0) {
      console.error("Browser errors:", consoleErrors);
    }
    if (!report.passed || consoleErrors.length > 0) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
