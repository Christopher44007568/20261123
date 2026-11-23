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

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> clusters: array<Cluster>;
@group(0) @binding(2) var<storage, read> residentSlots: array<u32>;
@group(0) @binding(3) var<storage, read> indices: array<u32>;
@group(0) @binding(4) var<storage, read> vertices: array<f32>;
@group(0) @binding(5) var<storage, read> visibleClusters: array<u32>;

const RESIDENT_INDEX_BASE: u32 = 936960u;
const RESIDENT_VERTEX_BASE: u32 = 180560u;
const PAGE_INDEX_STRIDE: u32 = 30720u;
const PAGE_VERTEX_STRIDE: u32 = 5314u;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) barycentric: vec3<f32>,
  @location(3) tint: vec2<f32>,
  @location(4) @interpolate(flat) lod: u32,
  @location(5) @interpolate(flat) material: u32,
  @location(6) @interpolate(flat) clusterId: u32,
}

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOut {
  let encodedCluster = visibleClusters[instanceIndex];
  let coverage = (encodedCluster & 0x80000000u) != 0u;
  let clusterId = encodedCluster & 0x7fffffffu;
  let cluster = clusters[clusterId];
  var firstIndex = cluster.indexOffset;
  var baseVertex = cluster.vertexOffset;
  if (cluster.lod <= 1u) {
    let slot = residentSlots[cluster.page];
    firstIndex += RESIDENT_INDEX_BASE + slot * PAGE_INDEX_STRIDE;
    baseVertex += RESIDENT_VERTEX_BASE + slot * PAGE_VERTEX_STRIDE;
  }
  let localIndex = indices[firstIndex + vertexIndex];
  let vertexBase = (baseVertex + localIndex) * 8u;
  let position = vec3<f32>(
    vertices[vertexBase],
    vertices[vertexBase + 1u],
    vertices[vertexBase + 2u],
  );
  let normal = vec3<f32>(
    vertices[vertexBase + 3u],
    vertices[vertexBase + 4u],
    vertices[vertexBase + 5u],
  );
  let tint = vec2<f32>(vertices[vertexBase + 6u], vertices[vertexBase + 7u]);
  let corner = vertexIndex % 3u;
  var barycentric = vec3<f32>(1.0, 0.0, 0.0);
  if (corner == 1u) {
    barycentric = vec3<f32>(0.0, 1.0, 0.0);
  } else if (corner == 2u) {
    barycentric = vec3<f32>(0.0, 0.0, 1.0);
  }
  var out: VertexOut;
  out.position = frame.viewProj * vec4<f32>(position, 1.0);
  if (coverage) {
    out.position.z = min(
      out.position.z + 0.0015 * out.position.w,
      out.position.w * 0.99999,
    );
  }
  out.world = position;
  out.normal = normal;
  out.barycentric = barycentric;
  out.tint = tint;
  out.lod = cluster.lod;
  out.material = cluster.material;
  out.clusterId = clusterId;
  return out;
}

fn hash11(value: f32) -> f32 {
  return fract(sin(value * 12.9898 + 78.233) * 43758.5453);
}

fn material_color(material: u32, tint: vec2<f32>, world: vec3<f32>) -> vec3<f32> {
  var base = vec3<f32>(0.39, 0.35, 0.29);
  if (material == 1u) {
    base = vec3<f32>(0.27, 0.30, 0.22);
  } else if (material == 2u) {
    base = vec3<f32>(0.48, 0.42, 0.32);
  } else if (material == 3u) {
    base = vec3<f32>(0.55, 0.49, 0.38);
  } else if (material == 4u) {
    base = vec3<f32>(0.44, 0.34, 0.22);
  } else if (material == 5u) {
    base = vec3<f32>(0.23, 0.23, 0.21);
  } else if (material == 6u) {
    base = vec3<f32>(0.53, 0.46, 0.35);
  } else if (material == 7u) {
    base = vec3<f32>(0.18, 0.20, 0.20);
  }
  let grain = 0.78 + tint.x * 0.30;
  let strata = 0.84 + 0.16 * sin(world.y * 2.55 + tint.y * 4.0);
  return base * grain * strata;
}

fn lod_color(lod: u32) -> vec3<f32> {
  if (lod == 0u) {
    return vec3<f32>(0.10, 0.84, 0.78);
  }
  if (lod == 1u) {
    return vec3<f32>(0.52, 0.92, 0.26);
  }
  if (lod == 2u) {
    return vec3<f32>(1.0, 0.66, 0.16);
  }
  return vec3<f32>(0.95, 0.27, 0.32);
}

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4<f32> {
  let mode = frame.misc.z;
  let normal = normalize(input.normal);
  let viewDirection = normalize(frame.cameraPos.xyz - input.world);
  let sunDirection = normalize(vec3<f32>(0.48, 0.72, 0.50));
  let diffuse = max(dot(normal, sunDirection), 0.0);
  let skyAmbient = 0.24 + max(normal.y, 0.0) * 0.10;
  let rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.0) * 0.11;
  var color: vec3<f32>;

  if (mode == 3u) {
    return vec4<f32>(1.0, 1.0, 1.0, 1.0);
  } else if (mode == 1u) {
    let hue = hash11(f32(input.clusterId) * 0.6180339);
    let palette = 0.5 + 0.5 * cos(6.2831853 * (hue + vec3<f32>(0.0, 0.33, 0.67)));
    color = mix(palette * 0.82 + 0.08, lod_color(input.lod), 0.16);
  } else if (mode == 2u) {
    let edge = min(min(input.barycentric.x, input.barycentric.y), input.barycentric.z);
    let wire = smoothstep(0.0, 0.065, edge);
    color = mix(vec3<f32>(0.04, 0.055, 0.06), lod_color(input.lod), wire);
  } else {
    color = material_color(input.material, input.tint, input.world);
    color *= skyAmbient + diffuse * 0.78;
    color += rim * vec3<f32>(0.55, 0.72, 0.82);
  }

  let fogDistance = length(frame.cameraPos.xyz - input.world);
  let fog = smoothstep(420.0, 1120.0, fogDistance);
  let fogColor = vec3<f32>(0.58, 0.72, 0.79);
  color = mix(color, fogColor, fog * 0.72);
  color = pow(max(color, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2));
  return vec4<f32>(color, 1.0);
}
