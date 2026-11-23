import { v3 } from "./math.js";
const PLATE_LEN = 6.0; // arc length along U
const PLATE_W = 3.2; // width along Z
const BEND_SPAN = 1.15; // total bend angle (radians)
const BEND_R = PLATE_LEN / BEND_SPAN;
export function surfacePoint(u, v) {
    const theta = (u - 0.5) * BEND_SPAN;
    const s = Math.sin(theta), c = Math.cos(theta);
    // Gentle spanwise ripple so silhouettes are not perfectly clean.
    const ripple = 0.06 * Math.sin(v * Math.PI * 4 + u * 5.0);
    const r = BEND_R + ripple;
    const p = [r * s, r * (1 - c) - 0.0, (v - 0.5) * PLATE_W];
    const n = v3.norm([-s, c, 0.25 * Math.cos(v * Math.PI * 4 + u * 5.0)]);
    return { p, n };
}
export function buildBase(gridU = 160, gridV = 80) {
    const nu = gridU + 1, nv = gridV + 1;
    const positions = new Float32Array(nu * nv * 3);
    const normals = new Float32Array(nu * nv * 3);
    const uvs = new Float32Array(nu * nv * 2);
    let k = 0, k2 = 0;
    for (let j = 0; j < nv; j++) {
        for (let i = 0; i < nu; i++) {
            const u = i / gridU, v = j / gridV;
            const { p, n } = surfacePoint(u, v);
            positions[k] = p[0];
            positions[k + 1] = p[1];
            positions[k + 2] = p[2];
            normals[k] = n[0];
            normals[k + 1] = n[1];
            normals[k + 2] = n[2];
            k += 3;
            uvs[k2] = u;
            uvs[k2 + 1] = v;
            k2 += 2;
        }
    }
    const indices = new Uint32Array(gridU * gridV * 6);
    let q = 0;
    for (let j = 0; j < gridV; j++) {
        for (let i = 0; i < gridU; i++) {
            const a = j * nu + i, b = a + 1, c = a + nu, d = c + 1;
            indices[q++] = a;
            indices[q++] = c;
            indices[q++] = b;
            indices[q++] = b;
            indices[q++] = c;
            indices[q++] = d;
        }
    }
    return { positions, normals, uvs, indices, gridU, gridV, sample: surfacePoint };
}
//# sourceMappingURL=base.js.map