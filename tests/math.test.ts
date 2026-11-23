import assert from "node:assert/strict";
import { test } from "node:test";
import {
  invertMat4,
  lookAt,
  multiplyMat4,
  perspective,
} from "../src/math";

test("matrix inverse returns identity within float tolerance", () => {
  const view = lookAt([5, 8, 20], [0, 3, 0], [0, 1, 0]);
  const projection = perspective(Math.PI / 3, 16 / 9, 0.1, 1000);
  const matrix = multiplyMat4(projection, view);
  const product = multiplyMat4(matrix, invertMat4(matrix));
  for (let i = 0; i < 16; i++) {
    const expected = i % 5 === 0 ? 1 : 0;
    assert.ok(Math.abs(product[i]! - expected) < 1e-4);
  }
});
