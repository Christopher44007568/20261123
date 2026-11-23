import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

const waitReady = () =>
  page.waitForFunction(
    () => window.__SALT_LAB__?.snapshot().mipCount > 0 && !document.querySelector("#busy")?.classList.contains("is-visible"),
    null,
    { timeout: 30000 },
  );
const setRange = (selector, value) =>
  page.locator(selector).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
const snap = () => page.evaluate(() => window.__SALT_LAB__.snapshot());

await page.goto("http://localhost:4174/", { waitUntil: "networkidle" });
await waitReady();

const materialShots = {};
for (const material of ["brick", "tile", "rust", "screen"]) {
  await page.click(`[data-material="${material}"]`);
  await waitReady();
  await page.waitForTimeout(250);
  materialShots[material] = await snap();
  await page.screenshot({ path: `artifacts/final-${material}-bc1.png`, fullPage: true });
}

await page.click('[data-material="brick"]');
await waitReady();
await setRange("#mip-slider", 3);
await page.click("#oblique-button");
await page.click('[data-view-mode="decoded"]');
await page.waitForTimeout(700);
await page.screenshot({ path: "artifacts/final-brick-bc1-mip3-oblique.png", fullPage: true });

await page.click('[data-codec="bc3"]');
await page.waitForFunction(() => window.__SALT_LAB__.snapshot().stats.totalCompressedBytes > 3_000_000, null, {
  timeout: 30000,
});
await waitReady();
await page.waitForTimeout(650);
await page.screenshot({ path: "artifacts/final-brick-bc3-mip3-oblique.png", fullPage: true });

await page.click('[data-material="screen"]');
await waitReady();
await setRange("#mip-slider", 3);
await page.waitForTimeout(600);
await page.screenshot({ path: "artifacts/final-screen-bc3-mip3-oblique.png", fullPage: true });

await page.click('[data-codec="bc1"]');
await page.waitForFunction(() => window.__SALT_LAB__.snapshot().stats.totalCompressedBytes < 2_500_000, null, {
  timeout: 30000,
});
await waitReady();
await page.waitForTimeout(650);
await page.screenshot({ path: "artifacts/final-screen-bc1-mip3-oblique.png", fullPage: true });

await page.click('[data-view-mode="heat"]');
await page.waitForTimeout(400);
await page.screenshot({ path: "artifacts/final-screen-bc1-mip3-heat.png", fullPage: true });

await page.click("#reload-button");
await page.waitForFunction(() => window.__SALT_LAB__.snapshot().reload !== null, null, { timeout: 10000 });
await page.waitForTimeout(500);
const reload = (await snap()).reload;
await page.screenshot({ path: "artifacts/final-reloaded.png", fullPage: true });

await page.click('[data-material="tile"]');
await waitReady();
await page.click("#oblique-button");
await setRange("#scale-slider", 6.2);
await setRange("#wear-slider", 0.82);
await setRange("#salt-slider", 0.84);
await page.waitForTimeout(1400);
await waitReady();
await page.screenshot({ path: "artifacts/final-tile-extreme.png", fullPage: true });

const final = await snap();
const fit = await page.evaluate(() => {
  const panel = document.querySelector(".control-panel");
  return { clientHeight: panel?.clientHeight, scrollHeight: panel?.scrollHeight };
});
console.log(JSON.stringify({ materialShots, reload, final, fit, errors }, null, 2));
await browser.close();
