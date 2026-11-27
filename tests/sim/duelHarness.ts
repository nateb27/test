/**
 * Duel harness (WP25, PLAN-M2 8.1 "Counter matrix"): equal-cost scripted fights on an empty 48x48 map, run headless
 * through `sim.step`. Two groups face each other 10 tiles apart and are given `attackMove` at each other; siege rows
 * use `attack` against a building or a unit.
 *
 * It needs the combat systems of WP21 to WP24 (acquisition, attacks, projectiles, death), which have merged:
 * `COMBAT_INTEGRATED` is permanently true and the duels always run.
 *
 * Set-up is built from the public pieces the other sim tests use: `createInitialState` and `simFromState` for the
 * empty arena, `createUnit`/`createBuilding` to place entities (there is no placement cheat for buildings) and
 * `sim.step(commands)` for everything that happens afterwards.
 */

import { registry } from '../../src/data';
import { createBuilding, createUnit } from '../../src/sim/entities';
import { createInitialState, simFromState } from '../../src/sim/sim';
import { hashState } from '../../src/sim/hash';
import {
  TICK_RATE,
  type BuildingEntity,
  type Command,
  type CommandInput,
  type EntityId,
  type Sim,
  type SimEvent,
  type Stance,
  type TechId,
  type UnitEntity,
  type UnitId,
} from '../../src/sim/types';

/** Combat (WP21 to WP24) is integrated; kept as a constant so a test can still refer to it. */
export const COMBAT_INTEGRATED = true;

export const MAP_SIZE = 48;
/** Distance between the two group centres at the start (PLAN-M2 8.1). */
export const START_DISTANCE = 10;
/** Resource budget of an equal-cost duel (matches the paper model in `tests/unit/data/balanceModel.ts`). */
export const DEFAULT_BUDGET = 1200;
/** Safety cap of every run, in game seconds. */
export const MAX_SECONDS = 180;

const CENTRE = MAP_SIZE / 2;

export interface Group {
  unit: UnitId;
  count: number;
  stance?: Stance;
}

export interface Placement {
  /** Centre of the group, tiles. */
  x: number;
  y: number;
  /** +1 faces east (+x), -1 faces west: ranks stack behind the front, away from the enemy. */
  dir: 1 | -1;
  /** Spacing of the grid the units stand on (1.0 by default; clumps use 0.5). */
  spacing?: number;
  /** Units per rank (a rank is a line across the direction of travel). */
  perRank?: number;
}

export function costOf(unit: UnitId): number {
  return Object.values(registry.unit(unit).cost).reduce((a, b) => a + (b ?? 0), 0);
}

/** Number of `unit` whose total cost is nearest to `budget`, at least one. */
export function countFor(unit: UnitId, budget: number = DEFAULT_BUDGET): number {
  return Math.max(1, Math.round(budget / costOf(unit)));
}

/** A simulation on an empty map with players 1 and 2 (and an idle player 3 so the match is a sandbox that never ends). */
export function createArena(researched: { 1?: TechId[]; 2?: TechId[] } = {}) {
  const state = createInitialState(
    { seed: 7, mapSize: MAP_SIZE, players: [{ civ: 'byzantines' }, { civ: 'byzantines' }, { civ: 'byzantines' }] },
    registry,
  );
  state.players[1]!.researched.push(...(researched[1] ?? []));
  state.players[2]!.researched.push(...(researched[2] ?? []));
  return state;
}

type ArenaState = ReturnType<typeof createArena>;

/** Place a group in ranks and return the new entities. Creation order fixes the ids, so runs are reproducible. */
export function placeGroup(state: ArenaState, owner: number, group: Group, at: Placement): UnitEntity[] {
  const spacing = at.spacing ?? 1;
  const perRank = at.perRank ?? Math.min(group.count, 8);
  const ranks = Math.ceil(group.count / perRank);
  const out: UnitEntity[] = [];
  for (let i = 0; i < group.count; i += 1) {
    const rank = Math.floor(i / perRank);
    const inRank = i % perRank;
    const inThisRank = rank === ranks - 1 ? group.count - rank * perRank : perRank;
    const x = at.x - at.dir * rank * spacing;
    const y = at.y + (inRank - (inThisRank - 1) / 2) * spacing;
    const facing = at.dir === 1 ? 0 : 4;
    const unit = createUnit(state, group.unit, owner, x, y, facing);
    if (group.stance !== undefined) unit.stance = group.stance;
    out.push(unit);
  }
  return out;
}

/** Drives a state: stamps commands and counts rejections. */
export class Driver {
  readonly sim: Sim;
  readonly rejected: string[] = [];
  private readonly seq: Record<number, number> = { 1: 1, 2: 1 };

  constructor(readonly state: ArenaState) {
    this.sim = simFromState(state, registry);
  }

  get tick(): number {
    return this.sim.state.tick;
  }

  /** Issue commands for `owner` and advance one tick. */
  step(owner = 1, inputs: CommandInput[] = []): SimEvent[] {
    const commands = inputs.map((c) => ({ ...c, playerId: owner, seq: this.seq[owner]!++ }) as Command);
    return this.record(this.sim.step(commands));
  }

  /** Issue commands for both players in one tick (they apply at the start of the next tick, 4.1 rule 8). */
  stepBoth(a: CommandInput[], b: CommandInput[]): SimEvent[] {
    const commands = [
      ...a.map((c) => ({ ...c, playerId: 1, seq: this.seq[1]!++ }) as Command),
      ...b.map((c) => ({ ...c, playerId: 2, seq: this.seq[2]!++ }) as Command),
    ];
    return this.record(this.sim.step(commands));
  }

  private record(events: SimEvent[]): SimEvent[] {
    for (const e of events) if (e.type === 'CommandRejected') this.rejected.push(e.reason);
    return events;
  }

  unit(id: EntityId): UnitEntity | undefined {
    const e = this.sim.query.entityById(id);
    return e !== undefined && e.kind === 'unit' && e.hp > 0 ? (e as UnitEntity) : undefined;
  }

  building(id: EntityId): BuildingEntity | undefined {
    const e = this.sim.query.entityById(id);
    return e !== undefined && e.kind === 'building' && e.hp > 0 ? (e as BuildingEntity) : undefined;
  }

  hash(): string {
    return hashState(this.sim.state);
  }
}

export interface DuelSpec {
  a: Group[];
  b: Group[];
  distance?: number;
  /** Upgrades each side has researched before the fight. */
  researched?: { 1?: TechId[]; 2?: TechId[] };
  maxSeconds?: number;
}

export interface DuelResult {
  winner: 'a' | 'b' | 'none';
  ticks: number;
  seconds: number;
  /** Cost of the surviving units over the starting cost of that side, 0..1. */
  survivingA: number;
  survivingB: number;
  startCostA: number;
  startCostB: number;
  hash: string;
  rejected: string[];
  /** Number of units alive at the end, per side. */
  aliveA: number;
  aliveB: number;
}

/** Can `att` damage some unit of the other side at all (siege cannot hit units; a Villager only fights on command)? */
function canHurt(att: UnitEntity, defs: readonly UnitEntity[]): boolean {
  const c = registry.unit(att.typeId).combat;
  return c.targets === 'any' && c.autoAcquire && defs.length > 0;
}

/** Run one equal-cost duel (PLAN-M2 8.1): both groups attack-move at each other from `distance` tiles. */
export function runDuel(spec: DuelSpec): DuelResult {
  const distance = spec.distance ?? START_DISTANCE;
  const state = createArena(spec.researched);
  const left: Placement = { x: CENTRE - distance / 2, y: CENTRE, dir: 1 };
  const right: Placement = { x: CENTRE + distance / 2, y: CENTRE, dir: -1 };
  const a = spec.a.flatMap((g) => placeGroup(state, 1, g, left));
  const b = spec.b.flatMap((g) => placeGroup(state, 2, g, right));
  const startCostA = a.reduce((s, u) => s + costOf(u.typeId), 0);
  const startCostB = b.reduce((s, u) => s + costOf(u.typeId), 0);
  const world = new Driver(state);
  const idsA = a.map((u) => u.id);
  const idsB = b.map((u) => u.id);
  world.stepBoth(
    [{ type: 'attackMove', unitIds: idsA, x: CENTRE + distance / 2, y: CENTRE, queue: false }],
    [{ type: 'attackMove', unitIds: idsB, x: CENTRE - distance / 2, y: CENTRE, queue: false }],
  );
  const cap = Math.round((spec.maxSeconds ?? MAX_SECONDS) * TICK_RATE);
  const alive = (ids: EntityId[]) => ids.flatMap((id) => {
    const u = world.unit(id);
    return u === undefined ? [] : [u];
  });
  let ua = alive(idsA);
  let ub = alive(idsB);
  while (world.tick < cap) {
    if (!ua.some((u) => canHurt(u, ub)) || !ub.some((u) => canHurt(u, ua))) break;
    world.step();
    ua = alive(idsA);
    ub = alive(idsB);
  }
  // A side that is wiped out has no fighters; a side left with only siege (which cannot hurt units) has none either.
  const fighter = (u: UnitEntity) => registry.unit(u.typeId).combat.targets === 'any' && registry.unit(u.typeId).combat.autoAcquire;
  const fightersA = ua.some(fighter);
  const fightersB = ub.some(fighter);
  const winner: DuelResult['winner'] = fightersA && !fightersB ? 'a' : fightersB && !fightersA ? 'b' : 'none';
  const keep = (list: UnitEntity[]) => list.reduce((s, u) => s + costOf(u.typeId), 0);
  return {
    winner,
    ticks: world.tick,
    seconds: world.tick / TICK_RATE,
    survivingA: startCostA === 0 ? 0 : keep(ua) / startCostA,
    survivingB: startCostB === 0 ? 0 : keep(ub) / startCostB,
    startCostA,
    startCostB,
    hash: world.hash(),
    rejected: world.rejected,
    aliveA: ua.length,
    aliveB: ub.length,
  };
}

/** Equal-cost duel of `row` against `col` at `budget` (the 5.3 cells). */
export function runCell(row: UnitId, col: UnitId, budget: number = DEFAULT_BUDGET, extra: Partial<DuelSpec> = {}): DuelResult {
  return runDuel({ a: [{ unit: row, count: countFor(row, budget) }], b: [{ unit: col, count: countFor(col, budget) }], ...extra });
}

/** The matrix letter of a result for the row side (a): W (wins with at least 30% of its cost), w (wins), L (loses). */
export function cellLetter(r: DuelResult): 'W' | 'w' | 'L' | '=' {
  if (r.winner === 'b') return 'L';
  if (r.winner === 'a') return r.survivingA >= 0.3 ? 'W' : 'w';
  return '=';
}

// ---------------------------------------------------------------------------
// Siege and clump scenarios (PLAN-M2 5.3 "Siege rows")
// ---------------------------------------------------------------------------

export interface BuildingKillResult {
  /** Seconds until the building has no hp, or `null` if it survived the cap. */
  seconds: number | null;
  /** Lowest hp any attacker had during the run, as a fraction of its maximum (1 = never hurt). */
  minAttackerHpFraction: number;
  /** Smallest distance from any attacker to the building footprint during the run, tiles. */
  closest: number;
  hash: string;
  rejected: string[];
}

/** Distance from a point to the footprint rectangle of a building (0 inside). */
export function distToFootprint(x: number, y: number, b: BuildingEntity): number {
  const size = registry.building(b.typeId).footprint;
  const dx = Math.max(b.tile.tx - x, 0, x - (b.tile.tx + size));
  const dy = Math.max(b.tile.ty - y, 0, y - (b.tile.ty + size));
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Attackers of player 1 start `gap` tiles from the nearest edge of a completed enemy building and are ordered to attack
 * it. `defenders` (player 2, stand ground) may stand around it. Returns the time to destroy it.
 */
export function runBuildingKill(
  attackers: Group[],
  buildingType: string,
  options: { gap?: number; researched?: { 1?: TechId[]; 2?: TechId[] }; maxSeconds?: number } = {},
): BuildingKillResult {
  const gap = options.gap ?? START_DISTANCE;
  const size = registry.building(buildingType).footprint;
  const state = createArena(options.researched);
  const frontX = 10;
  const tx = Math.round(frontX + gap);
  const ty = Math.round(CENTRE - size / 2);
  const units = attackers.flatMap((g) => placeGroup(state, 1, g, { x: frontX, y: CENTRE, dir: 1 }));
  const building = createBuilding(state, buildingType, 2, tx, ty, true);
  const world = new Driver(state);
  const ids = units.map((u) => u.id);
  world.step(1, [{ type: 'attack', unitIds: ids, targetId: building.id, queue: false }]);
  const cap = Math.round((options.maxSeconds ?? MAX_SECONDS) * TICK_RATE);
  let minFraction = 1;
  let closest = Infinity;
  let seconds: number | null = null;
  while (world.tick < cap) {
    for (const id of ids) {
      const u = world.unit(id);
      if (u === undefined) {
        minFraction = 0;
        continue;
      }
      minFraction = Math.min(minFraction, u.hp / registry.unit(u.typeId).combat.hp);
      closest = Math.min(closest, distToFootprint(u.pos.x, u.pos.y, building));
    }
    if (world.building(building.id) === undefined) {
      seconds = world.tick / TICK_RATE;
      break;
    }
    world.step();
  }
  return { seconds, minAttackerHpFraction: minFraction, closest, hash: world.hash(), rejected: world.rejected };
}

export interface UnitKillResult {
  seconds: number | null;
  hash: string;
  rejected: string[];
}

/** `count` Villagers of player 1, `gap` tiles away, ordered to attack one stationary unit of player 2. */
export function runVillagersVsUnit(count: number, target: UnitId, gap = 6, maxSeconds = 90): UnitKillResult {
  const state = createArena();
  const victim = placeGroup(state, 2, { unit: target, count: 1, stance: 'standGround' }, { x: CENTRE + gap / 2, y: CENTRE, dir: -1 })[0]!;
  const villagers = placeGroup(state, 1, { unit: 'villager', count }, { x: CENTRE - gap / 2, y: CENTRE, dir: 1, perRank: 6 });
  const world = new Driver(state);
  world.step(1, [{ type: 'attack', unitIds: villagers.map((v) => v.id), targetId: victim.id, queue: false }]);
  const cap = Math.round(maxSeconds * TICK_RATE);
  let seconds: number | null = null;
  while (world.tick < cap) {
    if (world.unit(victim.id) === undefined) {
      seconds = world.tick / TICK_RATE;
      break;
    }
    world.step();
  }
  return { seconds, hash: world.hash(), rejected: world.rejected };
}

export interface ClumpResult {
  /** Seconds from the first point of damage until every Spearman of the clump is dead; `null` if some survived the cap. */
  seconds: number | null;
  /** Total clump hit points divided by `seconds`: the damage per second the attackers dealt to the clump. */
  dps: number | null;
  hash: string;
  rejected: string[];
}

/**
 * A clump of 10 stand-ground Spearmen of player 2 on a 0.5 grid (a 4 x 3 block of ten), and `attackers` of player 1
 * ordered to attack its middle unit from a short distance (aggressive units then work through the rest). Splash needs the tight spacing: with 1.0 spacing only the
 * four direct neighbours are inside the 1.0 radius (see `docs/BALANCE.md`).
 */
export function runClump(attackers: Group[], options: { maxSeconds?: number } = {}): ClumpResult {
  const state = createArena();
  const clump = placeGroup(state, 2, { unit: 'spearman', count: 10, stance: 'standGround' }, { x: 30, y: CENTRE, dir: -1, spacing: 0.5, perRank: 4 });
  const units = attackers.flatMap((g) => placeGroup(state, 1, g, { x: 26, y: CENTRE, dir: 1, perRank: 4 }));
  const world = new Driver(state);
  const hp = clump.reduce((s, u) => s + u.hp, 0);
  const middle = clump[5]!;
  world.step(1, [{ type: 'attack', unitIds: units.map((u) => u.id), targetId: middle.id, queue: false }]);
  const cap = Math.round((options.maxSeconds ?? 120) * TICK_RATE);
  let firstDamage: number | null = null;
  let seconds: number | null = null;
  while (world.tick < cap) {
    const left = clump.reduce((s, u) => s + (world.unit(u.id)?.hp ?? 0), 0);
    if (firstDamage === null && left < hp) firstDamage = world.tick;
    if (left === 0) {
      seconds = (world.tick - (firstDamage ?? world.tick)) / TICK_RATE;
      break;
    }
    world.step();
  }
  return { seconds, dps: seconds === null || seconds === 0 ? null : hp / seconds, hash: world.hash(), rejected: world.rejected };
}
