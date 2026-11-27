// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hud } from '../../../src/client/ui/components/Hud';
import { CommandCard } from '../../../src/client/ui/components/CommandCard';
import { Banner, Toasts } from '../../../src/client/ui/components/Notifications';
import { SelectionPanel } from '../../../src/client/ui/components/SelectionPanel';
import { TopBar } from '../../../src/client/ui/components/TopBar';
import { buildHudViewModel, type HudClientState } from '../../../src/client/ui/buildViewModel';
import { buildCommandCard } from '../../../src/client/ui/commandCard';
import { createFixture, fakeQueries, type Fixture } from '../../../src/client/ui/fixtures';
import { HudController } from '../../../src/client/ui/hudController';
import { ALERT_TOAST_INTERVAL_MS, NotificationCenter } from '../../../src/client/ui/notifications';
import { ALERT_TEXT, REJECT_TEXT, bonusLines } from '../../../src/client/ui/text';
import { LocalSaveStorage } from '../../../src/client/platform';
import { registry } from '../../../src/data';
import { createGame } from '../../../src/sim';
import type { BuildingEntity, ReadonlyEntity, SimEvent, Stance, UnitEntity } from '../../../src/sim/types';
import { fakeMatch } from './helpers';

afterEach(cleanup);

const CLIENT: HudClientState = { speed: 1, paused: false, page: 'main', menuOpen: false, placing: null, toasts: [], banner: null };

function vmFor(fx: Fixture, selection: number[], client: Partial<HudClientState> = {}) {
  return buildHudViewModel({ state: fx.state, playerId: 1, registry, query: fakeQueries(fx.state), selection, client: { ...CLIENT, ...client } });
}

const entity = (fx: Fixture, id: number): ReadonlyEntity => fx.state.entities.find((e) => e.id === id)!;
const unit = (fx: Fixture, id: number): UnitEntity => entity(fx, id) as UnitEntity;
const card = (fx: Fixture, ids: number[]) =>
  buildCommandCard({ playerId: 1, civ: 'byzantines', registry, query: fakeQueries(fx.state), selected: ids.map((i) => entity(fx, i)), page: 'main' })!;

describe('military command card (plan 7.1)', () => {
  it('a soldier has Stop, Attack-move, Hold and the two stances in fixed slots with fixed keys', () => {
    const fx = createFixture();
    const vm = card(fx, [fx.spearman]);
    expect(vm.buttons.map((b) => [b.slot, b.hotkey, b.action])).toEqual([
      [2, 'E', { type: 'stop' }],
      [5, 'A', { type: 'attackMove' }],
      [6, 'S', { type: 'hold' }],
      [10, 'Z', { type: 'stance', stance: 'aggressive' }],
      [11, 'X', { type: 'stance', stance: 'standGround' }],
    ]);
    expect(vm.buttons.every((b) => b.enabled && b.cost === null && b.defId === null)).toBe(true);
    expect(vm.buttons.map((b) => b.icon)).toEqual([
      'icon.command.stop',
      'icon.command.attackMove',
      'icon.command.hold',
      'icon.command.aggressive',
      'icon.command.standGround',
    ]);
  });

  it('highlights the current stance only', () => {
    const fx = createFixture();
    const active = (stance: Stance) => card(fx, [fx.spearman]).buttons.find((b) => b.action.type === 'stance' && b.action.stance === stance)!.active;
    expect([active('aggressive'), active('standGround')]).toEqual([true, false]);
    unit(fx, fx.spearman).stance = 'standGround';
    expect([active('aggressive'), active('standGround')]).toEqual([false, true]);
    const others = card(fx, [fx.spearman]).buttons.filter((b) => b.action.type !== 'stance');
    expect(others.every((b) => b.active === undefined)).toBe(true);
  });

  it('highlights a stance only when every selected soldier has it', () => {
    const fx = createFixture();
    const second = { ...unit(fx, fx.spearman), id: 900 };
    fx.state.entities.push(second);
    const stances = () => card(fx, [fx.spearman, 900]).buttons.filter((b) => b.action.type === 'stance').map((b) => b.active);
    expect(stances()).toEqual([true, false]);
    second.stance = 'standGround';
    expect(stances()).toEqual([false, false]);
    unit(fx, fx.spearman).stance = 'standGround';
    expect(stances()).toEqual([false, true]);
  });

  it('a mixed selection shows only what every unit has: villager and soldier share Stop', () => {
    const fx = createFixture();
    const vm = card(fx, [fx.villagers[0]!, fx.spearman]);
    expect(vm.buttons.map((b) => b.action.type)).toEqual(['stop']);
    const soldiers = card(fx, [fx.spearman, fx.spearman]);
    expect(soldiers.buttons).toHaveLength(5);
  });

  it('villagers get Repair in slot 3 (R) and neither Attack-move nor stances', () => {
    const fx = createFixture();
    const vm = card(fx, [fx.villagers[0]!, fx.villagers[1]!]);
    expect(vm.buttons.map((b) => [b.slot, b.hotkey, b.action.type])).toEqual([
      [0, 'Q', 'page'],
      [1, 'W', 'page'],
      [2, 'E', 'stop'],
      [3, 'R', 'repair'],
    ]);
  });

  it('every fighting unit with autoAcquire offers the same five slots; units that do not auto-acquire offer none', () => {
    for (const def of registry.units) {
      const fx = createFixture();
      const u = { ...unit(fx, fx.spearman), id: 901, typeId: def.id };
      fx.state.entities.push(u);
      const types = card(fx, [901]).buttons.map((b) => b.action.type);
      expect(types.includes('attackMove'), def.id).toBe(def.combat.autoAcquire);
      expect(types.includes('stance'), def.id).toBe(def.combat.autoAcquire);
    }
  });

  it('buildings have none of them', () => {
    const fx = createFixture();
    expect(card(fx, [fx.townCenter]).buttons.map((b) => b.action.type)).not.toContain('hold');
    expect(card(fx, [fx.house]).buttons).toEqual([]);
  });
});

describe('selection view-model (plan 7.3)', () => {
  it('hp is the entity hp over the resolved maximum', () => {
    const fx = createFixture();
    unit(fx, fx.spearman).hp = 17;
    const sel = vmFor(fx, [fx.spearman]).selection;
    expect(sel).toMatchObject({ kind: 'single', hp: { current: 17, max: registry.unit('spearman').combat.hp } });
    (entity(fx, fx.house) as BuildingEntity).hp = 33;
    expect(vmFor(fx, [fx.house]).selection).toMatchObject({ hp: { current: 33, max: registry.building('house').combat.hp } });
  });

  it('an unfinished building shows its real (construction) hp', () => {
    const fx = createFixture();
    (entity(fx, fx.foundation) as BuildingEntity).hp = 61;
    expect(vmFor(fx, [fx.foundation]).selection).toMatchObject({ hp: { current: 61 } });
  });

  it('a node has no hp', () => {
    const fx = createFixture();
    expect(vmFor(fx, [fx.tree]).selection).toMatchObject({ hp: null, combat: null, stance: null });
  });

  it('the resolved max hp includes the owner modifiers', () => {
    const fx = createFixture();
    const base = fakeQueries(fx.state);
    const query = { ...base, resolvedStat: (p: number, d: string, s: never) => (s === 'hp' ? 99 : base.resolvedStat(p, d, s)) };
    const vm = buildHudViewModel({ state: fx.state, playerId: 1, registry, query, selection: [fx.spearman], client: CLIENT });
    expect(vm.selection).toMatchObject({ hp: { max: 99 } });
  });

  it('combat line of a spearman: melee attack, no range, armour, bonuses, stance', () => {
    const fx = createFixture();
    const def = registry.unit('spearman').combat;
    const sel = vmFor(fx, [fx.spearman]).selection;
    expect(sel).toMatchObject({
      combat: { attack: def.attack, attackType: 'melee', range: 0, meleeArmor: def.meleeArmor, pierceArmor: def.pierceArmor, bonuses: bonusLines(def.bonus), note: null },
      stance: 'aggressive',
      repairing: false,
    });
  });

  it('combat line of an archer is a ranged pierce attack', () => {
    const fx = createFixture();
    unit(fx, fx.enemyUnit).typeId = 'archer';
    const def = registry.unit('archer').combat;
    expect(vmFor(fx, [fx.enemyUnit]).selection).toMatchObject({ combat: { attackType: 'pierce', range: def.range, attack: def.attack } });
  });

  it('bonus lines read "+N vs <class>" in armour class order', () => {
    expect(bonusLines({ cavalry: 12, building: 3, archer: 0 })).toEqual(['+12 vs cavalry', '+3 vs buildings']);
    expect(bonusLines({})).toEqual([]);
    const withBonus = registry.units.filter((d) => Object.keys(d.combat.bonus).length > 0);
    expect(withBonus.length).toBeGreaterThan(0);
  });

  it('a Town Center has a combat line with the arrows note; a house has none', () => {
    const fx = createFixture();
    const a = registry.building('townCenter').combat.attack!;
    expect(vmFor(fx, [fx.townCenter]).selection).toMatchObject({
      combat: { attack: a.attack, attackType: a.attackType, range: a.range, note: `Fires ${a.arrows} arrows` },
      stance: null,
    });
    expect(vmFor(fx, [fx.house]).selection).toMatchObject({ combat: null });
  });

  it('villagers show their (weak) attack and no stance; the stance is for own soldiers only', () => {
    const fx = createFixture();
    expect(vmFor(fx, [fx.villagers[0]!]).selection).toMatchObject({ stance: null, combat: { attack: registry.unit('villager').combat.attack } });
    expect(vmFor(fx, [fx.enemyUnit]).selection).toMatchObject({ stance: null });
  });

  it('an enemy is shown read-only with its owner name and the same stats; it has no command card', () => {
    const fx = createFixture();
    fx.state.players[2]!.name = 'Computer (Hard)';
    const vm = vmFor(fx, [fx.enemyUnit]);
    expect(vm.selection).toMatchObject({ own: false, ownerName: 'Computer (Hard)', combat: { attackType: 'melee' }, queue: [] });
    expect(vm.selection.kind === 'single' && vm.selection.ownerColor).toBe(fx.state.players[2]!.color);
    expect(vm.commandCard).toBeNull();
  });

  it('repairing is true while a building has repairers', () => {
    const fx = createFixture();
    const house = entity(fx, fx.house) as BuildingEntity;
    expect(vmFor(fx, [fx.house]).selection).toMatchObject({ repairing: false });
    house.repairerIds = [fx.villagers[0]!];
    expect(vmFor(fx, [fx.house]).selection).toMatchObject({ repairing: true });
  });

  it('the top bar counts idle military and carries the player colour', () => {
    const fx = createFixture();
    fx.state.players[1]!.color = 0xaa3322;
    expect(vmFor(fx, []).topBar).toMatchObject({ idleMilitary: 1, playerColor: 0xaa3322 });
    unit(fx, fx.spearman).currentOrder = { type: 'move', x: 1, y: 1, phase: 'walking' };
    expect(vmFor(fx, []).topBar.idleMilitary).toBe(0);
    unit(fx, fx.spearman).currentOrder = { type: 'hold', phase: 'holding' } as never; // on hold: not idle
    expect(vmFor(fx, []).topBar.idleMilitary).toBe(0);
    unit(fx, fx.spearman).currentOrder = null;
    expect(vmFor(fx, []).topBar.idleMilitary).toBe(1);
  });

  it('uses the real sim queries for the combat line and hp of both players', () => {
    const sim = createGame({ seed: 3, mapSize: 120, players: [{ civ: 'byzantines' }, { civ: 'byzantines' }] });
    const tc = sim.state.entities.find((e) => e.kind === 'building' && e.owner === 2)!;
    const vm = buildHudViewModel({ state: sim.state, playerId: 1, registry, query: sim.query, selection: [tc.id], client: CLIENT });
    expect(vm.selection).toMatchObject({ own: false, hp: { current: registry.building('townCenter').combat.hp }, combat: { note: 'Fires 2 arrows' } });
  });
});

describe('HudController card actions (exact commands)', () => {
  let match: ReturnType<typeof fakeMatch>;
  let hud: HudController;
  const modes: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    match = fakeMatch({ age: 2 });
    modes.length = 0;
    hud = new HudController({ match, playerId: 1, onStartAttackMove: () => void modes.push('attackMove'), onStartRepair: () => void modes.push('repair') });
    hud.start();
  });
  afterEach(() => {
    hud.stop();
    vi.useRealTimers();
  });

  it('A enters attack-move mode and issues nothing itself', () => {
    match.selection.set([match.fx.spearman]);
    match.pressSlot(5);
    expect(modes).toEqual(['attackMove']);
    expect(match.issued).toEqual([]);
  });

  it('R on villagers enters repair mode', () => {
    match.selection.set([match.fx.villagers[0]!]);
    match.pressSlot(3);
    expect(modes).toEqual(['repair']);
    expect(match.issued).toEqual([]);
  });

  it('S holds the selected soldiers', () => {
    const second = { ...unit(match.fx, match.fx.spearman), id: 900 };
    match.fx.state.entities.push(second);
    match.selection.set([900, match.fx.spearman]);
    match.pressSlot(6);
    expect(match.issued).toEqual([{ type: 'hold', unitIds: [match.fx.spearman, 900] }]);
  });

  it('Z and X set the stance of the selected soldiers; a click does the same as the key', () => {
    match.selection.set([match.fx.spearman]);
    match.pressSlot(11);
    hud.clickSlot(10);
    expect(match.issued).toEqual([
      { type: 'setStance', unitIds: [match.fx.spearman], stance: 'standGround' },
      { type: 'setStance', unitIds: [match.fx.spearman], stance: 'aggressive' },
    ]);
  });

  it('keys with no button do nothing for a mixed selection', () => {
    match.selection.set([match.fx.villagers[0]!, match.fx.spearman]);
    match.pressSlot(5);
    match.pressSlot(6);
    match.pressSlot(10);
    expect(match.issued).toEqual([]);
    expect(modes).toEqual([]);
  });

  it('the highlight follows the stance in the view-model', () => {
    match.selection.set([match.fx.spearman]);
    const stanceButtons = () => hud.vm.commandCard!.buttons.filter((b) => b.action.type === 'stance').map((b) => b.active);
    expect(stanceButtons()).toEqual([true, false]);
    unit(match.fx, match.fx.spearman).stance = 'standGround';
    hud.refresh();
    expect(stanceButtons()).toEqual([false, true]);
  });

  it('cycleIdleMilitary asks the input to cycle', () => {
    hud.cycleIdleMilitary();
    expect(match.performed).toEqual([{ type: 'cycleIdleMilitary' }]);
  });
});

describe('alerts and notifications (plan 7.3)', () => {
  function setup() {
    let now = 1000;
    const fx = createFixture();
    fx.state.players[2]!.name = 'Computer (Standard)';
    const alerts: [number, number][] = [];
    const center = new NotificationCenter({ registry, playerId: 1, now: () => now, onAlert: (x, y) => void alerts.push([x, y]) });
    return { fx, center, alerts, advance: (ms: number) => void (now += ms) };
  }
  const attacked = (over: Partial<Extract<SimEvent, { type: 'UnderAttack' }>> = {}): SimEvent => ({
    type: 'UnderAttack',
    playerId: 1,
    entityId: 5,
    entityKind: 'unit',
    townCenter: false,
    x: 10,
    y: 11,
    attackerPlayerId: 2,
    ...over,
  });

  it('raises the three alert toasts with their kinds', () => {
    const { fx, center } = setup();
    center.ingest([attacked({ entityKind: 'building', townCenter: true })], fx.state);
    center.ingest([attacked({ entityKind: 'building' })], fx.state);
    center.ingest([attacked()], fx.state);
    expect(center.toasts.map((t) => [t.kind, t.text])).toEqual([
      ['error', 'Your Town Center is under attack!'],
      ['error', 'Your buildings are under attack!'],
      ['info', 'Your units are under attack!'],
    ]);
    expect(ALERT_TEXT.townCenter).toBe('Your Town Center is under attack!');
  });

  it('at most one toast per kind per 15 s of client clock, but every alert is reported', () => {
    const { fx, center, alerts, advance } = setup();
    center.ingest([attacked({ x: 1, y: 2 })], fx.state);
    advance(ALERT_TOAST_INTERVAL_MS - 1);
    center.ingest([attacked({ x: 3, y: 4 })], fx.state);
    expect(center.toasts).toHaveLength(1);
    expect(center.toasts[0]!.text).toBe('Your units are under attack!'); // not merged into "x2": the second was throttled
    // A different kind is not throttled by the first.
    center.ingest([attacked({ entityKind: 'building', x: 5, y: 6 })], fx.state);
    expect(center.toasts).toHaveLength(2);
    advance(1);
    center.ingest([attacked({ x: 7, y: 8 })], fx.state);
    expect(center.toasts[0]!.text).toBe('Your units are under attack! ×2');
    expect(alerts).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
      [7, 8],
    ]);
  });

  it('ignores alerts for other players', () => {
    const { fx, center, alerts } = setup();
    center.ingest([attacked({ playerId: 2, attackerPlayerId: 1 })], fx.state);
    expect(center.toasts).toEqual([]);
    expect(alerts).toEqual([]);
  });

  it('an own building destroyed toasts its name as an error; an enemy one does not', () => {
    const { fx, center } = setup();
    const destroyed = (playerId: number, buildingType: string): SimEvent => ({
      type: 'BuildingDestroyed', playerId, buildingId: 9, buildingType, tx: 1, ty: 1, size: 3, constructed: true, killerPlayerId: playerId === 1 ? 2 : 1,
    });
    center.ingest([destroyed(2, 'barracks'), destroyed(1, 'barracks')], fx.state);
    expect(center.toasts.map((t) => [t.kind, t.text])).toEqual([['error', 'Barracks destroyed']]);
  });

  it('the opponent being defeated shows a banner with its name; the player\'s own defeat does not', () => {
    const { fx, center } = setup();
    center.ingest([{ type: 'PlayerDefeated', playerId: 1, reason: 'conquered' }], fx.state);
    expect(center.banner).toBeNull();
    center.ingest([{ type: 'PlayerDefeated', playerId: 2, reason: 'conquered' }], fx.state);
    expect(center.banner).toMatchObject({ kind: 'defeated', title: 'Computer (Standard) has been defeated' });
  });

  it('rejections after defeat read "You have been defeated"', () => {
    const { fx, center } = setup();
    center.ingest([{ type: 'CommandRejected', playerId: 1, seq: 1, commandType: 'move', reason: 'playerDefeated' }], fx.state);
    expect(center.toasts[0]!.text).toBe('You have been defeated');
    expect(REJECT_TEXT.playerDefeated).toBe('You have been defeated');
  });
});

describe('HudController alerts and resign', () => {
  let match: ReturnType<typeof fakeMatch>;
  let hud: HudController;
  const pings: [number, number][] = [];
  const noted: [number, number][] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    match = fakeMatch({ age: 2 });
    pings.length = 0;
    noted.length = 0;
    (match.input as { noteAlert?: (x: number, y: number) => void }).noteAlert = (x, y) => void noted.push([x, y]);
    hud = new HudController({ match, playerId: 1, onAlert: (x, y) => void pings.push([x, y]) });
    hud.start();
  });
  afterEach(() => {
    hud.stop();
    vi.useRealTimers();
  });

  it('an UnderAttack event toasts, tells the input (Space target) and the app (minimap ping)', () => {
    match.emit([{ type: 'UnderAttack', playerId: 1, entityId: 5, entityKind: 'building', townCenter: true, x: 14, y: 15, attackerPlayerId: 2 }]);
    expect(hud.vm.toasts.map((t) => t.text)).toEqual(['Your Town Center is under attack!']);
    expect(noted).toEqual([[14, 15]]);
    expect(pings).toEqual([[14, 15]]);
  });

  it('Resign needs the menu, asks first, and Yes sends resign and closes the menu', () => {
    hud.requestResign();
    expect(hud.vm.resignConfirmOpen).toBe(false); // the menu is not open
    hud.setMenuOpen(true);
    hud.requestResign();
    expect(hud.vm.resignConfirmOpen).toBe(true);
    expect(match.issued).toEqual([]);
    hud.confirmResign();
    expect(match.issued).toEqual([{ type: 'resign' }]);
    expect(hud.vm.resignConfirmOpen).toBe(false);
    expect(hud.vm.menuOpen).toBe(false);
    expect(match.loop.paused).toBe(false);
  });

  it('No closes the confirmation and keeps the menu; closing the menu forgets it', () => {
    hud.setMenuOpen(true);
    hud.requestResign();
    hud.cancelResign();
    expect(hud.vm).toMatchObject({ resignConfirmOpen: false, menuOpen: true });
    hud.requestResign();
    hud.setMenuOpen(false);
    hud.setMenuOpen(true);
    expect(hud.vm.resignConfirmOpen).toBe(false);
    expect(match.issued).toEqual([]);
  });

  it('confirming without asking sends nothing', () => {
    hud.setMenuOpen(true);
    hud.confirmResign();
    expect(match.issued).toEqual([]);
  });

  it('resigning from a game that was paused says it applies on resume', () => {
    match.loop.paused = true;
    hud.setMenuOpen(true);
    hud.requestResign();
    hud.confirmResign();
    expect(match.issued).toEqual([{ type: 'resign' }]);
    expect(hud.vm.toasts.map((t) => t.text)).toEqual(['Resignation will apply when the game resumes']);
  });
});

describe('components (M2)', () => {
  const noop = { cycleIdleVillager: vi.fn(), cycleIdleMilitary: vi.fn(), setSpeed: vi.fn(), togglePause: vi.fn() };

  it('top bar: colour swatch and idle military button that cycles', () => {
    const fx = createFixture();
    fx.state.players[1]!.color = 0xaa3322;
    render(<TopBar vm={vmFor(fx, []).topBar} actions={noop} />);
    expect(screen.getByTestId('player-swatch').getAttribute('data-color')).toBe('#aa3322');
    const idle = screen.getByTestId('idle-military') as HTMLButtonElement;
    expect(idle.textContent).toContain('1');
    expect(idle.disabled).toBe(false);
    fireEvent.click(idle);
    expect(noop.cycleIdleMilitary).toHaveBeenCalledOnce();
  });

  it('top bar: the idle military button is disabled at zero', () => {
    const fx = createFixture();
    unit(fx, fx.spearman).currentOrder = { type: 'move', x: 1, y: 1, phase: 'walking' };
    render(<TopBar vm={vmFor(fx, []).topBar} actions={noop} />);
    expect((screen.getByTestId('idle-military') as HTMLButtonElement).disabled).toBe(true);
  });

  const panelActions = { cancelQueueItem: vi.fn(), narrowSelection: vi.fn() };

  it('selection panel: combat line, stance and no owner tag for an own soldier', () => {
    const fx = createFixture();
    const def = registry.unit('spearman').combat;
    render(<SelectionPanel vm={vmFor(fx, [fx.spearman]).selection} actions={panelActions} />);
    expect(screen.getByTestId('sel-hp').textContent).toContain(`${def.hp}/${def.hp}`);
    expect(screen.getByTestId('sel-attack').textContent).toContain(`${def.attack}`);
    expect(screen.getByTestId('sel-attack').textContent).toContain('melee');
    expect(screen.queryByTestId('sel-range')).toBeNull();
    expect(screen.getByTestId('sel-armor').textContent).toContain(`M ${def.meleeArmor}`);
    expect(screen.getByTestId('sel-armor').textContent).toContain(`P ${def.pierceArmor}`);
    expect(screen.getAllByTestId('sel-bonus').map((b) => b.textContent)).toEqual(bonusLines(def.bonus));
    expect(screen.getByTestId('sel-stance').textContent).toContain('Aggressive');
    expect(screen.queryByTestId('sel-owner')).toBeNull();
  });

  it('selection panel: ranged units show the range', () => {
    const fx = createFixture();
    unit(fx, fx.spearman).typeId = 'archer';
    render(<SelectionPanel vm={vmFor(fx, [fx.spearman]).selection} actions={panelActions} />);
    expect(screen.getByTestId('sel-range').textContent).toContain(`${registry.unit('archer').combat.range}`);
    expect(screen.getByTestId('sel-attack').textContent).toContain('pierce');
  });

  it('selection panel: stand ground shows its name', () => {
    const fx = createFixture();
    unit(fx, fx.spearman).stance = 'standGround';
    render(<SelectionPanel vm={vmFor(fx, [fx.spearman]).selection} actions={panelActions} />);
    expect(screen.getByTestId('sel-stance').textContent).toContain('Stand ground');
  });

  it('selection panel: an enemy shows its owner name in its colour and the same stats, with no stance', () => {
    const fx = createFixture();
    fx.state.players[2]!.name = 'Computer (Hard)';
    fx.state.players[2]!.color = 0x2255cc;
    render(<SelectionPanel vm={vmFor(fx, [fx.enemyUnit]).selection} actions={panelActions} />);
    const owner = screen.getByTestId('sel-owner');
    expect(owner.textContent).toBe('Computer (Hard)');
    expect((owner as HTMLElement).style.color).not.toBe('');
    expect(screen.getByTestId('sel-combat')).toBeTruthy();
    expect(screen.queryByTestId('sel-stance')).toBeNull();
  });

  it('selection panel: Town Center note and the Repairing fact', () => {
    const fx = createFixture();
    const a = registry.building('townCenter').combat.attack!;
    const { unmount } = render(<SelectionPanel vm={vmFor(fx, [fx.townCenter]).selection} actions={panelActions} />);
    expect(screen.getByTestId('sel-combat-note').textContent).toBe(`Fires ${a.arrows} arrows`);
    expect(screen.getByTestId('sel-range').textContent).toContain(`${a.range}`);
    unmount();
    (entity(fx, fx.house) as BuildingEntity).repairerIds = [fx.villagers[0]!];
    render(<SelectionPanel vm={vmFor(fx, [fx.house]).selection} actions={panelActions} />);
    expect(screen.getByTestId('sel-repairing').textContent).toBe('Repairing');
    expect(screen.queryByTestId('sel-combat')).toBeNull();
  });

  it('command card: the stance button is pressed and styled, the other is not; clicks go to clickSlot', () => {
    const fx = createFixture();
    const clickSlot = vi.fn();
    render(<CommandCard vm={vmFor(fx, [fx.spearman]).commandCard} actions={{ clickSlot }} />);
    expect(screen.getByTestId('slot-10').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('slot-10').classList.contains('active')).toBe(true);
    expect(screen.getByTestId('slot-11').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('slot-11').classList.contains('active')).toBe(false);
    expect(screen.getByTestId('slot-5').getAttribute('aria-pressed')).toBeNull();
    fireEvent.click(screen.getByTestId('slot-6'));
    expect(clickSlot).toHaveBeenCalledWith(6);
  });

  it('toasts and the defeated banner render', () => {
    const fx = createFixture();
    fx.state.players[2]!.name = 'Computer (Easy)';
    const center = new NotificationCenter({ registry, playerId: 1, now: () => 0 });
    center.ingest(
      [
        { type: 'UnderAttack', playerId: 1, entityId: 5, entityKind: 'building', townCenter: true, x: 1, y: 1, attackerPlayerId: 2 },
        { type: 'PlayerDefeated', playerId: 2, reason: 'resigned' },
      ],
      fx.state,
    );
    render(
      <div>
        <Toasts toasts={center.toasts} />
        <Banner banner={center.banner} />
      </div>,
    );
    expect(screen.getByTestId('toast').textContent).toBe('Your Town Center is under attack!');
    expect(screen.getByTestId('banner').textContent).toContain('Computer (Easy) has been defeated');
    expect(screen.getByTestId('banner').textContent).toContain('They resigned');
  });
});

describe('Hud resign flow', () => {
  function mount() {
    const match = fakeMatch({ age: 2 });
    const controller = new HudController({ match, playerId: 1 });
    controller.start();
    render(
      <Hud
        controller={controller}
        iconUrl={() => ''}
        storage={new LocalSaveStorage(window.localStorage)}
        sim={{ state: match.fx.state, step: () => [], query: match.sim.query as never }}
        onRestart={vi.fn()}
        onQuit={vi.fn()}
        onLoaded={vi.fn()}
      />,
    );
    return { match, controller };
  }

  it('menu -> Resign -> "Resign this match?" -> No keeps the game; Yes sends resign', async () => {
    const { match, controller } = mount();
    controller.setMenuOpen(true);
    fireEvent.click(await screen.findByTestId('menu-resign'));
    const confirm = await screen.findByTestId('resign-confirm');
    expect(confirm.textContent).toContain('Resign this match?');
    fireEvent.click(screen.getByTestId('resign-no'));
    expect(await screen.findByTestId('menu-resign')).toBeTruthy();
    expect(match.issued).toEqual([]);
    fireEvent.click(screen.getByTestId('menu-resign'));
    fireEvent.click(await screen.findByTestId('resign-yes'));
    expect(match.issued).toEqual([{ type: 'resign' }]);
    expect(screen.queryByTestId('game-menu')).toBeNull();
    controller.stop();
  });
});
