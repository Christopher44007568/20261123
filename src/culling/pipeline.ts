// Culling pipeline: BVH traversal with shared-parent culling and fast
// fallback, plus a per-object reference mode used to count false culls.

import type { SceneObject } from "../scene/objects.ts";
import type { Bvh, BvhNode } from "../scene/bvh.ts";
import type { HorizonContext } from "./horizon.ts";
import { isPointOccluded, testBoundingSphere, testAabbCorners } from "./horizon.ts";

export type CullMode =
  | "bvh"       // hierarchical: shared-parent cull + corner fallback
  | "reference" // per-object exact reference (ground truth)
  | "none";     // no culling (draw everything)

export interface CullStats {
  mode: CullMode;
  totalObjects: number;
  /** Objects whose visibility had to be decided individually. */
  candidates: number;
  /** Objects culled (directly or via a shared parent subtree). */
  culled: number;
  visible: number;
  cullRate: number;
  /** Objects culled by a shared parent test (never individually visited). */
  culledByParent: number;
  /** Node tests that used the AABB corner fallback. */
  cornerFallbacks: number;
  nodeTests: number;
}

export interface CullResult {
  visible: number[]; // object ids
  culled: number[];
  stats: CullStats;
}

function emptyStats(mode: CullMode, total: number): CullStats {
  return {
    mode,
    totalObjects: total,
    candidates: 0,
    culled: 0,
    visible: 0,
    cullRate: 0,
    culledByParent: 0,
    cornerFallbacks: 0,
    nodeTests: 0,
  };
}

function finishStats(s: CullStats): void {
  s.visible = s.totalObjects - s.culled;
  s.cullRate = s.totalObjects > 0 ? s.culled / s.totalObjects : 0;
}

/** Per-object conservative test used at leaves of the BVH pipeline. */
function cullObject(ctx: HorizonContext, obj: SceneObject): boolean {
  if (testBoundingSphere(ctx, obj.bsCenter, obj.bsRadius) === "culled") return true;
  return testAabbCorners(ctx, obj.aabbCorners) === "culled";
}

/**
 * Reference visibility: an object is truly invisible only if every reference
 * sample point (corners + top-face grid) is exactly occluded. This is the
 * ground truth used to count false culls of the BVH pipeline.
 */
export function referenceVisible(ctx: HorizonContext, obj: SceneObject): boolean {
  for (const p of obj.refPoints) {
    if (!isPointOccluded(ctx, p)) return true;
  }
  return false;
}

export function cullScene(
  mode: CullMode,
  ctx: HorizonContext,
  bvh: Bvh,
  objects: SceneObject[],
): CullResult {
  if (mode === "none") {
    const stats = emptyStats(mode, objects.length);
    stats.candidates = objects.length;
    finishStats(stats);
    return { visible: objects.map((o) => o.id), culled: [], stats };
  }

  if (mode === "reference") {
    const stats = emptyStats(mode, objects.length);
    const visible: number[] = [];
    const culled: number[] = [];
    for (const obj of objects) {
      stats.candidates++;
      stats.nodeTests++;
      if (referenceVisible(ctx, obj)) visible.push(obj.id);
      else culled.push(obj.id);
    }
    stats.culled = culled.length;
    finishStats(stats);
    return { visible, culled, stats };
  }

  // Hierarchical mode.
  const stats = emptyStats(mode, objects.length);
  const visible: number[] = [];
  const culled: number[] = [];

  function cullSubtree(node: BvhNode): void {
    const count = node.end - node.start;
    for (let k = node.start; k < node.end; k++) {
      culled.push(objects[bvh.objectIndices[k]!]!.id);
    }
    stats.culled += count;
    stats.culledByParent += count;
  }

  function visit(node: BvhNode): void {
    stats.nodeTests++;
    // 1) cheap conservative sphere test on the shared parent
    if (testBoundingSphere(ctx, node.bsCenter, node.bsRadius) === "culled") {
      cullSubtree(node);
      return;
    }
    // 2) fast fallback: tighter AABB corner test before descending
    if (testAabbCorners(ctx, node.aabbCorners) === "culled") {
      stats.cornerFallbacks++;
      cullSubtree(node);
      return;
    }
    // 3) inconclusive: descend (or test leaves individually)
    if (node.left === null && node.right === null) {
      for (let k = node.start; k < node.end; k++) {
        const obj = objects[bvh.objectIndices[k]!]!;
        stats.candidates++;
        stats.nodeTests++;
        if (cullObject(ctx, obj)) {
          culled.push(obj.id);
          stats.culled++;
        } else {
          visible.push(obj.id);
        }
      }
      return;
    }
    visit(node.left!);
    visit(node.right!);
  }

  visit(bvh.root);
  finishStats(stats);
  return { visible, culled, stats };
}

/**
 * Count false culls: objects the pipeline culled that the exact per-object
 * reference considers (at least partially) visible.
 */
export function countFalseCulls(
  ctx: HorizonContext,
  objects: SceneObject[],
  pipelineCulled: number[],
): { falseCulls: number; falseCulledIds: number[] } {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const falseCulledIds: number[] = [];
  for (const id of pipelineCulled) {
    const obj = byId.get(id);
    if (obj && referenceVisible(ctx, obj)) falseCulledIds.push(id);
  }
  return { falseCulls: falseCulledIds.length, falseCulledIds };
}
