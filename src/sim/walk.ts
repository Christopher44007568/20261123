// Headless validation walk: crater rim -> valley floor.
// Runs the exact same culling pipeline as the WebGPU app and reports
// candidate counts, cull rate and false culls per step and in aggregate.
// Usage: node src/sim/walk.ts   (Node >= 22 runs erasable TS directly)

import { writeFileSync, mkdirSync } from "node:fs";
import { Terrain, DEFAULT_TERRAIN } from "../scene/terrain.ts";
import { generateScene, DEFAULT_SCENE } from "../scene/objects.ts";
import type { SceneObject } from "../scene/objects.ts";
import { buildBvh } from "../scene/bvh.ts";
import { makeHorizonContext, isPointOccluded } from "../culling/horizon.ts";
import { cullScene, countFalseCulls, referenceVisible } from "../culling/pipeline.ts";
import { walkFrame, DEFAULT_WALK } from "../scene/path.ts";

const STEPS = 240;

interface StepRow {
  step: number;
  craterDistance: number;
  candidates: number;
  culled: number;
  visible: number;
  cullRate: number;
  culledByParent: number;
  cornerFallbacks: number;
  nodeTests: number;
  falseCulls: number;
}

type Ctx = ReturnType<typeof makeHorizonContext>;

function emergenceFraction(ctx: Ctx, obj: SceneObject): number {
  let vis = 0;
  for (const p of obj.refPoints) {
    if (!isPointOccluded(ctx, p)) vis++;
  }
  return vis / obj.refPoints.length;
}

function main(): void {
  const terrain = new Terrain(DEFAULT_TERRAIN);
  const objects = generateScene(terrain, DEFAULT_SCENE);
  const bvh = buildBvh(objects);

  console.log(`scene: ${objects.length} objects, bvh nodes=${bvh.nodeCount} leaves=${bvh.leafCount}`);
  console.log(`planet R=${DEFAULT_TERRAIN.planetRadius} m, eye=${DEFAULT_WALK.eyeHeight} m`);
  const horizonM = Math.sqrt(2 * DEFAULT_TERRAIN.planetRadius * DEFAULT_WALK.eyeHeight);
  console.log(`horizon distance at eye height ~= ${horizonM.toFixed(1)} m`);

  const rows: StepRow[] = [];
  let totalFalseCulls = 0;
  let worstFalseCullStep = -1;

  const towers = objects.filter((o) => o.type === "tower");
  const towerEmergence = new Map<number, number[]>();
  for (const tw of towers) towerEmergence.set(tw.id, []);

  for (let s = 0; s <= STEPS; s++) {
    const t = s / STEPS;
    const frame = walkFrame(terrain, DEFAULT_WALK, t);
    const ctx = makeHorizonContext(frame.eye, terrain.planetRadius);

    const result = cullScene("bvh", ctx, bvh, objects);
    const { falseCulls } = countFalseCulls(ctx, objects, result.culled);
    totalFalseCulls += falseCulls;
    if (falseCulls > 0 && worstFalseCullStep < 0) worstFalseCullStep = s;

    for (const tw of towers) {
      towerEmergence.get(tw.id)!.push(emergenceFraction(ctx, tw));
    }

    rows.push({
      step: s,
      craterDistance: Number(frame.craterDistance.toFixed(2)),
      candidates: result.stats.candidates,
      culled: result.stats.culled,
      visible: result.stats.visible,
      cullRate: Number(result.stats.cullRate.toFixed(4)),
      culledByParent: result.stats.culledByParent,
      cornerFallbacks: result.stats.cornerFallbacks,
      nodeTests: result.stats.nodeTests,
      falseCulls,
    });
  }
  // ---- aggregate ----
  const avg = (f: (r: StepRow) => number) =>
    rows.reduce((a, r) => a + f(r), 0) / rows.length;
  const summary = {
    steps: rows.length,
    objects: objects.length,
    avgCandidates: Number(avg((r) => r.candidates).toFixed(1)),
    avgCullRate: Number(avg((r) => r.cullRate).toFixed(4)),
    minCullRate: Math.min(...rows.map((r) => r.cullRate)),
    maxCullRate: Math.max(...rows.map((r) => r.cullRate)),
    avgCulledByParent: Number(avg((r) => r.culledByParent).toFixed(1)),
    avgCornerFallbacks: Number(avg((r) => r.cornerFallbacks).toFixed(2)),
    avgNodeTests: Number(avg((r) => r.nodeTests).toFixed(1)),
    totalFalseCulls,
    worstFalseCullStep,
  };

  // ---- tower emergence check: far towers emerge progressively ----
  const emergenceReport = towers.map((tw) => {
    const series = towerEmergence.get(tw.id)!;
    const first = series.findIndex((v) => v > 0);
    const full = series.findIndex((v) => v >= 1);
    let decreases = 0;
    for (let i = 1; i < series.length; i++) {
      if (series[i]! < series[i - 1]! - 1e-9) decreases++;
    }
    return { id: tw.id, firstStep: first, fullStep: full, decreases };
  });
  const emerging = emergenceReport.filter((e) => e.firstStep >= 0);
  const progressive = emerging.filter((e) => e.fullStep > e.firstStep).length;

  // ---- reference cross-check at sample steps ----
  const refChecks: { step: number; bvhVisible: number; refVisible: number }[] = [];
  for (const s of [0, 60, 120, 180, 240]) {
    const frame = walkFrame(terrain, DEFAULT_WALK, s / STEPS);
    const ctx = makeHorizonContext(frame.eye, terrain.planetRadius);
    const bvhRes = cullScene("bvh", ctx, bvh, objects);
    let refVis = 0;
    for (const o of objects) if (referenceVisible(ctx, o)) refVis++;
    refChecks.push({ step: s, bvhVisible: bvhRes.stats.visible, refVisible: refVis });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    terrain: DEFAULT_TERRAIN,
    scene: DEFAULT_SCENE,
    walk: DEFAULT_WALK,
    summary,
    towerEmergence: {
      towerCount: towers.length,
      emergingCount: emerging.length,
      progressiveCount: progressive,
      maxDecreases: Math.max(0, ...emergenceReport.map((e) => e.decreases)),
    },
    referenceCrossCheck: refChecks,
    rows,
  };

  mkdirSync("artifacts", { recursive: true });
  writeFileSync("artifacts/horizon_culling_report.json", JSON.stringify(report, null, 2));

  console.log("\nstep  dist(m)  cand  culled  visible  cull%  parent  fallback  false");
  for (const s of [0, 30, 60, 90, 120, 150, 180, 210, 240]) {
    const r = rows[s]!;
    console.log(
      `${String(r.step).padStart(4)}  ${String(r.craterDistance).padStart(7)}  ` +
        `${String(r.candidates).padStart(4)}  ${String(r.culled).padStart(6)}  ` +
        `${String(r.visible).padStart(7)}  ${(r.cullRate * 100).toFixed(1).padStart(5)}  ` +
        `${String(r.culledByParent).padStart(6)}  ${String(r.cornerFallbacks).padStart(8)}  ` +
        `${String(r.falseCulls).padStart(5)}`,
    );
  }
  console.log("\nsummary:", JSON.stringify(summary, null, 2));
  console.log("tower emergence:", JSON.stringify(report.towerEmergence));
  console.log("reference cross-check (bvhVisible must be >= refVisible):");
  for (const c of refChecks) {
    const ok = c.bvhVisible >= c.refVisible ? "OK" : "FAIL";
    console.log(`  step ${c.step}: bvh=${c.bvhVisible} ref=${c.refVisible}  ${ok}`);
  }
  if (totalFalseCulls === 0) {
    console.log("\nPASS: zero false culls along the whole rim->valley walk.");
  } else {
    console.log(`\nFAIL: ${totalFalseCulls} false culls (first at step ${worstFalseCullStep}).`);
  }
  console.log("report written to artifacts/horizon_culling_report.json");
}

main();
