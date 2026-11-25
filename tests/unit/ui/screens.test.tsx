// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppHost } from '../../../src/client/app/host';
import { CivSelect } from '../../../src/client/app/screens/CivSelect';
import { Loading } from '../../../src/client/app/screens/Loading';
import { MainMenu } from '../../../src/client/app/screens/MainMenu';
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
    expect(nav).toHaveBeenCalledWith({ name: 'civSelect' });
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

describe('CivSelect', () => {
  it('lists Byzantines with bonuses and uniques, and starts a match', async () => {
    const { host } = makeHost();
    const nav = vi.fn<(s: Screen) => void>();
    render(<CivSelect navigate={nav} host={host} />);
    expect(screen.getByTestId('civ-byzantines').textContent).toContain('Byzantines');
    expect(screen.getByTestId('civ-bonuses').textContent).toContain('Themata');
    for (const id of ['cataphract', 'siphonarios', 'silkWorkshop']) expect(screen.getByTestId(`unique-${id}`)).toBeTruthy();
    expect(screen.queryByTestId('unique-lancer')).toBeNull();
    fireEvent.click(screen.getByTestId('start-match'));
    const arg = nav.mock.calls[0]![0];
    expect(arg.name).toBe('loading');
    if (arg.name === 'loading' && arg.source.kind === 'new') {
      expect(arg.source.config.players).toEqual([{ civ: 'byzantines' }]);
    } else {
      throw new Error('expected a new-game loading screen');
    }
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
    }
  });
});
