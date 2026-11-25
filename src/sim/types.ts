/**
 * THE SIMULATION CONTRACT.
 *
 * Every work package builds against this file. Do not edit it in a work
 * package branch: request changes from the orchestrator (see CLAUDE.md).
 *
 * Rules that apply to everything declared here:
 * - All state is plain JSON data: no classes, functions, Map/Set, typed arrays,
 *   `undefined` values, NaN, Infinity or -0. Optional properties are never
 *   used inside GameState; absent values are `null`.
 * - World positions are in tiles (floats). Tile `(tx, ty)` covers
 *   `[tx, tx+1) x [ty, ty+1)`. Tile index = `ty * map.width + tx`.
 * - Durations in data are seconds; the sim converts with TICK_RATE.
 * - Arrays of entity ids stored in state are kept sorted ascending.
 */

import type { DataRegistry } from '../data/schema';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Simulation ticks per second of game time. */
export const TICK_RATE = 20;
/** Milliseconds of game time per tick (1000 / TICK_RATE). */
export const TICK_MS = 1000 / TICK_RATE;
/** Width of one tile diamond on screen at 1x zoom, in CSS pixels. */
export const TILE_W = 64;
/** Height of one tile diamond on screen at 1x zoom, in CSS pixels. */
export const TILE_H = 32;
/** Default (and in M1, only) map side length in tiles. Maps are square. */
export const MAP_SIZE = 120;
/** Population cap can never exceed this, whatever buildings provide. */
export const POP_HARD_CAP = 200;
/** Player id of the neutral owner of resource nodes. Always `players[0]`. */
export const NEUTRAL_PLAYER_ID = 0;
/** Maximum items (units and techs combined) in one building's queue. */
export const MAX_PRODUCTION_QUEUE = 10;
/** Pathfinding budget per tick, counted in A* node expansions. */
export const PATH_BUDGET_PER_TICK = 20_000;
/** Idle units closer than this many tiles push apart. */
export const SEPARATION_RADIUS = 0.3;
/** Radius (tiles) of a unit for picking (`entityAtPoint`) and rect queries. */
export const UNIT_PICK_RADIUS = 0.4;
/** When a gathered node is depleted or full, retarget within this many tiles. */
export const GATHER_RETARGET_RADIUS = 8;
/** Format version written by `serialize`. Bumped on incompatible changes. */
export const SAVE_VERSION = 1;

// ---------------------------------------------------------------------------
// Ids and primitives
// ---------------------------------------------------------------------------

/** Entity id. Allocated from `GameState.nextEntityId`, starts at 1, never reused. */
export type EntityId = number;
/** Alias used by the command contract in the plan. */
export type Id = EntityId;
/** Player id. Equals the player's index in `GameState.players`. 0 is neutral. */
export type PlayerId = number;
/** Per-player command sequence number, strictly increasing per player. */
export type CommandSeq = number;

/** Id of a UnitDef, e.g. `'villager'`. All def ids are unique across all def kinds. */
export type UnitId = string;
/** Id of a BuildingDef, e.g. `'house'`. */
export type BuildingId = string;
/** Id of a TechDef (age advances are techs), e.g. `'handCarts'`. */
export type TechId = string;
/** Id of a CivDef, e.g. `'byzantines'`. */
export type CivId = string;
/** Id of a NodeDef (resource node type), e.g. `'tree'`. */
export type NodeTypeId = string;
/** Id of a TerrainDef, e.g. `'grass'`. */
export type TerrainId = string;
/** Any content definition id that has an age/requirements (unit, building, tech). */
export type ProducibleId = UnitId | BuildingId | TechId;
/** Any definition id in the registry. */
export type DefId = UnitId | BuildingId | TechId | NodeTypeId;

/** Ages are numbered 1..4 (Founding, Township, Citadel, Empire in M1 data). */
export type AgeNumber = 1 | 2 | 3 | 4;

/** The four gatherable resources. */
export type ResourceType = 'food' | 'wood' | 'gold' | 'stone';
/** All resource types in canonical order. Iterate with this, not `Object.keys`. */
export const RESOURCE_TYPES: readonly ResourceType[] = ['food', 'wood', 'gold', 'stone'];

/** A full set of resource amounts. In PlayerState these are always integers >= 0. */
export interface ResourceAmounts {
  food: number;
  wood: number;
  gold: number;
  stone: number;
}

/** A world-space position in tiles (fractional). */
export interface Vec2 {
  x: number;
  y: number;
}

/** An integer tile coordinate. */
export interface TilePos {
  tx: number;
  ty: number;
}

/**
 * One of 8 facings, in world terms. Screen direction in brackets
 * (+x runs down-right on screen, +y runs down-left):
 * 0 = +x [SE], 1 = +x+y [S], 2 = +y [SW], 3 = -x+y [W],
 * 4 = -x [NW], 5 = -x-y [N], 6 = -y [NE], 7 = +x-y [E].
 * Increasing values rotate clockwise on screen. Chosen from the signs and
 * relative magnitudes of dx, dy (never atan2).
 */
export type Facing = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

/** Seeded PRNG state (sfc32). Four uint32 words, stored as non-negative integers. */
export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** The map. `tiles` is row-major, length `width * height`. All `'grass'` in M1. */
export interface MapState {
  width: number;
  height: number;
  tiles: TerrainId[];
}

/** The whole simulation state. Plain JSON; this is exactly what is saved and hashed. */
export interface GameState {
  /** Number of ticks completed. Starts at 0; `step` increments it last. */
  tick: number;
  /** The seed passed to `createGame` (as uint32). */
  seed: number;
  /** Seed actually used to generate the map (`seed + k` after k failed validations). */
  mapSeed: number;
  /** The single source of randomness for the sim. */
  rng: RngState;
  /** Next id to allocate. Starts at 1. */
  nextEntityId: EntityId;
  /**
   * Incremented every time any tile's blocking status changes (foundation
   * placed, node removed, building removed). Units compare it with
   * `UnitPath.occupancyVersion` to detect possibly stale paths.
   */
  occupancyVersion: number;
  /** Next id for a PathRequest. Starts at 1. */
  nextPathRequestId: number;
  map: MapState;
  /** Index i has id i. Index 0 is the neutral owner of resource nodes. */
  players: PlayerState[];
  /** Every entity, kept sorted by ascending id. */
  entities: Entity[];
  /** Pending path requests in FIFO order (processed in step 5 of the tick). */
  pathQueue: PathRequest[];
  objectives: ObjectiveState;
}

/** Cheat flags. Set only by `cheat` commands; part of state so replays stay exact. */
export interface PlayerCheats {
  /** Construction completes on the first tick a builder contributes. */
  instantBuild: boolean;
  /** Production and research items complete on their first tick. */
  instantResearch: boolean;
}

export interface PlayerState {
  id: PlayerId;
  /** `null` only for the neutral player 0. */
  civ: CivId | null;
  /** Team colour as 0xRRGGBB. */
  color: number;
  /** Integers >= 0. Fractions live in per-building/per-order accumulators. */
  resources: ResourceAmounts;
  age: AgeNumber;
  /** Sum of popCost of living units plus units queued in production. */
  popUsed: number;
  /** min(POP_HARD_CAP, sum of popProvided of completed buildings). */
  popCap: number;
  /** Completed techs (including age advances), in completion order. */
  researched: TechId[];
  cheats: PlayerCheats;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export type EntityKind = 'unit' | 'building' | 'node';

interface EntityBase {
  id: EntityId;
  kind: EntityKind;
  /** Owning player. Resource nodes are owned by NEUTRAL_PLAYER_ID. */
  owner: PlayerId;
}

/** Something a unit is carrying back to a drop-off. `amount` is an integer >= 1. */
export interface CarriedResource {
  type: ResourceType;
  amount: number;
}

export interface UnitEntity extends EntityBase {
  kind: 'unit';
  typeId: UnitId;
  /** Current position (tiles). */
  pos: Vec2;
  /** Position at the end of the previous tick; the renderer interpolates prevPos -> pos. */
  prevPos: Vec2;
  facing: Facing;
  /** Orders waiting to run after `currentOrder` (shift-queued), oldest first. */
  orderQueue: Order[];
  /** The order being executed with its state machine, or `null` when idle. */
  currentOrder: OrderState | null;
  /** The path being followed, or `null`. */
  path: UnitPath | null;
  /**
   * Id of this unit's outstanding PathRequest, or `null`. A request in
   * `GameState.pathQueue` whose id does not match is stale and is skipped.
   * A unit with a pending request stands still.
   */
  pendingPathRequestId: number | null;
  /** Resource being carried, or `null`. */
  carried: CarriedResource | null;
}

export interface BuildingEntity extends EntityBase {
  kind: 'building';
  typeId: BuildingId;
  /** Top-left (min tx, min ty) tile of the square footprint. */
  tile: TilePos;
  /** `false` while a foundation/under construction. Unfinished buildings provide nothing. */
  constructed: boolean;
  /** Construction progress in [0, 1]. Exactly 1 when `constructed`. */
  progress: number;
  /** Units currently contributing build progress (sorted ascending). Empty when constructed. */
  builderIds: EntityId[];
  /** Exact resources deducted when the foundation was placed; refunded 100% on cancel. */
  costPaid: ResourceAmounts;
  /** Production/research queue, front item is in progress. Max MAX_PRODUCTION_QUEUE. */
  queue: ProductionItem[];
  /** Rally point, or `null` (units then idle next to the building). */
  rally: RallyPoint | null;
  /** Fractional passive income not yet credited, in [0, 1). 0 for non-income buildings. */
  incomeAccumulator: number;
  /** Villagers working this building as a farm (sorted ascending). Empty for non-farms. */
  gathererIds: EntityId[];
}

export interface ResourceNodeEntity extends EntityBase {
  kind: 'node';
  typeId: NodeTypeId;
  /** Top-left tile of the square footprint. */
  tile: TilePos;
  /** Integer amount remaining. The node is removed in cleanup when it reaches 0. */
  amount: number;
  /** Units currently assigned to gather this node (sorted ascending). */
  gathererIds: EntityId[];
}

export type Entity = UnitEntity | BuildingEntity | ResourceNodeEntity;

// ---------------------------------------------------------------------------
// Production
// ---------------------------------------------------------------------------

interface ProductionItemBase {
  /** Exact resources deducted on enqueue; refunded 100% on cancel. */
  costPaid: ResourceAmounts;
  /** Ticks of work done so far (integer). */
  ticksDone: number;
  /**
   * Total ticks needed (integer >= 1), fixed when the item is enqueued from the
   * resolved time stat: `max(1, Math.round(seconds * TICK_RATE))`.
   */
  ticksTotal: number;
}

export interface UnitProductionItem extends ProductionItemBase {
  kind: 'unit';
  unitType: UnitId;
  /**
   * `true` once the item finished while the player was at the pop cap and the
   * `PopulationCapped` event was emitted; the item holds at 100% until room exists.
   */
  popCapNotified: boolean;
}

export interface TechProductionItem extends ProductionItemBase {
  kind: 'tech';
  techId: TechId;
}

export type ProductionItem = UnitProductionItem | TechProductionItem;

/** Ground rally (`targetId` null) or rally onto an entity (node, farm, building). */
export interface RallyPoint {
  x: number;
  y: number;
  targetId: EntityId | null;
}

// ---------------------------------------------------------------------------
// Orders (queued intents) and order states (the running state machine)
// ---------------------------------------------------------------------------

/** Walk to a point. Group moves are expanded into per-unit slots before queuing. */
export interface MoveOrder {
  type: 'move';
  x: number;
  y: number;
}

/** Gather from a resource node or a completed farm building (`targetId`). */
export interface GatherOrder {
  type: 'gather';
  targetId: EntityId;
}

/**
 * Construct the foundation this unit was commanded to place. The foundation is
 * created (and paid for) when the `build` command is applied, so the order
 * always references an existing building.
 */
export interface BuildOrder {
  type: 'build';
  buildingId: EntityId;
}

/**
 * Help with an existing building: construct it if unfinished; if it is a
 * completed farm, convert into a `gather` order on it; otherwise finish.
 * Behaves identically to `build` once it reaches the site.
 */
export interface AssistOrder {
  type: 'assist';
  buildingId: EntityId;
}

/** Walk to a completed drop-off building, deposit `carried`, then finish (idle). */
export interface DropOffOrder {
  type: 'dropOff';
  buildingId: EntityId;
}

export type Order = MoveOrder | GatherOrder | BuildOrder | AssistOrder | DropOffOrder;
export type OrderType = Order['type'];

/**
 * Phases common to orders that walk somewhere:
 * - `start`: just became current; needs to choose a goal and request a path.
 * - `walking`: has a path (or is waiting for one: see `UnitEntity.pendingPathRequestId`).
 */
export type WalkPhase = 'start' | 'walking';

export interface MoveOrderState extends MoveOrder {
  phase: WalkPhase;
}

export interface GatherOrderState extends GatherOrder {
  /**
   * - `start`/`toNode`: heading to an approach tile of the target.
   * - `harvesting`: adjacent to the target, accumulating resource.
   * - `toDropOff`: carrying a full load to `dropOffId`.
   * The order loops toNode -> harvesting -> toDropOff -> toNode until the
   * target is depleted with no replacement, which emits `VillagerIdle`.
   */
  phase: 'start' | 'toNode' | 'harvesting' | 'toDropOff';
  /** Resource this order gathers (from the target's def). */
  resource: ResourceType;
  /** Footprint centre of the original target; retargeting searches around it. */
  anchor: Vec2;
  /** Chosen drop-off while in `toDropOff`, else `null`. */
  dropOffId: EntityId | null;
  /** Fraction of the next whole unit of resource harvested, in [0, 1). */
  harvestAccumulator: number;
}

export interface BuildOrderState extends BuildOrder {
  /** `toSite`: walking to an approach tile. `building`: contributing progress. */
  phase: 'start' | 'toSite' | 'building';
}

export interface AssistOrderState extends AssistOrder {
  phase: 'start' | 'toSite' | 'building';
}

export interface DropOffOrderState extends DropOffOrder {
  phase: WalkPhase;
}

export type OrderState =
  | MoveOrderState
  | GatherOrderState
  | BuildOrderState
  | AssistOrderState
  | DropOffOrderState;

// ---------------------------------------------------------------------------
// Pathfinding
// ---------------------------------------------------------------------------

/** A computed, smoothed path. */
export interface UnitPath {
  /** World-space waypoints (tile centres after smoothing), the last is the goal. */
  waypoints: Vec2[];
  /** Index into `waypoints` of the waypoint currently being walked toward. */
  nextIndex: number;
  /** `GameState.occupancyVersion` when the path was computed. */
  occupancyVersion: number;
}

/**
 * A queued path request. Requests are processed atomically (a search is
 * started only when budget remains and always runs to completion within the
 * tick), so no partial search state ever needs to be saved.
 */
export interface PathRequest {
  id: number;
  unitId: EntityId;
  /** Tile the search starts from (the unit's current tile when requested). */
  from: TilePos;
  /** Goal: a point, or "any tile adjacent to this square footprint". */
  goal: PathGoal;
}

export type PathGoal =
  | { kind: 'point'; x: number; y: number }
  | { kind: 'footprint'; tile: TilePos; size: number };

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------

/** Objective kinds. M1 has only `reachAge`; later: `destroyTownCenters`. */
export type ObjectiveKind = 'reachAge';

export interface ObjectiveEntry {
  id: string;
  kind: ObjectiveKind;
  playerId: PlayerId;
  /** For `reachAge`: the age to reach (4 in M1). */
  targetAge: AgeNumber;
  /** Tick on which it completed, or `null`. Game continues as a sandbox afterwards. */
  completedTick: number | null;
}

export interface ObjectiveState {
  entries: ObjectiveEntry[];
}

// ---------------------------------------------------------------------------
// Commands (the only input to the sim)
// ---------------------------------------------------------------------------

interface CommandBase {
  /** Issuing player. Commands for entities the player does not own are rejected. */
  playerId: PlayerId;
  /** Strictly increasing per player. Commands apply sorted by (playerId, seq). */
  seq: CommandSeq;
}

/** Move units to a point. The sim expands the point into per-unit spiral slots. */
export interface MoveCommand extends CommandBase {
  type: 'move';
  unitIds: EntityId[];
  x: number;
  y: number;
  /** `true` (shift) appends to each unit's order queue; `false` replaces it. */
  queue: boolean;
}

/** Gather from a resource node or a completed own farm. */
export interface GatherCommand extends CommandBase {
  type: 'gather';
  unitIds: EntityId[];
  nodeId: EntityId;
  queue: boolean;
}

/** Place a foundation at tile (tx, ty) (footprint top-left) and assign builders. */
export interface BuildCommand extends CommandBase {
  type: 'build';
  unitIds: EntityId[];
  buildingType: BuildingId;
  tx: number;
  ty: number;
  queue: boolean;
}

/** Help construct an own unfinished building, or work an own completed farm. */
export interface AssistCommand extends CommandBase {
  type: 'assist';
  unitIds: EntityId[];
  buildingId: EntityId;
  queue: boolean;
}

/** Deposit carried resources at an own completed drop-off building. */
export interface DropOffCommand extends CommandBase {
  type: 'dropOff';
  unitIds: EntityId[];
  buildingId: EntityId;
}

/** Clear current order and queue; units idle where they are. */
export interface StopCommand extends CommandBase {
  type: 'stop';
  unitIds: EntityId[];
}

export interface TrainCommand extends CommandBase {
  type: 'train';
  buildingId: EntityId;
  unitType: UnitId;
}

/** Research a tech at a building. Age advances are techs. */
export interface ResearchCommand extends CommandBase {
  type: 'research';
  buildingId: EntityId;
  techId: TechId;
}

/** Remove the queue item at `index` (0 = in progress) and refund it in full. */
export interface CancelQueueCommand extends CommandBase {
  type: 'cancelQueue';
  buildingId: EntityId;
  index: number;
}

/** Remove an unfinished own building and refund `costPaid` in full. */
export interface CancelConstructionCommand extends CommandBase {
  type: 'cancelConstruction';
  buildingId: EntityId;
}

/** Set rally point of buildings to a ground point, or onto an entity (`targetId`). */
export interface SetRallyCommand extends CommandBase {
  type: 'setRally';
  buildingIds: EntityId[];
  x: number;
  y: number;
  targetId?: EntityId;
}

/** Delete own entities (no refund except unfinished buildings, which refund like cancel). */
export interface DeleteCommand extends CommandBase {
  type: 'delete';
  entityIds: EntityId[];
}

/** Debug cheats. The client only exposes these in dev/test builds and the debug overlay. */
export type CheatAction =
  | { kind: 'addResources'; amounts: Partial<ResourceAmounts> }
  | { kind: 'instantBuild'; enabled: boolean }
  | { kind: 'instantResearch'; enabled: boolean }
  | { kind: 'spawnUnit'; unitType: UnitId; x: number; y: number };

export interface CheatCommand extends CommandBase {
  type: 'cheat';
  cheat: CheatAction;
}

export type Command =
  | MoveCommand
  | GatherCommand
  | BuildCommand
  | AssistCommand
  | DropOffCommand
  | StopCommand
  | TrainCommand
  | ResearchCommand
  | CancelQueueCommand
  | CancelConstructionCommand
  | SetRallyCommand
  | DeleteCommand
  | CheatCommand;

export type CommandType = Command['type'];

/**
 * A command as created by the client before `seq` is assigned. The client's
 * command buffer stamps `playerId` and `seq`.
 */
export type CommandInput = Command extends infer C
  ? C extends Command
    ? Omit<C, 'playerId' | 'seq'>
    : never
  : never;

// ---------------------------------------------------------------------------
// Rejections, availability and placement (shared by validation and the HUD)
// ---------------------------------------------------------------------------

/**
 * Why a def is not currently available to a player. The HUD renders these as
 * the greyed-out reason; the sim uses the same values for CommandRejected.
 */
export type UnavailableReason =
  | { code: 'requiresAge'; age: AgeNumber }
  | { code: 'requiresBuilding'; buildingId: BuildingId }
  | { code: 'requiresTech'; techId: TechId }
  /** Def is restricted to other civs (such defs are also `hidden`). */
  | { code: 'wrongCiv' }
  /** Def is replaced for this civ by another def (also `hidden`). */
  | { code: 'replaced'; by: ProducibleId }
  | { code: 'buildLimit'; limit: number }
  | { code: 'alreadyResearched' }
  /** Tech is queued or being researched somewhere already. */
  | { code: 'researchInProgress' }
  /** Age advance: needs `need` distinct completed buildings of the current age, has `have`. */
  | { code: 'ageBuildings'; have: number; need: number }
  /** Another age advance is already queued or in progress. */
  | { code: 'ageAdvanceInProgress' };

/** Result of `query.availability(playerId, defId)`. Cost is reported separately from rules. */
export interface Availability {
  /** All rule requirements met (ignores affordability). */
  available: boolean;
  /** Never show this def for this player (other civ, or replaced). Implies !available. */
  hidden: boolean;
  /** Empty when available. Ordered for display, most important first. */
  reasons: UnavailableReason[];
  /** Resolved cost for this player (after modifiers, rounded). */
  cost: ResourceAmounts;
  /** Player has at least `cost` of every resource. */
  affordable: boolean;
  /** `max(0, cost - resources)` per resource. All zero when affordable. */
  shortfall: ResourceAmounts;
}

/** Why a single footprint tile is invalid. */
export type PlacementTileProblem = 'outOfBounds' | 'notBuildable' | 'occupied';

/** Result of `query.canPlace`. */
export interface PlacementResult {
  /** Everything valid: in bounds, all tiles free and buildable, available, affordable. */
  ok: boolean;
  /** Footprint size the result describes (side length). */
  size: number;
  /**
   * Per footprint tile, row-major from (tx, ty): `null` if that tile is fine,
   * otherwise the problem. Length `size * size`. Drives the per-tile ghost.
   */
  tiles: (PlacementTileProblem | null)[];
  /** Availability of the building type (rules + cost). */
  availability: Availability;
}

/** Reason codes in CommandRejected. The HUD maps them to toasts. */
export type RejectReason =
  /** Malformed command (bad numbers, empty id lists, unknown command type). */
  | 'invalidCommand'
  /** Referenced entity does not exist. */
  | 'unknownEntity'
  /** Entity exists but is not owned by the issuing player. */
  | 'notOwner'
  /** Unit or building cannot perform this (e.g. a spearman told to gather, a house told to train). */
  | 'cannotPerform'
  /** Target is not valid for this command (e.g. gather from a building that is not a farm). */
  | 'invalidTarget'
  /** Building is still under construction. */
  | 'notConstructed'
  /** Rule requirement unmet; see `unavailable`. */
  | 'notAvailable'
  /** Not enough resources; see `shortfall`. */
  | 'cannotAfford'
  /** Placement invalid (bounds, buildable, occupied). */
  | 'cannotPlace'
  /** Production queue already has MAX_PRODUCTION_QUEUE items. */
  | 'queueFull'
  /** cancelQueue index out of range. */
  | 'invalidIndex'
  /** Unknown def id. */
  | 'unknownDef';

// ---------------------------------------------------------------------------
// Events (emitted by step, consumed by the client)
// ---------------------------------------------------------------------------

export interface UnitTrainedEvent {
  type: 'UnitTrained';
  playerId: PlayerId;
  unitId: EntityId;
  unitType: UnitId;
  buildingId: EntityId;
}

export interface BuildingPlacedEvent {
  type: 'BuildingPlaced';
  playerId: PlayerId;
  buildingId: EntityId;
  buildingType: BuildingId;
  tx: number;
  ty: number;
}

export interface BuildingCompletedEvent {
  type: 'BuildingCompleted';
  playerId: PlayerId;
  buildingId: EntityId;
  buildingType: BuildingId;
}

export interface ResearchCompletedEvent {
  type: 'ResearchCompleted';
  playerId: PlayerId;
  techId: TechId;
  buildingId: EntityId;
}

export interface AgeAdvancedEvent {
  type: 'AgeAdvanced';
  playerId: PlayerId;
  age: AgeNumber;
}

export interface ResourceNodeDepletedEvent {
  type: 'ResourceNodeDepleted';
  nodeId: EntityId;
  nodeType: NodeTypeId;
  resource: ResourceType;
  /** Footprint centre. */
  x: number;
  y: number;
}

/** A villager ran out of work (gather target exhausted with no replacement, build done with nothing next). */
export interface VillagerIdleEvent {
  type: 'VillagerIdle';
  playerId: PlayerId;
  unitId: EntityId;
}

/** Emitted once per held queue item when it finishes at the pop cap. */
export interface PopulationCappedEvent {
  type: 'PopulationCapped';
  playerId: PlayerId;
  buildingId: EntityId;
  unitType: UnitId;
}

export interface CommandRejectedEvent {
  type: 'CommandRejected';
  playerId: PlayerId;
  seq: CommandSeq;
  commandType: CommandType;
  reason: RejectReason;
  /** Present when reason is `notAvailable`. */
  unavailable?: UnavailableReason[];
  /** Present when reason is `cannotAfford`. */
  shortfall?: ResourceAmounts;
  /** Present when reason is `cannotPlace`. */
  placement?: PlacementTileProblem[];
}

export interface ObjectiveCompletedEvent {
  type: 'ObjectiveCompleted';
  playerId: PlayerId;
  objectiveId: string;
  /** Tick on which it completed; elapsed game seconds = tick / TICK_RATE. */
  tick: number;
}

export type SimEvent =
  | UnitTrainedEvent
  | BuildingPlacedEvent
  | BuildingCompletedEvent
  | ResearchCompletedEvent
  | AgeAdvancedEvent
  | ResourceNodeDepletedEvent
  | VillagerIdleEvent
  | PopulationCappedEvent
  | CommandRejectedEvent
  | ObjectiveCompletedEvent;

export type SimEventType = SimEvent['type'];

// ---------------------------------------------------------------------------
// Resolved stats
// ---------------------------------------------------------------------------

/** Kinds of gathering, each with its own villager rate (berries and farms are both food). */
export type GatherKind = 'wood' | 'berries' | 'farm' | 'gold' | 'stone';

/**
 * Every stat a Modifier can target and `query.resolvedStat` can return.
 * Units: hp, attack, armor, range (provisional, unused in M1), speed (tiles/s),
 * carryCapacity, gatherRate.* (per second), popCost, trainTime (s).
 * Buildings: hp, armor, buildTime (s), popProvided, incomeRate (per second).
 * Techs: researchTime (s).
 * All producibles: cost.* (each component rounded with Math.round after resolution, min 0).
 */
export type StatKey =
  | 'hp'
  | 'attack'
  | 'armor'
  | 'range'
  | 'speed'
  | 'carryCapacity'
  | 'gatherRate.wood'
  | 'gatherRate.berries'
  | 'gatherRate.farm'
  | 'gatherRate.gold'
  | 'gatherRate.stone'
  | 'popCost'
  | 'popProvided'
  | 'trainTime'
  | 'buildTime'
  | 'researchTime'
  | 'incomeRate'
  | 'cost.food'
  | 'cost.wood'
  | 'cost.gold'
  | 'cost.stone';

// ---------------------------------------------------------------------------
// Public sim API
// ---------------------------------------------------------------------------

/** Recursively readonly view. The client only ever sees state through this. */
export type DeepReadonly<T> = T extends (infer R)[]
  ? readonly DeepReadonly<R>[]
  : T extends (...args: never[]) => unknown
    ? T
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

export type ReadonlyGameState = DeepReadonly<GameState>;
export type ReadonlyEntity = DeepReadonly<Entity>;

export interface GameConfig {
  seed: number;
  /** Map side length in tiles (MAP_SIZE in M1). */
  mapSize: number;
  /** Real players only; they get ids 1..n. The neutral player 0 is added automatically. */
  players: { civ: CivId }[];
}

/** Read-only queries. Each answers from current state; none mutates. */
export interface SimQuery {
  entityById(id: EntityId): ReadonlyEntity | undefined;
  /**
   * Entities intersecting the world-space axis-aligned rect (any corner order).
   * Units use UNIT_PICK_RADIUS; buildings/nodes use their footprint. Ascending id.
   */
  entitiesInRect(x0: number, y0: number, x1: number, y1: number): ReadonlyEntity[];
  /**
   * Topmost entity at a world point: units (within UNIT_PICK_RADIUS, nearest
   * first) over buildings over nodes; ties by lowest id. `undefined` if none.
   */
  entityAtPoint(x: number, y: number): ReadonlyEntity | undefined;
  /** Same function the sim uses to validate train/research/build. */
  availability(playerId: PlayerId, defId: ProducibleId): Availability;
  /** Same function the sim uses to validate `build`. (tx, ty) is the footprint top-left. */
  canPlace(playerId: PlayerId, buildingType: BuildingId, tx: number, ty: number): PlacementResult;
  /** Stat after civ and tech modifiers. Throws for a stat the def does not have. */
  resolvedStat(playerId: PlayerId, defId: DefId, stat: StatKey): number;
}

export interface Sim {
  /** Current state. Never mutate it from outside the sim. */
  readonly state: ReadonlyGameState;
  /**
   * Advance exactly one tick. `commands` are those issued since the previous
   * step; they are applied at the start of this tick, sorted by (playerId, seq).
   * Returns the events emitted during this tick.
   */
  step(commands: readonly Command[]): SimEvent[];
  readonly query: SimQuery;
}

// ---------------------------------------------------------------------------
// Sim internals shared between sim work packages
// ---------------------------------------------------------------------------

/**
 * Derived caches beside the state. Rebuilt by `rebuildRuntime(state)` after
 * creation and after load; never saved or hashed. Systems must keep them in
 * sync when they change the state they derive from.
 */
export interface SimRuntime {
  /** One byte per tile, row-major: 0 = free, non-zero = blocked (buildings, blocking nodes). */
  occupancy: Uint8Array;
  /**
   * Resolved stats indexed by player id, then def id: `resolvedStats[playerId][defId][stat]`.
   * Rebuilt for a player when one of its techs completes, and on load.
   */
  resolvedStats: Record<DefId, Partial<Record<StatKey, number>>>[];
  /** Entities flagged for removal in the cleanup step of the current tick. Empty between ticks. */
  pendingRemoval: EntityId[];
}

/** Everything a system function receives. */
export interface SimContext {
  state: GameState;
  runtime: SimRuntime;
  data: DataRegistry;
  /** Events emitted so far this tick; push to emit. */
  events: SimEvent[];
}
