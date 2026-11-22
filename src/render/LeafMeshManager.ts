import type { OctreeNode } from '../engine/Octree.js';
import type { Mesher, Quad } from '../engine/Mesher.js';
import { BufferPool } from './BufferPool.js';

/**
 * Interleaved vertex:
 *   position (3f) + normal (3f) + material (1f) + lod tint (1f) = 8 floats
 */
const FLOATS_PER_VERTEX = 8;
const VERTS_PER_QUAD = 4;
const INDICES_PER_QUAD = 6;

export interface GpuBatch {
  material: number;
  indexOffset: number;
  indexCount: number;
}

export interface GpuLeafMesh {
  nodeKey: number;
  vbo: WebGLBuffer;
  ebo: WebGLBuffer;
  indexCount: number;
  batches: GpuBatch[];
  vertexCount: number;
  /** Incremental signature so unchanged leaves never re-upload. */
  signature: number;
}

export interface MeshManagerStats {
  gpuLeaves: number;
  totalBatches: number;
  totalFaces: number;
  totalIndices: number;
  bufferReuses: number;
}

export class LeafMeshManager {
  private readonly meshes = new Map<number, GpuLeafMesh>();
  private readonly pool: BufferPool;
  private totalFaces = 0;
  private totalBatches = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly mesher: Mesher,
  ) {
    this.pool = new BufferPool(gl);
  }

  get activeMeshes(): IterableIterator<GpuLeafMesh> {
    return this.meshes.values();
  }

  get meshCount(): number {
    return this.meshes.size;
  }

  /**
   * Synchronize GPU meshes with the current render leaves.
   * Leaves keep their node key; unchanged geometry is left untouched,
   * removed leaves return buffers to the pool, new leaves claim them.
   */
  sync(leaves: OctreeNode[]): MeshManagerStats {
    const wanted = new Set<number>();
    for (const leaf of leaves) {
      if (leaf.kind === 'air') {
        continue;
      }
      wanted.add(leaf.key);
      this.ensureLeaf(leaf);
    }
    for (const [key, mesh] of this.meshes) {
      if (!wanted.has(key)) {
        this.releaseLeaf(mesh);
        this.meshes.delete(key);
      }
    }
    this.totalFaces = 0;
    this.totalBatches = 0;
    let totalIndices = 0;
    for (const mesh of this.meshes.values()) {
      this.totalFaces += mesh.indexCount / INDICES_PER_QUAD;
      this.totalBatches += mesh.batches.length;
      totalIndices += mesh.indexCount;
    }
    return {
      gpuLeaves: this.meshes.size,
      totalBatches: this.totalBatches,
      totalFaces: this.totalFaces,
      totalIndices,
      bufferReuses: this.pool.stats.reuses,
    };
  }

  private ensureLeaf(node: OctreeNode): void {
    const data = this.mesher.buildLeafMesh(node);
    const signature = this.signatureOf(node, data.faceCount, data.batches.length);
    const existing = this.meshes.get(node.key);
    if (existing !== undefined && existing.signature === signature) {
      return;
    }

    const quadCount = data.quads.length;
    if (quadCount === 0) {
      if (existing !== undefined) {
        this.releaseLeaf(existing);
        this.meshes.delete(node.key);
      }
      return;
    }

    const tint = node.depth % 6;
    const vertices = new Float32Array(quadCount * VERTS_PER_QUAD * FLOATS_PER_VERTEX);
    const indices = new Uint32Array(quadCount * INDICES_PER_QUAD);
    const batches: GpuBatch[] = [];

    let vCursor = 0;
    let iCursor = 0;
    let baseVertex = 0;
    let currentMaterial = -1;
    let currentBatch: GpuBatch | null = null;

    const ordered = [...data.quads].sort((a, b) =>
      a.material - b.material || a.axis - b.axis || a.sign - b.sign);
    for (const quad of ordered) {
      if (quad.material !== currentMaterial) {
        currentMaterial = quad.material;
        currentBatch = { material: quad.material, indexOffset: iCursor, indexCount: 0 };
        batches.push(currentBatch);
      }
      this.appendQuad(vertices, indices, quad, vCursor, iCursor, baseVertex, tint);
      currentBatch!.indexCount += INDICES_PER_QUAD;
      vCursor += VERTS_PER_QUAD * FLOATS_PER_VERTEX;
      iCursor += INDICES_PER_QUAD;
      baseVertex += VERTS_PER_QUAD;
    }

    const vbo = existing?.vbo;
    const ebo = existing?.ebo;
    const vertexBytes = vertices.byteLength;
    const indexBytes = indices.byteLength;

    let vboHandle: WebGLBuffer;
    let eboHandle: WebGLBuffer;
    if (vbo !== undefined && ebo !== undefined &&
      this.pool.sizeOf(vbo) >= vertexBytes &&
      this.pool.sizeOf(ebo) >= indexBytes) {
      vboHandle = vbo;
      eboHandle = ebo;
    } else {
      if (existing !== undefined) {
        this.releaseLeaf(existing);
      }
      vboHandle = this.pool.acquire(vertexBytes, this.gl.ARRAY_BUFFER).buffer;
      eboHandle = this.pool.acquire(indexBytes, this.gl.ELEMENT_ARRAY_BUFFER).buffer;
    }

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vboHandle);
    this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, vertices);
    this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, eboHandle);
    this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, indexBytes, this.gl.DYNAMIC_DRAW);
    this.gl.bufferSubData(this.gl.ELEMENT_ARRAY_BUFFER, 0, indices);

    this.meshes.set(node.key, {
      nodeKey: node.key,
      vbo: vboHandle,
      ebo: eboHandle,
      indexCount: indices.length,
      batches,
      vertexCount: quadCount * VERTS_PER_QUAD,
      signature,
    });
  }

  private appendQuad(
    vertices: Float32Array,
    indices: Uint32Array,
    quad: Quad,
    vCursor: number,
    iCursor: number,
    baseVertex: number,
    tint: number,
  ): void {
    const uAxis = (quad.axis + 1) % 3;
    const vAxis = (quad.axis + 2) % 3;
    const cornerOffsets: Array<[number, number]> = [
      [0, 0],
      [quad.width, 0],
      [quad.width, quad.height],
      [0, quad.height],
    ];
    for (let i = 0; i < 4; i += 1) {
      const [du, dv] = cornerOffsets[i];
      const pos = [quad.x, quad.y, quad.z];
      pos[uAxis] += du;
      pos[vAxis] += dv;
      const o = vCursor + i * FLOATS_PER_VERTEX;
      vertices[o] = pos[0];
      vertices[o + 1] = pos[1];
      vertices[o + 2] = pos[2];
      vertices[o + 3] = quad.normal[0];
      vertices[o + 4] = quad.normal[1];
      vertices[o + 5] = quad.normal[2];
      vertices[o + 6] = quad.material;
      vertices[o + 7] = tint;
    }
    indices[iCursor] = baseVertex;
    indices[iCursor + 1] = baseVertex + 1;
    indices[iCursor + 2] = baseVertex + 2;
    indices[iCursor + 3] = baseVertex;
    indices[iCursor + 4] = baseVertex + 2;
    indices[iCursor + 5] = baseVertex + 3;
  }

  private signatureOf(node: OctreeNode, faceCount: number, batchCount: number): number {
    let h = node.key ^ 0x9e37_79b1;
    h = Math.imul(h ^ faceCount, 0x85eb_ca6b);
    h = Math.imul(h ^ batchCount, 0xc2b2_ae35);
    return h >>> 0;
  }

  private releaseLeaf(mesh: GpuLeafMesh): void {
    this.pool.release(mesh.vbo);
    this.pool.release(mesh.ebo);
  }

  /** Wireframe line vertices for every active leaf (leaf box edges). */
  buildDebugLines(nodes: OctreeNode[]): { vbo: WebGLBuffer; count: number } | null {
    const positions: number[] = [];
    const push = (
      ax: number, ay: number, az: number,
      bx: number, by: number, bz: number,
    ) => {
      positions.push(ax, ay, az, bx, by, bz);
    };
    for (const node of nodes) {
      if (node.kind === 'air') {
        continue;
      }
      const { x, y, z, size } = node;
      for (let a = 0; a < 3; a += 1) {
        for (let s0 = 0; s0 <= 1; s0 += 1) {
          for (let s1 = 0; s1 <= 1; s1 += 1) {
            const p = [x, y, z];
            p[(a + 1) % 3] += s0 * size;
            p[(a + 2) % 3] += s1 * size;
            const q = [...p];
            q[a] += size;
            push(p[0], p[1], p[2], q[0], q[1], q[2]);
          }
        }
      }
    }
    if (positions.length === 0) {
      return null;
    }
    const data = new Float32Array(positions);
    let vbo: WebGLBuffer;
    if (this.debugVbo !== null && this.pool.sizeOf(this.debugVbo) >= data.byteLength) {
      vbo = this.debugVbo;
    } else {
      if (this.debugVbo !== null) {
        this.pool.recycle(this.debugVbo);
      }
      vbo = this.pool.acquire(data.byteLength, this.gl.ARRAY_BUFFER).buffer;
      this.debugVbo = vbo;
    }
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vbo);
    this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, data);
    return { vbo, count: positions.length / 3 };
  }

  private debugVbo: WebGLBuffer | null = null;

  dispose(): void {
    this.meshes.clear();
    this.pool.dispose();
  }

  get poolStats(): BufferPool['stats'] {
    return this.pool.stats;
  }

  sizeOfBuffer(buffer: WebGLBuffer): number {
    return this.pool.sizeOf(buffer);
  }
}
