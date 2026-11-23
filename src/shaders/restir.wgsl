@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var gPosition: texture_2d<f32>;
@group(0) @binding(2) var gNormal: texture_2d<f32>;
@group(0) @binding(3) var gAlbedo: texture_2d<f32>;
@group(0) @binding(4) var gEmission: texture_2d<f32>;
@group(0) @binding(5) var previousGPOSition: texture_2d<f32>;
@group(0) @binding(6) var previousGNormal: texture_2d<f32>;
@group(0) @binding(7) var<storage, read> lights: array<Light>;
@group(0) @binding(8) var<storage, read> occluders: array<Occluder>;
@group(0) @binding(9) var<storage, read> previousReservoir: array<Reservoir>;
@group(0) @binding(10) var<storage, read_write> temporalReservoir: array<Reservoir>;
@group(0) @binding(11) var<storage, read_write> finalReservoir: array<Reservoir>;
@group(0) @binding(12) var hdrOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(13) var<storage, read_write> stats: array<atomic<u32>, 16>;
@group(0) @binding(14) var<storage, read> lightGrid: array<u32>;

const INITIAL_CANDIDATES: u32 = 20u;
const WORKGROUP_SIZE: u32 = 8u;
const STAT_ATTEMPT_T: u32 = 0u;
const STAT_ACCEPT_T: u32 = 1u;
const STAT_REJECT_HISTORY: u32 = 2u;
const STAT_ATTEMPT_S: u32 = 3u;
const STAT_ACCEPT_S: u32 = 4u;
const STAT_VALID_PIXELS: u32 = 5u;
const STAT_WEIGHT: u32 = 6u;
const STAT_LUMINANCE: u32 = 7u;
const GRID_DIM: u32 = 20u;
const GRID_K: u32 = 32u;

var<workgroup> temporalAttemptShared: array<u32, 64>;
var<workgroup> temporalAcceptShared: array<u32, 64>;
var<workgroup> historyRejectShared: array<u32, 64>;
var<workgroup> spatialAttemptShared: array<u32, 64>;
var<workgroup> spatialAcceptShared: array<u32, 64>;
var<workgroup> shadeWeightShared: array<u32, 64>;
var<workgroup> shadeLuminanceShared: array<u32, 64>;
var<workgroup> shadeValidShared: array<u32, 64>;

fn reduceWorkgroup(lane: u32, data: ptr<workgroup, array<u32, 64>>) -> u32 {
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

fn bufferIndex(coord: vec2<i32>) -> u32 {
  return u32(coord.y) * u32(frame.resolution.x) + u32(coord.x);
}

fn inside(coord: vec2<i32>) -> bool {
  return coord.x >= 0 && coord.y >= 0 &&
    coord.x < i32(frame.resolution.x) && coord.y < i32(frame.resolution.y);
}

fn isBackground(positionDepth: vec4<f32>, normalRoughness: vec4<f32>) -> bool {
  return positionDepth.w <= 0.0 || dot(normalRoughness.xyz, normalRoughness.xyz) < 0.25;
}

fn sampleLocalLight(
  worldPosition: vec3<f32>,
  seed: ptr<function, u32>,
  countOut: ptr<function, u32>,
) -> u32 {
  let cellX = u32(clamp(floor((worldPosition.x + 40.0) * 0.25), 0.0, 19.0));
  let cellZ = u32(clamp(floor((worldPosition.z + 40.0) * 0.25), 0.0, 19.0));
  let base = (cellZ * GRID_DIM + cellX) * GRID_K;
  var count = 0u;
  for (var i: u32 = 0u; i < GRID_K; i++) {
    if (lightGrid[base + i] == 0xffffffffu) {
      break;
    }
    count += 1u;
  }
  *countOut = count;
  if (count == 0u) {
    return min(frame.lightCount - 1u, u32(rand(seed) * f32(frame.lightCount)));
  }
  let pick = min(count - 1u, u32(rand(seed) * f32(count)));
  return lightGrid[base + pick];
}

fn reproject(
  worldPosition: vec3<f32>,
  normal: vec3<f32>,
  depth: f32,
) -> vec2<i32> {
  let clip = frame.previousViewProjection * vec4<f32>(worldPosition, 1.0);
  if (clip.w <= 0.0) {
    return vec2<i32>(-1, -1);
  }
  let ndc = clip.xyz / clip.w;
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x >= 1.0 || uv.y >= 1.0) {
    return vec2<i32>(-1, -1);
  }
  let coord = vec2<i32>(uv * frame.resolution);
  if (!inside(coord)) {
    return vec2<i32>(-1, -1);
  }
  let previousPosition = textureLoad(previousGPOSition, coord, 0);
  let previousNormal = textureLoad(previousGNormal, coord, 0);
  if (isBackground(previousPosition, previousNormal)) {
    return vec2<i32>(-1, -1);
  }
  let tolerance = 0.055 + depth * 0.0025;
  if (distance(previousPosition.xyz, worldPosition) > tolerance) {
    return vec2<i32>(-1, -1);
  }
  if (dot(normal, normalize(previousNormal.xyz)) < 0.82) {
    return vec2<i32>(-1, -1);
  }
  return coord;
}

@compute @workgroup_size(8, 8)
fn temporalMain(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let coord = vec2<i32>(globalId.xy);
  let lane = (globalId.x % WORKGROUP_SIZE) + (globalId.y % WORKGROUP_SIZE) * WORKGROUP_SIZE;
  temporalAttemptShared[lane] = 0u;
  temporalAcceptShared[lane] = 0u;
  historyRejectShared[lane] = 0u;

  let pixelActive = inside(coord);
  var positionDepth = vec4<f32>(0.0);
  var normalRoughness = vec4<f32>(0.0);
  var albedoMetalness = vec4<f32>(0.0);
  if (pixelActive) {
    positionDepth = textureLoad(gPosition, coord, 0);
    normalRoughness = textureLoad(gNormal, coord, 0);
    albedoMetalness = textureLoad(gAlbedo, coord, 0);
  }
  let validPixel = pixelActive && !isBackground(positionDepth, normalRoughness);
  var temporalAttempt = 0u;
  var temporalAccept = 0u;
  var historyReject = 0u;

  if (!validPixel) {
    if (pixelActive) {
      temporalReservoir[bufferIndex(coord)] = Reservoir(
        0u, 0u, 0.0, 0.0, 0.0, 0.0, 0u, 0u,
      );
    }
  } else {
    let worldPosition = positionDepth.xyz;
    let normal = normalize(normalRoughness.xyz);
    let roughness = clamp(normalRoughness.w, 0.045, 1.0);
    let albedo = albedoMetalness.rgb;
    let metalness = albedoMetalness.a;
    let lightCount = frame.lightCount;
    var seed = hashU32(
      u32(coord.x) * 1973u + u32(coord.y) * 9277u +
      frame.frameIndex * 26699u + frame.randomSeed * 104729u + 17u,
    );
    var reservoir = Reservoir(0u, 0u, 0.0, 0.0, 0.0, 0.0, 0u, 0u);

    for (var sampleIndex: u32 = 0u; sampleIndex < INITIAL_CANDIDATES; sampleIndex++) {
      var localCount = 1u;
      let lightIndex = sampleLocalLight(worldPosition, &seed, &localCount);
      let contribution = evalLight(
        lights[lightIndex], worldPosition, normal, albedo, roughness, metalness,
        frame.cameraPosition.xyz,
      );
      let targetPdf = max(luminance(contribution), EPS);
      let candidateWeight = targetPdf * f32(max(localCount, 1u));
      updateReservoir(&reservoir, lightIndex, candidateWeight, 1u, rand(&seed));
    }

    if (frame.historyValid == 1u) {
      temporalAttempt = 1u;
      let index = bufferIndex(coord);
      let previous = previousReservoir[index];
      let previousCoord = reproject(worldPosition, normal, positionDepth.w);
      var validHistory = previousCoord.x >= 0 && previous.sampleCount > 0u &&
        previous.lightIndex < lightCount && previous.weight > 0.0 && isFiniteValue(previous.weight);
      var candidateVisibility = 0.0;
      if (validHistory) {
        let light = lights[previous.lightIndex];
        candidateVisibility = select(
          1.0,
          0.0,
          isOccluded(&occluders, arrayLength(&occluders), worldPosition, normal, light.position.xyz),
        );
        if (candidateVisibility <= 0.0) {
          validHistory = false;
        }
      }
      if (validHistory) {
        let contribution = evalLight(
          lights[previous.lightIndex], worldPosition, normal, albedo, roughness, metalness,
          frame.cameraPosition.xyz,
        );
        let targetPdf = max(luminance(contribution), EPS);
        let historyCount = clamp(previous.sampleCount, 1u, max(1u, frame.historyCap));
        let candidateWeight = targetPdf * previous.weight * f32(historyCount);
        let previousSample = previous.lightIndex;
        updateReservoir(&reservoir, previousSample, candidateWeight, historyCount, rand(&seed));
        temporalAccept = 1u;
        reservoir.visibility = candidateVisibility;
      } else {
        historyReject = 1u;
      }
    }

    resolveReservoir(
      &reservoir, worldPosition, normal, albedo, roughness, metalness,
      frame.cameraPosition.xyz, &lights, lightCount,
    );
    temporalReservoir[bufferIndex(coord)] = reservoir;
  }

  temporalAttemptShared[lane] = temporalAttempt;
  temporalAcceptShared[lane] = temporalAccept;
  historyRejectShared[lane] = historyReject;
  let attemptTotal = reduceWorkgroup(lane, &temporalAttemptShared);
  let acceptTotal = reduceWorkgroup(lane, &temporalAcceptShared);
  let rejectTotal = reduceWorkgroup(lane, &historyRejectShared);
  if (lane == 0u) {
    atomicAdd(&stats[STAT_ATTEMPT_T], attemptTotal);
    atomicAdd(&stats[STAT_ACCEPT_T], acceptTotal);
    atomicAdd(&stats[STAT_REJECT_HISTORY], rejectTotal);
  }
}

@compute @workgroup_size(8, 8)
fn spatialMain(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let coord = vec2<i32>(globalId.xy);
  let lane = (globalId.x % WORKGROUP_SIZE) + (globalId.y % WORKGROUP_SIZE) * WORKGROUP_SIZE;
  spatialAttemptShared[lane] = 0u;
  spatialAcceptShared[lane] = 0u;
  let pixelActive = inside(coord);
  var positionDepth = vec4<f32>(0.0);
  var normalRoughness = vec4<f32>(0.0);
  var albedoMetalness = vec4<f32>(0.0);
  if (pixelActive) {
    positionDepth = textureLoad(gPosition, coord, 0);
    normalRoughness = textureLoad(gNormal, coord, 0);
    albedoMetalness = textureLoad(gAlbedo, coord, 0);
  }
  let validPixel = pixelActive && !isBackground(positionDepth, normalRoughness);
  var spatialAttempts = 0u;
  var spatialAccepts = 0u;

  if (!validPixel) {
    if (pixelActive) {
      finalReservoir[bufferIndex(coord)] = Reservoir(
        0u, 0u, 0.0, 0.0, 0.0, 0.0, 0u, 0u,
      );
    }
  } else {
    let index = bufferIndex(coord);
    var reservoir = temporalReservoir[index];
    if (frame.spatialEnabled == 1u) {
      let worldPosition = positionDepth.xyz;
      let normal = normalize(normalRoughness.xyz);
      let albedo = albedoMetalness.rgb;
      let metalness = albedoMetalness.a;
      let roughness = clamp(normalRoughness.w, 0.045, 1.0);
      var seed = hashU32(index * 131u + frame.frameIndex * 3571u + frame.randomSeed * 65537u + 9u);
      let offsets = array<vec2<i32>, 4>(
        vec2<i32>(-4, 0), vec2<i32>(4, 0), vec2<i32>(0, -4), vec2<i32>(0, 4),
      );
      for (var tap: u32 = 0u; tap < 4u; tap++) {
        spatialAttempts += 1u;
        let neighborCoord = coord + offsets[tap];
        if (!inside(neighborCoord)) {
          continue;
        }
        let neighborIndex = bufferIndex(neighborCoord);
        let neighbor = temporalReservoir[neighborIndex];
        if (neighbor.sampleCount == 0u || neighbor.lightIndex >= frame.lightCount ||
            neighbor.weight <= 0.0 || !isFiniteValue(neighbor.weight)) {
          continue;
        }
        let neighborPosition = textureLoad(gPosition, neighborCoord, 0);
        let neighborNormal = textureLoad(gNormal, neighborCoord, 0);
        if (isBackground(neighborPosition, neighborNormal)) {
          continue;
        }
        if (dot(normal, normalize(neighborNormal.xyz)) < 0.88) {
          continue;
        }
        if (distance(worldPosition, neighborPosition.xyz) > 0.12 + positionDepth.w * 0.006) {
          continue;
        }
        let light = lights[neighbor.lightIndex];
        let contribution = evalLight(
          light, worldPosition, normal, albedo, roughness, metalness,
          frame.cameraPosition.xyz,
        );
        let targetPdf = max(luminance(contribution), EPS);
        let neighborCount = clamp(
          neighbor.sampleCount,
          1u,
          max(1u, frame.historyCap / 2u),
        );
        let candidateWeight = targetPdf * neighbor.weight * f32(neighborCount);
        updateReservoir(&reservoir, neighbor.lightIndex, candidateWeight, neighborCount, rand(&seed));
        spatialAccepts += 1u;
      }
    }
    resolveReservoir(
      &reservoir, positionDepth.xyz, normalize(normalRoughness.xyz),
      albedoMetalness.rgb, clamp(normalRoughness.w, 0.045, 1.0), albedoMetalness.a,
      frame.cameraPosition.xyz, &lights, frame.lightCount,
    );
    finalReservoir[index] = reservoir;
  }

  spatialAttemptShared[lane] = spatialAttempts;
  spatialAcceptShared[lane] = spatialAccepts;
  let attemptTotal = reduceWorkgroup(lane, &spatialAttemptShared);
  let acceptTotal = reduceWorkgroup(lane, &spatialAcceptShared);
  if (lane == 0u) {
    atomicAdd(&stats[STAT_ATTEMPT_S], attemptTotal);
    atomicAdd(&stats[STAT_ACCEPT_S], acceptTotal);
  }
}

@compute @workgroup_size(8, 8)
fn shadeMain(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let coord = vec2<i32>(globalId.xy);
  let lane = (globalId.x % WORKGROUP_SIZE) + (globalId.y % WORKGROUP_SIZE) * WORKGROUP_SIZE;
  shadeWeightShared[lane] = 0u;
  shadeLuminanceShared[lane] = 0u;
  shadeValidShared[lane] = 0u;
  let pixelActive = inside(coord);
  var positionDepth = vec4<f32>(0.0);
  var normalRoughness = vec4<f32>(0.0);
  var albedoMetalness = vec4<f32>(0.0);
  var emissionKind = vec4<f32>(0.0);
  if (pixelActive) {
    positionDepth = textureLoad(gPosition, coord, 0);
    normalRoughness = textureLoad(gNormal, coord, 0);
    albedoMetalness = textureLoad(gAlbedo, coord, 0);
    emissionKind = textureLoad(gEmission, coord, 0);
  }
  let validPixel = pixelActive && !isBackground(positionDepth, normalRoughness);
  var outputColor = vec3<f32>(0.0);
  var weightScaled = 0u;
  var luminanceScaled = 0u;
  var validCount = 0u;

  if (!validPixel) {
    let uv = (vec2<f32>(coord) + 0.5) / frame.resolution;
    let horizon = pow(1.0 - clamp(uv.y, 0.0, 1.0), 2.4);
    outputColor = vec3<f32>(0.0025, 0.0062, 0.0085) + vec3<f32>(0.012, 0.022, 0.024) * horizon;
  } else {
    let worldPosition = positionDepth.xyz;
    let normal = normalize(normalRoughness.xyz);
    let albedo = albedoMetalness.rgb;
    let metalness = albedoMetalness.a;
    let roughness = clamp(normalRoughness.w, 0.045, 1.0);
    let reservoir = finalReservoir[bufferIndex(coord)];
    var direct = vec3<f32>(0.0);
    var visible = 0.0;
    if (reservoir.sampleCount > 0u && reservoir.lightIndex < frame.lightCount &&
        reservoir.weight > 0.0 && isFiniteValue(reservoir.weight)) {
      let light = lights[reservoir.lightIndex];
      visible = select(
        1.0,
        0.0,
        isOccluded(&occluders, arrayLength(&occluders), worldPosition, normal, light.position.xyz),
      );
      if (visible > 0.0) {
        direct = evalLight(
          light, worldPosition, normal, albedo, roughness, metalness,
          frame.cameraPosition.xyz,
        ) * min(reservoir.weight, 4096.0);
      }
      validCount = 1u;
      weightScaled = u32(clamp(reservoir.weight * 128.0, 0.0, 4.0e9));
    }
    outputColor = emissionKind.rgb + direct;

    if (frame.mode == 3u) {
      let confidence = clamp(reservoir.weight / 64.0, 0.0, 1.0);
      let history = clamp(f32(reservoir.sampleCount) / f32(max(frame.historyCap, 1u)), 0.0, 1.0);
      let visibleTint = select(vec3<f32>(0.12, 0.035, 0.02), vec3<f32>(0.0, 0.45, 0.42), visible > 0.0);
      outputColor = mix(vec3<f32>(0.015, 0.08, 0.24), vec3<f32>(1.0, 0.42, 0.06), confidence);
      outputColor += visibleTint * 0.38 + vec3<f32>(0.03, 0.0, 0.18) * history;
      outputColor *= 0.72;
    }
    luminanceScaled = u32(clamp(luminance(outputColor) * 256.0, 0.0, 4.0e9));
  }
  if (pixelActive) {
    textureStore(hdrOut, coord, vec4<f32>(max(outputColor, vec3<f32>(0.0)), 1.0));
  }

  shadeWeightShared[lane] = weightScaled;
  shadeLuminanceShared[lane] = luminanceScaled;
  shadeValidShared[lane] = validCount;
  let weightTotal = reduceWorkgroup(lane, &shadeWeightShared);
  let luminanceTotal = reduceWorkgroup(lane, &shadeLuminanceShared);
  let validTotal = reduceWorkgroup(lane, &shadeValidShared);
  if (lane == 0u) {
    atomicAdd(&stats[STAT_WEIGHT], weightTotal);
    atomicAdd(&stats[STAT_LUMINANCE], luminanceTotal);
    atomicAdd(&stats[STAT_VALID_PIXELS], validTotal);
  }
}
