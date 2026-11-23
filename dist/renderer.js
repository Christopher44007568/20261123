import { cameraAtFrame } from "./math.js";
import { LIGHT_BIN_COLUMNS, LIGHT_BIN_ROWS, MAX_INSTANCES, MAX_LIGHTS, buildScene, } from "./scene.js";
import { BACKGROUND_WGSL, BEAM_WGSL, COMPUTE_WGSL, HALO_WGSL, OBJECT_WGSL, } from "./shaders.js";
import { StageTimer } from "./timer.js";
const SLOT_COUNT = 3;
const UNIFORM_SIZE = 256;
const LIGHT_SIZE = MAX_LIGHTS * 32;
const BIN_SIZE = LIGHT_BIN_COLUMNS * LIGHT_BIN_ROWS * 32;
const VISIBLE_SIZE = MAX_INSTANCES * 4;
const FENCE_WORD = 0x51a7c0de;
function createModeStats() {
    return {
        waits: [],
        tails: [],
        backpressure: 0,
        overwriteBlocks: 0,
        computes: 0,
        renders: 0,
    };
}
function p95(values) {
    if (values.length === 0) {
        return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return sorted[index] ?? 0;
}
function average(values) {
    if (values.length === 0) {
        return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function appendBounded(target, value, maximum = 120) {
    target.push(value);
    if (target.length > maximum) {
        target.shift();
    }
}
function hashBytes(bytes) {
    let hash = 2166136261;
    for (const byte of bytes) {
        hash ^= byte;
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}
function buildCubeGeometry() {
    const faces = [
        {
            normal: [1, 0, 0],
            corners: [
                [0.5, -0.5, -0.5],
                [0.5, 0.5, -0.5],
                [0.5, 0.5, 0.5],
                [0.5, -0.5, 0.5],
            ],
        },
        {
            normal: [-1, 0, 0],
            corners: [
                [-0.5, -0.5, 0.5],
                [-0.5, 0.5, 0.5],
                [-0.5, 0.5, -0.5],
                [-0.5, -0.5, -0.5],
            ],
        },
        {
            normal: [0, 1, 0],
            corners: [
                [-0.5, 0.5, 0.5],
                [0.5, 0.5, 0.5],
                [0.5, 0.5, -0.5],
                [-0.5, 0.5, -0.5],
            ],
        },
        {
            normal: [0, -1, 0],
            corners: [
                [-0.5, -0.5, -0.5],
                [0.5, -0.5, -0.5],
                [0.5, -0.5, 0.5],
                [-0.5, -0.5, 0.5],
            ],
        },
        {
            normal: [0, 0, 1],
            corners: [
                [-0.5, -0.5, 0.5],
                [0.5, -0.5, 0.5],
                [0.5, 0.5, 0.5],
                [-0.5, 0.5, 0.5],
            ],
        },
        {
            normal: [0, 0, -1],
            corners: [
                [0.5, -0.5, -0.5],
                [-0.5, -0.5, -0.5],
                [-0.5, 0.5, -0.5],
                [0.5, 0.5, -0.5],
            ],
        },
    ];
    const vertices = [];
    const indices = [];
    faces.forEach((face, faceIndex) => {
        for (const corner of face.corners) {
            vertices.push(corner[0], corner[1], corner[2], face.normal[0], face.normal[1], face.normal[2]);
        }
        const base = faceIndex * 4;
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) };
}
export class StationRenderer {
    canvas;
    adapterName;
    timestampsEnabled;
    onDeviceLost = null;
    context;
    device;
    format;
    scene;
    instanceBuffer;
    sourceLightBuffer;
    cubeVertexBuffer;
    cubeIndexBuffer;
    fenceSource;
    slots = [];
    backgroundPipeline;
    objectPipeline;
    haloPipeline;
    beamPipeline;
    resetPipeline;
    lightPipeline;
    cullPipeline;
    gatherPipeline;
    binPipeline;
    computeTimer;
    renderTimer;
    depthTexture = null;
    depthWidth = 0;
    depthHeight = 0;
    latestSlot = null;
    lastPresentedFrame = -1;
    lastScheduledFrame = -1;
    computeInFlight = false;
    renderInFlight = false;
    syncBusy = false;
    modeValue;
    loadValue;
    pausedValue;
    pendingMode = null;
    pendingReset = false;
    resetting = false;
    priming = false;
    started = false;
    disposed = false;
    animationHandle = 0;
    playheadSeconds;
    playOriginSeconds;
    playOriginNow;
    computeMsValue = 0;
    renderMsValue = 0;
    computeWaitValue = 0;
    frameTimes = [];
    fpsValue = 0;
    fenceChecks = 0;
    recycleCount = 0;
    guardViolationCount = 0;
    stats = {
        sync: createModeStats(),
        async: createModeStats(),
    };
    statusOverride = null;
    statusTextOverride = "";
    statusDetailOverride = "";
    auditRunning = false;
    auditGuardHeld = false;
    constructor(canvas, context, device, format, adapterName, timestampsEnabled, scene, instanceBuffer, sourceLightBuffer, cubeVertexBuffer, cubeIndexBuffer, fenceSource, pipelines, slots, options) {
        this.canvas = canvas;
        this.context = context;
        this.device = device;
        this.format = format;
        this.adapterName = adapterName;
        this.timestampsEnabled = timestampsEnabled;
        this.scene = scene;
        this.instanceBuffer = instanceBuffer;
        this.sourceLightBuffer = sourceLightBuffer;
        this.cubeVertexBuffer = cubeVertexBuffer;
        this.cubeIndexBuffer = cubeIndexBuffer;
        this.fenceSource = fenceSource;
        this.backgroundPipeline = pipelines.background;
        this.objectPipeline = pipelines.object;
        this.haloPipeline = pipelines.halo;
        this.beamPipeline = pipelines.beam;
        this.resetPipeline = pipelines.reset;
        this.lightPipeline = pipelines.light;
        this.cullPipeline = pipelines.cull;
        this.gatherPipeline = pipelines.gather;
        this.binPipeline = pipelines.bins;
        this.slots = slots;
        this.modeValue = options.mode ?? "async";
        this.loadValue = options.load ?? 1;
        this.pausedValue = options.paused ?? false;
        this.playheadSeconds = (options.initialFrame ?? 138) / 60;
        this.playOriginSeconds = this.playheadSeconds;
        this.playOriginNow = performance.now();
        this.computeTimer = new StageTimer(device, timestampsEnabled, (value) => {
            this.computeMsValue = this.computeMsValue === 0 ? value : this.computeMsValue * 0.85 + value * 0.15;
        });
        this.renderTimer = new StageTimer(device, timestampsEnabled, (value) => {
            this.renderMsValue = this.renderMsValue === 0 ? value : this.renderMsValue * 0.85 + value * 0.15;
        });
        this.setupDeviceLoss();
    }
    static async create(canvas, options = {}) {
        if (!navigator.gpu) {
            throw new Error("当前浏览器未启用 WebGPU。请使用支持 WebGPU 的 Chrome / Edge，并通过 localhost 打开。");
        }
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
        if (!adapter) {
            throw new Error("未找到可用的 WebGPU 适配器。");
        }
        const requiredFeatures = [];
        if (adapter.features.has("timestamp-query")) {
            requiredFeatures.push("timestamp-query");
        }
        const device = await adapter.requestDevice({ requiredFeatures });
        const context = canvas.getContext("webgpu");
        if (!context) {
            throw new Error("无法创建 WebGPU 画布上下文。");
        }
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({
            device,
            format,
            alphaMode: "opaque",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
        const scene = buildScene();
        const instanceBuffer = device.createBuffer({
            label: "static-instance-sources",
            size: Math.ceil((scene.instanceCount * 48) / 16) * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(instanceBuffer, 0, scene.instances);
        const sourceLightBuffer = device.createBuffer({
            label: "source-lights",
            size: Math.ceil((scene.lightCount * 48) / 16) * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(sourceLightBuffer, 0, scene.sourceLights);
        const cube = buildCubeGeometry();
        const cubeVertexBuffer = device.createBuffer({
            label: "cube-vertices",
            size: cube.vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(cubeVertexBuffer, 0, cube.vertices);
        const cubeIndexBuffer = device.createBuffer({
            label: "cube-indices",
            size: cube.indices.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(cubeIndexBuffer, 0, cube.indices);
        const fenceSource = device.createBuffer({
            label: "fence-word",
            size: 4,
            usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(fenceSource, 0, new Uint32Array([FENCE_WORD]));
        const [backgroundModule, objectModule, haloModule, beamModule, computeModule] = await Promise.all([
            createShaderModule(device, "background", BACKGROUND_WGSL),
            createShaderModule(device, "objects", OBJECT_WGSL),
            createShaderModule(device, "light-halos", HALO_WGSL),
            createShaderModule(device, "light-beams", BEAM_WGSL),
            createShaderModule(device, "light-compute", COMPUTE_WGSL),
        ]);
        const backgroundLayout = device.createBindGroupLayout({
            label: "background-layout",
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: "uniform" },
                },
            ],
        });
        const renderLayout = device.createBindGroupLayout({
            label: "snapshot-render-layout",
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: "uniform" },
                },
                { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
                {
                    binding: 3,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: "read-only-storage" },
                },
                { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
                { binding: 5, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
            ],
        });
        const computeLayout = device.createBindGroupLayout({
            label: "snapshot-compute-layout",
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
                { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
                { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
            ],
        });
        const backgroundPipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [backgroundLayout],
        });
        const renderPipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [renderLayout],
        });
        const computePipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [computeLayout],
        });
        const backgroundPipeline = device.createRenderPipeline({
            label: "night-sky",
            layout: backgroundPipelineLayout,
            vertex: { module: backgroundModule, entryPoint: "vertexMain" },
            fragment: { module: backgroundModule, entryPoint: "fragmentMain", targets: [{ format }] },
            primitive: { topology: "triangle-list" },
            depthStencil: {
                format: "depth24plus",
                depthWriteEnabled: false,
                depthCompare: "always",
            },
        });
        const objectPipeline = device.createRenderPipeline({
            label: "lit-industrial-objects",
            layout: renderPipelineLayout,
            vertex: {
                module: objectModule,
                entryPoint: "vertexMain",
                buffers: [
                    {
                        arrayStride: 24,
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: "float32x3" },
                            { shaderLocation: 1, offset: 12, format: "float32x3" },
                        ],
                    },
                ],
            },
            fragment: { module: objectModule, entryPoint: "fragmentMain", targets: [{ format }] },
            primitive: { topology: "triangle-list", frontFace: "ccw", cullMode: "back" },
            depthStencil: {
                format: "depth24plus",
                depthWriteEnabled: true,
                depthCompare: "less",
            },
        });
        const haloPipeline = device.createRenderPipeline({
            label: "light-halos",
            layout: renderPipelineLayout,
            vertex: { module: haloModule, entryPoint: "vertexMain" },
            fragment: {
                module: haloModule,
                entryPoint: "fragmentMain",
                targets: [
                    {
                        format,
                        blend: {
                            color: { srcFactor: "one", dstFactor: "one", operation: "add" },
                            alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
                        },
                    },
                ],
            },
            primitive: { topology: "triangle-list", cullMode: "none" },
            depthStencil: {
                format: "depth24plus",
                depthWriteEnabled: false,
                depthCompare: "less-equal",
            },
        });
        const beamPipeline = device.createRenderPipeline({
            label: "mobile-light-beams",
            layout: renderPipelineLayout,
            vertex: { module: beamModule, entryPoint: "vertexMain" },
            fragment: {
                module: beamModule,
                entryPoint: "fragmentMain",
                targets: [
                    {
                        format,
                        blend: {
                            color: { srcFactor: "one", dstFactor: "one", operation: "add" },
                            alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
                        },
                    },
                ],
            },
            primitive: { topology: "triangle-list", cullMode: "none" },
            depthStencil: {
                format: "depth24plus",
                depthWriteEnabled: false,
                depthCompare: "less-equal",
            },
        });
        const resetPipeline = device.createComputePipeline({
            label: "reset-indirect",
            layout: computePipelineLayout,
            compute: { module: computeModule, entryPoint: "resetIndirect" },
        });
        const lightPipeline = device.createComputePipeline({
            label: "generate-lights",
            layout: computePipelineLayout,
            compute: { module: computeModule, entryPoint: "generateLights" },
        });
        const cullPipeline = device.createComputePipeline({
            label: "cull-instances",
            layout: computePipelineLayout,
            compute: { module: computeModule, entryPoint: "cullInstances" },
        });
        const gatherPipeline = device.createComputePipeline({
            label: "gather-visible",
            layout: computePipelineLayout,
            compute: { module: computeModule, entryPoint: "gatherVisible" },
        });
        const binPipeline = device.createComputePipeline({
            label: "build-light-bins",
            layout: computePipelineLayout,
            compute: { module: computeModule, entryPoint: "buildLightBins" },
        });
        const slots = [];
        for (let index = 0; index < SLOT_COUNT; index += 1) {
            slots.push(createSlot(device, index, renderLayout, backgroundLayout, computeLayout, instanceBuffer, sourceLightBuffer));
        }
        return new StationRenderer(canvas, context, device, format, adapter.info.description || adapter.info.device || "WEBGPU ADAPTER", device.features.has("timestamp-query"), scene, instanceBuffer, sourceLightBuffer, cubeVertexBuffer, cubeIndexBuffer, fenceSource, {
            background: backgroundPipeline,
            object: objectPipeline,
            halo: haloPipeline,
            beam: beamPipeline,
            reset: resetPipeline,
            light: lightPipeline,
            cull: cullPipeline,
            gather: gatherPipeline,
            bins: binPipeline,
        }, slots, options);
    }
    async start() {
        if (this.started || this.disposed) {
            return;
        }
        this.playOriginNow = performance.now();
        this.playOriginSeconds = this.playheadSeconds;
        this.resize();
        await this.prime();
        this.started = true;
        this.animationHandle = requestAnimationFrame(this.tick);
    }
    async setMode(mode) {
        if (this.auditRunning) {
            throw new Error("A/B 验证期间不能切换流水线模式。");
        }
        if (mode === this.modeValue || this.pendingMode === mode) {
            return;
        }
        this.pendingMode = mode;
        await this.drainAndApply();
    }
    setLoad(load) {
        if (this.auditRunning) {
            return;
        }
        this.loadValue = load;
    }
    setPaused(paused) {
        if (this.auditRunning) {
            return;
        }
        if (paused === this.pausedValue) {
            return;
        }
        const now = performance.now();
        if (paused) {
            this.playheadSeconds = this.getPlayhead(now);
            this.pausedValue = true;
        }
        else {
            this.playOriginSeconds = this.playheadSeconds;
            this.playOriginNow = now;
            this.pausedValue = false;
        }
    }
    seekToFrame(frameId) {
        if (this.auditRunning) {
            return;
        }
        const seconds = frameId / 60;
        this.playheadSeconds = seconds;
        this.playOriginSeconds = seconds;
        this.playOriginNow = performance.now();
        this.requestReset("SEEK");
    }
    async waitForIdle() {
        while (this.computeInFlight || this.renderInFlight || this.syncBusy) {
            await new Promise((resolve) => setTimeout(resolve, 8));
        }
    }
    async captureLatest() {
        await this.waitForIdle();
        const slot = this.latestSlot;
        if (!slot) {
            throw new Error("尚无有效帧可读回。");
        }
        const captured = await this.submitRender(slot, true);
        return { width: this.canvas.width, height: this.canvas.height, bytes: captured.bytes };
    }
    getDiagnostics() {
        const desired = this.getDesiredFrame(performance.now());
        const latestFrame = this.latestSlot?.frameId ?? -1;
        const staleAge = latestFrame < 0 ? 0 : Math.max(0, desired - latestFrame);
        const modeStats = this.stats[this.modeValue];
        const validSlots = this.slots.filter((slot) => slot.hasValid).length;
        let status = "ready";
        let statusText = this.modeValue === "async" ? "ASYNC PIPELINE" : "SYNC PIPELINE";
        let statusDetail = latestFrame >= 0 ? `SLOT ${String(this.latestSlot?.index ?? 0).padStart(2, "0")} · FENCE VERIFIED` : "等待首帧完成围栏";
        if (this.statusOverride) {
            status = this.statusOverride;
            statusText = this.statusTextOverride || statusText;
            statusDetail = this.statusDetailOverride || statusDetail;
        }
        else if (this.pendingMode || this.pendingReset || this.resetting) {
            status = "draining";
            statusText = "DRAINING FENCES";
            statusDetail = "等待在飞通道结束 · 复用前保护";
        }
        else if (staleAge > 2) {
            status = "stale";
            statusText = "COMPUTE LAGGING";
            statusDetail = `计算落后 ${staleAge} 帧 · 保持上一有效帧 F${String(latestFrame).padStart(3, "0")}`;
        }
        else if (this.pausedValue) {
            statusDetail = `CAMERA HOLD · SLOT ${String(this.latestSlot?.index ?? 0).padStart(2, "0")}`;
        }
        return {
            mode: this.modeValue,
            load: this.loadValue,
            paused: this.pausedValue,
            ready: latestFrame >= 0,
            frameId: latestFrame,
            desiredFrame: desired,
            latestFrame,
            computeMs: this.computeMsValue,
            renderMs: this.renderMsValue,
            computeWaitMs: this.computeWaitValue,
            tailP95Ms: p95(modeStats.tails),
            staleAge,
            backpressure: modeStats.backpressure,
            overwriteBlocks: modeStats.overwriteBlocks,
            fenceChecks: this.fenceChecks,
            recycleCount: this.recycleCount,
            validSlots,
            timestamps: this.timestampsEnabled,
            adapterName: this.adapterName,
            fps: this.fpsValue,
            playbackSeconds: this.getPlayhead(performance.now()) % 18,
            slotStates: this.slots.map((slot) => ({
                index: slot.index,
                phase: this.slotPhase(slot),
                frameId: slot.frameId,
                progress: slot.hasValid || slot.computing ? 1 : 0,
            })),
            status,
            statusText,
            statusDetail,
            stats: this.stats,
        };
    }
    async runAudit() {
        if (this.auditRunning) {
            throw new Error("A/B 验证已在执行。");
        }
        this.auditRunning = true;
        await this.waitForIdle();
        const auditFrames = [0, 246, 522];
        const results = [];
        const guardStart = this.guardViolationCount;
        const blockStart = this.stats[this.modeValue].overwriteBlocks;
        try {
            for (const frame of auditFrames) {
                const syncSlot = this.findFreeSlot(true);
                if (!syncSlot) {
                    throw new Error("验证时没有可用帧槽。");
                }
                const syncStart = performance.now();
                await this.submitCompute(syncSlot, frame, false);
                const syncCapture = await this.submitRender(syncSlot, true);
                const syncMs = performance.now() - syncStart;
                const asyncSlot = this.slots.find((candidate) => candidate !== syncSlot && !candidate.computing && !candidate.rendering);
                if (!asyncSlot) {
                    throw new Error("验证时缺少第二个可用帧槽。");
                }
                const asyncStart = performance.now();
                const computePromise = this.submitCompute(asyncSlot, frame, false);
                const heldDuringCompute = asyncSlot.computing && !asyncSlot.hasValid && this.findFreeSlot(true) !== asyncSlot;
                const intermediateCapture = await this.submitRender(syncSlot, true);
                const computed = await computePromise;
                if (!computed) {
                    throw new Error("异步验证计算未完成。");
                }
                const asyncCaptureResult = await this.submitRender(asyncSlot, true);
                const asyncMs = performance.now() - asyncStart;
                this.auditGuardHeld =
                    (this.auditGuardHeld || results.length === 0) && heldDuringCompute;
                results.push({
                    frame,
                    syncHash: syncCapture.hash,
                    asyncHash: asyncCaptureResult.hash,
                    intermediateHash: intermediateCapture.hash,
                    match: syncCapture.hash === asyncCaptureResult.hash,
                    intermediateMatch: syncCapture.hash === intermediateCapture.hash,
                    syncMs,
                    asyncMs,
                    guardHeld: heldDuringCompute,
                });
            }
        }
        finally {
            this.auditRunning = false;
            this.requestReset("AUDIT COMPLETE");
        }
        return {
            passed: results.every((result) => result.match && result.intermediateMatch && result.guardHeld) &&
                this.guardViolationCount === guardStart &&
                this.stats[this.modeValue].overwriteBlocks === blockStart,
            frames: results,
            overwriteBlocks: this.stats[this.modeValue].overwriteBlocks,
            fenceChecks: this.fenceChecks,
        };
    }
    tick = (now) => {
        if (this.disposed) {
            return;
        }
        this.resizeIfNeeded();
        this.updateFps(now);
        this.maybeApplyPending();
        if (this.started && !this.resetting && !this.priming && !this.auditRunning) {
            if (this.modeValue === "async") {
                this.asyncTick(now);
            }
            else {
                void this.syncTick(now);
            }
        }
        this.animationHandle = requestAnimationFrame(this.tick);
    };
    getPlayhead(now) {
        if (this.pausedValue) {
            return this.playheadSeconds;
        }
        return this.playOriginSeconds + Math.max(0, now - this.playOriginNow) / 1000;
    }
    getDesiredFrame(now = performance.now()) {
        return Math.floor(this.getPlayhead(now) * 60 + 0.0001);
    }
    resizeIfNeeded() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
        const height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
        if (width === this.canvas.width && height === this.canvas.height) {
            return;
        }
        this.canvas.width = width;
        this.canvas.height = height;
        this.context.configure({
            device: this.device,
            format: this.format,
            alphaMode: "opaque",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
        this.rebuildDepth(width, height);
        if (this.started) {
            this.pendingReset = true;
        }
    }
    resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
        const height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
        this.canvas.width = width;
        this.canvas.height = height;
        this.context.configure({
            device: this.device,
            format: this.format,
            alphaMode: "opaque",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
        this.rebuildDepth(width, height);
    }
    rebuildDepth(width, height) {
        if (width === this.depthWidth && height === this.depthHeight && this.depthTexture) {
            return;
        }
        this.depthTexture?.destroy();
        this.depthTexture = this.device.createTexture({
            label: "station-depth",
            size: [width, height, 1],
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.depthWidth = width;
        this.depthHeight = height;
    }
    updateFps(now) {
        while (this.frameTimes.length > 0 && (this.frameTimes[0] ?? 0) < now - 1000) {
            this.frameTimes.shift();
        }
        this.fpsValue = this.frameTimes.length;
    }
    requestReset(reason) {
        this.pendingReset = true;
        this.statusOverride = "draining";
        this.statusTextOverride = "DRAINING FENCES";
        this.statusDetailOverride = `${reason} · 等待帧槽释放`;
    }
    async drainAndApply() {
        if (this.resetting) {
            return;
        }
        this.resetting = true;
        this.statusOverride = "draining";
        this.statusTextOverride = "DRAINING FENCES";
        this.statusDetailOverride = "模式切换前等待在飞计算与渲染";
        try {
            while (this.computeInFlight || this.renderInFlight || this.syncBusy) {
                await new Promise((resolve) => setTimeout(resolve, 6));
            }
            this.applyPending();
        }
        finally {
            this.resetting = false;
        }
    }
    maybeApplyPending() {
        if ((!this.pendingMode && !this.pendingReset) || this.resetting) {
            return;
        }
        if (this.computeInFlight || this.renderInFlight || this.syncBusy || this.auditRunning) {
            return;
        }
        this.resetting = true;
        try {
            this.applyPending();
        }
        finally {
            this.resetting = false;
        }
    }
    applyPending() {
        if (this.pendingMode) {
            this.modeValue = this.pendingMode;
            this.pendingMode = null;
        }
        this.pendingReset = false;
        this.statusOverride = null;
        this.statusTextOverride = "";
        this.statusDetailOverride = "";
        for (const slot of this.slots) {
            slot.hasValid = false;
            slot.computing = false;
            slot.rendering = false;
            slot.frameId = -1;
        }
        this.latestSlot = null;
        this.lastPresentedFrame = -1;
        this.lastScheduledFrame = -1;
        this.computeWaitValue = 0;
        this.computeMsValue = 0;
        this.renderMsValue = 0;
        if (this.started) {
            void this.prime();
        }
    }
    async prime() {
        if (this.priming || this.disposed) {
            return;
        }
        this.priming = true;
        try {
            const slot = this.findFreeSlot(true);
            if (!slot) {
                throw new Error("没有可用帧槽用于首帧计算。");
            }
            await this.submitCompute(slot, this.getDesiredFrame(), true);
        }
        catch (error) {
            this.reportError(error);
        }
        finally {
            this.priming = false;
        }
    }
    findFreeSlot(includeLatest = false) {
        for (const slot of this.slots) {
            if (slot.computing || slot.rendering) {
                continue;
            }
            if (!includeLatest && slot === this.latestSlot) {
                continue;
            }
            return slot;
        }
        return null;
    }
    slotPhase(slot) {
        if (slot.computing) {
            return "computing";
        }
        if (slot.rendering) {
            return "rendering";
        }
        if (slot === this.latestSlot && this.getDesiredFrame() - slot.frameId > 2) {
            return "held";
        }
        if (slot.hasValid) {
            return "ready";
        }
        return "free";
    }
    asyncTick(now) {
        const desired = this.getDesiredFrame(now);
        const latest = this.latestSlot;
        if (!this.computeInFlight) {
            const canHold = this.pausedValue && latest !== null && latest.frameId >= desired;
            if (canHold) {
                return;
            }
            const slot = this.findFreeSlot(false);
            if (!slot) {
                this.stats.async.overwriteBlocks += 1;
                return;
            }
            let target = Math.max(desired, this.lastScheduledFrame + 1);
            if (this.pausedValue && latest) {
                target = Math.max(latest.frameId + 1, desired);
            }
            this.lastScheduledFrame = target;
            void this.submitCompute(slot, target, true);
        }
        else if (this.computeInFlight && latest && desired - latest.frameId > 2) {
            this.stats.async.backpressure += 1;
        }
        if (latest && !this.renderInFlight && latest.frameId !== this.lastPresentedFrame) {
            void this.submitRender(latest, false);
        }
    }
    async syncTick(now) {
        if (this.syncBusy) {
            return;
        }
        const desired = this.getDesiredFrame(now);
        if (this.pausedValue &&
            this.latestSlot &&
            this.latestSlot.frameId === desired &&
            this.lastPresentedFrame === desired) {
            return;
        }
        this.syncBusy = true;
        try {
            const slot = this.findFreeSlot(false);
            if (!slot) {
                this.stats.sync.overwriteBlocks += 1;
                return;
            }
            this.lastScheduledFrame = Math.max(this.lastScheduledFrame + 1, desired);
            const computed = await this.submitCompute(slot, this.lastScheduledFrame, true);
            if (!computed || !this.latestSlot) {
                return;
            }
            await this.submitRender(this.latestSlot, false);
        }
        finally {
            this.syncBusy = false;
            this.maybeApplyPending();
        }
    }
    async submitCompute(slot, frameId, registerLatest) {
        if (slot.computing || slot.rendering) {
            this.guardViolationCount += 1;
            this.stats[this.modeValue].overwriteBlocks += 1;
            return false;
        }
        const submittedAt = performance.now();
        const cameraTime = frameId / 60;
        const camera = cameraAtFrame(frameId, this.canvas.width / Math.max(this.canvas.height, 1));
        this.writeFrameUniform(slot, camera, cameraTime);
        if (slot.hasValid) {
            this.recycleCount += 1;
        }
        slot.hasValid = false;
        slot.computing = true;
        this.computeInFlight = true;
        const timestamp = this.computeTimer.acquire();
        const encoder = this.device.createCommandEncoder({ label: `compute-slot-${slot.index}` });
        const resetPass = encoder.beginComputePass({
            label: `reset-slot-${slot.index}`,
            timestampWrites: timestamp
                ? {
                    querySet: timestamp.querySet,
                    beginningOfPassWriteIndex: 0,
                }
                : undefined,
        });
        resetPass.setBindGroup(0, slot.computeBindGroup);
        resetPass.setPipeline(this.resetPipeline);
        resetPass.dispatchWorkgroups(1, 1, 1);
        resetPass.end();
        const lightPass = encoder.beginComputePass({ label: `lights-slot-${slot.index}` });
        lightPass.setBindGroup(0, slot.computeBindGroup);
        lightPass.setPipeline(this.lightPipeline);
        lightPass.dispatchWorkgroups(Math.ceil(this.scene.lightCount / 64), 1, 1);
        lightPass.end();
        const cullPass = encoder.beginComputePass({ label: `visibility-slot-${slot.index}` });
        cullPass.setBindGroup(0, slot.computeBindGroup);
        cullPass.setPipeline(this.cullPipeline);
        cullPass.dispatchWorkgroups(Math.ceil(this.scene.instanceCount / 64), 1, 1);
        cullPass.end();
        const gatherPass = encoder.beginComputePass({ label: `gather-slot-${slot.index}` });
        gatherPass.setBindGroup(0, slot.computeBindGroup);
        gatherPass.setPipeline(this.gatherPipeline);
        gatherPass.dispatchWorkgroups(1, 1, 1);
        gatherPass.end();
        const binPass = encoder.beginComputePass({
            label: `bins-slot-${slot.index}`,
            timestampWrites: timestamp
                ? {
                    querySet: timestamp.querySet,
                    endOfPassWriteIndex: 1,
                }
                : undefined,
        });
        binPass.setBindGroup(0, slot.computeBindGroup);
        binPass.setPipeline(this.binPipeline);
        binPass.dispatchWorkgroups(Math.ceil(LIGHT_BIN_COLUMNS / 8), Math.ceil(LIGHT_BIN_ROWS / 8), 1);
        binPass.end();
        if (timestamp) {
            this.computeTimer.encodeResolve(encoder, timestamp);
        }
        encoder.copyBufferToBuffer(this.fenceSource, 0, slot.computeFence, 0, 4);
        this.device.queue.submit([encoder.finish()]);
        if (timestamp) {
            this.computeTimer.submitted(timestamp);
        }
        try {
            await this.awaitFence(slot.computeFence);
            slot.computing = false;
            slot.frameId = frameId;
            slot.hasValid = true;
            this.computeInFlight = false;
            if (!this.auditRunning) {
                this.stats[this.modeValue].computes += 1;
            }
            const wait = performance.now() - submittedAt;
            if (this.modeValue === "sync" && !this.auditRunning) {
                appendBounded(this.stats[this.modeValue].waits, wait);
                this.computeWaitValue = average(this.stats[this.modeValue].waits.slice(-30));
            }
            else if (!this.auditRunning) {
                this.computeWaitValue = 0;
            }
            if (!this.timestampsEnabled) {
                this.computeMsValue = wait;
            }
            if (registerLatest && (!this.latestSlot || frameId > this.latestSlot.frameId)) {
                this.latestSlot = slot;
            }
            this.maybeApplyPending();
            return true;
        }
        catch (error) {
            slot.computing = false;
            slot.hasValid = false;
            this.computeInFlight = false;
            this.reportError(error);
            this.maybeApplyPending();
            return false;
        }
    }
    writeFrameUniform(slot, camera, cameraTime) {
        const data = new Float32Array(40);
        data.set(camera.viewProjection, 0);
        data.set([camera.position[0], camera.position[1], camera.position[2], cameraTime], 16);
        data.set([
            camera.right[0] * camera.tanHalfFov * camera.aspect,
            camera.right[1] * camera.tanHalfFov * camera.aspect,
            camera.right[2] * camera.tanHalfFov * camera.aspect,
            0,
        ], 20);
        data.set([
            camera.up[0] * camera.tanHalfFov,
            camera.up[1] * camera.tanHalfFov,
            camera.up[2] * camera.tanHalfFov,
            0,
        ], 24);
        data.set([camera.forward[0], camera.forward[1], camera.forward[2], 0], 28);
        data.set([this.canvas.width, this.canvas.height, this.scene.instanceCount, this.scene.lightCount], 32);
        data.set([this.loadValue, 0, 0, 0], 36);
        this.device.queue.writeBuffer(slot.uniform, 0, data);
    }
    async submitRender(slot, capture) {
        if (slot.computing || slot.rendering || !slot.hasValid) {
            this.guardViolationCount += 1;
            if (slot.computing) {
                this.stats[this.modeValue].overwriteBlocks += 1;
            }
            return { hash: "", bytes: new Uint8Array() };
        }
        if (!this.depthTexture) {
            this.rebuildDepth(this.canvas.width, this.canvas.height);
        }
        if (!this.depthTexture) {
            return { hash: "", bytes: new Uint8Array() };
        }
        const submittedAt = performance.now();
        slot.rendering = true;
        this.renderInFlight = true;
        this.lastPresentedFrame = slot.frameId;
        const timestamp = this.renderTimer.acquire();
        const encoder = this.device.createCommandEncoder({ label: `render-slot-${slot.index}` });
        const texture = this.context.getCurrentTexture();
        const colorView = texture.createView();
        const depthView = this.depthTexture.createView();
        const pass = encoder.beginRenderPass({
            label: `station-frame-${slot.frameId}`,
            colorAttachments: [
                {
                    view: colorView,
                    clearValue: { r: 0.002, g: 0.006, b: 0.008, a: 1 },
                    loadOp: "clear",
                    storeOp: "store",
                },
            ],
            depthStencilAttachment: {
                view: depthView,
                depthClearValue: 1,
                depthLoadOp: "clear",
                depthStoreOp: "store",
            },
            timestampWrites: timestamp
                ? {
                    querySet: timestamp.querySet,
                    beginningOfPassWriteIndex: 0,
                    endOfPassWriteIndex: 1,
                }
                : undefined,
        });
        pass.setPipeline(this.backgroundPipeline);
        pass.setBindGroup(0, slot.backgroundBindGroup);
        pass.draw(3, 1, 0, 0);
        pass.setPipeline(this.objectPipeline);
        pass.setBindGroup(0, slot.bindGroup);
        pass.setVertexBuffer(0, this.cubeVertexBuffer);
        pass.setIndexBuffer(this.cubeIndexBuffer, "uint16");
        pass.drawIndexedIndirect(slot.indirect, 0);
        pass.setPipeline(this.haloPipeline);
        pass.setBindGroup(0, slot.bindGroup);
        pass.draw(6, MAX_LIGHTS, 0, 0);
        pass.setPipeline(this.beamPipeline);
        pass.setBindGroup(0, slot.bindGroup);
        pass.draw(6, MAX_LIGHTS, 0, 0);
        pass.end();
        let captureBuffer = null;
        let captureLayout = null;
        if (capture) {
            const width = this.canvas.width;
            const height = this.canvas.height;
            const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
            captureBuffer = this.device.createBuffer({
                label: "audit-readback",
                size: bytesPerRow * height,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            });
            captureLayout = { bytesPerRow, width, height };
            encoder.copyTextureToBuffer({ texture, mipLevel: 0, origin: { x: 0, y: 0, z: 0 } }, { buffer: captureBuffer, bytesPerRow, rowsPerImage: height }, { width, height, depthOrArrayLayers: 1 });
        }
        if (timestamp) {
            this.renderTimer.encodeResolve(encoder, timestamp);
        }
        encoder.copyBufferToBuffer(this.fenceSource, 0, slot.renderFence, 0, 4);
        this.device.queue.submit([encoder.finish()]);
        if (timestamp) {
            this.renderTimer.submitted(timestamp);
        }
        let hash = "";
        let bytes = new Uint8Array();
        try {
            await this.awaitFence(slot.renderFence);
            if (captureBuffer && captureLayout) {
                await captureBuffer.mapAsync(GPUMapMode.READ);
                const mapped = new Uint8Array(captureBuffer.getMappedRange());
                const packed = new Uint8Array(captureLayout.width * captureLayout.height * 4);
                for (let row = 0; row < captureLayout.height; row += 1) {
                    packed.set(mapped.subarray(row * captureLayout.bytesPerRow, row * captureLayout.bytesPerRow + captureLayout.width * 4), row * captureLayout.width * 4);
                }
                captureBuffer.unmap();
                hash = hashBytes(packed);
                bytes = packed;
            }
            slot.rendering = false;
            this.renderInFlight = false;
            const tail = performance.now() - submittedAt;
            if (!capture && !this.auditRunning) {
                this.stats[this.modeValue].renders += 1;
                appendBounded(this.stats[this.modeValue].tails, tail);
            }
            if (!this.timestampsEnabled) {
                this.renderMsValue = tail;
            }
            if (!capture && !this.auditRunning) {
                this.frameTimes.push(performance.now());
            }
            this.maybeApplyPending();
        }
        catch (error) {
            slot.rendering = false;
            this.renderInFlight = false;
            this.reportError(error);
            this.maybeApplyPending();
        }
        finally {
            captureBuffer?.destroy();
        }
        return { hash, bytes };
    }
    async awaitFence(buffer) {
        this.fenceChecks += 1;
        await buffer.mapAsync(GPUMapMode.READ);
        const value = new Uint32Array(buffer.getMappedRange())[0];
        buffer.unmap();
        if (value !== FENCE_WORD) {
            throw new Error(`帧槽围栏值无效: ${String(value)}`);
        }
    }
    setupDeviceLoss() {
        void this.device.lost.then((info) => {
            if (info.reason === "destroyed" || this.disposed) {
                return;
            }
            this.reportError(new Error(`WebGPU 设备丢失: ${info.message || "unknown"}`));
            this.onDeviceLost?.(info.message || "WebGPU device lost");
        });
    }
    reportError(error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(error);
        this.statusOverride = "error";
        this.statusTextOverride = "PIPELINE ERROR";
        this.statusDetailOverride = message;
    }
    dispose() {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        cancelAnimationFrame(this.animationHandle);
        this.computeTimer.destroy();
        this.renderTimer.destroy();
        for (const slot of this.slots) {
            slot.uniform.destroy();
            slot.lights.destroy();
            slot.bins.destroy();
            slot.visibleIndices.destroy();
            slot.visibilityFlags.destroy();
            slot.indirect.destroy();
            slot.computeFence.destroy();
            slot.renderFence.destroy();
        }
        this.instanceBuffer.destroy();
        this.sourceLightBuffer.destroy();
        this.cubeVertexBuffer.destroy();
        this.cubeIndexBuffer.destroy();
        this.fenceSource.destroy();
        this.depthTexture?.destroy();
        this.device.destroy();
    }
}
async function createShaderModule(device, label, code) {
    const module = device.createShaderModule({ label, code });
    const compilation = await module.getCompilationInfo();
    const errors = compilation.messages.filter((message) => message.type === "error");
    if (errors.length > 0) {
        const details = errors
            .map((message) => `${message.lineNum}:${message.linePos} ${message.message}`)
            .join("\n");
        throw new Error(`${label} WGSL 编译失败:\n${details}`);
    }
    return module;
}
function createSlot(device, index, renderLayout, backgroundLayout, computeLayout, instanceBuffer, sourceLightBuffer) {
    const uniform = device.createBuffer({
        label: `slot-${index}-uniform`,
        size: UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const lights = device.createBuffer({
        label: `slot-${index}-lights`,
        size: LIGHT_SIZE,
        usage: GPUBufferUsage.STORAGE,
    });
    const bins = device.createBuffer({
        label: `slot-${index}-bins`,
        size: BIN_SIZE,
        usage: GPUBufferUsage.STORAGE,
    });
    const visibleIndices = device.createBuffer({
        label: `slot-${index}-visible`,
        size: VISIBLE_SIZE,
        usage: GPUBufferUsage.STORAGE,
    });
    const visibilityFlags = device.createBuffer({
        label: `slot-${index}-visibility-flags`,
        size: VISIBLE_SIZE,
        usage: GPUBufferUsage.STORAGE,
    });
    const indirect = device.createBuffer({
        label: `slot-${index}-indirect`,
        size: 20,
        usage: GPUBufferUsage.STORAGE |
            GPUBufferUsage.INDIRECT |
            GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Uint32Array(indirect.getMappedRange()).set([36, 0, 0, 0, 0]);
    indirect.unmap();
    const computeFence = device.createBuffer({
        label: `slot-${index}-compute-fence`,
        size: 4,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const renderFence = device.createBuffer({
        label: `slot-${index}-render-fence`,
        size: 4,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = device.createBindGroup({
        label: `slot-${index}-render-bind-group`,
        layout: renderLayout,
        entries: [
            { binding: 0, resource: { buffer: uniform } },
            { binding: 1, resource: { buffer: instanceBuffer } },
            { binding: 3, resource: { buffer: lights } },
            { binding: 4, resource: { buffer: bins } },
            { binding: 5, resource: { buffer: visibleIndices } },
        ],
    });
    const backgroundBindGroup = device.createBindGroup({
        label: `slot-${index}-background-bind-group`,
        layout: backgroundLayout,
        entries: [{ binding: 0, resource: { buffer: uniform } }],
    });
    const computeBindGroup = device.createBindGroup({
        label: `slot-${index}-compute-bind-group`,
        layout: computeLayout,
        entries: [
            { binding: 0, resource: { buffer: uniform } },
            { binding: 1, resource: { buffer: instanceBuffer } },
            { binding: 2, resource: { buffer: sourceLightBuffer } },
            { binding: 3, resource: { buffer: lights } },
            { binding: 4, resource: { buffer: bins } },
            { binding: 5, resource: { buffer: visibleIndices } },
            { binding: 6, resource: { buffer: indirect } },
            { binding: 7, resource: { buffer: visibilityFlags } },
        ],
    });
    return {
        index,
        uniform,
        lights,
        bins,
        visibleIndices,
        visibilityFlags,
        indirect,
        computeFence,
        renderFence,
        bindGroup,
        computeBindGroup,
        backgroundBindGroup,
        frameId: -1,
        hasValid: false,
        computing: false,
        rendering: false,
    };
}
//# sourceMappingURL=renderer.js.map