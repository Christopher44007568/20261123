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

struct Light {
  position: vec4<f32>,
  color: vec4<f32>,
};

struct Occluder {
  min: vec4<f32>,
  max: vec4<f32>,
};

struct Reservoir {
  lightIndex: u32,
  sampleCount: u32,
  weightSum: f32,
  targetPdf: f32,
  weight: f32,
  visibility: f32,
  candidateCount: u32,
  reserved: u32,
};

const PI: f32 = 3.14159265359;
const EPS: f32 = 1e-5;

fn luminance(color: vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn isFiniteValue(value: f32) -> bool {
  return value == value && abs(value) < 1.0e30;
}

fn hashU32(value: u32) -> u32 {
  var x = value;
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}

fn rand(seed: ptr<function, u32>) -> f32 {
  *seed = *seed * 1664525u + 1013904223u;
  return f32(*seed >> 8u) * (1.0 / 16777216.0);
}

fn fresnelSchlick(cosTheta: f32, f0: vec3<f32>) -> vec3<f32> {
  return f0 + (vec3<f32>(1.0) - f0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

fn distributionGGX(nDotH: f32, roughness: f32) -> f32 {
  let a = roughness * roughness;
  let a2 = a * a;
  let d = nDotH * nDotH * (a2 - 1.0) + 1.0;
  return a2 / max(PI * d * d, EPS);
}

fn geometrySmith(nDotV: f32, nDotL: f32, roughness: f32) -> f32 {
  let r = roughness + 1.0;
  let k = (r * r) / 8.0;
  let gv = nDotV / (nDotV * (1.0 - k) + k);
  let gl = nDotL / (nDotL * (1.0 - k) + k);
  return gv * gl;
}

fn evalLight(
  light: Light,
  worldPos: vec3<f32>,
  normal: vec3<f32>,
  albedo: vec3<f32>,
  roughness: f32,
  metalness: f32,
  cameraPos: vec3<f32>,
) -> vec3<f32> {
  let toLight = light.position.xyz - worldPos;
  let distanceSquared = max(dot(toLight, toLight), 0.025);
  let distance = sqrt(distanceSquared);
  let lightDir = toLight / distance;
  let nDotL = max(dot(normal, lightDir), 0.0);
  if (nDotL <= 0.0) {
    return vec3<f32>(0.0);
  }
  let viewDir = normalize(cameraPos - worldPos);
  let halfDir = normalize(viewDir + lightDir);
  let nDotV = max(dot(normal, viewDir), 0.001);
  let nDotH = max(dot(normal, halfDir), 0.0);
  let vDotH = max(dot(viewDir, halfDir), 0.0);
  let safeRoughness = clamp(roughness, 0.045, 1.0);
  let f0 = mix(vec3<f32>(0.035), albedo, metalness);
  let fresnel = fresnelSchlick(vDotH, f0);
  let distribution = distributionGGX(nDotH, safeRoughness);
  let geometry = geometrySmith(nDotV, nDotL, safeRoughness);
  let specular = (distribution * geometry * fresnel) / max(4.0 * nDotV * nDotL, EPS);
  let diffuse = albedo * (1.0 - metalness) / PI;
  let ratio = distance / max(light.position.w, 0.01);
  let window = pow(clamp(1.0 - ratio * ratio, 0.0, 1.0), 2.0);
  let radiance = light.color.rgb * light.color.a * window / (distanceSquared + 0.12);
  return (diffuse + specular) * radiance * nDotL;
}

fn isOccluded(
  occluders: ptr<storage, array<Occluder>, read>,
  occluderCount: u32,
  worldPos: vec3<f32>,
  normal: vec3<f32>,
  targetPoint: vec3<f32>,
) -> bool {
  let origin = worldPos + normal * 0.025;
  let delta = targetPoint - origin;
  let distance = length(delta);
  if (distance < 0.05) {
    return false;
  }
  let rayDir = delta / distance;
  let invDir = 1.0 / rayDir;
  let tMax = distance - 0.07;
  for (var i: u32 = 0u; i < occluderCount; i = i + 1u) {
    let box = (*occluders)[i];
    let t0 = (box.min.xyz - origin) * invDir;
    let t1 = (box.max.xyz - origin) * invDir;
    let near = min(t0, t1);
    let far = max(t0, t1);
    let entry = max(max(near.x, near.y), near.z);
    let exit = min(min(far.x, far.y), far.z);
    if (exit > 0.03 && entry < tMax && entry < exit) {
      return true;
    }
  }
  return false;
}

fn reservoirWeight(reservoir: Reservoir) -> f32 {
  if (reservoir.sampleCount == 0u || reservoir.targetPdf <= EPS) {
    return 0.0;
  }
  return reservoir.weightSum / (f32(reservoir.sampleCount) * reservoir.targetPdf);
}

fn updateReservoir(
  reservoir: ptr<function, Reservoir>,
  candidate: u32,
  candidateWeight: f32,
  candidateCount: u32,
  randomValue: f32,
) {
  let previousWeight = (*reservoir).weightSum;
  (*reservoir).weightSum += candidateWeight;
  (*reservoir).sampleCount += candidateCount;
  (*reservoir).candidateCount += 1u;
  let probability = candidateWeight / max((*reservoir).weightSum, EPS);
  if (randomValue < probability || previousWeight <= EPS) {
    (*reservoir).lightIndex = candidate;
  }
}

fn resolveReservoir(
  reservoir: ptr<function, Reservoir>,
  worldPos: vec3<f32>,
  normal: vec3<f32>,
  albedo: vec3<f32>,
  roughness: f32,
  metalness: f32,
  cameraPos: vec3<f32>,
  lights: ptr<storage, array<Light>, read>,
  lightCount: u32,
) {
  if ((*reservoir).sampleCount == 0u || (*reservoir).lightIndex >= lightCount) {
    (*reservoir).targetPdf = 0.0;
    (*reservoir).weight = 0.0;
    return;
  }
  let light = (*lights)[(*reservoir).lightIndex];
  let contribution = evalLight(light, worldPos, normal, albedo, roughness, metalness, cameraPos);
  (*reservoir).targetPdf = max(luminance(contribution), EPS);
  (*reservoir).weight = (*reservoir).weightSum / (f32((*reservoir).sampleCount) * (*reservoir).targetPdf);
}
