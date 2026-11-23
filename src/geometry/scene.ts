import { DeterministicNoise } from "../noise";
import { clamp, mix, smoothstep, type Vec3 } from "../math";
import { FIXED_SEED, type PageRecord, type SurfaceSpec } from "./types";

const noise = new DeterministicNoise(FIXED_SEED);

function cliffZ(x: number, y: number): number {
  const broad = (noise.fbm2(x * 0.021 + 9.1, y * 0.035 - 3.7, 5, 11) - 0.5) * 10.5;
  const crags = (noise.ridged2(x * 0.085, y * 0.075, 4, 29) - 0.5) * 4.8;
  const erosion = Math.sin(x * 0.115 + y * 0.028) * 1.15;
  const bands = Math.sin(y * 0.74 + noise.value2(x * 0.06, y * 0.06, 3) * 4.5) * 0.48;
  const notch = -4.8 * Math.exp(-(((y - 7.5) / 5.4) ** 2)) * (0.7 + 0.3 * noise.value2(x * 0.05, 0, 8));
  const alcoveA = -8.5 * Math.exp(-(((x + 31) / 18) ** 2) - ((y - 36) / 17) ** 2);
  const alcoveB = -6.2 * Math.exp(-(((x - 74) / 16) ** 2) - ((y - 53) / 19) ** 2);
  const overhang = 2.2 * smoothstep(76, 94, y) * (0.5 + noise.value2(x * 0.07, 44, 5));
  return 17.5 - y * 0.205 + broad + crags + erosion + bands + notch + alcoveA + alcoveB + overhang;
}

function cliffSurface(u: number, v: number): [number, number, number] {
  const x = mix(-152, 152, u);
  const y = mix(-3, 109, v);
  return [x, y, cliffZ(x, y)];
}

function upperSlope(u: number, v: number): [number, number, number] {
  const x = mix(-152, 152, u);
  const z = mix(8, -108, v);
  const backRise = smoothstep(0.1, 1, v) * 12;
  const rough = (noise.fbm2(x * 0.025 + 3, z * 0.03, 4, 71) - 0.5) * 6.5;
  const y = 103.5 + backRise + rough + Math.sin(x * 0.04 + z * 0.025) * 1.4;
  return [x, y, z];
}

function shelfSurface(index: number): SurfaceSpec["eval"] {
  const shelfY = [22, 44, 66, 86][index]!;
  return (u, v) => {
    const x = mix(-118, 118, u);
    const back = cliffZ(x, shelfY) - 2.4;
    const front = back + 14.5 + noise.value2(x * 0.055, shelfY, 101 + index) * 4.2;
    const z = mix(back, front, clamp(v, 0, 1));
    const edgeDrop = smoothstep(0.82, 1, v) * (2.4 + noise.ridged2(x * 0.22, index * 9, 3, 111));
    const rubble = (noise.ridged2(x * 0.17 + 4, z * 0.2, 3, 123 + index) - 0.5) * 0.85 * smoothstep(0.35, 1, v);
    const y = shelfY + 0.15 + rubble - edgeDrop;
    return [x, y, z];
  };
}

function stairSurface(u: number, v: number): [number, number, number] {
  const y = mix(4.5, 96, v);
  const center = -50 + 90 * v + Math.sin(v * 19.5) * 7.5;
  const width = 8.8 + noise.value2(v * 8, 3, 141) * 2.8;
  const x = center + (u - 0.5) * width;
  const stepT = v * 43;
  const step = Math.floor(stepT);
  const riser = smoothstep(0.78, 1, stepT - step);
  const outward = 2.5 + (step % 7) * 0.12 + riser * 1.0;
  const broken = (noise.ridged2(x * 0.3, y * 0.17, 3, 151) - 0.5) * 1.4;
  const z = cliffZ(x, y) + outward + broken;
  return [x, y + riser * 0.28, z];
}

function sectionSurface(u: number, v: number): [number, number, number] {
  const x = mix(-77, -23, u);
  const y = mix(8, 77, v);
  const offset = 3.0 + noise.value2(x * 0.12, y * 0.06, 161) * 0.7;
  const scar = Math.sin(u * Math.PI) * Math.sin(v * Math.PI) - 1;
  const z = cliffZ(x, y) + offset + scar * 0.55;
  return [x, y, z];
}

function rubbleSurface(u: number, v: number): [number, number, number] {
  const x = mix(-132, 132, u);
  const z = mix(21, 88, v);
  const beach = 0.75 + Math.max(0, z - 28) * 0.022;
  const lumps = noise.ridged2(x * 0.105 + 7, z * 0.14, 5, 181);
  const coarse = noise.fbm2(x * 0.035, z * 0.045, 4, 191);
  const shards = Math.floor(noise.value2(x * 0.32, z * 0.37, 201) * 4) / 4;
  const y = beach + lumps * 6.5 + coarse * 2.4 + shards * 1.3;
  return [x, y, z];
}

function ruinWall(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  salt: number,
): SurfaceSpec["eval"] {
  return (u, v) => {
    const x = mix(x0, x1, u);
    const top = y1 - noise.fbm2(u * 11 + salt, 2.5, 3, 211 + salt) * 6.5;
    const y = mix(y0, top, v);
    const blockU = Math.floor(u * 18 + noise.value2(v * 8, salt, 221) * 0.5);
    const blockV = Math.floor(v * 11 + noise.value2(u * 7, salt, 231) * 0.4);
    const masonry = ((blockU * 7 + blockV * 13) % 5) * 0.12;
    const z = z0 + masonry + (noise.fbm2(x * 0.11, y * 0.13, 3, 241 + salt) - 0.5) * 0.75;
    return [x, y, z];
  };
}

function seaStack(u: number, v: number): [number, number, number] {
  const theta = u * Math.PI * 2;
  const y = mix(-5, 43, v);
  const taper = 1 - Math.pow(v, 2.2) * 0.55;
  const radius = (9.5 + noise.fbm2(theta * 3 + 2, v * 4, 4, 251) * 5.2) * taper;
  const x = 174 + Math.cos(theta) * radius + y * 0.06;
  const z = 99 + Math.sin(theta) * radius * 0.8;
  return [x, y, z];
}

export const SURFACES: readonly SurfaceSpec[] = [
  { id: "coastal-cliff", material: 0, cols: 16, rows: 8, eval: cliffSurface },
  { id: "upper-slope", material: 1, cols: 8, rows: 4, eval: upperSlope },
  { id: "terrace-1", material: 2, cols: 12, rows: 2, eval: shelfSurface(0), flipWinding: true },
  { id: "terrace-2", material: 2, cols: 12, rows: 2, eval: shelfSurface(1), flipWinding: true },
  { id: "terrace-3", material: 2, cols: 12, rows: 2, eval: shelfSurface(2), flipWinding: true },
  { id: "terrace-4", material: 2, cols: 12, rows: 2, eval: shelfSurface(3), flipWinding: true },
  { id: "grand-stair", material: 3, cols: 8, rows: 8, eval: stairSurface },
  { id: "section-scar", material: 4, cols: 12, rows: 4, eval: sectionSurface },
  { id: "rubble-field", material: 5, cols: 12, rows: 4, eval: rubbleSurface, flipWinding: true },
  {
    id: "ruin-wall-west",
    material: 6,
    cols: 4,
    rows: 4,
    eval: ruinWall(-86, -54, 23, 44, 17.5, 1),
  },
  {
    id: "ruin-wall-east",
    material: 6,
    cols: 4,
    rows: 4,
    eval: ruinWall(43, 82, 45, 72, 29, 2),
  },
  {
    id: "ruin-wall-high",
    material: 6,
    cols: 4,
    rows: 4,
    eval: ruinWall(-12, 28, 67, 91, 22, 3),
  },
  { id: "sea-stack", material: 7, cols: 6, rows: 4, eval: seaStack, flipWinding: true },
];

export function buildPages(): PageRecord[] {
  const pages: PageRecord[] = [];
  let id = 0;
  for (let surfaceIndex = 0; surfaceIndex < SURFACES.length; surfaceIndex++) {
    const surface = SURFACES[surfaceIndex]!;
    for (let row = 0; row < surface.rows; row++) {
      for (let col = 0; col < surface.cols; col++) {
        pages.push({
          id: id++,
          surfaceId: surface.id,
          surfaceIndex,
          material: surface.material,
          col,
          row,
          u0: col / surface.cols,
          v0: row / surface.rows,
          u1: (col + 1) / surface.cols,
          v1: (row + 1) / surface.rows,
        });
      }
    }
  }
  return pages;
}

export function evaluatePage(page: PageRecord, u: number, v: number): Vec3 {
  const surface = SURFACES[page.surfaceIndex]!;
  return surface.eval(u, v);
}
