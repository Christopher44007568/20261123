import { MeshBuilder, type MeshData } from "./geometry.ts";
import {
  mat4FromPose,
  mat4Identity,
  offAxisProjection,
  transformPoint,
  viewFromHeadPose,
  type CameraEye,
  type HeadPose,
  type Mat4,
  type Vec3,
} from "./math.ts";

export const STEREO = {
  ipd: 0.064,
  screenDistance: 0.42,
  screenWidth: 0.26,
  screenHeight: 0.1925925926,
  near: 0.035,
  far: 1.3,
  aspect: 1.35,
} as const;

export const SHROUD = {
  z: -0.445,
  radius: 0.24,
  halfAngle: 0.54,
  height: 0.205,
} as const;

export const PROBE = {
  x: 0.064,
  y: -0.012,
  frontZ: -0.315,
  backZ: -0.603,
} as const;

export const WITNESS_POINT: Vec3 = [0, 0.004, -0.3];

export interface Material {
  albedo: Vec3;
  metallic: number;
  roughness: number;
  alpha?: number;
  emissive?: Vec3;
  panelLines?: boolean;
}

export type MeshKey =
  | "backplate"
  | "scalePlate"
  | "ticks"
  | "dialRing"
  | "mainGear"
  | "upperGear"
  | "lowerGear"
  | "idlerGear"
  | "probeGear"
  | "shaft"
  | "bolt"
  | "bearing"
  | "frame"
  | "shroud";

export type ObjectKind = "opaque" | "shroud";

export interface SceneObject {
  mesh: MeshKey;
  model: Mat4;
  material: Material;
  kind: ObjectKind;
}

export interface SceneSnapshot {
  time: number;
  head: HeadPose;
  eyes: readonly [CameraEye, CameraEye];
  objects: readonly SceneObject[];
  probeBlend: number;
  probeSide: "front" | "behind";
  probeCenter: Vec3;
  probeToothPoint: Vec3;
  shroudSurfaceZ: number;
  probeOccluded: boolean;
  calibrationPoints: readonly Vec3[];
}

const STEEL: Material = { albedo: [0.40, 0.48, 0.48], metallic: 0.86, roughness: 0.27 };
const DARK_STEEL: Material = { albedo: [0.115, 0.145, 0.15], metallic: 0.72, roughness: 0.46 };
const BRASS: Material = { albedo: [0.70, 0.49, 0.22], metallic: 0.82, roughness: 0.29 };
const BLUE_STEEL: Material = { albedo: [0.20, 0.34, 0.37], metallic: 0.88, roughness: 0.25 };
const TICK: Material = {
  albedo: [0.66, 0.76, 0.68],
  metallic: 0.16,
  roughness: 0.32,
  emissive: [0.016, 0.028, 0.024],
};
const SHROUD_MATERIAL: Material = { albedo: [0.06, 0.30, 0.32], metallic: 0.12, roughness: 0.05, alpha: 0.085 };

function gearMesh(
  teeth: number,
  innerRadius: number,
  rootRadius: number,
  tipRadius: number,
  thickness: number,
): MeshData {
  const builder = new MeshBuilder();
  builder.addGear([0, 0, 0], innerRadius, rootRadius, tipRadius, thickness, teeth);
  builder.addTorusZ([0, 0, thickness * 0.62], innerRadius * 0.98, thickness * 0.32, 32, 6);
  return builder.build();
}

function createScaleTicks(): MeshData {
  const builder = new MeshBuilder();
  const plateX = -0.147;
  const plateY = 0.018;
  for (let index = 0; index <= 26; index += 1) {
    const y = plateY - 0.078 + index * 0.0062;
    const major = index % 5 === 0;
    const length = major ? 0.022 : index % 5 === 2 ? 0.013 : 0.008;
    builder.addBox([plateX - 0.047 + length * 0.5, y, -0.5994], [length, major ? 0.001 : 0.00055, 0.001]);
    if (major) {
      const value = index / 5;
      builder.addSevenSegmentDigit(value, [plateX - 0.0205, y, -0.5992], 0.0072, 0.0007, 0.0007);
    }
  }
  for (let index = 0; index < 72; index += 1) {
    const angle = (index / 72) * Math.PI * 2;
    const major = index % 6 === 0;
    const radius = 0.109;
    const length = major ? 0.0095 : 0.0048;
    builder.addBox(
      [Math.cos(angle) * radius, 0.031 + Math.sin(angle) * radius, -0.696],
      [length, major ? 0.0009 : 0.0005, 0.001],
      angle,
    );
  }
  return builder.build();
}

function createFrame(): MeshData {
  const builder = new MeshBuilder();
  const z = SHROUD.z - 0.005;
  builder.addBox([0, SHROUD.height * 0.5 + 0.008, z], [0.278, 0.009, 0.012]);
  builder.addBox([0, -SHROUD.height * 0.5 - 0.008, z], [0.278, 0.009, 0.012]);
  builder.addBox([-0.137, 0, z - 0.003], [0.009, SHROUD.height + 0.028, 0.018]);
  builder.addBox([0.137, 0, z - 0.003], [0.009, SHROUD.height + 0.028, 0.018]);
  builder.addBox([0, 0.116, z - 0.002], [0.048, 0.006, 0.009]);
  builder.addBox([0, -0.116, z - 0.002], [0.048, 0.006, 0.009]);
  return builder.build();
}

export function createSceneMeshes(): Record<MeshKey, MeshData> {
  const boxes = new MeshBuilder();
  boxes.addBox([0, 0, 0], [1, 0.64, 0.022]);
  const backplate = boxes.build();

  const scalePlate = new MeshBuilder();
  scalePlate.addBox([0, 0, 0], [0.13, 0.19, 0.008]);
  scalePlate.addBox([0.059, 0, 0.005], [0.003, 0.17, 0.001]);

  const dialRing = new MeshBuilder();
  dialRing.addTorusZ([0, 0, 0], 0.1205, 0.0018, 96, 8);
  dialRing.addTorusZ([0, 0, 0.002], 0.102, 0.0011, 96, 6);

  const shaft = new MeshBuilder();
  shaft.addCylinderZ([0, 0, 0], 0.0085, 0.08, 32);
  shaft.addTorusZ([0, 0, 0.041], 0.0088, 0.0015, 32, 6);

  const bolt = new MeshBuilder();
  bolt.addCylinderZ([0, 0, 0], 0.0058, 0.025, 6);
  bolt.addCylinderZ([0, 0, 0.0135], 0.0087, 0.003, 6);
  bolt.addTorusZ([0, 0, 0.005], 0.0072, 0.001, 32, 5);

  const bearing = new MeshBuilder();
  bearing.addTorusZ([0, 0, 0], 0.019, 0.0048, 48, 10);
  bearing.addTorusZ([0, 0, 0], 0.011, 0.0022, 40, 8);

  const shroud = new MeshBuilder();
  shroud.addCurvedPanel(SHROUD.radius, SHROUD.halfAngle, SHROUD.height, 42, 12);

  return {
    backplate,
    scalePlate: scalePlate.build(),
    ticks: createScaleTicks(),
    dialRing: dialRing.build(),
    mainGear: gearMesh(46, 0.032, 0.078, 0.089, 0.013),
    upperGear: gearMesh(36, 0.021, 0.057, 0.066, 0.01),
    lowerGear: gearMesh(29, 0.014, 0.044, 0.052, 0.008),
    idlerGear: gearMesh(22, 0.009, 0.032, 0.039, 0.006),
    probeGear: gearMesh(32, 0.007, 0.019, 0.0235, 0.0035),
    shaft: shaft.build(),
    bolt: bolt.build(),
    bearing: bearing.build(),
    frame: createFrame(),
    shroud: shroud.build(),
  };
}

function rotationModel(position: Vec3, roll: number): Mat4 {
  return mat4FromPose(position, { yaw: 0, pitch: 0, roll });
}

function shroudSurfaceZAt(x: number): number {
  const clampedX = Math.max(-SHROUD.radius * Math.sin(SHROUD.halfAngle), Math.min(SHROUD.radius * Math.sin(SHROUD.halfAngle), x));
  const sine = clampedX / SHROUD.radius;
  const angle = Math.asin(sine);
  return SHROUD.z - SHROUD.radius * (1 - Math.cos(angle));
}

export function buildScene(time: number, head: HeadPose, probeBlend: number): SceneSnapshot {
  const eyeOffset = STEREO.ipd * 0.5;
  const leftOffset: Vec3 = [-eyeOffset, 0, 0];
  const rightOffset: Vec3 = [eyeOffset, 0, 0];
  const left = viewFromHeadPose(head, leftOffset);
  const right = viewFromHeadPose(head, rightOffset);
  const leftProjection = offAxisProjection(
    leftOffset,
    STEREO.screenDistance,
    STEREO.screenWidth,
    STEREO.screenHeight,
    STEREO.near,
    STEREO.far,
  );
  const rightProjection = offAxisProjection(
    rightOffset,
    STEREO.screenDistance,
    STEREO.screenWidth,
    STEREO.screenHeight,
    STEREO.near,
    STEREO.far,
  );
  const eyes: readonly [CameraEye, CameraEye] = [
    {
      index: 0,
      localOffset: leftOffset,
      worldPosition: left.worldPosition,
      view: left.view,
      projection: leftProjection,
      viewProjection: mat4MultiplyLocal(leftProjection, left.view),
    },
    {
      index: 1,
      localOffset: rightOffset,
      worldPosition: right.worldPosition,
      view: right.view,
      projection: rightProjection,
      viewProjection: mat4MultiplyLocal(rightProjection, right.view),
    },
  ];

  const blend = Math.min(1, Math.max(0, probeBlend));
  const probeZ = PROBE.frontZ + (PROBE.backZ - PROBE.frontZ) * blend;
  const probeCenter: Vec3 = [PROBE.x, PROBE.y, probeZ];
  const probeAngle = time * 0.72 + 0.18;
  const shroudSurfaceZ = shroudSurfaceZAt(PROBE.x);
  const probeOccluded =
    probeCenter[2] < shroudSurfaceZ &&
    Math.abs(PROBE.y) < SHROUD.height * 0.5 &&
    Math.abs(PROBE.x) < SHROUD.radius * Math.sin(SHROUD.halfAngle);
  const probeSide = probeOccluded ? "behind" : "front";
  const toothLocal: Vec3 = [
    Math.cos(probeAngle) * 0.0145,
    Math.sin(probeAngle) * 0.0145,
    0.0022,
  ];
  const probeToothPoint: Vec3 = [
    probeCenter[0] + toothLocal[0],
    probeCenter[1] + toothLocal[1],
    probeCenter[2] + toothLocal[2],
  ];
  const probeModel = rotationModel(probeCenter, probeAngle);

  const identity = mat4Identity();
  const objects: SceneObject[] = [
    {
      mesh: "backplate",
      model: mat4FromPose([0, 0, -0.885], { yaw: 0, pitch: 0, roll: 0 }, [0.62, 0.56, 1.2]),
      material: { ...DARK_STEEL, panelLines: true },
      kind: "opaque",
    },
    {
      mesh: "scalePlate",
      model: mat4FromPose([-0.147, 0.018, -0.604], { yaw: 0, pitch: 0, roll: 0 }),
      material: { ...DARK_STEEL, roughness: 0.55 },
      kind: "opaque",
    },
    { mesh: "ticks", model: identity, material: TICK, kind: "opaque" },
    {
      mesh: "dialRing",
      model: mat4FromPose([0.015, 0.031, -0.7], { yaw: 0, pitch: 0, roll: 0 }),
      material: { ...STEEL, roughness: 0.36 },
      kind: "opaque",
    },
    {
      mesh: "mainGear",
      model: rotationModel([0.015, 0.031, -0.712], time * 0.12),
      material: { ...STEEL, roughness: 0.23 },
      kind: "opaque",
    },
    {
      mesh: "upperGear",
      model: rotationModel([0.085, 0.086, -0.662], -0.34 - time * 0.17),
      material: BRASS,
      kind: "opaque",
    },
    {
      mesh: "lowerGear",
      model: rotationModel([-0.061, -0.034, -0.684], 0.8 + time * 0.23),
      material: BLUE_STEEL,
      kind: "opaque",
    },
    {
      mesh: "idlerGear",
      model: rotationModel([0.143, -0.025, -0.706], -0.9 - time * 0.31),
      material: { ...STEEL, roughness: 0.32 },
      kind: "opaque",
    },
    {
      mesh: "shaft",
      model: mat4FromPose([0.015, 0.031, -0.754], { yaw: 0, pitch: 0, roll: 0 }),
      material: DARK_STEEL,
      kind: "opaque",
    },
    {
      mesh: "shaft",
      model: mat4FromPose([0.085, 0.086, -0.724], { yaw: 0, pitch: 0, roll: 0 }),
      material: DARK_STEEL,
      kind: "opaque",
    },
    {
      mesh: "shaft",
      model: mat4FromPose([-0.061, -0.034, -0.725], { yaw: 0, pitch: 0, roll: 0 }),
      material: DARK_STEEL,
      kind: "opaque",
    },
    {
      mesh: "bearing",
      model: mat4FromPose([0.194, 0.105, -0.793], { yaw: 0, pitch: 0, roll: 0 }),
      material: { ...BRASS, roughness: 0.38 },
      kind: "opaque",
    },
    {
      mesh: "bearing",
      model: mat4FromPose([-0.244, -0.147, -0.56], { yaw: 0.25, pitch: 0.12, roll: 0 }),
      material: STEEL,
      kind: "opaque",
    },
    {
      mesh: "bolt",
      model: mat4FromPose([0.173, -0.132, -0.302], { yaw: 0.08, pitch: -0.1, roll: 0.14 }),
      material: { ...STEEL, roughness: 0.22 },
      kind: "opaque",
    },
    {
      mesh: "bolt",
      model: mat4FromPose([0.205, -0.091, -0.337], { yaw: -0.13, pitch: 0.12, roll: -0.08 }),
      material: { ...STEEL, roughness: 0.28 },
      kind: "opaque",
    },
    {
      mesh: "bolt",
      model: mat4FromPose([-0.225, 0.128, -0.526], { yaw: 0.2, pitch: -0.14, roll: 0.3 }),
      material: { ...BRASS, roughness: 0.33 },
      kind: "opaque",
    },
    {
      mesh: "bolt",
      model: mat4FromPose([0.208, 0.155, -0.812], { yaw: -0.25, pitch: 0.18, roll: 0 }),
      material: DARK_STEEL,
      kind: "opaque",
    },
    {
      mesh: "probeGear",
      model: probeModel,
      material: {
        albedo: [0.82, 0.56, 0.23],
        metallic: 0.74,
        roughness: 0.2,
        emissive: [0.012, 0.007, 0.002],
      },
      kind: "opaque",
    },
    {
      mesh: "bolt",
      model: mat4FromPose(WITNESS_POINT, { yaw: 0, pitch: 0, roll: 0 }, [0.28, 0.28, 0.28]),
      material: {
        albedo: [0.015, 0.28, 0.32],
        metallic: 0.08,
        roughness: 0.24,
        emissive: [0.02, 1.8, 2.0],
      },
      kind: "opaque",
    },
    {
      mesh: "shroud",
      model: mat4FromPose([0, 0, SHROUD.z], { yaw: 0, pitch: 0, roll: 0 }),
      material: SHROUD_MATERIAL,
      kind: "shroud",
    },
    {
      mesh: "frame",
      model: identity,
      material: { ...BRASS, roughness: 0.38 },
      kind: "opaque",
    },
  ];

  const calibrationPoints: readonly Vec3[] = [
    probeCenter,
    probeToothPoint,
    transformPoint(rotationModel([0.015, 0.031, -0.704], time * 0.12), [0.058, 0.041, 0.006]),
    transformPoint(rotationModel([0.085, 0.086, -0.657], -0.34 - time * 0.17), [-0.042, 0.031, 0.005]),
    [-0.215, 0.08, -0.599],
    [-0.215, -0.05, -0.599],
    [0.173, -0.132, -0.289],
    [0.194, 0.105, -0.788],
    [0.015, 0.142, -0.696],
    [-0.244, -0.147, -0.555],
  ];

  return {
    time,
    head: { ...head, position: [...head.position] },
    eyes,
    objects,
    probeBlend: blend,
    probeSide,
    probeCenter,
    probeToothPoint,
    shroudSurfaceZ,
    probeOccluded,
    calibrationPoints,
  };
}

function mat4MultiplyLocal(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row]! * b[column * 4 + k]!;
      out[column * 4 + row] = sum;
    }
  }
  return out;
}
