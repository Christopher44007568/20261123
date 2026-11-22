export const fullscreenVert = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const captureFrag = `#version 300 es
precision highp float;
precision highp int;

uniform vec3 uCamPos;
uniform vec3 uTarget;
uniform float uAspect;
uniform float uTanHalf;

in vec2 vUv;

layout(location = 0) out vec4 outBackColor;
layout(location = 1) out vec4 outBackDepth;
layout(location = 2) out vec4 outFrontColor;
layout(location = 3) out vec4 outFrontDepth;

const float FAR_DIST = 11.0;

mat3 cameraBasis(vec3 eye, vec3 target) {
  vec3 f = normalize(target - eye);
  vec3 r = normalize(cross(f, vec3(0.0, 1.0, 0.0)));
  vec3 u = cross(r, f);
  return mat3(r, u, f);
}

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash12(i.xy + i.z * 17.0);
  float n100 = hash12(i.xy + vec2(1.0, 0.0) + i.z * 17.0);
  float n010 = hash12(i.xy + vec2(0.0, 1.0) + i.z * 17.0);
  float n110 = hash12(i.xy + vec2(1.0, 1.0) + i.z * 17.0);
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(hash12(i.xy + (i.z + 1.0) * 17.0),
                   hash12(i.xy + vec2(1.0, 0.0) + (i.z + 1.0) * 17.0), f.x);
  float nx11 = mix(hash12(i.xy + vec2(0.0, 1.0) + (i.z + 1.0) * 17.0),
                   hash12(i.xy + vec2(1.0, 1.0) + (i.z + 1.0) * 17.0), f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}

float fbm(vec3 p) {
  float n = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    n += a * noise3(p);
    p = p * 2.07 + vec3(13.1, 7.7, 5.3);
    a *= 0.5;
  }
  return n;
}

float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 0.0001);
}

float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

float sdRock(vec3 p) {
  vec3 q = p - vec3(0.0, 0.35, 0.0);
  float rough = (fbm(q * 3.0 + vec3(2.1, 0.0, 4.7)) - 0.5) * 0.12;
  float strata = sin(q.y * 33.0 + fbm(q * 2.0 + 7.0) * 5.0) * 0.008;
  float d = sdEllipsoid(q, vec3(1.48, 0.39, 0.91));
  d = max(d, -q.y * 0.35 - 0.25);
  d += rough + strata;
  vec3 chip = q - vec3(-0.94, -0.08, 0.46);
  d = max(d, -sdEllipsoid(chip, vec3(0.22, 0.16, 0.12)));
  return d;
}

float sdBones(vec3 p) {
  float d = 1.0e5;
  float spineY = 1.43;
  float spineZ = 0.02;
  for (int i = 0; i < 9; i++) {
    float a = float(i) / 8.0;
    float b = clamp(a + 0.15, 0.0, 1.0);
    float xa = mix(-1.02, 1.12, a);
    float xb = mix(-1.02, 1.12, b);
    vec3 pa = vec3(xa, spineY + 0.055 * sin(xa * 3.0) - 0.03 * xa * xa, spineZ + 0.055 * sin(xa * 2.1));
    vec3 pb = vec3(xb, spineY + 0.055 * sin(xb * 3.0) - 0.03 * xb * xb, spineZ + 0.055 * sin(xb * 2.1));
    d = min(d, sdCapsule(p, pa, pb, 0.034));
  }

  vec3 skull = p - vec3(-1.24, 1.52, 0.035);
  d = min(d, sdEllipsoid(skull, vec3(0.245, 0.125, 0.085)));
  d = min(d, sdCapsule(p, vec3(-1.31, 1.47, 0.035), vec3(-1.57, 1.43, 0.08), 0.033));
  d = min(d, sdCapsule(p, vec3(-1.42, 1.50, 0.04), vec3(-1.64, 1.49, 0.06), 0.021));
  d = min(d, sdCapsule(p, vec3(-1.31, 1.46, 0.07), vec3(-1.54, 1.38, 0.15), 0.011));

  for (int i = 0; i < 7; i++) {
    float x = mix(-0.74, 0.79, float(i) / 6.0);
    float y = spineY + 0.055 * sin(x * 3.0) - 0.03 * x * x;
    float z = spineZ + 0.055 * sin(x * 2.1);
    for (int s = 0; s < 2; s++) {
      float side = s == 0 ? -1.0 : 1.0;
      vec3 p0 = vec3(x, y - 0.015, z);
      vec3 p1 = vec3(x + 0.035, y - 0.20, z + side * 0.19);
      vec3 p2 = vec3(x - 0.015, y - 0.34, z + side * 0.27);
      vec3 p3 = vec3(x - 0.07, y - 0.40, z + side * 0.09);
      d = min(d, sdCapsule(p, p0, p1, 0.019));
      d = min(d, sdCapsule(p, p1, p2, 0.016));
      d = min(d, sdCapsule(p, p2, p3, 0.014));
    }
  }

  for (int i = 0; i < 6; i++) {
    float a = float(i) / 5.0;
    float x = mix(1.10, 1.58, a);
    float y = spineY - 0.03 * x * x + 0.055 * sin(x * 3.0) - 0.02 * a * a;
    vec3 c = vec3(x, y, spineZ + 0.055 * sin(x * 2.1));
    d = min(d, sdEllipsoid(p - c, vec3(0.045, 0.027, 0.026)));
  }

  vec3 shoulder = vec3(-0.22, spineY + 0.07, 0.04);
  d = min(d, sdCapsule(p, shoulder, vec3(-0.48, 1.90, -0.35), 0.021));
  d = min(d, sdCapsule(p, vec3(-0.48, 1.90, -0.35), vec3(-0.95, 2.02, -0.50), 0.016));
  if (p.y > 1.98) {
    d = min(d, sdCapsule(p, vec3(-0.78, 2.00, -0.44), vec3(-1.05, 2.16, -0.34), 0.008));
  }
  d = min(d, sdCapsule(p, shoulder, vec3(0.06, 1.88, 0.42), 0.020));
  d = min(d, sdCapsule(p, vec3(0.06, 1.88, 0.42), vec3(0.48, 1.98, 0.55), 0.015));

  for (int s = 0; s < 2; s++) {
    float side = s == 0 ? -1.0 : 1.0;
    vec3 hip = vec3(0.62, spineY - 0.10, spineZ + side * 0.055);
    vec3 knee = vec3(0.71, 1.20, side * 0.14);
    vec3 ankle = vec3(0.60, 0.82, side * 0.18);
    d = min(d, sdCapsule(p, hip, knee, 0.020));
    d = min(d, sdCapsule(p, knee, ankle, 0.017));
    d = min(d, sdCapsule(p, ankle, ankle + vec3(0.05, -0.13, side * 0.025), 0.013));
    d = min(d, sdCapsule(p, ankle, ankle + vec3(-0.11, -0.12, side * 0.04), 0.010));
  }
  return d;
}

float mapGlass(vec3 p) {
  return sdBones(p);
}

vec3 calcNormalGlass(vec3 p) {
  const vec2 e = vec2(0.0008, 0.0);
  return normalize(vec3(
    mapGlass(p + e.xyy) - mapGlass(p - e.xyy),
    mapGlass(p + e.yxy) - mapGlass(p - e.yxy),
    mapGlass(p + e.yyx) - mapGlass(p - e.yyx)
  ));
}

bool marchGlass(vec3 ro, vec3 rd, out float tHit, out vec3 normal) {
  float t = 0.05;
  tHit = FAR_DIST;
  normal = vec3(0.0, 1.0, 0.0);
  for (int i = 0; i < 112; i++) {
    vec3 p = ro + rd * t;
    float d = mapGlass(p);
    if (d < 0.0012) {
      tHit = t;
      normal = calcNormalGlass(p);
      return true;
    }
    t += max(d * 0.92, 0.0025);
    if (t > 7.5) break;
  }
  return false;
}

bool marchRock(vec3 ro, vec3 rd, out float tHit, out vec3 normal) {
  float t = 0.05;
  tHit = FAR_DIST;
  normal = vec3(0.0, 1.0, 0.0);
  for (int i = 0; i < 88; i++) {
    vec3 p = ro + rd * t;
    float d = sdRock(p);
    if (d < 0.0015) {
      tHit = t;
      normal = calcNormalGlass(p);
      return true;
    }
    t += max(d * 0.82, 0.002);
    if (t > 8.5) break;
  }
  return false;
}

vec3 calcNormalRock(vec3 p) {
  const vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(
    sdRock(p + e.xyy) - sdRock(p - e.xyy),
    sdRock(p + e.yxy) - sdRock(p - e.yxy),
    sdRock(p + e.yyx) - sdRock(p - e.yyx)
  ));
}

vec3 background(vec3 rd) {
  float v = rd.y * 0.5 + 0.5;
  vec3 low = vec3(0.018, 0.035, 0.031);
  vec3 high = vec3(0.008, 0.018, 0.017);
  vec3 col = mix(low, high, smoothstep(0.0, 0.72, v));
  vec3 keyDir = normalize(uTarget - uCamPos);
  float halo = pow(max(dot(rd, keyDir), 0.0), 22.0);
  float cone = pow(max(dot(rd, normalize(keyDir + vec3(0.16, 0.1, 0.0))), 0.0), 9.0);
  col += vec3(0.026, 0.075, 0.061) * halo;
  col += vec3(0.050, 0.027, 0.013) * cone * 0.52;
  float seams = smoothstep(0.965, 1.0, sin(rd.x * 42.0 + rd.z * 60.0) * 0.5 + 0.5);
  col += seams * vec3(0.006, 0.012, 0.010);
  return col;
}

vec3 shadeFloor(vec3 p, vec3 rd, float t) {
  vec2 q = p.xz;
  float r = length(q);
  vec3 base = vec3(0.018, 0.028, 0.026);
  float pool = exp(-r * r * 0.55);
  vec3 col = base + vec3(0.045, 0.100, 0.080) * pool * 0.42;
  float rings = smoothstep(0.92, 1.0, sin(r * 18.0 - 1.2) * 0.5 + 0.5);
  col += rings * vec3(0.008, 0.015, 0.012) * (1.0 - smoothstep(0.4, 2.8, r));
  vec3 reflected = vec3(0.0);
  float ribX = abs(p.x + 0.1);
  reflected += vec3(0.070, 0.130, 0.110) * exp(-ribX * ribX * 8.0) * smoothstep(0.1, 1.3, p.z) * (1.0 - smoothstep(0.0, 2.3, length(q)));
  reflected += vec3(0.070, 0.032, 0.012) * exp(-pow((p.x - 0.55) * 4.0, 2.0)) * smoothstep(0.2, 1.4, p.z) * 0.45;
  col += reflected * 0.5;
  vec3 n = vec3(0.0, 1.0, 0.0);
  vec3 key = normalize(vec3(-2.5, 3.6, 2.3) - p);
  vec3 fill = normalize(vec3(3.0, 1.8, 1.0) - p);
  float rough = 0.18 + fbm(vec3(q * 7.0, 1.0)) * 0.2;
  vec3 h = normalize(key - rd);
  float spec = pow(max(dot(n, h), 0.0), mix(96.0, 18.0, rough));
  col += vec3(0.30, 0.55, 0.46) * spec * 0.12;
  h = normalize(fill - rd);
  spec = pow(max(dot(n, h), 0.0), 28.0);
  col += vec3(0.34, 0.19, 0.08) * spec * 0.08;
  float dust = smoothstep(0.965, 1.0, fbm(vec3(q * 36.0, t * 0.23)));
  col += dust * vec3(0.018, 0.025, 0.021);
  return col;
}

vec3 shadeRock(vec3 p, vec3 n, vec3 rd) {
  float grain = fbm(p * 14.0 + vec3(0.0, 3.2, 0.0));
  float broad = fbm(p * 3.4);
  vec3 albedo = mix(vec3(0.130, 0.137, 0.120), vec3(0.235, 0.245, 0.208), broad);
  albedo *= 0.78 + grain * 0.38;
  float bands = sin(p.y * 30.0 + broad * 4.0) * 0.5 + 0.5;
  albedo = mix(albedo, albedo * vec3(0.90, 1.06, 1.02), bands * 0.35);
  float fissure = smoothstep(0.91, 1.0, fbm(p * 23.0 + vec3(p.y * 2.0)));
  albedo *= 1.0 - fissure * 0.42;
  vec3 key = normalize(vec3(-2.5, 3.6, 2.3) - p);
  vec3 fill = normalize(vec3(3.0, 1.8, 1.0) - p);
  vec3 rim = normalize(vec3(1.3, 2.0, -3.0) - p);
  float diff = max(dot(n, key), 0.0) * 0.92 + max(dot(n, fill), 0.0) * 0.34;
  float rimLight = pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * max(dot(n, rim), 0.0);
  vec3 col = albedo * (vec3(0.70, 0.84, 0.75) * diff + vec3(0.15, 0.24, 0.21));
  vec3 h = normalize(key - rd);
  float spec = pow(max(dot(n, h), 0.0), 18.0);
  col += vec3(0.28, 0.38, 0.32) * spec * 0.24;
  col += vec3(0.58, 0.33, 0.13) * rimLight * 0.18;
  float ao = 0.6 + 0.4 * smoothstep(-0.12, 0.42, p.y);
  return col * ao;
}

vec3 glassSurface(vec3 p, vec3 n, vec3 rd, bool backSide, out float alpha) {
  vec3 v = normalize(uCamPos - p);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float fresnel = pow(1.0 - ndv, 2.4);
  vec3 key = normalize(vec3(-2.2, 3.4, 2.5) - p);
  vec3 fill = normalize(vec3(2.7, 0.6, 1.4) - p);
  vec3 h = normalize(key + v);
  float spec = pow(max(dot(n, h), 0.0), mix(72.0, 190.0, fresnel));
  float h2 = pow(max(dot(n, normalize(fill + v)), 0.0), 46.0);
  float irid = 0.5 + 0.5 * cos(6.2831 * (fresnel * 1.2 + p.x * 0.17 + p.y * 0.09));
  vec3 cool = mix(vec3(0.46, 0.92, 0.78), vec3(0.82, 1.0, 0.93), irid);
  vec3 warm = mix(vec3(0.92, 0.55, 0.24), vec3(1.0, 0.75, 0.43), irid);
  vec3 tint = backSide ? warm : cool;
  alpha = backSide ? (0.12 + fresnel * 0.20) : (0.20 + fresnel * 0.62);
  alpha += spec * (backSide ? 0.10 : 0.26);
  alpha = clamp(alpha, 0.0, 0.88);
  vec3 col = tint * (0.28 + fresnel * 0.42);
  col += vec3(0.94, 1.0, 0.96) * spec * (backSide ? 0.28 : 0.55);
  col += vec3(0.40, 0.72, 0.66) * h2 * 0.10;
  col += tint * 0.06;
  return col;
}

vec2 packDepth(float t) {
  float x = clamp(t / FAR_DIST, 0.0, 1.0);
  float hi = floor(x * 255.0);
  float lo = floor(fract(x * 255.0) * 255.0);
  return vec2(hi, lo) / 255.0;
}

float traceOpaque(vec3 ro, vec3 rd, out vec3 p, out vec3 n, out bool floorHit) {
  float tPlane = FAR_DIST;
  floorHit = false;
  if (rd.y < -0.0001) {
    tPlane = -ro.y / rd.y;
    if (tPlane < 0.0) tPlane = FAR_DIST;
  }
  float tRock;
  vec3 nRock;
  bool hitRock = marchRock(ro, rd, tRock, nRock);
  if (hitRock && tRock < tPlane) {
    p = ro + rd * tRock;
    n = nRock;
    return tRock;
  }
  if (tPlane < FAR_DIST) {
    p = ro + rd * tPlane;
    n = vec3(0.0, 1.0, 0.0);
    floorHit = true;
    return tPlane;
  }
  p = ro + rd * FAR_DIST;
  n = normalize(rd);
  return FAR_DIST;
}

bool marchGlassBack(vec3 ro, vec3 rd, float tFront, out float tBack, out vec3 nBack) {
  tBack = FAR_DIST;
  nBack = vec3(0.0, 1.0, 0.0);
  float t = tFront + 0.0025;
  for (int i = 0; i < 92; i++) {
    vec3 p = ro + rd * t;
    float d = mapGlass(p);
    if (d > 0.0022) {
      tBack = t;
      nBack = calcNormalGlass(p);
      return true;
    }
    t += 0.0065;
    if (t > tFront + 0.78) break;
  }
  return false;
}

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  mat3 basis = cameraBasis(uCamPos, uTarget);
  vec3 rd = normalize(basis * vec3(uv.x * uTanHalf * uAspect, uv.y * uTanHalf, 1.0));
  vec3 ro = uCamPos;

  vec3 surfaceP = ro + rd * FAR_DIST;
  vec3 surfaceN = -rd;
  bool floorHit = false;
  float tOpaque = traceOpaque(ro, rd, surfaceP, surfaceN, floorHit);

  vec3 backCol = background(rd);
  if (tOpaque < FAR_DIST) {
    backCol = floorHit ? shadeFloor(surfaceP, rd, tOpaque) : shadeRock(surfaceP, surfaceN, rd);
  }
  float backDepth = tOpaque;

  float tFront;
  vec3 nFront;
  bool frontHit = marchGlass(ro, rd, tFront, nFront);
  float tBack;
  vec3 nBack;
  bool backHit = false;
  if (frontHit) {
    backHit = marchGlassBack(ro, rd, tFront, tBack, nBack);
  }

  if (backHit) {
    float backAlpha;
    vec3 backBone = glassSurface(ro + rd * tBack, nBack, rd, true, backAlpha);
    backCol = mix(backCol, backBone, backAlpha);
    backDepth = min(backDepth, tBack);
  }

  float frontAlpha = 0.0;
  vec3 frontCol = vec3(0.0);
  if (frontHit) {
    frontCol = glassSurface(ro + rd * tFront, nFront, rd, false, frontAlpha);
  }

  outBackColor = vec4(backCol, 1.0);
  outBackDepth = vec4(packDepth(backDepth), 0.0, 1.0);
  outFrontColor = vec4(frontCol * frontAlpha, frontAlpha);
  outFrontDepth = vec4(packDepth(frontHit ? tFront : FAR_DIST), 0.0, 1.0);
}`;

export const synthFrag = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uFrontColor;
uniform sampler2D uBackColor;
uniform sampler2D uFrontDepth;
uniform sampler2D uBackDepth;
uniform vec2 uResolution;
uniform vec2 uViewUV;
uniform float uAspect;
uniform float uTanHalf;
uniform int uMode;
uniform float uFallback;
uniform float uLayerMix;
uniform float uTime;
uniform float uExposure;

in vec2 vUv;

out vec4 fragColor;

const int GRID = 9;
const float TILE_W = 288.0;
const float TILE_H = 180.0;
const vec2 ATLAS_SIZE = vec2(2592.0, 1620.0);
const float FAR_DIST = 11.0;
const vec3 TARGET = vec3(0.0, 1.34, 0.0);

mat3 cameraBasis(vec3 eye, vec3 target) {
  vec3 f = normalize(target - eye);
  vec3 r = normalize(cross(f, vec3(0.0, 1.0, 0.0)));
  vec3 u = cross(r, f);
  return mat3(r, u, f);
}

vec3 cameraPosition(vec2 grid) {
  vec2 n = grid / 8.0 * 2.0 - 1.0;
  return vec3(n.x * 1.02, 1.34 + n.y * 0.58, 4.48);
}

vec3 cameraRay(vec3 origin, mat3 basis, vec2 screen) {
  return normalize(basis * vec3(screen.x * uTanHalf * uAspect, screen.y * uTanHalf, 1.0));
}

vec2 projectPoint(vec3 p, vec2 grid, out vec3 origin, out mat3 basis, out float distance) {
  origin = cameraPosition(grid);
  basis = cameraBasis(origin, TARGET);
  vec3 rel = p - origin;
  vec3 local = vec3(dot(rel, basis[0]), dot(rel, basis[1]), dot(rel, basis[2]));
  distance = local.z;
  vec2 ndc = vec2(
    local.x / max(local.z * uTanHalf * uAspect, 0.0001),
    local.y / max(local.z * uTanHalf, 0.0001)
  );
  return ndc * 0.5 + 0.5;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 atlasUV(vec2 local, vec2 grid) {
  vec2 halfTexel = 0.5 / vec2(TILE_W, TILE_H);
  vec2 clampedLocal = clamp(local, halfTexel, 1.0 - halfTexel);
  return (grid * vec2(TILE_W, TILE_H) + clampedLocal * vec2(TILE_W, TILE_H)) / ATLAS_SIZE;
}

float unpackDepth(vec4 encoded) {
  float hi = floor(encoded.r * 255.0 + 0.5);
  float lo = floor(encoded.g * 255.0 + 0.5);
  return (hi * 255.0 + lo) / 65025.0 * FAR_DIST;
}

float sampleDepth(sampler2D depthTex, vec2 local, vec2 grid) {
  return unpackDepth(texture(depthTex, atlasUV(local, grid)));
}

vec4 sampleColor(sampler2D colorTex, vec2 local, vec2 grid) {
  return texture(colorTex, atlasUV(local, grid));
}

vec4 nearestSample(sampler2D colorTex, sampler2D depthTex, vec3 ro, vec3 rd, vec2 grid, out float depthOut) {
  vec2 cell = clamp(floor(grid + 0.5), vec2(0.0), vec2(8.0));
  vec3 origin;
  mat3 basis;
  float dist;
  vec2 local = projectPoint(ro + rd * 3.75, cell, origin, basis, dist);
  vec4 col = sampleColor(colorTex, local, cell);
  depthOut = sampleDepth(depthTex, local, cell);
  return col;
}

vec4 bilinearSample(sampler2D colorTex, sampler2D depthTex, vec3 ro, vec3 rd, vec2 grid, out float depthOut) {
  vec2 base = clamp(floor(grid), vec2(0.0), vec2(7.0));
  vec2 frac = clamp(grid - base, 0.0, 1.0);
  vec4 acc = vec4(0.0);
  float depthAcc = 0.0;
  for (int y = 0; y < 2; y++) {
    for (int x = 0; x < 2; x++) {
      vec2 cell = base + vec2(float(x), float(y));
      float w = mix(1.0 - frac.x, frac.x, float(x)) * mix(1.0 - frac.y, frac.y, float(y));
      vec3 origin;
      mat3 basis;
      float dist;
      vec2 local = projectPoint(ro + rd * 3.75, cell, origin, basis, dist);
      acc += sampleColor(colorTex, local, cell) * w;
      depthAcc += sampleDepth(depthTex, local, cell) * w;
    }
  }
  depthOut = depthAcc;
  return acc;
}

vec4 depthAwareSample(
  sampler2D colorTex,
  sampler2D depthTex,
  vec3 ro,
  vec3 rd,
  vec2 grid,
  vec2 screen,
  bool frontLayer,
  out float validFraction,
  out float residualPx,
  out float centerDepthOut
) {
  vec2 base = clamp(floor(grid), vec2(0.0), vec2(7.0));
  vec2 frac = clamp(grid - base, 0.0, 1.0);
  vec3 probe = ro + rd * 3.76;
  vec3 centerPoint = vec3(0.0);
  float centerDepth = 0.0;
  float centerWeight = 0.0;
  for (int y = 0; y < 2; y++) {
    for (int x = 0; x < 2; x++) {
      vec2 cell = base + vec2(float(x), float(y));
      float w = mix(1.0 - frac.x, frac.x, float(x)) * mix(1.0 - frac.y, frac.y, float(y));
      vec3 origin;
      mat3 basis;
      float projected;
      vec2 local = projectPoint(probe, cell, origin, basis, projected);
      float depth = sampleDepth(depthTex, local, cell);
      if (frontLayer && depth > 10.7) continue;
      vec3 ray = cameraRay(origin, basis, local * 2.0 - 1.0);
      centerPoint += (origin + ray * min(depth, 7.2)) * w;
      centerDepth += depth * w;
      centerWeight += w;
    }
  }
  centerDepthOut = centerDepth / max(centerWeight, 0.0001);
  if (centerWeight < 0.08) {
    validFraction = 0.0;
    residualPx = 0.0;
    return vec4(0.0);
  }
  centerPoint /= centerWeight;
  centerDepth /= centerWeight;
  float threshold = max(uFallback / max(uResolution.x, 1.0) * 3.4, 0.00035);
  vec4 acc = vec4(0.0);
  float weightTotal = 0.0;
  float validTotal = 0.0;
  float residualSum = 0.0;
  float residualWeight = 0.0;

  for (int y = 0; y < 2; y++) {
    for (int x = 0; x < 2; x++) {
      vec2 cell = base + vec2(float(x), float(y));
      float bilinear = mix(1.0 - frac.x, frac.x, float(x)) * mix(1.0 - frac.y, frac.y, float(y));
      if (bilinear < 0.001) continue;

      vec3 srcOrigin;
      mat3 srcBasis;
      float srcDistance;
      vec2 srcLocal = projectPoint(centerPoint, cell, srcOrigin, srcBasis, srcDistance);
      bool inView = srcLocal.x > -0.08 && srcLocal.x < 1.08 && srcLocal.y > -0.08 && srcLocal.y < 1.08;
      float srcDepth = sampleDepth(depthTex, srcLocal, cell);
      if (frontLayer && srcDepth > 10.7) {
        weightTotal += bilinear;
        continue;
      }
      vec3 srcRay = cameraRay(srcOrigin, srcBasis, srcLocal * 2.0 - 1.0);
      vec3 srcPoint = srcOrigin + srcRay * min(srcDepth, 8.0);
      vec3 destOrigin;
      mat3 destBasis;
      float destDistance;
      vec2 destLocal = projectPoint(srcPoint, grid, destOrigin, destBasis, destDistance);
      vec2 residual = (destLocal - screen) * vec2(uAspect, 1.0);
      float res = length(residual);
      bool valid = inView && res < threshold && destLocal.x > -0.03 && destLocal.x < 1.03 && destLocal.y > -0.03 && destLocal.y < 1.03;
      float w = bilinear;
      if (!valid) {
        w *= mix(0.16, 0.03, clamp(res / (threshold * 4.0), 0.0, 1.0));
      }
      vec4 sampled = sampleColor(colorTex, srcLocal, cell);
      acc += sampled * w;
      weightTotal += w;
      if (valid) validTotal += bilinear;
      residualSum += res * bilinear;
      residualWeight += bilinear;
    }
  }

  if (weightTotal < 0.0001) {
    validFraction = 0.0;
    residualPx = 0.0;
    return vec4(0.0);
  }
  acc /= weightTotal;
  validFraction = clamp(validTotal / max(frac.x + frac.y - frac.x * frac.y + 0.0001, 0.0001), 0.0, 1.0);
  residualPx = residualSum / max(residualWeight, 0.0001) * uResolution.y;
  return acc;
}

vec3 applyDust(vec3 col, vec2 uv, vec2 grid, float time) {
  float aspect = uAspect;
  vec2 centered = uv - 0.5;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float scale = 31.0 + fi * 19.0;
    vec2 parallax = (grid / 8.0 - 0.5) * (0.034 + fi * 0.028);
    vec2 drift = vec2(time * (0.0015 + fi * 0.0007), sin(time * 0.08 + fi) * 0.001);
    vec2 p = vec2(uv.x * aspect, uv.y) * scale + parallax * scale + drift;
    vec2 cell = floor(p);
    vec2 f = fract(p) - 0.5;
    float h = hash12(cell + vec2(fi * 37.0, time * 0.012));
    vec2 jitter = vec2(hash12(cell + 11.1), hash12(cell + 27.7)) - 0.5;
    vec2 delta = f - jitter * 0.34;
    float radius = 0.028 + h * 0.016;
    float dotMask = smoothstep(radius, radius * 0.15, length(delta));
    float visibility = smoothstep(0.56, 0.94, h);
    float twinkle = 0.74 + 0.26 * sin(time * 0.65 + h * 33.0);
    vec3 tint = mix(vec3(0.72, 0.95, 0.84), vec3(1.0, 0.77, 0.47), fract(h * 9.7));
    col += tint * dotMask * visibility * twinkle * (0.052 - fi * 0.008);
    if (h > 0.975) {
      float flare = smoothstep(0.0008, 0.0, abs(delta.y)) * smoothstep(0.17, 0.0, abs(delta.x));
      float flareV = smoothstep(0.0008, 0.0, abs(delta.x)) * smoothstep(0.11, 0.0, abs(delta.y));
      col += tint * (flare + flareV) * visibility * 0.05;
    }
  }
  return col;
}

vec3 finishColor(vec3 col, vec2 uv, vec2 grid) {
  col = applyDust(col, uv, grid, uTime);
  float vignette = smoothstep(0.82, 0.22, length((uv - 0.5) * vec2(0.86, 1.0)));
  col *= 0.66 + 0.34 * vignette;
  col *= uExposure;
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  float grain = (hash12(uv * uResolution + fract(uTime) * 91.0) - 0.5) * 0.018;
  return clamp(col + grain, 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  vec2 screen = uv * 2.0 - 1.0;
  vec2 grid = clamp(uViewUV * 8.0, vec2(0.0), vec2(8.0));
  vec3 destOrigin = cameraPosition(grid);
  mat3 destBasis = cameraBasis(destOrigin, TARGET);
  vec3 rd = cameraRay(destOrigin, destBasis, screen);

  vec4 back;
  vec4 front;
  float validFraction = 1.0;
  float residualPx = 0.0;
  float centerDepth = 0.0;

  if (uMode == 0) {
    float dBack;
    float dFront;
    back = nearestSample(uBackColor, uBackDepth, destOrigin, rd, grid, dBack);
    front = nearestSample(uFrontColor, uFrontDepth, destOrigin, rd, grid, dFront);
  } else if (uMode == 1) {
    float dBack;
    float dFront;
    back = bilinearSample(uBackColor, uBackDepth, destOrigin, rd, grid, dBack);
    front = bilinearSample(uFrontColor, uFrontDepth, destOrigin, rd, grid, dFront);
  } else {
    float vfBack;
    float rpBack;
    float cdBack;
    float vfFront;
    float rpFront;
    float cdFront;
    back = depthAwareSample(uBackColor, uBackDepth, destOrigin, rd, grid, uv, false, vfBack, rpBack, cdBack);
    front = depthAwareSample(uFrontColor, uFrontDepth, destOrigin, rd, grid, uv, true, vfFront, rpFront, cdFront);
    if (cdFront > 10.7) {
      front = vec4(0.0);
    }
    validFraction = mix(vfBack, vfFront, step(0.001, front.a));
    residualPx = mix(rpBack, rpFront, step(0.001, front.a));
    centerDepth = cdBack;
  }

  float frontScale = mix(0.68, 1.24, clamp(uLayerMix, 0.0, 1.0));
  float frontAlpha = clamp(front.a * frontScale, 0.0, 1.0);
  vec3 frontPremul = front.rgb * frontScale;
  vec3 col = back.rgb * (1.0 - frontAlpha) + frontPremul;

  if (uMode == 2) {
    float fallback = 1.0 - smoothstep(0.12, 0.92, validFraction);
    col = mix(col, col * vec3(1.10, 0.96, 0.78) + vec3(0.008, 0.003, 0.0), fallback * 0.16);
    float silhouette = 1.0 - smoothstep(0.0, 0.04, abs(centerDepth - 4.15));
    col *= 1.0 - silhouette * 0.015;
  }

  col = finishColor(col, uv, grid);
  fragColor = vec4(col, 1.0);
}`;
