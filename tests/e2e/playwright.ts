import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const shotDir = path.join(root, 'screenshots');
mkdirSync(shotDir, { recursive: true });

interface AppStats {
  totalNodes: number;
  leafNodes: number;
  faces: number;
  batches: number;
  gpuLeaves: number;
  bufferReuses: number;
  cameraY: number;
  pick: string;
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  await page.goto('http://127.0.0.1:4173/');
  await page.waitForFunction(() => (window as unknown as { mineApp?: object }).mineApp !== undefined);
  await page.waitForTimeout(800);

  const readStats = async (): Promise<AppStats> =>
    page.evaluate(() => {
      const text = (id: string) => document.querySelector(id)?.textContent ?? '';
      return {
        totalNodes: Number(text('#stat-total').replace(/,/g, '')),
        leafNodes: Number(text('#stat-leaves').replace(/,/g, '')),
        faces: Number(text('#stat-faces').replace(/,/g, '')),
        batches: Number(text('#stat-batches').replace(/,/g, '')),
        gpuLeaves: Number(text('#stat-gpu').replace(/,/g, '')),
        bufferReuses: Number(text('#stat-reuse').replace(/,/g, '')),
        cameraY: Number(text('#stat-depth')),
        pick: text('#stat-pick'),
      };
    });

  const glOk = await page.evaluate(() => {
    const canvas = document.querySelector('#gl-canvas') as HTMLCanvasElement;
    return canvas.getContext('webgl2') !== null;
  });
  if (!glOk) {
    throw new Error('WebGL2 context unavailable in headless Chromium');
  }

  // Screenshot 1: surface level, final shading.
  await page.evaluate(() => {
    const app = (window as unknown as { mineApp: { setMode: (m: string) => void } }).mineApp;
    app.setMode('shaded');
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shotDir, '01-surface-shaded.png') });

  // Screenshot 2: LOD color blocks across a transition, with leaf boxes.
  await page.evaluate(() => {
    const app = (window as unknown as {
      mineApp: { setMode: (m: string) => void; setLeafBoxes: (v: boolean) => void };
    }).mineApp;
    app.setMode('lod');
    app.setLeafBoxes(true);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shotDir, '02-lod-color-blocks.png') });

  // Screenshot 3: wireframe.
  await page.evaluate(() => {
    const app = (window as unknown as { mineApp: { setMode: (m: string) => void } }).mineApp;
    app.setMode('wireframe');
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shotDir, '03-wireframe.png') });
  await page.evaluate(() => {
    const app = (window as unknown as {
      mineApp: { setLeafBoxes: (v: boolean) => void };
    }).mineApp;
    app.setLeafBoxes(false);
  });

  // Back to shaded for the descent.
  await page.evaluate(() => {
    const app = (window as unknown as {
      mineApp: {
        setMode: (m: string) => void;
        setLeafBoxes: (v: boolean) => void;
        camera: {
          autoDescend: boolean;
          yaw: number;
          pitch: number;
          eye: { x: number; y: number; z: number };
        };
      };
    }).mineApp;
    app.setMode('shaded');
    app.setLeafBoxes(false);
    app.camera.eye.x = 64;
    app.camera.eye.z = 64;
    app.camera.eye.y = 100;
    app.camera.autoDescend = true;
    app.camera.yaw = Math.PI * 0.25;
    app.camera.pitch = -0.2;
  });

  // Capture LOD boundary screenshots while descending.
  const targetHeights = [88, 70, 50, 30, 12];
  let shotIndex = 4;
  for (const targetY of targetHeights) {
    await page.waitForFunction((y) => {
      const app = (window as unknown as {
        mineApp: { camera: { eye: { y: number } } };
      }).mineApp;
      return app.camera.eye.y <= y;
    }, targetY);
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(shotDir, `0${shotIndex}-descent-y${targetY}.png`),
    });
    shotIndex += 1;
  }

  const bottomStats = await readStats();

  // Picking stability: pick along the camera ray under several LOD settings.
  const pickCheck = await page.evaluate(() => {
    const app = (window as unknown as {
      mineApp: {
        pickFromCameraRay: () => { voxel: { x: number; y: number; z: number } } | null;
        setLodScale: (v: number) => void;
        setMaxNodeFaces: (v: number) => void;
        rebuildLod: () => void;
      };
    }).mineApp;
    const first = app.pickFromCameraRay();
    if (first === null) {
      return { ok: false, reason: 'no pick at bottom' };
    }
    const expected = first.voxel;
    const configs = [
      { scale: 1.0, faces: 256 },
      { scale: 2.4, faces: 512 },
      { scale: 5.5, faces: 2048 },
    ];
    for (const cfg of configs) {
      app.setLodScale(cfg.scale);
      app.setMaxNodeFaces(cfg.faces);
      app.rebuildLod();
      const again = app.pickFromCameraRay();
      if (again === null ||
        again.voxel.x !== expected.x ||
        again.voxel.y !== expected.y ||
        again.voxel.z !== expected.z) {
        return { ok: false, reason: 'pick changed across LOD', expected, got: again?.voxel };
      }
    }
    return { ok: true, expected };
  });

  // Engine-side invariants inside the browser runtime.
  const invariants = await page.evaluate(() => {
    const app = (window as unknown as {
      mineApp: {
        octree: { validateNeighborDiff: (d: number) => unknown[] };
        lod: { maxNeighborLodDiff: number };
        meshManager: { poolStats: { reuses: number } };
      };
    }).mineApp;
    const violations = app.octree.validateNeighborDiff(app.lod.maxNeighborLodDiff);
    return {
      neighborViolations: violations.length,
      bufferReuses: app.meshManager.poolStats.reuses,
    };
  });

  await page.screenshot({ path: path.join(shotDir, '09-bottom-final.png') });
  await browser.close();

  const report = {
    glOk,
    bottomStats,
    pickCheck,
    invariants,
    pageErrors: errors,
  };
  writeFileSync(path.join(shotDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  if (errors.length > 0) {
    throw new Error(`page errors: ${errors.join(' | ')}`);
  }
  if (!pickCheck.ok || invariants.neighborViolations !== 0 || bottomStats.faces === 0) {
    throw new Error('E2E invariant failure');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
