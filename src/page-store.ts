import type { CameraSnapshot } from "./camera";
import { decidePage, SLOT_MISSING } from "./culling";
import { buildPageGeometry } from "./geometry/build";
import type { BuiltScene } from "./geometry/build";
import { pageVertexCount } from "./geometry/types";
import { gpuView } from "./gpu/write";

export const SLOT_COUNT = 128;
export const PAGE_INDEX_STRIDE = 30720;
export const PAGE_VERTEX_STRIDE = pageVertexCount(0) + pageVertexCount(1);

export interface PageStoreStats {
  residentPages: number;
  loadedThisFrame: number;
  evictedThisFrame: number;
  pendingNeeded: number;
}

export class PageStore {
  readonly slots: Uint32Array;
  readonly residentSlotsBuffer: GPUBuffer;
  private readonly slotPages: Int32Array;
  private readonly slotLastUsed: Float64Array;
  private readonly device: GPUDevice;
  private readonly scene: BuiltScene;
  private readonly indexBuffer: GPUBuffer;
  private readonly vertexBuffer: GPUBuffer;
  private readonly staticIndexCount: number;
  private readonly staticVertexCount: number;
  private clock = 0;
  private dirty = true;

  constructor(
    device: GPUDevice,
    scene: BuiltScene,
    indexBuffer: GPUBuffer,
    vertexBuffer: GPUBuffer,
  ) {
    this.device = device;
    this.scene = scene;
    this.indexBuffer = indexBuffer;
    this.vertexBuffer = vertexBuffer;
    this.staticIndexCount = scene.staticIndexCount;
    this.staticVertexCount = scene.staticVertexCount;
    this.slots = new Uint32Array(scene.pages.length).fill(SLOT_MISSING);
    this.slotPages = new Int32Array(SLOT_COUNT).fill(-1);
    this.slotLastUsed = new Float64Array(SLOT_COUNT);
    this.residentSlotsBuffer = device.createBuffer({
      label: "resident-page-slots",
      size: Math.max(16, this.slots.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.residentSlotsBuffer, 0, gpuView(this.slots));
  }

  get pageCount(): number {
    return this.scene.pages.length;
  }

  get residentCount(): number {
    let count = 0;
    for (const value of this.slots) if (value !== SLOT_MISSING) count++;
    return count;
  }

  publicStats(): PageStoreStats {
    return {
      residentPages: this.residentCount,
      loadedThisFrame: 0,
      evictedThisFrame: 0,
      pendingNeeded: 0,
    };
  }

  update(
    camera: CameraSnapshot,
    errorThresholdPx: number,
    loadBudget = 8,
  ): PageStoreStats {
    this.clock += 1;
    const wanted: { page: number; distance: number }[] = [];
    for (const meta of this.scene.pageMetas) {
      const decision = decidePage(meta, camera, this.slots, errorThresholdPx);
      if (decision.rawLod <= 1) wanted.push({ page: meta.page, distance: decision.distance });
    }
    wanted.sort((a, b) => a.distance - b.distance);
    const wantedSet = new Set(wanted.map((item) => item.page));
    let loaded = 0;
    let evicted = 0;

    for (const item of wanted) {
      if (this.slots[item.page] !== SLOT_MISSING) {
        this.slotLastUsed[this.slots[item.page]!] = this.clock;
        continue;
      }
      if (loaded >= loadBudget) break;
      let slot = this.findFreeSlot();
      if (slot < 0) {
        slot = this.chooseEvictionSlot(wantedSet);
        if (slot < 0) break;
        this.evict(slot);
        evicted++;
      }
      this.uploadPage(item.page, slot);
      loaded++;
    }

    const pendingNeeded = wanted.filter((item) => this.slots[item.page] === SLOT_MISSING).length;
    if (this.dirty) {
      this.device.queue.writeBuffer(this.residentSlotsBuffer, 0, gpuView(this.slots));
      this.dirty = false;
    }
    return {
      residentPages: this.residentCount,
      loadedThisFrame: loaded,
      evictedThisFrame: evicted,
      pendingNeeded,
    };
  }

  forceResident(page: number): number {
    const existing = this.slots[page]!;
    if (existing !== SLOT_MISSING) return existing;
    let slot = this.findFreeSlot();
    if (slot < 0) {
      slot = this.chooseEvictionSlot(new Set([page]));
      if (slot < 0) return -1;
      this.evict(slot);
    }
    this.uploadPage(page, slot);
    this.device.queue.writeBuffer(this.residentSlotsBuffer, 0, gpuView(this.slots));
    this.dirty = false;
    return slot;
  }

  clear(): void {
    this.slots.fill(SLOT_MISSING);
    this.slotPages.fill(-1);
    this.slotLastUsed.fill(0);
    this.dirty = true;
    this.device.queue.writeBuffer(this.residentSlotsBuffer, 0, gpuView(this.slots));
    this.dirty = false;
  }

  private findFreeSlot(): number {
    return this.slotPages.indexOf(-1);
  }

  private chooseEvictionSlot(wanted: Set<number>): number {
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const page = this.slotPages[slot]!;
      if (page >= 0 && !wanted.has(page)) return slot;
    }
    let bestSlot = -1;
    let oldest = Infinity;
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      if (this.slotLastUsed[slot]! < oldest) {
        oldest = this.slotLastUsed[slot]!;
        bestSlot = slot;
      }
    }
    return bestSlot;
  }

  private evict(slot: number): void {
    const page = this.slotPages[slot]!;
    if (page >= 0) this.slots[page] = SLOT_MISSING;
    this.slotPages[slot] = -1;
    this.slotLastUsed[slot] = 0;
    this.dirty = true;
  }

  private uploadPage(page: number, slot: number): void {
    const pageRecord = this.scene.pages[page]!;
    for (const lod of [0, 1] as const) {
      const geometry = buildPageGeometry(pageRecord, lod);
      const localIndexBase = lod === 0 ? 0 : 24576;
      const indexBase = this.staticIndexCount + slot * PAGE_INDEX_STRIDE + localIndexBase;
      const localVertexBase = lod === 0 ? 0 : pageVertexCount(0);
      const vertexBase = this.staticVertexCount + slot * PAGE_VERTEX_STRIDE + localVertexBase;
      this.device.queue.writeBuffer(this.indexBuffer, indexBase * 4, gpuView(geometry.indices));
      this.device.queue.writeBuffer(
        this.vertexBuffer,
        vertexBase * 8 * 4,
        gpuView(geometry.vertices),
      );
    }
    this.slots[page] = slot;
    this.slotPages[slot] = page;
    this.slotLastUsed[slot] = this.clock;
    this.dirty = true;
  }
}
