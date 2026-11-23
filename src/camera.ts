import {
  add,
  cameraBasis,
  dot,
  normalize,
  scale,
  sub,
  viewProjection,
  type Mat4,
  type Vec3,
} from "./math";

export const NEAR_PLANE = 0.35;
export const FAR_PLANE = 1250;
export const DEFAULT_FOV = (55 * Math.PI) / 180;
export const ERROR_THRESHOLD_PX = 1.5;

export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

export interface FrustumPlane {
  normal: Vec3;
  d: number;
}

export interface CameraSnapshot {
  pose: CameraPose;
  viewProj: Mat4;
  planes: Float32Array;
  position: Vec3;
  tanHalfFov: number;
  width: number;
  height: number;
}

const POSE_TARGETS: CameraPose[] = [
  { position: [48, 27, 430], target: [0, 55, 0] },
  { position: [39, 30, 318], target: [0, 55, 0] },
  { position: [25, 35, 212], target: [-2, 56, 0] },
  { position: [8, 42, 158], target: [-6, 58, 1] },
  { position: [-4, 51, 128], target: [-12, 60, 3] },
  { position: [-8, 68, 120], target: [-14, 74, 5] },
  { position: [5, 94, 128], target: [-4, 80, 4] },
  { position: [-14, 59, 114], target: [-18, 58, 2] },
];

export const CAMERA_PATH = POSE_TARGETS;

function f32(x: number): number {
  return Math.fround(x);
}

function f32Vec(v: Vec3): Vec3 {
  return [f32(v[0]), f32(v[1]), f32(v[2])];
}

function plane(normal: Vec3, point: Vec3, offset = 0): FrustumPlane {
  const n = f32Vec(normalize(normal));
  return { normal: n, d: f32(-dot(n, point) + offset) };
}

export function buildFrustumPlanes(
  eye: Vec3,
  target: Vec3,
  fovY: number,
  aspect: number,
  near: number,
  far: number,
): FrustumPlane[] {
  const { right, up, forward } = cameraBasis(eye, target);
  const tanV = Math.tan(fovY / 2);
  const tanH = tanV * aspect;
  return [
    plane(sub(right, scale(forward, tanH)), eye),
    plane(sub(scale(right, -1), scale(forward, tanH)), eye),
    plane(sub(up, scale(forward, tanV)), eye),
    plane(sub(scale(up, -1), scale(forward, tanV)), eye),
    plane(scale(forward, -1), eye, near),
    plane(forward, eye, -far),
  ];
}

export function packPlanes(planes: FrustumPlane[]): Float32Array {
  const out = new Float32Array(24);
  for (let i = 0; i < 6; i++) {
    const p = planes[i]!;
    out[i * 4] = p.normal[0];
    out[i * 4 + 1] = p.normal[1];
    out[i * 4 + 2] = p.normal[2];
    out[i * 4 + 3] = p.d;
  }
  return out;
}

export function cameraSnapshot(
  pose: CameraPose,
  width: number,
  height: number,
  fovY = DEFAULT_FOV,
): CameraSnapshot {
  const aspect = width / Math.max(1, height);
  const { viewProj } = viewProjection(
    pose.position,
    pose.target,
    fovY,
    aspect,
    NEAR_PLANE,
    FAR_PLANE,
  );
  const planes = buildFrustumPlanes(
    pose.position,
    pose.target,
    fovY,
    aspect,
    NEAR_PLANE,
    FAR_PLANE,
  );
  return {
    pose,
    viewProj,
    planes: packPlanes(planes),
    position: f32Vec(pose.position),
    tanHalfFov: Math.tan(fovY / 2),
    width,
    height,
  };
}

export function sampleCameraPath(progress: number): CameraPose {
  const t = Math.max(0, Math.min(1, progress)) * (POSE_TARGETS.length - 1);
  const i = Math.min(POSE_TARGETS.length - 2, Math.floor(t));
  const localRaw = t - i;
  const local = localRaw * localRaw * (3 - 2 * localRaw);
  const a = POSE_TARGETS[i]!;
  const b = POSE_TARGETS[i + 1]!;
  return {
    position: [
      a.position[0] + (b.position[0] - a.position[0]) * local,
      a.position[1] + (b.position[1] - a.position[1]) * local,
      a.position[2] + (b.position[2] - a.position[2]) * local,
    ],
    target: [
      a.target[0] + (b.target[0] - a.target[0]) * local,
      a.target[1] + (b.target[1] - a.target[1]) * local,
      a.target[2] + (b.target[2] - a.target[2]) * local,
    ],
  };
}

export function raiseCamera(pose: CameraPose, amount: number): CameraPose {
  const position: Vec3 = [pose.position[0], pose.position[1] + amount, pose.position[2]];
  const target: Vec3 = [
    pose.target[0],
    pose.target[1] + amount * 0.35,
    pose.target[2],
  ];
  return { position, target };
}

export function distanceToTarget(pose: CameraPose): number {
  return Math.hypot(
    pose.position[0] - pose.target[0],
    pose.position[1] - pose.target[1],
    pose.position[2] - pose.target[2],
  );
}

export function movePose(pose: CameraPose, delta: Vec3): CameraPose {
  return {
    position: add(pose.position, delta),
    target: add(pose.target, delta),
  };
}
