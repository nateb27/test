/**
 * THE CONTENT CONTRACT.
 *
 * Shapes of every content definition. Do not edit in a work package branch:
 * request changes from the orchestrator (see CLAUDE.md).
 *
 * Conventions:
 * - Every def id is unique across ALL def kinds (units, buildings, techs, nodes),
 *   so `registry.def(id)` is unambiguous. Ids are lowerCamelCase.
 * - Durations are seconds, rates are per second, speeds are tiles per second.
 *   No tick counts in data.
 * - Costs are whole numbers. Resolved (modified) costs are rounded with Math.round.
 * - Footprints are square; `footprint` is the side length in tiles.
 * - Data files may import only types (from here and `src/sim/types`).
 */

import type {
  AgeNumber,
  BuildingId,
  CivId,
  DefId,
  GatherKind,
  NodeTypeId,
  ProducibleId,
  ResourceAmounts,
  ResourceType,
  StatKey,
  TechId,
  TerrainId,
  UnitId,
} from '../sim/types';

export type {
  AgeNumber,
  BuildingId,
  CivId,
  DefId,
  GatherKind,
  NodeTypeId,
  ProducibleId,
  ResourceAmounts,
  ResourceType,
  StatKey,
  TechId,
  TerrainId,
  UnitId,
};

/** A cost: missing resources mean 0. Whole numbers >= 0. */
export type Cost = Partial<ResourceAmounts>;

/**
 * Id of a world sprite in the AssetManifest. Convention: `'<kind>.<defId>'`,
 * e.g. `'unit.villager'`, `'building.house'`, `'node.tree'`.
 */
export type SpriteId = string;

/**
 * Id of a HUD icon in the AssetManifest. Convention: `'icon.<kind>.<id>'`,
 * e.g. `'icon.unit.villager'`, `'icon.tech.handCarts'`, `'icon.resource.wood'`.
 */
export type IconId = string;

/**
 * Tags group defs for modifiers and for UI. Closed set: adding one is a
 * contract change.
 */
export type Tag =
  // units
  | 'villager'
  | 'military'
  | 'infantry'
  | 'archer'
  | 'cavalry'
  | 'siege'
  // buildings
  | 'townCenter'
  | 'house'
  | 'dropOff'
  | 'farm'
  | 'economy'
  | 'production'
  | 'incomeBuilding'
  // techs
  | 'ageAdvance'
  | 'gatherTech'
  // any
  | 'unique';

/**
 * A data-driven stat change.
 * - `select` matches a def if its id is in `ids` OR it carries at least one of
 *   `tags`. At least one of the two must be non-empty.
 * - Resolution per stat: base -> civ modifiers -> researched tech modifiers;
 *   all `add` modifiers are summed first, then all `mul` factors applied.
 */
export interface Modifier {
  select: { ids?: DefId[]; tags?: Tag[] };
  stat: StatKey;
  op: 'add' | 'mul';
  value: number;
}

/** Provisional combat stats. Present in data, unused by every M1 system. */
export interface UnitCombatStats {
  hp: number;
  attack: number;
  armor: number;
  /** Tiles. 0 for melee. */
  range: number;
}

export interface BuildingCombatStats {
  hp: number;
  armor: number;
}

/** Fields shared by every producible def (units, buildings, techs). */
export interface ProducibleDefBase {
  id: ProducibleId;
  name: string;
  /** One or two sentences for tooltips. */
  description: string;
  /** Age in which it becomes available. */
  age: AgeNumber;
  tags: Tag[];
  cost: Cost;
  /** Completed building types the player must own (any one instance each). */
  requiresBuildings?: BuildingId[];
  /** Techs the player must have researched. */
  requiresTechs?: TechId[];
  /** If present, only these civs can ever have it. */
  civs?: CivId[];
  /**
   * For civs that can have this def, the replaced def is hidden and
   * unavailable (e.g. Cataphract replaces Lancer for the Byzantines).
   */
  replaces?: ProducibleId;
  icon: IconId;
  /**
   * Preferred command card slot, 0..14 row-major in the 3x5 grid
   * (QWERT / ASDFG / ZXCVB). If absent, the HUD fills slots in data order.
   */
  cardSlot?: number;
}

/** Villager-style gathering ability. */
export interface GatherAbility {
  /** Base rate per second for each kind this unit can gather. Absent kinds cannot be gathered. */
  rates: Partial<Record<GatherKind, number>>;
  /** Units of resource carried before returning to a drop-off. */
  carryCapacity: number;
}

export interface UnitDef extends ProducibleDefBase {
  kind: 'unit';
  id: UnitId;
  /** Seconds to train. */
  trainTime: number;
  /** Population used while alive or queued. */
  popCost: number;
  /** Tiles per second. */
  speed: number;
  /** Present only for units that gather (villagers). */
  gather?: GatherAbility;
  /** Buildings this unit can construct (villagers). Absent/empty: cannot build. */
  builds?: BuildingId[];
  combat: UnitCombatStats;
  sprite: SpriteId;
}

/** A building that also acts as an infinite resource node (the Farm). */
export interface FarmAbility {
  resource: ResourceType;
  gatherKind: GatherKind;
  maxGatherers: number;
}

export interface BuildingDef extends ProducibleDefBase {
  kind: 'building';
  id: BuildingId;
  /** Square footprint side length in tiles. */
  footprint: number;
  /** Blocks pathing (from foundation placement onward). Farms do not. */
  blocking: boolean;
  /** `false` for buildings that cannot be placed by players (the Town Center in M1). */
  buildable: boolean;
  /** Seconds for one builder. */
  buildTime: number;
  /** Population capacity provided when completed. */
  popProvided: number;
  /** Resources that can be deposited here when completed. Empty: not a drop-off. */
  dropOff: ResourceType[];
  /** Units this building can train, in command card order. */
  trains: UnitId[];
  /** Techs (including age advances) researched here, in command card order. */
  researches: TechId[];
  /** Passive income while completed. */
  income?: { resource: ResourceType; perSecond: number };
  /** Max instances (including foundations) a player may own. */
  buildLimit?: number;
  /** Counts toward the "2 distinct buildings of the current age" age-advance rule. */
  countsTowardAge: boolean;
  /** Present for farm-like buildings. */
  farm?: FarmAbility;
  /** Command card page in the villager build menu. */
  buildMenu: 'economy' | 'military' | 'none';
  combat: BuildingCombatStats;
  sprite: SpriteId;
}

export interface TechDef extends ProducibleDefBase {
  kind: 'tech';
  id: TechId;
  /** Seconds to research. */
  researchTime: number;
  /** Modifiers applied to the researching player once completed. */
  effects: Modifier[];
  /** If set, this tech is an age advance and completing it sets `player.age` to this. */
  advancesTo?: AgeNumber;
  /**
   * Age advance requirement: completed buildings with `countsTowardAge` whose
   * `age` equals the player's current age, counted by distinct type.
   */
  requiresAgeBuildings?: number;
}

export interface AgeDef {
  age: AgeNumber;
  name: string;
  /** The tech that advances INTO this age; `null` for age 1. */
  advanceTech: TechId | null;
  icon: IconId;
}

export interface CivBonus {
  name: string;
  description: string;
  modifiers: Modifier[];
}

export interface CivDef {
  id: CivId;
  name: string;
  description: string;
  /** Team colour palette, 0xRRGGBB. `primary` is the player colour. */
  palette: { primary: number; secondary: number };
  bonuses: CivBonus[];
  /** Unique defs to list on the civ select panel (they also declare `civs`). */
  uniques: ProducibleId[];
  icon: IconId;
}

export interface NodeDef {
  kind: 'node';
  id: NodeTypeId;
  name: string;
  resource: ResourceType;
  gatherKind: GatherKind;
  /** Starting amount (integer). */
  amount: number;
  /** Square footprint side length in tiles. */
  footprint: number;
  blocking: boolean;
  /** Max simultaneous gatherers. */
  maxGatherers: number;
  minimapColor: number;
  sprite: SpriteId;
  icon: IconId;
}

export interface TerrainDef {
  id: TerrainId;
  name: string;
  walkable: boolean;
  buildable: boolean;
  minimapColor: number;
  /** Number of seeded visual variants the renderer may pick between. */
  variants: number;
}

/** Match start conditions shared by all civs. */
export interface StartingConditions {
  resources: ResourceAmounts;
  /** Building placed at the start position (the Town Center). */
  centerBuilding: BuildingId;
  units: { unitType: UnitId; count: number }[];
}

export type AnyDef = UnitDef | BuildingDef | TechDef | NodeDef;
export type ProducibleDef = UnitDef | BuildingDef | TechDef;

/**
 * Read-only access to all content. Implemented by `src/data/index.ts`.
 * `unit`/`building`/... throw on an unknown id; `def` returns undefined.
 * The list properties are in data-file order, which is display order.
 */
export interface DataRegistry {
  readonly units: readonly UnitDef[];
  readonly buildings: readonly BuildingDef[];
  readonly techs: readonly TechDef[];
  /** Exactly four entries, ages 1..4 in order. */
  readonly ages: readonly AgeDef[];
  readonly civs: readonly CivDef[];
  readonly nodes: readonly NodeDef[];
  readonly terrains: readonly TerrainDef[];
  readonly start: StartingConditions;

  unit(id: UnitId): UnitDef;
  building(id: BuildingId): BuildingDef;
  tech(id: TechId): TechDef;
  age(age: AgeNumber): AgeDef;
  civ(id: CivId): CivDef;
  node(id: NodeTypeId): NodeDef;
  terrain(id: TerrainId): TerrainDef;
  /** Any unit/building/tech/node def by id. */
  def(id: DefId): AnyDef | undefined;
  /** Unit/building/tech def by id. */
  producible(id: ProducibleId): ProducibleDef | undefined;
}
