"use strict";
(() => {
  // src/mat4.ts
  function mat4Multiply(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        out[c * 4 + r] = s;
      }
    }
    return out;
  }
  function mat4Perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    const m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) / (near - far);
    m[11] = -1;
    m[14] = 2 * far * near / (near - far);
    return m;
  }
  function mat4LookAt(eye, center, up) {
    const zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    const zl = Math.hypot(zx, zy, zz);
    const z0 = zx / zl, z1 = zy / zl, z2 = zz / zl;
    let x0 = up[1] * z2 - up[2] * z1;
    let x1 = up[2] * z0 - up[0] * z2;
    let x2 = up[0] * z1 - up[1] * z0;
    const xl = Math.hypot(x0, x1, x2) || 1;
    x0 /= xl;
    x1 /= xl;
    x2 /= xl;
    const y0 = z1 * x2 - z2 * x1, y1 = z2 * x0 - z0 * x2, y2 = z0 * x1 - z1 * x0;
    const m = new Float32Array(16);
    m[0] = x0;
    m[1] = y0;
    m[2] = z0;
    m[3] = 0;
    m[4] = x1;
    m[5] = y1;
    m[6] = z1;
    m[7] = 0;
    m[8] = x2;
    m[9] = y2;
    m[10] = z2;
    m[11] = 0;
    m[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
    m[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
    m[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
    m[15] = 1;
    return m;
  }

  // src/terrain.ts
  var WORLD_SIZE = 200;
  var WATER_LEVEL = 1.5;
  var VOLCANO = { x: -18, z: -14, radius: 46, height: 44, craterR: 10, craterDepth: 13 };
  var CINDER = { x: 52, z: 42, radius: 17, height: 15 };
  var CLIFF = { amp: 14, zBase: 34, zWobble: 7, xMin: -85, xMax: 45 };
  function smoothstep(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }
  var CHANNELS = [0.5, 2.4, 4.3];
  function channelOffset(baseAngle, r) {
    return baseAngle + 0.28 * Math.sin(r * 0.16 + baseAngle * 3);
  }
  function sampleTerrain(x, z) {
    let h = 2.2 + 1.4 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.05 - 0.6) + 0.5 * Math.sin(x * 0.13) * Math.sin(z * 0.11 + 2);
    let lava = 0;
    {
      const dx = x - VOLCANO.x, dz = z - VOLCANO.z;
      const r = Math.hypot(dx, dz);
      if (r < VOLCANO.radius) {
        const t = 1 - r / VOLCANO.radius;
        h += VOLCANO.height * Math.pow(t, 1.25);
        if (r < VOLCANO.craterR) {
          const c = 1 - (r / VOLCANO.craterR) ** 2;
          h -= VOLCANO.craterDepth * c;
        }
        const rim = Math.exp(-((r - VOLCANO.craterR) ** 2) / 6);
        h += rim * 1 * Math.sin(Math.atan2(dz, dx) * 9);
      }
      if (r > 6 && r < 62) {
        const ang = Math.atan2(dz, dx);
        for (const base of CHANNELS) {
          const center = channelOffset(base, r);
          let da = ang - center;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          const width = 0.09 + r * 12e-4;
          const across = Math.exp(-(da * da) / (2 * width * width));
          const along = smoothstep(6, 12, r) * (1 - smoothstep(38, 62, r));
          const carve = across * along;
          h -= 3.2 * carve * Math.min(1, r / 30);
          lava = Math.max(lava, Math.min(1, carve * 1.6));
        }
      }
    }
    {
      const dx = x - CINDER.x, dz = z - CINDER.z;
      const r = Math.hypot(dx, dz);
      if (r < CINDER.radius) {
        const t = 1 - r / CINDER.radius;
        h += CINDER.height * Math.pow(t, 1.7);
      }
    }
    {
      const zLine = CLIFF.zBase + CLIFF.zWobble * Math.sin(x * 0.06 + 0.8);
      const inX = smoothstep(CLIFF.xMin, CLIFF.xMin + 6, x) * (1 - smoothstep(CLIFF.xMax - 6, CLIFF.xMax, x));
      h += CLIFF.amp * smoothstep(zLine - 2, zLine + 2, z) * inX;
    }
    return { h, lava };
  }
  function buildTerrain(grid) {
    const n = grid + 1;
    const positions = new Float32Array(n * n * 3);
    const normals = new Float32Array(n * n * 3);
    const heights = new Float32Array(n * n);
    const lava = new Float32Array(n * n);
    const step = WORLD_SIZE / grid;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -WORLD_SIZE / 2 + i * step;
        const z = -WORLD_SIZE / 2 + j * step;
        const s = sampleTerrain(x, z);
        const idx = j * n + i;
        positions[idx * 3] = x;
        positions[idx * 3 + 1] = s.h;
        positions[idx * 3 + 2] = z;
        heights[idx] = s.h;
        lava[idx] = s.lava;
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const idx = j * n + i;
        const il = j * n + Math.max(0, i - 1), ir = j * n + Math.min(grid, i + 1);
        const jd = Math.max(0, j - 1) * n + i, ju = Math.min(grid, j + 1) * n + i;
        const sx = (heights[ir] - heights[il]) / ((ir - il) * step || 1);
        const sz = (heights[ju] - heights[jd]) / ((ju - jd) * step || 1);
        const inv = 1 / Math.hypot(sx, 1, sz);
        normals[idx * 3] = -sx * inv;
        normals[idx * 3 + 1] = inv;
        normals[idx * 3 + 2] = -sz * inv;
      }
    }
    const indices = new Uint32Array(grid * grid * 6);
    let k = 0;
    for (let j = 0; j < grid; j++) {
      for (let i = 0; i < grid; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        indices[k++] = a;
        indices[k++] = c;
        indices[k++] = b;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = d;
      }
    }
    return { positions, normals, heights, lava, indices };
  }
  function buildWaterPlane() {
    const h = WORLD_SIZE / 2;
    const positions = new Float32Array([
      -h,
      WATER_LEVEL,
      -h,
      h,
      WATER_LEVEL,
      -h,
      h,
      WATER_LEVEL,
      h,
      -h,
      WATER_LEVEL,
      h
    ]);
    const indices = new Uint32Array([0, 2, 1, 0, 3, 2]);
    return { positions, indices };
  }

  // src/gl.ts
  function compileShader(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(`shader compile failed:
${gl.getShaderInfoLog(sh)}
${src}`);
    }
    return sh;
  }
  function linkProgram(gl, vsSrc, fsSrc) {
    const prog = gl.createProgram();
    gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`program link failed: ${gl.getProgramInfoLog(prog)}`);
    }
    return prog;
  }
  function makeTexture(gl, w, h, internal, format, type) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }
  function createGBuffer(gl, w, h) {
    const albedoFlag = makeTexture(gl, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    const normalDepth = makeTexture(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
    const heightLava = makeTexture(gl, w, h, gl.RG16F, gl.RG, gl.HALF_FLOAT);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, albedoFlag, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, normalDepth, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, heightLava, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("G-buffer framebuffer incomplete");
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, albedoFlag, normalDepth, heightLava, depth, width: w, height: h };
  }
  function destroyGBuffer(gl, gb) {
    gl.deleteFramebuffer(gb.fbo);
    gl.deleteTexture(gb.albedoFlag);
    gl.deleteTexture(gb.normalDepth);
    gl.deleteTexture(gb.heightLava);
    gl.deleteRenderbuffer(gb.depth);
  }

  // src/shaders_geo.ts
  var GEO_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aData; // (height, lavaMask); water sends (-1, -1)
uniform mat4 uViewProj;
uniform mat4 uView;
out vec3 vNormal;
out vec3 vWorldPos;
out vec2 vData;
out float vViewZ;
void main() {
  vNormal = aNormal;
  vWorldPos = aPos;
  vData = aData;
  vViewZ = -(uView * vec4(aPos, 1.0)).z;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`;
  var GEO_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorldPos;
in vec2 vData;
in float vViewZ;
uniform float uWaterLevel;
layout(location=0) out vec4 outAlbedoFlag;
layout(location=1) out vec4 outNormalDepth;
layout(location=2) out vec2 outHeightLava;

vec3 ramp(float t) {
  vec3 c0 = vec3(0.45, 0.72, 0.32);  // lowland green
  vec3 c1 = vec3(0.85, 0.72, 0.38);  // tan
  vec3 c2 = vec3(0.55, 0.36, 0.22);  // brown rock
  vec3 c3 = vec3(0.62, 0.62, 0.66);  // grey rock
  vec3 c4 = vec3(0.92, 0.92, 0.95);  // summit ash
  vec3 col = mix(c0, c1, smoothstep(0.0, 0.25, t));
  col = mix(col, c2, smoothstep(0.25, 0.5, t));
  col = mix(col, c3, smoothstep(0.5, 0.75, t));
  col = mix(col, c4, smoothstep(0.75, 1.0, t));
  return col;
}

void main() {
  bool isWater = vData.x < -0.5;
  if (isWater) {
    // Water baseline: flat, unstyled. Flag 0 excludes it from toon + outlines.
    outAlbedoFlag = vec4(0.23, 0.46, 0.72, 0.0);
    outNormalDepth = vec4(0.0, 1.0, 0.0, vViewZ);
    outHeightLava = vec2(uWaterLevel, 0.0);
    return;
  }
  float t = clamp(vData.x / 48.0, 0.0, 1.0);
  vec3 albedo = ramp(t);
  float lava = clamp(vData.y, 0.0, 1.0);
  vec3 lavaCol = mix(vec3(0.42, 0.12, 0.05), vec3(0.95, 0.35, 0.08), lava);
  albedo = mix(albedo, lavaCol, smoothstep(0.15, 0.7, lava));
  outAlbedoFlag = vec4(albedo, 1.0);
  outNormalDepth = vec4(normalize(vNormal), vViewZ);
  outHeightLava = vec2(vData.x, lava);
}
`;
  var WATER_DATA = new Float32Array([-1, -1, -1, -1, -1, -1, -1, -1]);

  // src/shaders_shade.ts
  var QUAD_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;
  var SHADE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uAlbedoFlag;
uniform sampler2D uNormalDepth;
uniform sampler2D uHeightLava;
uniform vec2 uResolution;
uniform vec3 uLightDir;
uniform vec3 uFogColor;
uniform int uMode;

const int BAND_COUNT = 9;
const float BAND_HEIGHT = 6.0;
const vec3 PALETTE[9] = vec3[9](
  vec3(0.494, 0.784, 0.314), vec3(0.659, 0.761, 0.337), vec3(0.851, 0.722, 0.290),
  vec3(0.788, 0.561, 0.239), vec3(0.663, 0.420, 0.208), vec3(0.549, 0.353, 0.188),
  vec3(0.478, 0.290, 0.173), vec3(0.604, 0.604, 0.604), vec3(0.941, 0.941, 0.961)
);

int bandIndex(float h) {
  return int(clamp(floor(h / BAND_HEIGHT), 0.0, float(BAND_COUNT - 1)));
}

vec3 bandAlbedo(float h, float lava) {
  vec3 col = PALETTE[bandIndex(h)];
  float lq = floor(clamp(lava, 0.0, 1.0) * 2.999) / 2.0; // 3 lava steps
  vec3 lavaCol = mix(vec3(0.42, 0.12, 0.05), vec3(0.95, 0.35, 0.08), lq);
  return mix(col, lavaCol, step(0.34, lq));
}

float quant(float x, float steps) {
  return floor(clamp(x, 0.0, 1.0) * steps) / (steps - 1.0);
}

vec3 shade(vec3 albedo, vec3 n, float depth, bool toon) {
  float d = max(dot(n, normalize(uLightDir)), 0.0);
  vec3 h = normalize(normalize(uLightDir) + vec3(0.0, 0.0, 1.0));
  float s = pow(max(dot(n, h), 0.0), 48.0);
  float f = 1.0 - exp(-depth * 0.0016);
  float ds, ss, fs;
  if (toon) {
    ds = quant(d, 4.0);
    ss = step(0.55, s) * 0.5;
    fs = clamp(floor(f * 3.0 + 0.5) / 2.0, 0.0, 1.0);
  } else {
    ds = d;
    ss = s * 0.5;
    fs = f;
  }
  vec3 col = albedo * (0.3 + 0.7 * ds) + vec3(ss);
  return mix(col, uFogColor, fs * 0.55);
}

// 8-tap edge test at a given pixel offset. Depth and band tests are one-sided
// (near side / lower band side only) so stroke width ~= offset, not 2x offset.
void edgeTest(vec2 uv, float off, int band0, out float depthEdge, out float normalEdge, out float bandEdge, out vec3 avgN) {
  vec2 tx = off / uResolution;
  vec4 c = texture(uNormalDepth, uv);
  float d0 = c.a;
  vec3 n0 = c.xyz;
  depthEdge = 0.0;
  normalEdge = 1.0;
  bandEdge = 0.0;
  avgN = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853982;
    vec2 suv = uv + vec2(cos(a), sin(a)) * tx;
    vec4 s = texture(uNormalDepth, suv);
    float di = s.a > 0.0 ? s.a : 1.0e6; // sky counts as far: closes the outer silhouette
    depthEdge = max(depthEdge, (di - d0) / (d0 * 0.02 + 1e-4));
    if (s.a > 0.0) {
      normalEdge = min(normalEdge, dot(n0, s.xyz));
      avgN += s.xyz;
      if (bandIndex(texture(uHeightLava, suv).x) > band0) bandEdge = 1.0;
    }
  }
  avgN /= 8.0;
}

void main() {
  vec4 af = texture(uAlbedoFlag, vUv);
  vec4 nd = texture(uNormalDepth, vUv);
  vec2 hl = texture(uHeightLava, vUv).xy;
  bool isTerrain = af.a > 0.5;
  bool isSky = nd.a <= 0.0;

  if (isSky) {
    fragColor = vec4(0.93, 0.96, 0.98, 1.0);
    return;
  }
  if (!isTerrain) {
    // Water baseline and any unstyled geometry pass through untouched.
    fragColor = (uMode == 3 || uMode == 4) ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(af.rgb, 1.0);
    return;
  }

  int band = bandIndex(hl.x);
  if (uMode == 3) {
    fragColor = vec4(float(band) / 8.0, 1.0, floor(clamp(hl.y, 0.0, 1.0) * 2.999) / 2.0, 1.0);
    return;
  }

  vec3 n = normalize(nd.xyz);
  float depth = nd.a;

  float deB, neB, beB, deF, neF, beF;
  vec3 avgB, avgF;
  edgeTest(vUv, 1.6, band, deB, neB, beB, avgB);
  edgeTest(vUv, 1.0, band, deF, neF, beF, avgF);
  float curvature = length(n - normalize(avgB));
  float steep = 1.0 - clamp(n.y, 0.0, 1.0);
  bool boldZone = curvature > 0.18 || steep > 0.42;
  bool boldLine = deB > 1.0 || (boldZone && neF < 0.80);
  // Gentle slopes: fine contour strokes along elevation-band boundaries
  // plus faint normal-crease lines \u2014 a distinct line type from bold peak strokes.
  bool fineLine = !boldLine && !boldZone && (neF < 0.92 || beF > 0.5);

  if (uMode == 4) {
    float cls = boldLine ? 1.0 : (fineLine ? 0.5 : 0.0);
    fragColor = vec4(cls, boldZone ? 0.5 : 0.0, 0.0, 1.0);
    return;
  }

  bool toon = uMode != 0;
  vec3 albedo = toon ? bandAlbedo(hl.x, hl.y) : af.rgb;
  vec3 col = shade(albedo, n, depth, toon);

  if (uMode == 2) {
    if (boldLine) col = vec3(0.16, 0.10, 0.07);
    else if (fineLine) col = mix(col, vec3(0.25, 0.22, 0.20), 0.55);
  }
  fragColor = vec4(col, 1.0);
}
`;

  // src/main.ts
  var LIGHT_DIR = [0.45, 0.75, 0.49];
  var FOG_COLOR = [0.87, 0.9, 0.93];
  var TARGET = [0, 12, 0];
  var Renderer = class {
    constructor(canvas2) {
      this.gb = null;
      this.canvas = canvas2;
      const gl = canvas2.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
      if (!gl) throw new Error("WebGL2 unavailable");
      if (!gl.getExtension("EXT_color_buffer_float")) {
        throw new Error("EXT_color_buffer_float unavailable");
      }
      this.gl = gl;
      this.geoProg = linkProgram(gl, GEO_VS, GEO_FS);
      this.shadeProg = linkProgram(gl, QUAD_VS, SHADE_FS);
      const mesh = buildTerrain(256);
      this.terrain = this.uploadMesh(mesh.positions, mesh.normals, mesh.heights, mesh.lava, mesh.indices);
      const water = buildWaterPlane();
      const waterNormals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
      const waterData = new Float32Array([-1, -1, -1, -1, -1, -1, -1, -1]);
      const waterHeights = new Float32Array(4).fill(-1);
      this.water = this.uploadMesh(water.positions, waterNormals, waterHeights, waterData, water.indices);
      this.quadVao = this.createQuad();
    }
    uploadMesh(positions, normals, heights, lava, indices) {
      const gl = this.gl;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const data = new Float32Array(positions.length / 3 * 8);
      for (let i = 0, v = 0; i < positions.length / 3; i++) {
        data[v++] = positions[i * 3];
        data[v++] = positions[i * 3 + 1];
        data[v++] = positions[i * 3 + 2];
        data[v++] = normals[i * 3];
        data[v++] = normals[i * 3 + 1];
        data[v++] = normals[i * 3 + 2];
        data[v++] = heights[i];
        data[v++] = lava[i];
      }
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const stride = 32;
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);
      const ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return { vao, count: indices.length };
    }
    createQuad() {
      const gl = this.gl;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      return vao;
    }
    render(opts) {
      const gl = this.gl;
      const { width, height } = opts;
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      if (this.gb && (this.gb.width !== width || this.gb.height !== height)) {
        destroyGBuffer(gl, this.gb);
        this.gb = null;
      }
      if (!this.gb) this.gb = createGBuffer(gl, width, height);
      const az = opts.azimuthDeg * Math.PI / 180;
      const el = opts.elevationDeg * Math.PI / 180;
      const eye = [
        TARGET[0] + opts.distance * Math.cos(el) * Math.sin(az),
        TARGET[1] + opts.distance * Math.sin(el),
        TARGET[2] + opts.distance * Math.cos(el) * Math.cos(az)
      ];
      const view = mat4LookAt(eye, TARGET, [0, 1, 0]);
      const proj = mat4Perspective(42 * Math.PI / 180, width / height, 1, 1200);
      const viewProj = mat4Multiply(proj, view);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.gb.fbo);
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.enable(gl.DEPTH_TEST);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.geoProg);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.geoProg, "uViewProj"), false, viewProj);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.geoProg, "uView"), false, view);
      gl.uniform1f(gl.getUniformLocation(this.geoProg, "uWaterLevel"), WATER_LEVEL);
      gl.bindVertexArray(this.water.vao);
      gl.drawElements(gl.TRIANGLES, this.water.count, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(this.terrain.vao);
      gl.drawElements(gl.TRIANGLES, this.terrain.count, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(this.shadeProg);
      const bindTex = (name, tex, unit) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(gl.getUniformLocation(this.shadeProg, name), unit);
      };
      bindTex("uAlbedoFlag", this.gb.albedoFlag, 0);
      bindTex("uNormalDepth", this.gb.normalDepth, 1);
      bindTex("uHeightLava", this.gb.heightLava, 2);
      gl.uniform2f(gl.getUniformLocation(this.shadeProg, "uResolution"), width, height);
      gl.uniform3fv(gl.getUniformLocation(this.shadeProg, "uLightDir"), LIGHT_DIR);
      gl.uniform3fv(gl.getUniformLocation(this.shadeProg, "uFogColor"), FOG_COLOR);
      gl.uniform1i(gl.getUniformLocation(this.shadeProg, "uMode"), opts.mode);
      gl.bindVertexArray(this.quadVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.finish();
    }
  };
  var canvas = document.getElementById("view");
  var renderer = new Renderer(canvas);
  window.__npr = {
    ready: true,
    render(opts) {
      renderer.render(opts);
      return canvas.toDataURL("image/png");
    }
  };
})();
