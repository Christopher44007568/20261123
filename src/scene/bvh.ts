// BVH over scene objects. Interior nodes are shared parents: a single
// horizon test on a parent conservatively culls its whole subtree, which is
// where the big candidate reductions come from.

import type { Vec3 } from "../math/vec3.ts";
import type { SceneObject } from "./objects.ts";

export interface BvhNode {
  /** Bounding sphere of the whole subtree. */
  bsCenter: Vec3;
  bsRadius: number;
  /** Tight AABB corners (8) of the subtree, for the fallback test. */
  aabbCorners: Vec3[];
  /** Leaf range into Bvh.objectIndices (inclusive start, exclusive end). */
  start: number;
  end: number;
  left: BvhNode | null;
  right: BvhNode | null;
  parent: BvhNode | null;
  depth: number;
}

export interface Bvh {
  root: BvhNode;
  /** Object indices reordered so each leaf owns a contiguous range. */
  objectIndices: number[];
  nodeCount: number;
  leafCount: number;
}

const LEAF_SIZE = 4;

function aabbOfPoints(points: Vec3[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      if (p[i]! < min[i]!) min[i] = p[i]!;
      if (p[i]! > max[i]!) max[i] = p[i]!;
    }
  }
  return { min, max };
}

function aabbCorners(min: Vec3, max: Vec3): Vec3[] {
  const c: Vec3[] = [];
  for (const x of [min[0], max[0]])
    for (const y of [min[1], max[1]])
      for (const z of [min[2], max[2]]) c.push([x, y, z]);
  return c;
}

function sphereFromCorners(corners: Vec3[]): { center: Vec3; radius: number } {
  const { min, max } = aabbOfPoints(corners);
  const center: Vec3 = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  let radius = 0;
  for (const p of corners) {
    const d = Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]);
    if (d > radius) radius = d;
  }
  return { center, radius };
}

/** Expand 21-bit Morton code for a coordinate in [0, 1023]. */
function morton3(x: number): number {
  x = Math.max(0, Math.min(1023, Math.floor(x)));
  x = (x | (x << 16)) & 0x030000ff;
  x = (x | (x << 8)) & 0x0300f00f;
  x = (x | (x << 4)) & 0x030c30c3;
  x = (x | (x << 2)) & 0x09249249;
  return x;
}

export function buildBvh(objects: SceneObject[]): Bvh {
  const n = objects.length;
  if (n === 0) throw new Error("buildBvh: empty scene");

  // Scene AABB for normalising positions into Morton codes.
  const all: Vec3[] = [];
  for (const o of objects) all.push(...o.aabbCorners);
  const sceneBox = aabbOfPoints(all);
  const span: Vec3 = [
    Math.max(1e-6, sceneBox.max[0] - sceneBox.min[0]),
    Math.max(1e-6, sceneBox.max[1] - sceneBox.min[1]),
    Math.max(1e-6, sceneBox.max[2] - sceneBox.min[2]),
  ];

  const keyed = objects.map((o, i) => {
    const c = o.bsCenter;
    const mx = morton3(((c[0] - sceneBox.min[0]) / span[0]) * 1023);
    const my = morton3(((c[1] - sceneBox.min[1]) / span[1]) * 1023);
    const mz = morton3(((c[2] - sceneBox.min[2]) / span[2]) * 1023);
    return { i, code: (mx << 2) | (my << 1) | mz };
  });
  keyed.sort((a, b) => a.code - b.code);
  const objectIndices = keyed.map((k) => k.i);

  let nodeCount = 0;
  let leafCount = 0;

  function build(start: number, end: number, parent: BvhNode | null, depth: number): BvhNode {
    // Gather subtree corners from member objects.
    const corners: Vec3[] = [];
    for (let k = start; k < end; k++) corners.push(...objects[objectIndices[k]!]!.aabbCorners);
    const box = aabbOfPoints(corners);
    const nodeCorners = aabbCorners(box.min, box.max);
    const sphere = sphereFromCorners(nodeCorners);

    const node: BvhNode = {
      bsCenter: sphere.center,
      bsRadius: sphere.radius,
      aabbCorners: nodeCorners,
      start,
      end,
      left: null,
      right: null,
      parent,
      depth,
    };
    nodeCount++;

    if (end - start <= LEAF_SIZE) {
      leafCount++;
      return node;
    }
    const mid = start + ((end - start) >> 1);
    node.left = build(start, mid, node, depth + 1);
    node.right = build(mid, end, node, depth + 1);
    return node;
  }

  const root = build(0, n, null, 0);
  return { root, objectIndices, nodeCount, leafCount };
}
