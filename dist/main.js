import { StationHud } from "./hud.js";
import { StationRenderer, } from "./renderer.js";
const params = new URLSearchParams(window.location.search);
const initialMode = params.get("mode") === "sync" ? "sync" : "async";
const requestedLoad = Number(params.get("load") ?? "1");
const initialLoad = [1, 4, 12, 24].includes(requestedLoad)
    ? requestedLoad
    : 1;
const initialFrame = Number(params.get("frame") ?? "138");
const initialPaused = params.get("paused") === "1";
const canvas = document.getElementById("gpu");
const boot = document.getElementById("boot");
const bootDetail = document.getElementById("boot-detail");
const bootError = document.getElementById("boot-error");
if (!(canvas instanceof HTMLCanvasElement) || !boot || !bootDetail || !bootError) {
    throw new Error("页面缺少画布或启动状态节点。");
}
const canvasElement = canvas;
const bootElement = boot;
const bootDetailElement = bootDetail;
const bootErrorElement = bootError;
function showBootError(message) {
    bootDetailElement.textContent = "WebGPU 初始化中止";
    bootErrorElement.hidden = false;
    bootErrorElement.textContent = message;
}
async function main() {
    const hud = new StationHud();
    let renderer;
    try {
        bootDetailElement.textContent = "请求 WebGPU 适配器 · 编译 WGSL 通道";
        renderer = await StationRenderer.create(canvasElement, {
            initialFrame: Number.isFinite(initialFrame) ? Math.max(0, initialFrame) : 138,
            paused: initialPaused,
            mode: initialMode,
            load: initialLoad,
        });
        renderer.onDeviceLost = (message) => {
            hud.showError(message);
        };
        hud.setActiveMode(initialMode);
        hud.setPaused(initialPaused);
        for (const button of hud.loadButtons) {
            button.classList.toggle("active", Number(button.dataset.load) === initialLoad);
        }
        bootDetailElement.textContent = "构建首帧可见性列表 · 写入显式围栏";
        await renderer.start();
        window.setTimeout(() => bootElement.classList.add("hidden"), 220);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(error);
        showBootError(message);
        return;
    }
    hud.bind({
        setMode: (mode) => {
            void renderer.setMode(mode).catch((error) => {
                hud.showError(error instanceof Error ? error.message : String(error));
            });
        },
        setLoad: (load) => {
            renderer.setLoad(load);
        },
        togglePause: () => {
            const nextPaused = !renderer.getDiagnostics().paused;
            renderer.setPaused(nextPaused);
            hud.setPaused(nextPaused);
        },
        runAudit: () => {
            if (hud.isBusy) {
                return;
            }
            hud.setAuditBusy(true);
            void renderer
                .runAudit()
                .then((result) => {
                hud.showAudit(result);
            })
                .catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                hud.showError(message);
                hud.verifyDialog.hidden = true;
            })
                .finally(() => {
                hud.setAuditBusy(false);
            });
        },
    });
    window.setInterval(() => {
        hud.update(renderer.getDiagnostics());
    }, 80);
    const debugApi = {
        diagnostics: () => renderer.getDiagnostics(),
        setMode: (mode) => renderer.setMode(mode),
        setLoad: (load) => renderer.setLoad(load),
        setPaused: (paused) => renderer.setPaused(paused),
        seekToFrame: (frame) => renderer.seekToFrame(frame),
        runAudit: () => renderer.runAudit(),
        captureLatest: () => renderer.captureLatest(),
        renderer,
    };
    window.__dispatch = debugApi;
}
void main();
//# sourceMappingURL=main.js.map