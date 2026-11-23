export const panelVertexShader = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aTangent;
layout(location = 3) in vec2 aUv;

uniform mat4 uViewProjection;

out vec3 vWorldPosition;
out vec3 vNormal;
out vec3 vTangent;
out vec2 vUv;

void main() {
  vWorldPosition = aPosition;
  vNormal = aNormal;
  vTangent = aTangent;
  vUv = aUv;
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}`;

export const panelFragmentShader = `#version 300 es
precision highp float;

in vec3 vWorldPosition;
in vec3 vNormal;
in vec3 vTangent;
in vec2 vUv;

uniform sampler2D uRawAlbedo;
uniform sampler2D uRawNormal;
uniform sampler2D uRawRoughness;
uniform sampler2D uDecodedAlbedo;
uniform sampler2D uDecodedNormal;
uniform sampler2D uDecodedRoughness;
uniform int uViewMode;
uniform int uHeatMap;
uniform float uMip;
uniform float uErrorGain;
uniform vec3 uCameraPosition;

out vec4 outColor;

const float PI = 3.14159265359;

float distributionGGX(float NdotH, float roughness) {
  float a = roughness * roughness;
  float a2 = a * a;
  float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / max(PI * d * d, 0.00001);
}

float geometrySchlick(float NdotV, float roughness) {
  float r = roughness + 1.0;
  float k = (r * r) / 8.0;
  return NdotV / (NdotV * (1.0 - k) + k);
}

vec3 heatRamp(float value) {
  vec3 cold = vec3(0.060, 0.125, 0.115);
  vec3 mid = vec3(0.84, 0.57, 0.18);
  vec3 hot = vec3(0.73, 0.10, 0.035);
  float t = clamp(value, 0.0, 1.0);
  if (t < 0.5) return mix(cold, mid, smoothstep(0.03, 0.5, t));
  return mix(mid, hot, smoothstep(0.5, 1.0, t));
}

void main() {
  vec2 sampleUv = vec2(vUv.x, 1.0 - vUv.y);
  vec4 rawAlbedo = textureLod(uRawAlbedo, sampleUv, uMip);
  vec4 rawNormal = textureLod(uRawNormal, sampleUv, uMip);
  vec4 rawRoughness = textureLod(uRawRoughness, sampleUv, uMip);
  vec4 decodedAlbedo = textureLod(uDecodedAlbedo, sampleUv, uMip);
  vec4 decodedNormal = textureLod(uDecodedNormal, sampleUv, uMip);
  vec4 decodedRoughness = textureLod(uDecodedRoughness, sampleUv, uMip);

  if (rawAlbedo.a < 0.5) discard;

  if (uViewMode == 2) {
    vec3 delta;
    if (uHeatMap == 0) {
      delta = abs(rawAlbedo.rgb - decodedAlbedo.rgb);
    } else if (uHeatMap == 1) {
      delta = abs(rawNormal.rg - decodedNormal.rg).rgg;
    } else {
      delta = abs(rawRoughness.rgb - decodedRoughness.rgb);
    }
    float errorValue = max(max(delta.r, delta.g), delta.b) * uErrorGain;
    vec3 color = heatRamp(errorValue);
    float grid = smoothstep(0.97, 1.0, fract(errorValue * 23.0));
    color += grid * 0.035;
    outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    return;
  }

  vec4 albedoSample = uViewMode == 0 ? rawAlbedo : decodedAlbedo;
  vec4 normalSample = uViewMode == 0 ? rawNormal : decodedNormal;
  vec4 roughSample = uViewMode == 0 ? rawRoughness : decodedRoughness;

  vec3 albedo = albedoSample.rgb;
  vec2 normalXY = normalSample.rg * 2.0 - 1.0;
  float normalZ = sqrt(max(0.0, 1.0 - dot(normalXY, normalXY)));
  vec3 tangentNormal = normalize(vec3(normalXY, normalZ));

  vec3 N = normalize(vNormal);
  vec3 T = normalize(vTangent - N * dot(N, vTangent));
  vec3 B = normalize(cross(N, T));
  mat3 TBN = mat3(T, B, N);
  vec3 normal = normalize(TBN * tangentNormal);

  float roughness = clamp(roughSample.r, 0.045, 1.0);
  float ao = clamp(roughSample.g, 0.0, 1.0);
  float salt = clamp(roughSample.b, 0.0, 1.0);
  vec3 V = normalize(uCameraPosition - vWorldPosition);
  float NdotV = max(dot(normal, V), 0.001);

  vec3 keyDirection = normalize(vec3(-0.58, 0.76, 0.72));
  vec3 fillDirection = normalize(vec3(0.72, 0.12, 0.58));
  vec3 rimDirection = normalize(vec3(0.18, 0.55, -0.82));
  vec3 keyColor = vec3(1.30, 1.03, 0.80) * 2.45;
  vec3 fillColor = vec3(0.42, 0.57, 0.62) * 0.86;
  vec3 rimColor = vec3(1.12, 0.79, 0.48) * 0.66;

  vec3 lit = vec3(0.0);
  vec3 F0 = vec3(0.038);

  vec3 L = keyDirection;
  float NdotL = max(dot(normal, L), 0.0);
  vec3 H = normalize(L + V);
  float NdotH = max(dot(normal, H), 0.0);
  float D = distributionGGX(NdotH, roughness);
  float G = geometrySchlick(NdotV, roughness) * geometrySchlick(max(NdotL, 0.001), roughness);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - NdotH, 5.0);
  vec3 specular = (D * G * F) / max(4.0 * NdotV * NdotL, 0.001);
  vec3 diffuse = albedo * (1.0 - F) / PI;
  lit += (diffuse + specular) * keyColor * NdotL;

  L = fillDirection;
  NdotL = max(dot(normal, L), 0.0);
  H = normalize(L + V);
  NdotH = max(dot(normal, H), 0.0);
  D = distributionGGX(NdotH, min(1.0, roughness + 0.08));
  G = geometrySchlick(NdotV, roughness) * geometrySchlick(max(NdotL, 0.001), roughness);
  F = F0 + (1.0 - F0) * pow(1.0 - NdotH, 5.0);
  specular = (D * G * F) / max(4.0 * NdotV * NdotL, 0.001);
  diffuse = albedo * (1.0 - F) / PI;
  lit += (diffuse + specular) * fillColor * NdotL;

  L = rimDirection;
  float rim = pow(1.0 - NdotV, 2.2) * max(dot(normal, L), 0.0);
  lit += rimColor * rim * (0.28 + albedo * 0.9) * (1.0 - roughness * 0.55);

  float sky = smoothstep(-0.35, 0.9, normal.y);
  vec3 ambient = mix(vec3(0.13, 0.125, 0.105), vec3(0.37, 0.36, 0.31), sky);
  ambient *= ao;
  vec3 ambientSpec = vec3(0.16, 0.15, 0.12) * (1.0 - roughness) * (0.35 + sky * 0.65);
  lit += albedo * ambient + ambientSpec;

  lit += salt * vec3(0.016, 0.014, 0.009);
  lit = lit / (lit + vec3(1.0));
  lit = clamp(pow(lit, vec3(1.0 / 2.2)), 0.0, 1.0);
  outColor = vec4(lit, 1.0);
}`;

export const backgroundVertexShader = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p * 0.5;
  gl_Position = vec4(p - 1.0, 0.0, 1.0);
}`;

export const backgroundFragmentShader = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 low = vec3(0.645, 0.605, 0.535);
  vec3 high = vec3(0.775, 0.745, 0.675);
  vec3 color = mix(low, high, smoothstep(0.0, 1.0, vUv.y));
  vec2 glowPoint = vec2(0.27, 0.83);
  vec2 aspect = vec2(1.65, 1.0);
  float glow = exp(-dot((vUv - glowPoint) * aspect, (vUv - glowPoint) * aspect) * 5.8);
  color += glow * vec3(0.10, 0.085, 0.055);
  vec2 centered = (vUv - 0.5) * vec2(1.0, 0.72);
  color *= 1.0 - dot(centered, centered) * 0.18;
  color += (hash21(vUv * 1400.0) - 0.5) * 0.014;
  outColor = vec4(color, 1.0);
}`;

export const floorVertexShader = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
uniform mat4 uViewProjection;
out vec3 vWorldPosition;
void main() {
  vWorldPosition = aPosition;
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}`;

export const floorFragmentShader = `#version 300 es
precision highp float;
in vec3 vWorldPosition;
uniform vec3 uCameraPosition;
out vec4 outColor;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 p = vWorldPosition.xz;
  vec3 base = mix(vec3(0.48, 0.45, 0.39), vec3(0.61, 0.57, 0.49), smoothstep(-4.0, 4.0, p.x));
  base += (hash21(floor(p * 90.0)) - 0.5) * 0.025;
  vec2 shadowPos = p - vec2(-0.38, 0.25);
  float shadow = exp(-dot(shadowPos * vec2(0.46, 1.55), shadowPos * vec2(0.46, 1.55)) * 5.6);
  base *= mix(0.47, 1.0, shadow);
  float lightPool = exp(-dot(p * vec2(0.28, 0.35), p * vec2(0.28, 0.35)) * 1.8);
  base += lightPool * vec3(0.06, 0.045, 0.025);
  float distanceToCamera = length(vWorldPosition - uCameraPosition);
  vec3 horizon = vec3(0.68, 0.64, 0.57);
  base = mix(base, horizon, smoothstep(3.8, 9.0, distanceToCamera));
  outColor = vec4(base, 1.0);
}`;

export const meshVertexShader = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
uniform mat4 uViewProjection;
out vec3 vWorldPosition;
out vec3 vNormal;
void main() {
  vWorldPosition = aPosition;
  vNormal = aNormal;
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}`;

export const meshFragmentShader = `#version 300 es
precision highp float;
in vec3 vWorldPosition;
in vec3 vNormal;
uniform vec3 uCameraPosition;
uniform vec3 uColor;
uniform float uRoughness;
out vec4 outColor;

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCameraPosition - vWorldPosition);
  vec3 L = normalize(vec3(-0.58, 0.76, 0.72));
  float diffuse = max(dot(N, L), 0.0) * 0.62;
  float fill = max(dot(N, normalize(vec3(0.7, 0.2, 0.5))), 0.0) * 0.18;
  float spec = pow(max(dot(N, normalize(L + V)), 0.0), mix(80.0, 5.0, uRoughness));
  spec *= (1.0 - uRoughness) * 0.28;
  vec3 color = uColor * (0.24 + diffuse + fill) + vec3(spec);
  color = color / (color + vec3(1.0));
  outColor = vec4(pow(color, vec3(1.0 / 2.2)), 1.0);
}`;
