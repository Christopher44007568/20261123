import { MaterialKind, type Material, type Vec3 } from "./types";

const EPS = 1e-6;

export class MeshBuilder {
  private readonly vertices: number[] = [];
  private readonly indices: number[] = [];

  get vertexCount(): number {
    return this.vertices.length / 16;
  }

  get triangleCount(): number {
    return this.indices.length / 3;
  }

  finish(): { vertices: Float32Array; indices: Uint32Array } {
    return {
      vertices: new Float32Array(this.vertices),
      indices: new Uint32Array(this.indices),
    };
  }

  private pushVertex(
    p: Vec3,
    n: Vec3,
    color: Vec3,
    roughness: number,
    metalness: number,
    emission: Vec3,
    kind: number,
  ): number {
    const index = this.vertexCount;
    this.vertices.push(
      p[0], p[1], p[2], kind,
      n[0], n[1], n[2], roughness,
      color[0], color[1], color[2], metalness,
      emission[0], emission[1], emission[2], 0,
    );
    return index;
  }

  private quad(
    a: Vec3,
    b: Vec3,
    c: Vec3,
    d: Vec3,
    normal: Vec3,
    material: Material,
  ): void {
    const color = material.color;
    const roughness = material.roughness;
    const metalness = material.metalness;
    const emission = material.emission ?? [0, 0, 0];
    const kind = material.kind ?? MaterialKind.matte;
    const i = this.pushVertex(a, normal, color, roughness, metalness, emission, kind);
    this.pushVertex(b, normal, color, roughness, metalness, emission, kind);
    this.pushVertex(c, normal, color, roughness, metalness, emission, kind);
    this.pushVertex(d, normal, color, roughness, metalness, emission, kind);
    this.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  addBox(center: Vec3, size: Vec3, material: Material, yaw = 0): void {
    const hx = size[0] * 0.5;
    const hy = size[1] * 0.5;
    const hz = size[2] * 0.5;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const transform = (x: number, y: number, z: number): Vec3 => [
      center[0] + x * cy + z * sy,
      center[1] + y,
      center[2] - x * sy + z * cy,
    ];
    const rotateNormal = (x: number, y: number, z: number): Vec3 => [
      x * cy + z * sy,
      y,
      -x * sy + z * cy,
    ];

    const p000 = transform(-hx, -hy, -hz);
    const p100 = transform(hx, -hy, -hz);
    const p010 = transform(-hx, hy, -hz);
    const p110 = transform(hx, hy, -hz);
    const p001 = transform(-hx, -hy, hz);
    const p101 = transform(hx, -hy, hz);
    const p011 = transform(-hx, hy, hz);
    const p111 = transform(hx, hy, hz);

    const faces: Array<[Vec3, Vec3, Vec3, Vec3, Vec3]> = [
      [p001, p101, p111, p011, rotateNormal(0, 0, 1)],
      [p100, p000, p010, p110, rotateNormal(0, 0, -1)],
      [p101, p100, p110, p111, rotateNormal(1, 0, 0)],
      [p000, p001, p011, p010, rotateNormal(-1, 0, 0)],
      [p011, p111, p110, p010, rotateNormal(0, 1, 0)],
      [p000, p100, p101, p001, rotateNormal(0, -1, 0)],
    ];
    for (const face of faces) {
      this.quad(face[0], face[1], face[2], face[3], face[4], material);
    }
  }

  addFrustum(
    base: Vec3,
    radiusBottom: number,
    radiusTop: number,
    height: number,
    segments: number,
    material: Material,
  ): void {
    const color = material.color;
    const roughness = material.roughness;
    const metalness = material.metalness;
    const emission = material.emission ?? [0, 0, 0];
    const kind = material.kind ?? MaterialKind.matte;
    const baseIndex = this.vertexCount;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const nx = Math.cos(angle);
      const nz = Math.sin(angle);
      const sideSlope = (radiusBottom - radiusTop) / Math.max(height, EPS);
      const normalLength = Math.hypot(1, sideSlope);
      const normal: Vec3 = [nx / normalLength, sideSlope / normalLength, nz / normalLength];
      this.pushVertex(
        [base[0] + nx * radiusBottom, base[1], base[2] + nz * radiusBottom],
        normal,
        color,
        roughness,
        metalness,
        emission,
        kind,
      );
      this.pushVertex(
        [base[0] + nx * radiusTop, base[1] + height, base[2] + nz * radiusTop],
        normal,
        color,
        roughness,
        metalness,
        emission,
        kind,
      );
    }
    for (let i = 0; i < segments; i++) {
      const a = baseIndex + i * 2;
      this.indices.push(a, a + 2, a + 3, a, a + 3, a + 1);
    }
    if (radiusTop > EPS) {
      const centerTop = this.pushVertex(
        [base[0], base[1] + height, base[2]],
        [0, 1, 0],
        color,
        roughness,
        metalness,
        emission,
        kind,
      );
      for (let i = 0; i < segments; i++) {
        const a = baseIndex + i * 2 + 1;
        this.indices.push(centerTop, a + 2, a);
      }
    }
    const centerBottom = this.pushVertex(
      [base[0], base[1], base[2]],
      [0, -1, 0],
      color,
      roughness,
      metalness,
      emission,
      kind,
    );
    for (let i = 0; i < segments; i++) {
      const a = baseIndex + i * 2;
      this.indices.push(centerBottom, a, a + 2);
    }
  }

  addCylinderBetween(
    from: Vec3,
    to: Vec3,
    radius: number,
    segments: number,
    material: Material,
  ): void {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dz = to[2] - from[2];
    const length = Math.hypot(dx, dy, dz);
    if (length < EPS) return;
    const axis: Vec3 = [dx / length, dy / length, dz / length];
    const helper: Vec3 = Math.abs(axis[1]) < 0.92 ? [0, 1, 0] : [1, 0, 0];
    const tangent = normalize(cross(helper, axis));
    const bitangent = cross(axis, tangent);
    const color = material.color;
    const roughness = material.roughness;
    const metalness = material.metalness;
    const emission = material.emission ?? [0, 0, 0];
    const kind = material.kind ?? MaterialKind.matte;
    const start = this.vertexCount;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const cx = Math.cos(angle);
      const sx = Math.sin(angle);
      const n = normalize([
        tangent[0] * cx + bitangent[0] * sx,
        tangent[1] * cx + bitangent[1] * sx,
        tangent[2] * cx + bitangent[2] * sx,
      ]);
      this.pushVertex(
        [from[0] + n[0] * radius, from[1] + n[1] * radius, from[2] + n[2] * radius],
        n, color, roughness, metalness, emission, kind,
      );
      this.pushVertex(
        [to[0] + n[0] * radius, to[1] + n[1] * radius, to[2] + n[2] * radius],
        n, color, roughness, metalness, emission, kind,
      );
    }
    for (let i = 0; i < segments; i++) {
      const a = start + i * 2;
      this.indices.push(a, a + 2, a + 3, a, a + 3, a + 1);
    }
  }

  addSphere(center: Vec3, radius: number, rings: number, segments: number, material: Material): void {
    const color = material.color;
    const roughness = material.roughness;
    const metalness = material.metalness;
    const emission = material.emission ?? [0, 0, 0];
    const kind = material.kind ?? MaterialKind.matte;
    const start = this.vertexCount;
    for (let y = 0; y <= rings; y++) {
      const v = y / rings;
      const phi = v * Math.PI;
      for (let x = 0; x <= segments; x++) {
        const u = x / segments;
        const theta = u * Math.PI * 2;
        const n: Vec3 = [
          Math.sin(phi) * Math.cos(theta),
          Math.cos(phi),
          Math.sin(phi) * Math.sin(theta),
        ];
        this.pushVertex(
          [center[0] + n[0] * radius, center[1] + n[1] * radius, center[2] + n[2] * radius],
          n, color, roughness, metalness, emission, kind,
        );
      }
    }
    for (let y = 0; y < rings; y++) {
      for (let x = 0; x < segments; x++) {
        const a = start + y * (segments + 1) + x;
        const b = a + segments + 1;
        this.indices.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }
  }
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}
