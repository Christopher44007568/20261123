export type Vec3 = [number, number, number];

export const v3 = {
  add(a: Vec3, b: Vec3): Vec3 { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; },
  sub(a: Vec3, b: Vec3): Vec3 { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; },
  scale(a: Vec3, s: number): Vec3 { return [a[0]*s, a[1]*s, a[2]*s]; },
  dot(a: Vec3, b: Vec3): number { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; },
  cross(a: Vec3, b: Vec3): Vec3 {
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  },
  len(a: Vec3): number { return Math.hypot(a[0], a[1], a[2]); },
  norm(a: Vec3): Vec3 {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0]/l, a[1]/l, a[2]/l];
  },
  mix(a: Vec3, b: Vec3, t: number): Vec3 {
    return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
  },
};

// Column-major 4x4 matrices, WebGL convention.
export type Mat4 = Float32Array;

export function m4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function m4Multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k*4+r] * b[c*4+k];
      o[c*4+r] = s;
    }
  }
  return o;
}

export function m4Perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function m4LookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const z = v3.norm(v3.sub(eye, center));
  const x = v3.norm(v3.cross(up, z));
  const y = v3.cross(z, x);
  const m = m4Identity();
  m[0]=x[0]; m[4]=x[1]; m[8]=x[2];
  m[1]=y[0]; m[5]=y[1]; m[9]=y[2];
  m[2]=z[0]; m[6]=z[1]; m[10]=z[2];
  m[12]=-v3.dot(x, eye); m[13]=-v3.dot(y, eye); m[14]=-v3.dot(z, eye);
  return m;
}

// Rotate around Y axis (used for orbit camera).
export function m4RotY(a: number): Mat4 {
  const c = Math.cos(a), s = Math.sin(a);
  const m = m4Identity();
  m[0]=c; m[2]=-s; m[8]=s; m[10]=c;
  return m;
}

// Deterministic PRNG so geometry is reproducible between runs/LODs.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
