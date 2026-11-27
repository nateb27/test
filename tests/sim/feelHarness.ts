/**
 * Feel numbers (WP32, docs/BALANCE.md "Feel numbers"): kill times, raids on a Town Center and repair under attack, run on
 * the real sim with the duel harness's arena. Everything is scripted through `sim.step(commands)`.
 */

import { registry } from '../../src/data';
import { createBuilding } from '../../src/sim/entities';
import { TICK_RATE, type CommandInput, type UnitId } from '../../src/sim/types';
import { DEFAULT_BUDGET, Driver, MAP_SIZE, countFor, createArena, placeGroup, runDuel, type DuelResult, type DuelSpec } from './duelHarness';

const CENTRE = MAP_SIZE / 2;

/** `runCell` with the creation order and the player sides swapped; the result is reported for the row side (`a`). */
export function runCellSwapped(row: UnitId, col: UnitId, budget: number = DEFAULT_BUDGET, extra: Partial<DuelSpec> = {}): DuelResult {
  const r = runDuel({ a: [{ unit: col, count: countFor(col, budget) }], b: [{ unit: row, count: countFor(row, budget) }], ...extra });
  const winner: DuelResult['winner'] = r.winner === 'a' ? 'b' : r.winner === 'b' ? 'a' : 'none';
  return { ...r, winner, survivingA: r.survivingB, survivingB: r.survivingA, startCostA: r.startCostB, startCostB: r.startCostA, aliveA: r.aliveB, aliveB: r.aliveA };
}

/** Seconds for `count` units of player 1, `gap` tiles away, to kill one idle Villager of player 2 (`null` after `maxSeconds`). */
export function runGroupVsVillager(unit: UnitId, count: number, gap = 6, maxSeconds = 60): number | null {
  const state = createArena();
  const victim = placeGroup(state, 2, { unit: 'villager', count: 1 }, { x: CENTRE + gap / 2, y: CENTRE, dir: -1 })[0]!;
  const us = placeGroup(state, 1, { unit, count }, { x: CENTRE - gap / 2, y: CENTRE, dir: 1, perRank: 5 });
  const world = new Driver(state);
  world.step(1, [{ type: 'attack', unitIds: us.map((u) => u.id), targetId: victim.id, queue: false }]);
  while (world.tick < maxSeconds * TICK_RATE) {
    if (world.unit(victim.id) === undefined) return world.tick / TICK_RATE;
    world.step();
  }
  return null;
}

export interface RaidResult {
  /** Seconds until every Villager is dead (`null`: some survived, or the raid died first). */
  villagersDeadAt: number | null;
  raidersAlive: number;
  villagersAlive: number;
  tcHp: number;
}

/**
 * `count` raiders of player 1 start 12 tiles from a Town Center of player 2 with `villagers` idle Villagers beside it and are
 * ordered to attack the Villagers one after the other (a raid on the workers). Ends when all Villagers are dead, the raid is
 * dead or the cap is reached.
 */
export function runRaid(unit: UnitId, count = 5, villagers = 5, maxSeconds = 120): RaidResult {
  const state = createArena();
  const tc = createBuilding(state, 'townCenter', 2, CENTRE + 4, CENTRE - 2, true);
  const vs = placeGroup(state, 2, { unit: 'villager', count: villagers }, { x: CENTRE + 8, y: CENTRE - 4, dir: 1, perRank: 5 });
  const us = placeGroup(state, 1, { unit, count }, { x: CENTRE - 8, y: CENTRE, dir: 1, perRank: 5 });
  const world = new Driver(state);
  const ids = us.map((u) => u.id);
  world.step(1, vs.map((v, i) => ({ type: 'attack', unitIds: ids, targetId: v.id, queue: i > 0 }) as CommandInput));
  let deadAt: number | null = null;
  while (world.tick < maxSeconds * TICK_RATE) {
    if (vs.every((v) => world.unit(v.id) === undefined)) {
      deadAt = world.tick / TICK_RATE;
      break;
    }
    if (us.every((u) => world.unit(u.id) === undefined)) break;
    world.step();
  }
  return {
    villagersDeadAt: deadAt,
    raidersAlive: us.filter((u) => world.unit(u.id) !== undefined).length,
    villagersAlive: vs.filter((v) => world.unit(v.id) !== undefined).length,
    tcHp: world.building(tc.id)?.hp ?? 0,
  };
}

export interface RepairFightResult {
  /** Seconds after repairs began until the building fell (`null`: it held to the cap). */
  destroyedAt: number | null;
  hp: number;
}

/**
 * `attackers` of player 1 attack a completed building of player 2 (given resources to pay) from 6 tiles away; once the
 * building is hurt and 5 s have passed `repairers` Villagers start repairing, and are re-ordered whenever a repair order has
 * run out (a repair order ends at full hp; M2 has no automatic repair).
 */
export function runRepairFight(attacker: UnitId, attackers: number, buildingType: string, repairers: number, maxSeconds = 90): RepairFightResult {
  const state = createArena();
  const size = registry.building(buildingType).footprint;
  const maxHp = registry.building(buildingType).combat.hp;
  const b = createBuilding(state, buildingType, 2, CENTRE + 4, Math.round(CENTRE - size / 2), true);
  const vs = placeGroup(state, 2, { unit: 'villager', count: repairers }, { x: CENTRE + 4 + size + 1.5, y: CENTRE, dir: 1, perRank: 5 });
  const us = placeGroup(state, 1, { unit: attacker, count: attackers }, { x: CENTRE - 2, y: CENTRE, dir: 1, perRank: 5 });
  state.players[2]!.resources = { food: 5000, wood: 5000, gold: 5000, stone: 5000 };
  const world = new Driver(state);
  world.stepBoth([{ type: 'attack', unitIds: us.map((u) => u.id), targetId: b.id, queue: false }], []);
  for (let i = 0; i < 20 * TICK_RATE && (world.building(b.id)?.hp ?? 0) >= maxHp; i += 1) world.step();
  for (let i = 0; i < 5 * TICK_RATE; i += 1) world.step();
  const repair = (): CommandInput => ({ type: 'repair', unitIds: vs.map((v) => v.id), buildingId: b.id, queue: false });
  world.step(2, [repair()]);
  const start = world.tick;
  while (world.tick - start < maxSeconds * TICK_RATE) {
    const cur = world.building(b.id);
    if (cur === undefined) return { destroyedAt: (world.tick - start) / TICK_RATE, hp: 0 };
    if ((world.tick - start) % 10 === 0 && cur.repairerIds.length < repairers && cur.hp < maxHp) world.step(2, [repair()]);
    else world.step();
  }
  return { destroyedAt: null, hp: world.building(b.id)?.hp ?? 0 };
}
