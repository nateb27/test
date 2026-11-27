/**
 * WP25 paper review of PLAN-M2 section 5: the counter matrix (5.3), the siege rows and the upgrade effects, computed
 * from the real data with the model in `balanceModel.ts` (the damage formula of 4.1 and the timing of 4.3 in a
 * one-dimensional fight). These tests guard the numbers in `src/data`; the real-sim duels in `tests/sim/duels.test.ts`
 * are the ground truth once combat is integrated. Results are quoted in `docs/BALANCE.md`.
 *
 * Cell semantics (5.3): "W" = the row side wins with at least 30% of its cost surviving; "w" = the row side wins (the
 * plan says "narrowly"; the test only demands a win, see BALANCE.md for the survivors); "L" = the row side loses.
 */

import { describe, expect, it } from 'vitest';
import { registry } from '../../../src/data';
import { baseProfile, buildingKillSeconds, clumpDps, costTotal, countFor, duel, equalCost, hit, hitBuilding, letter, timeToKill } from './balanceModel';

type Cell = 'W' | 'w' | 'L';
const UNITS = ['spearman', 'swordsman', 'archer', 'horseman', 'cataphract'] as const;

/** Section 5.3, row against column. Cells with "—" are absent. */
const MATRIX: Record<string, Record<string, Cell>> = {
  spearman: { swordsman: 'L', archer: 'L', horseman: 'W', cataphract: 'w' },
  swordsman: { spearman: 'W', archer: 'L', horseman: 'W' },
  archer: { spearman: 'W', swordsman: 'w', horseman: 'L', cataphract: 'L' },
  horseman: { swordsman: 'L', archer: 'W', cataphract: 'L' },
  cataphract: { spearman: 'L', swordsman: 'W', archer: 'W', horseman: 'W' },
};

function holds(want: Cell, o: ReturnType<typeof duel>): boolean {
  if (want === 'L') return o.winner === 'b';
  if (want === 'w') return o.winner === 'a';
  return o.winner === 'a' && o.survivingA >= 0.3;
}

describe('counter matrix on paper (PLAN-M2 5.3)', () => {
  const cells = Object.entries(MATRIX).flatMap(([row, cols]) => Object.entries(cols).map(([col, want]) => [row, col, want] as const));

  it.each(cells.flatMap(([r, c, w]) => [900, 1000, 1200, 1500, 1800].map((budget) => [r, c, w, budget] as const)))(
    '%s vs %s: %s at a budget of %i',
    (row, col, want, budget) => {
      const o = equalCost(row, col, budget);
      expect(holds(want, o), `${row} vs ${col}: ${letter(o)} (row keeps ${o.survivingA.toFixed(2)}, column keeps ${o.survivingB.toFixed(2)})`).toBe(true);
    },
  );

  it('the matrix is consistent: a cell and its mirror describe the same duel', () => {
    for (const [row, cols] of Object.entries(MATRIX)) {
      for (const [col, want] of Object.entries(cols)) {
        const mirror = MATRIX[col]?.[row];
        if (mirror === undefined) continue;
        if (want === 'L') expect(mirror, `${row}/${col}`).not.toBe('L');
        else expect(mirror, `${row}/${col}`).toBe('L');
      }
    }
  });

  it('the equal-cost groups really are equal in cost (within one unit)', () => {
    for (const a of UNITS) {
      for (const b of UNITS) {
        if (a === b) continue;
        const ca = countFor(a, 1200) * costTotal(a);
        const cb = countFor(b, 1200) * costTotal(b);
        expect(Math.abs(ca - cb), `${a}/${b}`).toBeLessThanOrEqual(Math.max(costTotal(a), costTotal(b)));
      }
    }
  });

  it('siege units win every duel against units that can fight, and cannot answer back', () => {
    for (const siege of ['batteringRam', 'trebuchet']) {
      const p = baseProfile(siege);
      expect(p.targets).toBe('buildings');
      for (const u of UNITS) {
        const o = duel({ units: [[u, countFor(u, 1200)]] }, { units: [[siege, countFor(siege, 1200)]] });
        expect(o.winner, `${u} vs ${siege}`).toBe('a');
        expect(o.survivingA, `${u} vs ${siege}`).toBe(1);
      }
    }
  });

  it('the Archer can hardly hurt a Battering Ram (1 damage a hit) but not a Horseman either', () => {
    expect(hit(baseProfile('archer'), baseProfile('batteringRam'))).toBe(1);
    expect(hit(baseProfile('archer'), baseProfile('horseman'))).toBe(3);
  });
});

describe('siege rows on paper (PLAN-M2 5.3)', () => {
  const barracks = registry.building('barracks');
  const GAP = 10; // tiles from the start to the footprint edge

  it('2 Battering Rams destroy a Barracks in under 60 s', () => {
    expect(buildingKillSeconds('batteringRam', 2, 'barracks', GAP)).toBeLessThan(60);
    // 4 attack against melee armour 6 is floored at 1 damage, then the +60 against buildings.
    expect(hitBuilding(baseProfile('batteringRam'), barracks)).toBe(1 + 60);
  });

  // Production buildings have melee armour 6 (Town Center 8): a Swordsman does 2 damage a blow, a Spearman or Horseman 1,
  // so infantry and cavalry raze them slowly and siege is strongly preferred (docs/BALANCE.md, "Building armour"). With
  // the original armour of 2 the row failed: 10 Swordsmen were about as fast as 2 rams. The row asks for more than 2x
  // since the verification fix pass (was 3x at armour 7, where a Township army needed two minutes for a Barracks).
  it('10 Swordsmen need more than 2 times as long as 2 rams for a Barracks', () => {
    const rams = buildingKillSeconds('batteringRam', 2, 'barracks', GAP);
    const swords = buildingKillSeconds('swordsman', 10, 'barracks', GAP);
    expect(swords).toBeGreaterThan(2 * rams);
    expect(hitBuilding(baseProfile('swordsman'), barracks)).toBe(2);
    expect(hitBuilding(baseProfile('spearman'), barracks)).toBe(1);
    expect(hitBuilding(baseProfile('horseman'), barracks)).toBe(1);
  });

  it('the row would fail with the original 5.2 armour (melee armour 2): the reason for armour 6', () => {
    const old = { meleeArmor: 2 };
    const rams = buildingKillSeconds('batteringRam', 2, 'barracks', GAP, old);
    const swords = buildingKillSeconds('swordsman', 10, 'barracks', GAP, old);
    expect(swords).toBeLessThan(2 * rams);
  });

  it('a Trebuchet outranges the Town Center arrows by at least 3 tiles', () => {
    const treb = baseProfile('trebuchet');
    const tc = registry.building('townCenter').combat.attack;
    expect(tc).toBeDefined();
    expect(treb.reach - ((tc?.range ?? 0) + registry.combat.reach)).toBeGreaterThanOrEqual(3);
    // 151 a stone against the Town Center's 8 pierce armour: 16 stones, one every 8 s.
    expect(hitBuilding(treb, registry.building('townCenter'))).toBe(151);
    expect(Math.ceil(2400 / 151)).toBe(16);
  });

  it('6 Villagers kill a Battering Ram in under 30 s', () => {
    const v = baseProfile('villager');
    const ram = baseProfile('batteringRam');
    expect(hit(v, ram)).toBe(3);
    const hits = Math.ceil(ram.maxHp / hit(v, ram));
    const perVillager = Math.ceil(hits / 6);
    const walk = Math.max(0, 6 - v.reach) / registry.unit('villager').speed;
    const seconds = walk + (v.windupTicks + (perVillager - 1) * v.cooldownTicks) / 20;
    expect(seconds).toBeLessThan(30);
  });

  it('4 Siphonarioi deal at least 2.5x the damage per second of 4 Swordsmen to a tight clump of 10 Spearmen', () => {
    // A clump with six or more other Spearmen inside the splash radius (1.25) of the target: the duel harness packs the
    // 10 stand-ground Spearmen on a 0.5 grid, where the middle ones have 8 or 9 neighbours.
    const siph = clumpDps('siphonarios', 4, 'spearman', 8);
    const swords = clumpDps('swordsman', 4, 'spearman', 0);
    expect(siph / swords).toBeGreaterThanOrEqual(2.5);
    // The ratio depends on the clump: 5 neighbours is not enough (the harness fixes the spacing for that reason).
    expect(clumpDps('siphonarios', 4, 'spearman', 4) / swords).toBeLessThan(2.5);
  });

  it('5 Siphonarioi destroy a Barracks in under 40% of the time 5 Swordsmen need', () => {
    const siph = buildingKillSeconds('siphonarios', 5, 'barracks', GAP);
    const swords = buildingKillSeconds('swordsman', 5, 'barracks', GAP);
    expect(siph).toBeLessThan(0.4 * swords);
  });
});

describe('time to kill (1 against 1, from the damage formula)', () => {
  it('the cheap counters hold on a per-unit basis', () => {
    const spear = baseProfile('spearman');
    const horse = baseProfile('horseman');
    const sword = baseProfile('swordsman');
    const cata = baseProfile('cataphract');
    const archer = baseProfile('archer');
    // 3 Spearmen (180) beat 1 Cataphract (170) by a hair: they kill it before it kills all three.
    expect(timeToKill(spear, horse)).toBeLessThan(timeToKill(horse, spear));
    expect(hit(spear, cata)).toBe(8); // 5 - 3 + floor(12 * 50%)
    expect(hit(sword, spear)).toBe(12);
    expect(hit(archer, spear)).toBe(9);
    expect(hit(cata, sword)).toBe(11);
  });

  it('every unit that fights has a finite time to kill every unit it can hurt', () => {
    for (const a of registry.units) {
      if (a.combat.targets !== 'any') continue;
      for (const d of registry.units) {
        const t = timeToKill(baseProfile(a.id), baseProfile(d.id));
        expect(Number.isFinite(t)).toBe(true);
        expect(t).toBeGreaterThan(0);
      }
    }
  });
});
