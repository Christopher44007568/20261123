import { FIXED_SEED, hash3, mulberry32, randInt, valueNoise3 } from '../core/rng.js';
import { Mat, isSolid } from './materials.js';

/** Axis aligned bounding box of the mine volume, in voxel units. */
export interface Bounds {
  minX: number;
  minY: number;
  minZ: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
}

const CHUNK_BITS = 5;
const CHUNK_SIZE = 1 << CHUNK_BITS;
const CHUNK_MASK = CHUNK_SIZE - 1;

/**
 * Fixed-seed voxel mine.
 *
 * Coordinate system: Y is up. The world is a 128^3 cube with the surface at
 * y = 96; everything above the surface is open air, everything below starts
 * as solid salt and is carved into shaft / levels / ramps by the generator.
 */
export class VoxelWorld {
  readonly seed: number;
  readonly bounds: Bounds;
  readonly surfaceY: number;
  private readonly chunks = new Map<number, Uint8Array>();

  constructor(seed = FIXED_SEED, size = 128, surfaceY = 96) {
    if ((size & (size - 1)) !== 0) {
      throw new Error('world size must be a power of two');
    }
    this.seed = seed;
    this.surfaceY = surfaceY;
    this.bounds = { minX: 0, minY: 0, minZ: 0, sizeX: size, sizeY: size, sizeZ: size };
    this.generate();
  }

  get size(): number {
    return this.bounds.sizeX;
  }

  private static chunkKey(cx: number, cy: number, cz: number): number {
    return (cx & 0x3ff) | ((cy & 0x3ff) << 10) | ((cz & 0x3ff) << 20);
  }

  private chunkAt(cx: number, cy: number, cz: number, create: boolean): Uint8Array | undefined {
    const key = VoxelWorld.chunkKey(cx, cy, cz);
    let chunk = this.chunks.get(key);
    if (chunk === undefined && create) {
      chunk = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  inBounds(x: number, y: number, z: number): boolean {
    const b = this.bounds;
    return (
      x >= b.minX && x < b.minX + b.sizeX &&
      y >= b.minY && y < b.minY + b.sizeY &&
      z >= b.minZ && z < b.minZ + b.sizeZ
    );
  }

  get(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) {
      return Mat.Air;
    }
    const chunk = this.chunkAt(x >> CHUNK_BITS, y >> CHUNK_BITS, z >> CHUNK_BITS, false);
    if (chunk === undefined) {
      return Mat.Air;
    }
    const lx = x & CHUNK_MASK;
    const ly = y & CHUNK_MASK;
    const lz = z & CHUNK_MASK;
    return chunk[(lx << (2 * CHUNK_BITS)) | (ly << CHUNK_BITS) | lz];
  }

  set(x: number, y: number, z: number, mat: Mat): void {
    if (!this.inBounds(x, y, z)) {
      return;
    }
    const chunk = this.chunkAt(x >> CHUNK_BITS, y >> CHUNK_BITS, z >> CHUNK_BITS, true)!;
    const lx = x & CHUNK_MASK;
    const ly = y & CHUNK_MASK;
    const lz = z & CHUNK_MASK;
    chunk[(lx << (2 * CHUNK_BITS)) | (ly << CHUNK_BITS) | lz] = mat;
  }

  solidAt(x: number, y: number, z: number): boolean {
    return isSolid(this.get(x, y, z));
  }

  private fillBox(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    mat: Mat,
  ): void {
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        for (let z = z0; z <= z1; z += 1) {
          this.set(x, y, z, mat);
        }
      }
    }
  }

  private carveBox(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
  ): void {
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        for (let z = z0; z <= z1; z += 1) {
          this.set(x, y, z, Mat.Air);
        }
      }
    }
  }

  /**
   * Builds the whole mine from {@link FIXED_SEED}. No external assets are
   * read; every structure is the result of these deterministic steps.
   */
  private generate(): void {
    const n = this.size;
    const half = n >> 1;
    const rand = mulberry32(this.seed);

    this.carveOpenSky(n);
    this.stratifySalt(n);
    this.carveMainShaft(half);
    this.carveStorageLevels(half, rand);
    this.carveRamp(half);
    this.buildShaftLining(half);
    this.placeLift(half, rand);
    this.scatterCrates(half, rand);
  }

  /** Everything above the surface is air; below is solid salt by default. */
  private carveOpenSky(n: number): void {
    for (let x = 0; x < n; x += 1) {
      for (let z = 0; z < n; z += 1) {
        for (let y = this.surfaceY; y < n; y += 1) {
          this.set(x, y, z, Mat.Air);
        }
      }
    }
  }

  /** Layered salt / dark-salt / stone bands plus low frequency noise. */
  private stratifySalt(n: number): void {
    for (let x = 0; x < n; x += 1) {
      for (let z = 0; z < n; z += 1) {
        for (let y = 0; y < this.surfaceY; y += 1) {
          const band = valueNoise3(this.seed ^ 0x1234, x * 0.09, y * 0.18, z * 0.09, 16);
          let mat: Mat = Mat.Salt;
          if (y < 10) {
            mat = Mat.Stone;
          } else if (band < 0.32) {
            mat = Mat.SaltDark;
          }
          if (hash3(this.seed ^ 0x9e37, x, y, z) < 0.03) {
            mat = mat === Mat.Salt ? Mat.SaltDark : Mat.Salt;
          }
          this.set(x, y, z, mat);
        }
      }
    }
  }
  private carveMainShaft(half: number): void {
    const r = 7;
    for (let x = half - r; x <= half + r; x += 1) {
      for (let z = half - r; z <= half + r; z += 1) {
        for (let y = 1; y <= this.surfaceY; y += 1) {
          const dx = x - half;
          const dz = z - half;
          if (dx * dx + dz * dz <= r * r) {
            this.set(x, y, z, Mat.Air);
          }
        }
      }
    }
  }

  /** Horizontal levels at different depths, each with salt pillar rows. */
  private carveStorageLevels(half: number, rand: () => number): void {
    const floors = [80, 58, 36, 14];
    const reach = 44;
    for (const floorY of floors) {
      const height = 6;
      this.carveBox(half - reach, floorY, half - 5, half + reach, floorY + height, half + 5);
      this.carveBox(half - 5, floorY, half - reach, half + 5, floorY + height, half + reach);

      const pitch = 12;
      for (let off = 18; off < reach - 4; off += pitch) {
        for (const sx of [-1, 1]) {
          this.carveAroundPillar(half + sx * off, floorY, half, height);
          this.carveAroundPillar(half, floorY, half + sx * off, height);
        }
      }

      // Timber reinforcement ring around the shaft junction.
      this.lineJunction(half, floorY, height);

      // A few short side drifts make each level depth distinct.
      const driftCount = 2 + (floorY % 2);
      for (let i = 0; i < driftCount; i += 1) {
        const along = randInt(rand, 20, reach - 8);
        const side = rand() < 0.5 ? -1 : 1;
        this.carveBox(
          half - 3, floorY + 1, half + side * along,
          half + 3, floorY + 4, half + side * (along + randInt(rand, 6, 10)),
        );
      }
    }
  }

  /** Salt pillars are 3x3 columns left inside an otherwise carved room. */
  private carveAroundPillar(px: number, py: number, pz: number, height: number): void {
    this.fillBox(px - 1, py + 1, pz - 1, px + 1, py + height, pz + 1, Mat.Salt);
    for (let y = py + 1; y <= py + height; y += 2) {
      this.set(px - 1, y, pz - 1, Mat.Timber);
      this.set(px + 1, y, pz + 1, Mat.Timber);
    }
  }

  private lineJunction(half: number, floorY: number, height: number): void {
    for (let y = floorY; y <= floorY + height + 1; y += 1) {
      for (let t = -8; t <= 8; t += 1) {
        if (Math.abs(t) === 8) {
          this.set(half + t, y, half - 6, Mat.Timber);
          this.set(half + t, y, half + 6, Mat.Timber);
          this.set(half - 6, y, half + t, Mat.Timber);
          this.set(half + 6, y, half + t, Mat.Timber);
        }
      }
    }
  }

  /**
   * Helical inclined ramp wrapped around the main shaft. The tunnel follows
   * angle -> height mapping so one full turn covers one storage-level gap.
   */
  private carveRamp(half: number): void {
    const radius = 20;
    const yTop = 88;
    const yBottom = 6;
    const turns = 2.25;
    const steps = 420;
    const tunnelR = 2;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const angle = t * turns * Math.PI * 2;
      const cx = half + Math.cos(angle) * radius;
      const cz = half + Math.sin(angle) * radius;
      const cy = yTop + (yBottom - yTop) * t;
      for (let dx = -tunnelR; dx <= tunnelR; dx += 1) {
        for (let dz = -tunnelR; dz <= tunnelR; dz += 1) {
          for (let dy = -2; dy <= 2; dy += 1) {
            if (dx * dx + dz * dz <= tunnelR * tunnelR + 1) {
              const x = Math.round(cx) + dx;
              const z = Math.round(cz) + dz;
              const y = Math.round(cy) + dy;
              if (this.inBounds(x, y, z)) {
                this.set(x, y, z, Mat.Air);
              }
            }
          }
        }
      }
      // Wooden guide rail on the outer wall.
      const rx = Math.round(half + Math.cos(angle) * (radius + tunnelR));
      const rz = Math.round(half + Math.sin(angle) * (radius + tunnelR));
      this.set(rx, Math.round(cy) + 2, rz, Mat.Timber);
    }
  }
  /** Timber / steel support rings plus the surface headframe floor. */
  private buildShaftLining(half: number): void {
    const r = 8;
    for (let y = 4; y < this.surfaceY; y += 4) {
      for (let a = 0; a < 64; a += 1) {
        const angle = (a / 64) * Math.PI * 2;
        const x = half + Math.round(Math.cos(angle) * r);
        const z = half + Math.round(Math.sin(angle) * r);
        this.set(x, y, z, y % 8 === 4 ? Mat.Metal : Mat.Timber);
      }
    }
    // Surface storage floor around the shaft opening.
    for (let x = half - 14; x <= half + 14; x += 1) {
      for (let z = half - 14; z <= half + 14; z += 1) {
        const dx = x - half;
        const dz = z - half;
        if (dx * dx + dz * dz > 64) {
          this.set(x, this.surfaceY, z, Mat.Timber);
        }
      }
    }
    // Headframe posts.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.fillBox(half + sx * 10, this.surfaceY, half + sz * 10,
          half + sx * 10, this.surfaceY + 9, half + sz * 10, Mat.Metal);
      }
    }
  }

  /** Lift cage platform and vertical guide rails at a fixed resting level. */
  private placeLift(half: number, rand: () => number): void {
    const restY = 60;
    this.fillBox(half - 3, restY, half - 3, half + 3, restY, half + 3, Mat.Metal);
    this.fillBox(half - 3, restY + 1, half - 3, half + 3, restY + 3, half - 3, Mat.Metal);
    this.fillBox(half - 3, restY + 1, half + 3, half + 3, restY + 3, half + 3, Mat.Metal);
    // Two continuous guide rails.
    for (let y = restY + 1; y <= this.surfaceY + 4; y += 1) {
      this.set(half - 4, y, half - 4, Mat.Metal);
      this.set(half + 4, y, half + 4, Mat.Metal);
    }
    // Deterministic cargo on the cage.
    if (rand() > 0.25) {
      this.fillBox(half - 2, restY + 1, half - 2, half, restY + 2, half, Mat.Crate);
    }
  }

  /** Storage crates scattered deterministically on every level. */
  private scatterCrates(half: number, rand: () => number): void {
    const floors = [80, 58, 36, 14];
    for (const floorY of floors) {
      const count = randInt(rand, 4, 7);
      for (let i = 0; i < count; i += 1) {
        const axis = rand() < 0.5;
        const dist = randInt(rand, 12, 36);
        const side = rand() < 0.5 ? -1 : 1;
        const cx = axis ? half + side * dist : half + randInt(rand, -3, 3);
        const cz = axis ? half + randInt(rand, -3, 3) : half + side * dist;
        this.fillBox(cx, floorY + 1, cz, cx + 1, floorY + 2, cz + 1, Mat.Crate);
      }
    }
  }

  /** Number of solid voxels, mainly used in diagnostics. */
  countSolid(): number {
    let total = 0;
    for (const chunk of this.chunks.values()) {
      for (let i = 0; i < chunk.length; i += 1) {
        if (chunk[i] !== Mat.Air) {
          total += 1;
        }
      }
    }
    return total;
  }
}
