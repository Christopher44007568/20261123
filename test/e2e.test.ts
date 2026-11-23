import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import puppeteer from 'puppeteer';

const root = process.cwd();
const port = 8123;
const chromePath = process.env.CHROME_PATH ?? '/tmp/chrome-shell-v2/chrome-headless-shell-linux64/chrome-headless-shell';

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

async function withServer(): Promise<() => Promise<void>> {
  const server = createServer(async (req, res) => {
    const path = req.url?.split('?')[0] ?? '/';
    const file = join(root, path === '/' ? 'index.html' : path);
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(port, resolve));
  return () => new Promise((resolve) => server.close(() => resolve()));
}

test('WebGL2 端到端：三种视图、深度遮挡、曝光能量、色散自检全部通过', { timeout: 60000 }, async () => {
  const stop = await withServer();
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--use-gl=angle',
      '--use-angle=gl',
      '--enable-unsafe-swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--window-size=960,640',
    ],
  });
  try {
    const page = await browser.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(String(error)));

    await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#stage');
    await new Promise((resolve) => setTimeout(resolve, 800));

    const webglInfo = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');
      if (!gl) return null;
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        renderer: debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : 'unknown',
        float: Boolean(gl.getExtension('EXT_color_buffer_float')),
      };
    });
    assert.ok(webglInfo, 'WebGL2 context unavailable');
    assert.ok(webglInfo.float, 'EXT_color_buffer_float unavailable');

    await page.click('#runTest');
    await page.waitForFunction(
      () => !document.querySelector<HTMLButtonElement>('#runTest')?.disabled,
      { timeout: 20000 },
    );
    const output = await page.$eval('#testOutput', (el) => el.textContent ?? '');
    assert.ok(output.includes('总体：通过'), `self-test failed:\n${output}`);

    for (const mode of ['0', '1', '2']) {
      await page.click(`[data-mode="${mode}"]`);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await page.screenshot({ path: `artifacts/mode-${mode}.png` });
    }
    await page.screenshot({ path: 'artifacts/physical-mode.png' });

    const errors = consoleErrors.filter((line) => !line.includes('GPU stall'));
    assert.equal(errors.length, 0, `console errors: ${errors.join(' | ')}`);
  } finally {
    await browser.close();
    await stop();
  }
});
