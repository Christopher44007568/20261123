import type { Vec3 } from "./math.ts";

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  vertexCount: number;
}

type Triangle = readonly [Vec3, Vec3, Vec3];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function faceNormal(triangle: Triangle): Vec3 {
  return normalize(cross(sub(triangle[1], triangle[0]), sub(triangle[2], triangle[0])));
}

export class MeshBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];

  addTriangle(a: Vec3, b: Vec3, c: Vec3, normal = faceNormal([a, b, c])): void {
    const vertices: readonly Vec3[] = [a, b, c];
    const uv: readonly number[] = [0, 0, 1, 0, 1, 1];
    for (let index = 0; index < 3; index += 1) {
      const vertex = vertices[index]!;
      this.positions.push(vertex[0], vertex[1], vertex[2]);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.uvs.push(uv[index * 2]!, uv[index * 2 + 1]!);
    }
  }

  addQuad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, normal?: Vec3): void {
    const resolved = normal ?? faceNormal([a, b, c]);
    this.addTriangle(a, b, c, resolved);
    this.addTriangle(a, c, d, resolved);
  }

  addBox(center: Vec3, size: Vec3, rotationZ = 0): void {
    const hx = size[0] * 0.5;
    const hy = size[1] * 0.5;
    const hz = size[2] * 0.5;
    const c = Math.cos(rotationZ);
    const s = Math.sin(rotationZ);
    const point = (x: number, y: number, z: number): Vec3 => [
      center[0] + x * c - y * s,
      center[1] + x * s + y * c,
      center[2] + z,
    ];
    const corners = {
      lbf: point(-hx, -hy, hz),
      rbf: point(hx, -hy, hz),
      rtf: point(hx, hy, hz),
      ltf: point(-hx, hy, hz),
      lbb: point(-hx, -hy, -hz),
      rbb: point(hx, -hy, -hz),
      rtb: point(hx, hy, -hz),
      ltb: point(-hx, hy, -hz),
    };
    const direction = (x: number, y: number, z: number): Vec3 =>
      normalize([x * c - y * s, x * s + y * c, z]);
    this.addQuad(corners.lbf, corners.rbf, corners.rtf, corners.ltf, direction(0, 0, 1));
    this.addQuad(corners.rbb, corners.lbb, corners.ltb, corners.rtb, direction(0, 0, -1));
    this.addQuad(corners.rbf, corners.rbb, corners.rtb, corners.rtf, direction(1, 0, 0));
    this.addQuad(corners.lbb, corners.lbf, corners.ltf, corners.ltb, direction(-1, 0, 0));
    this.addQuad(corners.ltf, corners.rtf, corners.rtb, corners.ltb, direction(0, 1, 0));
    this.addQuad(corners.lbb, corners.rbb, corners.rbf, corners.lbf, direction(0, -1, 0));
  }

  addCylinderZ(center: Vec3, radius: number, length: number, segments: number): void {
    const zFront = center[2] + length * 0.5;
    const zBack = center[2] - length * 0.5;
    for (let index = 0; index < segments; index += 1) {
      const angleA = (index / segments) * Math.PI * 2;
      const angleB = ((index + 1) / segments) * Math.PI * 2;
      const ca = Math.cos(angleA);
      const sa = Math.sin(angleA);
      const cb = Math.cos(angleB);
      const sb = Math.sin(angleB);
      const frontA: Vec3 = [center[0] + ca * radius, center[1] + sa * radius, zFront];
      const frontB: Vec3 = [center[0] + cb * radius, center[1] + sb * radius, zFront];
      const backA: Vec3 = [frontA[0], frontA[1], zBack];
      const backB: Vec3 = [frontB[0], frontB[1], zBack];
      const centerFront: Vec3 = [center[0], center[1], zFront];
      const centerBack: Vec3 = [center[0], center[1], zBack];
      this.addTriangle(centerFront, frontB, frontA, [0, 0, 1]);
      this.addTriangle(centerBack, backA, backB, [0, 0, -1]);
      this.addQuad(frontA, backA, backB, frontB, normalize([ca + cb, sa + sb, 0]));
    }
  }

  addRingBand(center: Vec3, innerRadius: number, outerRadius: number, length: number, segments: number): void {
    const zFront = center[2] + length * 0.5;
    const zBack = center[2] - length * 0.5;
    for (let index = 0; index < segments; index += 1) {
      const angleA = (index / segments) * Math.PI * 2;
      const angleB = ((index + 1) / segments) * Math.PI * 2;
      const ca = Math.cos(angleA);
      const sa = Math.sin(angleA);
      const cb = Math.cos(angleB);
      const sb = Math.sin(angleB);
      const innerFrontA: Vec3 = [center[0] + ca * innerRadius, center[1] + sa * innerRadius, zFront];
      const innerFrontB: Vec3 = [center[0] + cb * innerRadius, center[1] + sb * innerRadius, zFront];
      const innerBackA: Vec3 = [innerFrontA[0], innerFrontA[1], zBack];
      const innerBackB: Vec3 = [innerFrontB[0], innerFrontB[1], zBack];
      const outerFrontA: Vec3 = [center[0] + ca * outerRadius, center[1] + sa * outerRadius, zFront];
      const outerFrontB: Vec3 = [center[0] + cb * outerRadius, center[1] + sb * outerRadius, zFront];
      const outerBackA: Vec3 = [outerFrontA[0], outerFrontA[1], zBack];
      const outerBackB: Vec3 = [outerFrontB[0], outerFrontB[1], zBack];
      this.addQuad(innerFrontA, outerFrontA, outerFrontB, innerFrontB, [0, 0, 1]);
      this.addQuad(innerBackB, outerBackB, outerBackA, innerBackA, [0, 0, -1]);
      this.addQuad(outerFrontA, outerBackA, outerBackB, outerFrontB, normalize([ca + cb, sa + sb, 0]));
      this.addQuad(innerFrontB, innerBackB, innerBackA, innerFrontA, normalize([-ca - cb, -sa - sb, 0]));
    }
  }

  addTorusZ(center: Vec3, majorRadius: number, tubeRadius: number, majorSegments: number, minorSegments: number): void {
    const vertex = (majorIndex: number, minorIndex: number): { point: Vec3; normal: Vec3 } => {
      const u = (majorIndex / majorSegments) * Math.PI * 2;
      const v = (minorIndex / minorSegments) * Math.PI * 2;
      const cu = Math.cos(u);
      const su = Math.sin(u);
      const cv = Math.cos(v);
      const sv = Math.sin(v);
      return {
        point: [
          center[0] + (majorRadius + tubeRadius * cv) * cu,
          center[1] + (majorRadius + tubeRadius * cv) * su,
          center[2] + tubeRadius * sv,
        ],
        normal: [cv * cu, cv * su, sv],
      };
    };
    for (let major = 0; major < majorSegments; major += 1) {
      for (let minor = 0; minor < minorSegments; minor += 1) {
        const a = vertex(major, minor);
        const b = vertex(major + 1, minor);
        const c = vertex(major + 1, minor + 1);
        const d = vertex(major, minor + 1);
        const normal = normalize([
          a.normal[0] + b.normal[0] + c.normal[0] + d.normal[0],
          a.normal[1] + b.normal[1] + c.normal[1] + d.normal[1],
          a.normal[2] + b.normal[2] + c.normal[2] + d.normal[2],
        ]);
        this.addQuad(a.point, b.point, c.point, d.point, normal);
      }
    }
  }

  addGear(
    center: Vec3,
    innerRadius: number,
    rootRadius: number,
    tipRadius: number,
    thickness: number,
    teeth: number,
  ): void {
    const samples = teeth * 4;
    const zFront = center[2] + thickness * 0.5;
    const zBack = center[2] - thickness * 0.5;
    const outer: Vec3[] = [];
    const inner: Vec3[] = [];
    for (let index = 0; index < samples; index += 1) {
      const angle = (index / samples) * Math.PI * 2;
      const radial = index % 4 === 1 || index % 4 === 2 ? tipRadius : rootRadius;
      outer.push([center[0] + Math.cos(angle) * radial, center[1] + Math.sin(angle) * radial, center[2]]);
      inner.push([
        center[0] + Math.cos(angle) * innerRadius,
        center[1] + Math.sin(angle) * innerRadius,
        center[2],
      ]);
    }
    for (let index = 0; index < samples; index += 1) {
      const next = (index + 1) % samples;
      const outerA = outer[index]!;
      const outerB = outer[next]!;
      const innerA = inner[index]!;
      const innerB = inner[next]!;
      const outerFrontA: Vec3 = [outerA[0], outerA[1], zFront];
      const outerFrontB: Vec3 = [outerB[0], outerB[1], zFront];
      const outerBackA: Vec3 = [outerA[0], outerA[1], zBack];
      const outerBackB: Vec3 = [outerB[0], outerB[1], zBack];
      const innerFrontA: Vec3 = [innerA[0], innerA[1], zFront];
      const innerFrontB: Vec3 = [innerB[0], innerB[1], zFront];
      const innerBackA: Vec3 = [innerA[0], innerA[1], zBack];
      const innerBackB: Vec3 = [innerB[0], innerB[1], zBack];
      const angleA = (index / samples) * Math.PI * 2;
      const angleB = ((index + 1) / samples) * Math.PI * 2;
      const middle = (angleA + angleB) * 0.5;
      const outward: Vec3 = [Math.cos(middle), Math.sin(middle), 0];
      this.addQuad(innerFrontA, outerFrontA, outerFrontB, innerFrontB, [0, 0, 1]);
      this.addQuad(innerBackB, outerBackB, outerBackA, innerBackA, [0, 0, -1]);
      this.addQuad(outerFrontA, outerBackA, outerBackB, outerFrontB, outward);
      this.addQuad(innerFrontB, innerBackB, innerBackA, innerFrontA, [
        -outward[0],
        -outward[1],
        0,
      ]);
    }
  }

  addCurvedPanel(
    radius: number,
    halfAngle: number,
    height: number,
    radialSegments: number,
    verticalSegments: number,
  ): void {
    const point = (radialIndex: number, verticalIndex: number): { point: Vec3; normal: Vec3 } => {
      const angle = -halfAngle + (radialIndex / radialSegments) * halfAngle * 2;
      const y = -height * 0.5 + (verticalIndex / verticalSegments) * height;
      return {
        point: [radius * Math.sin(angle), y, -radius * (1 - Math.cos(angle))],
        normal: [Math.sin(angle), 0, Math.cos(angle)],
      };
    };
    for (let radial = 0; radial < radialSegments; radial += 1) {
      for (let vertical = 0; vertical < verticalSegments; vertical += 1) {
        const a = point(radial, vertical);
        const b = point(radial + 1, vertical);
        const c = point(radial + 1, vertical + 1);
        const d = point(radial, vertical + 1);
        const normal = normalize([
          a.normal[0] + b.normal[0] + c.normal[0] + d.normal[0],
          a.normal[1] + b.normal[1] + c.normal[1] + d.normal[1],
          a.normal[2] + b.normal[2] + c.normal[2] + d.normal[2],
        ]);
        this.addQuad(a.point, b.point, c.point, d.point, normal);
      }
    }
  }

  addSevenSegmentDigit(
    digit: number,
    center: Vec3,
    height: number,
    stroke: number,
    depth: number,
  ): void {
    const masks = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
    const mask = masks[digit] ?? 0;
    const width = height * 0.56;
    const z = center[2];
    const horizontal = (y: number, bit: number): void => {
      if ((mask & (1 << bit)) !== 0) {
        this.addBox([center[0], center[1] + y, z], [width, stroke, depth]);
      }
    };
    const vertical = (x: number, y: number, bit: number): void => {
      if ((mask & (1 << bit)) !== 0) {
        this.addBox([center[0] + x, center[1] + y, z], [stroke, height * 0.42, depth]);
      }
    };
    horizontal(height * 0.43, 0);
    vertical(width * 0.44, height * 0.21, 1);
    vertical(width * 0.44, -height * 0.21, 2);
    horizontal(-height * 0.43, 3);
    vertical(-width * 0.44, -height * 0.21, 4);
    vertical(-width * 0.44, height * 0.21, 5);
    horizontal(0, 6);
  }

  build(): MeshData {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      uvs: new Float32Array(this.uvs),
      vertexCount: this.positions.length / 3,
    };
  }
}
