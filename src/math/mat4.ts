// Column-major 4x4 matrices for WebGPU uniforms.

import type { Vec3 } from "./vec3.ts";
import { cross, normalize, sub } from "./vec3.ts";

export type Mat4 = Float32Array<ArrayBuffer>; // length 16, column-major

export function identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far / (near - far);
  m[11] = -1;
  m[14] = (far * near) / (near - far);
  return m;
}

export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const f = normalize(sub(target, eye));
  const s = normalize(cross(f, up));
  const u = cross(s, f);
  const m = new Float32Array(16);
  m[0] = s[0]; m[1] = u[0]; m[2] = -f[0]; m[3] = 0;
  m[4] = s[1]; m[5] = u[1]; m[6] = -f[1]; m[7] = 0;
  m[8] = s[2]; m[9] = u[2]; m[10] = -f[2]; m[11] = 0;
  m[12] = -(s[0] * eye[0] + s[1] * eye[1] + s[2] * eye[2]);
  m[13] = -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]);
  m[14] = f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2];
  m[15] = 1;
  return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

/** Compose translation * rotation(y-up basis vectors) * scale from columns. */
export function compose(
  px: number, py: number, pz: number,
  rx: number, ry: number, rz: number, // right column
  ux: number, uy: number, uz: number, // up column
  fx: number, fy: number, fz: number, // fwd column
  sx: number, sy: number, sz: number, // scale
): Mat4 {
  const m = new Float32Array(16);
  m[0] = rx * sx; m[1] = ry * sx; m[2] = rz * sx; m[3] = 0;
  m[4] = ux * sy; m[5] = uy * sy; m[6] = uz * sy; m[7] = 0;
  m[8] = fx * sz; m[9] = fy * sz; m[10] = fz * sz; m[11] = 0;
  m[12] = px; m[13] = py; m[14] = pz; m[15] = 1;
  return m;
}
