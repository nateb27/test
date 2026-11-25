import { describe, expect, it } from 'vitest';
import { createRegistry, registry } from '../../../src/data/index';

describe('registry', () => {
  it('has four ages in order and the Byzantines', () => {
    expect(registry.ages.map((a) => a.age)).toEqual([1, 2, 3, 4]);
    expect(registry.age(4).name).toBe('Empire Age');
    expect(registry.civ('byzantines').name).toBe('Byzantines');
    expect(registry.terrain('grass').walkable).toBe(true);
  });

  it('throws on unknown ids and returns undefined from def()', () => {
    expect(() => registry.unit('nope')).toThrow(/Unknown unit/);
    expect(registry.def('nope')).toBeUndefined();
  });

  it('rejects ids shared across def kinds', () => {
    const base = {
      name: 'X',
      description: '',
      age: 1 as const,
      tags: [],
      cost: {},
      icon: 'icon.x',
    };
    expect(() =>
      createRegistry({
        units: [
          { ...base, kind: 'unit', id: 'dup', trainTime: 1, popCost: 1, speed: 1, sprite: 's', combat: { hp: 1, attack: 0, armor: 0, range: 0 } },
        ],
        buildings: [],
        techs: [{ ...base, kind: 'tech', id: 'dup', researchTime: 1, effects: [] }],
        ages: registry.ages,
        civs: registry.civs,
        nodes: [],
        terrains: registry.terrains,
        start: registry.start,
      }),
    ).toThrow(/two kinds/);
  });
});
