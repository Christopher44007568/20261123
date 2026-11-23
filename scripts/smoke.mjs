import { chromium } from "playwright";

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
const messages = [];
page.on("console", (message) => messages.push(`${message.type()}: ${message.text()}`));
page.on("pageerror", (error) => messages.push(`pageerror: ${error.stack || error.message}`));
await page.goto("http://localhost:4174/", { waitUntil: "networkidle" });
await page.waitForFunction(() => {
  const api = window.__SALT_LAB__;
  return api && api.snapshot().mipCount > 0;
}, null, { timeout: 30000 });
await page.waitForTimeout(600);
const snapshot = await page.evaluate(() => window.__SALT_LAB__.snapshot());
console.log(JSON.stringify({ snapshot, messages }, null, 2));
await page.screenshot({ path: "artifacts/smoke-initial.png", fullPage: true });
await browser.close();
