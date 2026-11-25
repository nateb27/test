import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HudController } from '../../../src/client/ui/hudController';
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
