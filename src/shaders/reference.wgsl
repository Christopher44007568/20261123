@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var gPosition: texture_2d<f32>;
@group(0) @binding(2) var gNormal: texture_2d<f32>;
@group(0) @binding(3) var gAlbedo: texture_2d<f32>;
@group(0) @binding(4) var gEmission: texture_2d<f32>;
@group(0) @binding(5) var<storage, read> lights: array<Light>;
@group(0) @binding(6) var<storage, read> occluders: array<Occluder>;
@group(0) @binding(7) var referenceOut: texture_storage_2d<rgba16float, write>;

fn isBackground(positionDepth: vec4<f32>, normalRoughness: vec4<f32>) -> bool {
  return positionDepth.w <= 0.0 || dot(normalRoughness.xyz, normalRoughness.xyz) < 0.25;
}

fn skyColor(coord: vec2<i32>) -> vec3<f32> {
  let uv = (vec2<f32>(coord) + 0.5) / frame.resolution;
  let horizon = pow(1.0 - clamp(uv.y, 0.0, 1.0), 2.4);
  return vec3<f32>(0.0025, 0.0062, 0.0085) + vec3<f32>(0.012, 0.022, 0.024) * horizon;
}

@compute @workgroup_size(8, 8)
fn referenceMain(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let coord = vec2<i32>(globalId.xy);
  if (coord.x < 0 || coord.y < 0 ||
      coord.x >= i32(frame.resolution.x) || coord.y >= i32(frame.resolution.y)) {
    return;
  }
  let positionDepth = textureLoad(gPosition, coord, 0);
  let normalRoughness = textureLoad(gNormal, coord, 0);
  if (isBackground(positionDepth, normalRoughness)) {
    textureStore(referenceOut, coord, vec4<f32>(skyColor(coord), 1.0));
    return;
  }
  let worldPosition = positionDepth.xyz;
  let normal = normalize(normalRoughness.xyz);
  let albedoMetalness = textureLoad(gAlbedo, coord, 0);
  let emissionKind = textureLoad(gEmission, coord, 0);
  var radiance = emissionKind.rgb;
  for (var lightIndex: u32 = 0u; lightIndex < frame.lightCount; lightIndex++) {
    let light = lights[lightIndex];
    let toLight = light.position.xyz - worldPosition;
    let distanceSquared = dot(toLight, toLight);
    if (distanceSquared > light.position.w * light.position.w) {
      continue;
    }
    if (dot(normal, toLight) <= 0.0) {
      continue;
    }
    if (isOccluded(&occluders, arrayLength(&occluders), worldPosition, normal, light.position.xyz)) {
      continue;
    }
    radiance += evalLight(
      light, worldPosition, normal, albedoMetalness.rgb,
      clamp(normalRoughness.w, 0.045, 1.0), albedoMetalness.a,
      frame.cameraPosition.xyz,
    );
  }
  textureStore(referenceOut, coord, vec4<f32>(max(radiance, vec3<f32>(0.0)), 1.0));
}

var<workgroup> compareDiffShared: array<u32, 64>;
var<workgroup> compareReferenceShared: array<u32, 64>;
var<workgroup> compareCountShared: array<u32, 64>;

fn reduceCompare(lane: u32, data: ptr<workgroup, array<u32, 64>>) -> u32 {
  workgroupBarrier();
  var stride = 32u;
  loop {
    if (stride == 0u) {
      break;
    }
    if (lane < stride) {
      (*data)[lane] = (*data)[lane] + (*data)[lane + stride];
    }
    workgroupBarrier();
    if (stride == 1u) {
      break;
    }
    stride = stride / 2u;
  }
  return (*data)[0];
}

@compute @workgroup_size(8, 8)
fn compareMain(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let coord = vec2<i32>(globalId.xy);
  let lane = (globalId.x % 8u) + (globalId.y % 8u) * 8u;
  compareDiffShared[lane] = 0u;
  compareReferenceShared[lane] = 0u;
  compareCountShared[lane] = 0u;
  let pixelActive = coord.x >= 0 && coord.y >= 0 &&
    coord.x < i32(frame.resolution.x) && coord.y < i32(frame.resolution.y);
  var diffValue = 0u;
  var referenceValue = 0u;
  var countValue = 0u;
  if (pixelActive) {
    let estimate = textureLoad(hdrOutCompare, coord, 0).rgb;
    let reference = textureLoad(referenceCompare, coord, 0).rgb;
    let estimateLum = luminance(estimate);
    let referenceLum = luminance(reference);
    diffValue = u32(clamp(abs(estimateLum - referenceLum) * 1000.0, 0.0, 4.0e6));
    referenceValue = u32(clamp(referenceLum * 1000.0, 0.0, 4.0e6));
    countValue = 1u;
  }
  compareDiffShared[lane] = diffValue;
  compareReferenceShared[lane] = referenceValue;
  compareCountShared[lane] = countValue;
  let diffTotal = reduceCompare(lane, &compareDiffShared);
  let referenceTotal = reduceCompare(lane, &compareReferenceShared);
  let countTotal = reduceCompare(lane, &compareCountShared);
  if (lane == 0u) {
    atomicAdd(&compareStats[8], diffTotal);
    atomicAdd(&compareStats[9], countTotal);
    atomicAdd(&compareStats[10], referenceTotal);
  }
}

@group(1) @binding(0) var hdrOutCompare: texture_2d<f32>;
@group(1) @binding(1) var referenceCompare: texture_2d<f32>;
@group(1) @binding(2) var<storage, read_write> compareStats: array<atomic<u32>, 16>;
