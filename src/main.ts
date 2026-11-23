import { createCamera } from './render/camera.js';
import { createGlContext } from './render/gl.js';
import { FlareMode, Renderer, RenderSettings } from './render/renderer.js';
import { buildScene } from './scene/scene.js';
import { runSelfTest, SelfTestSummary } from './selftest/selftest.js';

const canvasElement = document.getElementById('stage');
if (!(canvasElement instanceof HTMLCanvasElement)) throw new Error('Missing #stage canvas.');
const canvas: HTMLCanvasElement = canvasElement;
const gl = createGlContext(canvas);
const scene = buildScene();
const renderer = new Renderer(gl, scene);
const camera = createCamera();

const settings: RenderSettings = {
  mode: FlareMode.Physical,
  exposure: 1,
  fNumber: 2.8,
  time: 0,
};

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(2, Math.floor(canvas.clientWidth * dpr));
  const height = Math.max(2, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  renderer.resize(width, height);
}
window.addEventListener('resize', resize);

let dragging = false;
let lastX = 0;
let lastY = 0;
canvas.addEventListener('pointerdown', (event) => {
  dragging = true;
  lastX = event.clientX;
  lastY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  camera.yaw -= (event.clientX - lastX) * 0.006;
  camera.pitch = Math.max(-0.15, Math.min(1.25, camera.pitch + (event.clientY - lastY) * 0.006));
  lastX = event.clientX;
  lastY = event.clientY;
});
canvas.addEventListener('pointerup', () => {
  dragging = false;
});
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  camera.distance = Math.max(8, Math.min(55, camera.distance * (1 + Math.sign(event.deltaY) * 0.08)));
}, { passive: false });

const modeButtons = document.querySelectorAll<HTMLButtonElement>('[data-mode]');
modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    settings.mode = Number(button.dataset.mode) as FlareMode;
    modeButtons.forEach((b) => b.classList.toggle('active', b === button));
  });
});

const exposureInput = document.getElementById('exposure') as HTMLInputElement;
const exposureValue = document.getElementById('exposureValue') as HTMLElement;
exposureInput.addEventListener('input', () => {
  settings.exposure = Number(exposureInput.value);
  exposureValue.textContent = settings.exposure.toFixed(2);
});

const focalInput = document.getElementById('focal') as HTMLInputElement;
const focalValue = document.getElementById('focalValue') as HTMLElement;
focalInput.addEventListener('input', () => {
  camera.focalMm = Number(focalInput.value);
  focalValue.textContent = `${camera.focalMm}mm`;
});

const apertureInput = document.getElementById('aperture') as HTMLInputElement;
const apertureValue = document.getElementById('apertureValue') as HTMLElement;
apertureInput.addEventListener('input', () => {
  settings.fNumber = Number(apertureInput.value);
  apertureValue.textContent = `f/${settings.fNumber.toFixed(1)}`;
});

const testButton = document.getElementById('runTest') as HTMLButtonElement;
const testOutput = document.getElementById('testOutput') as HTMLElement;
testButton.addEventListener('click', () => {
  testButton.disabled = true;
  testOutput.textContent = '自检运行中…';
  requestAnimationFrame(() => {
    let summary: SelfTestSummary;
    try {
      summary = runSelfTest(renderer, scene);
    } catch (error) {
      testOutput.textContent = `自检异常：${error instanceof Error ? error.message : String(error)}`;
      testButton.disabled = false;
      return;
    }
    testOutput.innerHTML = summary.results
      .map((r) => `${r.passed ? '✅' : '❌'} ${r.name} — ${r.detail}`)
      .join('<br>') + `<br><strong>总体：${summary.passed ? '通过' : '失败'}</strong>`;
    testButton.disabled = false;
  });
});

const lightList = document.getElementById('lightList') as HTMLElement;

function updateLightList(): void {
  lightList.innerHTML = renderer.lightInfo
    .map((info, i) => {
      const onScreen = Math.abs(info.ndc[0]) <= 1.1 && Math.abs(info.ndc[1]) <= 1.1 && !info.behind;
      const state = info.behind ? '机背' : onScreen ? '画面内' : '画面外';
      return `<div>光源 ${i}：${state}</div>`;
    })
    .join('');
}

let previous = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - previous) / 1000);
  previous = now;
  settings.time += dt;
  resize();
  renderer.render(scene, camera, settings);
  updateLightList();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
