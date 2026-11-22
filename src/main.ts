import './style.css';
import { MineApp, type HudStats } from './app/MineApp.js';
import type { ViewMode } from './render/Renderer.js';

const canvas = document.querySelector<HTMLCanvasElement>('#gl-canvas');
if (canvas === null) {
  throw new Error('#gl-canvas not found');
}

const app = new MineApp(canvas);
(window as unknown as { mineApp: MineApp }).mineApp = app;

const statEls = {
  total: document.querySelector('#stat-total')!,
  leaves: document.querySelector('#stat-leaves')!,
  faces: document.querySelector('#stat-faces')!,
  batches: document.querySelector('#stat-batches')!,
  gpu: document.querySelector('#stat-gpu')!,
  reuse: document.querySelector('#stat-reuse')!,
  depth: document.querySelector('#stat-depth')!,
  pick: document.querySelector('#stat-pick')!,
};

app.setStatsListener((stats: HudStats) => {
  statEls.total.textContent = stats.totalNodes.toLocaleString();
  statEls.leaves.textContent = stats.leafNodes.toLocaleString();
  statEls.faces.textContent = stats.faces.toLocaleString();
  statEls.batches.textContent = stats.batches.toLocaleString();
  statEls.gpu.textContent = stats.gpuLeaves.toLocaleString();
  statEls.reuse.textContent = stats.bufferReuses.toLocaleString();
  statEls.depth.textContent = stats.cameraY.toFixed(1);
  statEls.pick.textContent = stats.pick;
});

document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    app.setMode(button.dataset.mode as ViewMode);
  });
});

document.querySelector('#toggle-boxes')?.addEventListener('click', () => {
  app.setLeafBoxes(!app.leafBoxesVisible);
});

document.querySelector('#toggle-descend')?.addEventListener('click', () => {
  app.camera.autoDescend = !app.camera.autoDescend;
});

const faceBudget = document.querySelector<HTMLInputElement>('#face-budget');
faceBudget?.addEventListener('input', () => {
  app.setMaxNodeFaces(Number(faceBudget.value));
  document.querySelector('#face-budget-value')!.textContent = faceBudget.value;
});

const neighborDiff = document.querySelector<HTMLInputElement>('#neighbor-diff');
neighborDiff?.addEventListener('input', () => {
  app.setNeighborDiff(Number(neighborDiff.value));
  document.querySelector('#neighbor-diff-value')!.textContent = neighborDiff.value;
});

const lodScale = document.querySelector<HTMLInputElement>('#lod-scale');
lodScale?.addEventListener('input', () => {
  app.setLodScale(Number(lodScale.value));
  document.querySelector('#lod-scale-value')!.textContent = lodScale.value;
});

app.start();
