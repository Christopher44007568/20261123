export const compositeFragment = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D u_atlas;
uniform vec2 u_atlasSize;
uniform vec2 u_grid;
uniform float u_gutter;
uniform vec4 u_tileRects[48];
uniform float u_tileScales[48];
uniform vec2 u_resolution;
uniform float u_time;

const int COLS = 8;

float luma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

int tileIndex(int col, int row) {
  return row * COLS + col;
}

vec3 sampleTile(int index, vec2 local) {
  vec4 rect = u_tileRects[index];
  vec2 texel = rect.xy + u_gutter - 0.5 + local * rect.zw;
  return texture(u_atlas, texel / u_atlasSize).rgb;
}

vec3 edgeAwareSample(int index, vec2 local) {
  float scale = u_tileScales[index];
  vec3 center = sampleTile(index, local);
  if (scale > 0.99) return center;

  vec4 rect = u_tileRects[index];
  vec2 stepUv = 0.8 / max(rect.zw, vec2(1.0));
  vec3 left = sampleTile(index, local - vec2(stepUv.x, 0.0));
  vec3 right = sampleTile(index, local + vec2(stepUv.x, 0.0));
  vec3 down = sampleTile(index, local - vec2(0.0, stepUv.y));
  vec3 up = sampleTile(index, local + vec2(0.0, stepUv.y));

  float centerLuma = luma(center);
  float wl = exp(-abs(luma(left) - centerLuma) * 14.0);
  float wr = exp(-abs(luma(right) - centerLuma) * 14.0);
  float wd = exp(-abs(luma(down) - centerLuma) * 14.0);
  float wu = exp(-abs(luma(up) - centerLuma) * 14.0);
  float total = 2.0 + wl + wr + wd + wu;
  return (center * 2.0 + left * wl + right * wr + down * wd + up * wu) / total;
}

void main() {
  vec2 gridPoint = vUv * u_grid;
  int col = clamp(int(floor(gridPoint.x)), 0, COLS - 1);
  int row = clamp(int(floor(gridPoint.y)), 0, int(u_grid.y) - 1);
  vec2 local = fract(gridPoint);
  int current = tileIndex(col, row);

  vec3 color = edgeAwareSample(current, local);
  vec4 rect = u_tileRects[current];
  float scale = u_tileScales[current];

  if (col > 0) {
    float distancePx = local.x * rect.z / max(scale, 0.001);
    float weight = 0.5 * (1.0 - smoothstep(0.0, 2.35, distancePx));
    vec3 neighbor = edgeAwareSample(current - 1, vec2(1.0, local.y));
    color = mix(color, neighbor, weight);
  }
  if (col < COLS - 1) {
    float distancePx = (1.0 - local.x) * rect.z / max(scale, 0.001);
    float weight = 0.5 * (1.0 - smoothstep(0.0, 2.35, distancePx));
    vec3 neighbor = edgeAwareSample(current + 1, vec2(0.0, local.y));
    color = mix(color, neighbor, weight);
  }
  if (row > 0) {
    float distancePx = local.y * rect.w / max(scale, 0.001);
    float weight = 0.5 * (1.0 - smoothstep(0.0, 2.35, distancePx));
    vec3 neighbor = edgeAwareSample(current - COLS, vec2(local.x, 1.0));
    color = mix(color, neighbor, weight);
  }
  if (row < int(u_grid.y) - 1) {
    float distancePx = (1.0 - local.y) * rect.w / max(scale, 0.001);
    float weight = 0.5 * (1.0 - smoothstep(0.0, 2.35, distancePx));
    vec3 neighbor = edgeAwareSample(current + COLS, vec2(local.x, 0.0));
    color = mix(color, neighbor, weight);
  }

  vec2 centered = vUv - 0.5;
  float vignette = 1.0 - dot(centered, centered) * 0.16;
  color *= vignette;
  float dither = (fract(sin(dot(gl_FragCoord.xy + u_time, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  outColor = vec4(color + dither, 1.0);
}
`;

export const finalFragment = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D u_result;
uniform sampler2D u_reference;
uniform int u_mode;
uniform float u_split;
uniform vec2 u_resolution;
uniform float u_time;

float luma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec3 tiled = texture(u_result, vUv).rgb;
  vec3 reference = texture(u_reference, vUv).rgb;
  vec3 color = tiled;

  if (u_mode == 1) {
    color = reference;
  } else if (u_mode == 2) {
    color = vUv.x < u_split ? reference : tiled;
    if (abs(vUv.x - u_split) < 1.2 / u_resolution.x) {
      color = vec3(1.0, 0.74, 0.42);
    }
  } else if (u_mode == 3) {
    vec3 difference = abs(tiled - reference);
    float error = luma(difference);
    float refEdge = abs(luma(reference) - luma(texture(u_reference, vUv + vec2(1.0 / u_resolution.x, 0.0)).rgb));
    float heat = smoothstep(0.002, 0.09, error);
    color = vec3(0.002, 0.014, 0.018);
    color += vec3(0.03, 0.22, 0.28) * smoothstep(0.02, 0.16, refEdge);
    color += vec3(1.0, 0.22, 0.16) * heat * 0.8;
    color += vec3(1.0, 0.78, 0.4) * smoothstep(0.2, 0.7, heat) * 1.2;
    float scan = 0.94 + 0.06 * sin(gl_FragCoord.y * 2.4 + u_time * 4.0);
    color *= scan;
  }

  outColor = vec4(color, 1.0);
}
`;

export const errorMetricsFragment = `#version 300 es
precision highp float;

out vec4 outColor;

uniform sampler2D u_result;
uniform sampler2D u_reference;
uniform vec2 u_grid;
uniform vec2 u_resolution;

float luma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec2 cellMin = vec2(cell) / u_grid;
  vec2 cellSize = 1.0 / u_grid;
  float meanError = 0.0;
  float edgeError = 0.0;
  float edgeWeight = 0.0;
  float sampleCount = 0.0;

  for (int y = 0; y < 7; y++) {
    for (int x = 0; x < 7; x++) {
      vec2 local = (vec2(float(x), float(y)) + 0.5) / 7.0;
      vec2 uv = cellMin + local * cellSize;
      vec3 tiled = texture(u_result, uv).rgb;
      vec3 reference = texture(u_reference, uv).rgb;
      float error = dot(abs(tiled - reference), vec3(0.333333));

      vec2 px = 1.1 / u_resolution;
      float gx = luma(texture(u_reference, uv + vec2(px.x, 0.0)).rgb)
        - luma(texture(u_reference, uv - vec2(px.x, 0.0)).rgb);
      float gy = luma(texture(u_reference, uv + vec2(0.0, px.y)).rgb)
        - luma(texture(u_reference, uv - vec2(0.0, px.y)).rgb);
      float gradient = length(vec2(gx, gy));
      meanError += error;
      if (gradient > 0.035) {
        edgeError += error * min(gradient * 12.0, 1.0);
        edgeWeight += min(gradient * 12.0, 1.0);
      }
      sampleCount += 1.0;
    }
  }

  float seamError = 0.0;
  for (int i = 0; i < 9; i++) {
    float t = (float(i) + 0.5) / 9.0;
    vec2 uvs[4];
    uvs[0] = cellMin + vec2(0.012, t) * cellSize;
    uvs[1] = cellMin + vec2(0.988, t) * cellSize;
    uvs[2] = cellMin + vec2(t, 0.012) * cellSize;
    uvs[3] = cellMin + vec2(t, 0.988) * cellSize;
    for (int j = 0; j < 4; j++) {
      float error = dot(abs(texture(u_result, uvs[j]).rgb - texture(u_reference, uvs[j]).rgb), vec3(0.333333));
      seamError += error / 36.0;
    }
  }

  float mae = meanError / sampleCount * 255.0;
  float edgeMae = edgeWeight > 0.0 ? edgeError / edgeWeight * 255.0 : 0.0;
  float edgeDensity = edgeWeight / sampleCount;
  float seamMae = seamError * 255.0;
  outColor = vec4(mae / 255.0, edgeMae / 255.0, edgeDensity, seamMae / 255.0);
}
`;
