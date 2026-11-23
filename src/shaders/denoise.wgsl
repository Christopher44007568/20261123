@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var gPosition: texture_2d<f32>;
@group(0) @binding(2) var gNormal: texture_2d<f32>;
@group(0) @binding(3) var hdrInput: texture_2d<f32>;
@group(0) @binding(4) var hdrOutput: texture_storage_2d<rgba16float, write>;

fn isBackgroundValue(positionDepth: vec4<f32>, normalRoughness: vec4<f32>) -> bool {
  return positionDepth.w <= 0.0 || dot(normalRoughness.xyz, normalRoughness.xyz) < 0.25;
}

@compute @workgroup_size(8, 8)
fn denoiseMain(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let coord = vec2<i32>(globalId.xy);
  if (coord.x < 0 || coord.y < 0 ||
      coord.x >= i32(frame.resolution.x) || coord.y >= i32(frame.resolution.y)) {
    return;
  }
  let centerPosition = textureLoad(gPosition, coord, 0);
  let centerNormal = textureLoad(gNormal, coord, 0);
  let centerColor = textureLoad(hdrInput, coord, 0).rgb;
  if (isBackgroundValue(centerPosition, centerNormal)) {
    textureStore(hdrOutput, coord, vec4<f32>(centerColor, 1.0));
    return;
  }
  let centerLuminance = luminance(centerColor);
  var colorSum = vec3<f32>(0.0);
  var weightSum = 0.0;
  for (var dy: i32 = -4; dy <= 4; dy++) {
    for (var dx: i32 = -4; dx <= 4; dx++) {
      let sampleCoord = coord + vec2<i32>(dx, dy);
      if (sampleCoord.x < 0 || sampleCoord.y < 0 ||
          sampleCoord.x >= i32(frame.resolution.x) ||
          sampleCoord.y >= i32(frame.resolution.y)) {
        continue;
      }
      let samplePosition = textureLoad(gPosition, sampleCoord, 0);
      let sampleNormal = textureLoad(gNormal, sampleCoord, 0);
      if (isBackgroundValue(samplePosition, sampleNormal)) {
        continue;
      }
      if (dot(normalize(centerNormal.xyz), normalize(sampleNormal.xyz)) < 0.9) {
        continue;
      }
      if (distance(centerPosition.xyz, samplePosition.xyz) > 0.065 + centerPosition.w * 0.0015) {
        continue;
      }
      let sampleColor = textureLoad(hdrInput, sampleCoord, 0).rgb;
      let spatialDistance = f32(dx * dx + dy * dy);
      var weight = exp(-spatialDistance / 15.0);
      let luminanceDelta = abs(luminance(sampleColor) - centerLuminance);
      weight *= 1.0 / (1.0 + luminanceDelta * 0.9);
      colorSum += sampleColor * weight;
      weightSum += weight;
    }
  }
  let filtered = select(centerColor, colorSum / max(weightSum, 1e-4), weightSum > 0.0);
  textureStore(hdrOutput, coord, vec4<f32>(max(filtered, vec3<f32>(0.0)), 1.0));
}
