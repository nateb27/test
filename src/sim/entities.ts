/**
 * Entity store helpers. `GameState.entities` is always sorted by ascending id;
 * because ids only grow, appending keeps it sorted.
 */

import type { Entity, EntityId, GameState } from './types';

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
