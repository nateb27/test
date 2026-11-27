/**
 * WP25 data validation for Milestone 2 (PLAN-M2 5 and 8.1 "Data"): every unit and building has complete, sane combat
 * fields; the engine tunables are the 3.7 values; the 12 military upgrades are reachable, chained, priced and resolve to
 * the 5.4 effects through the real stat resolution; names are original.
 */

import { describe, expect, it } from 'vitest';
import { registry } from '../../../src/data';
import type { BuildingDef, TechDef, UnitDef } from '../../../src/data/schema';
import { createBuilding } from '../../../src/sim/entities';
import { rebuildRuntime } from '../../../src/sim/runtime';
import { createInitialState, simFromState } from '../../../src/sim/sim';
import { buildingCombat, unitCombat } from '../../../src/sim/systems/combat/damage';
import { ARMOR_CLASSES, PROJECTILE_KINDS, TICK_RATE, type SimContext } from '../../../src/sim/types';

const r = registry;
const military = r.units.filter((u) => u.tags.includes('military'));
const upgrades = r.techs.filter((t) => t.tags.includes('militaryTech'));

function ctxWith(researched: string[]): SimContext {
  const state = createInitialState({ seed: 1, mapSize: 40, players: [{ civ: 'byzantines' }, { civ: 'byzantines' }] }, r);
  state.players[1]!.researched.push(...researched);
  return { state, runtime: rebuildRuntime(state, r), data: r, events: [] };
}

const isWhole = (x: number) => Number.isInteger(x);
const onTick = (seconds: number) => Math.abs(seconds * TICK_RATE - Math.round(seconds * TICK_RATE)) < 1e-6;

describe('combat data: units', () => {
  it.each(r.units.map((u) => [u.id, u] as const))('%s has complete, sane combat fields', (_id, u: UnitDef) => {
    const c = u.combat;
    expect(isWhole(c.hp) && c.hp > 0).toBe(true);
    expect(isWhole(c.attack) && c.attack > 0).toBe(true);
    expect(isWhole(c.meleeArmor) && c.meleeArmor >= 0).toBe(true);
    expect(isWhole(c.pierceArmor) && c.pierceArmor >= 0).toBe(true);
    // Timing: whole ticks, cooldown strictly longer than the wind-up (4.3), wind-up at least one tick.
    expect(c.windup).toBeGreaterThan(0);
    expect(c.cooldown).toBeGreaterThan(c.windup);
    expect(onTick(c.windup)).toBe(true);
    expect(onTick(c.cooldown)).toBe(true);
    expect(Math.round(c.cooldown * TICK_RATE)).toBeGreaterThan(Math.round(c.windup * TICK_RATE));
    // Range.
    expect(c.range).toBeGreaterThanOrEqual(0);
    expect(c.minRange).toBeGreaterThanOrEqual(0);
    if (c.minRange > 0) expect(c.minRange).toBeLessThan(c.range);
    expect(c.sight).toBeGreaterThanOrEqual(c.range);
    expect(c.sight).toBeGreaterThan(0);
    // Classes and bonuses.
    expect(c.classes.length).toBeGreaterThan(0);
    expect(new Set(c.classes).size).toBe(c.classes.length);
    for (const cls of c.classes) expect(ARMOR_CLASSES).toContain(cls);
    for (const [cls, amount] of Object.entries(c.bonus)) {
      expect(ARMOR_CLASSES).toContain(cls);
      expect(isWhole(amount as number) && (amount as number) > 0).toBe(true);
    }
    expect(isWhole(c.bonusResist) && c.bonusResist >= 0 && c.bonusResist <= 100).toBe(true);
    // Projectiles and splash.
    if (c.projectile !== null) expect(PROJECTILE_KINDS).toContain(c.projectile);
    if (c.range > 0) expect(c.projectile, 'a ranged unit fires something').not.toBeNull();
    if (c.projectile === null) expect(c.range, 'a melee unit has no range').toBe(0);
    if (c.splash !== null) {
      expect(c.projectile).toBe('fire');
      expect(c.splash.radius).toBeGreaterThan(0);
      expect(c.splash.percent).toBeGreaterThan(0);
      expect(c.splash.percent).toBeLessThanOrEqual(100);
    }
    // A unit's tags map to its classes.
    for (const tag of ['villager', 'infantry', 'archer', 'cavalry', 'siege'] as const) {
      if (u.tags.includes(tag)) expect(c.classes, `${u.id} tag ${tag}`).toContain(tag);
    }
    expect(c.classes).not.toContain('building');
  });

  it('only the Villager is non-military, and only it does not acquire targets', () => {
    expect(r.units.filter((u) => !u.tags.includes('military')).map((u) => u.id)).toEqual(['villager']);
    expect(r.units.filter((u) => !u.combat.autoAcquire).map((u) => u.id)).toEqual(['villager']);
  });

  it('siege units attack buildings only, have a building bonus and no unit bonus', () => {
    const siege = r.units.filter((u) => u.combat.targets === 'buildings');
    expect(siege.map((u) => u.id).sort()).toEqual(['batteringRam', 'trebuchet']);
    for (const u of siege) {
      expect(u.combat.classes).toContain('siege');
      expect(u.combat.bonus.building, u.id).toBeGreaterThanOrEqual(60);
      expect(Object.keys(u.combat.bonus)).toEqual(['building']);
      expect(u.combat.pierceArmor, `${u.id} resists arrows`).toBeGreaterThanOrEqual(10);
      expect(u.combat.meleeArmor, `${u.id} is soft against melee`).toBe(0);
    }
    for (const u of r.units.filter((x) => x.combat.targets === 'any')) {
      expect(u.combat.classes).not.toContain('siege');
    }
  });

  it('the Trebuchet outranges the Town Center, the Archer does not', () => {
    const tc = r.building('townCenter').combat.attack!;
    expect(r.unit('trebuchet').combat.range).toBeGreaterThan(tc.range + 3);
    expect(r.unit('archer').combat.range).toBeLessThan(tc.range);
    expect(r.unit('trebuchet').combat.minRange).toBeGreaterThan(0);
  });

  it('cost and pace are unchanged from M1 (section 5.1: "Cost, train time, speed and population are unchanged")', () => {
    const cost = (u: string) => Object.values(r.unit(u).cost).reduce((a, b) => a + (b ?? 0), 0);
    expect([cost('villager'), cost('spearman'), cost('swordsman'), cost('archer'), cost('horseman')]).toEqual([50, 60, 90, 75, 80]);
    expect([cost('cataphract'), cost('batteringRam'), cost('trebuchet'), cost('siphonarios')]).toEqual([170, 240, 400, 140]);
  });

  it('the Cataphract is the Lancer with more of everything, and the Lancer stays hidden for Byzantines', () => {
    const lancer = r.unit('lancer').combat;
    const cata = r.unit('cataphract').combat;
    expect(cata.hp).toBeGreaterThan(lancer.hp);
    expect(cata.meleeArmor).toBeGreaterThan(lancer.meleeArmor);
    expect(cata.pierceArmor).toBeGreaterThan(lancer.pierceArmor);
    expect(cata.bonusResist).toBe(50);
    expect(lancer.bonusResist).toBe(0);
    const state = createInitialState({ seed: 1, mapSize: 40, players: [{ civ: 'byzantines' }, { civ: 'byzantines' }] }, r);
    const sim = simFromState(state, r);
    expect(sim.query.availability(1, 'lancer').hidden).toBe(true);
    expect(sim.query.availability(1, 'cataphract').hidden).toBe(false);
  });
});

describe('combat data: buildings and rules', () => {
  it.each(r.buildings.map((b) => [b.id, b] as const))('%s has complete, sane combat fields', (_id, b: BuildingDef) => {
    expect(isWhole(b.combat.hp) && b.combat.hp > 0).toBe(true);
    expect(isWhole(b.combat.meleeArmor) && b.combat.meleeArmor >= 0).toBe(true);
    expect(isWhole(b.combat.pierceArmor) && b.combat.pierceArmor >= 0).toBe(true);
    // Bigger and costlier buildings are tougher (a house must never outlast a Barracks).
    const a = b.combat.attack;
    if (a !== undefined) {
      expect(b.id).toBe('townCenter');
      expect(isWhole(a.attack) && a.attack > 0).toBe(true);
      expect(a.range).toBeGreaterThan(0);
      expect(a.cooldown).toBeGreaterThan(0);
      expect(onTick(a.cooldown)).toBe(true);
      expect(a.arrows).toBeGreaterThanOrEqual(1);
      expect(PROJECTILE_KINDS).toContain(a.projectile);
    }
  });

  it('hit points rank the buildings: houses and farms are the softest, production buildings tougher, the Town Center toughest', () => {
    const hp = (id: string) => r.building(id).combat.hp;
    for (const soft of ['house', 'mill', 'lumberCamp', 'miningCamp', 'farm']) {
      for (const hard of ['barracks', 'archeryRange', 'stable', 'siegeWorkshop', 'silkWorkshop']) expect(hp(soft), `${soft} vs ${hard}`).toBeLessThan(hp(hard));
    }
    for (const b of r.buildings) if (b.id !== 'townCenter') expect(hp('townCenter')).toBeGreaterThan(b.combat.hp);
    expect(hp('farm')).toBeLessThan(hp('house'));
  });

  it('the Town Center is buildable in M2 and only it attacks (5.2, 4.10)', () => {
    const tc = r.building('townCenter');
    expect(tc.buildable).toBe(true);
    expect(tc.cost).toEqual({ wood: 275, stone: 100 });
    expect(tc.buildTime).toBe(150);
    expect(tc.buildMenu).toBe('economy');
    expect(r.unit('villager').builds).toContain('townCenter');
    expect(tc.combat.attack).toEqual({ attack: 5, attackType: 'pierce', range: 7, cooldown: 2, arrows: 2, projectile: 'arrow' });
    expect(r.buildings.filter((b) => b.combat.attack !== undefined).map((b) => b.id)).toEqual(['townCenter']);
  });

  it('engine tunables are the section 3.7 values', () => {
    expect(r.combat).toEqual({
      reach: 0.75,
      meleeReleaseSlack: 0.5,
      minDamage: 1,
      leashRadius: 10,
      retaliateRadius: 10,
      projectileSpeed: { arrow: 9, stone: 6, fire: 8 },
      constructionStartPercent: 10,
      repairRateFactor: 0.25,
      repairMinHpPerSecond: 2,
      repairCostPercent: 50,
    });
  });

  it('resolved profiles agree with the data (ticks and reach)', () => {
    const ctx = ctxWith([]);
    for (const u of r.units) {
      const p = unitCombat(ctx, 1, u.id);
      expect(p.windupTicks).toBe(Math.max(1, Math.round(u.combat.windup * TICK_RATE)));
      expect(p.cooldownTicks).toBeGreaterThan(p.windupTicks);
      expect(p.reach).toBeCloseTo(u.combat.range + r.combat.reach, 9);
      expect(p.maxHp).toBe(u.combat.hp);
    }
    for (const b of r.buildings) expect(buildingCombat(ctx, 1, b.id).maxHp).toBe(b.combat.hp);
  });
});

/** Section 5.4, one row per tech: id, age, building, cost, seconds, requires, what each affected unit gains. */
const TABLE = [
  ['spathionForging', 2, 'barracks', { food: 100, gold: 50 }, 35, undefined, ['spearman', 'swordsman'], { attack: 1 }],
  ['strategikonDrill', 3, 'barracks', { food: 200, gold: 125 }, 50, 'spathionForging', ['spearman', 'swordsman'], { attack: 1 }],
  ['paddedKavadion', 2, 'barracks', { food: 75, gold: 75 }, 35, undefined, ['spearman', 'swordsman', 'siphonarios'], { meleeArmor: 1, pierceArmor: 1 }],
  ['lamellarKlibanion', 3, 'barracks', { food: 175, gold: 150 }, 50, 'paddedKavadion', ['spearman', 'swordsman', 'siphonarios'], { meleeArmor: 1, pierceArmor: 1 }],
  ['hornSinewBows', 2, 'archeryRange', { wood: 75, gold: 75 }, 35, undefined, ['archer'], { attack: 1 }],
  ['solenarionGuides', 3, 'archeryRange', { wood: 150, gold: 175 }, 50, 'hornSinewBows', ['archer'], { attack: 1, range: 1 }],
  ['bambakionCoats', 2, 'archeryRange', { food: 100, gold: 50 }, 35, undefined, ['archer'], { meleeArmor: 1, pierceArmor: 1 }],
  ['mailLorikion', 3, 'archeryRange', { food: 200, gold: 125 }, 50, 'bambakionCoats', ['archer'], { meleeArmor: 1, pierceArmor: 1 }],
  ['kontarionDrill', 2, 'stable', { food: 125, gold: 50 }, 35, undefined, ['horseman', 'lancer', 'cataphract'], { attack: 1 }],
  ['taktikaWedge', 3, 'stable', { food: 250, gold: 125 }, 50, 'kontarionDrill', ['horseman', 'lancer', 'cataphract'], { attack: 2 }],
  ['feltHorseBards', 2, 'stable', { food: 125, gold: 50 }, 35, undefined, ['horseman', 'lancer', 'cataphract'], { meleeArmor: 1, pierceArmor: 1 }],
  ['ironHorseBards', 3, 'stable', { food: 250, gold: 150 }, 50, 'feltHorseBards', ['horseman', 'lancer', 'cataphract'], { meleeArmor: 1, pierceArmor: 2 }],
] as const;

describe('military upgrades (PLAN-M2 5.4)', () => {
  it('there are exactly 12, all tagged militaryTech, and the table covers them', () => {
    expect(upgrades).toHaveLength(12);
    expect(upgrades.map((t) => t.id).sort()).toEqual(TABLE.map((row) => row[0]).sort());
  });

  it.each(TABLE.map((row) => [row[0], row] as const))('%s: age, building, cost, time and chain', (_id, row) => {
    const [id, age, where, cost, seconds, requires] = row;
    const t: TechDef = r.tech(id);
    expect(t.age).toBe(age);
    expect(t.cost).toEqual(cost);
    expect(t.researchTime).toBe(seconds);
    expect(t.requiresTechs).toEqual(requires === undefined ? undefined : [requires]);
    expect(r.building(where).researches).toContain(id);
    // Researched at exactly one building, of an age no later than the tech.
    expect(r.buildings.filter((b) => b.researches.includes(id)).map((b) => b.id)).toEqual([where]);
    expect(r.building(where).age).toBeLessThanOrEqual(t.age);
    expect(t.requiresAgeBuildings).toBeUndefined();
    expect(t.advancesTo).toBeUndefined();
  });

  it('level II costs more and takes longer than level I, and a chain is two techs of one line', () => {
    for (const t of upgrades) {
      const req = t.requiresTechs?.[0];
      if (req === undefined) continue;
      const first = r.tech(req);
      expect(first.requiresTechs).toBeUndefined();
      expect(t.age).toBe(3);
      expect(first.age).toBe(2);
      expect(t.researchTime).toBeGreaterThan(first.researchTime);
      const sum = (x: TechDef) => Object.values(x.cost).reduce((a, b) => a + (b ?? 0), 0);
      expect(sum(t)).toBeGreaterThan(sum(first));
      expect(r.buildings.find((b) => b.researches.includes(t.id))?.id).toBe(r.buildings.find((b) => b.researches.includes(first.id))?.id);
    }
  });

  it('every upgrade is reachable by a Byzantine player, and every effect names a stat the units have', () => {
    const researchable = new Set(r.buildings.flatMap((b) => b.researches));
    for (const t of upgrades) {
      expect(researchable.has(t.id)).toBe(true);
      expect(t.civs).toBeUndefined();
      expect(t.effects.length).toBeGreaterThan(0);
      for (const m of t.effects) {
        expect(['attack', 'meleeArmor', 'pierceArmor', 'range']).toContain(m.stat);
        expect(m.op).toBe('add');
        expect(m.value).toBeGreaterThan(0);
        expect(isWhole(m.value)).toBe(true);
      }
    }
  });

  it('each line affects only its own units: attack upgrades name ids, armour upgrades name tags', () => {
    for (const t of upgrades) {
      for (const m of t.effects) {
        if (m.stat === 'attack' && t.id.match(/spathion|strategikon/)) {
          expect(m.select.ids).toEqual(['spearman', 'swordsman']);
          expect(m.select.tags ?? []).toEqual([]);
        }
      }
    }
    expect(r.tech('paddedKavadion').effects.every((m) => m.select.tags?.[0] === 'infantry')).toBe(true);
    expect(r.tech('bambakionCoats').effects.every((m) => m.select.tags?.[0] === 'archer')).toBe(true);
    expect(r.tech('feltHorseBards').effects.every((m) => m.select.tags?.[0] === 'cavalry')).toBe(true);
  });

  it.each(TABLE.map((row) => [row[0], row] as const))('%s resolves to its 5.4 effect through the real stat resolution', (_id, row) => {
    const [id, , , , , requires, affected, delta] = row;
    const base = ctxWith([]);
    const withTech = ctxWith(requires === undefined ? [id] : [requires, id]);
    const level1 = requires === undefined ? null : ctxWith([requires]);
    const stats = ['attack', 'meleeArmor', 'pierceArmor', 'range'] as const;
    for (const u of r.units) {
      const before = unitCombat(base, 1, u.id);
      const after = unitCombat(withTech, 1, u.id);
      const baseline = level1 === null ? before : unitCombat(level1, 1, u.id);
      for (const s of stats) {
        const gain = (affected as readonly string[]).includes(u.id) ? ((delta as Record<string, number>)[s] ?? 0) : 0;
        expect(after[s] - baseline[s], `${u.id}.${s} gained by ${id}`).toBe(gain);
      }
      expect(after.maxHp).toBe(before.maxHp);
      expect(after.cooldownTicks).toBe(before.cooldownTicks);
    }
    // The opponent, and every building, are untouched.
    for (const u of r.units) expect(unitCombat(withTech, 2, u.id)).toEqual(unitCombat(base, 2, u.id));
    for (const b of r.buildings) expect(buildingCombat(withTech, 1, b.id)).toEqual(buildingCombat(base, 1, b.id));
  });

  it('the whole tree stacks to the totals of 5.4', () => {
    const all = ctxWith(upgrades.map((t) => t.id));
    const base = ctxWith([]);
    const d = (id: string) => {
      const a = unitCombat(all, 1, id);
      const b = unitCombat(base, 1, id);
      return { attack: a.attack - b.attack, melee: a.meleeArmor - b.meleeArmor, pierce: a.pierceArmor - b.pierceArmor, range: a.range - b.range };
    };
    expect(d('spearman')).toEqual({ attack: 2, melee: 2, pierce: 2, range: 0 });
    expect(d('swordsman')).toEqual({ attack: 2, melee: 2, pierce: 2, range: 0 });
    expect(d('siphonarios')).toEqual({ attack: 0, melee: 2, pierce: 2, range: 0 });
    expect(d('archer')).toEqual({ attack: 2, melee: 2, pierce: 2, range: 1 });
    expect(d('horseman')).toEqual({ attack: 3, melee: 2, pierce: 3, range: 0 });
    expect(d('cataphract')).toEqual({ attack: 3, melee: 2, pierce: 3, range: 0 });
    expect(d('villager')).toEqual({ attack: 0, melee: 0, pierce: 0, range: 0 });
    expect(d('batteringRam')).toEqual({ attack: 0, melee: 0, pierce: 0, range: 0 });
  });

  it('level II is unavailable until level I is researched, and level I needs Township', () => {
    const state = createInitialState({ seed: 1, mapSize: 40, players: [{ civ: 'byzantines' }, { civ: 'byzantines' }] }, r);
    createBuilding(state, 'barracks', 1, 5, 5, true);
    state.players[1]!.age = 3;
    const sim = simFromState(state, r);
    expect(sim.query.availability(1, 'spathionForging').available).toBe(true);
    const two = sim.query.availability(1, 'strategikonDrill');
    expect(two.available).toBe(false);
    expect(two.reasons).toContainEqual({ code: 'requiresTech', techId: 'spathionForging' });
    state.players[1]!.age = 1;
    expect(simFromState(state, r).query.availability(1, 'spathionForging').reasons).toContainEqual({ code: 'requiresAge', age: 2 });
  });
});

describe('original content', () => {
  /** Names of well-known techs, units and ages from existing strategy games: none may be reused. */
  const TAKEN = [
    'forging', 'iron casting', 'blast furnace', 'fletching', 'bodkin arrow', 'bracer', 'scale mail armor', 'chain mail armor',
    'plate mail armor', 'padded archer armor', 'leather archer armor', 'ring archer armor', 'scale barding armor',
    'chain barding armor', 'plate barding armor', 'bloodlines', 'husbandry', 'squires', 'arson', 'ballistics', 'thumb ring',
    'parthian tactics', 'man-at-arms', 'long swordsman', 'two-handed swordsman', 'champion', 'pikeman', 'halberdier', 'knight',
    'cavalier', 'paladin', 'crossbowman', 'arbalest', 'skirmisher', 'mangonel', 'onager', 'scorpion', 'bombard cannon',
    'capped ram', 'siege ram', 'petard', 'dark age', 'feudal age', 'castle age', 'imperial age', 'stone age', 'bronze age',
    'iron age', 'tool age', 'archaic age', 'classical age', 'heroic age', 'mythic age', 'town watch', 'town patrol',
    'wheelbarrow', 'double-bit axe', 'bow saw', 'two-man saw', 'heavy plow', 'horse collar', 'crop rotation', 'gold mining',
    'stone mining', 'gold shaft mining', 'stone shaft mining', 'fire ship', 'hoplite', 'legionary', 'centurion', 'zealot',
    'marine', 'zergling', 'footman', 'grunt', 'peasant', 'peon', 'militia', 'town center', 'tc',
  ];
  const lc = (s: string) => s.toLowerCase();

  it('no unit, building or tech reuses a name from an existing game, and all names are distinct', () => {
    const names = [...r.units, ...r.buildings, ...r.techs].map((d) => lc(d.name));
    expect(new Set(names).size).toBe(names.length);
    // The plan-mandated generic words (Town Center, Trebuchet, Battering Ram, Spearman and the like) are historical
    // or generic names; everything the M2 content adds must be outside the list.
    const added = [...upgrades.map((t) => t.name), ...r.units.filter((u) => u.civs !== undefined).map((u) => u.name)];
    for (const n of added) expect(TAKEN, n).not.toContain(lc(n));
  });

  it('the new upgrade names are drawn from Byzantine military history (Greek terms), not invented from a game', () => {
    const names = upgrades.map((t) => t.name);
    expect(names).toEqual([
      'Spathion Forging', 'Strategikon Drill', 'Padded Kavadion', 'Lamellar Klibanion', 'Horn-and-Sinew Bows',
      'Solenarion Guides', 'Bambakion Coats', 'Mail Lorikion', 'Kontarion Drill', 'Taktika Wedge', 'Felt Horse Bards', 'Iron Horse Bards',
    ]);
    for (const t of upgrades) expect(t.description.length).toBeGreaterThan(20);
  });

  it('military and armour classes are used by their units only', () => {
    const classesUsed = new Set(military.flatMap((u) => u.combat.classes));
    for (const c of classesUsed) expect(ARMOR_CLASSES).toContain(c);
    for (const u of military) for (const key of Object.keys(u.combat.bonus)) expect(ARMOR_CLASSES).toContain(key);
  });
});
