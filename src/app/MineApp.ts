import { VoxelWorld } from '../world/VoxelWorld.js';
import { SparseOctree, DEFAULT_LOD, type LodOptions, type OctreeNode } from '../engine/Octree.js';
import { Mesher } from '../engine/Mesher.js';
import { RayPicker, type PickResult } from '../engine/RayPicker.js';
import { Renderer, type ViewMode } from '../render/Renderer.js';
import { LeafMeshManager, type MeshManagerStats } from '../render/LeafMeshManager.js';
import { CameraController } from './CameraController.js';
import { FIXED_SEED } from '../core/rng.js';

export interface HudStats {
  totalNodes: number;
  leafNodes: number;
  faces: number;
  batches: number;
  gpuLeaves: number;
  bufferReuses: number;
  cameraY: number;
  pick: string;
}

export class MineApp {
  readonly world: VoxelWorld;
  readonly octree: SparseOctree;
  readonly mesher: Mesher;
  readonly renderer: Renderer;
  readonly meshManager!: LeafMeshManager;
  readonly picker: RayPicker;
  readonly camera: CameraController;
  readonly lod: LodOptions = { ...DEFAULT_LOD };

  private leaves: OctreeNode[] = [];
  private meshStats: MeshManagerStats | null = null;
  private lastPick: PickResult | null = null;
  private lodDirty = true;
  private lastTime = performance.now();
  private rafId = 0;
  private onStats?: (stats: HudStats) => void;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.world = new VoxelWorld(FIXED_SEED);
    this.octree = new SparseOctree(this.world);
    this.mesher = new Mesher(this.world);
    this.renderer = new Renderer(canvas, null);
    this.meshManager = new LeafMeshManager(this.renderer.gl, this.mesher);
    this.renderer.attachMeshManager(this.meshManager);
    this.picker = new RayPicker(this.world);
    this.camera = new CameraController(canvas);
    this.bindKeys();
  }

  setStatsListener(fn: (stats: HudStats) => void): void {
    this.onStats = fn;
  }

  setMode(mode: ViewMode): void {
    this.renderer.mode = mode;
  }

  setLeafBoxes(visible: boolean): void {
    this.renderer.showLeafBoxes = visible;
  }

  get leafBoxesVisible(): boolean {
    return this.renderer.showLeafBoxes;
  }

  requestLodRefresh(): void {
    this.lodDirty = true;
  }

  setMaxNodeFaces(value: number): void {
    this.lod.maxNodeFaces = value;
    this.lodDirty = true;
  }

  setNeighborDiff(value: number): void {
    this.lod.maxNeighborLodDiff = value;
    this.lodDirty = true;
  }

  setLodScale(value: number): void {
    this.lod.lodScale = value;
    this.lodDirty = true;
  }

  get currentPick(): PickResult | null {
    return this.lastPick;
  }

  /** Pick through the current camera ray; independent of octree LOD. */
  pickAtScreen(clientX: number, clientY: number): PickResult | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;
    const ray = this.screenRay(ndcX, ndcY);
    this.lastPick = this.picker.pick(this.camera.eye, ray.dir);
    return this.lastPick;
  }

  pickFromCameraRay(): PickResult | null {
    const ray = this.screenRay(0, 0);
    this.lastPick = this.picker.pick(this.camera.eye, ray.dir);
    return this.lastPick;
  }

  private screenRay(ndcX: number, ndcY: number): { dir: { x: number; y: number; z: number } } {
    const f = this.camera.forward();
    const right = {
      x: Math.cos(this.camera.yaw),
      y: 0,
      z: -Math.sin(this.camera.yaw),
    };
    const up = {
      x: f.y * right.z - f.z * right.y,
      y: f.z * right.x - f.x * right.z,
      z: f.x * right.y - f.y * right.x,
    };
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const tanHalf = Math.tan(this.fovy / 2);
    const dir = {
      x: f.x + right.x * ndcX * tanHalf * aspect + up.x * ndcY * tanHalf,
      y: f.y + right.y * ndcX * tanHalf * aspect + up.y * ndcY * tanHalf,
      z: f.z + right.z * ndcX * tanHalf * aspect + up.z * ndcY * tanHalf,
    };
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    return { dir: { x: dir.x / len, y: dir.y / len, z: dir.z / len } };
  }

  readonly fovy = 0.9;

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyR') {
        this.camera.autoDescend = !this.camera.autoDescend;
      } else if (e.code === 'Digit1') {
        this.setMode('shaded');
      } else if (e.code === 'Digit2') {
        this.setMode('lod');
      } else if (e.code === 'Digit3') {
        this.setMode('wireframe');
      } else if (e.code === 'KeyB') {
        this.setLeafBoxes(!this.renderer.showLeafBoxes);
      } else if (e.code === 'KeyP') {
        this.pickFromCameraRay();
      }
    });
    this.canvas.addEventListener('click', (e) => {
      this.pickAtScreen(e.clientX, e.clientY);
    });
  }

  start(): void {
    const frame = () => {
      this.frame();
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
  }

  /** One simulation + render step; also callable directly from tests. */
  frame(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    this.camera.update(dt, this.world.size);
    this.renderer.resize(this.canvas.clientWidth, this.canvas.clientHeight);

    if (this.lodDirty) {
      this.rebuildLod();
      this.lodDirty = false;
    }

    const cameraState = {
      eye: this.camera.eye,
      target: this.camera.target(),
      up: { x: 0, y: 1, z: 0 },
      fovy: this.fovy,
    };
    this.renderer.render(
      this.leaves,
      cameraState,
      this.lastPick ? this.lastPick.voxel : null,
    );
    this.emitStats();
  }

  rebuildLod(): OctreeNode[] {
    this.leaves = this.octree.update(
      this.camera.eye,
      this.lod,
      (node) => this.mesher.countExposedFaces(node),
    );
    this.meshStats = this.meshManager.sync(this.leaves);
    return this.leaves;
  }

  private emitStats(): void {
    if (this.onStats === undefined) {
      return;
    }
    const solidLeaves = this.leaves.filter((n) => n.kind !== 'air').length;
    this.onStats({
      totalNodes: this.octree.totalNodes(),
      leafNodes: solidLeaves,
      faces: this.meshStats?.totalFaces ?? 0,
      batches: this.meshStats?.totalBatches ?? 0,
      gpuLeaves: this.meshStats?.gpuLeaves ?? 0,
      bufferReuses: this.meshStats?.bufferReuses ?? 0,
      cameraY: this.camera.eye.y,
      pick: this.lastPick
        ? `(${(this.lastPick.voxel.x)}, ${this.lastPick.voxel.y}, ${this.lastPick.voxel.z}) mat=${this.lastPick.material}`
        : 'none',
    });
  }

  dispose(): void {
    this.stop();
    this.camera.dispose();
    this.meshManager.dispose();
    this.renderer.dispose();
  }
}
