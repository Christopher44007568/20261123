export const materialVertexShader = `#version 300 es
precision highp float;
out vec2 vUv;

void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p * 0.5;
  gl_Position = vec4(p - 1.0, 0.0, 1.0);
}`;

export const materialFragmentShader = `#version 300 es
precision highp float;
precision highp int;

in vec2 vUv;
uniform int uMaterial;
uniform float uScale;
uniform float uWear;
uniform float uSalt;
uniform vec2 uTexel;

layout(location = 0) out vec4 outAlbedo;
layout(location = 1) out vec4 outNormal;
layout(location = 2) out vec4 outRough;

const float PI = 3.14159265359;

float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec3 saturate(vec3 x) { return clamp(x, 0.0, 1.0); }

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 turn = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    value += amplitude * vnoise(p);
    p = turn * p * 2.03 + 17.17;
    amplitude *= 0.5;
  }
  return value;
}

float ridge(vec2 p, int octaves) {
  float value = 0.0;
  float amplitude = 0.55;
  for (int i = 0; i < 5; i++) {
    if (i >= octaves) break;
    float n = 1.0 - abs(vnoise(p) * 2.0 - 1.0);
    value += n * amplitude;
    p = p * 2.07 + vec2(9.3, 4.1);
    amplitude *= 0.48;
  }
  return value;
}

float saltField(vec2 uv, float seed) {
  float broad = fbm(uv * 7.0 + seed, 4);
  float fine = fbm(uv * 47.0 + seed * 1.7, 3);
  float vertical = fbm(vec2(uv.x * 26.0, uv.y * 3.4) + seed, 3);
  float crust = smoothstep(0.48, 0.78, broad * 0.68 + fine * 0.32);
  float tide = smoothstep(0.54, 0.84, vertical) * (1.0 - uv.y) * 0.56;
  return saturate(crust * 0.78 + tide + smoothstep(0.7, 0.9, fine) * 0.2);
}

float grain(vec2 uv, float amount) {
  return (hash21(floor(uv * 1024.0)) - 0.5) * amount;
}

struct Surface {
  vec4 albedo;
  float height;
  float rough;
  float ao;
  float salt;
};

struct BrickField {
  float mask;
  float chip;
  float row;
  float col;
  vec2 local;
  float tone;
};

BrickField brickField(vec2 uv) {
  float count = 8.2 - uScale * 0.62;
  vec2 bp = vec2(uv.x * count, uv.y * count * 2.32);
  float row = floor(bp.y);
  float shiftedX = bp.x + mod(row, 2.0) * 0.5;
  float col = floor(shiftedX);
  vec2 local = fract(vec2(shiftedX, bp.y));
  float warp = (fbm(uv * 88.0 + row * 3.7, 2) - 0.5) * 0.012;
  float jx = 0.032 + warp;
  float jy = 0.082 + warp * 0.7;
  float mx = smoothstep(jx, jx + 0.026, local.x) * smoothstep(jx, jx + 0.026, 1.0 - local.x);
  float my = smoothstep(jy, jy + 0.035, local.y) * smoothstep(jy, jy + 0.035, 1.0 - local.y);
  float mask = mx * my;

  float chipPick = hash21(vec2(col, row) + 31.7);
  float chipNoise = fbm(uv * 95.0 + col * 4.1, 3);
  vec2 q = abs(local - 0.5);
  float corner = min(length(local), length(local - 1.0));
  float chip = (1.0 - smoothstep(0.015, 0.13, corner)) * step(0.46, chipPick)
    * smoothstep(0.42, 0.68, chipNoise * 0.72 + chipPick * 0.4) * uWear;
  mask *= 1.0 - chip * 0.92;
  return BrickField(mask, chip, row, col, local, hash21(vec2(col, row) * 1.73 + 5.2));
}

float brickHeight(vec2 uv) {
  BrickField b = brickField(uv);
  float roughTop = (fbm(uv * 180.0, 2) - 0.5) * 0.03;
  return mix(-0.24, 0.34, b.mask) + roughTop * b.mask - b.chip * 0.16;
}

Surface sampleBrick(vec2 uv) {
  BrickField b = brickField(uv);
  float mottling = fbm(uv * 12.0 + b.tone * 8.0, 4);
  float pores = fbm(uv * 130.0, 2);
  vec3 brickA = vec3(0.49, 0.255, 0.165);
  vec3 brickB = vec3(0.64, 0.355, 0.225);
  vec3 brickC = vec3(0.35, 0.225, 0.175);
  vec3 brick = mix(brickA, brickB, b.tone * 0.72 + mottling * 0.28);
  brick = mix(brick, brickC, smoothstep(0.55, 0.82, fbm(uv * 7.3 + 12.0, 3)) * 0.48);
  brick *= 0.78 + pores * 0.34;

  float damp = smoothstep(0.48, 0.8, fbm(vec2(uv.x * 4.1, uv.y * 1.35) + 8.0, 3)) * uWear;
  brick = mix(brick, brick * vec3(0.62, 0.7, 0.64), damp * 0.34);
  vec3 chippedClay = vec3(0.62, 0.455, 0.31) * (0.8 + pores * 0.32);
  brick = mix(brick, chippedClay, b.chip * 0.9);

  vec3 mortar = vec3(0.52, 0.485, 0.405) * (0.72 + fbm(uv * 46.0, 3) * 0.6);
  mortar = mix(mortar, vec3(0.36, 0.35, 0.30), damp * 0.28);
  vec3 color = mix(mortar, brick, b.mask);

  float saltBase = saltField(uv, 2.2);
  float salt = saltBase * (0.34 + (1.0 - b.mask) * 0.56 + b.chip * 0.28);
  salt = saturate(salt * (uSalt * 1.62));
  salt *= 0.76 + 0.24 * smoothstep(0.55, 0.85, pores);
  color = mix(color, vec3(0.83, 0.805, 0.715), salt * 0.78);

  float edgeDust = smoothstep(0.0, 0.08, b.local.x) * (1.0 - smoothstep(0.92, 1.0, b.local.x))
    * smoothstep(0.0, 0.08, b.local.y) * (1.0 - smoothstep(0.92, 1.0, b.local.y));
  color += (edgeDust - 0.5) * 0.018;
  color += grain(uv, 0.02);

  float rough = mix(0.9, 0.72, b.mask) + (mottling - 0.5) * 0.1;
  rough = saturate(rough + salt * 0.07 + b.chip * 0.08);
  float ao = mix(0.58, 1.0, b.mask) * (1.0 - salt * 0.08);
  return Surface(vec4(saturate(color), 1.0), brickHeight(uv), rough, ao, salt);
}

struct TileField {
  float barrel;
  float rowMask;
  float chip;
  float row;
  float col;
  vec2 local;
  float tone;
};

TileField tileField(vec2 uv) {
  float count = 8.8 - uScale * 0.56;
  vec2 tp = vec2(uv.x * count, uv.y * count * 0.82);
  float col = floor(tp.x);
  float row = floor(tp.y);
  vec2 local = fract(tp);
  float warp = (fbm(uv * 62.0 + row * 2.3, 2) - 0.5) * 0.025;
  float barrel = pow(saturate(sin((local.x + warp) * PI)), 0.68);
  float rowMask = smoothstep(0.035, 0.105, local.y) * (1.0 - smoothstep(0.955, 1.0, local.y));
  float chipPick = hash21(vec2(col, row) + 11.2);
  float chipNoise = fbm(uv * 85.0 + col * 7.1, 3);
  float edge = 1.0 - smoothstep(0.005, 0.07, min(local.x, 1.0 - local.x));
  float chip = edge * smoothstep(0.47, 0.72, chipNoise + chipPick * 0.35)
    * step(0.4, chipPick) * uWear;
  return TileField(barrel, rowMask, chip, row, col, local, hash21(vec2(col, row) + 2.4));
}

float tileHeight(vec2 uv) {
  TileField t = tileField(uv);
  float ripple = (fbm(vec2(uv.x * 130.0, uv.y * 28.0), 2) - 0.5) * 0.03;
  float lip = smoothstep(0.82, 1.0, t.local.y) * 0.12;
  return (t.barrel * 0.62 + lip) * t.rowMask + ripple - t.chip * 0.13;
}

Surface sampleTile(vec2 uv) {
  TileField t = tileField(uv);
  float grime = fbm(uv * 15.0 + t.tone * 4.0, 4);
  float pore = fbm(uv * 120.0, 2);
  vec3 clayA = vec3(0.54, 0.255, 0.145);
  vec3 clayB = vec3(0.72, 0.405, 0.245);
  vec3 clayC = vec3(0.36, 0.20, 0.145);
  vec3 clay = mix(clayA, clayB, t.tone * 0.64 + grime * 0.36);
  clay = mix(clay, clayC, smoothstep(0.56, 0.86, fbm(uv * 8.3 + 4.0, 3)) * 0.42);
  clay *= 0.8 + pore * 0.3;

  float valley = 1.0 - t.barrel;
  float ridgeLight = pow(t.barrel, 3.2);
  float columnSeam = 1.0 - smoothstep(0.0, 0.085, min(t.local.x, 1.0 - t.local.x));
  float courseSeam = 1.0 - smoothstep(0.0, 0.06, min(t.local.y, 1.0 - t.local.y));
  clay *= 0.52 + t.barrel * 0.66;
  clay += ridgeLight * vec3(0.075, 0.035, 0.012);
  clay = mix(clay, clay * vec3(0.32, 0.28, 0.25), columnSeam * 0.78);
  clay = mix(clay, clay * vec3(0.37, 0.31, 0.27), courseSeam * 0.7);
  float damp = smoothstep(0.54, 0.8, fbm(vec2(uv.x * 9.0, uv.y * 2.2), 3)) * uWear;
  clay = mix(clay, clay * vec3(0.58, 0.66, 0.57), valley * uWear * 0.2 + damp * 0.18);
  vec3 exposed = vec3(0.68, 0.47, 0.29) * (0.82 + pore * 0.26);
  clay = mix(clay, exposed, t.chip * 0.86);
  clay *= 0.9 + t.rowMask * 0.12;

  float saltBase = saltField(uv * vec2(1.0, 0.72), 6.4);
  float salt = saltBase * (0.38 + valley * 0.23 + t.rowMask * 0.28 + t.chip * 0.3);
  salt = saturate(salt * uSalt * 1.7);
  clay = mix(clay, vec3(0.82, 0.79, 0.69), salt * 0.82);
  clay += grain(uv, 0.022);

  float rough = 0.73 + grime * 0.14 + t.chip * 0.13 + salt * 0.09;
  rough = saturate(rough);
  float ao = mix(0.52, 1.0, mix(t.rowMask * 0.72, 1.0, t.barrel));
  return Surface(vec4(saturate(clay), 1.0), tileHeight(uv), rough, ao, salt);
}

struct RustField {
  vec2 local;
  vec2 cell;
  float seam;
  float rivet;
  float corrosion;
  float pit;
  float streak;
};

RustField rustField(vec2 uv) {
  float count = 4.8 - uScale * 0.28;
  vec2 rp = uv * count;
  vec2 cell = floor(rp);
  vec2 local = fract(rp);
  float edge = min(min(local.x, 1.0 - local.x), min(local.y, 1.0 - local.y));
  float seam = 1.0 - smoothstep(0.012, 0.045, edge);
  vec2 corner = min(local, 1.0 - local);
  float rivet = 1.0 - smoothstep(0.025, 0.068, length(corner));
  float corrosion = fbm(uv * 9.0 + cell * 2.7, 5);
  corrosion = smoothstep(0.34, 0.76, corrosion * 0.68 + ridge(uv * 15.0, 3) * 0.3);
  float pit = smoothstep(0.76, 0.96, fbm(uv * 76.0 + cell, 3));
  float streak = smoothstep(0.56, 0.83, fbm(vec2(uv.x * 34.0, uv.y * 2.1), 4));
  return RustField(local, cell, seam, rivet, corrosion, pit, streak);
}

float rustHeight(vec2 uv) {
  RustField r = rustField(uv);
  float plate = 0.12 - r.seam * 0.2;
  float rivet = sqrt(max(0.0, 1.0 - pow(length(min(r.local, 1.0 - r.local)) / 0.07, 2.0))) * 0.13;
  float crust = (fbm(uv * 62.0, 3) - 0.5) * 0.08 * r.corrosion;
  return plate + rivet + crust - r.pit * 0.06;
}

Surface sampleRust(vec2 uv) {
  RustField r = rustField(uv);
  float fine = fbm(uv * 48.0 + 4.0, 3);
  float bloom = fbm(uv * 13.0 + r.cell * 4.1, 4);
  float corrosion = saturate(r.corrosion + bloom * 0.35 + r.streak * 0.2);
  corrosion = saturate(corrosion * (0.72 + uWear * 0.62) - 0.1);

  vec3 steel = vec3(0.235, 0.265, 0.255) * (0.72 + fine * 0.44);
  vec3 rustDark = vec3(0.33, 0.145, 0.06);
  vec3 rustMid = vec3(0.56, 0.245, 0.085);
  vec3 rustHot = vec3(0.73, 0.39, 0.135);
  vec3 rust = mix(rustDark, rustMid, smoothstep(0.2, 0.7, bloom));
  rust = mix(rust, rustHot, smoothstep(0.55, 0.9, fine) * 0.68);
  rust *= 0.78 + fine * 0.34;

  float patina = smoothstep(0.62, 0.84, fbm(uv * 18.0 + 9.0, 3)) * (1.0 - corrosion) * 0.38;
  steel = mix(steel, vec3(0.30, 0.42, 0.35), patina);

  vec3 color = mix(steel, rust, smoothstep(0.14, 0.72, corrosion));
  color = mix(color, vec3(0.12, 0.13, 0.12), r.seam * 0.64);
  color = mix(color, vec3(0.48, 0.44, 0.36), r.rivet * (1.0 - corrosion) * 0.4);
  color *= 1.0 - r.pit * 0.22;

  float saltBase = saltField(uv * vec2(0.82, 1.0), 8.8);
  float salt = saturate(saltBase * (0.32 + r.streak * 0.45 + r.seam * 0.3) * uSalt * 1.55);
  color = mix(color, vec3(0.76, 0.73, 0.63), salt * 0.63);
  color += grain(uv, 0.025);

  float rough = mix(0.38, 0.9, smoothstep(0.12, 0.65, corrosion));
  rough = mix(rough, 0.68, patina * 0.8);
  rough = saturate(rough + r.pit * 0.08 + salt * 0.1);
  float ao = 1.0 - r.seam * 0.36 - r.pit * 0.16;
  return Surface(vec4(saturate(color), 1.0), rustHeight(uv), rough, ao, salt);
}

struct ScreenField {
  vec2 local;
  vec2 cell;
  float hole;
  float metal;
  float rim;
  float patina;
  float tone;
  vec2 drift;
};

ScreenField screenField(vec2 uv) {
  float count = 7.0 - uScale * 0.62;
  vec2 sp = uv * count;
  vec2 cell = floor(sp);
  vec2 local = fract(sp) - 0.5;
  vec2 drift = (hash22(cell + 3.1) - 0.5) * 0.018;
  vec2 q = local + drift;
  float quatrefoil = length(abs(q) - vec2(0.158, 0.158)) - 0.145;
  float diamond = (abs(q.x) + abs(q.y) - 0.315) * 0.7071;
  float hole = min(quatrefoil, diamond);
  float aa = max(fwidth(hole) * 1.2, 0.0025);
  float metal = smoothstep(-aa, aa, hole);
  float rim = smoothstep(-0.075, -0.015, hole) * (1.0 - smoothstep(-0.012, 0.012, hole));
  float patina = smoothstep(0.48, 0.76, fbm(uv * 17.0 + cell * 3.3, 4));
  return ScreenField(local, cell, hole, metal, rim, patina, hash21(cell + 8.7), drift);
}

float screenHeight(vec2 uv) {
  ScreenField s = screenField(uv);
  vec2 border = abs(s.local);
  float frame = smoothstep(0.425, 0.485, max(border.x, border.y));
  float hammer = (fbm(uv * 180.0, 2) - 0.5) * 0.035;
  float bevel = smoothstep(-0.075, 0.005, s.hole);
  return bevel * 0.16 + frame * 0.11 + s.rim * 0.05 + hammer;
}

Surface sampleScreen(vec2 uv) {
  ScreenField s = screenField(uv);
  float mottle = fbm(uv * 24.0 + s.cell, 4);
  float fine = fbm(uv * 105.0, 3);
  vec3 bronzeDark = vec3(0.155, 0.135, 0.095);
  vec3 bronze = vec3(0.32, 0.265, 0.155);
  vec3 bronzeLight = vec3(0.51, 0.405, 0.225);
  vec3 patinaColor = vec3(0.22, 0.38, 0.315);

  vec3 color = mix(bronzeDark, bronze, smoothstep(0.18, 0.72, mottle));
  color = mix(color, bronzeLight, s.rim * 0.72 + smoothstep(0.68, 0.88, fine) * 0.2);
  color = mix(color, patinaColor, s.patina * (0.34 + uWear * 0.3));

  float saltBase = saltField(uv * 0.8, 12.0);
  float salt = saturate(saltBase * (0.3 + s.rim * 0.65 + (1.0 - s.metal) * 0.12) * uSalt * 1.6);
  color = mix(color, vec3(0.76, 0.74, 0.64), salt * 0.75);
  color *= mix(0.85, 1.08, s.metal);
  color += grain(uv, 0.018);

  float rough = mix(0.33, 0.76, s.patina) + s.rim * 0.08 + salt * 0.12;
  rough = saturate(rough + (1.0 - s.metal) * 0.06);
  float ao = mix(0.45, 1.0, s.metal) * (1.0 - s.patina * 0.08);
  float alpha = s.metal;
  return Surface(vec4(saturate(color), alpha), screenHeight(uv), rough, ao, salt);
}

Surface sampleMaterial(vec2 uv) {
  if (uMaterial == 0) return sampleBrick(uv);
  if (uMaterial == 1) return sampleTile(uv);
  if (uMaterial == 2) return sampleRust(uv);
  return sampleScreen(uv);
}

float heightMaterial(vec2 uv) {
  if (uMaterial == 0) return brickHeight(uv);
  if (uMaterial == 1) return tileHeight(uv);
  if (uMaterial == 2) return rustHeight(uv);
  return screenHeight(uv);
}

vec3 tangentNormal(vec2 uv, float centerHeight) {
  vec2 e = max(uTexel * 1.65, vec2(0.0008));
  float hx = heightMaterial(uv + vec2(e.x, 0.0));
  float hy = heightMaterial(uv + vec2(0.0, e.y));
  float dhx = (hx - centerHeight) / e.x;
  float dhy = (hy - centerHeight) / e.y;
  float bump = 0.004;
  vec3 n = normalize(vec3(-dhx * bump, -dhy * bump, 1.0));
  return normalize(n);
}

void main() {
  vec2 uv = vUv;
  Surface s = sampleMaterial(uv);
  vec3 n = tangentNormal(uv, s.height);
  vec2 encodedNormal = n.xy * 0.5 + 0.5;
  outAlbedo = s.albedo;
  outNormal = vec4(encodedNormal, 1.0, 1.0);
  outRough = vec4(s.rough, s.ao, s.salt, 1.0);
}`;
