/**
 * Dev page (not in the production build): the real HUD over a fixture state
 * with a fake `availability`, so every HUD state can be inspected without the
 * sim systems. Open `/src/client/ui/dev/hud.html` under `npm run dev`.
 * `window.__hudDev` exposes the controller and fixture for scripts.
 */

import { render } from 'preact';
import { registry } from '../../../data';
import type { BuildingEntity, EntityId, ReadonlyEntity, SimEvent } from '../../../sim/types';
import { createProceduralManifest } from '../../art/procedural';
import { SelectionStore } from '../../input/selection';
import { LocalSaveStorage } from '../../platform';
import { Hud } from '../components/Hud';
import { createFixture, enqueue, fakeQueries } from '../fixtures';
import { HudController, type HudMatch } from '../hudController';
import { CARD_HOTKEYS } from '../viewModel';

declare global {
  interface Window {
    __hudDev?: {
      controller: HudController;
      fx: ReturnType<typeof createFixture>;
      select(ids: EntityId[]): void;
      emit(events: SimEvent[]): void;
    };
  }
}

async function main(): Promise<void> {
  const fx = createFixture({ age: 2, popUsed: 14, popCap: 20, resources: { food: 235, wood: 38, gold: 120, stone: 40 } });
  fx.state.tick = 20 * 372;
  const tc = fx.state.entities.find((e) => e.id === fx.townCenter) as BuildingEntity;
  enqueue(tc, [
    { kind: 'unit', id: 'villager', ticksDone: 260, ticksTotal: 400 },
    { kind: 'unit', id: 'villager', ticksDone: 0, ticksTotal: 400 },
    { kind: 'tech', id: 'handCarts', ticksDone: 0, ticksTotal: 900 },
  ]);

  const selection = new SelectionStore();
  const cardListeners = new Set<(slot: number) => void>();
  const uiListeners = new Set<(a: 'menu' | 'toggleDebug') => void>();
  const eventListeners = new Set<(events: readonly SimEvent[]) => void>();
  const queries = fakeQueries(fx.state);
  const entityById = (id: EntityId): ReadonlyEntity | undefined => fx.state.entities.find((e) => e.id === id);
  const match: HudMatch = {
    sim: { state: fx.state, query: { ...queries, entityById } },
    commands: { issue: (c) => console.info('command', c) },
    loop: { paused: false, speed: 1 },
    input: {
      selection,
      onCardSlot: (l) => {
        cardListeners.add(l);
        return () => cardListeners.delete(l);
      },
      triggerCardSlot: (slot) => cardListeners.forEach((l) => l(slot)),
      onUiAction: (l) => {
        uiListeners.add(l);
        return () => uiListeners.delete(l);
      },
      perform: (a) => console.info('perform', a),
    },
    onEvents: (l) => {
      eventListeners.add(l);
      return () => eventListeners.delete(l);
    },
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') uiListeners.forEach((l) => l('menu'));
    const slot = CARD_HOTKEYS.findIndex((k) => `Key${k}` === e.code);
    if (slot >= 0) cardListeners.forEach((l) => l(slot));
  });

  const manifest = createProceduralManifest({ registry });
  await manifest.load();

  const controller = new HudController({ match, playerId: 1 });
  controller.start();
  const root = document.getElementById('root');
  if (root === null) throw new Error('#root missing');
  render(
    <Hud
      controller={controller}
      iconUrl={(id) => manifest.iconUrl(id)}
      storage={new LocalSaveStorage()}
      sim={{ state: fx.state, step: () => [], query: match.sim.query as never }}
      onRestart={() => console.info('restart')}
      onQuit={() => console.info('quit')}
      onLoaded={() => console.info('loaded')}
    />,
    root,
  );
  window.__hudDev = {
    controller,
    fx,
    select: (ids) => selection.set(ids),
    emit: (events) => eventListeners.forEach((l) => l(events)),
  };
}

void main();
