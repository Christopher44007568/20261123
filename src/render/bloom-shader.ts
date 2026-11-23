export const BLOOM_EXTRACT_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform vec2 uTexel;
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy * uTexel * 2.0;
  vec3 a = texture(uScene, uv + uTexel * vec2(-1.0, -1.0)).rgb;
  vec3 b = texture(uScene, uv + uTexel * vec2(1.0, -1.0)).rgb;
  vec3 c = texture(uScene, uv + uTexel * vec2(-1.0, 1.0)).rgb;
  vec3 d = texture(uScene, uv + uTexel * vec2(1.0, 1.0)).rgb;
  vec3 color = (a + b + c + d) * 0.25;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float contribute = smoothstep(0.65, 2.5, luminance);
  vec3 soft = color / (vec3(1.0) + luminance * 0.15);
  outColor = vec4(soft * contribute, 1.0);
}`;

export const BLOOM_BLUR_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uDirection;
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(uSource, 0));
  vec2 stepUv = uDirection / vec2(textureSize(uSource, 0));
  vec3 color = texture(uSource, uv).rgb * 0.227027;
  color += texture(uSource, uv + stepUv * 1.384615).rgb * 0.316216;
  color += texture(uSource, uv - stepUv * 1.384615).rgb * 0.316216;
  color += texture(uSource, uv + stepUv * 3.230769).rgb * 0.070270;
  color += texture(uSource, uv - stepUv * 3.230769).rgb * 0.070270;
  outColor = vec4(color, 1.0);
}`;
