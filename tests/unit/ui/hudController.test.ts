import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HudController, sameData } from '../../../src/client/ui/hudController';
import { fakeMatch, type FakeMatch } from './helpers';

let match: FakeMatch;
let hud: HudController;
let placed: string[];
let rallies: number;

beforeEach(() => {
  vi.useFakeTimers();
  match = fakeMatch({ age: 2 });
  placed = [];
  rallies = 0;
  hud = new HudController({
    match,
    playerId: 1,
    onStartPlacement: (b) => void placed.push(b),
    onStartRally: () => void rallies++,
  });
  hud.start();
});

afterEach(() => {
  hud.stop();
  vi.useRealTimers();
});

describe('hotkeys and clicks share one path', () => {
  it('a hotkey press trains at the selected Town Center', () => {
    match.selection.set([match.fx.townCenter]);
    expect(hud.vm.commandCard?.buttons[0]).toMatchObject({ slot: 0, hotkey: 'Q', defId: 'villager' });
    match.pressSlot(0);
    expect(match.issued).toEqual([{ type: 'train', buildingId: match.fx.townCenter, unitType: 'villager' }]);
  });

  it('a button click goes through triggerCardSlot and does the same', () => {
    match.selection.set([match.fx.townCenter]);
    hud.clickSlot(0);
    expect(match.issued).toEqual([{ type: 'train', buildingId: match.fx.townCenter, unitType: 'villager' }]);
  });

  it('research issues a research command', () => {
    match.selection.set([match.fx.townCenter]);
    const slot = hud.vm.commandCard!.buttons.find((b) => b.defId === 'handCarts')!.slot;
    match.pressSlot(slot);
    expect(match.issued).toEqual([{ type: 'research', buildingId: match.fx.townCenter, techId: 'handCarts' }]);
  });

  it('pressing an empty slot does nothing', () => {
    match.selection.set([match.fx.townCenter]);
    match.pressSlot(13);
    expect(match.issued).toEqual([]);
  });

  it('Stop sends the selected units only', () => {
    match.selection.set([match.fx.villagers[0]!, match.fx.spearman]);
    match.pressSlot(2);
    expect(match.issued).toEqual([{ type: 'stop', unitIds: [match.fx.villagers[0], match.fx.spearman] }]);
  });

  it('Cancel removes every selected unfinished building', () => {
    match.selection.set([match.fx.foundation]);
    match.pressSlot(14);
    expect(match.issued).toEqual([{ type: 'cancelConstruction', buildingId: match.fx.foundation }]);
  });
});

describe('villager build menu', () => {
  it('opens the Economy page, calls onStartPlacement for a building and goes back', () => {
    match.selection.set([match.fx.villagers[0]!]);
    match.pressSlot(0); // Economy
    expect(hud.vm.commandCard!.page).toBe('economy');
    const house = hud.vm.commandCard!.buttons.find((b) => b.defId === 'house')!;
    match.pressSlot(house.slot);
    expect(placed).toEqual(['house']);
    expect(match.issued).toEqual([]);
    match.pressSlot(14); // Back
    expect(hud.vm.commandCard!.page).toBe('main');
  });

  it('returns to the main page when the selection changes', () => {
    match.selection.set([match.fx.villagers[0]!]);
    match.pressSlot(1);
    expect(hud.vm.commandCard!.page).toBe('military');
    match.selection.set([match.fx.villagers[1]!]);
    expect(hud.vm.commandCard!.page).toBe('main');
  });

  it('reflects placement mode in the view-model', () => {
    hud.setPlacing('house');
    expect(hud.vm.placing).toBe('house');
    hud.setPlacing(null);
    expect(hud.vm.placing).toBeNull();
  });

  it('defaults to no-op callbacks', () => {
    const plain = new HudController({ match, playerId: 1 });
    plain.start();
    match.selection.set([match.fx.villagers[0]!]);
    plain.setPage('economy');
    expect(() => plain.activateSlot(plain.vm.commandCard!.buttons[0]!.slot)).not.toThrow();
    plain.stop();
  });
});

describe('Set Rally', () => {
  it('calls onStartRally and issues no command itself', () => {
    match.selection.set([match.fx.townCenter]);
    match.pressSlot(14);
    expect(rallies).toBe(1);
    expect(match.issued).toEqual([]);
  });
});

describe('greyed-out buttons', () => {
  it('explain why instead of issuing a command', () => {
    match.selection.set([match.fx.townCenter]);
    const slot = hud.vm.commandCard!.buttons.find((b) => b.defId === 'guildCharters')!.slot;
    match.pressSlot(slot);
    expect(match.issued).toEqual([]);
    expect(hud.vm.toasts.map((t) => t.text)).toEqual(['Requires Empire Age']);
  });
});

describe('events become toasts', () => {
  it('shows a rejected command and an age banner', () => {
    match.emit([
      { type: 'CommandRejected', playerId: 1, seq: 1, commandType: 'build', reason: 'cannotPlace' },
      { type: 'AgeAdvanced', playerId: 1, age: 3 },
    ]);
    expect(hud.vm.toasts.map((t) => t.text)).toEqual(['Cannot build there']);
    expect(hud.vm.banner?.title).toBe('Citadel Age');
  });

  it('toasts expire on the 10 Hz refresh', () => {
    match.emit([{ type: 'CommandRejected', playerId: 1, seq: 1, commandType: 'build', reason: 'cannotPlace' }]);
    expect(hud.vm.toasts).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(hud.vm.toasts).toHaveLength(1);
    // The controller reads performance.now(): fake timers advance it too.
    vi.advanceTimersByTime(6000);
    expect(hud.vm.toasts).toHaveLength(0);
  });
});

describe('menu and top bar actions', () => {
  it('the menu action opens the menu and pauses; a second one resumes', () => {
    match.uiAction('menu');
    expect(hud.vm.menuOpen).toBe(true);
    expect(match.loop.paused).toBe(true);
    match.uiAction('menu');
    expect(hud.vm.menuOpen).toBe(false);
    expect(match.loop.paused).toBe(false);
  });

  it('keeps an existing pause when the menu closes', () => {
    match.loop.paused = true;
    hud.setMenuOpen(true);
    hud.setMenuOpen(false);
    expect(match.loop.paused).toBe(true);
  });

  it('speed, pause and idle villager', () => {
    hud.setSpeed(2);
    expect(match.loop.speed).toBe(2);
    expect(hud.vm.topBar.speed).toBe(2);
    hud.togglePause();
    expect(match.loop.paused).toBe(true);
    expect(hud.vm.topBar.paused).toBe(true);
    hud.cycleIdleVillager();
    expect(match.performed).toEqual([{ type: 'cycleIdleVillager' }]);
  });

  it('narrowing and queue cancel', () => {
    match.selection.set([match.fx.villagers[0]!, match.fx.villagers[1]!]);
    hud.narrowSelection(match.fx.villagers[1]!);
    expect(match.selection.ids).toEqual([match.fx.villagers[1]]);
    hud.cancelQueueItem(match.fx.townCenter, 2);
    expect(match.issued).toEqual([{ type: 'cancelQueue', buildingId: match.fx.townCenter, index: 2 }]);
  });

  it('rebuilds at 10 Hz', () => {
    const seen: number[] = [];
    hud.subscribe((vm) => seen.push(vm.topBar.clockSeconds));
    match.fx.state.tick = 20 * 5;
    vi.advanceTimersByTime(100);
    expect(seen.at(-1)).toBe(5);
  });
});

describe('refreshing an unchanged view-model (WP12)', () => {
  it('does not notify subscribers, and keeps the same object', () => {
    const seen: unknown[] = [];
    hud.subscribe((vm) => seen.push(vm));
    const before = hud.vm;
    hud.refresh();
    hud.refresh();
    expect(seen).toHaveLength(0);
    expect(hud.vm).toBe(before);
  });

  it('notifies once for a change and keeps the parts that did not change as the same objects', () => {
    const seen: unknown[] = [];
    hud.subscribe((vm) => seen.push(vm));
    const before = hud.vm;
    match.selection.set([match.fx.townCenter]);
    expect(seen.length).toBeGreaterThan(0);
    expect(hud.vm).not.toBe(before);
    expect(hud.vm.topBar).toBe(before.topBar); // the top bar did not change with the selection
    expect(hud.vm.selection).not.toBe(before.selection);
    const count = seen.length;
    hud.refresh();
    expect(seen).toHaveLength(count);
  });
});

describe('sameData', () => {
  it('compares plain data structurally', () => {
    expect(sameData({ a: [1, { b: 2 }], c: null }, { c: null, a: [1, { b: 2 }] })).toBe(true);
    expect(sameData({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameData([1, 2], [1, 2, 3])).toBe(false);
    expect(sameData({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameData([], {})).toBe(false);
    expect(sameData(null, {})).toBe(false);
  });
});

describe('WP13 UX rules', () => {
  it('the demolish prompt arrives as an info toast', () => {
    match.uiAction('confirmDemolish');
    expect(hud.vm.toasts.map((t) => [t.kind, t.text])).toEqual([['info', 'Press Delete again to demolish']]);
  });

  it('a refused delete says the last Town Center cannot be demolished', () => {
    match.emit([{ type: 'CommandRejected', playerId: 1, seq: 1, commandType: 'delete', reason: 'cannotPerform' }]);
    expect(hud.vm.toasts.map((t) => t.text)).toEqual(['Your last Town Center cannot be demolished']);
    // other commands keep the generic text
    match.emit([{ type: 'CommandRejected', playerId: 1, seq: 2, commandType: 'train', reason: 'cannotPerform' }]);
    expect(hud.vm.toasts.map((t) => t.text)).toContain('That cannot do this');
  });

  it('the Pause hotkey action goes through the HUD and is ignored while the menu holds the game paused', () => {
    match.uiAction('togglePause');
    expect(match.loop.paused).toBe(true);
    match.uiAction('togglePause');
    expect(match.loop.paused).toBe(false);
    hud.setMenuOpen(true);
    match.uiAction('togglePause');
    expect(match.loop.paused).toBe(true); // still paused by the menu, not toggled off
    hud.setMenuOpen(false);
    expect(match.loop.paused).toBe(false);
  });

  it('the Delete card button uses the same confirmed path as the key', () => {
    hud.activateSlot(0);
    (hud as unknown as { perform(b: unknown): void }).perform({ action: { type: 'delete' } });
    expect(match.performed).toContainEqual({ type: 'deleteSelection' });
    expect(match.issued.some((c) => c.type === 'delete')).toBe(false);
  });

  it('a queue cancel is shown as pending until a tick applies it, with a toast while paused', () => {
    const tc = match.fx.townCenter;
    match.selection.set([tc]);
    const building = match.fx.state.entities.find((e) => e.id === tc)!;
    if (building.kind !== 'building') throw new Error('not a building');
    building.queue.push({ kind: 'unit', unitType: 'villager', costPaid: { food: 50, wood: 0, gold: 0, stone: 0 }, ticksDone: 3, ticksTotal: 400, popCapNotified: false });
    match.loop.paused = true;
    hud.refresh();
    const items = (): { cancelPending: boolean }[] => (hud.vm.selection.kind === 'single' ? hud.vm.selection.queue : []);
    expect(items().map((q) => q.cancelPending)).toEqual([false]);
    hud.cancelQueueItem(tc, 0);
    hud.cancelQueueItem(tc, 0); // a second click does not issue a second command
    expect(match.issued.filter((c) => c.type === 'cancelQueue')).toHaveLength(1);
    expect(items().map((q) => q.cancelPending)).toEqual([true]);
    expect(hud.vm.toasts.map((t) => t.text)).toEqual(['Cancel will apply when the game resumes']);
    // Still pending while paused (no tick); applied once the sim has ticked.
    vi.advanceTimersByTime(300);
    expect(items().map((q) => q.cancelPending)).toEqual([true]);
    match.fx.state.tick += 1;
    building.queue.length = 0;
    vi.advanceTimersByTime(100);
    expect(items()).toEqual([]);
  });

  it('a cancel while running is pending but needs no toast', () => {
    const tc = match.fx.townCenter;
    match.selection.set([tc]);
    const building = match.fx.state.entities.find((e) => e.id === tc)!;
    if (building.kind !== 'building') throw new Error('not a building');
    building.queue.push({ kind: 'unit', unitType: 'villager', costPaid: { food: 50, wood: 0, gold: 0, stone: 0 }, ticksDone: 3, ticksTotal: 400, popCapNotified: false });
    hud.cancelQueueItem(tc, 0);
    expect(hud.vm.toasts).toEqual([]);
  });

  it('several cancels in one tick remove exactly the clicked items, whatever the click order', () => {
    const tc = match.fx.townCenter;
    match.selection.set([tc]);
    const building = match.fx.state.entities.find((e) => e.id === tc)!;
    if (building.kind !== 'building') throw new Error('not a building');
    match.loop.paused = true;
    const orders: number[][] = [[1, 2], [0, 1], [0, 1, 2], [2, 0], [2, 1, 0], [1, 0], [0, 2], [2, 1], [1, 2, 0]];
    for (const clicks of orders) {
      match.issued.length = 0;
      const queue = ['a', 'b', 'c'];
      building.queue.length = 0;
      for (const [n] of queue.entries()) {
        building.queue.push({ kind: 'unit', unitType: 'villager', costPaid: { food: 50 + n, wood: 0, gold: 0, stone: 0 }, ticksDone: 0, ticksTotal: 400, popCapNotified: false });
      }
      hud.refresh();
      for (const index of clicks) hud.cancelQueueItem(tc, index);
      // Apply the issued commands the way the sim does: in order, each against the queue as it then is.
      const removed: string[] = [];
      for (const c of match.issued) {
        if (c.type !== 'cancelQueue') throw new Error('unexpected command');
        expect(c.index).toBeLessThan(queue.length);
        removed.push(...queue.splice(c.index, 1));
      }
      expect(removed.slice().sort(), `clicks ${clicks.join(',')}`).toEqual(clicks.map((i) => 'abc'[i]!).sort());
      match.fx.state.tick += 1; // next click batch is a new tick
    }
  });
});

describe('repair without resources (WP34)', () => {
  it('toasts once per stall when a building being repaired costs a resource the player has none of', () => {
    const s = match.fx.state;
    const tc = s.entities.find((e) => e.id === match.fx.townCenter)!;
    if (tc.kind !== 'building') throw new Error('fixture');
    tc.hp = 100;
    tc.repairerIds = [match.fx.villagers[0]!];
    const res = s.players[1]!.resources;
    res.food = 1000;
    res.gold = 1000;
    res.wood = 0;
    res.stone = 0;
    const texts = (): string[] => hud.vm.toasts.map((t) => t.text);
    // The repair may still be running on credit (bought a fraction at a time): no toast until hp stands still.
    hud.sync();
    s.tick += 10;
    tc.hp += 1;
    hud.sync();
    expect(texts().filter((t) => t.endsWith('to repair'))).toHaveLength(0);
    // Hit by an attacker meanwhile: losing hp is not progress, the stall clock runs on.
    s.tick += 20;
    tc.hp -= 5;
    hud.sync();
    s.tick += 20;
    hud.sync();
    expect(texts().filter((t) => t.endsWith('to repair'))).toHaveLength(1);
    expect(texts().find((t) => t.endsWith('to repair'))).toMatch(/^Not enough (wood|stone|wood and stone) to repair$/);
    // Still stalled: no second toast.
    hud.sync();
    expect(texts().filter((t) => t.endsWith('to repair'))).toHaveLength(1);
    // Resources arrive: the stall ends; running dry again toasts again.
    res.wood = 500;
    res.stone = 500;
    hud.sync();
    vi.advanceTimersByTime(5000);
    hud.sync();
    expect(texts().filter((t) => t.endsWith('to repair'))).toHaveLength(0);
    res.wood = 0;
    res.stone = 0;
    s.tick += 40;
    hud.sync();
    expect(texts().filter((t) => t.endsWith('to repair'))).toHaveLength(1);
  });
});

describe('the end screen (WP34)', () => {
  /** A fake match with WP30's end-screen hooks; `end(vm)` opens or closes it the way `Match` does (loop paused). */
  function withEndScreen(): { m: FakeMatch & { endScreen: object | null }; h: HudController; end(vm: object | null): void } {
    const listeners = new Set<(vm: object | null) => void>();
    const m = Object.assign(fakeMatch({ age: 2 }), {
      endScreen: null as object | null,
      onEndScreen: (l: (vm: object | null) => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    });
    const h = new HudController({ match: m, playerId: 1 });
    h.start();
    return {
      m,
      h,
      end: (vm) => {
        m.endScreen = vm;
        if (vm !== null) m.loop.paused = true;
        for (const l of listeners) l(vm);
      },
    };
  }

  it('replaces an open menu and its Resign question, and keeps the game paused', () => {
    const { m, h, end } = withEndScreen();
    h.setMenuOpen(true);
    h.requestResign();
    expect(h.vm.menuOpen).toBe(true);
    end({ result: 'victory' });
    expect(h.vm.menuOpen).toBe(false);
    expect(h.vm.resignConfirmOpen).toBe(false);
    expect(m.loop.paused).toBe(true);
    h.stop();
    // Stopping the HUD (leaving the match) does not resume a game the menu no longer holds.
    expect(m.loop.paused).toBe(true);
  });

  it('drops toasts and banners, and announces nothing behind it', () => {
    const { m, h, end } = withEndScreen();
    m.emit([{ type: 'BuildingCompleted', playerId: 1, buildingId: 9, buildingType: 'mill' }]);
    expect(h.vm.toasts).toHaveLength(1);
    end({ result: 'victory' });
    m.emit([
      { type: 'PlayerDefeated', playerId: 2, reason: 'conquered' },
      { type: 'BuildingDestroyed', playerId: 1, buildingId: 9, buildingType: 'mill', tx: 1, ty: 1, size: 2, killerId: null } as never,
    ]);
    expect(h.vm.toasts).toEqual([]);
    expect(h.vm.banner).toBeNull();
    // After "View map" the HUD announces again.
    end(null);
    m.emit([{ type: 'BuildingCompleted', playerId: 1, buildingId: 9, buildingType: 'mill' }]);
    expect(h.vm.toasts).toHaveLength(1);
    h.stop();
  });
});
