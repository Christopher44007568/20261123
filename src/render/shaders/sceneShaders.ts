export const SCENE_VERTEX = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;

uniform mat4 uViewProj;
out vec3 vWorldPos;
out vec3 vNormal;

void main() {
  vWorldPos = aPosition;
  vNormal = aNormal;
  gl_Position = uViewProj * vec4(aPosition, 1.0);
}
`;

export const SCENE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;

uniform int uMaterial;
uniform vec3 uCameraPos;
uniform vec3 uLightPos[8];
uniform vec3 uLightColor[8];
uniform float uLightIntensity[8];
uniform int uLightCount;

out vec4 outColor;

vec3 materialAlbedo(int material) {
  if (material == 0) return vec3(0.075, 0.085, 0.10);
  if (material == 1) return vec3(0.22, 0.24, 0.27);
  if (material == 2) return vec3(0.11, 0.12, 0.14);
  if (material == 3) return vec3(0.30, 0.32, 0.36);
  if (material == 4) return vec3(0.16, 0.20, 0.26);
  return vec3(1.0);
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 albedo = materialAlbedo(uMaterial);

  if (uMaterial == 5) {
    outColor = vec4(albedo * 60.0, 1.0);
    return;
  }

  vec3 moonDir = normalize(vec3(-0.35, 0.8, 0.45));
  vec3 radiance = albedo * (0.045 + 0.16 * max(dot(n, moonDir), 0.0));

  for (int i = 0; i < 8; i++) {
    if (i >= uLightCount) break;
    vec3 toLight = uLightPos[i] - vWorldPos;
    float dist = length(toLight);
    vec3 l = toLight / max(dist, 1e-4);
    float ndl = max(dot(n, l), 0.0);
    float attenuation = uLightIntensity[i] / (1.0 + 0.55 * dist * dist);
    radiance += albedo * uLightColor[i] * attenuation * (ndl * 0.85 + 0.15);
  }

  float cameraDist = length(vWorldPos - uCameraPos);
  float fog = 1.0 - exp(-0.012 * cameraDist * cameraDist);
  vec3 fogColor = vec3(0.012, 0.017, 0.030);
  radiance = mix(radiance, fogColor, clamp(fog, 0.0, 0.92));

  outColor = vec4(max(radiance, vec3(0.0)), 1.0);
}
`;
