// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandCard } from '../../../src/client/ui/components/CommandCard';
import { Hud } from '../../../src/client/ui/components/Hud';
import { Banner, Toasts } from '../../../src/client/ui/components/Notifications';
import { SelectionPanel } from '../../../src/client/ui/components/SelectionPanel';
import { TopBar } from '../../../src/client/ui/components/TopBar';
import { buildHudViewModel, type HudClientState } from '../../../src/client/ui/buildViewModel';
import { createFixture, enqueue, fakeQueries } from '../../../src/client/ui/fixtures';
import { HudController } from '../../../src/client/ui/hudController';
import { registry } from '../../../src/data';
import type { BuildingEntity } from '../../../src/sim/types';
import { LocalSaveStorage } from '../../../src/client/platform';
import { fakeMatch } from './helpers';

afterEach(cleanup);

const CLIENT: HudClientState = { speed: 1, paused: false, page: 'main', menuOpen: false, placing: null, toasts: [], banner: null };

function vmFor(fx: ReturnType<typeof createFixture>, selection: number[], client: Partial<HudClientState> = {}) {
  return buildHudViewModel({ state: fx.state, playerId: 1, registry, query: fakeQueries(fx.state), selection, client: { ...CLIENT, ...client } });
}

describe('TopBar', () => {
  const actions = { cycleIdleVillager: vi.fn(), setSpeed: vi.fn(), togglePause: vi.fn() };
  beforeEach(() => vi.clearAllMocks());

  it('shows the four resources, population, age, idle count and clock', () => {
    const fx = createFixture({ age: 2, resources: { food: 11, wood: 22, gold: 33, stone: 44 }, popUsed: 7, popCap: 20 });
    fx.state.tick = 20 * 75;
    render(<TopBar vm={vmFor(fx, []).topBar} actions={actions} />);
    expect(screen.getByTestId('res-food').textContent).toContain('11');
    expect(screen.getByTestId('res-wood').textContent).toContain('22');
    expect(screen.getByTestId('res-gold').textContent).toContain('33');
    expect(screen.getByTestId('res-stone').textContent).toContain('44');
    expect(screen.getByTestId('pop').textContent).toContain('7/20');
    expect(screen.getByTestId('age').textContent).toContain('Township Age');
    expect(screen.getByTestId('clock').textContent).toBe('1:15');
    expect(screen.getByTestId('idle-villagers').textContent).toContain('2');
  });

  it('highlights a capped population', () => {
    const fx = createFixture({ popUsed: 20, popCap: 20 });
    render(<TopBar vm={vmFor(fx, []).topBar} actions={actions} />);
    expect(screen.getByTestId('pop').classList.contains('capped')).toBe(true);
  });

  it('speed, pause and idle buttons call the actions', () => {
    const fx = createFixture();
    render(<TopBar vm={vmFor(fx, []).topBar} actions={actions} />);
    fireEvent.click(screen.getByTestId('speed-1.5'));
    fireEvent.click(screen.getByTestId('speed-2'));
    fireEvent.click(screen.getByTestId('pause'));
    fireEvent.click(screen.getByTestId('idle-villagers'));
    expect(actions.setSpeed.mock.calls).toEqual([[1.5], [2]]);
    expect(actions.togglePause).toHaveBeenCalledOnce();
    expect(actions.cycleIdleVillager).toHaveBeenCalledOnce();
    expect(screen.getByTestId('speed-1').getAttribute('aria-pressed')).toBe('true');
  });

  it('disables the idle button when nobody is idle', () => {
    const fx = createFixture();
    for (const e of fx.state.entities) if (e.kind === 'unit') e.currentOrder = { type: 'move', x: 1, y: 1, phase: 'walking' };
    render(<TopBar vm={vmFor(fx, []).topBar} actions={actions} />);
    expect((screen.getByTestId('idle-villagers') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('SelectionPanel', () => {
  const actions = { cancelQueueItem: vi.fn(), narrowSelection: vi.fn() };
  beforeEach(() => vi.clearAllMocks());

  it('single villager: name, owner colour, hp, carried resource', () => {
    const fx = createFixture();
    render(<SelectionPanel vm={vmFor(fx, [fx.villagers[1]!]).selection} actions={actions} />);
    expect(screen.getByTestId('sel-name').textContent).toBe('Villager');
    expect(screen.getByTestId('sel-hp').textContent).toContain('25/25');
    expect(screen.getByTestId('sel-carrying').textContent).toContain('Carrying 7 wood');
    expect(screen.getByTestId('owner-color').getAttribute('data-color')).toBe(`#${fx.state.players[1]!.color.toString(16)}`);
  });

  it('unfinished building shows construction progress', () => {
    const fx = createFixture();
    render(<SelectionPanel vm={vmFor(fx, [fx.foundation]).selection} actions={actions} />);
    expect(screen.getByTestId('sel-construction').textContent).toContain('45%');
  });

  it('building queue: progress, and clicking an item cancels it', () => {
    const fx = createFixture();
    enqueue(fx.state.entities.find((e) => e.id === fx.townCenter) as BuildingEntity, [
      { kind: 'unit', id: 'villager', ticksDone: 100, ticksTotal: 400 },
      { kind: 'tech', id: 'handCarts', ticksDone: 0, ticksTotal: 900 },
    ]);
    render(<SelectionPanel vm={vmFor(fx, [fx.townCenter]).selection} actions={actions} />);
    const queue = screen.getByTestId('queue');
    expect(queue.textContent).toContain('Training Villager');
    const bars = within(queue).getAllByRole('progressbar');
    expect(bars[0]!.getAttribute('aria-valuenow')).toBe('25');
    fireEvent.click(screen.getByTestId('queue-item-1'));
    expect(actions.cancelQueueItem).toHaveBeenCalledWith(fx.townCenter, 1);
  });

  it('multi selection: an icon per entity, clicking narrows', () => {
    const fx = createFixture();
    render(<SelectionPanel vm={vmFor(fx, [fx.villagers[0]!, fx.villagers[2]!, fx.spearman]).selection} actions={actions} />);
    expect(screen.getByTestId('selection-multi').textContent).toContain('3 selected');
    fireEvent.click(screen.getByTestId(`multi-${fx.spearman}`));
    expect(actions.narrowSelection).toHaveBeenCalledWith(fx.spearman);
  });

  it('nothing selected', () => {
    render(<SelectionPanel vm={{ kind: 'none' }} actions={actions} />);
    expect(screen.getByTestId('selection-panel').textContent).toContain('Nothing selected');
  });
});

describe('CommandCard', () => {
  const actions = { clickSlot: vi.fn() };
  beforeEach(() => vi.clearAllMocks());

  it('renders 15 slots with the QWERT/ASDFG/ZXCVB hotkeys', () => {
    const fx = createFixture();
    render(<CommandCard vm={vmFor(fx, [fx.townCenter]).commandCard} actions={actions} />);
    const keys = Array.from({ length: 15 }, (_, i) => screen.getByTestId(`slot-${i}`).querySelector('.hotkey')?.textContent);
    expect(keys.join('')).toBe('QWERTASDFGZXCVB');
  });

  it('clicking a slot calls clickSlot with its index', () => {
    const fx = createFixture();
    render(<CommandCard vm={vmFor(fx, [fx.townCenter]).commandCard} actions={actions} />);
    fireEvent.click(screen.getByTestId('slot-0'));
    expect(actions.clickSlot).toHaveBeenCalledWith(0);
  });

  it('unaffordable costs are red; affordable ones are not', () => {
    const fx = createFixture({ resources: { food: 500, wood: 45, gold: 0, stone: 0 } });
    render(<CommandCard vm={vmFor(fx, [fx.villagers[0]!], { page: 'economy' }).commandCard} actions={actions} />);
    const slotFor = (id: string): HTMLElement => {
      const vm = vmFor(fx, [fx.villagers[0]!], { page: 'economy' }).commandCard!;
      return screen.getByTestId(`slot-${vm.buttons.find((b) => b.defId === id)!.slot}`);
    };
    expect(slotFor('house').querySelector('.cost-wood')!.classList.contains('short')).toBe(true); // 50 > 45
    expect(slotFor('farm').querySelector('.cost-wood')!.classList.contains('short')).toBe(false); // Themata farm: 40 <= 45
  });

  it('greyed out buttons are marked disabled, with the reason in the tooltip', () => {
    const fx = createFixture({ age: 1 });
    const vm = vmFor(fx, [fx.villagers[0]!], { page: 'military' }).commandCard!;
    render(<CommandCard vm={vm} actions={actions} />);
    const slot = vm.buttons.find((b) => b.defId === 'archeryRange')!.slot;
    const el = screen.getByTestId(`slot-${slot}`);
    expect(el.classList.contains('disabled')).toBe(true);
    expect(el.getAttribute('aria-disabled')).toBe('true');
    fireEvent.mouseEnter(el);
    expect(screen.getByTestId('tooltip').textContent).toContain('Requires Township Age');
  });

  it('the tooltip shows name, cost, time, description and hotkey from data', () => {
    const fx = createFixture({ resources: { food: 10, wood: 500, gold: 0, stone: 0 } });
    const vm = vmFor(fx, [fx.townCenter]).commandCard!;
    render(<CommandCard vm={vm} actions={actions} />);
    fireEvent.mouseEnter(screen.getByTestId('slot-0'));
    const tip = screen.getByTestId('tooltip');
    expect(tip.textContent).toContain('Villager');
    expect(tip.textContent).toContain('50');
    expect(tip.textContent).toContain('20s');
    expect(tip.textContent).toContain(registry.unit('villager').description);
    expect(tip.textContent).toContain('Q');
    expect(tip.querySelector('.tooltip-cost.short')).not.toBeNull(); // food 10 < 50
    fireEvent.mouseLeave(screen.getByTestId('slot-0'));
    expect(screen.queryByTestId('tooltip')).toBeNull();
  });

  it('renders an empty grid for no selection', () => {
    render(<CommandCard vm={null} actions={actions} />);
    expect(screen.getAllByTestId(/^slot-/)).toHaveLength(15);
  });
});

describe('Toasts and Banner', () => {
  it('renders toasts by kind', () => {
    render(
      <Toasts
        toasts={[
          { id: 1, kind: 'error', text: 'Not enough wood', expiresAt: 1 },
          { id: 2, kind: 'success', text: 'Mill completed', expiresAt: 1 },
        ]}
      />,
    );
    expect(screen.getAllByTestId('toast').map((t) => t.textContent)).toEqual(['Not enough wood', 'Mill completed']);
    expect(screen.getAllByTestId('toast')[0]!.classList.contains('toast-error')).toBe(true);
  });

  it('renders a banner, and nothing without one', () => {
    const { rerender } = render(<Banner banner={null} />);
    expect(screen.queryByTestId('banner')).toBeNull();
    rerender(<Banner banner={{ id: 1, kind: 'ageAdvanced', title: 'Township Age', subtitle: 'sub' }} />);
    expect(screen.getByTestId('banner').textContent).toContain('Township Age');
  });
});

describe('Hud', () => {
  let storage: LocalSaveStorage;
  beforeEach(() => {
    storage = new LocalSaveStorage(window.localStorage);
  });

  function mount() {
    const match = fakeMatch({ age: 2 });
    const controller = new HudController({ match, playerId: 1 });
    controller.start();
    const result = render(
      <Hud
        controller={controller}
        iconUrl={() => ''}
        storage={storage}
        sim={{ state: match.fx.state, step: () => [], query: match.sim.query as never }}
        onRestart={vi.fn()}
        onQuit={vi.fn()}
        onLoaded={vi.fn()}
      />,
    );
    return { match, controller, ...result };
  }

  it('has an empty #minimap-slot for WP10 and never captures pointer events on its root', () => {
    const { controller } = mount();
    const slot = document.getElementById('minimap-slot');
    expect(slot).not.toBeNull();
    expect(slot!.childElementCount).toBe(0);
    expect(screen.getByTestId('hud').classList.contains('hud')).toBe(true);
    controller.stop();
  });

  it('re-renders when the selection changes and a card click issues a command', async () => {
    const { match, controller } = mount();
    expect(screen.getByTestId('selection-panel').textContent).toContain('Nothing selected');
    match.selection.set([match.fx.townCenter]);
    expect(await screen.findByTestId('sel-name')).toBeTruthy();
    expect(screen.getByTestId('sel-name').textContent).toBe('Town Center');
    fireEvent.click(screen.getByTestId('slot-0'));
    expect(match.issued).toEqual([{ type: 'train', buildingId: match.fx.townCenter, unitType: 'villager' }]);
    controller.stop();
  });

  it('opens the pause menu on the menu action and Resume closes it', async () => {
    const { match, controller } = mount();
    expect(screen.queryByTestId('game-menu')).toBeNull();
    match.uiAction('menu');
    expect(await screen.findByTestId('game-menu')).toBeTruthy();
    for (const id of ['menu-resume', 'menu-save', 'menu-load', 'menu-restart', 'menu-quit']) expect(screen.getByTestId(id)).toBeTruthy();
    fireEvent.click(screen.getByTestId('menu-resume'));
    expect(screen.queryByTestId('game-menu')).toBeNull();
    expect(match.loop.paused).toBe(false);
    controller.stop();
  });

  it('shows a placing hint while placing', async () => {
    const { controller } = mount();
    controller.setPlacing('house');
    expect(await screen.findByTestId('placing-hint')).toBeTruthy();
    controller.stop();
  });
});
