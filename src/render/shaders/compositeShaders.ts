export const COMPOSITE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSceneColor;
uniform sampler2D uFlareColor;
uniform int uMode;
uniform float uExposure;
uniform vec2 uViewport;
uniform int uLinearCapture;

vec3 aces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float brightLuma(vec3 c) {
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return max(luma - 20.0, 0.0);
}

vec3 simpleScreenHalo() {
  vec2 px = 1.0 / uViewport;
  vec3 sum = vec3(0.0);
  float totalWeight = 0.0;
  for (int i = 0; i < 32; i++) {
    float angle = float(i) * 0.1963495;
    vec2 dir = vec2(cos(angle), sin(angle));
    for (int ring = 1; ring <= 4; ring++) {
      float radius = 10.0 * float(ring);
      float weight = exp(-float(ring * ring) * 0.35);
      vec3 sampleColor = texture(uSceneColor, clamp(vUv + dir * px * radius, vec2(0.0), vec2(1.0))).rgb;
      sum += brightLuma(sampleColor) * sampleColor * weight;
      totalWeight += weight;
    }
  }
  return sum / max(totalWeight, 1e-4) * 0.085;
}

void main() {
  vec3 sceneHdr = texture(uSceneColor, vUv).rgb;
  vec3 flareHdr = texture(uFlareColor, vUv).rgb;

  vec3 compositeHdr = sceneHdr;
  if (uMode == 1) {
    compositeHdr += simpleScreenHalo();
  } else if (uMode == 2) {
    compositeHdr += flareHdr;
  }

  if (uLinearCapture == 1) {
    outColor = vec4(compositeHdr * uExposure, 1.0);
    return;
  }
  vec3 exposed = compositeHdr * uExposure;
  vec3 mapped = aces(exposed);
  vec3 gamma = pow(mapped, vec3(1.0 / 2.2));
  outColor = vec4(gamma, 1.0);
}
`;
