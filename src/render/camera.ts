import { Mat4, lookAt, multiply, perspective } from '../math/mat4.js';
import { Vec3, v3 } from '../math/vec3.js';

export interface OrbitCamera {
  yaw: number;
  pitch: number;
  distance: number;
  target: Vec3;
  focalMm: number;
  near: number;
  far: number;
}

export function createCamera(): OrbitCamera {
  return {
    yaw: 0.55,
    pitch: 0.32,
    distance: 24,
    target: v3(0, 3.2, -0.5),
    focalMm: 35,
    near: 0.1,
    far: 220,
  };
}

export function cameraPosition(camera: OrbitCamera): Vec3 {
  const cp = Math.cos(camera.pitch);
  return [
    camera.target[0] + camera.distance * cp * Math.sin(camera.yaw),
    camera.target[1] + camera.distance * Math.sin(camera.pitch),
    camera.target[2] + camera.distance * cp * Math.cos(camera.yaw),
  ];
}

export function fovYFromFocal(focalMm: number, sensorHeightMm = 24): number {
  return 2 * Math.atan(sensorHeightMm / (2 * focalMm));
}

export function cameraMatrices(camera: OrbitCamera, aspect: number): { viewProj: Mat4; view: Mat4; proj: Mat4; eye: Vec3 } {
  const eye = cameraPosition(camera);
  const view = lookAt(eye, camera.target, [0, 1, 0]);
  const proj = perspective(fovYFromFocal(camera.focalMm), aspect, camera.near, camera.far);
  return { viewProj: multiply(proj, view), view, proj, eye };
}
