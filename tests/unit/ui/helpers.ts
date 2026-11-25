import { SelectionStore } from '../../../src/client/input/selection';
import type { HudMatch } from '../../../src/client/ui/hudController';
import { createFixture, fakeQueries, type Fixture, type FixtureOptions } from '../../../src/client/ui/fixtures';
import type { CommandInput, EntityId, ReadonlyEntity, SimEvent } from '../../../src/sim/types';

export interface FakeMatch extends HudMatch {
  fx: Fixture;
  issued: CommandInput[];
  selection: SelectionStore;
  emit(events: SimEvent[]): void;
  /** Simulate a hotkey press (what `GameInput` does on keydown). */
  pressSlot(slot: number): void;
  uiAction(action: 'menu' | 'toggleDebug'): void;
  performed: unknown[];
}

/** A `HudMatch` over a fixture state, with the real SelectionStore and a fake input. */
export function fakeMatch(opts: FixtureOptions = {}): FakeMatch {
  const fx = createFixture(opts);
  const selection = new SelectionStore();
  const issued: CommandInput[] = [];
  const performed: unknown[] = [];
  const cardListeners = new Set<(slot: number) => void>();
  const uiListeners = new Set<(a: 'menu' | 'toggleDebug') => void>();
  const eventListeners = new Set<(events: readonly SimEvent[]) => void>();
  const queries = fakeQueries(fx.state);
  const entityById = (id: EntityId): ReadonlyEntity | undefined => fx.state.entities.find((e) => e.id === id);
  return {
    fx,
    issued,
    selection,
    performed,
    sim: { state: fx.state, query: { ...queries, entityById } },
    commands: { issue: (c) => void issued.push(c) },
    loop: { paused: false, speed: 1 },
    input: {
      selection,
      onCardSlot: (l) => {
        cardListeners.add(l);
        return () => cardListeners.delete(l);
      },
      triggerCardSlot: (slot) => {
        for (const l of [...cardListeners]) l(slot);
      },
      onUiAction: (l) => {
        uiListeners.add(l);
        return () => uiListeners.delete(l);
      },
      perform: (a) => void performed.push(a),
    },
    onEvents: (l) => {
      eventListeners.add(l);
      return () => eventListeners.delete(l);
    },
    emit: (events) => {
      for (const l of [...eventListeners]) l(events);
    },
    pressSlot: (slot) => {
      for (const l of [...cardListeners]) l(slot);
    },
    uiAction: (a) => {
      for (const l of [...uiListeners]) l(a);
    },
  };
}
