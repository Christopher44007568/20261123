// Headless screenshot harness: serves the repo, loads the testbed with URL
// params, waits for frames, saves canvas screenshots to artifacts/.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { chromium } from "playwright";

const root = new URL("..", import.meta.url).pathname;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".map": "application/json" };

const server = http.createServer(async (req, res) => {
  try {
    const path = join(root, req.url === "/" ? "index.html" : decodeURIComponent(req.url.split("?")[0]));
    const data = await readFile(path);
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("nf");
  }
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const shots = JSON.parse(process.argv[2] ?? "[]");
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("console", m => { if (m.type() === "error") console.error("[console]", m.text()); });
page.on("pageerror", e => console.error("[pageerror]", e.message));

for (const s of shots) {
  await page.goto(`http://127.0.0.1:${port}/index.html?${s.q}`);
  await page.waitForFunction(() => window.__frame > 8, null, { timeout: 60000 });
  await page.screenshot({ path: join(root, "artifacts", s.name + ".png"), timeout: 120000 });
  const probe = await page.evaluate(() => window.__probe ?? null);
  console.log("shot", s.name, probe ? JSON.stringify(probe) : "");
}
await browser.close();
server.close();
