import type { Vec3 } from '../engine/math3.js';

export type Mat4 = Float32Array;

export function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

export function mat4Perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

export function mat4LookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const zx = eye.x - center.x;
  const zy = eye.y - center.y;
  const zz = eye.z - center.z;
  let len = Math.hypot(zx, zy, zz) || 1;
  const fzX = zx / len, fzY = zy / len, fzZ = zz / len;

  const xx = up.y * fzZ - up.z * fzY;
  const xy = up.z * fzX - up.x * fzZ;
  const xz = up.x * fzY - up.y * fzX;
  len = Math.hypot(xx, xy, xz) || 1;
  const fxX = xx / len, fxY = xy / len, fxZ = xz / len;

  const fyX = fzY * fxZ - fzZ * fxY;
  const fyY = fzZ * fxX - fzX * fxZ;
  const fyZ = fzX * fxY - fzY * fxX;

  const m = mat4Identity();
  m[0] = fxX; m[1] = fyX; m[2] = fzX;
  m[4] = fxY; m[5] = fyY; m[6] = fzY;
  m[8] = fxZ; m[9] = fyZ; m[10] = fzZ;
  m[12] = -(fxX * eye.x + fxY * eye.y + fxZ * eye.z);
  m[13] = -(fyX * eye.x + fyY * eye.y + fyZ * eye.z);
  m[14] = -(fzX * eye.x + fzY * eye.y + fzZ * eye.z);
  return m;
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

export function mat4Translate(x: number, y: number, z: number): Mat4 {
  const m = mat4Identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}
