struct Frame {
  viewProj: mat4x4<f32>,
  invViewProj: mat4x4<f32>,
  cameraPos: vec4<f32>,
  screen: vec4<f32>,
  planes: array<vec4<f32>, 6>,
  misc: vec4<u32>,
}

@group(0) @binding(0) var<uniform> frame: Frame;

struct BackgroundOut {
  @builtin(position) position: vec4<f32>,
  @location(0) ndc: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> BackgroundOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  let p = positions[vertexIndex];
  var out: BackgroundOut;
  out.position = vec4<f32>(p, 0.9999, 1.0);
  out.ndc = p;
  return out;
}

fn sky_gradient(direction: vec3<f32>) -> vec3<f32> {
  let horizon = vec3<f32>(0.66, 0.78, 0.83);
  let zenith = vec3<f32>(0.25, 0.47, 0.68);
  let t = pow(clamp(direction.y, 0.0, 1.0), 0.55);
  var color = mix(horizon, zenith, t);
  let sun = normalize(vec3<f32>(0.48, 0.38, 0.79));
  let sunGlow = pow(max(dot(direction, sun), 0.0), 96.0);
  color += sunGlow * vec3<f32>(1.0, 0.72, 0.38) * 0.9;
  return color;
}

fn ocean(direction: vec3<f32>) -> vec3<f32> {
  let t = -frame.cameraPos.y / min(direction.y, -0.0001);
  let seaPoint = frame.cameraPos.xz + direction.xz * t;
  let ripple = sin(seaPoint.x * 0.11 + seaPoint.y * 0.07) * 0.5 + 0.5;
  let deep = vec3<f32>(0.055, 0.16, 0.19);
  let shallow = vec3<f32>(0.10, 0.30, 0.32);
  let color = mix(deep, shallow, ripple * 0.22 + 0.12);
  let haze = smoothstep(100.0, 1100.0, t);
  return mix(color, vec3<f32>(0.60, 0.72, 0.76), haze * 0.78);
}

@fragment
fn fs_main(input: BackgroundOut) -> @location(0) vec4<f32> {
  if (frame.misc.z == 3u) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }
  let nearW = frame.invViewProj * vec4<f32>(input.ndc, 0.0, 1.0);
  let farW = frame.invViewProj * vec4<f32>(input.ndc, 1.0, 1.0);
  let nearPoint = nearW.xyz / nearW.w;
  let farPoint = farW.xyz / farW.w;
  let direction = normalize(farPoint - nearPoint);
  var color: vec3<f32>;
  if (direction.y < 0.0) {
    color = ocean(direction);
  } else {
    color = sky_gradient(direction);
  }
  color = pow(max(color, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2));
  return vec4<f32>(color, 1.0);
}
