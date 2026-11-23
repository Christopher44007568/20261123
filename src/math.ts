export type Vec3 = [number, number, number];

export function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale3(a: Vec3, value: number): Vec3 {
  return [a[0] * value, a[1] * value, a[2] * value];
}

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length3(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize3(a: Vec3): Vec3 {
  const length = length3(a) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
}

export function mix3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function mat4Identity(): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[row] * b[column * 4] +
        a[4 + row] * b[column * 4 + 1] +
        a[8 + row] * b[column * 4 + 2] +
        a[12 + row] * b[column * 4 + 3];
    }
  }
  return out;
}

export function mat4Perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const range = far / (near - far);
  return new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    range,
    -1,
    0,
    0,
    near * range,
    0,
  ]);
}

export function mat4LookAt(eye: Vec3, target: Vec3, up: Vec3): Float32Array {
  const z = normalize3(sub3(eye, target));
  const x = normalize3(cross3(up, z));
  const y = cross3(z, x);
  return new Float32Array([
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    -dot3(x, eye),
    -dot3(y, eye),
    -dot3(z, eye),
    1,
  ]);
}

export interface CameraFrame {
  position: Vec3;
  target: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  viewProjection: Float32Array;
  tanHalfFov: number;
  aspect: number;
}

export function makeCamera(
  position: Vec3,
  target: Vec3,
  fovY: number,
  aspect: number,
  near = 0.1,
  far = 120,
): CameraFrame {
  const forward = normalize3(sub3(target, position));
  const right = normalize3(cross3(forward, [0, 1, 0]));
  const up = normalize3(cross3(right, forward));
  const view = mat4LookAt(position, target, [0, 1, 0]);
  const projection = mat4Perspective(fovY, aspect, near, far);
  return {
    position,
    target,
    right,
    up,
    forward,
    viewProjection: mat4Multiply(projection, view),
    tanHalfFov: Math.tan(fovY / 2),
    aspect,
  };
}

export const CAMERA_LOOP_SECONDS = 18;
export const CAMERA_LOOP_FRAMES = CAMERA_LOOP_SECONDS * 60;

export function cameraAtFrame(frame: number, aspect: number): CameraFrame {
  const phase = ((frame % CAMERA_LOOP_FRAMES) / CAMERA_LOOP_FRAMES) * Math.PI * 2;
  const angle = 0.12 + Math.sin(phase) * 0.48;
  const radius = 31.4 + Math.sin(phase * 2 + 0.4) * 1.2;
  const position: Vec3 = [
    Math.sin(angle) * radius,
    10.1 + Math.sin(phase * 2 + 0.7) * 1.15,
    Math.cos(angle) * radius,
  ];
  const target: Vec3 = [
    Math.sin(phase) * 2.3,
    2.72 + Math.sin(phase * 1.5) * 0.34,
    0.4 + Math.cos(phase) * 1.25,
  ];
  return makeCamera(position, target, (44 * Math.PI) / 180, aspect);
}
