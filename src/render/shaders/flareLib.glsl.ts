export const FLARE_LIB = /* glsl */ `
uniform sampler2D uSceneDepth;
uniform vec2 uNearFar;
uniform vec2 uTexelSize;

float viewDepthFromBuffer(vec2 uv) {
  float d = texture(uSceneDepth, uv).r;
  float nearPlane = uNearFar.x;
  float farPlane = uNearFar.y;
  float ndcDepth = d * 2.0 - 1.0;
  return (2.0 * nearPlane * farPlane) / (farPlane + nearPlane - ndcDepth * (farPlane - nearPlane));
}

const vec2 POISSON_12[12] = vec2[12](
  vec2(-0.326, -0.406), vec2( 0.283, -0.446), vec2( 0.412,  0.251),
  vec2(-0.248,  0.388), vec2(-0.470, -0.054), vec2( 0.069,  0.481),
  vec2( 0.470, -0.044), vec2(-0.073, -0.479), vec2( 0.232,  0.190),
  vec2(-0.176, -0.199), vec2( 0.043, -0.035), vec2(-0.135,  0.137)
);

float sourceVisibility(vec2 uv, vec2 kernelUv, float lightViewDepth) {
  float visible = 1.0;
  float bias = 0.15;
  for (int i = 0; i < 12; i++) {
    vec2 sampleUv = clamp(uv + POISSON_12[i] * kernelUv, vec2(0.0), vec2(1.0));
    float sceneDepth = viewDepthFromBuffer(sampleUv);
    visible -= step(sceneDepth + bias, lightViewDepth) / 12.0;
  }
  return clamp(visible, 0.0, 1.0);
}

float sdNGon(vec2 p, float r, float sides) {
  float an = 6.28318530718 / sides;
  vec2 acs = vec2(cos(an), sin(an));
  float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
  p = length(p) * vec2(cos(bn), abs(sin(bn)));
  p -= r * acs;
  vec2 edgeAxis = vec2(acs.y, -acs.x);
  p -= edgeAxis * clamp(dot(p, edgeAxis), 0.0, r * sin(an));
  return length(p) * sign(p.y);
}

float apertureSprite(vec2 p, float r, float ring, float softness) {
  float sides = 7.0;
  float d = sdNGon(p, r, sides);
  float normalized = d / max(r, 1e-4);
  float body = exp(-2.6 * normalized * normalized);
  float rim = exp(-pow((d - r * 0.82) / max(r * 0.10, 1e-4), 2.0)) * ring;
  return body + rim;
}

vec2 ndcToUvDelta(vec2 ndcDelta, float aspect) {
  return vec2(ndcDelta.x * aspect, ndcDelta.y) * 0.5;
}
`;
