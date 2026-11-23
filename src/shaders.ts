export const sceneVertexShader = `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;

uniform mat4 u_viewProjection;
uniform mat4 u_model;
uniform mat3 u_normalMatrix;

out vec3 v_worldPosition;
out vec3 v_normal;
out vec2 v_uv;

void main() {
  vec4 world = u_model * vec4(a_position, 1.0);
  v_worldPosition = world.xyz;
  v_normal = normalize(u_normalMatrix * a_normal);
  v_uv = a_uv;
  gl_Position = u_viewProjection * world;
}
`;

export const sceneFragmentShader = `#version 300 es
precision highp float;

in vec3 v_worldPosition;
in vec3 v_normal;
in vec2 v_uv;

uniform vec3 u_albedo;
uniform vec3 u_cameraPosition;
uniform float u_metallic;
uniform float u_roughness;
uniform float u_alpha;
uniform vec3 u_emissive;
uniform float u_panelLines;
uniform float u_shroud;

out vec4 outColor;

void main() {
  vec3 normal = normalize(v_normal);
  if (!gl_FrontFacing) normal = -normal;
  vec3 viewDir = normalize(u_cameraPosition - v_worldPosition);

  vec3 keyDirection = normalize(vec3(-0.42, 0.72, 0.58));
  vec3 fillDirection = normalize(vec3(0.68, -0.18, 0.38));
  float key = max(dot(normal, keyDirection), 0.0);
  float fill = max(dot(normal, fillDirection), 0.0);

  vec3 halfKey = normalize(keyDirection + viewDir);
  vec3 halfFill = normalize(fillDirection + viewDir);
  float shininess = mix(110.0, 10.0, u_roughness);
  float keySpec = pow(max(dot(normal, halfKey), 0.0), shininess);
  float fillSpec = pow(max(dot(normal, halfFill), 0.0), shininess * 0.45);

  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 4.0);
  vec3 metalTint = mix(vec3(1.0), u_albedo, u_metallic * 0.72);
  vec3 diffuse = u_albedo * (0.075 + key * 0.74 + fill * 0.25);
  vec3 specular = metalTint * (keySpec * (0.19 + u_metallic * 0.75) + fillSpec * 0.13);
  vec3 rim = vec3(0.16, 0.55, 0.58) * fresnel * (0.18 + u_metallic * 0.45);
  vec3 color = diffuse + specular + rim + u_emissive;
  float alpha = u_alpha;

  if (u_shroud > 0.5) {
    float edge = smoothstep(0.094, 0.136, abs(v_worldPosition.x));
    alpha = clamp(u_alpha + fresnel * 0.24 + edge * 0.27, 0.0, 0.58);
    color += vec3(0.012, 0.075, 0.085) * (0.15 + edge * 2.2 + fresnel);
  }

  if (u_panelLines > 0.5) {
    float horizontal = smoothstep(0.48, 0.5, abs(fract(v_uv.y * 22.0) - 0.5));
    float vertical = smoothstep(0.495, 0.5, abs(fract(v_uv.x * 34.0) - 0.5));
    color += vec3(0.035, 0.065, 0.055) * (horizontal + vertical);
  }

  outColor = vec4(color, alpha);
}
`;

export const backgroundVertexShader = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const backgroundFragmentShader = `#version 300 es
precision highp float;

in vec2 v_uv;
uniform vec2 u_resolution;
uniform float u_eyeSign;
out vec4 outColor;

float hash(vec2 point) {
  return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 p = v_uv - 0.5;
  float radius = length(p * vec2(1.0, 1.22));
  vec3 center = vec3(0.012, 0.030, 0.033);
  vec3 edge = vec3(0.0015, 0.004, 0.005);
  vec3 color = mix(center, edge, smoothstep(0.08, 0.72, radius));

  float sweep = exp(-pow((p.y + p.x * 0.12 + 0.17) * 8.0, 2.0));
  color += vec3(0.014, 0.035, 0.037) * sweep;
  float grain = hash(floor(v_uv * u_resolution));
  color += (grain - 0.5) * 0.005;
  color += vec3(0.002, 0.010, 0.011) * u_eyeSign * p.x;

  outColor = vec4(color, 1.0);
}
`;

export const postVertexShader = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const postFragmentShader = `#version 300 es
precision highp float;

in vec2 v_uv;

uniform sampler2D u_leftColor;
uniform sampler2D u_leftDepth;
uniform sampler2D u_rightColor;
uniform sampler2D u_rightDepth;
uniform vec4 u_leftRect;
uniform vec4 u_rightRect;
uniform vec2 u_targetSize;
uniform int u_mode;
uniform float u_k1;
uniform float u_k2;
uniform float u_near;
uniform float u_far;

out vec4 outColor;

vec2 distort(vec2 uv) {
  vec2 centered = uv * 2.0 - 1.0;
  float radius2 = dot(centered, centered);
  float radial = 1.0 + u_k1 * radius2 + u_k2 * radius2 * radius2;
  return centered * radial * 0.5 + 0.5;
}

float linearDepth(float depth) {
  float ndc = depth * 2.0 - 1.0;
  return (2.0 * u_near * u_far) / (u_far + u_near - ndc * (u_far - u_near));
}

bool inside(vec2 uv) {
  return uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0;
}

vec3 resampleEye(sampler2D colorTexture, sampler2D depthTexture, vec2 displayUv) {
  vec2 sourceUv = distort(displayUv);
  vec2 texel = 1.0 / u_targetSize;
  vec2 offsets[5] = vec2[](
    vec2(0.0, 0.0),
    vec2(0.72, 0.0),
    vec2(-0.72, 0.0),
    vec2(0.0, 0.72),
    vec2(0.0, -0.72)
  );

  float centerDepth = linearDepth(texture(depthTexture, clamp(sourceUv, 0.0, 1.0)).r);
  vec3 sum = vec3(0.0);
  float totalWeight = 0.0;
  for (int index = 0; index < 5; index++) {
    vec2 sampleUv = sourceUv + offsets[index] * texel;
    if (!inside(sampleUv)) continue;
    float sampleDepth = linearDepth(texture(depthTexture, sampleUv).r);
    float depthWeight = index == 0 ? 1.0 : 1.0 - smoothstep(0.004, 0.018, abs(sampleDepth - centerDepth));
    float weight = depthWeight * (index == 0 ? 1.0 : 0.55);
    sum += texture(colorTexture, sampleUv).rgb * weight;
    totalWeight += weight;
  }
  if (totalWeight < 0.0001) return vec3(0.0);
  return sum / totalWeight;
}

vec3 toneMap(vec3 linearColor) {
  vec3 mapped = vec3(1.0) - exp(-linearColor * 1.35);
  return pow(max(mapped, 0.0), vec3(1.0 / 2.2));
}

float rectMask(vec2 uv, vec4 rect) {
  vec2 local = (uv - rect.xy) / rect.zw;
  if (!inside(local)) return 0.0;
  vec2 edge = min(local, 1.0 - local) * rect.zw * vec2(1920.0, 1080.0);
  return smoothstep(0.0, 0.85, min(edge.x, edge.y));
}

void main() {
  vec3 result = vec3(0.0025, 0.0035, 0.0040);
  vec3 left = vec3(0.0);
  vec3 right = vec3(0.0);
  float mask = 0.0;
  vec2 leftLocal = (v_uv - u_leftRect.xy) / u_leftRect.zw;
  vec2 rightLocal = (v_uv - u_rightRect.xy) / u_rightRect.zw;

  if (u_mode == 0) {
    if (inside(leftLocal)) {
      left = resampleEye(u_leftColor, u_leftDepth, leftLocal);
      mask = rectMask(v_uv, u_leftRect);
      result = toneMap(left) * mask;
    }
  } else if (u_mode == 1) {
    if (v_uv.x < 0.5) {
      if (inside(leftLocal)) {
        left = resampleEye(u_leftColor, u_leftDepth, leftLocal);
        mask = rectMask(v_uv, u_leftRect);
        result = toneMap(left) * mask;
      }
    } else {
      if (inside(rightLocal)) {
        right = resampleEye(u_rightColor, u_rightDepth, rightLocal);
        mask = rectMask(v_uv, u_rightRect);
        result = toneMap(right) * mask;
      }
    }
  } else {
    if (inside(leftLocal) && inside(rightLocal)) {
      left = resampleEye(u_leftColor, u_leftDepth, leftLocal);
      right = resampleEye(u_rightColor, u_rightDepth, rightLocal);
      vec3 leftMapped = toneMap(left);
      vec3 rightMapped = toneMap(right);
      mask = rectMask(v_uv, u_leftRect);
      result = vec3(leftMapped.r, rightMapped.g, rightMapped.b) * mask;
    }
  }

  if (mask > 0.0) {
    vec2 lensUv = u_mode == 1 && v_uv.x >= 0.5 ? rightLocal : leftLocal;
    float radius = length((lensUv - 0.5) * vec2(1.0, 0.92));
    float vignette = 1.0 - smoothstep(0.48, 0.73, radius) * 0.52;
    float scan = 0.985 + 0.015 * sin(v_uv.y * 1080.0 * 3.14159);
    result *= vignette * scan;
  }

  outColor = vec4(result, 1.0);
}
`;

export const markerVertexShader = `#version 300 es
precision highp float;

uniform mat4 u_viewProjection;
uniform vec3 u_point;

void main() {
  gl_Position = u_viewProjection * vec4(u_point, 1.0);
  gl_PointSize = 5.0;
}
`;

export const markerFragmentShader = `#version 300 es
precision highp float;
out vec4 outColor;
void main() {
  vec2 radial = gl_PointCoord * 2.0 - 1.0;
  if (dot(radial, radial) > 1.0) discard;
  outColor = vec4(1.0, 1.0, 1.0, 1.0);
}
`;

export const depthProbeVertexShader = `#version 300 es
precision highp float;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const depthProbeFragmentShader = `#version 300 es
precision highp float;

uniform sampler2D u_depthTexture;
uniform vec2 u_uv;
uniform float u_near;
uniform float u_far;
out vec4 outColor;

void main() {
  float depth = texture(u_depthTexture, u_uv).r;
  float ndc = depth * 2.0 - 1.0;
  float linearDepth = (2.0 * u_near * u_far) / (u_far + u_near - ndc * (u_far - u_near));
  outColor = vec4(vec3(linearDepth / u_far), 1.0);
}
`;
