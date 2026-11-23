export const FULLSCREEN_VERTEX = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aQuad;
out vec2 vUv;
void main() {
  vUv = aQuad * 0.5 + 0.5;
  gl_Position = vec4(aQuad, 0.0, 1.0);
}
`;
