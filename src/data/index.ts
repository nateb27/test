/**
 * Content registry: the single runtime entry point to all definitions.
 * Sim and client code import `registry` (or `createRegistry` in tests).
 */

import { ages } from './ages';
import { buildings } from './buildings';
import { byzantines } from './civs/byzantines';
import { combat } from './combat';
import { nodes } from './nodes';
import type {
  AgeDef,
  AnyDef,
  BuildingDef,
  CivDef,
  CombatRules,
  DataRegistry,
  NodeDef,
  ProducibleDef,
  StartingConditions,
  TechDef,
  TerrainDef,
  UnitDef,
} from './schema';
import { start } from './start';
import { techs } from './techs';
import { terrains } from './terrains';
import { units } from './units';

export type * from './schema';

/** Raw definition tables a registry is built from. */
export interface RegistryTables {
  units: readonly UnitDef[];
  buildings: readonly BuildingDef[];
  techs: readonly TechDef[];
  ages: readonly AgeDef[];
  civs: readonly CivDef[];
  nodes: readonly NodeDef[];
  terrains: readonly TerrainDef[];
  start: StartingConditions;
  combat: CombatRules;
}

function indexById<T extends { id: string }>(kind: string, list: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of list) {
    if (map.has(item.id)) throw new Error(`Duplicate ${kind} id: ${item.id}`);
    map.set(item.id, item);
  }
  return map;
}

function getOrThrow<T>(map: Map<string, T>, kind: string, id: string): T {
  const value = map.get(id);
  if (value === undefined) throw new Error(`Unknown ${kind} id: ${id}`);
  return value;
}

/** Build a registry from tables. Throws on duplicate ids (also across def kinds). */
export function createRegistry(tables: RegistryTables): DataRegistry {
  const unitMap = indexById('unit', tables.units);
  const buildingMap = indexById('building', tables.buildings);
  const techMap = indexById('tech', tables.techs);
  const civMap = indexById('civ', tables.civs);
  const nodeMap = indexById('node', tables.nodes);
  const terrainMap = indexById('terrain', tables.terrains);

  const defMap = new Map<string, AnyDef>();
  const all: AnyDef[] = [...tables.units, ...tables.buildings, ...tables.techs, ...tables.nodes];
  for (const def of all) {
    if (defMap.has(def.id)) throw new Error(`Def id used by two kinds: ${def.id}`);
    defMap.set(def.id, def);
  }

  return {
    units: tables.units,
    buildings: tables.buildings,
    techs: tables.techs,
    ages: tables.ages,
    civs: tables.civs,
    nodes: tables.nodes,
    terrains: tables.terrains,
    start: tables.start,
    combat: tables.combat,
    unit: (id) => getOrThrow(unitMap, 'unit', id),
    building: (id) => getOrThrow(buildingMap, 'building', id),
    tech: (id) => getOrThrow(techMap, 'tech', id),
    age: (age) => {
      const def = tables.ages.find((a) => a.age === age);
      if (def === undefined) throw new Error(`Unknown age: ${age}`);
      return def;
    },
    civ: (id) => getOrThrow(civMap, 'civ', id),
    node: (id) => getOrThrow(nodeMap, 'node', id),
    terrain: (id) => getOrThrow(terrainMap, 'terrain', id),
    def: (id) => defMap.get(id),
    producible: (id) => {
      const def = defMap.get(id);
      return def === undefined || def.kind === 'node' ? undefined : (def as ProducibleDef);
    },
  };
}

/** The game's content. */
export const registry: DataRegistry = createRegistry({
  units,
  buildings,
  techs,
  ages,
  civs: [byzantines],
  nodes,
  terrains,
  start,
  combat,
});
