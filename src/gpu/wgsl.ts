// WGSL sources for the lunar inspection renderer.

export const MESH_WGSL = /* wgsl */ `
struct Camera {
  viewProj : mat4x4f,
  sunDir   : vec4f,
  eyePos   : vec4f,
};
@group(0) @binding(0) var<uniform> cam : Camera;

struct VsIn {
  @location(0) pos : vec3f,
  @location(1) nrm : vec3f,
  @location(2) m0 : vec4f,
  @location(3) m1 : vec4f,
  @location(4) m2 : vec4f,
  @location(5) m3 : vec4f,
  @location(6) color : vec4f,
};

struct VsOut {
  @builtin(position) clip : vec4f,
  @location(0) nrm : vec3f,
  @location(1) color : vec4f,
  @location(2) worldPos : vec3f,
};

@vertex
fn vsMain(in : VsIn) -> VsOut {
  let model = mat4x4f(in.m0, in.m1, in.m2, in.m3);
  let world = model * vec4f(in.pos, 1.0);
  var out : VsOut;
  out.clip = cam.viewProj * world;
  let n3 = (model * vec4f(in.nrm, 0.0)).xyz;
  out.nrm = normalize(n3);
  out.color = in.color;
  out.worldPos = world.xyz;
  return out;
}

@fragment
fn fsMain(in : VsOut) -> @location(0) vec4f {
  let n = normalize(in.nrm);
  let l = normalize(cam.sunDir.xyz);
  let diff = max(dot(n, l), 0.0);
  let hemi = mix(vec3f(0.10, 0.09, 0.08), vec3f(0.28, 0.30, 0.36), n.y * 0.5 + 0.5);
  let viewDir = normalize(cam.eyePos.xyz - in.worldPos);
  let h = normalize(l + viewDir);
  let spec = pow(max(dot(n, h), 0.0), 24.0) * 0.25;
  let lit = in.color.rgb * (diff * 1.15 + hemi) + vec3f(spec);
  let dist = length(cam.eyePos.xyz - in.worldPos);
  let fog = 1.0 - exp(-dist * 0.0022);
  let fogColor = vec3f(0.055, 0.055, 0.065);
  return vec4f(mix(lit, fogColor, fog), in.color.a);
}
`;

export const LINE_WGSL = /* wgsl */ `
struct Camera {
  viewProj : mat4x4f,
  sunDir   : vec4f,
  eyePos   : vec4f,
};
@group(0) @binding(0) var<uniform> cam : Camera;

struct VsIn {
  @location(0) pos : vec3f,
  @location(1) color : vec4f,
};
struct VsOut {
  @builtin(position) clip : vec4f,
  @location(0) color : vec4f,
};

@vertex
fn vsMain(in : VsIn) -> VsOut {
  var out : VsOut;
  out.clip = cam.viewProj * vec4f(in.pos, 1.0);
  out.color = in.color;
  return out;
}

@fragment
fn fsMain(in : VsOut) -> @location(0) vec4f {
  return in.color;
}
`;
