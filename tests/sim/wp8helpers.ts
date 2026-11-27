/** Shared scaffolding for the WP8 (production, research, ages) tests. */

import { createRegistry, registry } from '../../src/data/index';
import type { DataRegistry, TechDef } from '../../src/data/schema';
import { createBuilding } from '../../src/sim/entities';
import { buildOccupancy } from '../../src/sim/map/occupancy';
import { rebuildRuntime } from '../../src/sim/runtime';
import { createGame, simFromState } from '../../src/sim/sim';
import { recomputePopulation } from '../../src/sim/systems/population';
import type {
  BuildingEntity,
  Command,
  CommandInput,
  GameState,
  PlayerId,
  Sim,
  SimContext,
  SimEvent,
} from '../../src/sim/types';

export interface Game {
  sim: Sim;
  state: GameState;
  data: DataRegistry;
  seq: number;
}

/** A fresh match; `state` is the live (mutable) state of `sim`. */
export function makeGame(opts: { players?: number; data?: DataRegistry; civ?: string; seed?: number } = {}): Game {
  const data = opts.data ?? registry;
  const n = opts.players ?? 1;
  const sim = createGame(
    { seed: opts.seed ?? 11, mapSize: 120, players: Array.from({ length: n }, () => ({ civ: opts.civ ?? 'byzantines' })) },
    data,
  );
  return { sim, state: sim.state as GameState, data, seq: 1 };
}

/** Re-wrap the (mutated) state in a Sim so runtime caches match it, as after a load. */
export function reload(g: Game): void {
  g.sim = simFromState(g.state, g.data);
  g.state = g.sim.state as GameState;
}

/** A SimContext over the game's state (for calling systems directly). */
export function ctxOf(g: Game): SimContext {
  const ctx: SimContext = { state: g.state, runtime: rebuildRuntime(g.state, g.data), data: g.data, events: [] };
  recomputePopulation(ctx);
  return ctx;
}

/** Stamp playerId and seq on command inputs. */
export function cmd(g: Game, playerId: PlayerId, input: CommandInput): Command {
  return { ...input, playerId, seq: g.seq++ } as Command;
}

export function step(g: Game, ...inputs: [PlayerId, CommandInput][]): SimEvent[] {
  return g.sim.step(inputs.map(([p, c]) => cmd(g, p, c)));
}

/** Find a tile whose (size+2)^2 neighbourhood is free, scanning row-major from (30, 30). */
export function findFree(g: Game, size: number): { tx: number; ty: number } {
  const occ = buildOccupancy(g.state, g.data);
  const w = g.state.map.width;
  for (let ty = 30; ty < w - size - 2; ty++) {
    for (let tx = 30; tx < w - size - 2; tx++) {
      let free = true;
      for (let y = ty - 1; y <= ty + size && free; y++) {
        for (let x = tx - 1; x <= tx + size; x++) {
          if (occ[y * w + x] !== 0) {
            free = false;
            break;
          }
        }
      }
      if (free) return { tx, ty };
    }
  }
  throw new Error('no free area');
}

/** Create a building on a free area. Does not rebuild the runtime: call `reload` or `ctxOf` after. */
export function place(
  g: Game,
  type: string,
  owner: PlayerId = 1,
  constructed = true,
  at?: { tx: number; ty: number },
): BuildingEntity {
  const size = g.data.building(type).footprint;
  const { tx, ty } = at ?? findFree(g, size);
  return createBuilding(g.state, type, owner, tx, ty, constructed);
}

export function townCenter(g: Game, owner: PlayerId = 1): BuildingEntity {
  const tc = g.state.entities.find((e) => e.kind === 'building' && e.owner === owner && e.typeId === 'townCenter');
  if (tc === undefined || tc.kind !== 'building') throw new Error('no town center');
  return tc;
}

export function giveResources(g: Game, owner: PlayerId = 1, amount = 100_000): void {
  const r = g.state.players[owner]!.resources;
  r.food = r.wood = r.gold = r.stone = amount;
}

/** The shared registry plus extra techs and a second civ, for rules that need data the real tables lack. */
export function extendedData(extraTechs: TechDef[] = []): DataRegistry {
  return createRegistry({
    units: registry.units,
    buildings: registry.buildings,
    techs: [...registry.techs, ...extraTechs],
    ages: registry.ages,
    civs: [...registry.civs, { ...registry.civ('byzantines'), id: 'romans', name: 'Romans', bonuses: [], uniques: [] }],
    nodes: registry.nodes,
    terrains: registry.terrains,
    start: registry.start,
    combat: registry.combat,
  });
}
