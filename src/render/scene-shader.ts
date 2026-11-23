export const SCENE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;

out vec4 outColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uRainAmount;

#define PI 3.14159265359

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

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.52;
  mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    value += noise(p) * amplitude;
    p = turn * p * 2.03 + 13.7;
    amplitude *= 0.5;
  }
  return value;
}

float lineSeg(vec2 p, vec2 a, vec2 b, float width, float softness) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return 1.0 - smoothstep(width, width + softness, length(pa - ba * h));
}

float boxMask(vec2 p, vec2 center, vec2 halfSize, float softness) {
  vec2 d = abs(p - center) - halfSize;
  float sd = max(d.x, d.y);
  return 1.0 - smoothstep(-softness, softness, sd);
}

vec3 glowPoint(vec2 p, vec2 center, float radius, vec3 color) {
  vec2 d = p - center;
  float core = exp(-dot(d, d) / max(radius * radius, 1e-9));
  float haloRadius = radius * 3.8;
  float halo = exp(-dot(d, d) / (haloRadius * haloRadius));
  float anamorphic = exp(-abs(d.x) * 85.0) * exp(-abs(d.y) * 260.0);
  return color * (core * 7.0 + halo * 0.34 + anamorphic * 0.2);
}

float craneMask(vec2 p, vec2 base, float scale, float yaw) {
  vec2 q = (p - base) / scale;
  q.x += q.y * yaw;
  float m = 0.0;
  float aa = 0.006;

  m = max(m, lineSeg(q, vec2(-0.115, -0.06), vec2(-0.052, 0.205), 0.011, aa));
  m = max(m, lineSeg(q, vec2(0.122, -0.06), vec2(0.058, 0.205), 0.011, aa));
  m = max(m, lineSeg(q, vec2(-0.048, 0.198), vec2(0.055, 0.198), 0.015, aa));
  m = max(m, lineSeg(q, vec2(-0.012, 0.0), vec2(0.014, 0.198), 0.006, aa));

  m = max(m, lineSeg(q, vec2(0.0, 0.195), vec2(0.53, 0.175), 0.012, aa));
  m = max(m, lineSeg(q, vec2(0.0, 0.195), vec2(-0.22, 0.18), 0.011, aa));
  m = max(m, lineSeg(q, vec2(0.0, 0.198), vec2(0.0, 0.285), 0.009, aa));
  m = max(m, lineSeg(q, vec2(-0.22, 0.18), vec2(-0.22, 0.13), 0.016, aa));

  for (int i = 0; i < 7; i++) {
    float t = float(i) / 6.0;
    float x = mix(0.03, 0.51, t);
    float y = mix(0.19, 0.176, t);
    m = max(m, lineSeg(q, vec2(x, y), vec2(x + 0.045, y + 0.032), 0.0032, 0.008));
    m = max(m, lineSeg(q, vec2(x + 0.045, y + 0.032), vec2(x + 0.09, y), 0.0032, 0.008));
    m = max(m, lineSeg(q, vec2(x + 0.082, y), vec2(x + 0.082, y - 0.032), 0.003, 0.007));
  }

  m = max(m, lineSeg(q, vec2(0.474, 0.186), vec2(0.474, 0.0), 0.0025, 0.006));
  m = max(m, lineSeg(q, vec2(0.482, 0.004), vec2(0.514, 0.004), 0.013, aa));
  m = max(m, boxMask(q, vec2(0.015, 0.17), vec2(0.026, 0.021), 0.005));
  return m;
}

vec3 craneGlow(vec2 p, vec2 base, float scale, float yaw, float phase) {
  vec2 q = (p - base) / scale;
  q.x += q.y * yaw;
  vec3 glow = vec3(0.0);

  glow += glowPoint(p, base + vec2(0.0, 0.202 * scale), 0.0055, vec3(3.2, 0.32, 0.16));
  glow += glowPoint(p, base + vec2(0.48 * scale, 0.177 * scale), 0.0045, vec3(2.1, 0.6, 0.18));
  glow += glowPoint(p, base + vec2(0.51 * scale, 0.01 * scale), 0.005, vec3(2.8, 2.1, 1.2));
  glow += glowPoint(p, base + vec2(0.095 * scale, 0.205 * scale), 0.004, vec3(1.6, 2.8, 3.4));

  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float blink = 0.55 + 0.45 * sin(uTime * 0.9 + phase + fi * 2.1);
    glow += glowPoint(
      p,
      base + vec2((0.08 + fi * 0.086) * scale, 0.192 * scale),
      0.0027,
      vec3(2.5, 1.35, 0.48) * blink
    );
  }
  return glow;
}

vec3 skyLayer(vec2 p, vec2 uv) {
  float h = clamp(p.y + 0.12, 0.0, 1.2);
  vec3 zenith = vec3(0.003, 0.008, 0.018);
  vec3 horizon = vec3(0.042, 0.055, 0.064);
  vec3 color = mix(horizon, zenith, smoothstep(0.0, 0.8, h));
  color += vec3(0.12, 0.045, 0.012) * exp(-max(0.0, p.y + 0.1) * 10.0) * 0.54;
  color += vec3(0.02, 0.05, 0.045) * exp(-abs(p.x + 0.62) * 3.0) * exp(-abs(p.y + 0.08) * 14.0);

  vec2 cloudP = vec2(p.x * 1.4 + uTime * 0.004, p.y * 2.7 - 0.4);
  float clouds = fbm(cloudP * 2.5 + fbm(cloudP * 1.3) * 0.7);
  clouds = smoothstep(0.35, 0.82, clouds);
  float cloudBand = smoothstep(-0.12, 0.08, p.y) * (1.0 - smoothstep(0.28, 0.48, p.y));
  color += vec3(0.025, 0.042, 0.052) * clouds * cloudBand;
  color += vec3(0.09, 0.035, 0.012) * clouds * exp(-abs(p.y + 0.08) * 10.0);

  float rainCells = noise(vec2(p.x * 34.0 + p.y * 14.0 - uTime * 1.3, p.y * 8.0 + uTime * 7.5));
  float rain = smoothstep(0.84, 0.99, rainCells) * smoothstep(-0.13, 0.1, p.y);
  color += vec3(0.11, 0.16, 0.18) * rain * 0.2 * uRainAmount;
  return color;
}

vec3 cityLayer(vec2 p, float horizon) {
  vec3 color = vec3(0.0);
  for (int i = 0; i < 26; i++) {
    float fi = float(i);
    float x = mix(-0.87, 0.87, (fi + hash11(fi * 6.17)) / 26.0);
    float width = mix(0.012, 0.045, hash11(fi * 2.3 + 1.0));
    float height = mix(0.014, 0.092, pow(hash11(fi * 4.1 + 5.0), 1.7));
    float centerY = horizon + height * 0.5;
    float building = boxMask(p, vec2(x, centerY), vec2(width, height * 0.5), 0.0015);
    color = mix(color, vec3(0.0025, 0.0055, 0.0075), building);

    float windows = step(0.72, hash12(vec2(floor(p.x * 330.0), floor(p.y * 380.0))));
    float windowBand = boxMask(p, vec2(x, centerY), vec2(width * 0.7, height * 0.38), 0.002);
    color += vec3(0.7, 0.36, 0.12) * windows * windowBand * 0.035;

    if (hash11(fi * 9.7) > 0.84) {
      color += glowPoint(p, vec2(x, centerY + height * 0.45), 0.003, vec3(2.8, 0.22, 0.12));
    }
  }

  color += glowPoint(p, vec2(-0.68, horizon + 0.035), 0.018, vec3(2.4, 1.1, 0.35));
  color += glowPoint(p, vec2(0.78, horizon + 0.022), 0.014, vec3(1.4, 1.8, 1.65));
  return color;
}

vec3 portLights(vec2 p, float horizon) {
  vec3 emission = vec3(0.0);
  float ripple = sin(p.y * 310.0 + uTime * 2.1) * 0.0014 + sin(p.x * 190.0 - uTime * 1.3) * 0.0008;

  for (int i = 0; i < 18; i++) {
    float fi = float(i);
    float x = mix(-0.79, 0.8, (fi + 0.21 * sin(fi * 2.9)) / 18.0);
    float tower = 0.007 + 0.018 * hash11(fi * 3.1);
    float y = horizon + tower;
    float flicker = 0.92 + 0.08 * sin(uTime * 1.7 + fi * 3.2);
    vec3 tint = mix(vec3(3.4, 1.65, 0.56), vec3(1.8, 2.4, 2.2), hash11(fi * 8.7));
    emission += glowPoint(p, vec2(x, y), 0.0055 + 0.0035 * hash11(fi * 5.3), tint * flicker);
    emission += glowPoint(p, vec2(x + 0.006, y), 0.0025, vec3(4.2, 2.8, 1.2) * flicker);

    float reflection = exp(-pow((p.x - x) / (0.005 + 0.003 * hash11(fi)), 2.0));
    reflection *= smoothstep(horizon - 0.03, horizon, p.y) * (1.0 - smoothstep(horizon - 0.035, horizon - 0.005, p.y));
    reflection *= 0.42 + 0.58 * hash11(floor(p.y * 420.0 + uTime * 2.0));
    emission += tint * reflection * 0.35;
  }

  for (int i = 0; i < 26; i++) {
    float fi = float(i);
    float x = mix(-0.82, 0.82, (fi + hash11(fi * 14.1)) / 26.0);
    float row = mod(fi, 3.0);
    float y = horizon + 0.008 + row * 0.011 + hash11(fi * 1.73) * 0.006;
    vec3 tint = mix(vec3(2.6, 1.05, 0.32), vec3(1.25, 1.7, 1.45), hash11(fi * 2.7));
    emission += glowPoint(p, vec2(x, y), 0.0028 + 0.0018 * hash11(fi), tint);

    float streak = exp(-pow((p.x - x + ripple) / 0.003, 2.0));
    streak *= smoothstep(horizon - 0.055, horizon, p.y) * (1.0 - smoothstep(horizon - 0.018, horizon, p.y));
    streak *= 0.4 + 0.6 * hash11(floor((p.y + uTime * 0.012) * 520.0));
    emission += tint * streak * 0.22;
  }

  emission += glowPoint(p, vec2(-0.58, horizon + 0.051), 0.0025, vec3(1.0, 4.0, 1.55));
  emission += glowPoint(p, vec2(0.63, horizon + 0.072), 0.0025, vec3(4.2, 0.42, 0.2));
  return emission;
}

vec3 containerShip(vec2 p, float horizon) {
  vec3 color = vec3(0.0);
  float hull = boxMask(p, vec2(0.39, horizon - 0.003), vec2(0.295, 0.018), 0.0015);
  float deck = boxMask(p, vec2(0.39, horizon + 0.017), vec2(0.27, 0.008), 0.001);
  color = mix(color, vec3(0.006, 0.011, 0.013), max(hull, deck));
  color = mix(color, vec3(0.02, 0.035, 0.038), boxMask(p, vec2(0.64, horizon + 0.027), vec2(0.047, 0.033), 0.002));

  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    float x = 0.19 + fi * 0.031;
    float height = 0.01 + mod(fi, 3.0) * 0.009;
    float container = boxMask(p, vec2(x, horizon + 0.021 + height * 0.5), vec2(0.014, height * 0.5), 0.001);
    vec3 tint = mix(vec3(0.03, 0.012, 0.006), vec3(0.006, 0.025, 0.03), hash11(fi * 4.3));
    color = mix(color, tint, container);
  }

  color += glowPoint(p, vec2(0.64, horizon + 0.047), 0.0055, vec3(2.4, 2.7, 2.0));
  color += glowPoint(p, vec2(0.672, horizon + 0.035), 0.003, vec3(3.1, 1.4, 0.4));
  color += glowPoint(p, vec2(0.13, horizon + 0.028), 0.0022, vec3(0.3, 3.1, 1.4));
  return color;
}

vec3 waterLayer(vec2 p, float horizon) {
  float below = 1.0 - smoothstep(horizon - 0.001, horizon + 0.001, p.y);
  float depth = clamp((horizon - p.y) / 0.34, 0.0, 1.0);
  vec3 water = mix(vec3(0.0018, 0.0042, 0.0062), vec3(0.0004, 0.0013, 0.0024), depth);

  float wave = sin(p.x * 70.0 + sin(p.y * 240.0 - uTime * 0.8) * 2.2);
  float broken = smoothstep(0.5, 0.95, noise(vec2(p.x * 160.0 + uTime * 0.15, p.y * 380.0 - uTime * 0.7)));
  water += vec3(0.018, 0.045, 0.048) * max(wave, 0.0) * broken * (1.0 - depth) * 0.2;

  float wake = exp(-pow((p.x - 0.38) / 0.16, 2.0)) * smoothstep(horizon - 0.02, horizon - 0.002, p.y);
  water += vec3(0.01, 0.024, 0.028) * wake;
  return water * below;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  float horizon = -0.112;

  vec3 sky = skyLayer(p, uv);
  vec3 water = waterLayer(p, horizon);
  float aboveHorizon = smoothstep(horizon - 0.004, horizon + 0.006, p.y);
  vec3 color = mix(water, sky, aboveHorizon);

  color += cityLayer(p, horizon) * aboveHorizon;
  color += containerShip(p, horizon) * (0.42 + 0.58 * aboveHorizon);

  float craneA = craneMask(p, vec2(-0.58, horizon - 0.012), 0.93, 0.025);
  float craneB = craneMask(p, vec2(-0.085, horizon - 0.015), 1.1, -0.018);
  float craneC = craneMask(p, vec2(0.585, horizon - 0.01), 0.79, 0.04);
  float cranes = max(max(craneA, craneB), craneC);
  color = mix(color, vec3(0.0012, 0.0022, 0.0026), cranes * 0.96);

  vec3 beamWash = vec3(0.0);
  beamWash += glowPoint(p, vec2(-0.222, horizon + 0.11), 0.02, vec3(0.42, 0.52, 0.54));
  beamWash += glowPoint(p, vec2(0.34, horizon + 0.085), 0.025, vec3(0.58, 0.3, 0.1));
  color += beamWash * 0.2 * (0.55 + 0.45 * aboveHorizon);

  color += craneGlow(p, vec2(-0.58, horizon - 0.012), 0.93, 0.025, 0.0) * 0.86;
  color += craneGlow(p, vec2(-0.085, horizon - 0.015), 1.1, -0.018, 2.1) * 0.86;
  color += craneGlow(p, vec2(0.585, horizon - 0.01), 0.79, 0.04, 4.2) * 0.86;

  color += portLights(p, horizon) * 0.82;

  float dockBand = boxMask(p, vec2(-0.75, horizon - 0.008), vec2(0.12, 0.014), 0.002)
    + boxMask(p, vec2(0.76, horizon - 0.009), vec2(0.115, 0.016), 0.002)
    + boxMask(p, vec2(0.0, horizon - 0.013), vec2(0.44, 0.006), 0.0015);
  color = mix(color, vec3(0.0025, 0.005, 0.0055), clamp(dockBand, 0.0, 1.0) * 0.9);

  float fog = fbm(vec2(p.x * 2.8 - uTime * 0.012, p.y * 12.0 + uTime * 0.02));
  fog = smoothstep(0.38, 0.72, fog) * exp(-abs(p.y - horizon - 0.045) * 11.0);
  color += vec3(0.032, 0.052, 0.055) * fog * 0.27;

  float lowMist = exp(-abs(p.y - horizon + 0.02) * 24.0) * (0.45 + 0.55 * noise(vec2(p.x * 17.0, uTime * 0.1)));
  color += vec3(0.02, 0.035, 0.036) * lowMist;

  float distantRain = smoothstep(0.9, 0.995, noise(vec2(p.x * 28.0 + p.y * 9.0 - uTime * 1.8, p.y * 7.0 + uTime * 11.0)));
  color += vec3(0.055, 0.085, 0.09) * distantRain * smoothstep(-0.02, 0.3, p.y) * 0.22 * uRainAmount;

  color += vec3(0.0015, 0.0025, 0.003) * (0.5 + 0.5 * sin(gl_FragCoord.y * 1.7 + uTime * 0.2));
  outColor = vec4(max(color, vec3(0.0)), 1.0);
}
`;
