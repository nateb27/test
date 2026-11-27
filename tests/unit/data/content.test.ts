import { describe, expect, it } from 'vitest';
import { registry } from '../../../src/data/index';
import type { BuildingDef, ProducibleDef, ResourceAmounts } from '../../../src/data/schema';

const CIV = 'byzantines';
const r = registry;
const producibles: ProducibleDef[] = [...r.units, ...r.buildings, ...r.techs];
const allIds = [...producibles.map((d) => d.id), ...r.nodes.map((n) => n.id)];

/** Defs the given civ can ever have, honouring `civs` and `replaces`. */
function civDefs(civ: string): ProducibleDef[] {
  const allowed = producibles.filter((d) => d.civs === undefined || d.civs.includes(civ));
  const replaced = new Set(allowed.map((d) => d.replaces).filter((x): x is string => x !== undefined));
  return allowed.filter((d) => !replaced.has(d.id));
}

/** Everything reachable from the starting Town Center and villagers. */
function reachable(civ: string): Set<string> {
  const defs = new Map(civDefs(civ).map((d) => [d.id, d]));
  const got = new Set<string>([r.start.centerBuilding, ...r.start.units.map((u) => u.unitType)]);
  let changed = true;
  while (changed) {
    changed = false;
    const add = (id: string) => {
      if (defs.has(id) && !got.has(id)) {
        got.add(id);
        changed = true;
      }
    };
    for (const id of [...got]) {
      const d = defs.get(id);
      if (d?.kind === 'unit') (d.builds ?? []).forEach(add);
      if (d?.kind === 'building') [...d.trains, ...d.researches].forEach(add);
    }
  }
  return got;
}

describe('data validation: ids', () => {
  it('ids are unique across all kinds and lowerCamelCase', () => {
    expect(new Set(allIds).size).toBe(allIds.length);
    for (const id of allIds) expect(id).toMatch(/^[a-z][A-Za-z0-9]*$/);
  });

  it('every referenced id exists with the right kind', () => {
    for (const u of r.units) {
      for (const b of u.builds ?? []) expect(r.building(b).id).toBe(b);
    }
    for (const b of r.buildings) {
      b.trains.forEach((id) => expect(r.unit(id).id).toBe(id));
      b.researches.forEach((id) => expect(r.tech(id).id).toBe(id));
    }
    for (const d of producibles) {
      d.requiresBuildings?.forEach((id) => expect(r.building(id).id).toBe(id));
      d.requiresTechs?.forEach((id) => expect(r.tech(id).id).toBe(id));
      if (d.replaces !== undefined) expect(r.producible(d.replaces)?.kind).toBe(d.kind);
      d.civs?.forEach((c) => expect(r.civ(c).id).toBe(c));
    }
    expect(r.building(r.start.centerBuilding).id).toBe('townCenter');
    r.start.units.forEach((u) => expect(r.unit(u.unitType).id).toBe(u.unitType));
    for (const a of r.ages) if (a.advanceTech !== null) expect(r.tech(a.advanceTech).advancesTo).toBe(a.age);
    for (const civ of r.civs) civ.uniques.forEach((id) => expect(r.producible(id)).toBeDefined());
    const modifiers = [...r.techs.flatMap((t) => t.effects), ...r.civs.flatMap((c) => c.bonuses.flatMap((b) => b.modifiers))];
    for (const m of modifiers) {
      expect((m.select.ids?.length ?? 0) + (m.select.tags?.length ?? 0)).toBeGreaterThan(0);
      m.select.ids?.forEach((id) => expect(r.def(id)).toBeDefined());
    }
  });

  it('costs, times and numeric stats are sane', () => {
    for (const d of producibles) {
      for (const v of Object.values(d.cost)) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
      expect(d.description.length).toBeGreaterThan(5);
      expect([1, 2, 3, 4]).toContain(d.age);
    }
    for (const u of r.units) {
      expect(u.trainTime).toBeGreaterThan(0);
      expect(u.speed).toBeGreaterThan(0);
      expect(u.popCost).toBeGreaterThanOrEqual(1);
    }
    for (const b of r.buildings) {
      expect(b.buildTime).toBeGreaterThanOrEqual(0);
      expect(b.popProvided).toBeGreaterThanOrEqual(0);
      expect(b.footprint).toBeGreaterThanOrEqual(1);
    }
    for (const t of r.techs) expect(t.researchTime).toBeGreaterThan(0);
    for (const n of r.nodes) {
      expect(n.amount).toBeGreaterThan(0);
      expect(n.maxGatherers).toBeGreaterThanOrEqual(1);
    }
  });

  it('every def has a sprite/icon following the id convention', () => {
    for (const u of r.units) {
      expect(u.sprite).toBe(`unit.${u.id}`);
      expect(u.icon).toBe(`icon.unit.${u.id}`);
    }
    for (const b of r.buildings) {
      expect(b.sprite).toBe(`building.${b.id}`);
      expect(b.icon).toBe(`icon.building.${b.id}`);
    }
    for (const t of r.techs) expect(t.icon).toBe(`icon.tech.${t.id}`);
    for (const n of r.nodes) {
      expect(n.sprite).toBe(`node.${n.id}`);
      expect(n.icon).toBe(`icon.node.${n.id}`);
    }
    r.ages.forEach((a) => expect(a.icon).toBe(`icon.age.${a.age}`));
    r.civs.forEach((c) => expect(c.icon).toBe(`icon.civ.${c.id}`));
  });
});

describe('data validation: trees and orphans', () => {
  it('nothing is orphaned: all defs are buildable, trainable or researchable', () => {
    const trained = new Set(r.buildings.flatMap((b) => b.trains));
    const researched = new Set(r.buildings.flatMap((b) => b.researches));
    const built = new Set(r.units.flatMap((u) => u.builds ?? []));
    for (const u of r.units) expect(trained.has(u.id), u.id).toBe(true);
    for (const t of r.techs) expect(researched.has(t.id), t.id).toBe(true);
    for (const b of r.buildings) {
      if (b.buildable) expect(built.has(b.id), b.id).toBe(true);
      else expect(r.start.centerBuilding).toBe(b.id);
    }
    for (const b of r.buildings) expect(b.buildable || b.id === 'townCenter').toBe(true);
  });

  it('every Byzantine item is reachable; the Lancer is not, the Cataphract is', () => {
    const got = reachable(CIV);
    const want = civDefs(CIV).map((d) => d.id);
    expect(want).toContain('cataphract');
    expect(want).not.toContain('lancer');
    for (const id of want) expect(got.has(id), id).toBe(true);
    expect(got.has('lancer')).toBe(false);
    expect(got.has('siphonarios')).toBe(true);
    expect(got.has('silkWorkshop')).toBe(true);
  });

  it('item ages are consistent with the age of their producer and requirements', () => {
    for (const b of r.buildings) {
      for (const id of b.trains) expect(r.unit(id).age, id).toBeGreaterThanOrEqual(b.age);
      for (const id of b.researches) {
        const t = r.tech(id);
        if (t.advancesTo === undefined) expect(t.age, id).toBeGreaterThanOrEqual(b.age);
      }
    }
    for (const d of producibles) {
      d.requiresBuildings?.forEach((id) => expect(r.building(id).age).toBeLessThanOrEqual(d.age));
    }
  });

  it('age advances chain 1->2->3->4 at the Town Center', () => {
    const tc = r.building('townCenter');
    for (const a of [2, 3, 4] as const) {
      const t = r.tech(r.age(a).advanceTech as string);
      expect(t.advancesTo).toBe(a);
      expect(t.age).toBe(a - 1);
      expect(t.requiresAgeBuildings).toBe(2);
      expect(tc.researches).toContain(t.id);
    }
    expect(r.age(1).advanceTech).toBeNull();
  });

  it('Byzantines have at least 2 distinct age-counting buildings at ages 1-3', () => {
    const defs = civDefs(CIV).filter((d): d is BuildingDef => d.kind === 'building');
    for (const age of [1, 2, 3]) {
      const n = defs.filter((b) => b.age === age && b.countsTowardAge).length;
      expect(n, `age ${age}`).toBeGreaterThanOrEqual(2);
    }
    expect(defs.find((b) => b.id === 'townCenter')?.countsTowardAge).toBe(false);
    expect(defs.find((b) => b.id === 'house')?.countsTowardAge).toBe(false);
    const age3 = defs.filter((b) => b.age === 3 && b.countsTowardAge).map((b) => b.id).sort();
    expect(age3).toEqual(['siegeWorkshop', 'silkWorkshop']);
  });
});

describe('key numbers from plan section 5', () => {
  const cost = (c: Partial<ResourceAmounts>) => ({ food: 0, wood: 0, gold: 0, stone: 0, ...c });
  const full = (c: object) => cost(c);

  it.each([
    ['townshipAge', 400, 0, 0, 60],
    ['citadelAge', 700, 300, 0, 90],
    ['empireAge', 1000, 600, 300, 120],
  ])('age advance %s', (id, food, gold, stone, time) => {
    const t = r.tech(id);
    expect(full(t.cost)).toEqual(cost({ food, gold, stone }));
    expect(t.researchTime).toBe(time);
  });

  it.each([
    ['tree', 'wood', 100, 1, true, 1],
    ['berryBush', 'food', 150, 1, true, 1],
    ['goldDeposit', 'gold', 800, 2, true, 6],
    ['stoneDeposit', 'stone', 600, 2, true, 6],
  ])('node %s', (id, res, amount, fp, blocks, max) => {
    const n = r.node(id);
    expect([n.resource, n.amount, n.footprint, n.blocking, n.maxGatherers]).toEqual([res, amount, fp, blocks, max]);
  });

  it.each([
    // id, age, footprint, cost, buildTime
    ['house', 1, 2, { wood: 50 }, 20],
    ['mill', 1, 2, { wood: 60 }, 25],
    ['lumberCamp', 1, 2, { wood: 60 }, 25],
    ['miningCamp', 1, 2, { wood: 60 }, 25],
    ['farm', 1, 2, { wood: 50 }, 12],
    ['barracks', 1, 3, { wood: 120 }, 40],
    ['archeryRange', 2, 3, { wood: 150 }, 45],
    ['stable', 2, 3, { wood: 150 }, 45],
    ['siegeWorkshop', 3, 3, { wood: 200, stone: 100 }, 55],
    ['silkWorkshop', 3, 3, { wood: 150, stone: 100 }, 50],
  ])('building %s', (id, age, fp, c, time) => {
    const b = r.building(id);
    expect([b.age, b.footprint, b.buildTime]).toEqual([age, fp, time]);
    expect(full(b.cost)).toEqual(cost(c));
  });

  it('building functions', () => {
    const tc = r.building('townCenter');
    expect([tc.footprint, tc.popProvided, tc.buildable]).toEqual([4, 10, true]); // buildable in M2 (PLAN-M2 5.2)
    expect(tc.dropOff.sort()).toEqual(['food', 'gold', 'stone', 'wood']);
    expect(tc.trains).toEqual(['villager']);
    expect(r.building('house').popProvided).toBe(10);
    expect(r.building('mill').dropOff).toEqual(['food']);
    expect(r.building('lumberCamp').dropOff).toEqual(['wood']);
    expect(r.building('miningCamp').dropOff.sort()).toEqual(['gold', 'stone']);
    expect(r.building('barracks').trains).toEqual(['spearman', 'swordsman']);
    expect(r.building('archeryRange').trains).toEqual(['archer']);
    expect(r.building('stable').trains).toEqual(['horseman', 'lancer', 'cataphract']);
    expect(r.building('siegeWorkshop').trains).toEqual(['batteringRam', 'trebuchet', 'siphonarios']);
    const farm = r.building('farm');
    expect(farm.blocking).toBe(false);
    expect(farm.farm).toEqual({ resource: 'food', gatherKind: 'farm', maxGatherers: 1 });
    expect(farm.dropOff).toEqual([]);
    const silk = r.building('silkWorkshop');
    expect(silk.income).toEqual({ resource: 'gold', perSecond: 0.25 });
    expect(silk.buildLimit).toBe(3);
    expect(silk.civs).toEqual(['byzantines']);
  });

  it.each([
    // id, age, cost, trainTime, speed, pop
    ['villager', 1, { food: 50 }, 20, 1.0, 1],
    ['spearman', 1, { food: 35, wood: 25 }, 22, 1.0, 1],
    ['swordsman', 2, { food: 60, gold: 30 }, 24, 0.95, 1],
    ['archer', 2, { wood: 30, gold: 45 }, 26, 1.0, 1],
    ['horseman', 2, { food: 80 }, 30, 1.5, 1],
    ['lancer', 3, { food: 80, gold: 70 }, 32, 1.4, 1],
    ['batteringRam', 3, { wood: 160, gold: 80 }, 40, 0.6, 3],
    ['trebuchet', 4, { wood: 200, gold: 200 }, 50, 0.5, 3],
    ['cataphract', 3, { food: 90, gold: 80 }, 34, 1.3, 1],
    ['siphonarios', 4, { food: 50, gold: 90 }, 30, 0.9, 1],
  ])('unit %s', (id, age, c, time, speed, pop) => {
    const u = r.unit(id);
    expect([u.age, u.trainTime, u.speed, u.popCost]).toEqual([age, time, speed, pop]);
    expect(full(u.cost)).toEqual(cost(c));
  });

  it('villager gathering', () => {
    const g = r.unit('villager').gather;
    expect(g?.carryCapacity).toBe(10);
    expect(g?.rates).toEqual({ wood: 0.4, berries: 0.33, farm: 0.35, gold: 0.38, stone: 0.36 });
    expect(r.units.filter((u) => u.gather !== undefined).map((u) => u.id)).toEqual(['villager']);
  });

  it('Cataphract replaces the Lancer for the Byzantines only', () => {
    const c = r.unit('cataphract');
    expect(c.replaces).toBe('lancer');
    expect(c.civs).toEqual(['byzantines']);
    expect(r.unit('lancer').civs).toBeUndefined();
    expect(r.unit('siphonarios').civs).toEqual(['byzantines']);
  });

  it.each([
    ['handCarts', 2, { food: 150, wood: 100 }, 45, 'townCenter'],
    ['ironAxes', 2, { food: 100, wood: 50 }, 30, 'lumberCamp'],
    ['frameSaws', 3, { food: 200, wood: 100 }, 45, 'lumberCamp'],
    ['irrigation', 2, { food: 100, wood: 75 }, 30, 'mill'],
    ['threeFieldSystem', 3, { food: 200, wood: 150 }, 45, 'mill'],
    ['ironPicks', 2, { food: 100, wood: 75 }, 30, 'miningCamp'],
    ['timberedShafts', 3, { food: 200, wood: 150 }, 45, 'miningCamp'],
    ['guildCharters', 4, { food: 400, gold: 300 }, 60, 'townCenter'],
  ])('tech %s', (id, age, c, time, where) => {
    const t = r.tech(id);
    expect([t.age, t.researchTime]).toEqual([age, time]);
    expect(full(t.cost)).toEqual(cost(c));
    expect(r.building(where).researches).toContain(id);
  });

  it('tech effects', () => {
    const stat = (id: string) => r.tech(id).effects.map((m) => `${m.stat}:${m.op}:${m.value}`).sort();
    expect(stat('handCarts')).toEqual(['carryCapacity:add:5', 'speed:mul:1.1']);
    expect(stat('ironAxes')).toEqual(['gatherRate.wood:mul:1.15']);
    expect(stat('frameSaws')).toEqual(['gatherRate.wood:mul:1.15']);
    expect(stat('irrigation')).toEqual(['gatherRate.farm:mul:1.15']);
    expect(stat('threeFieldSystem')).toEqual(['gatherRate.farm:mul:1.15']);
    expect(stat('ironPicks')).toEqual(['gatherRate.gold:mul:1.15', 'gatherRate.stone:mul:1.15']);
    expect(stat('timberedShafts')).toEqual(['gatherRate.gold:mul:1.15', 'gatherRate.stone:mul:1.15']);
    expect(stat('guildCharters')).toEqual(
      ['berries', 'farm', 'gold', 'stone', 'wood'].map((k) => `gatherRate.${k}:mul:1.1`),
    );
  });

  it('Byzantine civ text and Themata', () => {
    const civ = r.civ('byzantines');
    expect(civ.name.length).toBeGreaterThan(0);
    expect(civ.description.length).toBeGreaterThan(0);
    expect(civ.uniques.sort()).toEqual(['cataphract', 'silkWorkshop', 'siphonarios']);
    const themata = civ.bonuses.find((b) => b.name === 'Themata');
    expect(themata?.modifiers.map((m) => `${m.stat}:${m.op}:${m.value}`).sort()).toEqual([
      'cost.wood:mul:0.8',
      'gatherRate.farm:mul:1.1',
    ]);
    expect(Math.round(50 * 0.8)).toBe(40);
  });

  it('start conditions', () => {
    expect(r.start.resources).toEqual({ food: 200, wood: 200, gold: 100, stone: 0 });
    expect(r.start.units).toEqual([{ unitType: 'villager', count: 6 }]);
  });
});
