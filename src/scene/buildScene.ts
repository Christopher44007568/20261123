import { MeshBuilder } from "./mesh";
import {
  MaterialKind,
  type Light,
  type Material,
  type Occluder,
  type SceneData,
  type Vec3,
} from "./types";

const palette = {
  concrete: [0.31, 0.32, 0.3] as Vec3,
  concreteDark: [0.16, 0.17, 0.16] as Vec3,
  steel: [0.12, 0.14, 0.14] as Vec3,
  canopy: [0.34, 0.18, 0.11] as Vec3,
  teal: [0.06, 0.29, 0.3] as Vec3,
  rust: [0.37, 0.095, 0.055] as Vec3,
  cream: [0.56, 0.58, 0.52] as Vec3,
  blue: [0.09, 0.25, 0.4] as Vec3,
  ochre: [0.5, 0.34, 0.065] as Vec3,
  rubber: [0.026, 0.024, 0.02] as Vec3,
  orange: [0.9, 0.19, 0.025] as Vec3,
  white: [0.65, 0.67, 0.62] as Vec3,
  warm: [1.0, 0.55, 0.23] as Vec3,
  cool: [0.58, 0.77, 1.0] as Vec3,
};

const mat = (
  color: Vec3,
  roughness: number,
  metalness: number,
  kind: number = MaterialKind.matte,
  emission?: Vec3,
): Material => ({ color, roughness, metalness, kind, emission });

const lights: Light[] = [];
const occluders: Occluder[] = [];

function occluder(min: Vec3, max: Vec3): void {
  occluders.push({ min, max });
}

function addBulb(
  mesh: MeshBuilder,
  position: Vec3,
  color: Vec3,
  intensity: number,
  range: number,
  warm: boolean,
  size = 0.1,
): void {
  lights.push({ position, color, intensity, range, warm });
  mesh.addSphere(
    position,
    size,
    5,
    7,
    mat([1, 0.9, 0.72], 0.3, 0, MaterialKind.emissive, [color[0] * 4.2, color[1] * 4.2, color[2] * 4.2]),
  );
}

function addHousing(mesh: MeshBuilder, position: Vec3, drop: number): void {
  mesh.addCylinderBetween(
    [position[0], position[1] + 0.08, position[2]],
    [position[0], position[1] + drop, position[2]],
    0.13,
    8,
    mat(palette.steel, 0.3, 0.82, MaterialKind.metal),
  );
  mesh.addBox(
    [position[0], position[1] + 0.01, position[2]],
    [0.34, 0.05, 0.34],
    mat([0.07, 0.075, 0.07], 0.26, 0.7, MaterialKind.metal),
  );
}

function buildGround(mesh: MeshBuilder): void {
  mesh.addBox([0, -0.15, 0], [130, 0.3, 130], mat([0.055, 0.06, 0.058], 0.92, 0.02, MaterialKind.asphalt));
  mesh.addBox([0, 0.05, 0], [27, 0.18, 57], mat(palette.concrete, 0.78, 0.04, MaterialKind.concrete));
  mesh.addBox([0, 0.17, 0], [18, 0.1, 43], mat([0.24, 0.25, 0.235], 0.84, 0.02, MaterialKind.concrete));

  for (let lane = -2; lane <= 2; lane++) {
    const x = lane * 4.25;
    if (lane !== 0) {
      for (let z = -21; z <= 21; z += 4.2) {
        mesh.addBox([x, 0.228, z], [0.1, 0.012, 2.4], mat(palette.white, 0.6, 0, MaterialKind.paint));
      }
    }
  }
  for (const side of [-1, 1]) {
    mesh.addBox([side * 12.9, 0.16, 0], [0.42, 0.32, 55], mat([0.42, 0.4, 0.34], 0.75, 0, MaterialKind.concrete));
  }
}

function buildCanopy(mesh: MeshBuilder): void {
  const roofY = 7.45;
  mesh.addBox([0, roofY, 0], [25, 0.56, 43], mat(palette.canopy, 0.62, 0.48, MaterialKind.metal));
  mesh.addBox([0, roofY - 0.36, 0], [23.8, 0.12, 42.2], mat([0.1, 0.085, 0.07], 0.72, 0.55, MaterialKind.metal));
  for (const side of [-1, 1]) {
    mesh.addBox([side * 12.35, roofY + 0.02, 0], [0.28, 0.95, 43], mat([0.38, 0.22, 0.12], 0.55, 0.58, MaterialKind.metal));
  }

  for (const z of [-18, -6, 6, 18]) {
    for (const side of [-1, 1]) {
      const x = side * 11.1;
      mesh.addCylinderBetween([x, 0.15, z], [x, 7.2, z], 0.34, 10, mat([0.12, 0.13, 0.125], 0.38, 0.76, MaterialKind.metal));
      mesh.addBox([x, 0.22, z], [1.0, 0.12, 1.0], mat(palette.concreteDark, 0.7, 0.25, MaterialKind.concrete));
      occluder([x - 0.4, 0, z - 0.4], [x + 0.4, 7.3, z + 0.4]);
    }
    mesh.addBox([0, 6.98, z], [23.5, 0.2, 0.28], mat([0.1, 0.09, 0.075], 0.52, 0.62, MaterialKind.metal));
  }
  for (const x of [-8.4, -4.2, 0, 4.2, 8.4]) {
    mesh.addBox([x, 7.04, 0], [0.16, 0.16, 42.2], mat([0.11, 0.1, 0.08], 0.6, 0.55, MaterialKind.metal));
  }

  mesh.addBox([0, roofY + 0.52, 0], [13.5, 0.16, 2.8], mat([0.05, 0.075, 0.065], 0.35, 0.5, MaterialKind.metal));
  mesh.addBox([0, roofY + 0.61, -1.2], [10.8, 0.035, 0.12], mat(palette.cool, 0.4, 0, MaterialKind.emissive, [0.3, 0.62, 0.7]));
  mesh.addBox([0, roofY + 0.61, 1.0], [6.8, 0.025, 0.08], mat(palette.warm, 0.4, 0, MaterialKind.emissive, [0.72, 0.4, 0.13]));

  occluder([-12.5, roofY - 0.32, -21.5], [12.5, roofY + 0.3, 21.5]);
}

function buildBooth(mesh: MeshBuilder, x: number, z: number, index: number): void {
  const baseY = 0.25;
  mesh.addBox([x, baseY + 0.15, z], [2.7, 0.3, 4.5], mat([0.2, 0.21, 0.2], 0.7, 0.08, MaterialKind.concrete));
  mesh.addBox([x, baseY + 1.35, z], [2.15, 2.1, 3.2], mat([0.39, 0.41, 0.37], 0.47, 0.36, MaterialKind.metal));
  mesh.addBox([x, baseY + 2.52, z], [2.6, 0.18, 3.8], mat([0.12, 0.14, 0.13], 0.4, 0.6, MaterialKind.metal));
  mesh.addBox([x, baseY + 2.68, z], [2.35, 0.08, 3.5], mat(palette.warm, 0.45, 0, MaterialKind.emissive, [0.28, 0.13, 0.035]));
  for (const side of [-1, 1]) {
    mesh.addBox([x + side * 1.09, baseY + 1.48, z], [0.055, 1.1, 2.4], mat([0.04, 0.12, 0.13], 0.09, 0.15, MaterialKind.glass));
    mesh.addBox([x + side * 1.12, baseY + 0.7, z], [0.07, 0.32, 2.9], mat([0.5, 0.13, 0.045], 0.55, 0.2, MaterialKind.metal));
  }
  for (const dz of [-1.05, 1.05]) {
    mesh.addBox([x, baseY + 2.12, z + dz], [2.25, 0.06, 0.12], mat([0.05, 0.06, 0.055], 0.3, 0.5, MaterialKind.metal));
  }
  occluder([x - 1.2, baseY, z - 1.75], [x + 1.2, baseY + 2.65, z + 1.75]);

  const signColor: Vec3 = index % 2 === 0 ? palette.cool : palette.warm;
  mesh.addBox([x, baseY + 3.02, z + 1.82], [1.4, 0.3, 0.06], mat(signColor, 0.45, 0.1, MaterialKind.emissive, [signColor[0] * 0.6, signColor[1] * 0.6, signColor[2] * 0.6]));
}

interface ContainerSpec {
  x: number;
  y: number;
  z: number;
  length: number;
  color: Vec3;
  roughness: number;
  metalness: number;
  yaw: number;
  stack: boolean;
}

function buildContainer(mesh: MeshBuilder, spec: ContainerSpec): void {
  const width = 2.7;
  const height = 2.62;
  const yaw = spec.yaw;
  const panel = mat(spec.color, spec.roughness, spec.metalness, MaterialKind.metal);
  const trim = mat(
    [spec.color[0] * 0.52 + 0.025, spec.color[1] * 0.52 + 0.025, spec.color[2] * 0.52 + 0.025],
    spec.roughness * 0.82,
    Math.min(0.9, spec.metalness + 0.12),
    MaterialKind.metal,
  );
  mesh.addBox([spec.x, spec.y + height / 2, spec.z], [width, height, spec.length], panel, yaw);

  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const sideZ = spec.length / 2 - 0.32;
  for (let i = -7; i <= 7; i++) {
    const t = (i / 7) * sideZ;
    for (const side of [-1, 1]) {
      const lx = side * (width / 2 + 0.035);
      mesh.addBox(
        [spec.x + lx * cos + t * sin, spec.y + height / 2, spec.z - lx * sin + t * cos],
        [0.07, height - 0.24, 0.075],
        trim,
        yaw,
      );
    }
  }
  for (const end of [-1, 1]) {
    const ze = end * (spec.length / 2 + 0.02);
    mesh.addBox(
      [spec.x + ze * sin, spec.y + height * 0.53, spec.z + ze * cos],
      [width + 0.16, height + 0.1, 0.1],
      trim,
      yaw,
    );
    mesh.addBox(
      [spec.x + ze * sin, spec.y + height / 2, spec.z + ze * cos],
      [0.055, height - 0.28, 0.09],
      mat([0.025, 0.028, 0.027], 0.5, 0.7, MaterialKind.metal),
      yaw,
    );
  }
  for (const ex of [-1, 1]) {
    for (const ez of [-1, 1]) {
      const lx = ex * (width / 2 + 0.04);
      const lz = ez * (spec.length / 2 + 0.05);
      mesh.addBox(
        [spec.x + lx * cos + lz * sin, spec.y + 0.13, spec.z - lx * sin + lz * cos],
        [0.22, 0.26, 0.22],
        mat([0.05, 0.055, 0.05], 0.45, 0.78, MaterialKind.metal),
        yaw,
      );
    }
  }
  if (spec.stack) {
    mesh.addBox(
      [spec.x, spec.y + height + 0.08, spec.z],
      [width - 0.15, 0.12, spec.length - 0.2],
      mat([0.09, 0.08, 0.07], 0.55, 0.68, MaterialKind.metal),
      yaw,
    );
  }
  const halfX = Math.abs(cos) * width * 0.5 + Math.abs(sin) * spec.length * 0.5;
  const halfZ = Math.abs(sin) * width * 0.5 + Math.abs(cos) * spec.length * 0.5;
  occluder(
    [spec.x - halfX, spec.y, spec.z - halfZ],
    [spec.x + halfX, spec.y + height + (spec.stack ? 0.15 : 0), spec.z + halfZ],
  );
}

function buildYard(mesh: MeshBuilder): void {
  const rows: ContainerSpec[] = [
    { x: 18.6, y: 0.08, z: -23, length: 10, color: palette.teal, roughness: 0.37, metalness: 0.56, yaw: 0.03, stack: true },
    { x: 18.6, y: 0.08, z: -11.4, length: 9.6, color: palette.rust, roughness: 0.5, metalness: 0.64, yaw: -0.02, stack: false },
    { x: 18.7, y: 0.08, z: 0.2, length: 10, color: palette.cream, roughness: 0.58, metalness: 0.28, yaw: 0.06, stack: true },
    { x: 18.6, y: 0.08, z: 11.7, length: 10, color: palette.blue, roughness: 0.32, metalness: 0.66, yaw: -0.04, stack: false },
    { x: 18.6, y: 0.08, z: 23, length: 9.7, color: palette.ochre, roughness: 0.46, metalness: 0.5, yaw: 0.02, stack: true },
    { x: 23.1, y: 0.08, z: -20.6, length: 9.4, color: palette.rust, roughness: 0.41, metalness: 0.72, yaw: -0.08, stack: true },
    { x: 23.3, y: 0.08, z: -7.7, length: 10, color: palette.teal, roughness: 0.33, metalness: 0.6, yaw: 0.05, stack: false },
    { x: 23.2, y: 0.08, z: 4.4, length: 9.5, color: palette.blue, roughness: 0.44, metalness: 0.55, yaw: -0.03, stack: true },
    { x: 23.1, y: 0.08, z: 16.5, length: 10, color: palette.cream, roughness: 0.61, metalness: 0.24, yaw: 0.07, stack: false },
    { x: 27.7, y: 0.08, z: -14, length: 10, color: palette.ochre, roughness: 0.5, metalness: 0.47, yaw: 0.04, stack: true },
    { x: 27.7, y: 0.08, z: -2.3, length: 9.6, color: palette.rust, roughness: 0.43, metalness: 0.69, yaw: -0.07, stack: false },
    { x: 27.8, y: 0.08, z: 9.4, length: 10, color: palette.teal, roughness: 0.39, metalness: 0.62, yaw: 0.02, stack: true },
    { x: -18.5, y: 0.08, z: -18, length: 9.8, color: palette.rust, roughness: 0.53, metalness: 0.5, yaw: 0.02, stack: true },
    { x: -18.5, y: 0.08, z: -6.3, length: 10, color: palette.teal, roughness: 0.36, metalness: 0.58, yaw: -0.05, stack: false },
    { x: -18.6, y: 0.08, z: 6.2, length: 9.5, color: palette.cream, roughness: 0.64, metalness: 0.2, yaw: 0.06, stack: true },
    { x: -18.4, y: 0.08, z: 17.4, length: 10, color: palette.blue, roughness: 0.42, metalness: 0.62, yaw: -0.02, stack: false },
    { x: -23.3, y: 0.08, z: -11.8, length: 9.8, color: palette.ochre, roughness: 0.48, metalness: 0.51, yaw: 0.05, stack: true },
    { x: -23.4, y: 0.08, z: 0.8, length: 10, color: palette.rust, roughness: 0.46, metalness: 0.67, yaw: -0.03, stack: false },
    { x: -23.2, y: 0.08, z: 12.5, length: 9.6, color: palette.teal, roughness: 0.35, metalness: 0.6, yaw: 0.04, stack: true },
  ];
  for (const container of rows) {
    buildContainer(mesh, container);
    if (container.stack) {
      buildContainer(mesh, {
        ...container,
        y: container.y + 2.75,
        length: container.length - 0.5,
        roughness: Math.min(0.9, container.roughness + 0.08),
        metalness: Math.max(0.15, container.metalness - 0.08),
        yaw: container.yaw + Math.sin(container.x * 1.7 + container.z * 0.37) * 0.01,
        stack: false,
      });
    }
  }
}

function buildRailings(mesh: MeshBuilder): void {
  const railMat = mat([0.17, 0.19, 0.18], 0.34, 0.82, MaterialKind.metal);
  for (const side of [-1, 1]) {
    const x = side * 13.25;
    for (let z = -24; z <= 24; z += 2.7) {
      mesh.addCylinderBetween([x, 0.2, z], [x, 1.28, z], 0.032, 6, railMat);
    }
    for (const y of [0.68, 1.23]) {
      mesh.addCylinderBetween([x, y, -24], [x, y, 24], 0.034, 6, railMat);
    }
  }
  for (let i = 0; i < 6; i++) {
    const z = -20 + i * 8.1;
    for (const side of [-1, 1]) {
      mesh.addCylinderBetween([side * 11.8, 0.2, z], [side * 11.8, 1.12, z], 0.028, 6, railMat);
      mesh.addCylinderBetween([side * 11.8, 1.08, z - 3.6], [side * 11.8, 1.08, z + 3.6], 0.03, 6, railMat);
    }
  }
}

function buildCone(mesh: MeshBuilder, x: number, z: number, yaw: number): void {
  const baseY = 0.19;
  mesh.addBox([x, baseY + 0.035, z], [0.54, 0.07, 0.54], mat(palette.rubber, 0.78, 0.01, MaterialKind.rubber), yaw);
  mesh.addFrustum([x, baseY + 0.07, z], 0.23, 0.165, 0.25, 10, mat(palette.orange, 0.55, 0.015, MaterialKind.rubber));
  mesh.addFrustum([x, baseY + 0.32, z], 0.166, 0.125, 0.16, 10, mat([0.75, 0.78, 0.69], 0.58, 0, MaterialKind.paint));
  mesh.addFrustum([x, baseY + 0.48, z], 0.125, 0.018, 0.36, 10, mat(palette.orange, 0.55, 0.015, MaterialKind.rubber));
}

function buildWorkLights(mesh: MeshBuilder): void {
  const warmA: Vec3 = [1.0, 0.55, 0.24];
  const warmB: Vec3 = [1.0, 0.68, 0.34];
  const cool: Vec3 = [0.62, 0.79, 1.0];

  const canopyX = [-8.45, -5.05, -1.68, 1.68, 5.05, 8.45];
  for (let iz = 0; iz < 18; iz++) {
    const z = -20.4 + iz * 2.4;
    for (let ix = 0; ix < canopyX.length; ix++) {
      const position: Vec3 = [canopyX[ix], 6.76, z];
      addHousing(mesh, position, 0.42);
      const color = ix % 5 === 0 ? cool : (ix + iz) % 2 === 0 ? warmA : warmB;
      addBulb(mesh, position, color, ix % 5 === 0 ? 3.4 : 4.1, 12.5, ix % 5 !== 0, 0.085);
    }
  }

  for (let iz = 0; iz < 16; iz++) {
    const z = -19.5 + iz * 2.6;
    for (const side of [-1, 1]) {
      const position: Vec3 = [side * 11.92, 6.42, z];
      mesh.addBox(
        [side * 12.02, 6.32, z],
        [0.22, 0.38, 0.25],
        mat([0.07, 0.075, 0.072], 0.34, 0.78, MaterialKind.metal),
      );
      addBulb(mesh, position, (iz + side) % 3 === 0 ? cool : warmB, 5.4, 15, true, 0.1);
    }
  }

  for (let booth = 0; booth < 3; booth++) {
    const bx = (booth - 1) * 8;
    for (let side = -1; side <= 1; side += 2) {
      const position: Vec3 = [bx + side * 0.78, 3.48, 4.2];
      mesh.addBox([position[0], position[1] + 0.16, position[2]], [0.26, 0.08, 0.34], mat(palette.steel, 0.3, 0.8, MaterialKind.metal));
      addBulb(mesh, position, side < 0 ? warmA : warmB, 2.4, 8.5, true, 0.065);
    }
    for (let side = -1; side <= 1; side += 2) {
      const position: Vec3 = [bx + side * 0.78, 1.04, 4.92];
      addBulb(mesh, position, cool, 1.25, 6, false, 0.055);
    }
  }

  const mastPositions: Array<[number, number]> = [
    [-15.6, -25.5], [-15.6, -8.5], [-15.6, 8.5], [-15.6, 25.5],
    [15.6, -25.5], [15.6, -8.5], [15.6, 8.5], [15.6, 25.5],
    [0, -29.5], [0, 29.5], [-31, 0], [31, 0], [-31, -20], [31, 20],
  ];
  for (let mast = 0; mast < mastPositions.length; mast++) {
    const [mx, mz] = mastPositions[mast];
    mesh.addCylinderBetween([mx, 0.1, mz], [mx, 9.4, mz], 0.105, 8, mat([0.13, 0.15, 0.145], 0.36, 0.82, MaterialKind.metal));
    mesh.addCylinderBetween([mx, 9.05, mz], [mx, 9.35, mz], 0.24, 8, mat([0.09, 0.1, 0.095], 0.42, 0.74, MaterialKind.metal));
    occluder([mx - 0.17, 0, mz - 0.17], [mx + 0.17, 9.4, mz + 0.17]);
    for (let lamp = 0; lamp < 4; lamp++) {
      const ox = ((lamp % 2) * 2 - 1) * 0.47;
      const oz = (Math.floor(lamp / 2) * 2 - 1) * 0.38;
      const position: Vec3 = [mx + ox, 8.78, mz + oz];
      mesh.addBox([position[0], position[1] + 0.16, position[2]], [0.42, 0.1, 0.28], mat([0.06, 0.07, 0.065], 0.28, 0.8, MaterialKind.metal));
      addBulb(mesh, position, (mast + lamp) % 4 === 0 ? cool : warmB, 16.5, 29, true, 0.12);
    }
  }

  for (let i = 0; i < 6; i++) {
    for (const side of [-1, 1]) {
      const x = side * 14.55;
      const z = -23 + i * 9;
      mesh.addBox([x, 0.62, z], [0.24, 0.82, 0.24], mat([0.08, 0.085, 0.078], 0.54, 0.6, MaterialKind.metal));
      mesh.addBox([x, 1.05, z], [0.3, 0.05, 0.3], mat(palette.steel, 0.35, 0.7, MaterialKind.metal));
      addBulb(mesh, [x, 0.98, z], side < 0 ? warmA : cool, 0.95, 4.8, side < 0, 0.052);
    }
  }
}

function deterministicYaw(i: number): number {
  const x = Math.sin(i * 91.713 + 3.17) * 43758.5453;
  return (x - Math.floor(x)) * Math.PI * 2;
}

function buildCones(mesh: MeshBuilder): void {
  let index = 0;
  for (let i = 0; i < 14; i++) {
    buildCone(mesh, -12.1, -22 + i * 3.25, deterministicYaw(index++));
    buildCone(mesh, 12.1, -20.5 + i * 3.15, deterministicYaw(index++));
  }
  for (let i = 0; i < 6; i++) {
    buildCone(mesh, -10.2 + i * 4.08, 24.5, deterministicYaw(index++));
  }
  for (let i = 0; i < 6; i++) {
    buildCone(mesh, -11.2 + i * 2.15, -24.7, deterministicYaw(index++));
  }
  for (let i = 0; i < 6; i++) {
    buildCone(mesh, 14.9, -20 + i * 7.2, deterministicYaw(index++));
  }
}

export function buildScene(): SceneData {
  lights.length = 0;
  occluders.length = 0;
  const mesh = new MeshBuilder();
  buildGround(mesh);
  buildCanopy(mesh);
  for (let i = 0; i < 3; i++) buildBooth(mesh, (i - 1) * 8, 3.2, i);
  buildYard(mesh);
  buildRailings(mesh);
  buildCones(mesh);
  buildWorkLights(mesh);
  const geometry = mesh.finish();
  return {
    ...geometry,
    lights,
    occluders,
    triangleCount: mesh.triangleCount,
  };
}
