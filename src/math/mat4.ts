import { Vec3 } from './vec3.js';

export type Mat4 = Float32Array;

export function identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function perspective(fovYRad: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovYRad / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const z = (() => {
    const d: Vec3 = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]];
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    return [d[0] / len, d[1] / len, d[2] / len] as Vec3;
  })();
  const x = (() => {
    const c: Vec3 = [
      up[1] * z[2] - up[2] * z[1],
      up[2] * z[0] - up[0] * z[2],
      up[0] * z[1] - up[1] * z[0],
    ];
    const len = Math.hypot(c[0], c[1], c[2]) || 1;
    return [c[0] / len, c[1] / len, c[2] / len] as Vec3;
  })();
  const y: Vec3 = [
    z[1] * x[2] - z[2] * x[1],
    z[2] * x[0] - z[0] * x[2],
    z[0] * x[1] - z[1] * x[0],
  ];
  const m = new Float32Array(16);
  m[0] = x[0]; m[1] = y[0]; m[2] = z[0]; m[3] = 0;
  m[4] = x[1]; m[5] = y[1]; m[6] = z[1]; m[7] = 0;
  m[8] = x[2]; m[9] = y[2]; m[10] = z[2]; m[11] = 0;
  m[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  m[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  m[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  m[15] = 1;
  return m;
}

export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const x = p[0];
  const y = p[1];
  const z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

export function projectToNdc(m: Mat4, p: Vec3): { ndc: Vec3; w: number; behind: boolean } {
  const x = p[0];
  const y = p[1];
  const z = p[2];
  const clipW = m[3] * x + m[7] * y + m[11] * z + m[15];
  return {
    w: clipW,
    behind: clipW <= 0,
    ndc: [
      (m[0] * x + m[4] * y + m[8] * z + m[12]) / clipW,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) / clipW,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) / clipW,
    ],
  };
}
