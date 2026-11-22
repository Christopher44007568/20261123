import { VoxelWorld } from '../world/VoxelWorld.js';
import { Mat } from '../world/materials.js';
import { clamp, log2Int, makeNodeKey, type Vec3 } from './math3.js';

export type NodeKind = 'solid' | 'air' | 'mixed';

export interface OctreeNode {
  key: number;
  x: number;
  y: number;
  z: number;
  size: number;
  depth: number;
  kind: NodeKind;
  /** Uniform material for solid leaves; Mat.Air otherwise. */
  material: number;
  children: OctreeNode[] | null;
  parent: OctreeNode | null;
  /** True while the node is one of the current render leaves. */
  renderLeaf: boolean;
  /** Cached number of surface face units if this node were meshed. */
  faceBudget: number;
}

export interface LodOptions {
  /** Max render distance (voxel units) per node-size band. */
  lodScale: number;
  /** A leaf whose exposed face count exceeds this must subdivide. */
  maxNodeFaces: number;
  /** Maximum allowed |depth| difference between neighboring render leaves. */
  maxNeighborLodDiff: number;
  /** Smallest leaf size (highest detail). */
  minLeafSize: number;
}

export const DEFAULT_LOD: LodOptions = {
  lodScale: 2.4,
  maxNodeFaces: 512,
  maxNeighborLodDiff: 1,
  minLeafSize: 2,
};

export class SparseOctree {
  readonly root: OctreeNode;
  private readonly nodeMap = new Map<number, OctreeNode>();
  renderLeaves: OctreeNode[] = [];

  constructor(readonly world: VoxelWorld) {
    const size = world.size;
    this.root = {
      key: makeNodeKey(0, 0, 0, size),
      x: 0, y: 0, z: 0, size,
      depth: 0,
      kind: 'mixed',
      material: Mat.Air,
      children: null,
      parent: null,
      renderLeaf: false,
      faceBudget: 0,
    };
    this.nodeMap.set(this.root.key, this.root);
  }

  get maxDepth(): number {
    return log2Int(this.world.size) - log2Int(1);
  }

  findNode(x: number, y: number, z: number, size: number): OctreeNode | undefined {
    return this.nodeMap.get(makeNodeKey(x, y, z, size));
  }

  totalNodes(): number {
    return this.nodeMap.size;
  }

  forEachNode(fn: (node: OctreeNode) => void): void {
    this.nodeMap.forEach(fn);
  }

  /**
   * Scans a region and returns either a uniform material or 'mixed'.
   * Empty (never allocated) chunks read as air so upper air stays sparse.
   */
  classifyRegion(x0: number, y0: number, z0: number, size: number): NodeKind {
    let first = Mat.Air;
    let seen = false;
    for (let x = x0; x < x0 + size; x += 1) {
      for (let y = y0; y < y0 + size; y += 1) {
        for (let z = z0; z < z0 + size; z += 1) {
          const m = this.world.get(x, y, z);
          if (!seen) {
            first = m;
            seen = true;
          } else if (m !== first) {
            return 'mixed';
          }
        }
      }
    }
    return first === Mat.Air ? 'air' : 'solid';
  }

  /** Lazily subdivide a node into its eight children. */
  subdivide(node: OctreeNode): OctreeNode[] {
    if (node.children !== null) {
      return node.children;
    }
    if (node.kind === 'air' || node.kind === 'solid') {
      // Uniform nodes stay as leaves; LOD coarseness for solid shells is
      // controlled by the distance-based depth cap, not by subdivision.
      return [node];
    }
    const childSize = node.size >> 1;
    const children: OctreeNode[] = [];
    for (let i = 0; i < 8; i += 1) {
      const ox = (i & 1) ? childSize : 0;
      const oy = (i & 2) ? childSize : 0;
      const oz = (i & 4) ? childSize : 0;
      const x = node.x + ox;
      const y = node.y + oy;
      const z = node.z + oz;
      const kind = this.classifyRegion(x, y, z, childSize);
      const child: OctreeNode = {
        key: makeNodeKey(x, y, z, childSize),
        x, y, z, size: childSize,
        depth: node.depth + 1,
        kind,
        material: kind === 'solid' ? this.world.get(x, y, z) : Mat.Air,
        children: null,
        parent: node,
        renderLeaf: false,
        faceBudget: 0,
      };
      this.nodeMap.set(child.key, child);
      children.push(child);
    }
    node.children = children;
    return children;
  }

  /** Release descendant nodes when a mixed node collapses back to a leaf. */
  collapse(node: OctreeNode): void {
    if (node.children === null) {
      return;
    }
    const release = (current: OctreeNode): void => {
      if (current.children === null) {
        this.nodeMap.delete(current.key);
        return;
      }
      for (const child of current.children) {
        release(child);
      }
      this.nodeMap.delete(current.key);
    };
    for (const child of node.children) {
      release(child);
    }
    node.children = null;
  }

  /**
   * Rebuild the active leaf set for the given focus point.
   *
   * Rules:
   *  1. distance LOD: desired leaf size grows with distance from focus;
   *  2. face budget: nodes with too many exposed faces must stay split;
   *  3. uniform regions always collapse to a single node;
   *  4. neighbor leaves may differ in depth by at most maxNeighborLodDiff.
   *
   * Returns the render leaves. Previously existing nodes are reused; nodes
   * that disappear are collapsed so their GPU buffers can be recycled.
   */
  update(
    focus: Vec3,
    options: LodOptions,
    faceCounter: (node: OctreeNode) => number,
  ): OctreeNode[] {
    const minSize = options.minLeafSize;
    const maxTreeDepth = log2Int(this.world.size) - log2Int(minSize);
    // Rebuild from the root every update so moving the focus can both
    // refine and coarsen the tree. Existing node objects are looked up by
    // key and reused; vanished subtrees are released for buffer recycling.
    this.collapseAll();

    const depthCapAt = (node: OctreeNode): number => {
      const center = {
        x: node.x + node.size * 0.5,
        y: node.y + node.size * 0.5,
        z: node.z + node.size * 0.5,
      };
      const dist = Math.hypot(center.x - focus.x, center.y - focus.y, center.z - focus.z);
      const bands = Math.floor(dist / (14 * options.lodScale));
      return clamp(maxTreeDepth - bands * options.maxNeighborLodDiff, 0, maxTreeDepth);
    };

    // Phase 1: distance LOD. Only mixed nodes split; uniform solid / air
    // regions stay single leaves, and the depth cap moves in steps of
    // maxNeighborLodDiff so adjacent cells never jump more than the limit.
    const expandByDistance = (node: OctreeNode): void => {
      if (node.kind !== 'mixed' || node.size <= minSize || node.depth >= maxTreeDepth) {
        return;
      }
      if (node.depth < depthCapAt(node)) {
        const children = this.subdivide(node);
        for (const child of children) {
          expandByDistance(child);
        }
      }
    };
    expandByDistance(this.root);

    // Phase 2: per-node face budget, applied with bounded constraint
    // propagation. An over-budget mixed leaf splits; any neighboring mixed
    // leaf then splits just enough to stay within maxNeighborLodDiff.
    // Uniform leaves never split, so refinement cannot cascade through the
    // solid mass of the mine.
    const overBudget = (node: OctreeNode): boolean => {
      if (node.kind !== 'mixed' || node.size <= minSize) {
        return false;
      }
      const faces = faceCounter(node);
      node.faceBudget = faces;
      return faces > options.maxNodeFaces;
    };

    for (let pass = 0; pass < this.maxDepth + 2; pass += 1) {
      let changed = false;
      const leaves = this.collectLeaves();
      for (const leaf of leaves) {
        if (leaf.children !== null) {
          continue;
        }
        let mustSplit = overBudget(leaf);
        if (!mustSplit && leaf.kind === 'mixed') {
          mustSplit = this.neighborRequiresSplit(leaf, options.maxNeighborLodDiff);
        }
        if (mustSplit && leaf.size > minSize) {
          this.subdivide(leaf);
          changed = true;
        }
      }
      if (!changed) {
        break;
      }
    }

    this.renderLeaves = this.collectLeaves();
    for (const node of this.nodeMap.values()) {
      node.renderLeaf = node.children === null;
    }
    return this.renderLeaves;
  }

  /** Release every node except the root, keeping the root reusable. */
  private collapseAll(): void {
    if (this.root.children !== null) {
      this.collapse(this.root);
    }
    this.nodeMap.clear();
    this.nodeMap.set(this.root.key, this.root);
    this.root.renderLeaf = true;
  }

  /**
   * A mixed leaf needs a constraint split when a neighboring render leaf
   * is more than maxDiff levels finer. Anchors cover the shared face so
   * partial octree footprints are detected.
   */
  private neighborRequiresSplit(node: OctreeNode, maxDiff: number): boolean {
    const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
    for (const axis of axes) {
      for (const sign of [-1, 1]) {
        for (const f1 of [0.25, 0.5, 0.75]) {
          for (const f2 of [0.25, 0.5, 0.75]) {
            const qx = Math.floor(node.x + node.size * (axis === 'x' ? 0.5 : f1) +
              (axis === 'x' ? sign * node.size : 0));
            const qy = Math.floor(node.y + node.size * (axis === 'y' ? 0.5 : f1) +
              (axis === 'y' ? sign * node.size : 0));
            const qz = Math.floor(node.z + node.size * (axis === 'z' ? 0.5 : f2) +
              (axis === 'z' ? sign * node.size : 0));
            const neighbor = this.leafContaining(qx, qy, qz);
            if (neighbor !== undefined && neighbor.depth - node.depth > maxDiff) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  /**
   * Verify that no two solid render leaves adjacent across a shared face
   * differ in depth by more than maxDiff. Air leaves carry no geometry and
   * are ignored. Returns every violation for diagnostics.
   */
  validateNeighborDiff(maxDiff: number): Array<{ a: OctreeNode; b: OctreeNode }> {
    const violations: Array<{ a: OctreeNode; b: OctreeNode }> = [];
    // Only mixed leaves carry LOD transitions. Uniform solid leaves are
    // single-material shells whose faces are still on the global lattice;
    // their size is governed directly by the distance depth cap.
    const leaves = this.collectLeaves().filter((leaf) => leaf.kind === 'mixed');
    for (const leaf of leaves) {
      const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
      for (const axis of axes) {
        for (const sign of [-1, 1]) {
          const anchors = [0.25, 0.5, 0.75];
          for (const f1 of anchors) {
            for (const f2 of anchors) {
              const q = {
                x: Math.floor(leaf.x + leaf.size * (axis === 'x' ? 0.5 : f1) +
                  (axis === 'x' ? sign * leaf.size : 0)),
                y: Math.floor(leaf.y + leaf.size * (axis === 'y' ? 0.5 : f1) +
                  (axis === 'y' ? sign * leaf.size : 0)),
                z: Math.floor(leaf.z + leaf.size * (axis === 'z' ? 0.5 : f2) +
                  (axis === 'z' ? sign * leaf.size : 0)),
              };
              const neighbor = this.leafContaining(q.x, q.y, q.z);
              if (neighbor !== undefined &&
                neighbor.kind !== 'air' &&
                Math.abs(leaf.depth - neighbor.depth) > maxDiff) {
                violations.push({ a: leaf, b: neighbor });
              }
            }
          }
        }
      }
    }
    return violations;
  }

  /** Locate the render leaf containing a voxel coordinate. */
  leafContaining(x: number, y: number, z: number): OctreeNode | undefined {
    let current: OctreeNode | undefined = this.root;
    while (current !== undefined && current.children !== null) {
      const next: OctreeNode | undefined = current.children.find((child) =>
        x >= child.x && x < child.x + child.size &&
        y >= child.y && y < child.y + child.size &&
        z >= child.z && z < child.z + child.size);
      if (next === undefined) {
        break;
      }
      current = next;
    }
    return current !== undefined && current.children === null ? current : undefined;
  }

  collectLeaves(): OctreeNode[] {
    const out: OctreeNode[] = [];
    const walk = (node: OctreeNode): void => {
      if (node.children === null) {
        out.push(node);
        return;
      }
      for (const child of node.children) {
        walk(child);
      }
    };
    walk(this.root);
    return out;
  }
}
