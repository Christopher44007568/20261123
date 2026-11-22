import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BufferPool } from '../src/render/BufferPool.js';

/** Minimal WebGL2 stub tracking buffer lifecycle calls. */
function createGlStub(): WebGL2RenderingContext {
  const gl = {
    ARRAY_BUFFER: 0x8892,
    DYNAMIC_DRAW: 0x88e8,
    created: 0,
    deleted: 0,
    createBuffer() {
      this.created += 1;
      return {};
    },
    deleteBuffer() {
      this.deleted += 1;
    },
    bindBuffer() {},
    bufferData() {},
  };
  return gl as unknown as WebGL2RenderingContext;
}

test('buffer pool recycles released buffers instead of allocating new GPU storage', () => {
  const gl = createGlStub();
  const pool = new BufferPool(gl);

  const first = pool.acquire(256, 0x8892);
  const second = pool.acquire(512, 0x8892);
  assert.equal(first.reused, false);
  assert.equal(second.reused, false);
  assert.equal(pool.stats.allocated, 2);

  pool.release(first.buffer);
  pool.release(second.buffer);
  assert.equal(pool.stats.pooled, 2);

  const reused = pool.acquire(300, 0x8892);
  assert.equal(reused.reused, true);
  assert.equal(pool.stats.allocated, 2);
  assert.equal(pool.stats.reuses, 1);

  pool.dispose();
  assert.equal((gl as unknown as { deleted: number }).deleted, 2);
});

test('pool only hands out buffers large enough for the request', () => {
  const gl = createGlStub();
  const pool = new BufferPool(gl);
  const small = pool.acquire(128, 0x8892);
  pool.release(small.buffer);
  const big = pool.acquire(4096, 0x8892);
  assert.equal(big.reused, false);
  assert.equal(pool.stats.allocated, 2);
});
