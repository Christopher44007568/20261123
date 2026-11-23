import { FLARE_LIB } from './flareLib.glsl.js';

export const FLARE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outFlare;

uniform vec2 uViewport;
uniform vec3 uLightScreen[8];
uniform vec3 uLightColor[8];
uniform float uLightAngularRadius[8];
uniform float uLightViewDepth[8];
uniform float uLightPower[8];
uniform int uLightCount;

uniform float uGhostK[6];
uniform float uGhostRadius[6];
uniform float uGhostIntensity[6];
uniform float uGhostRing[6];
uniform float uGhostDispersion[6];

${FLARE_LIB}

vec3 renderLight(int lightIndex) {
  vec3 screen = uLightScreen[lightIndex];
  vec2 lightUv = screen.xy * 0.5 + 0.5;
  float lightViewDepth = uLightViewDepth[lightIndex];
  float aspect = uViewport.x / uViewport.y;
  vec2 kernelUv = ndcToUvDelta(vec2(uLightAngularRadius[lightIndex]), aspect);

  float visibility = sourceVisibility(lightUv, kernelUv, lightViewDepth);
  if (visibility < 0.004) return vec3(0.0);

  vec3 lightRadiance = uLightColor[lightIndex] * uLightPower[lightIndex];
  vec3 accum = vec3(0.0);

  for (int g = 0; g < 6; g++) {
    for (int channel = 0; channel < 3; channel++) {
      float chroma = channel == 0 ? 0.986 : (channel == 1 ? 1.0 : 1.016);
      float k = uGhostK[g];
      float r = uGhostRadius[g] * (1.0 + (chroma - 1.0) * uGhostDispersion[g] * 0.35);
      vec2 centerNdc = -screen.xy * k;
      float offAxis = clamp(length(centerNdc), 0.0, 1.6);
      float edgeFade = 1.0 - smoothstep(0.9, 1.55, offAxis);
      vec2 p = (vUv - (centerNdc * 0.5 + 0.5)) * vec2(aspect, 1.0);
      float sprite = apertureSprite(p, r, uGhostRing[g], max(r * 0.06, 0.0025));
      vec2 reachNdc = abs(centerNdc);
      float onScreen = 1.0 - smoothstep(0.92, 1.18, max(reachNdc.x, reachNdc.y));
      float weight = uGhostIntensity[g] * edgeFade * visibility;
      vec3 channelMask = vec3(float(channel == 0), float(channel == 1), float(channel == 2));
      accum += lightRadiance * sprite * weight * onScreen * channelMask;
    }
  }

  vec2 haloP = (vUv - lightUv) * vec2(aspect, 1.0);
  float haloR = uLightAngularRadius[lightIndex] * 3.2;
  float broad = exp(-dot(haloP, haloP) / max(haloR * haloR, 1e-6));
  float ring = exp(-pow((length(haloP) - haloR * 0.85) / max(haloR * 0.16, 1e-4), 2.0));
  float haloFade = 1.0 - smoothstep(1.05, 1.7, length(screen.xy));
  accum += lightRadiance * (broad * 0.060 + ring * 0.030) * visibility * haloFade;

  return accum;
}

void main() {
  vec3 total = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= uLightCount) break;
    total += renderLight(i);
  }
  outFlare = vec4(max(total, vec3(0.0)), 1.0);
}
`;
