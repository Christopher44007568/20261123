export type Vec3 = readonly [number, number, number];
export type Mat4 = Float32Array;

export interface HeadPose {
  position: Vec3;
  yaw: number;
  pitch: number;
  roll: number;
}

export interface CameraEye {
  index: 0 | 1;
  localOffset: Vec3;
  worldPosition: Vec3;
  view: Mat4;
  projection: Mat4;
  viewProjection: Mat4;
}

export const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function pingPong(value: number, length: number): number {
  const wrapped = ((value % (length * 2)) + length * 2) % (length * 2);
  return wrapped <= length ? wrapped : length * 2 - wrapped;
}

export function mat4Identity(): Mat4 {
  const out = new Float32Array(16);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + row]! * b[column * 4 + k]!;
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

export function mat4Translation(position: Vec3): Mat4 {
  const out = mat4Identity();
  out[12] = position[0];
  out[13] = position[1];
  out[14] = position[2];
  return out;
}

function mat4RotationY(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const out = mat4Identity();
  out[0] = c;
  out[2] = -s;
  out[8] = s;
  out[10] = c;
  return out;
}

function mat4RotationX(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const out = mat4Identity();
  out[5] = c;
  out[6] = s;
  out[9] = -s;
  out[10] = c;
  return out;
}

function mat4RotationZ(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const out = mat4Identity();
  out[0] = c;
  out[1] = s;
  out[4] = -s;
  out[5] = c;
  return out;
}

export function headRotation(pose: Pick<HeadPose, "yaw" | "pitch" | "roll">): Mat4 {
  return mat4Multiply(
    mat4Multiply(mat4RotationY(pose.yaw), mat4RotationX(pose.pitch)),
    mat4RotationZ(pose.roll),
  );
}

export function mat4FromPose(
  position: Vec3,
  rotation: Pick<HeadPose, "yaw" | "pitch" | "roll">,
  scale: Vec3 = [1, 1, 1],
): Mat4 {
  const out = mat4Multiply(mat4Translation(position), headRotation(rotation));
  out[0] = out[0]! * scale[0]!;
  out[1] = out[1]! * scale[0]!;
  out[2] = out[2]! * scale[0]!;
  out[4] = out[4]! * scale[1]!;
  out[5] = out[5]! * scale[1]!;
  out[6] = out[6]! * scale[1]!;
  out[8] = out[8]! * scale[2]!;
  out[9] = out[9]! * scale[2]!;
  out[10] = out[10]! * scale[2]!;
  return out;
}

export function transformPoint(matrix: Mat4, point: Vec3): Vec3 {
  const x = point[0];
  const y = point[1];
  const z = point[2];
  const w = matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!;
  return [
    (matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!) / w,
    (matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!) / w,
    (matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!) / w,
  ];
}

export function transformDirection(matrix: Mat4, direction: Vec3): Vec3 {
  return [
    matrix[0]! * direction[0] + matrix[4]! * direction[1] + matrix[8]! * direction[2],
    matrix[1]! * direction[0] + matrix[5]! * direction[1] + matrix[9]! * direction[2],
    matrix[2]! * direction[0] + matrix[6]! * direction[1] + matrix[10]! * direction[2],
  ];
}

export function viewFromHeadPose(pose: HeadPose, eyeOffset: Vec3): { view: Mat4; worldPosition: Vec3 } {
  const rotation = headRotation(pose);
  const offset = transformDirection(rotation, eyeOffset);
  const worldPosition: Vec3 = [
    pose.position[0] + offset[0],
    pose.position[1] + offset[1],
    pose.position[2] + offset[2],
  ];
  const view = new Float32Array(16);
  view[0] = rotation[0]!;
  view[1] = rotation[4]!;
  view[2] = rotation[8]!;
  view[4] = rotation[1]!;
  view[5] = rotation[5]!;
  view[6] = rotation[9]!;
  view[8] = rotation[2]!;
  view[9] = rotation[6]!;
  view[10] = rotation[10]!;
  view[12] = -(rotation[0]! * worldPosition[0] + rotation[4]! * worldPosition[1] + rotation[8]! * worldPosition[2]);
  view[13] = -(rotation[1]! * worldPosition[0] + rotation[5]! * worldPosition[1] + rotation[9]! * worldPosition[2]);
  view[14] = -(rotation[2]! * worldPosition[0] + rotation[6]! * worldPosition[1] + rotation[10]! * worldPosition[2]);
  view[15] = 1;
  return { view, worldPosition };
}

export function offAxisProjection(
  eyeOffset: Vec3,
  screenDistance: number,
  screenWidth: number,
  screenHeight: number,
  near: number,
  far: number,
): Mat4 {
  const left = (near * (-screenWidth * 0.5 - eyeOffset[0])) / screenDistance;
  const right = (near * (screenWidth * 0.5 - eyeOffset[0])) / screenDistance;
  const bottom = (near * (-screenHeight * 0.5 - eyeOffset[1])) / screenDistance;
  const top = (near * (screenHeight * 0.5 - eyeOffset[1])) / screenDistance;
  const out = new Float32Array(16);
  out[0] = (2 * near) / (right - left);
  out[5] = (2 * near) / (top - bottom);
  out[8] = (right + left) / (right - left);
  out[9] = (top + bottom) / (top - bottom);
  out[10] = -(far + near) / (far - near);
  out[11] = -1;
  out[14] = -(2 * far * near) / (far - near);
  return out;
}

export function perspectiveProjection(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY * 0.5);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function projectNdc(viewProjection: Mat4, point: Vec3): Vec3 {
  const clip: [number, number, number, number] = [
    viewProjection[0]! * point[0] + viewProjection[4]! * point[1] + viewProjection[8]! * point[2] + viewProjection[12]!,
    viewProjection[1]! * point[0] + viewProjection[5]! * point[1] + viewProjection[9]! * point[2] + viewProjection[13]!,
    viewProjection[2]! * point[0] + viewProjection[6]! * point[1] + viewProjection[10]! * point[2] + viewProjection[14]!,
    viewProjection[3]! * point[0] + viewProjection[7]! * point[1] + viewProjection[11]! * point[2] + viewProjection[15]!,
  ];
  return [clip[0]! / clip[3]!, clip[1]! / clip[3]!, clip[2]! / clip[3]!];
}

export function projectPixel(
  viewProjection: Mat4,
  point: Vec3,
  width: number,
  height: number,
): { x: number; y: number; z: number } {
  const ndc = projectNdc(viewProjection, point);
  return {
    x: (ndc[0] * 0.5 + 0.5) * width,
    y: (ndc[1] * 0.5 + 0.5) * height,
    z: ndc[2],
  };
}

export function mat4Inverse(matrix: Mat4): Mat4 {
  const a00 = matrix[0]!, a01 = matrix[1]!, a02 = matrix[2]!, a03 = matrix[3]!;
  const a10 = matrix[4]!, a11 = matrix[5]!, a12 = matrix[6]!, a13 = matrix[7]!;
  const a20 = matrix[8]!, a21 = matrix[9]!, a22 = matrix[10]!, a23 = matrix[11]!;
  const a30 = matrix[12]!, a31 = matrix[13]!, a32 = matrix[14]!, a33 = matrix[15]!;
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  let determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(determinant) < 1e-12) determinant = 1;
  const inverseDeterminant = 1 / determinant;
  const out = new Float32Array(16);
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * inverseDeterminant;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * inverseDeterminant;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * inverseDeterminant;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * inverseDeterminant;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * inverseDeterminant;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * inverseDeterminant;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * inverseDeterminant;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * inverseDeterminant;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * inverseDeterminant;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * inverseDeterminant;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * inverseDeterminant;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * inverseDeterminant;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * inverseDeterminant;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * inverseDeterminant;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * inverseDeterminant;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * inverseDeterminant;
  return out;
}
