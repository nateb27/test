/**
 * Headless stress scenario for the performance budget (plan 9.4), also loaded
 * by the dev/e2e browser hook. Owned by WP12.
 *
 * `createStressScenario` builds a one-player match on the normal generated map
 * (about 1,800 resource nodes) and adds 200 villagers and about 150 buildings
 * (houses, farms, camps, mills and military buildings) directly into state,
 * then gives every villager a gather order. `commands(tick)` returns the
 * deterministic commands a scripted player issues on that tick so units keep
 * moving as well as gathering. No randomness: choices are integer arithmetic
 * on ids and the tick, so the scenario is identical on every run.
 */

import { registry } from '../data/index';
import type { DataRegistry } from '../data/schema';
import { createBuilding, createUnit } from './entities';
import { generateMap } from './map/mapgen';
import { rebuildRuntime } from './runtime';
import { createInitialState, simFromState } from './sim';
import type {
  BuildingEntity,
  Command,
  EntityId,
  GameConfig,
  GameState,
  ResourceNodeEntity,
  ResourceType,
  Sim,
  SimContext,
  UnitEntity,
} from './types';

export const STRESS_PLAYER = 1;
export const STRESS_UNITS = 200;
export const STRESS_BUILDINGS = 150;

export interface StressScenario {
  readonly sim: Sim;
  /** Commands the scripted player issues for the step that runs at `tick` (state.tick before it). */
  commands(tick: number): Command[];
}

interface Spot {
  tx: number;
  ty: number;
}

/** (type, how many) in placement order. Everything after the first group is placed around the Town Center. */
const MIX: readonly { type: string; count: number }[] = [
  { type: 'lumberCamp', count: 12 },
  { type: 'miningCamp', count: 8 },
  { type: 'mill', count: 8 },
  { type: 'farm', count: 30 },
  { type: 'barracks', count: 6 },
  { type: 'archeryRange', count: 5 },
  { type: 'stable', count: 4 },
  { type: 'siegeWorkshop', count: 3 },
  { type: 'house', count: 73 },
];

/** Gatherers per kind of work: wood, farm, berries, gold, stone (sums to STRESS_UNITS). */
const WORK: readonly { resource: ResourceType; nodeType: string | 'farm'; count: number }[] = [
  { resource: 'wood', nodeType: 'tree', count: 90 },
  { resource: 'food', nodeType: 'farm', count: 30 },
  { resource: 'food', nodeType: 'berryBush', count: 30 },
  { resource: 'gold', nodeType: 'goldDeposit', count: 30 },
  { resource: 'stone', nodeType: 'stoneDeposit', count: 20 },
];

class Layout {
  readonly width: number;
  readonly height: number;
  readonly taken: Uint8Array;

  constructor(
    private readonly state: GameState,
    data: DataRegistry,
    occupancy: Uint8Array,
  ) {
    this.width = state.map.width;
    this.height = state.map.height;
    this.taken = new Uint8Array(occupancy);
    for (const e of state.entities) {
      if (e.kind === 'unit') continue;
      const def = data.def(e.typeId);
      const size = def !== undefined && (def.kind === 'building' || def.kind === 'node') ? def.footprint : 1;
      this.mark(e.tile.tx, e.tile.ty, size);
    }
  }

  mark(tx: number, ty: number, size: number): void {
    for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++) this.taken[y * this.width + x] = 1;
  }

  /** Free footprint with a one-tile free margin all round, nearest ring first, scanning row-major. */
  spot(size: number, cx: number, cy: number, margin = 1): Spot | null {
    const w = this.width;
    for (let r = 0; r < 70; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = cx + dx;
          const ty = cy + dy;
          if (tx - margin < 1 || ty - margin < 1 || tx + size + margin > w - 1 || ty + size + margin > this.height - 1) continue;
          let free = true;
          for (let y = ty - margin; y < ty + size + margin && free; y++) {
            for (let x = tx - margin; x < tx + size + margin; x++) {
              if (this.taken[y * w + x] !== 0) {
                free = false;
                break;
              }
            }
          }
          if (free) return { tx, ty };
        }
      }
    }
    return null;
  }
}

/** Entities of one node type, ascending id. */
function nodesOf(state: GameState, type: string): ResourceNodeEntity[] {
  return state.entities.filter((e): e is ResourceNodeEntity => e.kind === 'node' && e.typeId === type);
}

/** Build the stress match. Same seed, same match. */
export function createStressScenario(seed = 1, data: DataRegistry = registry): StressScenario {
  const config: GameConfig = { seed, mapSize: 120, players: [{ civ: 'byzantines' }] };
  const state = createInitialState(config, data);
  generateMap({ state, runtime: rebuildRuntime(state, data), data, events: [] } satisfies SimContext, config);

  const tc = state.entities.find((e): e is BuildingEntity => e.kind === 'building' && e.owner === STRESS_PLAYER) as BuildingEntity;
  const tcDef = data.building(tc.typeId);
  const tcx = tc.tile.tx + Math.floor(tcDef.footprint / 2);
  const tcy = tc.tile.ty + Math.floor(tcDef.footprint / 2);
  const layout = new Layout(state, data, rebuildRuntime(state, data).occupancy);

  // The starting villagers are part of the 200.
  const villagers: UnitEntity[] = state.entities.filter((e): e is UnitEntity => e.kind === 'unit');
  const need = STRESS_UNITS - villagers.length;
  const unitSpots: Spot[] = [];
  for (let r = 3; unitSpots.length < need && r < 40; r++) {
    for (let dy = -r; dy <= r && unitSpots.length < need; dy++) {
      for (let dx = -r; dx <= r && unitSpots.length < need; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = tcx + dx;
        const ty = tcy + dy;
        if (tx < 1 || ty < 1 || tx >= layout.width - 1 || ty >= layout.height - 1) continue;
        if (layout.taken[ty * layout.width + tx] !== 0 || (tx + ty) % 2 !== 0) continue;
        unitSpots.push({ tx, ty });
        layout.taken[ty * layout.width + tx] = 1;
      }
    }
  }
  for (const s of unitSpots) villagers.push(createUnit(state, 'villager', STRESS_PLAYER, s.tx + 0.5, s.ty + 0.5));

  // Buildings: camps next to their resource clusters, the rest around the Town Center.
  const trees = nodesOf(state, 'tree');
  const mines = [...nodesOf(state, 'goldDeposit'), ...nodesOf(state, 'stoneDeposit')];
  const berries = nodesOf(state, 'berryBush');
  let placed = 1; // the Town Center
  let k = 0;
  for (const { type, count } of MIX) {
    const def = data.building(type);
    for (let i = 0; i < count && placed < STRESS_BUILDINGS; i++, k++) {
      let ax = tcx;
      let ay = tcy;
      let anchor: ResourceNodeEntity | undefined;
      if (type === 'lumberCamp') anchor = trees[Math.floor(((i + 1) * trees.length) / (count + 1))];
      else if (type === 'miningCamp') anchor = mines[Math.floor(((i + 0.5) * mines.length) / count)];
      else if (type === 'mill') anchor = berries[Math.floor(((i + 0.5) * berries.length) / count)];
      if (anchor !== undefined) {
        ax = anchor.tile.tx;
        ay = anchor.tile.ty;
      }
      const spot = layout.spot(def.footprint, ax, ay);
      if (spot === null) continue;
      layout.mark(spot.tx, spot.ty, def.footprint);
      createBuilding(state, type, STRESS_PLAYER, spot.tx, spot.ty, true);
      placed++;
    }
  }

  // Gather orders: each worker takes the nearest node (or farm) of its kind that is still free.
  const farms = state.entities.filter((e): e is BuildingEntity => e.kind === 'building' && e.typeId === 'farm');
  const claimed = new Set<EntityId>();
  const pools: Record<string, (ResourceNodeEntity | BuildingEntity)[]> = {
    tree: trees,
    farm: farms,
    berryBush: berries,
    goldDeposit: nodesOf(state, 'goldDeposit'),
    stoneDeposit: nodesOf(state, 'stoneDeposit'),
  };
  let next = 0;
  for (const work of WORK) {
    const pool = pools[work.nodeType] as (ResourceNodeEntity | BuildingEntity)[];
    for (let i = 0; i < work.count && next < villagers.length; i++, next++) {
      const unit = villagers[next] as UnitEntity;
      const cap = work.nodeType === 'goldDeposit' || work.nodeType === 'stoneDeposit' ? 6 : 1;
      let best: ResourceNodeEntity | BuildingEntity | undefined;
      let bestD = 0;
      for (const n of pool) {
        const used = claimed.has(n.id) && cap === 1;
        if (used) continue;
        const dx = n.tile.tx - unit.pos.x;
        const dy = n.tile.ty - unit.pos.y;
        const d = dx * dx + dy * dy;
        if (best === undefined || d < bestD) {
          best = n;
          bestD = d;
        }
      }
      if (best === undefined) continue;
      claimed.add(best.id);
      unit.orderQueue.push({ type: 'gather', targetId: best.id });
    }
  }

  const sim = simFromState(state, data);
  const unitIds = villagers.map((v) => v.id);
  const treeIds = trees.map((t) => t.id);
  let seq = 1;

  return {
    sim,
    commands(tick: number): Command[] {
      // Every 25 ticks one tenth of the villagers is sent on an errand and then back to a tree.
      if (tick % 25 !== 0) return [];
      const round = tick / 25;
      const out: Command[] = [];
      const group = unitIds.filter((id) => (id + round) % 10 === 0);
      if (group.length === 0) return out;
      const alive = group.filter((id) => sim.query.entityById(id) !== undefined);
      if (alive.length === 0) return out;
      const w = state.map.width;
      // A destination on open ground (the first of a few candidates with nothing standing on it).
      let x = 0;
      let y = 0;
      for (let k = 0; k < 12; k++) {
        x = 8 + ((round * 37 + alive[0]! + k * 11) % (w - 16)) + 0.5;
        y = 8 + ((round * 53 + alive[0]! * 3 + k * 7) % (w - 16)) + 0.5;
        if (sim.query.entityAtPoint(x, y) === undefined) break;
      }
      out.push({ type: 'move', playerId: STRESS_PLAYER, seq: seq++, unitIds: alive, x, y, queue: false });
      for (const id of alive) {
        const treeId = treeIds[(id * 31 + round * 17) % treeIds.length] as EntityId;
        const t = sim.query.entityById(treeId);
        if (t === undefined) continue;
        out.push({ type: 'gather', playerId: STRESS_PLAYER, seq: seq++, unitIds: [id], nodeId: treeId, queue: true });
      }
      return out;
    },
  };
}
