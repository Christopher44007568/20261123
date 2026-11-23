export type Vec3 = [number, number, number];

export const MaterialKind = {
  matte: 0,
  asphalt: 1,
  concrete: 2,
  metal: 3,
  emissive: 4,
  rubber: 5,
  paint: 6,
  glass: 7,
} as const;

export interface Light {
  position: Vec3;
  color: Vec3;
  intensity: number;
  range: number;
  warm: boolean;
}

export interface Occluder {
  min: Vec3;
  max: Vec3;
}

export interface Material {
  color: Vec3;
  roughness: number;
  metalness: number;
  emission?: Vec3;
  kind?: number;
}

export interface SceneData {
  vertices: Float32Array;
  indices: Uint32Array;
  lights: Light[];
  occluders: Occluder[];
  triangleCount: number;
}
