// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { Controller } from '../../../src/bot';
import { Match } from '../../../src/client/app/match';
import { serialize } from '../../../src/sim';
import { createGame } from '../../../src/sim';
import { saveToSlot } from '../../../src/client/ui/saveLoad';
import { LocalSaveStorage } from '../../../src/client/platform';
import type { Command, CommandInput, Sim, SimEvent } from '../../../src/sim/types';
import { MAP_SIZE } from '../../../src/sim/types';

function fakeLayer(): unknown {
  return new Proxy(() => undefined, { get: () => fakeLayer(), apply: () => undefined });
}

/** A renderer that accepts every call; the match logic under test never needs a picture. */
function fakeRenderer(): never {
  const canvas = document.createElement('canvas');
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'canvas') return canvas;
      if (prop === 'layers') return { groundOverlays: fakeLayer(), worldOverlays: fakeLayer() };
      if (prop === 'lastDrawn') return [];
      if (prop === 'then') return undefined;
      return new Proxy(() => undefined, handler as ProxyHandler<() => undefined>);
    },
    apply: () => undefined,
  };
  return new Proxy({}, handler) as never;
}

/** Overlay textures are baked on 2D canvases; a context that swallows every call is enough here. */
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => fakeLayer()) as never);

function makeMatch(controllers: Controller[]): { match: Match; sim: Sim } {
  const sim = createGame({
    seed: 4,
    mapSize: MAP_SIZE,
    players: [{ civ: 'byzantines' }, { civ: 'byzantines', controller: 'ai', difficulty: 'easy' }],
  });
  return { match: new Match(sim, fakeRenderer(), undefined, controllers), sim };
}

function spyController(playerId: number): Controller & { calls: number } {
  const c = {
    playerId,
    calls: 0,
    update(_sim: Sim): Command[] {
      c.calls++;
      return [{ type: 'cheat', playerId, seq: c.calls, cheat: { kind: 'addResources', amounts: { food: 7 } } } as Command];
    },
    save: () => null,
  };
  return c;
}

describe('Match controllers', () => {
  it('merges controller commands with the human ones into one sim.step', () => {
    const ai = spyController(2);
    const { match, sim } = makeMatch([ai]);
    const step = vi.spyOn(sim, 'step');
    match.commands.issue({ type: 'cheat', cheat: { kind: 'addResources', amounts: { food: 1 } } } as CommandInput);
    match.tick();
    expect(step).toHaveBeenCalledTimes(1);
    expect(step.mock.calls[0]![0].map((c) => c.playerId).sort()).toEqual([1, 2]);
    expect(ai.calls).toBe(1);
    match.destroy();
  });

  it('does not run controllers while disabled, or for a defeated player', () => {
    const ai = spyController(2);
    const { match, sim } = makeMatch([ai]);
    match.aiEnabled = false;
    match.tick();
    expect(ai.calls).toBe(0);
    match.aiEnabled = true;
    match.commands.issue({ type: 'cheat', cheat: { kind: 'defeat', playerId: 2 } } as CommandInput);
    match.tick();
    expect(sim.state.players[2]!.outcome).toBe('defeated');
    const calls = ai.calls;
    match.tick();
    expect(ai.calls).toBe(calls);
    match.destroy();
  });

  it('saveControllers keeps only controllers that have a save, and saving writes them into the file', async () => {
    const save = { playerId: 2, kind: 'ai' as const, difficulty: 'easy' as const, memory: { a: 1 } };
    const { match, sim } = makeMatch([
      { playerId: 2, update: () => [], save: () => save },
      { playerId: 3, update: () => [], save: () => null },
    ]);
    expect(match.saveControllers()).toEqual([save]);
    window.localStorage.clear();
    const storage = new LocalSaveStorage(window.localStorage);
    await saveToSlot(storage, sim, 's', 'S');
    expect(await storage.read('s')).toBe(serialize(sim, [save]));
    match.destroy();
    await saveToSlot(storage, sim, 's', 'S');
    expect(await storage.read('s')).toBe(serialize(sim, []));
  });
});

describe('Match end screen and alerts', () => {
  const stepReturning = (sim: Sim, events: SimEvent[]): void => {
    vi.spyOn(sim, 'step').mockReturnValueOnce(events);
  };

  it('opens the end screen on MatchEnded, pauses, and View map closes it and resumes', () => {
    const { match, sim } = makeMatch([]);
    const seen: (string | null)[] = [];
    match.onEndScreen((vm) => seen.push(vm?.result ?? null));
    stepReturning(sim, [{ type: 'MatchEnded', winner: 1, tick: 1 }]);
    match.tick();
    expect(match.endScreen?.result).toBe('victory');
    expect(match.loop.paused).toBe(true);
    match.closeEndScreen();
    expect(match.endScreen).toBeNull();
    expect(match.loop.paused).toBe(false);
    expect(seen).toEqual(['victory', null]);
    // Once only: a later event batch does not bring it back.
    stepReturning(sim, [{ type: 'MatchEnded', winner: 1, tick: 2 }]);
    match.tick();
    expect(match.endScreen).toBeNull();
    match.destroy();
  });

  it('reports the local UnderAttack events as live alerts for 3 s of game time, at most 4', () => {
    const { match, sim } = makeMatch([]);
    const hit = (x: number, playerId = 1): SimEvent => ({
      type: 'UnderAttack', playerId, entityId: 5, entityKind: 'unit', townCenter: false, x, y: 2, attackerPlayerId: 2,
    });
    stepReturning(sim, [hit(1), hit(2), hit(3), hit(4), hit(5), hit(9, 2)]);
    match.tick();
    expect(match.alerts().map((a) => a.x)).toEqual([2, 3, 4, 5]);
    for (let i = 0; i < 59; i++) match.tick();
    expect(match.alerts().length).toBe(4);
    match.tick();
    expect(match.alerts()).toEqual([]);
    match.destroy();
  });
});
