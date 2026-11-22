/** Voxel material ids. 0 is always air. */
export const enum Mat {
  Air = 0,
  Salt = 1,
  SaltDark = 2,
  Stone = 3,
  Timber = 4,
  Metal = 5,
  Crate = 6,
}

export interface MaterialInfo {
  id: Mat;
  name: string;
  /** Linear-ish base RGB used by the final shaded program. */
  color: [number, number, number];
  /** Roughness factor for the simple lighting model. */
  roughness: number;
}

export const MATERIALS: Record<number, MaterialInfo> = {
  [Mat.Salt]: { id: Mat.Salt, name: 'salt', color: [0.83, 0.78, 0.7], roughness: 0.95 },
  [Mat.SaltDark]: { id: Mat.SaltDark, name: 'dark salt', color: [0.62, 0.55, 0.48], roughness: 1.0 },
  [Mat.Stone]: { id: Mat.Stone, name: 'rock', color: [0.32, 0.3, 0.31], roughness: 1.0 },
  [Mat.Timber]: { id: Mat.Timber, name: 'timber', color: [0.42, 0.27, 0.14], roughness: 0.9 },
  [Mat.Metal]: { id: Mat.Metal, name: 'metal', color: [0.45, 0.48, 0.52], roughness: 0.35 },
  [Mat.Crate]: { id: Mat.Crate, name: 'crate', color: [0.55, 0.4, 0.22], roughness: 0.85 },
};

/** Materials that participate in face meshing. */
export function isSolid(mat: number): boolean {
  return mat !== Mat.Air;
}
