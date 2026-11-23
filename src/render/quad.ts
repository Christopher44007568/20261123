import { Mesh } from '../scene/mesh.js';

export function fullscreenQuad(): Mesh {
  return {
    positions: new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]),
    normals: new Float32Array(9),
    indices: new Uint32Array([0, 1, 2]),
  };
}
