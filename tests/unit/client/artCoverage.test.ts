import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { EFFECT_SPRITE_IDS, UNIT_IDS, classifyIcon, classifySprite, iconFacing, isEffectSprite, rubbleSpriteId } from '../../../src/client/art/catalog';
import { UNIT_STATE_FALLBACK, resolveUnitState, type UnitAnimState } from '../../../src/client/art/manifest';
import { allJobs } from '../../../src/client/art/rendered/jobs';
import type { SheetMeta } from '../../../src/client/art/sheet/meta';
import { sheetHitFrame } from '../../../src/client/art/sheet/manifest';
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

  it('every tech has a dedicated icon, the 12 military upgrades included (only age advances may be generic)', () => {
    const generic = registry.techs.filter((t) => classifyIcon(t.icon) === 'generic').map((t) => t.id);
    for (const id of generic) expect(registry.tech(id).advancesTo, id).toBeDefined();
    const military = registry.techs.filter((t) => t.tags.includes('militaryTech'));
    expect(military).toHaveLength(12);
    for (const t of military) expect(classifyIcon(t.icon), t.id).toBe('known');
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

describe('M2 art coverage (PLAN-M2 3.8, WP27)', () => {
  it('every effect sprite id is known: projectiles, hit effects, damage overlays, rubble by footprint', () => {
    expect([...EFFECT_SPRITE_IDS].sort()).toEqual(
      ['projectile.arrow', 'projectile.stone', 'projectile.fire', 'fx.hit', 'fx.dust', 'fx.splash', 'fx.fireSmall', 'fx.fireLarge', 'fx.smoke', 'rubble.2', 'rubble.3', 'rubble.4'].sort(),
    );
    for (const id of EFFECT_SPRITE_IDS) {
      expect(isEffectSprite(id)).toBe(true);
      expect(classifySprite(id), id).toBe('known');
    }
    expect([1, 2, 3, 4, 5].map(rubbleSpriteId)).toEqual(['rubble.2', 'rubble.2', 'rubble.3', 'rubble.4', 'rubble.4']);
    // Every building's footprint has rubble of its own size.
    for (const b of registry.buildings) expect(rubbleSpriteId(b.footprint), b.id).toBe(`rubble.${b.footprint}`);
  });

  it('the rendered art renders rubble for footprints 2, 3 and 4 in two variants', () => {
    const rubble = allJobs().filter((j) => j.type === 'rubble');
    expect(rubble.map((j) => (j.type === 'rubble' ? `${j.fp}|${j.v}` : '')).sort()).toEqual(['2|0', '2|1', '3|0', '3|1', '4|0', '4|1']);
  });

  it('every unit sheet has attack (with a hit frame inside it), death (plays once) and corpse for all 8 facings', () => {
    for (const unit of UNIT_IDS) {
      const meta = JSON.parse(readFileSync(`src/client/art/sheets/${unit}.json`, 'utf8')) as SheetMeta;
      const { attack, death, corpse } = meta.states;
      expect(attack, unit).toBeDefined();
      expect(death, unit).toBeDefined();
      expect(corpse, unit).toBeDefined();
      expect(attack!.facings).toBe(8);
      expect(death!.facings).toBe(8);
      expect(death!.loop, unit).toBe(false);
      const hit = sheetHitFrame(unit, attack!);
      expect(hit, unit).toBeGreaterThan(0);
      expect(hit, unit).toBeLessThan(attack!.frames);
    }
  });

  it('the one state fallback chain ends at idle for every state, without cycles', () => {
    for (const s of Object.keys(UNIT_STATE_FALLBACK) as UnitAnimState[]) {
      let cur: UnitAnimState | null = s;
      for (let i = 0; i < 6 && cur !== null && cur !== 'idle'; i++) cur = UNIT_STATE_FALLBACK[cur];
      expect(cur, s).toBe('idle');
    }
    const basic = ['idle', 'walk', 'work', 'carry'] as const;
    expect(resolveUnitState(basic, 'corpse')).toBe('idle');
    expect(resolveUnitState([...basic, 'death'], 'corpse')).toBe('death');
    expect(resolveUnitState(basic, 'attack')).toBe('idle');
    expect(resolveUnitState(basic, 'chop')).toBe('work');
    expect(resolveUnitState(['default'], 'walk')).toBe('default');
  });
});
