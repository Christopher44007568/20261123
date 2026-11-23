// Geometry pass: writes albedo+flag, world normal+depth, height+lava to MRT G-buffer.
export const GEO_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aData; // (height, lavaMask); water sends (-1, -1)
uniform mat4 uViewProj;
uniform mat4 uView;
out vec3 vNormal;
out vec3 vWorldPos;
out vec2 vData;
out float vViewZ;
void main() {
  vNormal = aNormal;
  vWorldPos = aPos;
  vData = aData;
  vViewZ = -(uView * vec4(aPos, 1.0)).z;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`;

// Continuous "original material" albedo: smooth elevation gradient + lava blend.
export const GEO_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorldPos;
in vec2 vData;
in float vViewZ;
uniform float uWaterLevel;
layout(location=0) out vec4 outAlbedoFlag;
layout(location=1) out vec4 outNormalDepth;
layout(location=2) out vec2 outHeightLava;

vec3 ramp(float t) {
  vec3 c0 = vec3(0.45, 0.72, 0.32);  // lowland green
  vec3 c1 = vec3(0.85, 0.72, 0.38);  // tan
  vec3 c2 = vec3(0.55, 0.36, 0.22);  // brown rock
  vec3 c3 = vec3(0.62, 0.62, 0.66);  // grey rock
  vec3 c4 = vec3(0.92, 0.92, 0.95);  // summit ash
  vec3 col = mix(c0, c1, smoothstep(0.0, 0.25, t));
  col = mix(col, c2, smoothstep(0.25, 0.5, t));
  col = mix(col, c3, smoothstep(0.5, 0.75, t));
  col = mix(col, c4, smoothstep(0.75, 1.0, t));
  return col;
}

void main() {
  bool isWater = vData.x < -0.5;
  if (isWater) {
    // Water baseline: flat, unstyled. Flag 0 excludes it from toon + outlines.
    outAlbedoFlag = vec4(0.23, 0.46, 0.72, 0.0);
    outNormalDepth = vec4(0.0, 1.0, 0.0, vViewZ);
    outHeightLava = vec2(uWaterLevel, 0.0);
    return;
  }
  float t = clamp(vData.x / 48.0, 0.0, 1.0);
  vec3 albedo = ramp(t);
  float lava = clamp(vData.y, 0.0, 1.0);
  vec3 lavaCol = mix(vec3(0.42, 0.12, 0.05), vec3(0.95, 0.35, 0.08), lava);
  albedo = mix(albedo, lavaCol, smoothstep(0.15, 0.7, lava));
  outAlbedoFlag = vec4(albedo, 1.0);
  outNormalDepth = vec4(normalize(vNormal), vViewZ);
  outHeightLava = vec2(vData.x, lava);
}
`;

export const WATER_DATA = new Float32Array([-1, -1, -1, -1, -1, -1, -1, -1]);
