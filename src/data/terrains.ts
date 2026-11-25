import type { TerrainDef } from './schema';

/** Terrain types. M1 has only grass (plan 4.1). */
export const terrains: TerrainDef[] = [
  { id: 'grass', name: 'Grass', walkable: true, buildable: true, minimapColor: 0x4f7a32, variants: 4 },
];
