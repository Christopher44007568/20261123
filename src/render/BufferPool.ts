/**
 * Recycled WebGL buffer storage, separated by binding target.
 *
 * A WebGL buffer keeps its first binding target (ARRAY_BUFFER vs
 * ELEMENT_ARRAY_BUFFER), so the pool tracks VBOs and EBOs independently.
 * When octree leaves split or merge, old buffers are returned to the pool
 * instead of being deleted; new leaves first claim a pooled buffer of
 * sufficient capacity. Positions stay in world coordinates and buffers are
 * never relocated, so LOD switches cannot introduce geometry drift.
 */
export class BufferPool {
  private readonly freeByTarget = new Map<number, WebGLBuffer[]>();
  private readonly activeByTarget = new Map<number, Set<WebGLBuffer>>();
  private readonly sizes = new WeakMap<WebGLBuffer, number>();
  private readonly targetOf = new WeakMap<WebGLBuffer, number>();
  private allocations = 0;
  private reuses = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  private buckets(target: number): { free: WebGLBuffer[]; active: Set<WebGLBuffer> } {
    let free = this.freeByTarget.get(target);
    if (free === undefined) {
      free = [];
      this.freeByTarget.set(target, free);
    }
    let active = this.activeByTarget.get(target);
    if (active === undefined) {
      active = new Set<WebGLBuffer>();
      this.activeByTarget.set(target, active);
    }
    return { free, active };
  }

  acquire(byteLength: number, target: number): { buffer: WebGLBuffer; reused: boolean } {
    const { free, active } = this.buckets(target);
    let bestIndex = -1;
    let bestSize = Number.POSITIVE_INFINITY;
    for (let i = 0; i < free.length; i += 1) {
      const size = this.sizes.get(free[i]) ?? 0;
      if (size >= byteLength && size < bestSize) {
        bestSize = size;
        bestIndex = i;
      }
    }

    let buffer: WebGLBuffer;
    let reused: boolean;
    if (bestIndex >= 0) {
      buffer = free.splice(bestIndex, 1)[0];
      reused = true;
      this.reuses += 1;
    } else {
      const created = this.gl.createBuffer();
      if (created === null) {
        throw new Error('failed to allocate WebGL buffer');
      }
      buffer = created;
      this.allocations += 1;
      reused = false;
    }

    this.gl.bindBuffer(target, buffer);
    this.gl.bufferData(target, byteLength, this.gl.DYNAMIC_DRAW);
    active.add(buffer);
    this.sizes.set(buffer, byteLength);
    this.targetOf.set(buffer, target);
    return { buffer, reused };
  }

  sizeOf(buffer: WebGLBuffer): number {
    return this.sizes.get(buffer) ?? 0;
  }

  release(buffer: WebGLBuffer): void {
    const target = this.targetOf.get(buffer);
    if (target === undefined) {
      return;
    }
    const active = this.activeByTarget.get(target);
    if (active?.delete(buffer)) {
      this.freeByTarget.get(target)?.push(buffer);
    }
  }

  /** Recycle a buffer acquired for a transient (per-frame) line mesh. */
  recycle(buffer: WebGLBuffer): void {
    const target = this.targetOf.get(buffer);
    if (target === undefined) {
      return;
    }
    this.activeByTarget.get(target)?.delete(buffer);
    const free = this.freeByTarget.get(target);
    if (free !== undefined && !free.includes(buffer)) {
      free.push(buffer);
    }
  }

  dispose(): void {
    for (const free of this.freeByTarget.values()) {
      for (const buffer of free) {
        this.gl.deleteBuffer(buffer);
      }
      free.length = 0;
    }
    for (const active of this.activeByTarget.values()) {
      for (const buffer of active) {
        this.gl.deleteBuffer(buffer);
      }
      active.clear();
    }
  }

  get stats(): { allocated: number; pooled: number; active: number; reuses: number } {
    let pooled = 0;
    let activeCount = 0;
    for (const free of this.freeByTarget.values()) {
      pooled += free.length;
    }
    for (const active of this.activeByTarget.values()) {
      activeCount += active.size;
    }
    return {
      allocated: this.allocations,
      pooled,
      active: activeCount,
      reuses: this.reuses,
    };
  }
}
