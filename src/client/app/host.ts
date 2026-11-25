/**
 * App-level state outside the Preact tree: platform services, the current
 * screen name and the running match. Backs the `window.__game` hook.
 */

import { hashState } from '../../sim/hash';
import type { GameDebugHook, ScreenName } from '../debug/hook';
import type { Platform } from '../platform';
import type { Match } from './match';

export class AppHost {
  screen: ScreenName = 'menu';
  match: Match | null = null;

  constructor(readonly platform: Platform) {}

  setMatch(match: Match | null): void {
    this.match = match;
  }

  /** The running match; throws if none. */
  requireMatch(): Match {
    if (this.match === null) throw new Error('No match is running');
    return this.match;
  }

  /** Build the `window.__game` hook object backed by this host. */
  createDebugHook(): GameDebugHook {
    return createDebugHook(this);
  }
}

function createDebugHook(host: AppHost): GameDebugHook {
  return {
    get screen() {
      return host.screen;
    },
    get state() {
      return host.match?.sim.state ?? null;
    },
    get selection() {
      return host.match?.selection ?? [];
    },
    get paused() {
      return host.match?.loop.paused ?? false;
    },
    get speed() {
      return host.match?.loop.speed ?? 1;
    },
    worldToScreen(x, y) {
      const match = host.requireMatch();
      const p = match.renderer.worldToCanvas(x, y);
      const rect = match.renderer.canvas.getBoundingClientRect();
      return { x: rect.left + p.x, y: rect.top + p.y };
    },
    step(n) {
      host.requireMatch().stepTicks(n);
    },
    hash() {
      return hashState(host.requireMatch().sim.state);
    },
    setPaused(paused) {
      host.requireMatch().loop.paused = paused;
    },
    setSpeed(speed) {
      host.requireMatch().loop.speed = speed;
    },
    cheat: {
      addResources(amounts) {
        host.requireMatch().commands.issue({ type: 'cheat', cheat: { kind: 'addResources', amounts } });
      },
      instantBuild(enabled) {
        host.requireMatch().commands.issue({ type: 'cheat', cheat: { kind: 'instantBuild', enabled } });
      },
      instantResearch(enabled) {
        host.requireMatch().commands.issue({ type: 'cheat', cheat: { kind: 'instantResearch', enabled } });
      },
    },
  };
}
