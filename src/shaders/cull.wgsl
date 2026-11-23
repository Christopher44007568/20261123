struct Frame {
  viewProj: mat4x4<f32>,
  invViewProj: mat4x4<f32>,
  cameraPos: vec4<f32>,
  screen: vec4<f32>,
  planes: array<vec4<f32>, 6>,
  misc: vec4<u32>,
}

struct Cluster {
  sphere: vec4<f32>,
  cone: vec4<f32>,
  page: u32,
  lod: u32,
  indexOffset: u32,
  vertexOffset: u32,
  flags: u32,
  material: u32,
  pad0: u32,
  pad1: u32,
}

struct PageMeta {
  center: vec4<f32>,
  errors: vec4<f32>,
}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> clusters: array<Cluster>;
@group(0) @binding(2) var<storage, read> pageMetas: array<PageMeta>;
@group(0) @binding(3) var<storage, read> residentSlots: array<u32>;
@group(0) @binding(4) var<storage, read_write> visibleClusters: array<u32>;
@group(0) @binding(5) var<storage, read_write> stats: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> drawArgs: array<atomic<u32>>;

const FRUSTUM_EPSILON = 0.025;
const CONE_EPSILON = 0.003;

fn raw_lod(page: u32) -> u32 {
  let pageData = pageMetas[page];
  let delta = frame.cameraPos.xyz - pageData.center.xyz;
  let surfaceDistance = max(length(delta) - pageData.center.w, 1.0);
  let pixelScale = frame.screen.y / (2.0 * frame.screen.z * surfaceDistance);
  let threshold = frame.screen.w;
  if (pageData.errors.w * pixelScale <= threshold) {
    return 3u;
  }
  if (pageData.errors.z * pixelScale <= threshold) {
    return 2u;
  }
  if (pageData.errors.y * pixelScale <= threshold) {
    return 1u;
  }
  return 0u;
}

fn sphere_visible(cluster: Cluster) -> bool {
  for (var i = 0u; i < 6u; i = i + 1u) {
    let plane = frame.planes[i];
    let outside = dot(plane.xyz, cluster.sphere.xyz) + plane.w;
    if (outside > cluster.sphere.w + FRUSTUM_EPSILON) {
      return false;
    }
  }
  return true;
}

fn cone_faces_camera(cluster: Cluster) -> bool {
  let toCamera = frame.cameraPos.xyz - cluster.sphere.xyz;
  let distSq = dot(toCamera, toCamera);
  let radius = cluster.sphere.w;
  if (distSq <= radius * radius) {
    return true;
  }
  let viewDirection = toCamera * inverseSqrt(distSq);
  let cosTheta = clamp(cluster.cone.w, -1.0, 1.0);
  let sinTheta = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));
  return dot(viewDirection, cluster.cone.xyz) >= -sinTheta - CONE_EPSILON;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id >= frame.misc.x) {
    return;
  }
  atomicAdd(&stats[0], 1u);
  let cluster = clusters[id];
  let page = cluster.page;
  var lod = raw_lod(page);
  var fallback = false;
  if (lod <= 1u && residentSlots[page] == 0xffffffffu) {
    lod = 2u;
    fallback = true;
  }
  let coverage = lod < 2u && cluster.lod == 2u;
  if (cluster.lod != lod && !coverage) {
    atomicAdd(&stats[1], 1u);
    return;
  }
  if (!sphere_visible(cluster)) {
    atomicAdd(&stats[2], 1u);
    return;
  }
  if (!cone_faces_camera(cluster)) {
    atomicAdd(&stats[3], 1u);
    return;
  }
  let slot = atomicAdd(&drawArgs[1], 1u);
  if (slot >= frame.misc.w) {
    return;
  }
  if (coverage) {
    visibleClusters[slot] = id | 0x80000000u;
  } else {
    visibleClusters[slot] = id;
  }
  atomicAdd(&stats[4], 1u);
  if (fallback) {
    atomicAdd(&stats[5], 1u);
  }
  if (coverage) {
    atomicAdd(&stats[11], 1u);
  } else {
    atomicAdd(&stats[6u + lod], 1u);
  }
}
