// Shared GLSL chunks. All shading uses Kajiya-Kay anisotropic model plus
// a backlight transmission term and depth-into-fur self shadowing.
import { SHELL_LAYERS } from "./fur";
const FUR_LIGHT_FS = /* glsl */ `
uniform vec3 uLightDir;    // direction light travels
uniform vec3 uLightColor;
uniform vec3 uCamPos;
uniform float uRough;
uniform float uDensity;
uniform vec3 uRootColor;
uniform vec3 uTipColor;

vec3 shadeFur(vec3 T, vec3 worldPos, float t) {
  vec3 V = normalize(uCamPos - worldPos);
  vec3 L = normalize(-uLightDir);
  float sinTL = sqrt(max(1e-4, 1.0 - dot(T, L) * dot(T, L)));
  vec3 H = normalize(L + V);
  float sinTH = sqrt(max(1e-4, 1.0 - dot(T, H) * dot(T, H)));
  float shin = mix(160.0, 10.0, uRough);
  float spec = pow(sinTH, shin) * mix(1.6, 0.5, uRough);
  // Approximate self-shadowing: deeper (root) samples are occluded.
  float occ = mix(0.20, 1.0, pow(t, 0.65)) * mix(1.0, 0.72, uDensity);
  // Backlight transmission: only tips transmit, roots stay dark.
  float back = pow(max(dot(V, -L), 0.0), 2.0) * t * t;
  vec3 albedo = mix(uRootColor, uTipColor, t);
  vec3 col = albedo * (0.10 + 0.9 * sinTL * occ) * uLightColor;
  col += uLightColor * spec * occ * 0.55;
  col += uLightColor * back * 1.7 * mix(vec3(1.0), uTipColor, 0.4);
  return 1.0 - exp(-col * 1.35); // soft tonemap: no root blowout
}

float ign(vec2 p) { // interleaved gradient noise for LOD screen-door fade
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
`;
export const BASE_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
uniform mat4 uProj, uView;
out vec3 vN; out vec3 vP; out vec2 vUv;
void main() {
  vN = aNormal; vP = aPos; vUv = aUv;
  gl_Position = uProj * uView * vec4(aPos, 1.0);
}`;
export const BASE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vN; in vec3 vP; in vec2 vUv;
uniform vec3 uLightDir, uLightColor, uCamPos;
out vec4 frag;
void main() {
  vec3 N = normalize(vN);
  vec3 L = normalize(-uLightDir);
  vec3 V = normalize(uCamPos - vP);
  float ndl = max(dot(N, L), 0.0);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 48.0) * 0.35;
  vec3 albedo = vec3(0.16, 0.17, 0.19) * (0.9 + 0.2 * step(0.5, fract(vUv.x * 40.0)) * step(0.5, fract(vUv.y * 24.0)));
  vec3 col = albedo * (0.15 + ndl) * uLightColor + uLightColor * spec * ndl;
  frag = vec4(1.0 - exp(-col * 1.35), 1.0);
}`;
export const STRAND_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aTan;
layout(location=2) in float aT;
layout(location=3) in float aRand;
layout(location=4) in float aSide;
uniform mat4 uProj, uView;
uniform float uWidth;
out vec3 vTan; out vec3 vP; out float vT; out float vRand;
void main() {
  vec4 vp = uView * vec4(aPos, 1.0);
  vec3 tV = normalize((uView * vec4(aTan, 0.0)).xyz);
  vec3 side = normalize(cross(tV, normalize(-vp.xyz)) + vec3(1e-5));
  vp.xyz += side * aSide * uWidth * (1.0 - 0.72 * aT);
  vTan = aTan; vP = aPos; vT = aT; vRand = aRand;
  gl_Position = uProj * vp;
}`;
export const STRAND_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vTan; in vec3 vP; in float vT; in float vRand;
uniform float uFade;
out vec4 frag;
${FUR_LIGHT_FS}
void main() {
  if (ign(gl_FragCoord.xy) > uFade) discard;
  vec3 col = shadeFur(normalize(vTan), vP, vT);
  col *= 0.85 + 0.3 * vRand;
  float alpha = (1.0 - 0.55 * vT) * 0.9;
  frag = vec4(col, alpha);
}`;
export const CARD_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aTan;
layout(location=2) in vec2 aUv;
layout(location=3) in float aT;
layout(location=4) in float aRand;
uniform mat4 uProj, uView;
out vec3 vTan; out vec3 vP; out vec2 vUv; out float vT; out float vRand;
void main() {
  vTan = aTan; vP = aPos; vUv = aUv; vT = aT; vRand = aRand;
  gl_Position = uProj * uView * vec4(aPos, 1.0);
}`;
export const CARD_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vTan; in vec3 vP; in vec2 vUv; in float vT; in float vRand;
uniform float uFade;
uniform sampler2D uTex;
out vec4 frag;
${FUR_LIGHT_FS}
void main() {
  if (ign(gl_FragCoord.xy) > uFade) discard;
  vec4 tex = texture(uTex, vUv);
  if (tex.a < 0.03) discard;
  vec3 col = shadeFur(normalize(vTan), vP, vT);
  col *= mix(vec3(0.55), vec3(1.0), tex.rgb) * (0.85 + 0.3 * vRand);
  frag = vec4(col, tex.a * (1.0 - 0.35 * vT));
}`;
export const SHELL_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
uniform mat4 uProj, uView;
uniform float uFurLen;
uniform vec3 uWind;
uniform float uWindStr;
out vec3 vN; out vec3 vP; out vec2 vUv; out float vLayer;
void main() {
  float layer = float(gl_InstanceID) / float(${SHELL_LAYERS - 1}.0);
  vec3 dir = normalize(mix(aNormal, uWind, uWindStr * layer * layer * 0.9));
  vec3 p = aPos + dir * uFurLen * layer;
  vN = dir; vP = p; vUv = aUv; vLayer = layer;
  gl_Position = uProj * uView * vec4(p, 1.0);
}`;
export const SHELL_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vN; in vec3 vP; in vec2 vUv; in float vLayer;
uniform float uFade;
uniform float uCells;
out vec4 frag;
${FUR_LIGHT_FS}
float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
void main() {
  if (ign(gl_FragCoord.xy) > uFade) discard;
  vec2 cell = floor(vUv * uCells);
  float h = hash21(cell);
  if (h > uDensity) discard;
  float hairLen = 0.45 + 0.55 * hash21(cell + 7.7);
  if (vLayer > hairLen) discard;
  float t = vLayer / max(hairLen, 1e-3);
  vec3 col = shadeFur(normalize(vN), vP, t);
  float alpha = (1.0 - t * t) * 0.85;
  frag = vec4(col, alpha);
}`;
//# sourceMappingURL=shaders.js.map