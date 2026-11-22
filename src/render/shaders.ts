export const VERT_SRC = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in float aMaterial;
layout(location = 3) in float aTint;

uniform mat4 uViewProj;

out vec3 vNormal;
out vec3 vWorldPos;
flat out int vMaterial;
flat out int vTint;

void main() {
  gl_Position = uViewProj * vec4(aPosition, 1.0);
  vNormal = aNormal;
  vWorldPos = aPosition;
  vMaterial = int(aMaterial + 0.5);
  vTint = int(aTint + 0.5);
}
`;

export const FRAG_SRC = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vWorldPos;
flat in int vMaterial;
flat in int vTint;

uniform int uMode; // 0 = shaded, 1 = LOD color blocks, 2 = wireframe
uniform vec3 uCameraPos;
uniform vec3 uFogColor;

out vec4 outColor;

vec3 materialColor(int m) {
  if (m == 1) return vec3(0.83, 0.78, 0.70);
  if (m == 2) return vec3(0.62, 0.55, 0.48);
  if (m == 3) return vec3(0.32, 0.30, 0.31);
  if (m == 4) return vec3(0.42, 0.27, 0.14);
  if (m == 5) return vec3(0.45, 0.48, 0.52);
  if (m == 6) return vec3(0.55, 0.40, 0.22);
  return vec3(0.8);
}

vec3 lodColor(int tint) {
  // Six distinguishable depth bands, reused cyclically.
  vec3 palette[6];
  palette[0] = vec3(0.85, 0.30, 0.25);
  palette[1] = vec3(0.95, 0.60, 0.20);
  palette[2] = vec3(0.55, 0.75, 0.25);
  palette[3] = vec3(0.20, 0.70, 0.80);
  palette[4] = vec3(0.30, 0.45, 0.90);
  palette[5] = vec3(0.65, 0.35, 0.85);
  return palette[tint % 6];
}

void main() {
  if (uMode == 2) {
    outColor = vec4(0.05, 0.95, 0.85, 1.0);
    return;
  }
  if (uMode == 1) {
    vec3 base = lodColor(vTint);
    float shade = 0.55 + 0.45 * max(dot(normalize(vNormal),
      normalize(vec3(0.4, 0.8, 0.3))), 0.0);
    outColor = vec4(base * shade, 1.0);
    return;
  }

  vec3 base = materialColor(vMaterial);
  vec3 n = normalize(vNormal);
  vec3 lightDir = normalize(vec3(0.45, 0.8, 0.35));
  float diffuse = max(dot(n, lightDir), 0.0);
  float hemi = 0.25 + 0.25 * (n.y * 0.5 + 0.5);
  vec3 viewDir = normalize(uCameraPos - vWorldPos);
  vec3 halfDir = normalize(lightDir + viewDir);
  float spec = pow(max(dot(n, halfDir), 0.0), 24.0) * 0.18;
  float ao = 0.9 + 0.1 * fract(sin(dot(floor(vWorldPos), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  vec3 color = base * (0.35 + hemi + 0.7 * diffuse) * ao + vec3(spec);

  float dist = length(uCameraPos - vWorldPos);
  float fog = smoothstep(60.0, 150.0, dist);
  color = mix(color, uFogColor, fog);
  outColor = vec4(color, 1.0);
}
`;

export const LINE_VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
uniform mat4 uViewProj;
void main() {
  gl_Position = uViewProj * vec4(aPosition, 1.0);
}
`;

export const LINE_FRAG_SRC = `#version 300 es
precision highp float;
uniform vec3 uColor;
out vec4 outColor;
void main() {
  outColor = vec4(uColor, 1.0);
}
`;
