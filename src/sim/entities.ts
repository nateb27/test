/**
 * Entity store helpers. `GameState.entities` is always sorted by ascending id;
 * because ids only grow, appending keeps it sorted. Owned by WP20 in M2, then the orchestrator.
 *
 * Creation defaults (PLAN-M2 3.5): a new unit has full hp, stance `aggressive`, a ready combat state whose first
 * scan is staggered by id (`tick + id % ACQUIRE_INTERVAL_TICKS`) and no attacker. A new foundation starts at
 * `max(1, floor(maxHp * constructionStartPercent / 100))` hp; a completed building at max hp. `attack` is non-null
 * exactly for defs with `combat.attack`. `maxHp` defaults to the def's base hp; systems pass the resolved value
 * (`unitCombat(ctx, ...).maxHp`). `data` defaults to the game registry.
 */

import { registry } from '../data/index';
import type { DataRegistry } from '../data/schema';
import {
  ACQUIRE_INTERVAL_TICKS,
  NEUTRAL_PLAYER_ID,
  type BuildingEntity,
  type BuildingId,
  type Entity,
  type EntityId,
  type Facing,
  type GameState,
  type NodeTypeId,
  type PlayerId,
  type ResourceAmounts,
  type ResourceNodeEntity,
  type UnitEntity,
  type UnitId,
} from './types';

/** Allocate the next entity id. */
export function allocateEntityId(state: GameState): EntityId {
  const id = state.nextEntityId;
  state.nextEntityId = id + 1;
  return id;
}

/** Append an entity (its id must come from `allocateEntityId`). */
export function addEntity(state: GameState, entity: Entity): void {
  const last = state.entities[state.entities.length - 1];
  if (last !== undefined && last.id >= entity.id) {
    throw new Error(`addEntity: id ${entity.id} is not greater than ${last.id}`);
  }
  state.entities.push(entity);
}

/** Binary search for the index of an entity by id, or -1. */
export function entityIndex(entities: readonly { readonly id: EntityId }[], id: EntityId): number {
  let lo = 0;
  let hi = entities.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const midId = (entities[mid] as { id: EntityId }).id;
    if (midId === id) return mid;
    if (midId < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** Find an entity by id. */
export function findEntity(state: GameState, id: EntityId): Entity | undefined {
  const i = entityIndex(state.entities, id);
  return i < 0 ? undefined : state.entities[i];
}

/** Remove every entity whose id is in `ids`. The remaining order (ascending id) is kept. */
export function removeEntities(state: GameState, ids: readonly EntityId[]): void {
  if (ids.length === 0) return;
  const doomed = new Set<EntityId>(ids);
  state.entities = state.entities.filter((e) => !doomed.has(e.id));
}

/** First acquisition scan tick of a new unit or attacking building: staggered by id. */
export function initialScanTick(state: GameState, id: EntityId): number {
  return state.tick + (id % ACQUIRE_INTERVAL_TICKS);
}

/** HP of a foundation that has just been placed: `max(1, floor(maxHp * startPercent / 100))`. */
export function foundationHp(maxHp: number, startPercent: number): number {
  return Math.max(1, Math.floor((maxHp * startPercent) / 100));
}

/** Base (unmodified) hp of a unit or building def, 1 for an unknown id. */
function baseHp(data: DataRegistry, typeId: string): number {
  const def = data.def(typeId);
  return def !== undefined && (def.kind === 'unit' || def.kind === 'building') ? def.combat.hp : 1;
}

/** Create a unit at (x, y) with no orders and full hp, and append it. */
export function createUnit(
  state: GameState,
  typeId: UnitId,
  owner: PlayerId,
  x: number,
  y: number,
  facing: Facing = 1,
  maxHp: number = baseHp(registry, typeId),
): UnitEntity {
  const id = allocateEntityId(state);
  const unit: UnitEntity = {
    id,
    kind: 'unit',
    owner,
    typeId,
    pos: { x, y },
    prevPos: { x, y },
    facing,
    orderQueue: [],
    currentOrder: null,
    path: null,
    pendingPathRequestId: null,
    carried: null,
    hp: maxHp,
    stance: 'aggressive',
    combat: { cooldown: 0, windup: 0, swingTargetId: null, nextScanTick: initialScanTick(state, id), lastAttackTick: null },
    lastAttackerId: null,
    lastDamagedTick: null,
  };
  addEntity(state, unit);
  return unit;
}

/** Create a building (finished when `constructed`, else a foundation at 0 progress) and append it. */
export function createBuilding(
  state: GameState,
  typeId: BuildingId,
  owner: PlayerId,
  tx: number,
  ty: number,
  constructed: boolean,
  costPaid: ResourceAmounts = { food: 0, wood: 0, gold: 0, stone: 0 },
  data: DataRegistry = registry,
  maxHp: number = baseHp(data, typeId),
): BuildingEntity {
  const id = allocateEntityId(state);
  const def = data.def(typeId);
  const hasAttack = def !== undefined && def.kind === 'building' && def.combat.attack !== undefined;
  const hp = constructed ? maxHp : foundationHp(maxHp, data.combat.constructionStartPercent);
  const building: BuildingEntity = {
    id,
    kind: 'building',
    owner,
    typeId,
    tile: { tx, ty },
    constructed,
    progress: constructed ? 1 : 0,
    builderIds: [],
    costPaid: { ...costPaid },
    queue: [],
    rally: null,
    incomeAccumulator: 0,
    gathererIds: [],
    hp,
    builtHp: hp,
    attack: hasAttack ? { cooldown: 0, targetId: null, nextScanTick: initialScanTick(state, id), lastAttackTick: null } : null,
    lastAttackerId: null,
    lastDamagedTick: null,
    repairerIds: [],
    repairAccumulator: 0,
    repairCostAccumulator: { food: 0, wood: 0, gold: 0, stone: 0 },
  };
  addEntity(state, building);
  return building;
}

/** Create a neutral resource node with the given amount and append it. */
export function createNode(
  state: GameState,
  typeId: NodeTypeId,
  tx: number,
  ty: number,
  amount: number,
): ResourceNodeEntity {
  const node: ResourceNodeEntity = {
    id: allocateEntityId(state),
    kind: 'node',
    owner: NEUTRAL_PLAYER_ID,
    typeId,
    tile: { tx, ty },
    amount,
    gathererIds: [],
  };
  addEntity(state, node);
  return node;
}
