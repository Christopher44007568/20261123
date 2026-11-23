export const COMMON_WGSL = /* wgsl */ `
struct FrameUniform {
  viewProjection: mat4x4f,
  cameraPositionTime: vec4f,
  cameraRightTan: vec4f,
  cameraUpTan: vec4f,
  cameraForward: vec4f,
  viewportCounts: vec4f,
  computeParams: vec4f,
};

struct Instance {
  position: vec3f,
  yaw: f32,
  scale: vec3f,
  emissive: f32,
  color: vec3f,
  kind: u32,
};

struct SourceLight {
  positionRadius: vec4f,
  colorIntensity: vec4f,
  params: vec4f,
};

struct Light {
  positionRadius: vec4f,
  colorIntensity: vec4f,
};

struct LightBin {
  indices: vec4u,
  weights: vec4f,
};

struct IndirectArgs {
  indexCount: u32,
  instanceCount: u32,
  firstIndex: u32,
  baseVertex: i32,
  firstInstance: u32,
};

const BIN_COLUMNS: u32 = 16u;
const BIN_ROWS: u32 = 9u;
const MISSING: u32 = 0xffffffffu;
`;

export const COMPUTE_WGSL = /* wgsl */ `
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> frame: FrameUniform;
@group(0) @binding(1) var<storage, read> instances: array<Instance>;
@group(0) @binding(2) var<storage, read> sourceLights: array<SourceLight>;
@group(0) @binding(3) var<storage, read_write> lights: array<Light>;
@group(0) @binding(4) var<storage, read_write> bins: array<LightBin>;
@group(0) @binding(5) var<storage, read_write> visibleIndices: array<u32>;
@group(0) @binding(6) var<storage, read_write> indirect: IndirectArgs;
@group(0) @binding(7) var<storage, read_write> visibilityFlags: array<u32>;

@compute @workgroup_size(1)
fn resetIndirect() {
  indirect.instanceCount = 0u;
}

@compute @workgroup_size(64)
fn generateLights(@builtin(global_invocation_id) globalId: vec3u) {
  let index = globalId.x;
  let lightCount = u32(frame.viewportCounts.w);
  if (index >= lightCount) {
    return;
  }

  let source = sourceLights[index];
  let time = frame.cameraPositionTime.w;
  let kind = source.params.z;
  var position = source.positionRadius.xyz;
  var radius = source.positionRadius.w;
  var intensity = source.colorIntensity.w;
  var phase = source.params.x;

  if (kind > 0.5) {
    let orbit = source.positionRadius.w;
    let angle = time * source.params.y + phase;
    position += vec3f(
      cos(angle) * orbit,
      sin(angle * 1.73 + phase) * 0.72,
      sin(angle) * orbit * 0.72
    );
    radius = source.params.w;
    intensity *= 0.88 + 0.12 * sin(time * 3.1 + phase * 7.0);
    phase += 1.0;
  } else {
    let wave = 0.5 + 0.5 * sin(time * source.params.y + phase * 6.28318);
    intensity *= 0.56 + 0.78 * pow(wave, 4.0);
  }

  lights[index] = Light(
    vec4f(position, radius),
    vec4f(source.colorIntensity.rgb * intensity, kind)
  );
}

@compute @workgroup_size(64)
fn cullInstances(@builtin(global_invocation_id) globalId: vec3u) {
  let index = globalId.x;
  if (index >= u32(frame.viewportCounts.z)) {
    return;
  }
  visibilityFlags[index] = 0u;

  let instance = instances[index];
  let clip = frame.viewProjection * vec4f(instance.position, 1.0);
  if (clip.w <= 0.05) {
    return;
  }

  let ndc = clip.xyz / clip.w;
  let radius = length(instance.scale) * 0.55;
  let radiusNdc = radius / max(clip.w, 0.5);
  if (ndc.x < -1.25 - radiusNdc || ndc.x > 1.25 + radiusNdc) {
    return;
  }
  if (ndc.y < -1.25 - radiusNdc || ndc.y > 1.25 + radiusNdc) {
    return;
  }
  if (ndc.z < 0.0 || ndc.z > 1.05) {
    return;
  }

  visibilityFlags[index] = 1u;
}

@compute @workgroup_size(1)
fn gatherVisible() {
  var visibleCount = 0u;
  let instanceCount = u32(frame.viewportCounts.z);
  for (var index = 0u; index < instanceCount; index += 1u) {
    if (visibilityFlags[index] != 0u) {
      visibleIndices[visibleCount] = index;
      visibleCount += 1u;
    }
  }
  indirect.instanceCount = visibleCount;
}

fn lightTileInfluence(light: Light, tileCenter: vec2f, aspect: f32) -> f32 {
  let clip = frame.viewProjection * vec4f(light.positionRadius.xyz, 1.0);
  if (clip.w <= 0.05) {
    return 0.0;
  }
  let ndc = clip.xyz / clip.w;
  let screenPosition = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  let offset = vec2f((screenPosition.x - tileCenter.x) * aspect, screenPosition.y - tileCenter.y);
  let projectedRadius = max(
    0.5 * frame.viewProjection[1][1] * light.positionRadius.w / clip.w,
    0.018
  );
  return exp(-dot(offset, offset) / (projectedRadius * projectedRadius * 0.9));
}

@compute @workgroup_size(8, 8)
fn buildLightBins(@builtin(global_invocation_id) globalId: vec3u) {
  let binX = globalId.x;
  let binY = globalId.y;
  if (binX >= BIN_COLUMNS || binY >= BIN_ROWS) {
    return;
  }

  let lightCount = u32(frame.viewportCounts.w);
  let center = vec2f(
    (f32(binX) + 0.5) / f32(BIN_COLUMNS),
    (f32(binY) + 0.5) / f32(BIN_ROWS)
  );
  let aspect = frame.viewportCounts.x / max(frame.viewportCounts.y, 1.0);
  let workIterations = u32(clamp(frame.computeParams.x * 32.0, 1.0, 2048.0));

  var bestIndices = array<u32, 4>(MISSING, MISSING, MISSING, MISSING);
  var bestWeights = array<f32, 4>(0.0, 0.0, 0.0, 0.0);

  for (var lightIndex = 0u; lightIndex < lightCount; lightIndex += 1u) {
    let light = lights[lightIndex];
    let radial = lightTileInfluence(light, center, aspect);
    if (radial < 0.002) {
      continue;
    }
    let luminance = dot(light.colorIntensity.rgb, vec3f(0.2126, 0.7152, 0.0722));
    var score = max(luminance, 0.001) * radial;

    for (var work = 0u; work < workIterations; work += 1u) {
      let hash = fract(
        sin(f32(work) * 91.733 + f32(lightIndex) * 12.417 + f32(binX * 17u + binY)) * 43758.5453
      );
      score += hash * 0.0000001;
    }

    let weight = clamp(radial, 0.0, 1.0);
    var insertAt = 4;
    for (var candidate = 0; candidate < 4; candidate += 1) {
      if (score > bestWeights[candidate]) {
        insertAt = candidate;
        break;
      }
    }
    if (insertAt < 4) {
      for (var shift = 3; shift > insertAt; shift -= 1) {
        bestWeights[shift] = bestWeights[shift - 1];
        bestIndices[shift] = bestIndices[shift - 1];
      }
      bestWeights[insertAt] = score;
      bestIndices[insertAt] = lightIndex;
    }
  }

  var normalizedWeights = vec4f(0.0);
  for (var slot = 0; slot < 4; slot += 1) {
    if (bestIndices[slot] != MISSING) {
      let light = lights[bestIndices[slot]];
      normalizedWeights[slot] = clamp(lightTileInfluence(light, center, aspect), 0.0, 1.0);
    }
  }

  bins[binY * BIN_COLUMNS + binX] = LightBin(
    vec4u(bestIndices[0], bestIndices[1], bestIndices[2], bestIndices[3]),
    normalizedWeights
  );
}
`;

export const BACKGROUND_WGSL = /* wgsl */ `
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> frame: FrameUniform;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0)
  );
  let position = positions[vertexIndex];
  var output: VertexOutput;
  output.position = vec4f(position, 0.0, 1.0);
  output.uv = position * 0.5 + 0.5;
  return output;
}

fn hash21(value: vec2f) -> f32 {
  return fract(sin(dot(value, vec2f(127.1, 311.7))) * 43758.5453123);
}

fn noise21(value: vec2f) -> f32 {
  let cell = floor(value);
  let local = fract(value);
  let smoothLocal = local * local * (3.0 - 2.0 * local);
  let a = hash21(cell);
  let b = hash21(cell + vec2f(1.0, 0.0));
  let c = hash21(cell + vec2f(0.0, 1.0));
  let d = hash21(cell + vec2f(1.0, 1.0));
  return mix(mix(a, b, smoothLocal.x), mix(c, d, smoothLocal.x), smoothLocal.y);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let ndc = vec2f(input.uv.x * 2.0 - 1.0, 1.0 - input.uv.y * 2.0);
  let direction = normalize(
    frame.cameraForward.xyz +
    frame.cameraRightTan.xyz * ndc.x +
    frame.cameraUpTan.xyz * ndc.y
  );
  let height = clamp(direction.y, 0.0, 1.0);
  let time = frame.cameraPositionTime.w;

  let zenith = vec3f(0.0035, 0.0075, 0.013);
  let horizon = vec3f(0.018, 0.045, 0.049);
  var color = mix(horizon, zenith, smoothstep(0.0, 0.86, height));
  let horizonGlow = pow(1.0 - height, 9.0);
  color += vec3f(0.055, 0.12, 0.115) * horizonGlow;

  let azimuth = atan2(direction.z, direction.x);
  let ridge = 0.036 + 0.022 * sin(azimuth * 2.7 + 0.7) + 0.014 * sin(azimuth * 7.1);
  let ridgeMask = 1.0 - smoothstep(ridge - 0.025, ridge + 0.01, direction.y);
  color = mix(color, vec3f(0.0045, 0.009, 0.011), ridgeMask * 0.88);

  let moonDirection = normalize(vec3f(-0.55, 0.29, -0.63));
  let moon = max(dot(direction, moonDirection), 0.0);
  color += vec3f(0.38, 0.52, 0.49) * pow(moon, 320.0) * 0.75;
  color += vec3f(0.03, 0.08, 0.079) * pow(moon, 18.0) * 0.18;

  let starCell = floor(direction.xz * 190.0 / max(0.18, height + 0.18));
  let starHash = hash21(starCell);
  let star = step(0.985, starHash) * smoothstep(0.03, 0.22, height);
  let twinkle = 0.48 + 0.52 * sin(time * 1.7 + starHash * 40.0);
  color += vec3f(0.5, 0.72, 0.68) * star * twinkle * (1.0 - ridgeMask);

  let cloud = noise21(vec2f(azimuth * 4.1 + time * 0.008, height * 17.0));
  let cloudMask = smoothstep(0.5, 0.83, cloud) * smoothstep(0.0, 0.3, height) * (1.0 - height);
  color += vec3f(0.026, 0.045, 0.047) * cloudMask;

  let dustCell = floor(input.uv * vec2f(115.0, 64.0) + vec2f(time * 1.4, -time * 2.1));
  let dustHash = hash21(dustCell);
  let dust = step(0.9965, dustHash) * smoothstep(0.25, 0.9, input.uv.y);
  color += vec3f(0.18, 0.26, 0.22) * dust * 0.42;

  let vignette = 1.0 - smoothstep(0.22, 1.05, length(input.uv - 0.5) * 1.42);
  color *= 0.74 + vignette * 0.26;
  color = pow(max(color, vec3f(0.0)), vec3f(1.0 / 2.2));
  return vec4f(color, 1.0);
}
`;

export const OBJECT_WGSL = /* wgsl */ `
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> frame: FrameUniform;
@group(0) @binding(1) var<storage, read> instances: array<Instance>;
@group(0) @binding(3) var<storage, read> lights: array<Light>;
@group(0) @binding(4) var<storage, read> bins: array<LightBin>;
@group(0) @binding(5) var<storage, read> visibleIndices: array<u32>;

struct VertexInput {
  @location(0) localPosition: vec3f,
  @location(1) localNormal: vec3f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) worldNormal: vec3f,
  @location(2) color: vec3f,
  @location(3) material: vec3f,
};

fn rotateY(value: vec3f, yaw: f32) -> vec3f {
  let cosine = cos(yaw);
  let sine = sin(yaw);
  return vec3f(
    cosine * value.x + sine * value.z,
    value.y,
    -sine * value.x + cosine * value.z
  );
}

@vertex
fn vertexMain(
  input: VertexInput,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let sourceIndex = visibleIndices[instanceIndex];
  let instance = instances[sourceIndex];
  let scaled = input.localPosition * instance.scale;
  let worldPosition = rotateY(scaled, instance.yaw) + instance.position;
  let worldNormal = normalize(rotateY(input.localNormal / max(instance.scale, vec3f(0.001)), instance.yaw));

  var output: VertexOutput;
  output.position = frame.viewProjection * vec4f(worldPosition, 1.0);
  output.worldPosition = worldPosition;
  output.worldNormal = worldNormal;
  output.color = instance.color;
  output.material = vec3f(instance.emissive, f32(instance.kind), f32(sourceIndex));
  return output;
}

fn surfaceBase(
  worldPosition: vec3f,
  color: vec3f,
  kind: f32,
  groundGridWidth: vec2f,
  majorGridWidth: vec2f
) -> vec3f {
  var base = color;
  if (kind > 1.5 && kind < 2.5) {
    let coordinate = worldPosition.xz * 0.24;
    let grid = abs(fract(coordinate - 0.5) - 0.5) / max(groundGridWidth, vec2f(0.0001));
    let line = 1.0 - clamp(min(grid.x, grid.y), 0.0, 1.0);
    let majorCoordinate = worldPosition.xz * 0.061;
    let majorGrid = abs(fract(majorCoordinate - 0.5) - 0.5) / max(majorGridWidth, vec2f(0.0001));
    let major = 1.0 - clamp(min(majorGrid.x, majorGrid.y), 0.0, 1.0);
    let concreteNoise = 0.72 + 0.28 * sin(worldPosition.x * 1.73 + worldPosition.z * 2.41);
    base *= concreteNoise;
    base += vec3f(0.007, 0.022, 0.021) * line * 0.18;
    base += vec3f(0.015, 0.036, 0.034) * major * 0.23;
  }
  if (kind > 2.5 && kind < 3.5) {
    let stripe = step(0.48, fract((worldPosition.x + worldPosition.z) * 1.3 + worldPosition.y * 0.4));
    base = mix(vec3f(0.022, 0.026, 0.025), vec3f(0.82, 0.39, 0.055), stripe);
  }
  if (kind > 5.5) {
    base = vec3f(0.012, 0.028, 0.034) + vec3f(0.04, 0.08, 0.07) * smoothstep(0.1, 0.8, fract(worldPosition.z * 3.7));
  }
  return max(base, vec3f(0.0));
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let normal = normalize(input.worldNormal);
  let viewDirection = normalize(frame.cameraPositionTime.xyz - input.worldPosition);
  let kind = input.material.y;
  let emissive = input.material.x;
  let groundGridWidth = fwidth(input.worldPosition.xz * 0.24) * 1.2;
  let majorGridWidth = fwidth(input.worldPosition.xz * 0.061) * 1.5;
  var base = surfaceBase(input.worldPosition, input.color, kind, groundGridWidth, majorGridWidth);

  var lighting = vec3f(0.0);
  let pixel = input.position.xy;
  let binX = min(u32(floor(pixel.x / max(frame.viewportCounts.x, 1.0) * 16.0)), 15u);
  let binY = min(u32(floor(pixel.y / max(frame.viewportCounts.y, 1.0) * 9.0)), 8u);
  let lightBin = bins[binY * BIN_COLUMNS + binX];

  for (var slot = 0; slot < 4; slot += 1) {
    let lightIndex = lightBin.indices[slot];
    if (lightIndex == MISSING) {
      continue;
    }
    let light = lights[lightIndex];
    let toLight = light.positionRadius.xyz - input.worldPosition;
    let distanceSquared = max(dot(toLight, toLight), 0.001);
    let radius = max(light.positionRadius.w, 0.1);
    let lightDirection = toLight * inverseSqrt(distanceSquared);
    let attenuation = 1.0 / (1.0 + distanceSquared / (radius * radius));
    let diffuse = max(dot(normal, lightDirection), 0.0);
    let halfDirection = normalize(lightDirection + viewDirection);
    let roughness = select(0.25, 0.055, kind > 5.5);
    let specular = pow(max(dot(normal, halfDirection), 0.0), 54.0) * roughness * 0.85;
    let weight = lightBin.weights[slot] * attenuation;
    lighting += light.colorIntensity.rgb * weight * (base * diffuse * 0.78 + specular) * 0.42;
  }

  let skyFill = vec3f(0.07, 0.13, 0.145) * (0.45 + 0.55 * max(normal.y, 0.0));
  let bounce = vec3f(0.1, 0.16, 0.145) * max(-normal.y, 0.0) * 0.4;
  var color = base * (skyFill + bounce) + lighting;
  color += vec3f(0.0035, 0.005, 0.006);

  if (emissive > 0.0) {
    let emissiveColor = base * emissive * 2.8;
    color += emissiveColor;
    if (kind > 3.5 && kind < 4.5) {
      color += vec3f(1.0, 0.49, 0.15) * emissive * 0.18;
    }
  }

  let fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.0);
  color += vec3f(0.1, 0.48, 0.43) * fresnel * 0.035;

  let distanceToCamera = length(frame.cameraPositionTime.xyz - input.worldPosition);
  let fogAmount = 1.0 - exp(-max(0.0, distanceToCamera - 11.0) * 0.027);
  color = mix(color, vec3f(0.009, 0.022, 0.025), fogAmount);
  color *= 1.16;
  let luminance = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  color = mix(vec3f(luminance), color, 1.12);
  color = (color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14);
  color = pow(max(color, vec3f(0.0)), vec3f(1.0 / 2.2));
  return vec4f(color, 1.0);
}
`;

export const HALO_WGSL = /* wgsl */ `
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> frame: FrameUniform;
@group(0) @binding(3) var<storage, read> lights: array<Light>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
  @location(2) kind: f32,
};

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) lightIndex: u32
) -> VertexOutput {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0),
    vec2f(-1.0, -1.0),
    vec2f(1.0, 1.0),
    vec2f(-1.0, 1.0)
  );

  var output: VertexOutput;
  let lightCount = u32(frame.viewportCounts.w);
  if (lightIndex >= lightCount) {
    output.position = vec4f(8.0, 8.0, 8.0, 1.0);
    output.uv = vec2f(2.0);
    output.color = vec3f(0.0);
    output.kind = 0.0;
    return output;
  }

  let light = lights[lightIndex];
  let clip = frame.viewProjection * vec4f(light.positionRadius.xyz, 1.0);
  if (clip.w <= 0.04) {
    output.position = vec4f(8.0, 8.0, 8.0, 1.0);
    output.uv = vec2f(2.0);
    output.color = vec3f(0.0);
    output.kind = 0.0;
    return output;
  }

  let corner = corners[vertexIndex];
  let ndc = clip.xy / clip.w;
  let aspect = frame.viewportCounts.x / max(frame.viewportCounts.y, 1.0);
  let glowRadius = select(0.23, 0.58, light.colorIntensity.w > 0.5);
  let radiusScale = frame.viewProjection[1][1] * glowRadius / max(clip.w, 0.2);
  let sizeMultiplier = select(0.92, 1.12, light.colorIntensity.w > 0.5);
  let offset = vec2f(corner.x / aspect, corner.y) * radiusScale * sizeMultiplier;
  output.position = vec4f(ndc + offset, clip.z / clip.w - 0.0003, 1.0);
  output.uv = corner;
  output.color = light.colorIntensity.rgb;
  output.kind = light.colorIntensity.w;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let radius = length(input.uv);
  if (radius > 1.0) {
    discard;
  }

  let core = exp(-radius * radius * 58.0);
  let bloom = exp(-radius * 7.0) * 0.28;
  let outer = exp(-radius * 14.0) * 0.14;
  let isWorkLight = input.kind > 0.5;
  let luminance = max(dot(input.color, vec3f(0.2126, 0.7152, 0.0722)), 0.001);
  let chroma = input.color / luminance;
  let energy = select(1.0, 1.55, isWorkLight);
  let intensity = (core * 1.65 + bloom + outer) * min(luminance, 24.0) * 0.13 * energy;
  var color = chroma * intensity;
  if (isWorkLight) {
    let shaft = pow(max(0.0, 1.0 - abs(input.uv.x)), 10.0) * max(0.0, 1.0 - input.uv.y) * 0.07;
    color += vec3f(1.0, 0.58, 0.24) * shaft;
  }
  return vec4f(color, 1.0);
}
`;

export const BEAM_WGSL = /* wgsl */ `
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> frame: FrameUniform;
@group(0) @binding(3) var<storage, read> lights: array<Light>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
};

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) lightIndex: u32
) -> VertexOutput {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, 0.0),
    vec2f(1.0, 0.0),
    vec2f(1.0, 1.0),
    vec2f(-1.0, 0.0),
    vec2f(1.0, 1.0),
    vec2f(-1.0, 1.0)
  );

  var output: VertexOutput;
  let lightCount = u32(frame.viewportCounts.w);
  let light = lights[min(lightIndex, lightCount - 1u)];
  if (lightIndex >= lightCount || light.colorIntensity.w < 0.5) {
    output.position = vec4f(8.0, 8.0, 8.0, 1.0);
    output.uv = vec2f(2.0);
    output.color = vec3f(0.0);
    return output;
  }

  let top = light.positionRadius.xyz;
  let bottom = vec3f(top.x, 0.04, top.z);
  let topClip = frame.viewProjection * vec4f(top, 1.0);
  let bottomClip = frame.viewProjection * vec4f(bottom, 1.0);
  if (topClip.w <= 0.1 || bottomClip.w <= 0.1) {
    output.position = vec4f(8.0, 8.0, 8.0, 1.0);
    output.uv = vec2f(2.0);
    output.color = vec3f(0.0);
    return output;
  }

  let topNdc = topClip.xy / topClip.w;
  let bottomNdc = bottomClip.xy / bottomClip.w;
  let corner = corners[vertexIndex];
  let aspect = frame.viewportCounts.x / max(frame.viewportCounts.y, 1.0);
  let topWidth = frame.viewProjection[1][1] * 0.5 / topClip.w;
  let bottomWidth = frame.viewProjection[1][1] * 3.4 / bottomClip.w;
  let width = mix(topWidth, bottomWidth, corner.y);
  let center = mix(topNdc, bottomNdc, corner.y);
  let depth = mix(topClip.z / topClip.w, bottomClip.z / bottomClip.w, corner.y) - 0.0008;
  let horizontal = vec2f(corner.x / aspect, 0.0) * width;
  output.position = vec4f(center + horizontal, depth, 1.0);
  output.uv = corner;
  output.color = light.colorIntensity.rgb;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let luminance = max(dot(input.color, vec3f(0.2126, 0.7152, 0.0722)), 0.001);
  let chroma = input.color / luminance;
  let edge = pow(max(0.0, 1.0 - abs(input.uv.x)), 4.5);
  let vertical = pow(max(0.0, 1.0 - input.uv.y), 1.35);
  let groundFade = smoothstep(1.0, 0.72, input.uv.y);
  let intensity = edge * vertical * groundFade * 0.055;
  return vec4f(chroma * intensity, 1.0);
}
`;
