// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalSaveStorage, type SaveStorage } from '../../../src/client/platform';
import { SaveLoadPanel } from '../../../src/client/ui/components/SaveLoadPanel';
import { parseSave } from '../../../src/client/ui/saveLoad';
import { createGame, hashState, serialize } from '../../../src/sim';
import { MAP_SIZE, type Sim } from '../../../src/sim/types';

afterEach(cleanup);

let storage: SaveStorage;
let sim: Sim;

beforeEach(() => {
  window.localStorage.clear();
  storage = new LocalSaveStorage(window.localStorage, () => 1_700_000_000_000);
  sim = createGame({ seed: 42, mapSize: MAP_SIZE, players: [{ civ: 'byzantines' }] });
  for (let i = 0; i < 40; i++) sim.step([]);
});

describe('save then load through the UI', () => {
  it('round-trips the state hash', async () => {
    const before = hashState(sim.state);
    const saved = render(<SaveLoadPanel storage={storage} mode="save" sim={sim} onLoaded={vi.fn()} onBack={vi.fn()} now={() => 1234} />);
    fireEvent.input(screen.getByTestId('save-name'), { target: { value: 'My game' } });
    fireEvent.click(screen.getByTestId('save-new'));
    expect(await screen.findByTestId('save-save-1234')).toBeTruthy();
    expect(screen.getByTestId('saveload-message').textContent).toContain('Saved "My game"');
    saved.unmount();

    // The save really is in storage, written by `serialize`.
    expect(await storage.read('save-1234')).toBe(serialize(sim));

    const loaded: Sim[] = [];
    render(<SaveLoadPanel storage={storage} mode="load" onLoaded={(s) => loaded.push(s)} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('load-save-1234'));
    await waitFor(() => expect(loaded).toHaveLength(1));
    expect(hashState(loaded[0]!.state)).toBe(before);

    // And the loaded game continues identically to the original.
    for (let i = 0; i < 30; i++) {
      sim.step([]);
      loaded[0]!.step([]);
    }
    expect(hashState(loaded[0]!.state)).toBe(hashState(sim.state));
  });

  it('overwrites a slot and deletes it', async () => {
    await storage.write('a', serialize(sim), { name: 'First', tick: 1 });
    render(<SaveLoadPanel storage={storage} mode="save" sim={sim} onLoaded={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('overwrite-a'));
    await waitFor(() => expect(screen.getByTestId('saveload-message').textContent).toContain('Saved "First"'));
    expect((await storage.list())[0]!.tick).toBe(sim.state.tick);
    fireEvent.click(screen.getByTestId('delete-a'));
    await waitFor(() => expect(screen.getByTestId('save-list').textContent).toContain('No saved games'));
    expect(await storage.read('a')).toBeNull();
  });

  it('exports to a file through the storage', async () => {
    const exportToFile = vi.fn(() => Promise.resolve());
    const fake: SaveStorage = { ...storage, list: () => Promise.resolve([]), exportToFile } as SaveStorage;
    render(<SaveLoadPanel storage={fake} mode="save" sim={sim} onLoaded={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(screen.getByTestId('export-file'));
    await waitFor(() => expect(exportToFile).toHaveBeenCalled());
    const [name, data] = exportToFile.mock.calls[0] as unknown as [string, string];
    expect(name).toMatch(/\.json$/);
    expect(data).toBe(serialize(sim));
  });

  it('imports a file and loads it', async () => {
    const json = serialize(sim);
    const fake: SaveStorage = { ...storage, list: () => Promise.resolve([]), importFromFile: () => Promise.resolve(json) } as SaveStorage;
    const loaded: Sim[] = [];
    render(<SaveLoadPanel storage={fake} mode="load" onLoaded={(s) => loaded.push(s)} onBack={vi.fn()} />);
    fireEvent.click(screen.getByTestId('import-file'));
    await waitFor(() => expect(loaded).toHaveLength(1));
    expect(hashState(loaded[0]!.state)).toBe(hashState(sim.state));
  });

  it('does nothing when the import is cancelled', async () => {
    const fake: SaveStorage = { ...storage, list: () => Promise.resolve([]), importFromFile: () => Promise.resolve(null) } as SaveStorage;
    const onLoaded = vi.fn();
    render(<SaveLoadPanel storage={fake} mode="load" onLoaded={onLoaded} onBack={vi.fn()} />);
    fireEvent.click(screen.getByTestId('import-file'));
    await new Promise((r) => setTimeout(r, 10));
    expect(onLoaded).not.toHaveBeenCalled();
    expect(screen.queryByTestId('saveload-message')).toBeNull();
  });
});

describe('unsupported and damaged saves', () => {
  it('says clearly when the version is unsupported', async () => {
    const future = JSON.stringify({ version: 99, state: {} });
    await storage.write('future', future, { name: 'From the future', tick: 0 });
    const onLoaded = vi.fn();
    render(<SaveLoadPanel storage={storage} mode="load" onLoaded={onLoaded} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('load-future'));
    const msg = await screen.findByTestId('saveload-message');
    expect(msg.textContent).toContain('different version');
    expect(msg.textContent).toContain('99');
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it('parseSave classifies every failure without throwing', () => {
    expect(parseSave(null)).toMatchObject({ ok: false, kind: 'empty' });
    expect(parseSave('not json')).toMatchObject({ ok: false, kind: 'corrupt' });
    expect(parseSave('{"a":1}')).toMatchObject({ ok: false, kind: 'corrupt' });
    expect(parseSave('{"version":0,"state":{}}')).toMatchObject({ ok: false, kind: 'unsupportedVersion' });
    expect(parseSave('{"version":1,"state":{"tick":"x"}}')).toMatchObject({ ok: false });
    expect(parseSave(serialize(sim))).toMatchObject({ ok: true });
  });
});
