import { describe, expect, it } from 'vitest';
import { buildHudViewModel, type BuildViewModelInput, type HudClientState } from '../../../src/client/ui/buildViewModel';
import { createFixture, enqueue, fakeQueries, type Fixture } from '../../../src/client/ui/fixtures';
import { registry } from '../../../src/data';
import type { BuildingEntity } from '../../../src/sim/types';

const CLIENT: HudClientState = { speed: 1, paused: false, page: 'main', menuOpen: false, placing: null, toasts: [], banner: null };

function build(fx: Fixture, selection: number[], client: Partial<HudClientState> = {}) {
  const input: BuildViewModelInput = {
    state: fx.state,
    playerId: 1,
    registry,
    query: fakeQueries(fx.state),
    selection,
    client: { ...CLIENT, ...client },
  };
  return buildHudViewModel(input);
}

describe('top bar', () => {
  it('reports resources, population, age, idle villagers and the clock', () => {
    const fx = createFixture({ age: 2, popUsed: 12, popCap: 20, resources: { food: 1, wood: 2, gold: 3, stone: 4 } });
    fx.state.tick = 20 * 125 + 7;
    const vm = build(fx, [], { speed: 1.5, paused: true });
    expect(vm.topBar).toMatchObject({
      resources: { food: 1, wood: 2, gold: 3, stone: 4 },
      popUsed: 12,
      popCap: 20,
      popCapped: false,
      age: 2,
      ageName: 'Township Age',
      ageIcon: 'icon.age.2',
      clockSeconds: 125,
      speed: 1.5,
      paused: true,
    });
    // villager 3 is walking, villager 2 is carrying but idle (no order): two idle.
    expect(vm.topBar.idleVillagers).toBe(2);
  });

  it('highlights population at the cap', () => {
    const fx = createFixture({ popUsed: 20, popCap: 20 });
    expect(build(fx, []).topBar.popCapped).toBe(true);
  });
});

describe('selection', () => {
  it('none', () => {
    expect(build(createFixture(), []).selection).toEqual({ kind: 'none' });
    expect(build(createFixture(), []).commandCard).toBeNull();
  });

  it('single villager carrying wood', () => {
    const fx = createFixture();
    const vm = build(fx, [fx.villagers[1]!]);
    expect(vm.selection).toMatchObject({
      kind: 'single',
      defId: 'villager',
      name: 'Villager',
      icon: 'icon.unit.villager',
      own: true,
      hp: { current: 25, max: 25 },
      carrying: { resource: 'wood', amount: 7 },
      constructionProgress: null,
      queue: [],
    });
    expect(vm.commandCard?.buttons.length).toBe(3);
  });

  it('owner colour comes from the player', () => {
    const fx = createFixture();
    const sel = build(fx, [fx.villagers[0]!]).selection;
    expect(sel.kind === 'single' && sel.ownerColor).toBe(fx.state.players[1]!.color);
  });

  it('building with a production queue shows progress and pop block', () => {
    const fx = createFixture();
    const tc = fx.state.entities.find((e) => e.id === fx.townCenter) as BuildingEntity;
    enqueue(tc, [
      { kind: 'unit', id: 'villager', ticksDone: 200, ticksTotal: 400 },
      { kind: 'tech', id: 'handCarts', ticksDone: 0, ticksTotal: 900 },
      { kind: 'unit', id: 'villager', ticksDone: 400, ticksTotal: 400, popCapNotified: true },
    ]);
    const sel = build(fx, [fx.townCenter]).selection;
    expect(sel.kind).toBe('single');
    if (sel.kind !== 'single') return;
    expect(sel.queue.map((q) => [q.index, q.kind, q.defId, q.name, q.progress, q.popBlocked])).toEqual([
      [0, 'unit', 'villager', 'Villager', 0.5, false],
      [1, 'tech', 'handCarts', 'Hand Carts', 0, false],
      [2, 'unit', 'villager', 'Villager', 1, true],
    ]);
    expect(sel.queue[1]!.icon).toBe('icon.tech.handCarts');
  });

  it('an unfinished building reports construction progress and a reduced hp', () => {
    const fx = createFixture();
    const sel = build(fx, [fx.foundation]).selection;
    expect(sel.kind === 'single' && sel.constructionProgress).toBe(0.45);
    expect(sel.kind === 'single' && sel.hp?.current).toBeLessThan(sel.kind === 'single' ? sel.hp!.max : 0);
  });

  it('a resource node shows what remains and no command card', () => {
    const fx = createFixture();
    const vm = build(fx, [fx.tree]);
    expect(vm.selection).toMatchObject({ kind: 'single', remaining: 80, own: false, hp: null });
    expect(vm.commandCard).toBeNull();
  });

  it('an enemy unit is view-only', () => {
    const fx = createFixture();
    const vm = build(fx, [fx.enemyUnit]);
    expect(vm.selection).toMatchObject({ kind: 'single', own: false });
    expect(vm.commandCard).toBeNull();
  });

  it('multi selection lists one entry per entity', () => {
    const fx = createFixture();
    const vm = build(fx, [fx.villagers[0]!, fx.villagers[1]!, fx.spearman]);
    expect(vm.selection.kind).toBe('multi');
    if (vm.selection.kind !== 'multi') return;
    expect(vm.selection.entries.map((e) => e.defId)).toEqual(['villager', 'villager', 'spearman']);
    expect(vm.selection.entries[2]!.icon).toBe('icon.unit.spearman');
    // Only the common command is offered.
    expect(vm.commandCard?.buttons.map((b) => b.action.type)).toEqual(['stop']);
  });

  it('ignores ids that no longer exist', () => {
    const fx = createFixture();
    expect(build(fx, [99999]).selection).toEqual({ kind: 'none' });
  });
});

describe('client state passthrough', () => {
  it('copies toasts, banner, menu and placing', () => {
    const fx = createFixture();
    const toast = { id: 1, kind: 'error' as const, text: 'x', expiresAt: 5 };
    const banner = { id: 2, kind: 'objective' as const, title: 't', subtitle: 's' };
    const vm = build(fx, [], { toasts: [toast], banner, menuOpen: true, placing: 'house' });
    expect(vm).toMatchObject({ toasts: [toast], banner, menuOpen: true, placing: 'house' });
  });

  it('is a pure function of its input (same input, equal output)', () => {
    const fx = createFixture();
    expect(build(fx, [fx.townCenter])).toEqual(build(fx, [fx.townCenter]));
  });
});
