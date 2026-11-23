export const DROPLET_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

out vec4 outColor;

uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uDrops;
uniform vec2 uResolution;
uniform float uTime;
uniform int uMode;
uniform int uDropCount;
uniform float uShowMask;
uniform float uFocalLengthMm;
uniform float uAperture;
uniform float uFocusM;
uniform float uExposure;
uniform vec3 uCockpitTint;

const float MAX_DROPS = 64.0;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float saturate(float v) {
  return clamp(v, 0.0, 1.0);
}

vec3 acesFilm(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 sampleRefraction(vec2 uv, float lod, vec2 chroma) {
  float r = textureLod(uScene, clamp(uv + chroma, 0.001, 0.999), lod).r;
  float g = textureLod(uScene, clamp(uv, 0.001, 0.999), lod).g;
  float b = textureLod(uScene, clamp(uv - chroma, 0.001, 0.999), lod).b;
  return vec3(r, g, b);
}

float trailShape(vec2 p, vec2 center, float radius, float trailLength, float trailWidth) {
  if (trailLength < 1.0) return 0.0;
  float y = p.y - center.y;
  if (y < radius * 0.3 || y > radius + trailLength) return 0.0;
  float t = clamp((y - radius) / max(trailLength, 1.0), 0.0, 1.0);
  float width = mix(trailWidth, max(1.2, trailWidth * 0.25), t);
  float sr = abs(p.x - center.x) / width;
  float ends = smoothstep(radius * 0.3, radius * 1.15, y)
    * (1.0 - smoothstep(radius + trailLength - 3.0, radius + trailLength, y));
  return (1.0 - smoothstep(0.62, 1.0, sr)) * ends * (1.0 - t * 0.72);
}

vec3 windshieldCockpit(vec3 color, vec2 uv, float glassMask) {
  float dashTop = 0.158 + 0.082 * pow(abs(uv.x - 0.5) * 2.0, 2.25);
  float dashboard = 1.0 - smoothstep(dashTop - 0.012, dashTop + 0.008, uv.y);
  float leftPillar = 1.0 - smoothstep(0.022, 0.058, uv.x);
  float rightPillar = smoothstep(0.942, 0.978, uv.x);
  float header = smoothstep(0.934, 0.982, uv.y);
  float frame = max(max(leftPillar, rightPillar), max(dashboard, header));

  vec3 dash = mix(vec3(0.002, 0.0045, 0.0065), vec3(0.006, 0.013, 0.017), uv.y);
  float instrument = exp(-pow((uv.x - 0.205) / 0.055, 2.0) - pow((uv.y - 0.058) / 0.044, 2.0));
  float instrumentTwo = exp(-pow((uv.x - 0.79) / 0.075, 2.0) - pow((uv.y - 0.038) / 0.035, 2.0));
  dash += vec3(0.03, 0.15, 0.15) * instrument * 0.42;
  dash += vec3(0.12, 0.045, 0.018) * instrumentTwo * 0.34;

  vec2 wheel = (uv - vec2(0.505, -0.015)) / vec2(0.235, 0.145);
  float wheelRing = 1.0 - smoothstep(0.055, 0.105, abs(length(wheel) - 0.82));
  wheelRing *= smoothstep(0.0, 0.12, wheel.y);
  dash = mix(dash, vec3(0.008, 0.012, 0.015), wheelRing * 0.85);

  float dashLip = exp(-abs(uv.y - dashTop) * 520.0);
  dash += vec3(0.025, 0.055, 0.062) * dashLip * 0.55;
  color = mix(color, dash, dashboard);

  vec3 pillar = mix(vec3(0.001, 0.0025, 0.0035), vec3(0.009, 0.017, 0.021), uv.y);
  float pillarEdge = max(
    exp(-abs(uv.x - 0.059) * 510.0),
    exp(-abs(uv.x - 0.941) * 510.0)
  );
  pillar += vec3(0.02, 0.042, 0.05) * pillarEdge * 0.65;
  color = mix(color, pillar, max(leftPillar, rightPillar) * 0.985);

  vec3 roof = vec3(0.0015, 0.003, 0.0045);
  float roofLip = exp(-abs(uv.y - 0.944) * 460.0);
  roof += vec3(0.015, 0.034, 0.04) * roofLip;
  color = mix(color, roof, header * 0.99);

  float edge = max(
    exp(-abs(uv.x - 0.04) * 1200.0),
    exp(-abs(uv.x - 0.96) * 1200.0)
  );
  edge = max(edge, exp(-abs(uv.y - dashTop - 0.015) * 980.0));
  color += vec3(0.025, 0.075, 0.082) * edge * glassMask * 0.45;

  float smear = exp(-pow((uv.x * 1.15 + uv.y * 0.68 - 0.91) / 0.055, 2.0));
  color += vec3(0.018, 0.031, 0.035) * smear * glassMask * 0.19;
  color += uCockpitTint * (1.0 - glassMask) * 0.018;
  return color;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = gl_FragCoord.xy;
  float dashTop = 0.158 + 0.082 * pow(abs(uv.x - 0.5) * 2.0, 2.25);
  float glassMask = smoothstep(0.025, 0.041, uv.x)
    * (1.0 - smoothstep(0.959, 0.975, uv.x))
    * smoothstep(dashTop + 0.001, dashTop + 0.014, uv.y)
    * (1.0 - smoothstep(0.935, 0.963, uv.y));

  vec3 baseScene = texture(uScene, uv).rgb;
  vec3 bloom = texture(uBloom, uv).rgb;
  vec3 color = baseScene + bloom * 0.48;
  float smallMask = 0.0;
  float largeMask = 0.0;
  float trailMask = 0.0;

  if (uMode != 0 && glassMask > 0.001) {
    int count = min(uDropCount, int(MAX_DROPS));
    for (int i = 0; i < 64; i++) {
      if (i >= count) break;
      vec4 A = texelFetch(uDrops, ivec2(0, i), 0);
      vec4 B = texelFetch(uDrops, ivec2(1, i), 0);
      vec4 C = texelFetch(uDrops, ivec2(2, i), 0);
      vec4 D = texelFetch(uDrops, ivec2(3, i), 0);
      float radius = A.z;
      if (radius < 0.35) continue;

      vec2 center = A.xy * uResolution;
      float seed = B.w;
      float large = D.x;
      float drift = D.z;

      float trail = trailShape(p, center, radius, C.x, C.y) * drift;
      if (trail > 0.001) {
        vec2 wobbleUv = vec2(
          sin(p.y * 0.085 + seed * 39.0 + uTime * 0.7),
          cos(p.x * 0.06 + seed * 17.0)
        ) * (1.3 / uResolution);
        vec3 wet = textureLod(uScene, clamp(uv + wobbleUv, 0.001, 0.999), 2.2).rgb;
        vec3 wetColor = wet * vec3(0.64, 0.8, 0.82) + vec3(0.018, 0.045, 0.052);
        color += wetColor * trail * C.z * glassMask * 0.31;
        trailMask = max(trailMask, trail * glassMask);
      }

      vec2 radii = vec2(max(0.7, radius * A.w), max(0.7, radius));
      vec2 local = (p - center) / radii;
      float r2 = dot(local, local);
      float focusBlur = C.w;
        float blurNorm = clamp(focusBlur / 15.0, 0.0, 1.0);

      if (r2 >= 1.0 && focusBlur > 1.2 && large < 0.5) {
        float haloRadius = radius + focusBlur * 0.72;
        vec2 haloLocal = (p - center) / vec2(max(0.7, haloRadius * A.w), haloRadius);
        float haloR2 = dot(haloLocal, haloLocal);
        if (haloR2 < 1.0) {
          float haloDisc = (1.0 - smoothstep(0.72, 1.0, haloR2))
            * smoothstep(0.0, 0.14, 1.0 - haloR2);
          float haloRing = exp(-pow((sqrt(haloR2) - 0.92) * 8.0, 2.0));
          float dofAmount = smoothstep(3.0, 14.0, focusBlur);
          vec3 haloColor = vec3(0.035, 0.09, 0.095) + textureLod(uScene, uv, 4.5).rgb * 0.16;
          color += haloColor * (haloDisc * 0.045 + haloRing * 0.055) * dofAmount * C.z * glassMask;
        }
      }

      if (r2 < 1.0) {
        float aa = clamp(1.45 / max(radius, 0.75), 0.045, 0.58);
        float edge = sqrt(r2);
        float body = 1.0 - smoothstep(1.0 - aa, 1.0, edge);
        float wobble = 0.018 * sin(uTime * 1.7 + seed * 41.0 + local.y * 4.0);
        vec2 surface = B.xy * 0.34 + local * (0.64 + 0.18 * local.y) + vec2(wobble, -wobble);
        vec3 lensNormal = normalize(vec3(surface, sqrt(max(0.035, 1.0 - r2)) * 1.17));

        float fresnel = 0.035 + 0.965 * pow(1.0 - clamp(lensNormal.z, 0.0, 1.0), 5.0);
        float largeBlur = large > 0.5 ? 1.6 + 2.7 * smoothstep(15.0, 46.0, radius) : 0.0;
        float lod = 0.15 + focusBlur * 0.22 + largeBlur + (1.0 - A.w) * 0.12;
        vec2 bend = local * (0.19 + 0.25 * r2) + B.xy * 0.31;
        bend += vec2(
          sin(local.y * 4.4 + seed * 31.0 + uTime * 0.35),
          cos(local.x * 3.7 - seed * 23.0)
        ) * 0.018;
        vec2 offsetPx = bend * radius * 0.82;
        vec2 sampleUv = clamp(uv - offsetPx / uResolution, 0.001, 0.999);
        vec2 chroma = local.yx * (0.00115 + 0.0012 * r2);
        vec3 refracted = sampleRefraction(sampleUv, lod, chroma);
        refracted += texture(uBloom, sampleUv).rgb * 0.2;

        vec3 waterTint = vec3(0.006, 0.016, 0.019);
        float absorption = mix(0.72, 0.58, large) * (0.72 + 0.28 * r2);
        vec3 interior = mix(waterTint, refracted * vec3(0.88, 1.02, 1.04), absorption);
        interior += refracted * large * 0.09;
        float edgeRing = smoothstep(0.56, 0.97, edge) * (1.0 - smoothstep(0.96, 1.0, edge));
        interior *= 1.0 - edgeRing * 0.22;

        vec2 reflectUv = clamp(uv + vec2(lensNormal.x, lensNormal.y * 0.75 + 0.035) * 0.45, 0.001, 0.999);
        vec3 environment = textureLod(uScene, reflectUv, 1.25).rgb;
        environment += texture(uBloom, reflectUv).rgb * 0.35;
        vec3 reflection = environment * (0.22 + 0.78 * fresnel) * 0.52;
        reflection += vec3(0.11, 0.2, 0.21) * fresnel * 0.18;

        vec3 halfVector = normalize(normalize(vec3(-0.32, 0.62, 0.72)) + vec3(0.0, 0.0, 1.0));
        float specular = pow(max(dot(lensNormal, halfVector), 0.0), 110.0);
        float coreSpark = pow(max(0.0, 1.0 - r2), 24.0) * 0.15;
        float definition = large > 0.5 ? 1.0 : 1.0 - blurNorm * 0.58;
        vec3 dropColor = interior + reflection + vec3(2.4, 2.7, 2.65) * specular + coreSpark;
        dropColor = mix(waterTint * 1.7, dropColor, definition);
        dropColor *= 0.89 + 0.11 * sin(seed * 74.0);

        float focusHalo = focusBlur > 0.35
          ? exp(-pow((edge - 1.0) * radius / (1.0 + focusBlur * 0.8), 2.0)) * 0.075
          : 0.0;
        color += vec3(0.035, 0.085, 0.09) * focusHalo * body * glassMask;

        float alpha = body * C.z * glassMask * mix(0.78, 1.0, definition);
        color = mix(color, dropColor, alpha);
        smallMask = max(smallMask, body * glassMask);
        largeMask = max(largeMask, body * glassMask * large);
      }
    }
  }

  if (uShowMask > 0.5) {
    vec2 gridUv = gl_FragCoord.xy / (18.0 * max(1.0, uResolution.y / 900.0));
    float grid = max(
      1.0 - smoothstep(0.0, 0.055, abs(fract(gridUv.x) - 0.5)),
      1.0 - smoothstep(0.0, 0.055, abs(fract(gridUv.y) - 0.5))
    );
    color = vec3(0.004, 0.009, 0.012) + baseScene * 0.055;
    color += vec3(0.012, 0.06, 0.068) * grid * 0.22;
    color = mix(color, vec3(0.0, 0.82, 0.88), smallMask * 0.26);
    color = mix(color, vec3(1.0, 0.26, 0.075), largeMask * 0.78);
    color += vec3(0.25, 1.0, 0.9) * trailMask * 0.25;
    float scan = 0.91 + 0.09 * sin(gl_FragCoord.y * 2.3);
    color *= scan;
  }

  color = windshieldCockpit(color, uv, glassMask);
  vec2 q = (uv - 0.5);
  float vignette = 1.0 - dot(q, q) * 0.36;
  color *= vignette;
  color = acesFilm(color * uExposure);
  color = pow(color, vec3(1.0 / 2.2));
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luminance), color, 1.04);
  outColor = vec4(color, 1.0);
}
`;
