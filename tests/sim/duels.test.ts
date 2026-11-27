/**
 * WP25/WP32: the counter matrix (PLAN-M2 5.3) and the siege rows as scripted duels on the real sim.
 *
 * Two groups of equal cost face each other 10 tiles apart on an empty 48x48 map and are given `attackMove` at each
 * other. Cell semantics: "W" = the row side wins with at least 30% of its cost surviving; "w" = the row side wins
 * (the plan says "narrowly"; `docs/BALANCE.md` lists the survivors the paper model expects); "L" = the row side loses.
 * Each duel runs twice and the final state hash must match.
 *
 * Combat is integrated, so every cell runs (WP32 switched the duels on). Each cell is also run at three army sizes and with
 * the two sides created in the opposite order; results and survivors are in `docs/BALANCE.md`.
 */

import { describe, expect, it } from 'vitest';
import { runCellSwapped } from './feelHarness';
import { registry } from '../../src/data';
import {
  DEFAULT_BUDGET,
  START_DISTANCE,
  cellLetter,
  costOf,
  countFor,
  createArena,
  distToFootprint,
  placeGroup,
  runBuildingKill,
  runCell,
  runClump,
  runDuel,
  runVillagersVsUnit,
  type DuelResult,
} from './duelHarness';

type Cell = 'W' | 'w' | 'L';

/** Section 5.3, row against column ("—" cells are absent). Same table as `tests/unit/data/balance.test.ts`. */
const MATRIX: Record<string, Record<string, Cell>> = {
  spearman: { swordsman: 'L', archer: 'L', horseman: 'W', cataphract: 'w', batteringRam: 'W', trebuchet: 'W' },
  swordsman: { spearman: 'W', archer: 'L', horseman: 'W', batteringRam: 'W', trebuchet: 'W' },
  archer: { spearman: 'W', swordsman: 'w', horseman: 'L', cataphract: 'L' },
  horseman: { swordsman: 'L', archer: 'W', cataphract: 'L', batteringRam: 'W', trebuchet: 'W' },
  cataphract: { spearman: 'L', swordsman: 'W', archer: 'W', horseman: 'W', batteringRam: 'W', trebuchet: 'W' },
};

const CELLS = Object.entries(MATRIX).flatMap(([row, cols]) => Object.entries(cols).map(([col, want]) => [row, col, want] as const));

function holds(want: Cell, r: DuelResult): boolean {
  if (want === 'L') return r.winner === 'b';
  if (want === 'w') return r.winner === 'a';
  return r.winner === 'a' && r.survivingA >= 0.3;
}

describe('duel harness (always on)', () => {
  it('equal-cost groups: counts follow the budget and the two sides differ by less than one unit', () => {
    expect(countFor('spearman')).toBe(20);
    expect(countFor('swordsman')).toBe(13);
    expect(countFor('archer')).toBe(16);
    expect(countFor('horseman')).toBe(15);
    expect(countFor('cataphract')).toBe(7);
    expect(countFor('batteringRam')).toBe(5);
    expect(countFor('trebuchet')).toBe(3);
    for (const [row, col] of CELLS) {
      const a = countFor(row) * costOf(row);
      const b = countFor(col) * costOf(col);
      expect(Math.abs(a - b), `${row}/${col}`).toBeLessThanOrEqual(Math.max(costOf(row), costOf(col)));
    }
  });

  it('places the groups in ranks facing each other, 10 tiles apart, inside the map and one unit per spot', () => {
    const state = createArena();
    const a = placeGroup(state, 1, { unit: 'spearman', count: 20 }, { x: 19, y: 24, dir: 1 });
    const b = placeGroup(state, 2, { unit: 'swordsman', count: 13 }, { x: 29, y: 24, dir: -1 });
    expect(a).toHaveLength(20);
    expect(b).toHaveLength(13);
    expect(a.map((u) => u.id)).toEqual([...a.map((u) => u.id)].sort((x, y) => x - y));
    expect(new Set([...a, ...b].map((u) => `${u.pos.x},${u.pos.y}`)).size).toBe(33);
    // The front ranks are 10 tiles apart; the other ranks stand behind them.
    expect(Math.min(...b.map((u) => u.pos.x)) - Math.max(...a.map((u) => u.pos.x))).toBe(START_DISTANCE);
    for (const u of [...a, ...b]) {
      expect(u.pos.x).toBeGreaterThan(0);
      expect(u.pos.x).toBeLessThan(48);
      expect(u.pos.y).toBeGreaterThan(0);
      expect(u.pos.y).toBeLessThan(48);
      expect(u.facing).toBe(u.owner === 1 ? 0 : 4);
    }
    // The clump spacing is 0.5 (siphon splash row).
    const clump = placeGroup(createArena(), 2, { unit: 'spearman', count: 10, stance: 'standGround' }, { x: 30, y: 24, dir: -1, spacing: 0.5, perRank: 4 });
    expect(clump.every((u) => u.stance === 'standGround')).toBe(true);
    const middle = clump[5]!;
    const near = clump.filter((u) => u !== middle && Math.hypot(u.pos.x - middle.pos.x, u.pos.y - middle.pos.y) <= 1);
    expect(near.length).toBeGreaterThanOrEqual(6);
  });

  it('footprint distance matches the sim rule (0 inside, edge distance outside)', () => {
    expect(registry.building('barracks').footprint).toBe(3);
    const fake = { tile: { tx: 10, ty: 10 }, typeId: 'barracks' } as unknown as Parameters<typeof distToFootprint>[2];
    expect(distToFootprint(11, 11, fake)).toBe(0);
    expect(distToFootprint(7, 11, fake)).toBe(3);
    expect(distToFootprint(16, 11, fake)).toBe(3);
    expect(distToFootprint(7, 7, fake)).toBeCloseTo(Math.sqrt(18), 9);
  });

  it('a short run is reproducible: two runs end in the same state hash, whatever the combat systems do', () => {
    const run = () => runCell('spearman', 'swordsman', DEFAULT_BUDGET, { maxSeconds: 3 });
    const first = run();
    const second = run();
    expect(first.hash).toBe(second.hash);
    expect(first.startCostA).toBe(1200);
    expect(first.startCostB).toBe(1170);
    expect(first.ticks).toBeGreaterThan(0);
    expect(first.seconds).toBeLessThanOrEqual(3.1);
  });

  it('upgrades are applied to the side that owns them', () => {
    const state = createArena({ 1: ['spathionForging'] });
    expect(state.players[1]!.researched).toEqual(['spathionForging']);
    expect(state.players[2]!.researched).toEqual([]);
  });

  it('cell letters', () => {
    const base = { ticks: 1, seconds: 0, startCostA: 1, startCostB: 1, hash: '', rejected: [], aliveA: 1, aliveB: 0 };
    expect(cellLetter({ ...base, winner: 'a', survivingA: 0.5, survivingB: 0 })).toBe('W');
    expect(cellLetter({ ...base, winner: 'a', survivingA: 0.1, survivingB: 0 })).toBe('w');
    expect(cellLetter({ ...base, winner: 'b', survivingA: 0, survivingB: 0.5 })).toBe('L');
    expect(cellLetter({ ...base, winner: 'none', survivingA: 0, survivingB: 0 })).toBe('=');
  });
});

describe('counter matrix on the real sim (PLAN-M2 5.3)', () => {
  it.each(CELLS)('%s vs %s: %s', (row, col, want) => {
    const first = runCell(row, col);
    const second = runCell(row, col);
    expect(second.hash, 'deterministic').toBe(first.hash);
    expect(first.rejected.filter((r) => r === 'invalidCommand'), 'no invalid commands').toEqual([]);
    expect(holds(want, first), `${row} vs ${col}: ${cellLetter(first)} (row keeps ${first.survivingA.toFixed(2)}, column keeps ${first.survivingB.toFixed(2)} after ${first.seconds}s)`).toBe(true);
  });

  // Survivors move by 10 to 20 points between sizes (the square law) but no cell changes sign, whichever side is created
  // first (ids decide ties, 4.1 rule 4) and whatever the budget.
  it.each(CELLS.filter(([, col]) => col !== 'batteringRam' && col !== 'trebuchet'))('%s vs %s (%s) holds at three army sizes and with the sides swapped', (row, col, want) => {
    for (const budget of [600, 1200, 2400]) {
      const first = runCell(row, col, budget);
      const swapped = runCellSwapped(row, col, budget);
      expect(holds(want, first), `${row} vs ${col} at ${budget}: ${cellLetter(first)} ${first.survivingA.toFixed(2)}/${first.survivingB.toFixed(2)}`).toBe(true);
      expect(holds(want, swapped), `${row} vs ${col} at ${budget}, swapped: ${cellLetter(swapped)} ${swapped.survivingA.toFixed(2)}/${swapped.survivingB.toFixed(2)}`).toBe(true);
    }
  });

  it('a duel mirrors: the same two groups with the sides swapped give the opposite result', () => {
    for (const [row, col] of [['swordsman', 'spearman'], ['archer', 'horseman'], ['cataphract', 'swordsman']] as const) {
      const ab = runDuel({ a: [{ unit: row, count: countFor(row) }], b: [{ unit: col, count: countFor(col) }] });
      const ba = runDuel({ a: [{ unit: col, count: countFor(col) }], b: [{ unit: row, count: countFor(row) }] });
      expect(ab.winner).not.toBe('none');
      expect(ba.winner).toBe(ab.winner === 'a' ? 'b' : 'a');
    }
  });

  it('equal-cost duels with an upgrade tilt the result towards its owner', () => {
    // Swordsmen against Cataphracts: a loss without upgrades (71% of the Cataphracts survive), a win with level I of the line.
    const plain = runCell('swordsman', 'cataphract', 1200);
    const upgraded = runCell('swordsman', 'cataphract', 1200, { researched: { 1: ['spathionForging', 'paddedKavadion'] } });
    expect(plain.winner).toBe('b');
    expect(upgraded.survivingA - upgraded.survivingB).toBeGreaterThan(plain.survivingA - plain.survivingB);
    expect(upgraded.survivingB).toBeLessThan(plain.survivingB);
  });
});

describe('siege rows on the real sim (PLAN-M2 5.3)', () => {
  it('2 Battering Rams destroy a Barracks in under 60 s', () => {
    const rams = runBuildingKill([{ unit: 'batteringRam', count: 2 }], 'barracks');
    expect(rams.seconds).not.toBeNull();
    expect(rams.seconds!).toBeLessThan(60);
    expect(runBuildingKill([{ unit: 'batteringRam', count: 2 }], 'barracks').hash).toBe(rams.hash);
  });

  it('10 Swordsmen need more than 3 times as long as 2 Battering Rams', () => {
    const rams = runBuildingKill([{ unit: 'batteringRam', count: 2 }], 'barracks');
    const swords = runBuildingKill([{ unit: 'swordsman', count: 10 }], 'barracks', { maxSeconds: 600 });
    expect(rams.seconds).not.toBeNull();
    expect(swords.seconds === null || swords.seconds > 3 * rams.seconds!).toBe(true);
  });

  it('a Trebuchet destroys a Town Center from outside its range without taking damage', () => {
    const run = runBuildingKill([{ unit: 'trebuchet', count: 1 }], 'townCenter', { gap: 14, maxSeconds: 400 });
    expect(run.seconds).not.toBeNull();
    expect(run.minAttackerHpFraction).toBe(1);
    const arrows = registry.building('townCenter').combat.attack!;
    expect(run.closest).toBeGreaterThan(arrows.range + registry.combat.reach);
  });

  it('6 Villagers kill a Battering Ram in under 30 s', () => {
    const run = runVillagersVsUnit(6, 'batteringRam');
    expect(run.seconds).not.toBeNull();
    expect(run.seconds!).toBeLessThan(30);
  });

  it('4 Siphonarioi deal at least 2.5 times the damage per second of 4 Swordsmen to a clump of 10 stand-ground Spearmen', () => {
    const siph = runClump([{ unit: 'siphonarios', count: 4 }]);
    const swords = runClump([{ unit: 'swordsman', count: 4 }]);
    expect(siph.dps).not.toBeNull();
    expect(swords.dps).not.toBeNull();
    expect(siph.dps! / swords.dps!).toBeGreaterThanOrEqual(2.5);
  });

  it('5 Siphonarioi destroy a Barracks in under 40% of the time 5 Swordsmen need', () => {
    const siph = runBuildingKill([{ unit: 'siphonarios', count: 5 }], 'barracks');
    const swords = runBuildingKill([{ unit: 'swordsman', count: 5 }], 'barracks', { maxSeconds: 600 });
    expect(siph.seconds).not.toBeNull();
    expect(swords.seconds === null || siph.seconds! < 0.4 * swords.seconds).toBe(true);
  });
});
