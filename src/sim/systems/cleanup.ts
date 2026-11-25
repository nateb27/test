/** Tick step 8: cleanup, and the delete command. Owned by WP1. */

import { findEntity, removeEntities } from '../entities';
import { footprintOf, setFootprint } from '../map/occupancy';
import { RESOURCE_TYPES, type Entity, type EntityId, type ResourceType, type SimContext } from '../types';
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

/** Radius (tiles) around a depleted rally target searched for a replacement node of the same resource. */
const RALLY_FOLLOW_RADIUS = 16;

/** Nearest surviving node of `from.resource` within RALLY_FOLLOW_RADIUS of it (ties: lowest id). */
function nearestNodeOf(
  ctx: SimContext,
  from: { resource: ResourceType; cx: number; cy: number },
  removed: ReadonlySet<EntityId>,
): { id: EntityId; cx: number; cy: number } | null {
  let best: { id: EntityId; cx: number; cy: number } | null = null;
  let bestD = RALLY_FOLLOW_RADIUS * RALLY_FOLLOW_RADIUS;
  for (const e of ctx.state.entities) {
    if (e.kind !== 'node' || removed.has(e.id) || e.amount <= 0) continue;
    const def = ctx.data.node(e.typeId);
    if (def.resource !== from.resource) continue;
    const cx = e.tile.tx + def.footprint / 2;
    const cy = e.tile.ty + def.footprint / 2;
    const d = (cx - from.cx) * (cx - from.cx) + (cy - from.cy) * (cy - from.cy);
    if (d < bestD || (best === null && d <= bestD)) {
      best = { id: e.id, cx, cy };
      bestD = d;
    }
  }
  return best;
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
  const removedNodes = new Map<EntityId, { resource: ResourceType; cx: number; cy: number }>();
  for (const id of removedIds) {
    const e = findEntity(state, id);
    if (e === undefined) continue;
    if (e.kind === 'node') {
      const def = ctx.data.node(e.typeId);
      removedNodes.set(id, {
        resource: def.resource,
        cx: e.tile.tx + def.footprint / 2,
        cy: e.tile.ty + def.footprint / 2,
      });
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
        const gone = removedNodes.get(e.rally.targetId);
        const next = gone === undefined ? null : nearestNodeOf(ctx, gone, removed);
        // A rally onto a depleted node follows the resource to the nearest node of the same kind, else it
        // becomes a ground rally at the old spot.
        if (next !== null) e.rally = { x: next.cx, y: next.cy, targetId: next.id };
        else e.rally.targetId = null;
      }
    }
  }
  recomputePopulation(ctx);
}

/**
 * Delete own units and buildings. The whole command is rejected (nothing
 * changes) if any id is unknown or not owned by the player (neutral nodes never are). Unfinished
 * buildings refund `costPaid` in full and a building's queued items are refunded in full
 * (same rule as `cancelQueue`); everything else refunds nothing. A command that would remove
 * the player's last completed Town Center is rejected whole with `cannotPerform`.
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
  // A player's last completed Town Center cannot be deleted: the match could not be recovered.
  const isTownCenter = (e: Entity): boolean =>
    e.kind === 'building' && e.constructed && ctx.data.building(e.typeId).tags.includes('townCenter');
  const doomed = new Set<EntityId>(targets.filter(isTownCenter).map((e) => e.id));
  if (doomed.size > 0) {
    let remaining = 0;
    for (const e of ctx.state.entities) {
      if (e.owner === cmd.playerId && isTownCenter(e) && !doomed.has(e.id) && !ctx.runtime.pendingRemoval.includes(e.id)) {
        remaining++;
      }
    }
    if (remaining === 0) return reject(ctx, cmd, 'cannotPerform');
  }
  const player = ctx.state.players[cmd.playerId];
  for (const e of targets) {
    if (ctx.runtime.pendingRemoval.includes(e.id)) continue;
    if (e.kind === 'building' && player !== undefined) {
      if (!e.constructed) for (const r of RESOURCE_TYPES) player.resources[r] += e.costPaid[r];
      // Queued units and techs are refunded in full, like `cancelQueue`.
      for (const item of e.queue) for (const r of RESOURCE_TYPES) player.resources[r] += item.costPaid[r];
      e.queue = [];
    }
    insertSorted(ctx.runtime.pendingRemoval, e.id);
  }
};
