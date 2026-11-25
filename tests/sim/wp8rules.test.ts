import { describe, expect, it } from 'vitest';
import { registry } from '../../src/data/index';
import type { TechDef } from '../../src/data/schema';
import type { ProducibleId, StatKey, UnavailableReason } from '../../src/sim/types';
import { extendedData, makeGame, place, reload, type Game } from './wp8helpers';

const stat = (g: Game, owner: number, def: string, key: StatKey): number => g.sim.query.resolvedStat(owner, def, key);

function research(g: Game, owner: number, ...techs: string[]): void {
  g.state.players[owner]!.researched.push(...techs);
  reload(g);
}

describe('stat resolution', () => {
  it('returns base values for the neutral player and cost rounding for Themata', () => {
    const g = makeGame();
    expect(stat(g, 0, 'farm', 'cost.wood')).toBe(50);
    expect(stat(g, 1, 'farm', 'cost.wood')).toBe(40);
    expect(stat(g, 0, 'villager', 'gatherRate.farm')).toBe(0.35);
    expect(stat(g, 1, 'villager', 'gatherRate.farm')).toBeCloseTo(0.385, 12);
    // other defs and stats are untouched
    expect(stat(g, 1, 'house', 'cost.wood')).toBe(50);
    expect(stat(g, 1, 'villager', 'gatherRate.wood')).toBe(0.4);
    expect(stat(g, 1, 'villager', 'cost.food')).toBe(50);
    expect(stat(g, 1, 'villager', 'trainTime')).toBe(20);
    expect(stat(g, 1, 'townCenter', 'popProvided')).toBe(10);
    expect(stat(g, 1, 'silkWorkshop', 'incomeRate')).toBe(0.25);
    expect(stat(g, 1, 'ironAxes', 'researchTime')).toBe(30);
  });

  it('throws for unknown defs and for stats a def does not have', () => {
    const g = makeGame();
    expect(() => stat(g, 1, 'nope', 'speed')).toThrow();
    expect(() => stat(g, 1, 'spearman', 'carryCapacity')).toThrow();
    expect(() => stat(g, 1, 'house', 'speed')).toThrow();
    expect(() => stat(g, 1, 'tree', 'hp')).toThrow();
  });

  it('applies each tech numerically (neutral player, to isolate the tech from Themata)', () => {
    const cases: { tech: string; effects: [string, StatKey, number][] }[] = [
      { tech: 'handCarts', effects: [['villager', 'carryCapacity', 15], ['villager', 'speed', 1.1], ['spearman', 'speed', 1.0], ['villager', 'gatherRate.wood', 0.4]] },
      { tech: 'ironAxes', effects: [['villager', 'gatherRate.wood', 0.4 * 1.15], ['villager', 'gatherRate.berries', 0.33], ['villager', 'gatherRate.farm', 0.35]] },
      { tech: 'frameSaws', effects: [['villager', 'gatherRate.wood', 0.4 * 1.15]] },
      { tech: 'irrigation', effects: [['villager', 'gatherRate.farm', 0.35 * 1.15], ['villager', 'gatherRate.wood', 0.4]] },
      { tech: 'threeFieldSystem', effects: [['villager', 'gatherRate.farm', 0.35 * 1.15]] },
      { tech: 'ironPicks', effects: [['villager', 'gatherRate.gold', 0.38 * 1.15], ['villager', 'gatherRate.stone', 0.36 * 1.15], ['villager', 'gatherRate.wood', 0.4]] },
      { tech: 'timberedShafts', effects: [['villager', 'gatherRate.gold', 0.38 * 1.15], ['villager', 'gatherRate.stone', 0.36 * 1.15]] },
      {
        tech: 'guildCharters',
        effects: [
          ['villager', 'gatherRate.wood', 0.4 * 1.1],
          ['villager', 'gatherRate.berries', 0.33 * 1.1],
          ['villager', 'gatherRate.farm', 0.35 * 1.1],
          ['villager', 'gatherRate.gold', 0.38 * 1.1],
          ['villager', 'gatherRate.stone', 0.36 * 1.1],
        ],
      },
      { tech: 'townshipAge', effects: [['villager', 'gatherRate.wood', 0.4]] },
    ];
    for (const c of cases) {
      const g = makeGame();
      // The neutral player has no civ, so give it the tech and read its stats.
      g.state.players[0]!.researched.push(c.tech);
      reload(g);
      for (const [def, key, want] of c.effects) {
        expect(stat(g, 0, def, key), `${c.tech} ${def} ${key}`).toBeCloseTo(want, 12);
      }
    }
  });

  it('stacks the same-rate techs multiplicatively and civ with tech', () => {
    const g = makeGame();
    research(g, 1, 'ironAxes', 'frameSaws', 'guildCharters');
    expect(stat(g, 1, 'villager', 'gatherRate.wood')).toBeCloseTo(0.4 * 1.15 * 1.15 * 1.1, 12);
    research(g, 1, 'irrigation', 'threeFieldSystem');
    // Themata x1.1, irrigation x1.15, three-field x1.15, guild charters x1.1
    expect(stat(g, 1, 'villager', 'gatherRate.farm')).toBeCloseTo(0.35 * 1.1 * 1.15 * 1.15 * 1.1, 12);
  });

  it('applies every add before every mul, whatever the order researched', () => {
    const mkTech = (id: string, op: 'add' | 'mul', value: number): TechDef => ({
      ...registry.tech('ironAxes'),
      id,
      effects: [{ select: { tags: ['villager'] }, stat: 'carryCapacity', op, value }],
    });
    const data = extendedData([mkTech('mulTech', 'mul', 2), mkTech('addTech', 'add', 5)]);
    for (const order of [['mulTech', 'addTech'], ['addTech', 'mulTech']]) {
      const g = makeGame({ data });
      research(g, 1, ...order);
      expect(stat(g, 1, 'villager', 'carryCapacity')).toBe(30); // (10 + 5) * 2, not 10 * 2 + 5
    }
    // civ add + tech mul: the civ bonus is also an `add` in the same pass
    const g = makeGame({ data });
    research(g, 1, 'handCarts', 'mulTech');
    expect(stat(g, 1, 'villager', 'carryCapacity')).toBe((10 + 5) * 2);
  });

  it('matches modifiers on id OR tag', () => {
    const t: TechDef = {
      ...registry.tech('ironAxes'),
      id: 'mixed',
      effects: [{ select: { ids: ['spearman'], tags: ['villager'] }, stat: 'speed', op: 'mul', value: 2 }],
    };
    const g = makeGame({ data: extendedData([t]) });
    research(g, 1, 'mixed');
    expect(stat(g, 1, 'villager', 'speed')).toBe(2);
    expect(stat(g, 1, 'spearman', 'speed')).toBe(2);
    expect(stat(g, 1, 'horseman', 'speed')).toBe(1.5);
  });

  it('rebuilds the cache on tech completion and clamps costs at 0 after rounding', () => {
    const t: TechDef = {
      ...registry.tech('ironAxes'),
      id: 'freeFarms',
      effects: [{ select: { ids: ['farm'] }, stat: 'cost.wood', op: 'add', value: -500 }],
    };
    const g = makeGame({ data: extendedData([t]) });
    research(g, 1, 'freeFarms');
    expect(stat(g, 1, 'farm', 'cost.wood')).toBe(0);
  });
});

describe('availability reasons', () => {
  const av = (g: Game, id: ProducibleId, owner = 1) => g.sim.query.availability(owner, id);
  const codes = (g: Game, id: ProducibleId, owner = 1): string[] => av(g, id, owner).reasons.map((r) => r.code);

  it('requiresAge', () => {
    const g = makeGame();
    expect(av(g, 'swordsman').reasons).toEqual([{ code: 'requiresAge', age: 2 }]);
    expect(av(g, 'swordsman').available).toBe(false);
    g.state.players[1]!.age = 2;
    expect(av(g, 'swordsman').available).toBe(true);
    expect(av(g, 'swordsman').reasons).toEqual([]);
  });

  it('requiresBuilding counts completed buildings only; requiresTech', () => {
    const t: TechDef = {
      ...registry.tech('ironAxes'),
      id: 'gated',
      age: 1,
      requiresBuildings: ['mill', 'barracks'],
      requiresTechs: ['ironAxes'],
    };
    const g = makeGame({ data: extendedData([t]) });
    place(g, 'mill', 1, false);
    reload(g);
    expect(av(g, 'gated').reasons).toEqual<UnavailableReason[]>([
      { code: 'requiresBuilding', buildingId: 'mill' },
      { code: 'requiresBuilding', buildingId: 'barracks' },
      { code: 'requiresTech', techId: 'ironAxes' },
    ]);
    place(g, 'mill');
    place(g, 'barracks');
    g.state.players[1]!.researched.push('ironAxes');
    reload(g);
    expect(av(g, 'gated').available).toBe(true);
    // another player's buildings do not count
  });

  it('wrongCiv hides defs of other civs; replaced hides the Lancer for the Byzantines only', () => {
    const data = extendedData();
    const byz = makeGame({ data });
    byz.state.players[1]!.age = 4;
    expect(av(byz, 'lancer')).toMatchObject({ hidden: true, available: false, reasons: [{ code: 'replaced', by: 'cataphract' }] });
    expect(av(byz, 'cataphract')).toMatchObject({ hidden: false, available: true });

    const rom = makeGame({ data, civ: 'romans' });
    rom.state.players[1]!.age = 4;
    expect(av(rom, 'lancer')).toMatchObject({ hidden: false, available: true });
    expect(av(rom, 'cataphract')).toMatchObject({ hidden: true, available: false, reasons: [{ code: 'wrongCiv' }] });
    expect(av(rom, 'siphonarios').hidden).toBe(true);
    expect(av(rom, 'silkWorkshop').hidden).toBe(true);
    // the neutral player has no civ: civ-restricted defs are hidden
    expect(av(byz, 'silkWorkshop', 0).hidden).toBe(true);
  });

  it('buildLimit counts foundations too', () => {
    const g = makeGame();
    g.state.players[1]!.age = 3;
    place(g, 'silkWorkshop', 1, true);
    place(g, 'silkWorkshop', 1, false);
    expect(av(g, 'silkWorkshop').available).toBe(true);
    place(g, 'silkWorkshop', 1, false);
    expect(av(g, 'silkWorkshop').reasons).toEqual([{ code: 'buildLimit', limit: 3 }]);
  });

  it('alreadyResearched, researchInProgress and ageAdvanceInProgress', () => {
    const g = makeGame();
    g.state.players[1]!.age = 2;
    const tc = place(g, 'townCenter', 1, true);
    expect(av(g, 'handCarts').available).toBe(true);
    tc.queue.push({ kind: 'tech', techId: 'handCarts', costPaid: { food: 0, wood: 0, gold: 0, stone: 0 }, ticksDone: 0, ticksTotal: 10 });
    expect(codes(g, 'handCarts')).toEqual(['researchInProgress']);
    expect(codes(g, 'ironAxes')).toEqual([]);
    tc.queue.length = 0;
    g.state.players[1]!.researched.push('handCarts');
    expect(av(g, 'handCarts')).toMatchObject({ available: false, hidden: false, reasons: [{ code: 'alreadyResearched' }] });

    place(g, 'archeryRange');
    place(g, 'stable');
    expect(av(g, 'citadelAge').available).toBe(true);
    tc.queue.push({ kind: 'tech', techId: 'citadelAge', costPaid: { food: 0, wood: 0, gold: 0, stone: 0 }, ticksDone: 0, ticksTotal: 10 });
    expect(codes(g, 'citadelAge')).toEqual(['ageAdvanceInProgress']);
  });

  it('age advance needs N distinct completed buildings of the current age', () => {
    const g = makeGame();
    const have = (): UnavailableReason[] => av(g, 'townshipAge').reasons;
    // Town Center (exists) and House do not count
    place(g, 'house');
    expect(have()).toEqual([{ code: 'ageBuildings', have: 0, need: 2 }]);
    place(g, 'mill');
    expect(have()).toEqual([{ code: 'ageBuildings', have: 1, need: 2 }]);
    // same type twice is still one; unfinished does not count
    place(g, 'mill');
    place(g, 'barracks', 1, false);
    expect(have()).toEqual([{ code: 'ageBuildings', have: 1, need: 2 }]);
    place(g, 'farm');
    expect(av(g, 'townshipAge').available).toBe(true);
    // buildings of other ages do not count toward the current one
    const h = makeGame();
    h.state.players[1]!.age = 2;
    place(h, 'mill');
    place(h, 'barracks');
    place(h, 'archeryRange');
    expect(av(h, 'citadelAge').reasons).toEqual([{ code: 'ageBuildings', have: 1, need: 2 }]);
    // someone else's buildings do not count
    const o = makeGame({ players: 2 });
    place(o, 'mill', 2);
    place(o, 'barracks', 2);
    expect(av(o, 'townshipAge', 1).reasons).toEqual([{ code: 'ageBuildings', have: 0, need: 2 }]);
    expect(av(o, 'townshipAge', 2).available).toBe(true);
  });

  it('reports resolved cost, affordability and shortfall', () => {
    const g = makeGame();
    const a = av(g, 'farm');
    expect(a.cost).toEqual({ food: 0, wood: 40, gold: 0, stone: 0 });
    expect(a.affordable).toBe(true);
    g.state.players[1]!.resources.wood = 25;
    expect(av(g, 'farm')).toMatchObject({ affordable: false, shortfall: { food: 0, wood: 15, gold: 0, stone: 0 } });
    expect(av(g, 'nope')).toMatchObject({ available: false, hidden: true });
  });
});

describe('the Byzantine tree at each age', () => {
  // Every age-advance prerequisite is satisfied: two completed buildings of each age, so
  // only age, civ and replaces decide the sets below.
  const setup = (age: 1 | 2 | 3 | 4): Game => {
    const g = makeGame();
    for (const b of ['mill', 'barracks', 'archeryRange', 'stable', 'siegeWorkshop', 'silkWorkshop']) place(g, b);
    const p = g.state.players[1]!;
    p.age = age;
    p.researched.push(...['townshipAge', 'citadelAge', 'empireAge'].slice(0, age - 1));
    reload(g);
    return g;
  };
  const availableIds = (g: Game): string[] => {
    const all = [...registry.units, ...registry.buildings, ...registry.techs].map((d) => d.id);
    return all.filter((id) => g.sim.query.availability(1, id).available).sort();
  };
  const visibleIds = (g: Game): string[] => {
    const all = [...registry.units, ...registry.buildings, ...registry.techs].map((d) => d.id);
    return all.filter((id) => !g.sim.query.availability(1, id).hidden).sort();
  };

  const age1 = ['villager', 'spearman', 'townCenter', 'house', 'mill', 'lumberCamp', 'miningCamp', 'farm', 'barracks', 'townshipAge'];
  const age2 = [...age1.filter((i) => i !== 'townshipAge'), 'swordsman', 'archer', 'horseman', 'archeryRange', 'stable', 'citadelAge', 'handCarts', 'ironAxes', 'irrigation', 'ironPicks'];
  const age3 = [
    ...age2.filter((i) => i !== 'citadelAge'),
    'cataphract', 'batteringRam', 'siegeWorkshop', 'silkWorkshop', 'empireAge', 'frameSaws', 'threeFieldSystem', 'timberedShafts',
  ];
  const age4 = [...age3.filter((i) => i !== 'empireAge'), 'trebuchet', 'siphonarios', 'guildCharters'];

  it('age 1', () => expect(availableIds(setup(1))).toEqual([...age1].sort()));
  it('age 2', () => expect(availableIds(setup(2))).toEqual([...age2].sort()));
  it('age 3: Cataphract and Silk Workshop appear, Lancer never', () => {
    const g = setup(3);
    expect(availableIds(g)).toEqual([...age3].sort());
    expect(availableIds(g)).not.toContain('lancer');
  });
  it('age 4: Siphonarios appears', () => {
    const g = setup(4);
    expect(availableIds(g)).toEqual([...age4].sort());
    expect(availableIds(g)).not.toContain('lancer');
  });
  it('the Lancer is hidden at every age; only the Lancer is hidden for the Byzantines', () => {
    for (const age of [1, 2, 3, 4] as const) {
      const ids = visibleIds(setup(age));
      expect(ids).not.toContain('lancer');
      expect(ids).toHaveLength([...registry.units, ...registry.buildings, ...registry.techs].length - 1);
    }
  });
});
