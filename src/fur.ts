import { Vec3, v3, mulberry32 } from "./math.js";
import { surfacePoint } from "./base.js";

export interface FurParams {
  length: number;    // 0.2 .. 2.0 multiplier
  windAngle: number; // degrees, wind direction in XZ plane
  windStrength: number; // 0..1
  density: number;   // 0.1..1
}

export const MAX_STRANDS = 40000;
export const STRAND_SEGS = 6;
export const MAX_CARDS = 3600;
export const CARD_SEGS = 4;
export const SHELL_LAYERS = 24;

const BASE_FUR_LEN = 0.55;

// Integrate one hair curve: starts along surface normal, bends toward wind.
export function strandCurve(
  root: Vec3, normal: Vec3, len: number, wind: Vec3, windStr: number,
  curlAmp: number, curlPhase: number, segs: number,
): { pts: Vec3[]; tans: Vec3[] } {
  const pts: Vec3[] = [root.slice() as Vec3];
  const tans: Vec3[] = [];
  // Per-strand curl direction: any fixed perpendicular to the normal.
  const ref: Vec3 = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const c0 = v3.norm(v3.cross(normal, ref));
  const c1 = v3.norm(v3.cross(normal, c0));
  let pos = root;
  const step = len / segs;
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const bend = windStr * Math.pow(t, 1.4);
    const dir = v3.norm(v3.mix(normal, wind, Math.min(bend, 0.95)));
    const sway = curlAmp * Math.sin(curlPhase + t * 5.0);
    const sway2 = curlAmp * 0.6 * Math.cos(curlPhase * 1.7 + t * 4.0);
    const d = v3.norm(v3.add(dir, v3.add(v3.scale(c0, sway), v3.scale(c1, sway2))));
    tans.push(d);
    pos = v3.add(pos, v3.scale(d, step));
    pts.push(pos);
  }
  tans.push(tans[tans.length - 1]);
  return { pts, tans };
}

export function windVector(angleDeg: number): Vec3 {
  const a = (angleDeg * Math.PI) / 180;
  return [Math.cos(a), 0, Math.sin(a)];
}

// ---- Strand LOD: camera-facing ribbons, 2 verts per curve point ----
// Vertex layout: pos(3) tan(3) t(1) rand(1) side(1) = 9 floats
export interface StrandMesh {
  verts: Float32Array;
  indices: Uint32Array;
  chunkOf: Uint32Array;   // chunk id per strand
  chunkCenters: Float32Array; // xyz per chunk
  chunkFirst: Uint32Array;   // first index per chunk
  chunkCount: Uint32Array;   // index count per chunk
  numChunks: number;
  totalStrands: number;
}

export const STRAND_CHUNK = 512;

export function buildStrands(p: FurParams): StrandMesh {
  const rand = mulberry32(1337);
  const wind = windVector(p.windAngle);
  const ptsPerStrand = STRAND_SEGS + 1;
  const vertsPerStrand = ptsPerStrand * 2;
  const verts = new Float32Array(MAX_STRANDS * vertsPerStrand * 9);
  const indices = new Uint32Array(MAX_STRANDS * STRAND_SEGS * 6);
  const numChunks = Math.ceil(MAX_STRANDS / STRAND_CHUNK);
  const chunkCenters = new Float32Array(numChunks * 3);
  let vo = 0, io = 0, vb = 0;
  // Assign strands to spatial cells first so each draw chunk is localized;
  // per-chunk back-to-front sorting is then meaningful for alpha blending.
  const order: number[] = [];
  {
    const desc: Array<{ key: number; i: number }> = [];
    const r2 = mulberry32(1337);
    for (let s = 0; s < MAX_STRANDS; s++) {
      const u = r2(), v = r2();
      const cu = Math.min(15, (u * 16) | 0), cv = Math.min(7, (v * 8) | 0);
      desc.push({ key: cv * 16 + cu, i: s });
    }
    desc.sort((a, b) => a.key - b.key);
    for (const d of desc) order.push(d.i);
  }
  const roots: Array<{ u: number; v: number }> = [];
  {
    const r3 = mulberry32(1337);
    for (let s = 0; s < MAX_STRANDS; s++) roots.push({ u: r3(), v: r3() });
  }
  for (let s = 0; s < MAX_STRANDS; s++) {
    const { u, v } = roots[order[s]];
    const { p: root, n } = surfacePoint(u, v);
    const len = BASE_FUR_LEN * p.length * (0.7 + 0.6 * rand());
    const curl = 0.05 + 0.12 * rand();
    const phase = rand() * Math.PI * 2;
    const { pts, tans } = strandCurve(root, n, len, wind, p.windStrength, curl, phase, STRAND_SEGS);
    const sr = rand();
    const chunk = (s / STRAND_CHUNK) | 0;
    for (let ci = 0; ci < 3; ci++) chunkCenters[chunk*3+ci] += pts[2][ci] / STRAND_CHUNK;
    for (let i = 0; i < ptsPerStrand; i++) {
      const t = i / STRAND_SEGS;
      for (let side = 0; side < 2; side++) {
        verts[vo++] = pts[i][0]; verts[vo++] = pts[i][1]; verts[vo++] = pts[i][2];
        verts[vo++] = tans[i][0]; verts[vo++] = tans[i][1]; verts[vo++] = tans[i][2];
        verts[vo++] = t; verts[vo++] = sr; verts[vo++] = side === 0 ? -1 : 1;
      }
    }
    for (let i = 0; i < STRAND_SEGS; i++) {
      const a = vb + i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices[io++] = a; indices[io++] = b; indices[io++] = c;
      indices[io++] = b; indices[io++] = d; indices[io++] = c;
    }
    vb += vertsPerStrand;
  }
  const chunkOf = new Uint32Array(MAX_STRANDS);
  for (let s = 0; s < MAX_STRANDS; s++) chunkOf[s] = (s / STRAND_CHUNK) | 0;
  const chunkFirst = new Uint32Array(numChunks);
  const chunkCount = new Uint32Array(numChunks);
  for (let c = 0; c < numChunks; c++) {
    chunkFirst[c] = c * STRAND_CHUNK * STRAND_SEGS * 6;
    chunkCount[c] = Math.min(STRAND_CHUNK, MAX_STRANDS - c * STRAND_CHUNK) * STRAND_SEGS * 6;
  }
  return { verts, indices, chunkOf, chunkCenters, chunkFirst, chunkCount, numChunks, totalStrands: MAX_STRANDS };
}

// ---- Card LOD: crossed tapered quads per clump ----
// Vertex layout: pos(3) tan(3) uv(2) t(1) rand(1) = 10 floats
export interface CardMesh {
  verts: Float32Array;
  indices: Uint32Array;
  centers: Float32Array; // xyz per card (for sorting)
  first: Uint32Array;    // first index per card
  count: number;         // index count per card
  totalCards: number;
}

export const CARD_WIDTH = 0.15;

export function buildCards(p: FurParams): CardMesh {
  const rand = mulberry32(9001);
  const wind = windVector(p.windAngle);
  const rows = CARD_SEGS + 1;
  const quadsPerCard = 2;
  const vertsPerCard = rows * 2 * quadsPerCard;
  const verts = new Float32Array(MAX_CARDS * vertsPerCard * 10);
  const idxPerCard = CARD_SEGS * 6 * quadsPerCard;
  const indices = new Uint32Array(MAX_CARDS * idxPerCard);
  const centers = new Float32Array(MAX_CARDS * 3);
  let vo = 0, io = 0, vb = 0;
  for (let c = 0; c < MAX_CARDS; c++) {
    const u = rand(), v = rand();
    const { p: root, n } = surfacePoint(u, v);
    const len = BASE_FUR_LEN * p.length * 1.05;
    const { pts, tans } = strandCurve(root, n, len, wind, p.windStrength, 0.04, rand() * 6.28, CARD_SEGS);
    const az = rand() * Math.PI;
    const cr = rand();
    for (let ci = 0; ci < 3; ci++) centers[c*3+ci] = pts[2][ci];
    for (let q = 0; q < quadsPerCard; q++) {
      const a = az + q * Math.PI * 0.5;
      const w: Vec3 = [Math.cos(a), 0, Math.sin(a)];
      for (let i = 0; i < rows; i++) {
        const t = i / CARD_SEGS;
        const half = CARD_WIDTH * 0.5 * (1 - 0.72 * t); // tapered width
        for (let side = 0; side < 2; side++) {
          const sgn = side === 0 ? -1 : 1;
          const px = pts[i][0] + w[0] * half * sgn;
          const py = pts[i][1] + w[1] * half * sgn;
          const pz = pts[i][2] + w[2] * half * sgn;
          verts[vo++] = px; verts[vo++] = py; verts[vo++] = pz;
          verts[vo++] = tans[i][0]; verts[vo++] = tans[i][1]; verts[vo++] = tans[i][2];
          verts[vo++] = side; verts[vo++] = 1 - t; // canvas row 0 = tip
          verts[vo++] = t; verts[vo++] = cr;
        }
      }
      for (let i = 0; i < CARD_SEGS; i++) {
        const a0 = vb + i * 2, b0 = a0 + 1, c0 = a0 + 2, d0 = a0 + 3;
        indices[io++] = a0; indices[io++] = b0; indices[io++] = c0;
        indices[io++] = b0; indices[io++] = d0; indices[io++] = c0;
      }
      vb += rows * 2;
    }
  }
  const first = new Uint32Array(MAX_CARDS);
  for (let c = 0; c < MAX_CARDS; c++) first[c] = c * idxPerCard;
  return { verts, indices, centers, first, count: idxPerCard, totalCards: MAX_CARDS };
}

// ---- Procedural card texture: cluster of tapered strokes on transparent bg ----
export function generateCardTexture(size = 256): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  const rand = mulberry32(4242);
  const strands = 170;
  for (let i = 0; i < strands; i++) {
    const x0 = size * (0.08 + 0.84 * rand());
    const drift = (rand() - 0.5) * size * 0.25;
    const shade = 60 + Math.floor(rand() * 120);
    const alpha = 0.35 + rand() * 0.45;
    const w = 0.8 + rand() * 1.2;
    ctx.strokeStyle = `rgba(${shade},${Math.floor(shade*0.82)},${Math.floor(shade*0.6)},${alpha})`;
    ctx.lineWidth = w;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x0, size);
    ctx.quadraticCurveTo(x0 + drift * 0.4, size * 0.5, x0 + drift, size * (0.02 + rand() * 0.1));
    ctx.stroke();
  }
  return cv;
}
