export const sceneVertex = `#version 300 es
precision highp float;
out vec2 vUv;

void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const sceneFragment = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform vec2 u_sceneMin;
uniform vec2 u_sceneMax;
uniform vec2 u_resolution;
uniform vec2 u_gaze;
uniform float u_time;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 rotate = mat2(0.82, 0.57, -0.57, 0.82);
  for (int i = 0; i < 5; i++) {
    value += noise(p) * amplitude;
    p = rotate * p * 2.03 + 11.7;
    amplitude *= 0.5;
  }
  return value;
}

float ridge(float x, float base, float amplitude, float frequency, float seed) {
  vec2 q = vec2(x * frequency + seed, seed * 7.13);
  float n = fbm(q);
  n += fbm(q * 2.4 + 4.2) * 0.34;
  n += sin(x * frequency * 8.0 + seed) * 0.035;
  return base + (n - 0.5) * amplitude;
}

void main() {
  vec2 p = mix(u_sceneMin, u_sceneMax, vUv);
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 q = vec2(p.x * aspect, p.y);

  vec3 col = vec3(0.0025, 0.006, 0.014);
  col += vec3(0.007, 0.014, 0.029) * pow(1.0 - p.y, 1.4);

  float bandDistance = (p.y - (0.84 - p.x * 0.36)) / 0.145;
  float band = exp(-bandDistance * bandDistance);
  float cloud = fbm(q * 3.1 + vec2(u_time * 0.0025, 1.7));
  float detail = fbm(q * 10.5 + cloud * 2.2);
  vec3 coolCloud = vec3(0.035, 0.092, 0.105);
  vec3 warmCloud = vec3(0.12, 0.062, 0.14);
  vec3 nebula = mix(coolCloud, warmCloud, smoothstep(0.35, 0.78, detail));
  col += band * nebula * (0.18 + cloud * 0.74);
  col -= band * smoothstep(0.58, 0.76, detail) * vec3(0.013, 0.02, 0.022);

  float horizon = exp(-pow((p.y - 0.31) / 0.16, 2.0));
  col += vec3(0.018, 0.047, 0.052) * horizon;

  vec2 clusterP = (p - vec2(0.375, 0.53)) * vec2(1.0, 0.72);
  float clusterGlow = exp(-dot(clusterP, clusterP) * 34.0);
  col += vec3(0.035, 0.057, 0.072) * clusterGlow;

  float dust = smoothstep(0.62, 0.83, detail) * band;
  col += vec3(0.008, 0.013, 0.017) * (1.0 - dust);
  col += (hash21(gl_FragCoord.xy) - 0.5) / 520.0;

  float r1 = ridge(p.x, 0.365, 0.115, 2.05, 12.7);
  float aa1 = max(fwidth(r1 - p.y) * 1.15, 0.00005);
  float m1 = smoothstep(-aa1, aa1, r1 - p.y);
  vec3 ridge1 = vec3(0.052, 0.102, 0.118);
  col = mix(col, ridge1, m1);
  float rim1 = exp(-abs(p.y - r1) * u_resolution.y * 0.16);
  col += vec3(0.16, 0.34, 0.34) * rim1 * 0.38;

  float r2 = ridge(p.x, 0.282, 0.082, 3.55, 5.2);
  r2 += 0.014 * abs(sin(p.x * 15.0 + 0.7));
  float aa2 = max(fwidth(r2 - p.y) * 1.15, 0.00005);
  float m2 = smoothstep(-aa2, aa2, r2 - p.y);
  vec3 ridge2 = vec3(0.025, 0.06, 0.069);
  col = mix(col, ridge2, m2);
  float facets = 0.5 + 0.5 * sin(p.x * 92.0 + fbm(q * 7.0) * 9.0);
  col += m2 * vec3(0.009, 0.017, 0.018) * facets;
  float rim2 = exp(-abs(p.y - r2) * u_resolution.y * 0.19);
  col += vec3(0.11, 0.25, 0.24) * rim2 * 0.28;

  float r3 = ridge(p.x, 0.206, 0.065, 5.15, 19.4);
  r3 += 0.011 * abs(sin(p.x * 23.0 + 1.9));
  float aa3 = max(fwidth(r3 - p.y) * 1.15, 0.00005);
  float m3 = smoothstep(-aa3, aa3, r3 - p.y);
  vec3 ridge3 = vec3(0.007, 0.022, 0.029);
  col = mix(col, ridge3, m3);
  col += m3 * vec3(0.004, 0.008, 0.009) * (0.5 + 0.5 * sin(p.x * 170.0));

  float foreground = smoothstep(0.11, 0.04, p.y);
  col = mix(col, vec3(0.003, 0.009, 0.013), foreground * 0.82);
  float ridgeGlow = exp(-abs(p.y - 0.112) * u_resolution.y * 0.16);
  col += vec3(0.06, 0.12, 0.11) * ridgeGlow * 0.18;

  float horizonVignette = smoothstep(0.0, 0.24, p.x) * smoothstep(1.0, 0.72, p.x);
  col *= mix(0.72, 1.0, horizonVignette);
  col = pow(max(col, 0.0), vec3(0.92));
  outColor = vec4(col, 1.0);
}
`;

export const starVertex = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec3 aParams;
layout(location = 2) in vec3 aColor;

uniform vec2 u_sceneMin;
uniform vec2 u_sceneMax;
uniform float u_tileScale;
uniform float u_time;

out vec3 vColor;
out float vBrightness;
out float vSize;

void main() {
  vColor = aColor;
  vBrightness = aParams.y;
  vSize = aParams.x;
  vec2 normalized = (aPosition - u_sceneMin) / (u_sceneMax - u_sceneMin);
  gl_Position = vec4(normalized * 2.0 - 1.0, 0.0, 1.0);
  float twinkle = 0.86 + 0.14 * sin(u_time * (0.7 + aParams.z) + aPosition.x * 90.0);
  gl_PointSize = max(1.0, aParams.x * u_tileScale * twinkle);
}
`;

export const starFragment = `#version 300 es
precision highp float;

in vec3 vColor;
in float vBrightness;
in float vSize;
out vec4 outColor;

void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float radius = dot(d, d);
  if (radius > 1.0) discard;

  float core = exp(-radius * 10.0);
  float halo = exp(-radius * 2.8) * 0.18;
  float energy = core + halo;
  vec3 color = vColor * energy * vBrightness;

  if (vBrightness > 1.0 && vSize > 2.3) {
    float spikes = exp(-abs(d.x) * 23.0) * exp(-abs(d.y) * 2.0);
    spikes += exp(-abs(d.y) * 23.0) * exp(-abs(d.x) * 2.0);
    color += vColor * spikes * 0.11 * vBrightness;
  }

  outColor = vec4(max(color, 0.0), 1.0);
}
`;
