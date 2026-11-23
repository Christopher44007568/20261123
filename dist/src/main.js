import { m4Perspective, m4LookAt } from "./math";
import { createProgram, uniformMap, createMesh, drawMesh } from "./gl";
import { buildBase } from "./base";
import { buildStrands, buildCards, generateCardTexture, MAX_STRANDS, MAX_CARDS, STRAND_CHUNK, SHELL_LAYERS, } from "./fur";
import { BASE_VS, BASE_FS, STRAND_VS, STRAND_FS, CARD_VS, CARD_FS, SHELL_VS, SHELL_FS } from "./shaders";
const canvas = document.getElementById("glcanvas");
const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
if (!gl)
    throw new Error("WebGL2 not available");
function prog(vs, fs) {
    const p = createProgram(gl, vs, fs);
    return { p, u: uniformMap(gl, p) };
}
const baseProg = prog(BASE_VS, BASE_FS);
const strandProg = prog(STRAND_VS, STRAND_FS);
const cardProg = prog(CARD_VS, CARD_FS);
const shellProg = prog(SHELL_VS, SHELL_FS);
// ---------- base mesh ----------
const base = buildBase();
const baseMesh = (() => {
    const inter = new Float32Array((base.positions.length / 3) * 8);
    for (let i = 0, n = base.positions.length / 3; i < n; i++) {
        inter.set(base.positions.subarray(i * 3, i * 3 + 3), i * 8);
        inter.set(base.normals.subarray(i * 3, i * 3 + 3), i * 8 + 3);
        inter.set(base.uvs.subarray(i * 2, i * 2 + 2), i * 8 + 6);
    }
    return createMesh(gl, inter, [
        { loc: 0, size: 3, stride: 8, offset: 0 },
        { loc: 1, size: 3, stride: 8, offset: 3 },
        { loc: 2, size: 2, stride: 8, offset: 6 },
    ], base.indices, gl.TRIANGLES);
})();
// ---------- fur state ----------
const params = { length: 1.0, windAngle: 40, windStrength: 0.45, density: 1.0 };
let roughness = 0.35;
let strands;
let cards;
let strandVao;
let cardVao;
function buildStrandVao(data) {
    return createMesh(gl, data.verts, [
        { loc: 0, size: 3, stride: 9, offset: 0 },
        { loc: 1, size: 3, stride: 9, offset: 3 },
        { loc: 2, size: 1, stride: 9, offset: 6 },
        { loc: 3, size: 1, stride: 9, offset: 7 },
        { loc: 4, size: 1, stride: 9, offset: 8 },
    ], data.indices, gl.TRIANGLES).vao;
}
function buildCardVao(data) {
    return createMesh(gl, data.verts, [
        { loc: 0, size: 3, stride: 10, offset: 0 },
        { loc: 1, size: 3, stride: 10, offset: 3 },
        { loc: 2, size: 2, stride: 10, offset: 6 },
        { loc: 3, size: 1, stride: 10, offset: 8 },
        { loc: 4, size: 1, stride: 10, offset: 9 },
    ], data.indices, gl.TRIANGLES).vao;
}
function uploadCardTexture() {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, generateCardTexture());
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    if (aniso)
        gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    return tex;
}
function rebuildFur() {
    strands = buildStrands(params);
    cards = buildCards(params);
    strandVao = buildStrandVao(strands);
    cardVao = buildCardVao(cards);
}
rebuildFur();
const cardTex = uploadCardTexture();
const cam = { az: 0.6, el: 0.35, dist: 5.0, target: [0, 0.6, 0] };
const light = { az: 2.2, el: 0.5, color: [1.0, 0.93, 0.82], intensity: 1.15 };
function lightDir() {
    // direction the light travels
    return [Math.cos(light.az) * Math.cos(light.el), -Math.sin(light.el), Math.sin(light.az) * Math.cos(light.el)];
}
function eyePos() {
    return [
        cam.target[0] + cam.dist * Math.cos(cam.az) * Math.cos(cam.el),
        cam.target[1] + cam.dist * Math.sin(cam.el),
        cam.target[2] + cam.dist * Math.sin(cam.az) * Math.cos(cam.el),
    ];
}
function applyPreset(p) {
    if (p === "side") {
        cam.az = 0.6;
        cam.el = 0.35;
        cam.dist = 5.0;
        light.az = 2.4;
        light.el = 0.55;
        light.intensity = 1.15;
    }
    else if (p === "back") {
        cam.az = 0.2;
        cam.el = 0.28;
        cam.dist = 4.5;
        light.az = 0.2 + Math.PI;
        light.el = -0.15;
        light.intensity = 1.5; // light behind, aimed at camera
    }
    else {
        cam.az = 1.35;
        cam.el = 0.06;
        cam.dist = 3.2;
        light.az = 2.9;
        light.el = 0.08;
        light.intensity = 1.3;
    }
}
let lodMode = "auto";
function smoothstep(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}
function lodFades(dist, mode) {
    switch (mode) {
        case "strand": return { strand: 1, card: 0, shell: 0 };
        case "card": return { strand: 0, card: 1, shell: 0 };
        case "shell": return { strand: 0, card: 0, shell: 1 };
        default: break;
    }
    const strand = 1 - smoothstep(7, 13, dist);
    const card = smoothstep(7, 11, dist) * (1 - smoothstep(20, 28, dist));
    const shell = smoothstep(22, 28, dist);
    return { strand, card, shell };
}
// ---------- render ----------
function setCommon(u, proj, view, eye) {
    gl.uniformMatrix4fv(u.get("uProj"), false, proj);
    gl.uniformMatrix4fv(u.get("uView"), false, view);
    const ld = lightDir();
    gl.uniform3f(u.get("uLightDir"), ld[0], ld[1], ld[2]);
    const lc = light.color;
    gl.uniform3f(u.get("uLightColor"), lc[0] * light.intensity, lc[1] * light.intensity, lc[2] * light.intensity);
    gl.uniform3f(u.get("uCamPos"), eye[0], eye[1], eye[2]);
}
function setFurCommon(u) {
    gl.uniform1f(u.get("uRough"), roughness);
    gl.uniform1f(u.get("uDensity"), params.density);
    gl.uniform3f(u.get("uRootColor"), 0.16, 0.11, 0.07);
    gl.uniform3f(u.get("uTipColor"), 0.85, 0.72, 0.5);
}
function renderScene(proj, view, eye, fades) {
    // 1) opaque base with depth writes: transparent fur is correctly occluded by it
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(baseProg.p);
    setCommon(baseProg.u, proj, view, eye);
    drawMesh(gl, baseMesh);
    // 2) fur passes: depth test on, depth write off, alpha blend
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    if (fades.shell > 0.001) {
        gl.useProgram(shellProg.p);
        setCommon(shellProg.u, proj, view, eye);
        setFurCommon(shellProg.u);
        gl.uniform1f(shellProg.u.get("uFade"), fades.shell);
        gl.uniform1f(shellProg.u.get("uFurLen"), 0.55 * params.length);
        gl.uniform1f(shellProg.u.get("uCells"), 260);
        const wa = (params.windAngle * Math.PI) / 180;
        gl.uniform3f(shellProg.u.get("uWind"), Math.cos(wa), 0, Math.sin(wa));
        gl.uniform1f(shellProg.u.get("uWindStr"), params.windStrength);
        gl.bindVertexArray(baseMesh.vao);
        gl.drawElementsInstanced(gl.TRIANGLES, baseMesh.count, gl.UNSIGNED_INT, 0, SHELL_LAYERS);
        gl.bindVertexArray(null);
    }
    if (fades.card > 0.001) {
        gl.useProgram(cardProg.p);
        setCommon(cardProg.u, proj, view, eye);
        setFurCommon(cardProg.u);
        gl.uniform1f(cardProg.u.get("uFade"), fades.card);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, cardTex);
        gl.uniform1i(cardProg.u.get("uTex"), 0);
        const active = Math.floor(MAX_CARDS * params.density);
        const order = sortBackToFront(cards.centers, active, eye);
        gl.bindVertexArray(cardVao);
        for (const i of order) {
            gl.drawElements(gl.TRIANGLES, cards.count, gl.UNSIGNED_INT, cards.first[i] * 4);
        }
        gl.bindVertexArray(null);
    }
    if (fades.strand > 0.001) {
        gl.useProgram(strandProg.p);
        setCommon(strandProg.u, proj, view, eye);
        setFurCommon(strandProg.u);
        gl.uniform1f(strandProg.u.get("uFade"), fades.strand);
        gl.uniform1f(strandProg.u.get("uWidth"), 0.0075);
        const activeStrands = Math.floor(MAX_STRANDS * params.density);
        const activeChunks = Math.ceil(activeStrands / STRAND_CHUNK);
        const order = sortBackToFront(strands.chunkCenters, activeChunks, eye);
        gl.bindVertexArray(strandVao);
        for (const c of order) {
            gl.drawElements(gl.TRIANGLES, strands.chunkCount[c], gl.UNSIGNED_INT, strands.chunkFirst[c] * 4);
        }
        gl.bindVertexArray(null);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
}
const sortScratch = [];
function sortBackToFront(centers, count, eye) {
    sortScratch.length = count;
    const keyed = [];
    for (let i = 0; i < count; i++) {
        const dx = centers[i * 3] - eye[0], dy = centers[i * 3 + 1] - eye[1], dz = centers[i * 3 + 2] - eye[2];
        keyed.push([-(dx * dx + dy * dy + dz * dz), i]);
    }
    keyed.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < count; i++)
        sortScratch[i] = keyed[i][1];
    return sortScratch;
}
// ---------- frame loop ----------
const statsEl = document.getElementById("stats");
let frames = 0, fps = 0, lastFpsT = performance.now();
function frame() {
    window.__frame++;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
    }
    gl.clearColor(0.06, 0.075, 0.095, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const eye = eyePos();
    const viewports = [];
    if (lodMode === "compare") {
        viewports.push({ x: 0, w: w / 3, mode: "strand", label: "L0 发丝" }, { x: w / 3, w: w / 3, mode: "card", label: "L1 发卡" }, { x: (2 * w) / 3, w: w / 3, mode: "shell", label: "L2 壳层" });
    }
    else {
        viewports.push({ x: 0, w, mode: lodMode, label: "" });
    }
    gl.enable(gl.SCISSOR_TEST);
    for (const vp of viewports) {
        gl.viewport(vp.x, 0, vp.w, h);
        gl.scissor(vp.x, 0, vp.w, h);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const proj = m4Perspective(0.7, vp.w / h, 0.05, 100);
        const view = m4LookAt(eye, cam.target, [0, 1, 0]);
        renderScene(proj, view, eye, lodFades(cam.dist, vp.mode));
    }
    gl.disable(gl.SCISSOR_TEST);
    frames++;
    const now = performance.now();
    if (now - lastFpsT > 500) {
        fps = Math.round((frames * 1000) / (now - lastFpsT));
        frames = 0;
        lastFpsT = now;
        const f = lodFades(cam.dist, lodMode);
        statsEl.textContent =
            `fps ${fps}  dist ${cam.dist.toFixed(1)}\n` +
                `fade 发丝${f.strand.toFixed(2)} 发卡${f.card.toFixed(2)} 壳层${f.shell.toFixed(2)}\n` +
                `strands ${Math.floor(MAX_STRANDS * params.density)}`;
    }
    requestAnimationFrame(frame);
}
// ---------- UI ----------
function bindSlider(id, label, fmt, cb) {
    const el = document.getElementById(id);
    const out = document.getElementById("v-" + label);
    const update = () => { const v = parseFloat(el.value); out.textContent = fmt(v); cb(v); };
    el.addEventListener("input", update);
    update();
}
let rebuildTimer = 0;
function scheduleRebuild() {
    window.clearTimeout(rebuildTimer);
    rebuildTimer = window.setTimeout(rebuildFur, 120);
}
bindSlider("p-len", "len", v => v.toFixed(2), v => { params.length = v; scheduleRebuild(); });
bindSlider("p-rough", "rough", v => v.toFixed(2), v => { roughness = v; });
bindSlider("p-wind", "wind", v => v.toFixed(0) + "°", v => { params.windAngle = v; scheduleRebuild(); });
bindSlider("p-windstr", "windstr", v => v.toFixed(2), v => { params.windStrength = v; scheduleRebuild(); });
bindSlider("p-density", "density", v => v.toFixed(2), v => { params.density = v; });
function bindBtn(id, cb) {
    document.getElementById(id).addEventListener("click", cb);
}
bindBtn("b-side", () => applyPreset("side"));
bindBtn("b-back", () => applyPreset("back"));
bindBtn("b-graze", () => applyPreset("graze"));
const lodBtns = [
    ["b-lod-auto", "auto"], ["b-lod0", "strand"], ["b-lod1", "card"], ["b-lod2", "shell"], ["b-compare", "compare"],
];
for (const [id, mode] of lodBtns) {
    bindBtn(id, () => {
        lodMode = mode;
        for (const [bid] of lodBtns)
            document.getElementById(bid).classList.toggle("active", bid === id);
    });
}
// orbit camera
let dragging = false, px = 0, py = 0;
canvas.addEventListener("pointerdown", e => { dragging = true; px = e.clientX; py = e.clientY; });
window.addEventListener("pointerup", () => { dragging = false; });
window.addEventListener("pointermove", e => {
    if (!dragging)
        return;
    cam.az -= (e.clientX - px) * 0.005;
    cam.el = Math.min(1.4, Math.max(-0.2, cam.el + (e.clientY - py) * 0.005));
    px = e.clientX;
    py = e.clientY;
});
canvas.addEventListener("wheel", e => {
    cam.dist = Math.min(40, Math.max(1.2, cam.dist * (1 + Math.sign(e.deltaY) * 0.08)));
}, { passive: true });
// ---------- URL params (headless verification hooks) ----------
const qs = new URLSearchParams(location.search);
if (qs.has("preset"))
    applyPreset(qs.get("preset"));
if (qs.has("dist"))
    cam.dist = parseFloat(qs.get("dist"));
if (qs.has("az"))
    cam.az = parseFloat(qs.get("az"));
if (qs.has("el"))
    cam.el = parseFloat(qs.get("el"));
if (qs.has("lod"))
    lodMode = qs.get("lod");
if (qs.has("len"))
    params.length = parseFloat(qs.get("len"));
if (qs.has("density"))
    params.density = parseFloat(qs.get("density"));
if (qs.has("wind"))
    params.windAngle = parseFloat(qs.get("wind"));
if (qs.has("rough"))
    roughness = parseFloat(qs.get("rough"));
if (qs.has("preset") || qs.has("len") || qs.has("wind"))
    rebuildFur();
window.__frame = 0;
requestAnimationFrame(frame);
//# sourceMappingURL=main.js.map