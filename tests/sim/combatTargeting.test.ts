/**
 * Hardened targets (PLAN-M2 4.5 as amended by WP33; docs/DESIGN.md "WP33"): automatic target choice (acquisition,
 * retaliation, retargeting, hold) ranks an enemy building the unit can only scratch (damage per blow at most
 * `minDamage`) below every other candidate and never retaliates against it, so an attack-moving army hit by Town
 * Center arrows kills the units beside it instead of spending 1-damage blows on the Town Center. Explicit `attack`
 * orders and siege are unaffected.
 */

import { describe, expect, it } from 'vitest';
import { createBuilding } from '../../src/sim/entities';
import type { CommandInput, UnitId } from '../../src/sim/types';
import { Driver, MAP_SIZE, createArena, placeGroup } from './duelHarness';

const C = MAP_SIZE / 2;

/**
 * `count` attackers of player 1 attack-move from 12 tiles away to the spot of 5 idle Villagers of player 2 standing
 * beside player 2's Town Center (footprint (C+4, C-2) to (C+8, C+2)). Returns what happened after `seconds`.
 */
function attackMoveRaid(unit: UnitId, count: number, seconds: number, villagers = 5) {
  const state = createArena();
  const tc = createBuilding(state, 'townCenter', 2, C + 4, C - 2, true);
  const vs = placeGroup(state, 2, { unit: 'villager', count: villagers }, { x: C + 9, y: C - 4, dir: 1, perRank: 5 });
  const us = placeGroup(state, 1, { unit, count }, { x: C - 8, y: C, dir: 1, perRank: 5 });
  const world = new Driver(state);
  world.step(1, [
    {
      type: 'attackMove',
      unitIds: us.map((u) => u.id),
      x: C + 9,
      y: C - 4,
      queue: false,
    } as CommandInput,
  ]);
  let tcHpWhileVillagers = 2400;
  for (let t = 0; t < seconds * 20; t++) {
    world.step();
    if (vs.some((v) => world.unit(v.id) !== undefined)) tcHpWhileVillagers = world.building(tc.id)?.hp ?? 0;
  }
  return {
    villagersAlive: vs.filter((v) => world.unit(v.id) !== undefined).length,
    raidersAlive: us.filter((u) => world.unit(u.id) !== undefined).length,
    tcHp: world.building(tc.id)?.hp ?? 0,
    tcHpWhileVillagers,
  };
}

describe('hardened targets: an attack-move into Town Center range goes for the units, not the Town Center', () => {
  it.each(['spearman', 'swordsman', 'horseman', 'archer'] as UnitId[])(
    '5 %s attack-moved at the Villagers beside a Town Center kill them',
    (unit) => {
      const r = attackMoveRaid(unit, 5, 90);
      expect(r.villagersAlive, 'the Villagers die').toBe(0);
      expect(2400 - r.tcHpWhileVillagers, 'at most a few blows land on the Town Center while a Villager lives').toBeLessThanOrEqual(10);
    },
  );

  it('siege still prefers buildings: Rams attack-moved at the Villagers attack the Town Center', () => {
    const r = attackMoveRaid('batteringRam', 3, 40);
    expect(r.tcHp).toBeLessThan(2400);
  });

  it('a Cataphract (6 a blow) and a Siphonarios still count the Town Center as a target in tier 3', () => {
    // Without units in sight, both hit the Town Center when its arrows hit them.
    for (const unit of ['cataphract', 'siphonarios'] as UnitId[]) {
      const r = attackMoveRaid(unit, 3, 40, 0);
      expect(r.tcHp, unit).toBeLessThan(2400);
    }
  });

  it('with nothing else in sight, a unit still takes on the Town Center (tier 4 is the last choice, not excluded)', () => {
    const r = attackMoveRaid('swordsman', 3, 30, 0);
    expect(r.tcHp).toBeLessThan(2400);
  });

  it('an explicit attack order on the Town Center is obeyed', () => {
    const state = createArena();
    const tc = createBuilding(state, 'townCenter', 2, C + 4, C - 2, true);
    placeGroup(state, 2, { unit: 'villager', count: 3 }, { x: C + 9, y: C - 4, dir: 1, perRank: 5 });
    const us = placeGroup(state, 1, { unit: 'swordsman', count: 3 }, { x: C + 1, y: C, dir: 1 });
    const world = new Driver(state);
    world.step(1, [
      {
        type: 'attack',
        unitIds: us.map((u) => u.id),
        targetId: tc.id,
        queue: false,
      } as CommandInput,
    ]);
    for (let t = 0; t < 200; t++) world.step();
    expect(world.building(tc.id)!.hp).toBeLessThan(2400);
    for (const u of us) {
      const live = world.unit(u.id);
      if (live !== undefined)
        expect(live.currentOrder).toMatchObject({
          type: 'attack',
          targetId: tc.id,
        });
    }
  });

  it('a unit scratching a hardened Barracks turns on a Villager that comes into sight', () => {
    const state = createArena();
    const barracks = createBuilding(state, 'barracks', 2, C, C, true);
    placeGroup(state, 1, { unit: 'spearman', count: 1 }, { x: C - 1, y: C + 1.5, dir: 1 });
    const vil = placeGroup(state, 2, { unit: 'villager', count: 1 }, { x: C - 12, y: C + 1.5, dir: 1 })[0]!;
    const world = new Driver(state);
    for (let t = 0; t < 100; t++) world.step();
    expect(world.building(barracks.id)!.hp, 'nothing else in sight: the Barracks is a target').toBeLessThan(1200);
    world.step(2, [
      {
        type: 'move',
        unitIds: [vil.id],
        x: C - 4,
        y: C + 1.5,
        queue: false,
      } as CommandInput,
    ]);
    for (let t = 0; t < 600 && world.unit(vil.id) !== undefined; t++) world.step();
    expect(world.unit(vil.id), 'the Villager is killed').toBeUndefined();
  });
});
