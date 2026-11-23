struct FrameUniforms {
  view: mat4x4<f32>,
  projection: mat4x4<f32>,
  invViewProjection: mat4x4<f32>,
  previousViewProjection: mat4x4<f32>,
  cameraPosition: vec4<f32>,
  cameraForward: vec4<f32>,
  resolution: vec2<f32>,
  exposure: f32,
  time: f32,
  frameIndex: u32,
  lightCount: u32,
  historyCap: u32,
  mode: u32,
  spatialEnabled: u32,
  randomSeed: u32,
  debugScale: f32,
  historyValid: u32,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) materialKind: f32,
  @location(2) normal: vec3<f32>,
  @location(3) roughness: f32,
  @location(4) albedo: vec3<f32>,
  @location(5) metalness: f32,
  @location(6) emission: vec3<f32>,
  @location(7) seed: f32,
};

struct VertexOutput {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) worldPosition: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) albedo: vec3<f32>,
  @location(3) roughness: f32,
  @location(4) metalness: f32,
  @location(5) emission: vec3<f32>,
  @location(6) materialKind: f32,
  @location(7) seed: f32,
};

struct FragmentOutput {
  @location(0) positionDepth: vec4<f32>,
  @location(1) normalRoughness: vec4<f32>,
  @location(2) albedoMetalness: vec4<f32>,
  @location(3) emissionKind: vec4<f32>,
};

@vertex
fn vsMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  let worldPosition = input.position;
  output.clipPosition = frame.projection * frame.view * vec4<f32>(worldPosition, 1.0);
  output.worldPosition = worldPosition;
  output.normal = normalize(input.normal);
  output.albedo = input.albedo;
  output.roughness = input.roughness;
  output.metalness = input.metalness;
  output.emission = input.emission;
  output.materialKind = input.materialKind;
  output.seed = input.seed;
  return output;
}

fn hash21(value: vec2<f32>) -> f32 {
  let p = fract(value * vec2<f32>(123.34, 456.21));
  return fract((p.x + p.y) * (p.x + p.y + 45.32));
}

fn surfacePattern(
  worldPosition: vec3<f32>,
  normal: vec3<f32>,
  albedo: vec3<f32>,
  kind: f32,
  seed: f32,
) -> vec3<f32> {
  var color = albedo;
  let planar = select(worldPosition.xy, worldPosition.xz, abs(normal.y) > 0.5);
  let grain = hash21(planar * 8.73 + seed * 17.1);
  if (kind > 0.5 && kind < 1.5) {
    color *= 0.72 + grain * 0.35;
    let aggregate = smoothstep(0.82, 0.97, hash21(planar * 41.0));
    color += vec3<f32>(aggregate * 0.055);
  } else if (kind > 1.5 && kind < 2.5) {
    let jointX = 1.0 - smoothstep(0.0, 0.015, abs(fract(planar.x / 3.5 + 0.5) - 0.5));
    let jointZ = 1.0 - smoothstep(0.0, 0.015, abs(fract(planar.y / 3.5 + 0.5) - 0.5));
    color *= 0.9 + grain * 0.14;
    color *= 1.0 - max(jointX, jointZ) * 0.38;
    color += hash21(planar * 22.0) * 0.018;
  } else if (kind > 2.5 && kind < 3.5) {
    let brushed = sin(planar.x * 26.0 + sin(planar.y * 2.7) * 4.0) * 0.5 + 0.5;
    let panel = 1.0 - smoothstep(0.0, 0.02, abs(fract(planar.y / 1.35) - 0.5));
    color *= 0.82 + brushed * 0.14;
    color *= 1.0 - panel * 0.18;
  } else if (kind > 5.5 && kind < 6.5) {
    color *= 0.91 + grain * 0.1;
  } else if (kind > 6.5) {
    color *= 0.72 + grain * 0.12;
  }
  return color;
}

@fragment
fn fsMain(input: VertexOutput) -> FragmentOutput {
  var output: FragmentOutput;
  let normal = normalize(input.normal);
  let distance = length(input.worldPosition - frame.cameraPosition.xyz);
  output.positionDepth = vec4<f32>(input.worldPosition, distance);
  output.normalRoughness = vec4<f32>(normal, input.roughness);
  let color = surfacePattern(
    input.worldPosition,
    normal,
    input.albedo,
    input.materialKind,
    input.seed,
  );
  output.albedoMetalness = vec4<f32>(color, input.metalness);
  output.emissionKind = vec4<f32>(input.emission, input.materialKind);
  return output;
}
