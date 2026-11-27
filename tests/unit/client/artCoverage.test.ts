import { describe, expect, it } from 'vitest';
import { classifyIcon, classifySprite, iconFacing } from '../../../src/client/art/catalog';
import { registry } from '../../../src/data';

/**
 * The art catalogue was written against assumed ids; this walks the REAL
 * content registry and checks every sprite and icon id resolves to a drawing
 * (not the magenta "?" fallback). Ids in src/data are authoritative.
 */
describe('art covers the real data registry', () => {
  const spriteDefs = [...registry.units, ...registry.buildings, ...registry.nodes];

  it('has content to check', () => {
    expect(registry.units.length).toBeGreaterThan(5);
    expect(registry.buildings.length).toBeGreaterThan(5);
    expect(registry.nodes.length).toBe(4);
    expect(registry.techs.length).toBeGreaterThan(5);
  });

  it.each(spriteDefs.map((d) => [`${d.kind}.${d.id}`, d.sprite] as const))('sprite of %s (%s) is drawn', (_name, sprite) => {
    expect(classifySprite(sprite)).toBe('known');
  });

  it('sprite ids follow the <kind>.<id> convention exactly', () => {
    for (const d of spriteDefs) expect(d.sprite).toBe(`${d.kind}.${d.id}`);
  });

  const iconDefs = [...registry.units, ...registry.buildings, ...registry.nodes, ...registry.techs, ...registry.ages, ...registry.civs];
  it('every unit, building, node, tech, age and civ icon is not the fallback', () => {
    const bad: string[] = [];
    for (const d of iconDefs) if (classifyIcon(d.icon) === 'fallback') bad.push(d.icon);
    expect(bad).toEqual([]);
  });

  it('every unit, building and node icon has a dedicated drawing', () => {
    const bad: string[] = [];
    for (const d of [...registry.units, ...registry.buildings, ...registry.nodes]) if (classifyIcon(d.icon) !== 'known') bad.push(d.icon);
    expect(bad).toEqual([]);
  });

  it('every gather/economy tech has a dedicated icon (only age advances may be generic)', () => {
    // TODO(WP27): the 12 military upgrades (tag militaryTech, PLAN-M2 3.8) get dedicated icons; until then they may be
    // generic and are left out here.
    const generic = registry.techs
      .filter((t) => classifyIcon(t.icon) === 'generic' && !t.tags.includes('militaryTech'))
      .map((t) => t.id);
    for (const id of generic) expect(registry.tech(id).advancesTo, id).toBeDefined();
  });

  it('resource icons used by the HUD exist', () => {
    for (const r of ['food', 'wood', 'gold', 'stone']) expect(classifyIcon(`icon.resource.${r}`)).toBe('known');
  });
});

describe('HUD icons of mounted units show the horse', () => {
  it('draws horseman, lancer and cataphract side-on and foot units head-on', () => {
    for (const id of ['horseman', 'lancer', 'cataphract']) expect(iconFacing(id)).toBe(0);
    for (const id of ['villager', 'spearman', 'swordsman', 'archer']) expect(iconFacing(id)).toBe(1);
  });

  it('every horse-riding unit in the data is covered', () => {
    // Units of the Stable are the mounted ones.
    for (const id of registry.building('stable').trains) expect(iconFacing(id)).toBe(0);
  });
});
