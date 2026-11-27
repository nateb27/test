// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppHost } from '../../../src/client/app/host';
import { EndScreen } from '../../../src/client/app/screens/EndScreen';
import { buildEndScreen } from '../../../src/client/app/endScreen';
import { parseSave } from '../../../src/client/ui/saveLoad';
import { Loading } from '../../../src/client/app/screens/Loading';
import { MainMenu } from '../../../src/client/app/screens/MainMenu';
import { Setup } from '../../../src/client/app/screens/Setup';
import type { Screen } from '../../../src/client/app/screens/types';
import type { TeamAssetManifest } from '../../../src/client/art/procedural';
import { LocalSaveStorage, type Platform } from '../../../src/client/platform';
import { civSummary } from '../../../src/client/ui/civSummary';
import { registry } from '../../../src/data';
import { createGame, serialize } from '../../../src/sim';
import { MAP_SIZE } from '../../../src/sim/types';

afterEach(cleanup);

function makeHost(): { host: AppHost; load: ReturnType<typeof vi.fn> } {
  const load = vi.fn((onProgress?: (f: number) => void) => {
    onProgress?.(0.5);
    onProgress?.(1);
    return Promise.resolve();
  });
  const manifest = { load, iconUrl: () => 'data:,x' } as unknown as TeamAssetManifest;
  const platform = { storage: new LocalSaveStorage(window.localStorage), window: {} } as unknown as Platform;
  return { host: new AppHost(platform, () => Promise.resolve(manifest)), load };
}

describe('civSummary (generated from data)', () => {
  const s = civSummary('byzantines', registry);

  it('lists the civ bonus from the data', () => {
    expect(s.name).toBe('Byzantines');
    expect(s.bonuses.map((b) => b.name)).toEqual(['Themata']);
    expect(s.bonuses[0]!.description).toContain('farms cost 20% less');
  });

  it('lists the uniques with data-derived costs and the Lancer replacement', () => {
    expect(s.uniques.map((u) => u.name)).toEqual(['Cataphract', 'Siphonarios', 'Silk Workshop']);
    const cata = s.uniques[0]!;
    expect(cata.kind).toBe('Unit, Citadel Age, trained at Stable');
    expect(cata.stats).toBe('90 food, 80 gold, 34s');
    expect(cata.replaces).toBe('Replaces Lancer');
    expect(s.uniques[2]!.kind).toBe('Building, Citadel Age');
    expect(s.uniques.map((u) => u.id)).not.toContain('lancer');
  });
});

describe('MainMenu', () => {
  it('shows the title, New Game and Load Game', () => {
    const { host } = makeHost();
    const nav = vi.fn();
    render(<MainMenu navigate={nav} host={host} />);
    expect(screen.getByRole('heading', { name: 'Untitled RTS' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('new-game'));
    expect(nav).toHaveBeenCalledWith({ name: 'setup' });
  });

  it('Load Game opens the load list and loads a save into the loading screen', async () => {
    window.localStorage.clear();
    const { host } = makeHost();
    const sim = createGame({ seed: 3, mapSize: MAP_SIZE, players: [{ civ: 'byzantines' }] });
    await host.platform.storage.write('s1', serialize(sim), { name: 'Slot one', tick: 0 });
    const nav = vi.fn<(s: Screen) => void>();
    render(<MainMenu navigate={nav} host={host} />);
    fireEvent.click(screen.getByTestId('load-game'));
    fireEvent.click(await screen.findByTestId('load-s1'));
    await waitFor(() => expect(nav).toHaveBeenCalled());
    const arg = nav.mock.calls[0]![0];
    expect(arg.name).toBe('loading');
    expect(arg.name === 'loading' && arg.source.kind).toBe('sim');
  });
});

describe('Setup', () => {
  it('lists Byzantines with bonuses and uniques, and starts a match against Standard by default', async () => {
    const { host } = makeHost();
    const nav = vi.fn<(s: Screen) => void>();
    render(<Setup navigate={nav} host={host} />);
    expect(screen.getByTestId('setup-screen')).toBeTruthy();
    expect(screen.getByTestId('civ-byzantines').textContent).toContain('Byzantines');
    expect(screen.getByTestId('civ-bonuses').textContent).toContain('Themata');
    for (const id of ['cataphract', 'siphonarios', 'silkWorkshop']) expect(screen.getByTestId(`unique-${id}`)).toBeTruthy();
    expect(screen.queryByTestId('unique-lancer')).toBeNull();
    expect(screen.getByTestId('setup-opponent-standard').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('start-match'));
    const arg = nav.mock.calls[0]![0];
    expect(arg.name).toBe('loading');
    if (arg.name === 'loading' && arg.source.kind === 'new') {
      const { players } = arg.source.config;
      expect(players).toEqual([
        { civ: 'byzantines', color: 0x2f6bd8, controller: 'human' },
        { civ: 'byzantines', color: 0xc62f2f, controller: 'ai', difficulty: 'standard' },
      ]);
    } else {
      throw new Error('expected a new-game loading screen');
    }
  });

  it('No opponent starts a one-player sandbox and hides the opponent colour', () => {
    const { host } = makeHost();
    const nav = vi.fn<(s: Screen) => void>();
    render(<Setup navigate={nav} host={host} />);
    fireEvent.click(screen.getByTestId('setup-opponent-none'));
    expect(screen.queryByTestId('setup-color-2-red')).toBeNull();
    fireEvent.click(screen.getByTestId('start-match'));
    const arg = nav.mock.calls[0]![0];
    if (arg.name !== 'loading' || arg.source.kind !== 'new') throw new Error('expected a new-game loading screen');
    expect(arg.source.config.players).toEqual([{ civ: 'byzantines', color: 0x2f6bd8, controller: 'human' }]);
  });

  it('each difficulty is passed through', () => {
    for (const d of ['easy', 'hard'] as const) {
      cleanup();
      const { host } = makeHost();
      const nav = vi.fn<(s: Screen) => void>();
      render(<Setup navigate={nav} host={host} />);
      fireEvent.click(screen.getByTestId(`setup-opponent-${d}`));
      fireEvent.click(screen.getByTestId('start-match'));
      const arg = nav.mock.calls[0]![0];
      if (arg.name !== 'loading' || arg.source.kind !== 'new') throw new Error('expected a new-game loading screen');
      expect(arg.source.config.players[1]).toMatchObject({ controller: 'ai', difficulty: d });
    }
  });

  it('the two colours must differ: the other player\'s swatch is disabled, and choosing another one re-enables it', () => {
    const { host } = makeHost();
    const nav = vi.fn<(s: Screen) => void>();
    render(<Setup navigate={nav} host={host} />);
    expect((screen.getByTestId('setup-color-1-red') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('setup-color-2-blue') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('setup-color-2-green'));
    expect((screen.getByTestId('setup-color-1-red') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('setup-color-1-red'));
    fireEvent.click(screen.getByTestId('setup-color-2-blue'));
    fireEvent.click(screen.getByTestId('start-match'));
    const arg = nav.mock.calls[0]![0];
    if (arg.name !== 'loading' || arg.source.kind !== 'new') throw new Error('expected a new-game loading screen');
    expect(arg.source.config.players.map((p) => p.color)).toEqual([0xc62f2f, 0x2f6bd8]);
  });

  it('takes the map seed from the input, rejects a bad one, and Random rolls a new one', () => {
    const { host } = makeHost();
    const nav = vi.fn<(s: Screen) => void>();
    render(<Setup navigate={nav} host={host} />);
    const input = screen.getByTestId('setup-seed') as HTMLInputElement;
    fireEvent.input(input, { target: { value: '12345' } });
    fireEvent.click(screen.getByTestId('start-match'));
    const arg = nav.mock.calls[0]![0];
    if (arg.name !== 'loading' || arg.source.kind !== 'new') throw new Error('expected a new-game loading screen');
    expect(arg.source.config.seed).toBe(12345);
    expect(host.seedPinned).toBe(true);

    fireEvent.input(input, { target: { value: '4294967296' } });
    expect((screen.getByTestId('start-match') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(input, { target: { value: 'abc' } });
    expect((screen.getByTestId('start-match') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId('setup-seed-random'));
    expect(/^\d+$/.test(input.value)).toBe(true);
    expect((screen.getByTestId('start-match') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('start-match'));
    expect(host.seedPinned).toBe(false);
  });
});

describe('Loading', () => {
  it('generates the game, loads the art with progress and then enters the match', async () => {
    const { host, load } = makeHost();
    const nav = vi.fn<(s: Screen) => void>();
    render(
      <Loading
        source={{ kind: 'new', config: { seed: 5, mapSize: MAP_SIZE, players: [{ civ: 'byzantines' }] } }}
        host={host}
        navigate={nav}
      />,
    );
    expect(screen.getByTestId('loading')).toBeTruthy();
    await waitFor(() => expect(nav).toHaveBeenCalled(), { timeout: 5000 });
    expect(load).toHaveBeenCalledOnce();
    const arg = nav.mock.calls[0]![0];
    expect(arg.name).toBe('game');
    if (arg.name === 'game') {
      expect(arg.civ).toBe('byzantines');
      expect(arg.config?.seed).toBe(5);
      expect(arg.controllers).toEqual([]);
    }
  });
});

describe('Loading a save with an AI controller', () => {
  it('restores the controller memory from the save file', async () => {
    const { host } = makeHost();
    const sim = createGame({
      seed: 6,
      mapSize: MAP_SIZE,
      players: [{ civ: 'byzantines' }, { civ: 'byzantines', controller: 'ai', difficulty: 'easy' }],
    });
    const json = serialize(sim, [{ playerId: 2, kind: 'ai', difficulty: 'easy', memory: { phase: 'boom' } }]);
    const parsed = parseSave(json);
    if (!parsed.ok) throw new Error('save should load');
    const nav = vi.fn<(s: Screen) => void>();
    render(<Loading source={{ kind: 'sim', sim: parsed.sim }} host={host} navigate={nav} />);
    await waitFor(() => expect(nav).toHaveBeenCalled(), { timeout: 5000 });
    const arg = nav.mock.calls[0]![0];
    if (arg.name !== 'game') throw new Error('expected the game screen');
    expect(arg.controllers.map((c) => c.save()!.memory)).toEqual([{ phase: 'boom' }]);
    expect(arg.config?.players[1]).toMatchObject({ controller: 'ai', difficulty: 'easy' });
  });

  it('a v1-style save (no controllers block entries) starts a fresh AI for an AI slot', async () => {
    const { host } = makeHost();
    const sim = createGame({
      seed: 6,
      mapSize: MAP_SIZE,
      players: [{ civ: 'byzantines' }, { civ: 'byzantines', controller: 'ai', difficulty: 'hard' }],
    });
    const nav = vi.fn<(s: Screen) => void>();
    render(<Loading source={{ kind: 'sim', sim }} host={host} navigate={nav} />);
    await waitFor(() => expect(nav).toHaveBeenCalled(), { timeout: 5000 });
    const arg = nav.mock.calls[0]![0];
    if (arg.name !== 'game') throw new Error('expected the game screen');
    expect(arg.controllers.map((c) => [c.playerId, c.save()!.difficulty])).toEqual([[2, 'hard']]);
  });
});

describe('EndScreen', () => {
  const sim = createGame({
    seed: 2,
    mapSize: MAP_SIZE,
    players: [{ civ: 'byzantines', name: 'Ana' }, { civ: 'byzantines', controller: 'ai', difficulty: 'standard' }],
  });

  it('shows the result, the per-player stats and the three buttons', () => {
    const vm = buildEndScreen(sim.state, 1, 'defeat', 'resigned');
    const onViewMap = vi.fn();
    const onPlayAgain = vi.fn();
    const onMainMenu = vi.fn();
    render(<EndScreen vm={vm} onViewMap={onViewMap} onPlayAgain={onPlayAgain} onMainMenu={onMainMenu} />);
    expect(screen.getByTestId('end-title').textContent).toBe('Defeat');
    expect(screen.getByTestId('end-subtitle').textContent).toContain('You resigned');
    expect(screen.getByTestId('end-player-1').textContent).toContain('Ana (you)');
    expect(screen.getByTestId('end-player-2').textContent).toContain('Computer (Standard)');
    expect(screen.getByTestId('end-unitsTrained-1').textContent).toBe(String(sim.state.players[1]!.stats.unitsTrained));
    expect(screen.getByTestId('end-gathered-food-2')).toBeTruthy();
    fireEvent.click(screen.getByTestId('end-view-map'));
    fireEvent.click(screen.getByTestId('end-play-again'));
    fireEvent.click(screen.getByTestId('end-main-menu'));
    expect([onViewMap, onPlayAgain, onMainMenu].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it.each([
    ['victory', 'conquest', 'Victory'],
    ['draw', 'conquest', 'Draw'],
  ] as const)('titles a %s', (result, reason, title) => {
    render(<EndScreen vm={buildEndScreen(sim.state, 1, result, reason)} onViewMap={vi.fn()} onPlayAgain={vi.fn()} onMainMenu={vi.fn()} />);
    expect(screen.getByTestId('end-title').textContent).toBe(title);
  });
});
