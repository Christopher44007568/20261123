import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("artifacts/dds", { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
const downloads = [];
page.on("download", async (download) => {
  const filename = download.suggestedFilename();
  downloads.push(filename);
  await download.saveAs(`artifacts/dds/${filename}`);
});

const waitForReady = async () => {
  await page.waitForFunction(
    () => {
      const api = window.__SALT_LAB__;
      return api && api.snapshot().mipCount > 0 && !document.querySelector("#busy")?.classList.contains("is-visible");
    },
    null,
    { timeout: 30000 },
  );
};

const setRange = async (selector, value) => {
  await page.locator(selector).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
};

const snapshot = () => page.evaluate(() => window.__SALT_LAB__.snapshot());

await page.goto("http://localhost:4174/", { waitUntil: "networkidle" });
await waitForReady();
const initial = await snapshot();

await page.click('[data-codec="bc3"]');
await page.waitForFunction(() => window.__SALT_LAB__.snapshot().stats.totalCompressedBytes > 3_000_000, null, {
  timeout: 30000,
});
await waitForReady();
const bc3 = await snapshot();

await setRange("#mip-slider", 4);
await page.waitForTimeout(200);
const mip4 = await snapshot();
await setRange("#mip-slider", 8);
await page.waitForTimeout(200);
const mip8 = await snapshot();
await setRange("#mip-slider", 0);
await page.waitForTimeout(200);

await page.click('[data-view-mode="heat"]');
await page.waitForTimeout(300);
await page.screenshot({ path: "artifacts/validate-bc3-heat.png", fullPage: true });

await page.click('[data-material="screen"]');
await page.waitForFunction(() => window.__SALT_LAB__.snapshot().material === "screen" && !document.querySelector("#busy")?.classList.contains("is-visible"), null, {
  timeout: 30000,
});
await setRange("#mip-slider", 2);
await page.click("#oblique-button");
await page.waitForTimeout(800);
await page.click('[data-view-mode="decoded"]');
await page.waitForTimeout(300);
const screen = await snapshot();
await page.screenshot({ path: "artifacts/validate-screen-decoded-mip2.png", fullPage: true });

await page.click("#reload-button");
await page.waitForFunction(() => window.__SALT_LAB__.snapshot().reload !== null, null, { timeout: 10000 });
const reload = (await snapshot()).reload;

await page.click("#export-button");
await page.waitForTimeout(1200);

await page.click(".toggle-row");
await page.waitForTimeout(400);
const cpuFallback = await snapshot();

await page.click('[data-codec="bc1"]');
await page.waitForFunction(
  () => {
    const state = window.__SALT_LAB__.snapshot();
    return state.codec === "bc1" && state.stats.totalCompressedBytes < 2_500_000;
  },
  null,
  { timeout: 30000 },
);
await waitForReady();
await page.click('[data-material="rust"]');
await page.waitForTimeout(700);
await waitForReady();
await page.screenshot({ path: "artifacts/validate-rust-bc1-cpu.png", fullPage: true });
await page.click("#export-button");
await page.waitForTimeout(1200);
const final = await snapshot();

const panelFit = await page.evaluate(() => {
  const panel = document.querySelector(".control-panel");
  const exportSection = document.querySelector(".export-section");
  return {
    clientHeight: panel?.clientHeight,
    scrollHeight: panel?.scrollHeight,
    exportBottom: exportSection ? exportSection.getBoundingClientRect().bottom : 0,
  };
});

console.log(
  JSON.stringify(
    { initial, bc3, mip4, mip8, screen, reload, cpuFallback, final, downloads, panelFit, errors },
    null,
    2,
  ),
);
await browser.close();
