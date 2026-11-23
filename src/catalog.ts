export interface StarVertexData {
  data: Float32Array;
  count: number;
  clusterCenter: readonly [number, number];
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number, sigma: number): number {
  const u = Math.max(rng(), 1e-6);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v) * sigma;
}

function starColor(rng: () => number): [number, number, number] {
  const temperature = rng();
  if (temperature < 0.16) return [1.0, 0.73, 0.47];
  if (temperature < 0.36) return [1.0, 0.9, 0.73];
  if (temperature < 0.72) return [0.75, 0.88, 1.0];
  return [0.55, 0.75, 1.0];
}

export function buildStarCatalog(count = 5600): StarVertexData {
  const rng = mulberry32(0x5eeda11);
  const data = new Float32Array(count * 8);
  const clusterX = 0.375;
  const clusterY = 0.53;

  for (let i = 0; i < count; i += 1) {
    const inCluster = i < count * 0.56;
    let x: number;
    let y: number;
    let brightness: number;
    let size: number;

    if (inCluster) {
      x = clusterX + gaussian(rng, 0.082);
      y = clusterY + gaussian(rng, 0.062);
      brightness = 0.26 + Math.pow(rng(), 2.3) * 1.35;
      size = 0.8 + Math.pow(rng(), 3.0) * 3.8;
    } else {
      const bandX = rng();
      const bandY = 0.38 + Math.sin(bandX * 4.7 + 0.9) * 0.13 + bandX * 0.34;
      const bandMix = rng() < 0.52;
      x = bandMix ? bandX + gaussian(rng, 0.045) : rng();
      y = bandMix ? bandY + gaussian(rng, 0.075) : rng() * 0.82 + 0.1;
      brightness = 0.12 + Math.pow(rng(), 3.2) * 1.45;
      size = 0.65 + Math.pow(rng(), 3.5) * 3.5;
    }

    if (x < -0.02) x = -x;
    if (x > 1.02) x = 2 - x;
    if (y < 0.015) y = 0.015 + rng() * 0.02;
    if (y > 0.985) y = 0.985 - rng() * 0.02;

    const color = starColor(rng);
    const twinkle = 0.7 + rng() * 0.6;
    const offset = i * 8;
    data[offset] = x;
    data[offset + 1] = y;
    data[offset + 2] = size;
    data[offset + 3] = brightness;
    data[offset + 4] = color[0];
    data[offset + 5] = color[1];
    data[offset + 6] = color[2];
    data[offset + 7] = twinkle;
  }

  return { data, count, clusterCenter: [clusterX, clusterY] };
}
