/**
 * WP32 feel numbers on the real sim (docs/BALANCE.md "Feel numbers"): how long raids, kills and repairs take, from the point
 * of view of a player. The bounds are wide enough to survive small tuning and narrow enough to fail when a number is off by
 * a factor (a unit that cannot kill a villager, a house that cannot fall, a Town Center that is free to raid).
 */

import { describe, expect, it } from 'vitest';
import { registry } from '../../src/data';
import type { TechId, UnitId } from '../../src/sim/types';
import { runBuildingKill, runCell } from './duelHarness';
import { runGroupVsVillager, runLoneUnitVsTownCenter, runRaid, runRepairFight } from './feelHarness';

const FIGHTERS: UnitId[] = ['spearman', 'swordsman', 'archer', 'horseman', 'cataphract', 'siphonarios'];

describe('kill times (5 units against one idle target, from 6 tiles)', () => {
  it.each(FIGHTERS)('5 %s kill a Villager in 1 to 10 seconds', (unit) => {
    const t = runGroupVsVillager(unit, 5);
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThan(1);
    expect(t!).toBeLessThan(10);
  });

  it('5 Villagers take longer than any soldier (they are not a military option)', () => {
    const t = runGroupVsVillager('villager', 5)!;
    expect(t).toBeGreaterThan(Math.max(...FIGHTERS.map((u) => runGroupVsVillager(u, 5)!)));
    expect(t).toBeLessThan(15);
  });

  it('non-production buildings fall to infantry in reasonable time (5 Swordsmen: house under 60 s, Mill under 70 s)', () => {
    const house = runBuildingKill([{ unit: 'swordsman', count: 5 }], 'house', { gap: 2 });
    const mill = runBuildingKill([{ unit: 'swordsman', count: 5 }], 'mill', { gap: 2 });
    expect(house.seconds).not.toBeNull();
    expect(house.seconds!).toBeLessThan(60);
    expect(mill.seconds).not.toBeNull();
    expect(mill.seconds!).toBeLessThan(70);
    const spears = runBuildingKill([{ unit: 'spearman', count: 5 }], 'house', { gap: 2 });
    expect(spears.seconds!).toBeLessThan(120);
  });

  it('production buildings and the Town Center need siege: 5 Swordsmen do not scratch them in two minutes, 5 Rams do', () => {
    for (const type of ['barracks', 'townCenter']) {
      const swords = runBuildingKill([{ unit: 'swordsman', count: 5 }], type, { gap: 2, maxSeconds: 120 });
      const hurt = swords.seconds === null;
      expect(hurt, `${type} survives 5 Swordsmen for two minutes`).toBe(true);
    }
    const rams = runBuildingKill([{ unit: 'batteringRam', count: 5 }], 'townCenter', { gap: 2, maxSeconds: 120 });
    expect(rams.seconds).not.toBeNull();
    expect(rams.seconds!).toBeLessThan(60);
  });
});

describe('Town Center arrows against a raid of five (5 idle Villagers beside it)', () => {
  it.each(['spearman', 'swordsman', 'archer', 'siphonarios'] as UnitId[])('%s: the raid kills the Villagers and loses one to three units', (unit) => {
    const r = runRaid(unit);
    expect(r.villagersDeadAt, 'the workers die').not.toBeNull();
    expect(r.raidersAlive, 'the Town Center hurts').toBeLessThanOrEqual(4);
    expect(r.raidersAlive, 'but does not wipe an early raid').toBeGreaterThanOrEqual(2);
  });

  it.each(['horseman', 'cataphract'] as UnitId[])('%s: a mounted raid is fast enough that the arrows cost it at most one unit', (unit) => {
    const r = runRaid(unit);
    expect(r.villagersDeadAt).not.toBeNull();
    expect(r.villagersDeadAt!).toBeLessThan(25);
    expect(r.raidersAlive).toBeGreaterThanOrEqual(4);
  });

  it('a Horseman raid is not free: the arrows (7 pierce, WP33) cost it a unit', () => {
    expect(runRaid('horseman').raidersAlive).toBeLessThanOrEqual(4);
  });

  it('a lone idle Horseman 3 tiles from a Town Center dies to its arrows within 320 ticks (PLAN-M2 8.2 scenario 8: about 300)', () => {
    const t = runLoneUnitVsTownCenter('horseman');
    expect(t).not.toBeNull();
    expect(t!).toBeLessThanOrEqual(320);
  });
});

describe('villager repair against three attackers', () => {
  it.each([['swordsman', 'house'], ['spearman', 'house'], ['horseman', 'house'], ['swordsman', 'barracks']] as [UnitId, string][])('3 Villagers keep a %s raid of 3 off the %s', (unit, building) => {
    const r = runRepairFight(unit, 3, building, 3);
    expect(r.destroyedAt, `${building} held for 90 s`).toBeNull();
    expect(r.hp).toBeGreaterThan(0);
  });

  it('siege outpaces repair: 3 Rams still destroy a Barracks with 5 Villagers repairing, and Siphonarioi burn the repairers down', () => {
    expect(runRepairFight('batteringRam', 3, 'barracks', 5).destroyedAt).not.toBeNull();
    expect(runRepairFight('siphonarios', 3, 'house', 5).destroyedAt).not.toBeNull();
  });
});

describe('no unit is dominated, and every upgrade changes a matchup', () => {
  const FIVE: UnitId[] = ['spearman', 'swordsman', 'archer', 'horseman', 'cataphract'];

  it('every unit beats at least one other and loses to at least one other at equal cost', () => {
    for (const row of FIVE) {
      const results = FIVE.filter((c) => c !== row).map((col) => runCell(row, col).winner);
      expect(results, `${row} wins somewhere`).toContain('a');
      expect(results, `${row} loses somewhere`).toContain('b');
    }
  });

  const TECHS: [string, TechId[]][] = [
    ['spathionForging', ['spathionForging']],
    ['strategikonDrill', ['spathionForging', 'strategikonDrill']],
    ['paddedKavadion', ['paddedKavadion']],
    ['lamellarKlibanion', ['paddedKavadion', 'lamellarKlibanion']],
    ['hornSinewBows', ['hornSinewBows']],
    ['solenarionGuides', ['hornSinewBows', 'solenarionGuides']],
    ['bambakionCoats', ['bambakionCoats']],
    ['mailLorikion', ['bambakionCoats', 'mailLorikion']],
    ['kontarionDrill', ['kontarionDrill']],
    ['taktikaWedge', ['kontarionDrill', 'taktikaWedge']],
    ['feltHorseBards', ['feltHorseBards']],
    ['ironHorseBards', ['feltHorseBards', 'ironHorseBards']],
  ];

  it('the list covers all twelve military techs', () => {
    expect(registry.techs.filter((t) => t.tags?.includes('militaryTech')).map((t) => t.id).sort()).toEqual(TECHS.map(([id]) => id).sort());
  });

  it.each(TECHS)('%s moves the survivors of at least one equal-cost duel by 5 points or more', (_name, techs) => {
    let best = 0;
    for (const row of FIVE) {
      for (const col of FIVE) {
        if (row === col) continue;
        const base = runCell(row, col);
        const up = runCell(row, col, 1200, { researched: { 1: techs } });
        best = Math.max(best, Math.abs(up.survivingA - up.survivingB - (base.survivingA - base.survivingB)));
      }
    }
    expect(best).toBeGreaterThanOrEqual(0.05);
  });
});
