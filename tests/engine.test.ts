import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoxelWorld } from '../src/world/VoxelWorld.js';
import { SparseOctree, DEFAULT_LOD } from '../src/engine/Octree.js';
import { Mesher } from '../src/engine/Mesher.js';
import { RayPicker } from '../src/engine/RayPicker.js';
import { FIXED_SEED } from '../src/core/rng.js';
import { isSolid } from '../src/world/materials.js';

function buildContext() {
  const world = new VoxelWorld(FIXED_SEED);
  const octree = new SparseOctree(world);
  const mesher = new Mesher(world);
  const picker = new RayPicker(world);
  return { world, octree, mesher, picker };
}

test('world generation is deterministic for the fixed seed', () => {
  const a = new VoxelWorld(FIXED_SEED);
  const b = new VoxelWorld(FIXED_SEED);
  assert.equal(a.countSolid(), b.countSolid());
  assert.ok(a.countSolid() > 100_000);
  const probes: Array<[number, number, number]> = [
    [64, 50, 64], [10, 80, 10], [64, 5, 64], [100, 90, 30], [20, 20, 20],
  ];
  for (const [x, y, z] of probes) {
    assert.equal(a.get(x, y, z), b.get(x, y, z));
  }
});

test('mine contains every required structure', () => {
  const { world } = buildContext();
  // Main shaft: open column near the center.
  assert.equal(world.solidAt(64, 50, 64), false);
  // Surface headframe posts.
  assert.ok(world.solidAt(74, 100, 74));
  // Storage level floor is carved.
  assert.equal(world.solidAt(90, 82, 64), false);
  // Salt pillars remain inside the storage room.
  let pillarFound = false;
  for (let x = 60; x < 110; x += 1) {
    if (world.solidAt(x, 83, 64)) {
      pillarFound = true;
    }
  }
  assert.ok(pillarFound);
  // Bottom layer rock.
  assert.ok(world.solidAt(30, 2, 30));
});

test('octree leaves satisfy the neighbor LOD difference limit', () => {
  const { octree, mesher } = buildContext();
  const focusPoints = [
    { x: 64, y: 100, z: 90 },
    { x: 64, y: 60, z: 64 },
    { x: 64, y: 12, z: 64 },
    { x: 20, y: 40, z: 100 },
  ];
  for (const focus of focusPoints) {
    octree.update(focus, DEFAULT_LOD, (n) => mesher.countExposedFaces(n));
    const violations = octree.validateNeighborDiff(DEFAULT_LOD.maxNeighborLodDiff);
    assert.equal(violations.length, 0,
      `LOD neighbor violations: ${violations
        .map((v) => `(${v.a.x},${v.a.y},${v.a.z})d${v.a.depth} vs d${v.b.depth}`)
        .join('; ')}`);
  }
});

test('per-node face budget is respected', () => {
  const { octree, mesher } = buildContext();
  const leaves = octree.update(
    { x: 64, y: 50, z: 64 },
    DEFAULT_LOD,
    (n) => mesher.countExposedFaces(n),
  );
  for (const leaf of leaves) {
    if (leaf.kind === 'air' || leaf.size <= DEFAULT_LOD.minLeafSize) {
      continue;
    }
    const faces = mesher.countExposedFaces(leaf);
    assert.ok(
      faces <= DEFAULT_LOD.maxNodeFaces,
      `leaf (${leaf.x},${leaf.y},${leaf.z}) size ${leaf.size} has ${faces} faces`,
    );
  }
});

test('merged leaf meshes cover every exposed voxel face exactly once', () => {
  const { octree, mesher } = buildContext();
  const leaves = octree.update(
    { x: 64, y: 50, z: 64 },
    DEFAULT_LOD,
    (n) => mesher.countExposedFaces(n),
  );
  let expectedFaces = 0;
  let mergedFaces = 0;
  for (const leaf of leaves) {
    expectedFaces += mesher.countExposedFaces(leaf);
    mergedFaces += mesher.buildLeafMesh(leaf).faceCount;
  }
  assert.ok(expectedFaces > 0);
  assert.equal(mergedFaces, expectedFaces);
});

test('every solid voxel face on a leaf boundary is emitted (no holes)', () => {
  const { world, octree, mesher } = buildContext();
  const leaves = octree.update(
    { x: 30, y: 30, z: 80 },
    DEFAULT_LOD,
    (n) => mesher.countExposedFaces(n),
  );
  const covered = new Set<string>();
  for (const leaf of leaves) {
    const data = mesher.buildLeafMesh(leaf);
    for (const quad of data.quads) {
      const uAxis = (quad.axis + 1) % 3;
      const vAxis = (quad.axis + 2) % 3;
      for (let du = 0; du < quad.width; du += 1) {
        for (let dv = 0; dv < quad.height; dv += 1) {
          const p = [quad.x, quad.y, quad.z];
          p[uAxis] += du;
          p[vAxis] += dv;
          covered.add(`${quad.axis}:${quad.sign}:${p[0]},${p[1]},${p[2]}`);
        }
      }
    }
  }

  // Probe exposed solid shell voxels around the shaft and storage rooms.
  const probes: Array<[number, number, number]> = [];
  for (let y = 8; y < 92; y += 7) {
    for (let x = 40; x < 88; x += 2) {
      for (let z = 40; z < 88; z += 2) {
        if (isSolid(world.get(x, y, z))) {
          probes.push([x, y, z]);
        }
      }
    }
  }
  // Also walk a storage level so horizontal LOD transitions are covered.
  for (let x = 24; x < 108; x += 3) {
    for (let z = 58; z < 72; z += 3) {
      if (isSolid(world.get(x, 81, z))) {
        probes.push([x, 81, z]);
      }
    }
  }
  let checked = 0;
  for (const [x, y, z] of probes) {
    if (!isSolid(world.get(x, y, z))) {
      continue;
    }
    const dirs = [
      [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    ];
    for (const [dx, dy, dz] of dirs) {
      if (isSolid(world.get(x + dx, y + dy, z + dz))) {
        continue;
      }
      const axis = dx !== 0 ? 0 : dy !== 0 ? 1 : 2;
      const sign = ([dx, dy, dz][axis]) > 0 ? 1 : -1;
      // Quad anchor sits at the empty-side plane of the solid voxel.
      const faceVoxel = [x, y, z];
      faceVoxel[axis] = faceVoxel[axis] + (sign === 1 ? 1 : 0);
      const key = `${axis}:${sign}:${faceVoxel[0]},${faceVoxel[1]},${faceVoxel[2]}`;
      assert.ok(covered.has(key), `missing face ${key}`);
      checked += 1;
    }
  }
  assert.ok(checked > 500);
});

test('leaf boxes across LOD boundaries stay lattice aligned (no cracks)', () => {
  const { octree, mesher } = buildContext();
  octree.update(
    { x: 64, y: 50, z: 64 },
    DEFAULT_LOD,
    (n) => mesher.countExposedFaces(n),
  );
  const leaves = octree.collectLeaves().filter((n) => n.kind !== 'air');
  for (const leaf of leaves) {
    // Every leaf origin must be aligned to its own size, hence every leaf
    // face lies on a shared power-of-two grid line with its neighbors.
    assert.equal(leaf.x % leaf.size, 0, `x alignment at (${leaf.x},${leaf.y},${leaf.z})`);
    assert.equal(leaf.y % leaf.size, 0, `y alignment at (${leaf.x},${leaf.y},${leaf.z})`);
    assert.equal(leaf.z % leaf.size, 0, `z alignment at (${leaf.x},${leaf.y},${leaf.z})`);
  }

  // Every emitted quad must sit on an integer plane and cover integer cells.
  let sampled = 0;
  for (const leaf of leaves) {
    if (sampled > 2000) {
      break;
    }
    for (const quad of mesher.buildLeafMesh(leaf).quads) {
      assert.ok(Number.isInteger(quad.x) && Number.isInteger(quad.y) && Number.isInteger(quad.z));
      assert.ok(quad.width > 0 && quad.height > 0);
      sampled += 1;
    }
  }
  assert.ok(sampled > 500);
});

test('ray picking returns identical voxels across LOD changes', () => {
  const { octree, mesher, picker } = buildContext();
  const origin = { x: 64, y: 84, z: 84 };
  const dir = { x: 0, y: -0.45, z: -0.89 };
  const len = Math.hypot(dir.x, dir.y, dir.z);
  const ray = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
  const expected = picker.pick(origin, ray);
  assert.ok(expected !== null);
  const expectedVoxel = expected.voxel;
  const expectedMaterial = expected.material;

  const lodConfigs = [
    { ...DEFAULT_LOD, lodScale: 1.0 },
    { ...DEFAULT_LOD, lodScale: 2.4 },
    { ...DEFAULT_LOD, lodScale: 5.5, maxNodeFaces: 256 },
    { ...DEFAULT_LOD, maxNodeFaces: 4096, minLeafSize: 8 },
  ];
  for (const lod of lodConfigs) {
    octree.update(origin, lod, (n) => mesher.countExposedFaces(n));
    const pick = picker.pick(origin, ray);
    assert.deepEqual(pick?.voxel, expectedVoxel);
    assert.equal(pick?.material, expectedMaterial);
  }
});

test('subdivide and collapse reuse node keys without coordinate drift', () => {
  const { octree, mesher } = buildContext();
  const before = octree.update(
    { x: 64, y: 90, z: 64 },
    DEFAULT_LOD,
    (n) => mesher.countExposedFaces(n),
  );
  const snapshot = before
    .filter((n) => n.kind !== 'air')
    .map((n) => ({ x: n.x, y: n.y, z: n.z, size: n.size }))
    .sort((a, b) => a.size - b.size || a.x - b.x || a.y - b.y || a.z - b.z);

  const far = octree.update(
    { x: 4, y: 4, z: 4 },
    { ...DEFAULT_LOD, lodScale: 5.5 },
    (n) => mesher.countExposedFaces(n),
  );
  const back = octree.update(
    { x: 64, y: 90, z: 64 },
    DEFAULT_LOD,
    (n) => mesher.countExposedFaces(n),
  );
  const restored = back
    .filter((n) => n.kind !== 'air')
    .map((n) => ({ x: n.x, y: n.y, z: n.z, size: n.size }))
    .sort((a, b) => a.size - b.size || a.x - b.x || a.y - b.y || a.z - b.z);
  assert.ok(far.length !== before.length);
  assert.deepEqual(restored, snapshot);
});
