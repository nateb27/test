/**
 * Entity store helpers. `GameState.entities` is always sorted by ascending id;
 * because ids only grow, appending keeps it sorted.
 */

import {
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

/** Create a unit at (x, y) with no orders and append it. */
export function createUnit(
  state: GameState,
  typeId: UnitId,
  owner: PlayerId,
  x: number,
  y: number,
  facing: Facing = 1,
): UnitEntity {
  const unit: UnitEntity = {
    id: allocateEntityId(state),
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
): BuildingEntity {
  const building: BuildingEntity = {
    id: allocateEntityId(state),
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
