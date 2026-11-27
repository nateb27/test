import { describe, expect, it } from 'vitest';
import { buildCommandCard, type HudQueries } from '../../../src/client/ui/commandCard';
import { createFixture, fakeQueries } from '../../../src/client/ui/fixtures';
import { CARD_HOTKEYS } from '../../../src/client/ui/viewModel';
import { registry } from '../../../src/data';
import { createGame } from '../../../src/sim';
import type { DataRegistry } from '../../../src/data/schema';
import type { AgeNumber, Availability, BuildingEntity, ReadonlyEntity } from '../../../src/sim/types';

const AGES: AgeNumber[] = [1, 2, 3, 4];

type Fx = ReturnType<typeof createFixture>;

function entity(fx: Fx, id: number): ReadonlyEntity {
  const e = fx.state.entities.find((x) => x.id === id);
  if (e === undefined) throw new Error(`no entity ${id}`);
  return e;
}

function card(fx: Fx, ids: number[], page: 'main' | 'economy' | 'military' = 'main', query: HudQueries = fakeQueries(fx.state)) {
  return buildCommandCard({ playerId: 1, civ: 'byzantines', registry, query, selected: ids.map((i) => entity(fx, i)), page });
}

describe('command card content matches availability', () => {
  // Every Byzantine building at every age, with a poor state and a rich state (all techs researched).
  for (const building of registry.buildings) {
    if (building.civs !== undefined && !building.civs.includes('byzantines')) continue;
    for (const age of AGES) {
      for (const rich of [false, true]) {
        it(`${building.id} at age ${age}${rich ? ' (rich)' : ''}`, () => {
          const fx = createFixture({
            age,
            resources: rich ? { food: 5000, wood: 5000, gold: 5000, stone: 5000 } : { food: 10, wood: 0, gold: 0, stone: 0 },
            researched: rich ? registry.techs.map((t) => t.id) : [],
          });
          // Reuse the own completed house entity as this building type.
          const b = fx.state.entities.find((e) => e.id === fx.house) as BuildingEntity;
          b.typeId = building.id;
          const query = fakeQueries(fx.state);
          const vm = buildCommandCard({ playerId: 1, civ: 'byzantines', registry, query, selected: [b], page: 'main' });
          expect(vm).not.toBeNull();
          const buttons = vm!.buttons;

          // Hidden defs and techs the player already has are not on the card.
          const expectedIds = [...building.trains, ...building.researches].filter(
            (id) => !query.availability(1, id).hidden && !(rich && registry.techs.some((t) => t.id === id)),
          );
          const defButtons = buttons.filter((x) => x.action.type === 'train' || x.action.type === 'research');
          expect(defButtons.map((x) => x.defId)).toEqual(expectedIds);

          for (const btn of defButtons) {
            const av = query.availability(1, btn.defId!);
            expect(btn.enabled).toBe(av.available);
            expect(btn.reasons).toEqual(av.reasons);
            expect(btn.cost).toEqual(av.cost);
            expect(btn.shortfall).toEqual(av.shortfall);
            expect(av.hidden).toBe(false);
          }
          // Nothing hidden for the civ ever appears, and the Lancer never does for Byzantines.
          for (const def of [...registry.units, ...registry.buildings, ...registry.techs]) {
            if (query.availability(1, def.id).hidden) expect(buttons.map((x) => x.defId)).not.toContain(def.id);
          }
          expect(buttons.map((x) => x.defId)).not.toContain('lancer');
          // Rally exists exactly for buildings that train units.
          expect(buttons.some((x) => x.action.type === 'setRally')).toBe(building.trains.length > 0);
          // Unique, in-range slots whose hotkeys follow the grid.
          expect(new Set(buttons.map((x) => x.slot)).size).toBe(buttons.length);
          for (const btn of buttons) {
            expect(btn.slot).toBeGreaterThanOrEqual(0);
            expect(btn.slot).toBeLessThan(15);
            expect(btn.hotkey).toBe(CARD_HOTKEYS[btn.slot]);
          }
        });
      }
    }
  }

  it('shows exactly what a spy availability reports, however odd', () => {
    const fx = createFixture();
    const hide = new Set(['villager', 'handCarts']);
    const query: HudQueries = {
      availability: (_p, id): Availability => ({
        available: id === 'empireAge',
        hidden: hide.has(id),
        reasons: id === 'empireAge' ? [] : [{ code: 'requiresAge', age: 3 }],
        cost: { food: 1, wood: 2, gold: 3, stone: 4 },
        affordable: false,
        shortfall: { food: 0, wood: 2, gold: 0, stone: 4 },
      }),
      resolvedStat: () => 99,
    };
    const vm = card(fx, [fx.townCenter], 'main', query)!;
    expect(vm.buttons.map((b) => b.defId).filter((x) => x !== null)).toEqual(['townshipAge', 'citadelAge', 'empireAge', 'guildCharters']);
    const empire = vm.buttons.find((b) => b.defId === 'empireAge')!;
    expect(empire.enabled).toBe(true);
    expect(empire.cost).toEqual({ food: 1, wood: 2, gold: 3, stone: 4 });
    expect(empire.timeSeconds).toBe(99);
  });
});

describe('the Byzantine card never offers the Lancer', () => {
  it('lists the Cataphract at the Stable from age 3 and no Lancer', () => {
    const fx = createFixture({ age: 3 });
    const stable = fx.state.entities.find((e) => e.id === fx.house) as BuildingEntity;
    stable.typeId = 'stable';
    const ids = card(fx, [stable.id])!.buttons.map((b) => b.defId);
    expect(ids).toContain('cataphract');
    expect(ids).toContain('horseman');
    expect(ids).not.toContain('lancer');
  });

  it('hides the Silk Workshop from builders of a civ that cannot have it', () => {
    const fx = createFixture({ age: 3 });
    const v = entity(fx, fx.villagers[0]!);
    const vm = buildCommandCard({ playerId: 1, civ: 'romans', registry, query: fakeQueries(fx.state), selected: [v], page: 'economy' })!;
    expect(vm.buttons.map((b) => b.defId)).not.toContain('silkWorkshop');
  });
});

describe('villager card', () => {
  it('main page: Economy, Military, Stop in fixed slots', () => {
    const fx = createFixture();
    const vm = card(fx, [fx.villagers[0]!])!;
    expect(vm.page).toBe('main');
    expect(vm.buttons.map((b) => [b.slot, b.action.type])).toEqual([
      [0, 'page'],
      [1, 'page'],
      [2, 'stop'],
    ]);
  });

  it('economy page lists economy buildings plus Back in the corner slot', () => {
    const fx = createFixture({ age: 3 });
    const vm = card(fx, [fx.villagers[0]!], 'economy')!;
    expect(vm.page).toBe('economy');
    const places = vm.buttons.filter((b) => b.action.type === 'place').map((b) => b.defId);
    expect(places).toEqual(['house', 'mill', 'lumberCamp', 'miningCamp', 'farm', 'silkWorkshop', 'townCenter']); // Town Center buildable in M2
    const back = vm.buttons.find((b) => b.action.type === 'page')!;
    expect(back.slot).toBe(14);
    expect(back.hotkey).toBe('B');
    expect(back.action).toEqual({ type: 'page', page: 'main' });
  });

  it('military page lists the military buildings', () => {
    const fx = createFixture({ age: 3 });
    const vm = card(fx, [fx.villagers[0]!], 'military')!;
    expect(vm.buttons.filter((b) => b.action.type === 'place').map((b) => b.defId)).toEqual([
      'barracks',
      'archeryRange',
      'stable',
      'siegeWorkshop',
    ]);
  });

  it('greys out buildings that need a later age and reports the reason', () => {
    const fx = createFixture({ age: 1 });
    const vm = card(fx, [fx.villagers[0]!], 'military')!;
    const range = vm.buttons.find((b) => b.defId === 'archeryRange')!;
    expect(range.enabled).toBe(false);
    expect(range.reasons).toEqual([{ code: 'requiresAge', age: 2 }]);
    expect(vm.buttons.find((b) => b.defId === 'barracks')!.enabled).toBe(true);
  });

  it('uses the resolved (civ-adjusted) cost: Themata farms cost 40 wood', () => {
    const fx = createFixture();
    const vm = card(fx, [fx.villagers[0]!], 'economy')!;
    expect(vm.buttons.find((b) => b.defId === 'farm')!.cost).toEqual({ food: 0, wood: 40, gold: 0, stone: 0 });
  });

  it('uses the real sim queries: resolved costs and times, and the Town Center is in the economy menu (M2)', () => {
    const sim = createGame({ seed: 3, mapSize: 120, players: [{ civ: 'byzantines' }] });
    const villager = sim.state.entities.find((e) => e.kind === 'unit' && e.owner === 1)!;
    const seen = new Set<string>();
    for (const page of ['main', 'economy', 'military'] as const) {
      const vm = buildCommandCard({ playerId: 1, civ: 'byzantines', registry, query: sim.query, selected: [villager], page })!;
      for (const b of vm.buttons) if (b.defId !== null) seen.add(b.defId);
    }
    expect(seen.has('townCenter')).toBe(true);
    expect(seen.has('house')).toBe(true);
    expect(seen.has('silkWorkshop')).toBe(true);
    const eco = buildCommandCard({ playerId: 1, civ: 'byzantines', registry, query: sim.query, selected: [villager], page: 'economy' })!;
    const farm = eco.buttons.find((b) => b.defId === 'farm')!;
    expect(farm.cost).toEqual({ food: 0, wood: 40, gold: 0, stone: 0 });
    expect(farm.timeSeconds).toBe(12);
    expect(farm.enabled).toBe(true);
    // The Lancer is never offered to the Byzantines, the Cataphract is (greyed until Age 3).
    const stable = sim.state.entities.find((e) => e.kind === 'building' && e.owner === 1)!;
    const asStable = { ...stable, typeId: 'stable' } as ReadonlyEntity;
    const stableCard = buildCommandCard({ playerId: 1, civ: 'byzantines', registry, query: sim.query, selected: [asStable], page: 'main' })!;
    expect(stableCard.buttons.some((b) => b.defId === 'lancer')).toBe(false);
    expect(stableCard.buttons.find((b) => b.defId === 'cataphract')!.enabled).toBe(false);
  });

  it('a researched tech disappears from the card of the building that offered it', () => {
    const sim = createGame({ seed: 3, mapSize: 120, players: [{ civ: 'byzantines' }] });
    const tc = sim.state.entities.find((e) => e.kind === 'building' && e.owner === 1)!;
    const labels = (): string[] =>
      buildCommandCard({ playerId: 1, civ: 'byzantines', registry, query: sim.query, selected: [tc], page: 'main' })!.buttons.map((b) => b.defId ?? b.label);
    expect(labels()).toContain('handCarts');
    (sim.state.players[1] as unknown as { researched: string[] }).researched.push('handCarts');
    expect(labels()).not.toContain('handCarts');
    expect(labels()).toContain('townshipAge'); // everything else is still there
  });

  it('ignores the requested page unless every selected unit builds', () => {
    const fx = createFixture();
    expect(card(fx, [fx.villagers[0]!, fx.spearman], 'economy')!.page).toBe('main');
  });
});

describe('cost colouring data', () => {
  it('marks the short resource and nothing else', () => {
    const fx = createFixture({ resources: { food: 500, wood: 30, gold: 0, stone: 0 } });
    const vm = card(fx, [fx.villagers[0]!], 'economy')!;
    const house = vm.buttons.find((b) => b.defId === 'house')!;
    expect(house.shortfall).toEqual({ food: 0, wood: 20, gold: 0, stone: 0 });
    expect(house.enabled).toBe(true); // rules met; only the cost is red
    expect(vm.buttons.find((b) => b.defId === 'mill')!.shortfall).toEqual({ food: 0, wood: 30, gold: 0, stone: 0 });
  });

  it('has an all-zero shortfall when affordable', () => {
    const fx = createFixture();
    const vm = card(fx, [fx.townCenter])!;
    expect(vm.buttons.find((b) => b.defId === 'villager')!.shortfall).toEqual({ food: 0, wood: 0, gold: 0, stone: 0 });
  });
});

describe('building and mixed selections', () => {
  it('a Town Center offers villager, the techs, age advances and Set Rally', () => {
    const fx = createFixture({ age: 2 });
    const vm = card(fx, [fx.townCenter])!;
    expect(vm.buttons.map((b) => b.defId)).toEqual(['villager', 'townshipAge', 'citadelAge', 'empireAge', 'handCarts', 'guildCharters', null]);
    expect(vm.buttons.at(-1)!.action).toEqual({ type: 'setRally' });
    expect(vm.buttons.at(-1)!.slot).toBe(14);
    expect(vm.buttons.find((b) => b.defId === 'handCarts')!.enabled).toBe(true);
    expect(vm.buttons.find((b) => b.defId === 'guildCharters')!.reasons).toEqual([{ code: 'requiresAge', age: 4 }]);
  });

  it('an unfinished building offers only Cancel', () => {
    const fx = createFixture();
    expect(card(fx, [fx.foundation])!.buttons.map((b) => b.action.type)).toEqual(['cancelConstruction']);
  });

  it('a house offers nothing', () => {
    const fx = createFixture();
    expect(card(fx, [fx.house])!.buttons).toEqual([]);
  });

  it('villager + spearman share only Stop', () => {
    const fx = createFixture();
    expect(card(fx, [fx.villagers[0]!, fx.spearman])!.buttons.map((b) => b.action.type)).toEqual(['stop']);
  });

  it('unit + building share nothing', () => {
    const fx = createFixture();
    expect(card(fx, [fx.villagers[0]!, fx.townCenter])!.buttons).toEqual([]);
  });

  it('no card for an empty selection', () => {
    const fx = createFixture();
    expect(card(fx, [])).toBeNull();
  });
});

describe('hotkey slot mapping', () => {
  it('maps QWERT/ASDFG/ZXCVB to slots 0..14 row-major', () => {
    expect([...CARD_HOTKEYS].join('')).toBe('QWERTASDFGZXCVB');
    const fx = createFixture();
    const vm = card(fx, [fx.villagers[0]!], 'economy')!;
    for (const b of vm.buttons) expect(b.hotkey).toBe(CARD_HOTKEYS[b.slot]);
  });

  it('honours a def cardSlot and fills the rest in data order', () => {
    const fx = createFixture();
    const units = registry.units.map((u) => (u.id === 'villager' ? { ...u, cardSlot: 7 } : u));
    const patched = {
      ...registry,
      units,
      producible: (id: string) => units.find((u) => u.id === id) ?? registry.producible(id),
    } as DataRegistry;
    const vm = buildCommandCard({
      playerId: 1,
      civ: 'byzantines',
      registry: patched,
      query: fakeQueries(fx.state),
      selected: [entity(fx, fx.townCenter)],
      page: 'main',
    })!;
    expect(vm.buttons.find((b) => b.defId === 'villager')!.slot).toBe(7);
    expect(vm.buttons.find((b) => b.defId === 'townshipAge')!.slot).toBe(0);
  });
});

describe('stable slots for the whole match (WP13)', () => {
  /** slot per def id of a building's card, for a given player state. */
  const slots = (fx: Fx, id: number): Record<string, number> => {
    const vm = card(fx, [id]);
    return Object.fromEntries(vm!.buttons.filter((b) => b.defId !== null).map((b) => [b.defId as string, b.slot]));
  };

  it('an item keeps its slot as ages advance and techs are researched', () => {
    const base = createFixture({ age: 1 });
    const first = slots(base, base.townCenter);
    expect(first.villager).toBe(0);
    for (const age of [2, 3, 4] as AgeNumber[]) {
      const later = createFixture({ age });
      const s = slots(later, later.townCenter);
      for (const [def, slot] of Object.entries(s)) expect(slot, `${def} at age ${age}`).toBe(first[def]);
    }
    const done = createFixture({ age: 2, researched: ['townshipAge', 'irrigation'] });
    const s = slots(done, done.townCenter);
    expect(s.townshipAge).toBeUndefined();
    for (const [def, slot] of Object.entries(s)) expect(slot, def).toBe(first[def]);
    // the freed slot stays empty
    expect(Object.values(s)).not.toContain(first.townshipAge);
  });

  it('Hand Carts stays on one hotkey whatever has been researched', () => {
    const none = createFixture({ age: 1 });
    const some = createFixture({ age: 3, researched: ['townshipAge', 'citadelAge'] });
    expect(slots(some, some.townCenter).handCarts).toBe(slots(none, none.townCenter).handCarts);
  });

  it('a greyed (not yet available) item holds its slot', () => {
    const fx = createFixture({ age: 1 });
    const vm = card(fx, [fx.townCenter])!;
    const citadel = vm.buttons.find((b) => b.defId === 'citadelAge')!;
    expect(citadel.enabled).toBe(false);
    expect(citadel.slot).toBe(2);
  });
});
