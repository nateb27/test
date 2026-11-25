/**
 * Step 1 of the bot loop: read the public sim state into a compact, bot-friendly view.
 *
 * Uses only `sim.state` and `sim.query` (the public API). Nothing here mutates anything. The decision step
 * works on a copy of this view that it updates as it issues commands, so one decision never double-books a
 * villager, a node slot or a coin.
 */

import { registry } from '../data';
import type { DataRegistry } from '../data';
import {
  TICK_RATE,
  type BuildingId,
  type EntityId,
  type PlayerId,
  type ReadonlyEntity,
  type ResourceAmounts,
  type ResourceType,
  type Sim,
} from '../sim';

export type GatherSlot = 'wood' | 'berries' | 'farm' | 'gold' | 'stone';

export type VillagerTask =
  | { kind: 'idle' }
  | { kind: 'gather'; slot: GatherSlot; resource: ResourceType; targetId: EntityId }
  | { kind: 'build'; buildingId: EntityId }
  | { kind: 'busy' };

export interface VillagerView {
  id: EntityId;
  x: number;
  y: number;
  task: VillagerTask;
  /** Units currently carried (0 if none). */
  carried: number;
  /** Set by the decision step once the villager has been given a command this decision. */
  claimed: boolean;
}

export interface BuildingView {
  id: EntityId;
  typeId: BuildingId;
  tx: number;
  ty: number;
  size: number;
  /** Footprint centre. */
  cx: number;
  cy: number;
  constructed: boolean;
  builders: number;
  queueLength: number;
  /** Tech ids queued or researching here. */
  queuedTechs: string[];
  dropOff: readonly ResourceType[];
}

export interface NodeView {
  id: EntityId;
  typeId: string;
  resource: ResourceType;
  slot: GatherSlot;
  tx: number;
  ty: number;
  size: number;
  cx: number;
  cy: number;
  amount: number;
  /** Gatherers on it now plus those the current decision has sent. */
  gatherers: number;
  maxGatherers: number;
}

export interface FarmView {
  id: EntityId;
  building: BuildingView;
  /** Villagers working it or on their way. */
  gatherers: number;
}

export interface BotView {
  tick: number;
  /** Game seconds. */
  time: number;
  playerId: PlayerId;
  age: number;
  resources: ResourceAmounts;
  /** Living population plus units queued for training (the bot plans against committed population). */
  popUsed: number;
  popCap: number;
  researched: ReadonlySet<string>;
  mapWidth: number;
  mapHeight: number;
  villagers: VillagerView[];
  /** Own buildings, completed and foundations. */
  buildings: BuildingView[];
  /** Nodes with something left. */
  nodes: NodeView[];
  /** Completed farms. */
  farms: FarmView[];
}

const SLOT_BY_KIND: Record<string, GatherSlot> = {
  wood: 'wood',
  berries: 'berries',
  farm: 'farm',
  gold: 'gold',
  stone: 'stone',
};

/** Build the view for `playerId`. */
export function readView(sim: Sim, playerId: PlayerId, data: DataRegistry = registry): BotView {
  const state = sim.state;
  const player = state.players[playerId];
  if (player === undefined) throw new Error(`no player ${playerId}`);

  let queuedPop = 0;
  const villagers: VillagerView[] = [];
  const buildings: BuildingView[] = [];
  const nodes: NodeView[] = [];
  const farmWorkers = new Map<EntityId, number>();
  const entityById = new Map<EntityId, ReadonlyEntity>();
  for (const e of state.entities) entityById.set(e.id, e);

  for (const e of state.entities) {
    if (e.kind === 'unit') {
      if (e.owner !== playerId || e.typeId !== 'villager') continue;
      const o = e.currentOrder;
      let task: VillagerTask;
      if (o === null && e.orderQueue.length === 0) task = { kind: 'idle' };
      else if (o !== null && o.type === 'gather') {
        const target = entityById.get(o.targetId);
        let slot: GatherSlot = 'wood';
        if (target !== undefined && target.kind === 'node') slot = SLOT_BY_KIND[data.node(target.typeId).gatherKind] ?? 'wood';
        else if (target !== undefined && target.kind === 'building') slot = 'farm';
        task = { kind: 'gather', slot, resource: o.resource, targetId: o.targetId };
        if (slot === 'farm') farmWorkers.set(o.targetId, (farmWorkers.get(o.targetId) ?? 0) + 1);
      } else if (o !== null && (o.type === 'build' || o.type === 'assist')) task = { kind: 'build', buildingId: o.buildingId };
      else task = { kind: 'busy' };
      villagers.push({ id: e.id, x: e.pos.x, y: e.pos.y, task, carried: e.carried?.amount ?? 0, claimed: false });
    } else if (e.kind === 'building') {
      if (e.owner !== playerId) continue;
      const def = data.building(e.typeId);
      for (const q of e.queue) if (q.kind === 'unit') queuedPop += data.unit(q.unitType).popCost;
      buildings.push({
        id: e.id,
        typeId: e.typeId,
        tx: e.tile.tx,
        ty: e.tile.ty,
        size: def.footprint,
        cx: e.tile.tx + def.footprint / 2,
        cy: e.tile.ty + def.footprint / 2,
        constructed: e.constructed,
        builders: e.builderIds.length,
        queueLength: e.queue.length,
        queuedTechs: e.queue.flatMap((q) => (q.kind === 'tech' ? [q.techId] : [])),
        dropOff: def.dropOff,
      });
    } else {
      if (e.amount <= 0) continue;
      const def = data.node(e.typeId);
      nodes.push({
        id: e.id,
        typeId: e.typeId,
        resource: def.resource,
        slot: SLOT_BY_KIND[def.gatherKind] ?? 'wood',
        tx: e.tile.tx,
        ty: e.tile.ty,
        size: def.footprint,
        cx: e.tile.tx + def.footprint / 2,
        cy: e.tile.ty + def.footprint / 2,
        amount: e.amount,
        gatherers: e.gathererIds.length,
        maxGatherers: def.maxGatherers,
      });
    }
  }
  const farms: FarmView[] = [];
  for (const b of buildings) {
    if (b.constructed && data.building(b.typeId).farm !== undefined) {
      farms.push({ id: b.id, building: b, gatherers: farmWorkers.get(b.id) ?? 0 });
    }
  }
  // Orders in flight count toward node slots even before the villager arrives.
  const inbound = new Map<EntityId, number>();
  for (const v of villagers) {
    if (v.task.kind === 'gather') inbound.set(v.task.targetId, (inbound.get(v.task.targetId) ?? 0) + 1);
  }
  for (const n of nodes) n.gatherers = Math.max(n.gatherers, inbound.get(n.id) ?? 0);

  return {
    tick: state.tick,
    time: state.tick / TICK_RATE,
    playerId,
    age: player.age,
    resources: { ...player.resources },
    popUsed: player.popUsed + queuedPop,
    popCap: player.popCap,
    researched: new Set(player.researched),
    mapWidth: state.map.width,
    mapHeight: state.map.height,
    villagers,
    buildings,
    nodes,
    farms,
  };
}
