// Lunar base inspection app: curvature horizon culling over a BVH,
// rendered with WebGPU. Keys:
//   1/2/3  cull mode: BVH+horizon / per-object reference / none
//   H      toggle horizon debug sphere + camera horizon ring
//   V      toggle visible-set view (culled objects shown ghost-red)
//   Space  pause/resume the crater rim -> valley walk
//   WASD   manual walk (pauses auto-walk), mouse drag to look

import { Terrain, DEFAULT_TERRAIN } from "../scene/terrain.ts";
import { generateScene, DEFAULT_SCENE } from "../scene/objects.ts";
import type { SceneObject } from "../scene/objects.ts";
import { buildBvh } from "../scene/bvh.ts";
import { makeHorizonContext } from "../culling/horizon.ts";
import { cullScene, countFalseCulls } from "../culling/pipeline.ts";
import type { CullMode } from "../culling/pipeline.ts";
import { walkFrame, DEFAULT_WALK } from "../scene/path.ts";
import { Renderer } from "../gpu/renderer.ts";
import { unitCube, terrainMesh, sphereRings, horizonCircle } from "../gpu/geometry.ts";
import { perspective, lookAt, multiply, compose } from "../math/mat4.ts";
import type { Vec3 } from "../math/vec3.ts";
import { normalize, add, scale, cross, sub } from "../math/vec3.ts";

const INSTANCE_FLOATS = 20;

interface InstanceTemplate {
  offset: Vec3; // in object local frame (right, up, fwd)
  scaleV: Vec3;
  color: [number, number, number, number];
}

function templatesFor(obj: SceneObject): InstanceTemplate[] {
  const [w, h, d] = obj.size;
  if (obj.type === "module") {
    return [{ offset: [0, h / 2, 0], scaleV: [w, h, d], color: [0.75, 0.76, 0.78, 1] }];
  }
  if (obj.type === "panel") {
    return [
      { offset: [0, h * 0.3, 0], scaleV: [0.18, h * 0.6, 0.18], color: [0.35, 0.35, 0.4, 1] },
      { offset: [0, h * 0.72, 0], scaleV: [w, h * 0.28, Math.max(d, 1.6)], color: [0.12, 0.2, 0.55, 1] },
    ];
  }
  // tower: mast + crossbar + beacon
  return [
    { offset: [0, h / 2, 0], scaleV: [w, h, d], color: [0.8, 0.45, 0.15, 1] },
    { offset: [0, h * 0.82, 0], scaleV: [w * 4, 0.25, 0.25], color: [0.8, 0.45, 0.15, 1] },
    { offset: [0, h + 0.4, 0], scaleV: [0.5, 0.8, 0.5], color: [1.0, 0.25, 0.2, 1] },
  ];
}

function objectFrame(obj: SceneObject): { right: Vec3; up: Vec3; fwd: Vec3 } {
  const up = obj.up;
  const ref: Vec3 = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const r0 = normalize(cross(ref, up));
  const f0 = normalize(cross(up, r0));
  const cs = Math.cos(obj.yaw);
  const sn = Math.sin(obj.yaw);
  const right: Vec3 = [
    r0[0] * cs + f0[0] * sn,
    r0[1] * cs + f0[1] * sn,
    r0[2] * cs + f0[2] * sn,
  ];
  const fwd: Vec3 = [
    f0[0] * cs - r0[0] * sn,
    f0[1] * cs - r0[1] * sn,
    f0[2] * cs - r0[2] * sn,
  ];
  return { right, up, fwd };
}

function pushInstance(
  out: number[],
  obj: SceneObject,
  tpl: InstanceTemplate,
  ghost: boolean,
): void {
  const f = objectFrame(obj);
  const world = add(
    obj.position,
    add(
      add(scale(f.right, tpl.offset[0]), scale(f.up, tpl.offset[1])),
      scale(f.fwd, tpl.offset[2]),
    ),
  );
  const m = compose(
    world[0], world[1], world[2],
    f.right[0], f.right[1], f.right[2],
    f.up[0], f.up[1], f.up[2],
    f.fwd[0], f.fwd[1], f.fwd[2],
    tpl.scaleV[0], tpl.scaleV[1], tpl.scaleV[2],
  );
  for (let i = 0; i < 16; i++) out.push(m[i]!);
  const c = tpl.color;
  if (ghost) out.push(0.55, 0.08, 0.08, 1);
  else out.push(c[0], c[1], c[2], c[3]);
}

async function main(): Promise<void> {
  const canvas = document.getElementById("gpu") as HTMLCanvasElement;
  const hud = document.getElementById("hud") as HTMLDivElement;
  const renderer = new Renderer(canvas);
  await renderer.init();

  const terrain = new Terrain(DEFAULT_TERRAIN);
  const objects = generateScene(terrain, DEFAULT_SCENE);
  const bvh = buildBvh(objects);
  const templates = objects.map(templatesFor);

  const terrainGpu = renderer.uploadMesh(terrainMesh(terrain));
  const cubeGpu = renderer.uploadMesh(unitCube());
  const debugSphereGpu = renderer.uploadLinesStatic(
    sphereRings(terrain.planetRadius, [0.25, 0.5, 0.65, 1]),
  );

  // ---- state ----
  let mode: CullMode = "bvh";
  let showDebugSphere = true;
  let showVisibleSet = false;
  let autoWalk = true;
  let walkT = 0;
  let walkDir = 1;
  let yawOffset = 0;
  let pitchOffset = 0;
  const keys = new Set<string>();

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "1") mode = "bvh";
    else if (k === "2") mode = "reference";
    else if (k === "3") mode = "none";
    else if (k === "h") showDebugSphere = !showDebugSphere;
    else if (k === "v") showVisibleSet = !showVisibleSet;
    else if (k === " ") { autoWalk = !autoWalk; e.preventDefault(); }
    else keys.add(k);
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener("mousedown", (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
  window.addEventListener("mouseup", () => { dragging = false; });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    yawOffset += (e.clientX - lastX) * 0.004;
    pitchOffset -= (e.clientY - lastY) * 0.004;
    pitchOffset = Math.max(-1.2, Math.min(1.2, pitchOffset));
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener("resize", () => renderer.resize());

  const WALK_SPEED = 1 / 90; // full rim->valley walk in ~90 s
  let lastTime = performance.now();

  function frame(now: number): void {
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    // ---- camera ----
    if (autoWalk) {
      walkT += WALK_SPEED * walkDir * dt;
      if (walkT >= 1) { walkT = 1; walkDir = -1; }
      if (walkT <= 0) { walkT = 0; walkDir = 1; }
    } else {
      const move = (keys.has("w") ? 1 : 0) - (keys.has("s") ? 1 : 0);
      const strafe = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);
      if (move !== 0 || strafe !== 0) {
        walkT = Math.max(0, Math.min(1, walkT + move * dt * 0.05));
        yawOffset += strafe * dt * 0.8;
      }
    }
    const wf = walkFrame(terrain, DEFAULT_WALK, walkT);
    // apply look offsets around the path forward
    const fwd0 = normalize(sub(wf.target, wf.eye));
    const right0 = normalize(cross(fwd0, wf.up));
    const cs = Math.cos(yawOffset);
    const sn = Math.sin(yawOffset);
    const fwdY: Vec3 = normalize([
      fwd0[0] * cs + right0[0] * sn,
      fwd0[1] * cs + right0[1] * sn,
      fwd0[2] * cs + right0[2] * sn,
    ]);
    const fwd = normalize(add(fwdY, scale(wf.up, Math.tan(pitchOffset))));
    const target = add(wf.eye, scale(fwd, 30));

    const aspect = canvas.width / Math.max(1, canvas.height);
    const proj = perspective((60 * Math.PI) / 180, aspect, 0.1, 4000);
    const view = lookAt(wf.eye, target, wf.up);
    const viewProj = multiply(proj, view);

    // ---- culling ----
    const ctx = makeHorizonContext(wf.eye, terrain.planetRadius);
    const result = cullScene(mode, ctx, bvh, objects);
    const { falseCulls } =
      mode === "bvh" ? countFalseCulls(ctx, objects, result.culled) : { falseCulls: 0 };
    const culledSet = new Set(result.culled);

    // ---- instances ----
    const inst: number[] = [];
    // terrain: identity instance, grey regolith
    inst.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0.42, 0.40, 0.38, 1);
    const terrainOffset = 0;
    const objectOffset = INSTANCE_FLOATS * 4;
    for (const obj of objects) {
      const isCulled = culledSet.has(obj.id);
      if (isCulled && !showVisibleSet) continue;
      for (const tpl of templates[obj.id]!) {
        pushInstance(inst, obj, tpl, isCulled);
      }
    }
    const objectInstanceCount = inst.length / INSTANCE_FLOATS - 1;
    renderer.writeInstances(new Float32Array(inst));

    // ---- debug lines ----
    let horizonVerts = 0;
    if (showDebugSphere) {
      horizonVerts = renderer.writeDynamicLines(horizonCircle(wf.eye, terrain.planetRadius));
    }

    renderer.writeCamera(
      viewProj,
      [0.5, 0.75, 0.42, 0],
      [wf.eye[0], wf.eye[1], wf.eye[2], 0],
    );
    renderer.render(
      terrainGpu,
      terrainOffset,
      cubeGpu,
      objectOffset,
      objectInstanceCount,
      showDebugSphere ? debugSphereGpu : null,
      horizonVerts,
    );

    // ---- HUD ----
    const s = result.stats;
    const horizonM = Math.sqrt(
      Math.max(0, ctx.d * ctx.d - terrain.planetRadius * terrain.planetRadius),
    );
    hud.textContent = [
      `mode: ${mode}   [1]=bvh [2]=reference [3]=none`,
      `walk: ${autoWalk ? "auto" : "manual"}  t=${walkT.toFixed(2)}  craterDist=${wf.craterDistance.toFixed(1)} m`,
      `objects: ${s.totalObjects}  candidates: ${s.candidates}  visible: ${s.visible}  culled: ${s.culled}`,
      `cull rate: ${(s.cullRate * 100).toFixed(1)}%  parent-culled: ${s.culledByParent}  corner-fallbacks: ${s.cornerFallbacks}`,
      `false culls: ${falseCulls}`,
      `horizon: ${horizonM.toFixed(1)} m   eye: +${(ctx.d - terrain.planetRadius).toFixed(1)} m`,
      `[H] debug sphere: ${showDebugSphere ? "on" : "off"}   [V] visible-set: ${showVisibleSet ? "on" : "off"}   [Space] walk: ${autoWalk ? "pause" : "resume"}`,
    ].join("\n");

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((err) => {
  const hud = document.getElementById("hud");
  if (hud) hud.textContent = `WebGPU init failed: ${err}`;
  console.error(err);
});
