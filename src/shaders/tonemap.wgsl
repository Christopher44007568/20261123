@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var hdrTexture: texture_2d<f32>;
@group(0) @binding(2) var referenceTexture: texture_2d<f32>;
@group(0) @binding(3) var linearSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  var uvs = array<vec2<f32>, 3>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(2.0, 1.0),
    vec2<f32>(0.0, -1.0),
  );
  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  output.uv = uvs[vertexIndex];
  return output;
}

fn acesFilm(color: vec3<f32>) -> vec3<f32> {
  let a = color * (2.51 * color + vec3<f32>(0.03));
  let b = color * (2.43 * color + vec3<f32>(0.59)) + vec3<f32>(0.14);
  return clamp(a / b, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn sampledGlow(uv: vec2<f32>) -> vec3<f32> {
  let texel = 1.0 / frame.resolution;
  var glow = vec3<f32>(0.0);
  let offsets = array<vec2<f32>, 8>(
    vec2<f32>(-3.0, 0.0), vec2<f32>(3.0, 0.0),
    vec2<f32>(0.0, -3.0), vec2<f32>(0.0, 3.0),
    vec2<f32>(-2.0, -2.0), vec2<f32>(2.0, -2.0),
    vec2<f32>(-2.0, 2.0), vec2<f32>(2.0, 2.0),
  );
  for (var i: u32 = 0u; i < 8u; i++) {
    let sample = textureSampleLevel(hdrTexture, linearSampler, uv + offsets[i] * texel * 1.6, 0.0).rgb;
    let bright = max(luminance(sample) - 0.65, 0.0);
    glow += sample * bright * 0.035;
  }
  return glow;
}

@fragment
fn fsMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let uv = clamp(input.uv, vec2<f32>(0.0), vec2<f32>(1.0));
  if (frame.mode == 3u) {
    let debug = textureSampleLevel(hdrTexture, linearSampler, uv, 0.0).rgb;
    return vec4<f32>(clamp(debug, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
  }
  var color: vec3<f32>;
  if (frame.mode == 1u) {
    color = textureSampleLevel(referenceTexture, linearSampler, uv, 0.0).rgb;
  } else if (frame.mode == 2u) {
    if (uv.x < 0.5) {
      color = textureSampleLevel(referenceTexture, linearSampler, uv, 0.0).rgb;
    } else {
      color = textureSampleLevel(hdrTexture, linearSampler, uv, 0.0).rgb;
    }
  } else {
    color = textureSampleLevel(hdrTexture, linearSampler, uv, 0.0).rgb;
    color += sampledGlow(uv);
  }

  var exposed = color * frame.exposure;
  if (frame.mode == 3u) {
    exposed *= 2.2;
    let debug = acesFilm(exposed);
    let gammaDebug = pow(debug, vec3<f32>(1.0 / 2.2));
    return vec4<f32>(gammaDebug, 1.0);
  }
  exposed = acesFilm(exposed);
  let vignette = 1.0 - smoothstep(0.24, 0.95, length((uv - 0.5) * vec2<f32>(1.06, 0.9)));
  exposed *= 0.76 + vignette * 0.24;
  exposed = mix(exposed, exposed * vec3<f32>(1.03, 0.99, 0.93), 0.35);
  var gamma = pow(max(exposed, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2));
  let grain = fract(sin(dot(uv * frame.resolution, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  gamma += (grain - 0.5) * 0.012;
  if (frame.mode == 2u && abs(uv.x - 0.5) < 0.0012) {
    gamma = vec3<f32>(0.95, 0.45, 0.1);
  }
  return vec4<f32>(clamp(gamma, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
