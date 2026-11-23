import assert from 'node:assert/strict';
import { test } from 'node:test';
import { identity, multiply, perspective, projectToNdc, lookAt } from '../src/math/mat4.ts';
import { cross, dot, normalize, v3 } from '../src/math/vec3.ts';

test('单位矩阵保持点不变', () => {
  const p = v3(3, -4, 5);
  assert.deepEqual(projectToNdc(identity(), p).ndc, p);
});

test('透视矩阵将光轴上的点投影到 NDC 原点', () => {
  const proj = perspective(Math.PI / 2, 1, 0.1, 100);
  const result = projectToNdc(proj, v3(0, 0, -10));
  assert.ok(Math.abs(result.ndc[0]) < 1e-6);
  assert.ok(Math.abs(result.ndc[1]) < 1e-6);
  assert.ok(result.ndc[2] > -1 && result.ndc[2] < 1);
});

test('lookAt 基底正交归一', () => {
  const view = lookAt(v3(0, 0, 5), v3(0, 0, 0), v3(0, 1, 0));
  const right = [view[0], view[1], view[2]];
  const up = [view[4], view[5], view[6]];
  assert.ok(Math.abs(dot(right as never, up as never)) < 1e-6);
  assert.ok(Math.abs(lengthOf(right) - 1) < 1e-6);
});

test('叉积与归一化', () => {
  const n = normalize(cross(v3(1, 0, 0), v3(0, 1, 0)));
  assert.deepEqual(n, v3(0, 0, 1));
});

test('矩阵乘法结合单位矩阵', () => {
  const m = perspective(1, 1.5, 0.2, 50);
  const result = multiply(m, identity());
  assert.deepEqual(Array.from(result), Array.from(m));
});

function lengthOf(a: number[]): number {
  return Math.hypot(a[0], a[1], a[2]);
}
