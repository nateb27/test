/** Tick step 8: cleanup, and the delete command. Owned by WP1. */

import { findEntity, removeEntities } from '../entities';
import { footprintOf, setFootprint } from '../map/occupancy';
import { RESOURCE_TYPES, type Entity, type EntityId, type SimContext } from '../types';
import { emit, reject, type CommandHandler } from './common';
import { endCurrentOrder } from './orders';
import { recomputePopulation } from './population';

/** Insert `id` into the ascending list `ids` unless already present. */
function insertSorted(ids: EntityId[], id: EntityId): void {
  let i = 0;
  while (i < ids.length && (ids[i] as EntityId) < id) i++;
  if (ids[i] !== id) ids.splice(i, 0, id);
}

/** Remove `ids` from the ascending list `list` in place. */
function removeAll(list: EntityId[], ids: ReadonlySet<EntityId>): void {
  for (let i = list.length - 1; i >= 0; i--) {
    if (ids.has(list[i] as EntityId)) list.splice(i, 1);
  }
}

/**
 * Remove depleted nodes (amount <= 0) and entities in `runtime.pendingRemoval`:
 * emits ResourceNodeDepleted for nodes, ends removed units' orders (releasing
 * gatherer/builder slots), clears footprints from the occupancy grid and bumps
 * `occupancyVersion` if any blocking tile was freed, drops their path requests
 * and dangling rally targets, then recomputes population.
 *
 * Orders of surviving units that target a removed entity are left alone: each
 * order handler already treats a missing target as "retarget or finish"
 * (gather retargets around its `anchor` after a node is depleted).
 */
export function runCleanup(ctx: SimContext): void {
  const { state, runtime } = ctx;
  const flagged = new Set<EntityId>(runtime.pendingRemoval);
  runtime.pendingRemoval.length = 0;
  for (const e of state.entities) {
    if (e.kind === 'node' && e.amount <= 0) flagged.add(e.id);
  }
  if (flagged.size === 0) {
    recomputePopulation(ctx);
    return;
  }

  const removedIds: EntityId[] = [];
  for (const e of state.entities) {
    if (flagged.has(e.id)) removedIds.push(e.id); // ascending: entities are sorted
  }
  const removed = new Set<EntityId>(removedIds);

  // Units first: end their orders while the targets they hold slots on still exist.
  for (const e of state.entities) {
    if (e.kind === 'unit' && removed.has(e.id)) endCurrentOrder(ctx, e);
  }

  let freedBlocking = false;
  for (const id of removedIds) {
    const e = findEntity(state, id);
    if (e === undefined) continue;
    if (e.kind === 'node') {
      const def = ctx.data.node(e.typeId);
      emit(ctx, {
        type: 'ResourceNodeDepleted',
        nodeId: e.id,
        nodeType: e.typeId,
        resource: def.resource,
        x: e.tile.tx + def.footprint / 2,
        y: e.tile.ty + def.footprint / 2,
      });
    }
    const fp = footprintOf(e, ctx.data);
    if (fp !== null && fp.blocking) {
      setFootprint(runtime.occupancy, state.map.width, state.map.height, fp.tile, fp.size, 0);
      freedBlocking = true;
    }
  }
  if (freedBlocking) state.occupancyVersion += 1;

  removeEntities(state, removedIds);
  state.pathQueue = state.pathQueue.filter((r) => !removed.has(r.unitId));

  // Release slots held by removed units and clear references to removed entities.
  for (const e of state.entities) {
    if (e.kind === 'unit') continue;
    removeAll(e.gathererIds, removed);
    if (e.kind === 'building') {
      removeAll(e.builderIds, removed);
      if (e.rally !== null && e.rally.targetId !== null && removed.has(e.rally.targetId)) {
        e.rally.targetId = null;
      }
    }
  }
  recomputePopulation(ctx);
}

/**
 * Delete own units and buildings. The whole command is rejected (nothing
 * changes) if any id is unknown or not owned by the player (neutral nodes never are). Unfinished
 * buildings refund `costPaid` in full; everything else refunds nothing.
 * Removal itself happens in the cleanup step of the same tick.
 */
export const applyDeleteCommand: CommandHandler<'delete'> = (ctx, cmd) => {
  const targets: Entity[] = [];
  for (const id of cmd.entityIds) {
    const e = findEntity(ctx.state, id);
    if (e === undefined) return reject(ctx, cmd, 'unknownEntity');
    if (e.owner !== cmd.playerId) return reject(ctx, cmd, 'notOwner');
    targets.push(e);
  }
  const player = ctx.state.players[cmd.playerId];
  for (const e of targets) {
    if (ctx.runtime.pendingRemoval.includes(e.id)) continue;
    if (e.kind === 'building' && !e.constructed && player !== undefined) {
      for (const r of RESOURCE_TYPES) player.resources[r] += e.costPaid[r];
    }
    insertSorted(ctx.runtime.pendingRemoval, e.id);
  }
};
