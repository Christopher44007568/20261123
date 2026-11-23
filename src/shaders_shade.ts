// Fullscreen toon/NPR shading pass. Modes:
// 0 = original material (smooth), 1 = quantized bands, 2 = final NPR (bands + outlines),
// 3 = band-index debug, 4 = line-class debug.
export const QUAD_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const SHADE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uAlbedoFlag;
uniform sampler2D uNormalDepth;
uniform sampler2D uHeightLava;
uniform vec2 uResolution;
uniform vec3 uLightDir;
uniform vec3 uFogColor;
uniform int uMode;

const int BAND_COUNT = 9;
const float BAND_HEIGHT = 6.0;
const vec3 PALETTE[9] = vec3[9](
  vec3(0.494, 0.784, 0.314), vec3(0.659, 0.761, 0.337), vec3(0.851, 0.722, 0.290),
  vec3(0.788, 0.561, 0.239), vec3(0.663, 0.420, 0.208), vec3(0.549, 0.353, 0.188),
  vec3(0.478, 0.290, 0.173), vec3(0.604, 0.604, 0.604), vec3(0.941, 0.941, 0.961)
);

int bandIndex(float h) {
  return int(clamp(floor(h / BAND_HEIGHT), 0.0, float(BAND_COUNT - 1)));
}

vec3 bandAlbedo(float h, float lava) {
  vec3 col = PALETTE[bandIndex(h)];
  float lq = floor(clamp(lava, 0.0, 1.0) * 2.999) / 2.0; // 3 lava steps
  vec3 lavaCol = mix(vec3(0.42, 0.12, 0.05), vec3(0.95, 0.35, 0.08), lq);
  return mix(col, lavaCol, step(0.34, lq));
}

float quant(float x, float steps) {
  return floor(clamp(x, 0.0, 1.0) * steps) / (steps - 1.0);
}

vec3 shade(vec3 albedo, vec3 n, float depth, bool toon) {
  float d = max(dot(n, normalize(uLightDir)), 0.0);
  vec3 h = normalize(normalize(uLightDir) + vec3(0.0, 0.0, 1.0));
  float s = pow(max(dot(n, h), 0.0), 48.0);
  float f = 1.0 - exp(-depth * 0.0016);
  float ds, ss, fs;
  if (toon) {
    ds = quant(d, 4.0);
    ss = step(0.55, s) * 0.5;
    fs = clamp(floor(f * 3.0 + 0.5) / 2.0, 0.0, 1.0);
  } else {
    ds = d;
    ss = s * 0.5;
    fs = f;
  }
  vec3 col = albedo * (0.3 + 0.7 * ds) + vec3(ss);
  return mix(col, uFogColor, fs * 0.55);
}

// 8-tap edge test at a given pixel offset. Depth and band tests are one-sided
// (near side / lower band side only) so stroke width ~= offset, not 2x offset.
void edgeTest(vec2 uv, float off, int band0, out float depthEdge, out float normalEdge, out float bandEdge, out vec3 avgN) {
  vec2 tx = off / uResolution;
  vec4 c = texture(uNormalDepth, uv);
  float d0 = c.a;
  vec3 n0 = c.xyz;
  depthEdge = 0.0;
  normalEdge = 1.0;
  bandEdge = 0.0;
  avgN = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853982;
    vec2 suv = uv + vec2(cos(a), sin(a)) * tx;
    vec4 s = texture(uNormalDepth, suv);
    float di = s.a > 0.0 ? s.a : 1.0e6; // sky counts as far: closes the outer silhouette
    depthEdge = max(depthEdge, (di - d0) / (d0 * 0.02 + 1e-4));
    if (s.a > 0.0) {
      normalEdge = min(normalEdge, dot(n0, s.xyz));
      avgN += s.xyz;
      if (bandIndex(texture(uHeightLava, suv).x) > band0) bandEdge = 1.0;
    }
  }
  avgN /= 8.0;
}

void main() {
  vec4 af = texture(uAlbedoFlag, vUv);
  vec4 nd = texture(uNormalDepth, vUv);
  vec2 hl = texture(uHeightLava, vUv).xy;
  bool isTerrain = af.a > 0.5;
  bool isSky = nd.a <= 0.0;

  if (isSky) {
    fragColor = vec4(0.93, 0.96, 0.98, 1.0);
    return;
  }
  if (!isTerrain) {
    // Water baseline and any unstyled geometry pass through untouched.
    fragColor = (uMode == 3 || uMode == 4) ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(af.rgb, 1.0);
    return;
  }

  int band = bandIndex(hl.x);
  if (uMode == 3) {
    fragColor = vec4(float(band) / 8.0, 1.0, floor(clamp(hl.y, 0.0, 1.0) * 2.999) / 2.0, 1.0);
    return;
  }

  vec3 n = normalize(nd.xyz);
  float depth = nd.a;

  float deB, neB, beB, deF, neF, beF;
  vec3 avgB, avgF;
  edgeTest(vUv, 1.6, band, deB, neB, beB, avgB);
  edgeTest(vUv, 1.0, band, deF, neF, beF, avgF);
  float curvature = length(n - normalize(avgB));
  float steep = 1.0 - clamp(n.y, 0.0, 1.0);
  bool boldZone = curvature > 0.18 || steep > 0.42;
  bool boldLine = deB > 1.0 || (boldZone && neF < 0.80);
  // Gentle slopes: fine contour strokes along elevation-band boundaries
  // plus faint normal-crease lines — a distinct line type from bold peak strokes.
  bool fineLine = !boldLine && !boldZone && (neF < 0.92 || beF > 0.5);

  if (uMode == 4) {
    float cls = boldLine ? 1.0 : (fineLine ? 0.5 : 0.0);
    fragColor = vec4(cls, boldZone ? 0.5 : 0.0, 0.0, 1.0);
    return;
  }

  bool toon = uMode != 0;
  vec3 albedo = toon ? bandAlbedo(hl.x, hl.y) : af.rgb;
  vec3 col = shade(albedo, n, depth, toon);

  if (uMode == 2) {
    if (boldLine) col = vec3(0.16, 0.10, 0.07);
    else if (fineLine) col = mix(col, vec3(0.25, 0.22, 0.20), 0.55);
  }
  fragColor = vec4(col, 1.0);
}
`;
