/**
 * `window.__game` test/debug hook (plan 9.3). Installed only in dev builds and
 * in the e2e build (`vite build --mode e2e`), never in the production build.
 */

import type { EntityId, ReadonlyGameState, ResourceAmounts } from '../../sim/types';
import type { GameSpeed } from '../app/loop';
import type { PerfSnapshotEntry } from './perf';

export const DEBUG_HOOKS_ENABLED: boolean = import.meta.env.DEV || import.meta.env.MODE === 'e2e';

export type ScreenName = 'menu' | 'civSelect' | 'loading' | 'game';

export interface GameDebugHook {
  /** Current screen. */
  readonly screen: ScreenName;
  /** Live sim state, or null outside a match. Read-only. */
  readonly state: ReadonlyGameState | null;
  /** Current selection (client state). */
  readonly selection: readonly EntityId[];
  readonly paused: boolean;
  readonly speed: GameSpeed;
  /**
   * World tiles -> page CSS pixels (usable directly with `page.mouse.click`).
   * Throws outside a match.
   */
  worldToScreen(x: number, y: number): { x: number; y: number };
  /**
   * Run `n` ticks synchronously, consuming buffered commands on the first, then redraw and rebuild the HUD.
   * `present: false` skips that last part (for many small steps in a row). Throws outside a match.
   */
  step(n: number, present?: boolean): void;
  /** `hashState` of the current state. Throws outside a match. */
  hash(): string;
  setPaused(paused: boolean): void;
  /**
   * Stop the client clock that times double clicks, double taps, the demolish confirmation and toast lifetimes from
   * following real time; it then moves only through `advanceClock`. Throws outside a match.
   */
  freezeClock(): void;
  /** Move the frozen client clock forward by `ms`. Throws outside a match or while the clock is running. */
  advanceClock(ms: number): void;
  setSpeed(speed: GameSpeed): void;
  /** Active input mode (set by a Build or Set Rally button), or null. */
  inputMode(): 'placement' | 'rally' | null;
  /** The placement ghost under the cursor, or null outside placement mode. */
  ghost(): {
    tx: number;
    ty: number;
    size: number;
    ok: boolean;
    visible: boolean;
    reason: string | null;
    tileOk: boolean[];
  } | null;
  /** Counts of what the world overlays drew on the last frame. */
  overlayStats(): Record<string, number>;
  /** The entity a click at this page point would pick on the world canvas (what `pickEntity` returns), or null. Throws outside a match. */
  pickAt(x: number, y: number): EntityId | null;
  /** World tiles -> page CSS pixels on the minimap. Throws while the minimap is not mounted. */
  minimapToPage(x: number, y: number): { x: number; y: number };
  /** Cheats are issued as `cheat` commands for the local player and apply on the next tick. */
  readonly cheat: {
    addResources(amounts: Partial<ResourceAmounts>): void;
    instantBuild(enabled: boolean): void;
    instantResearch(enabled: boolean): void;
  };
  /**
   * WP12, additive. Start the plan 9.4 stress match (200 villagers, 150
   * buildings, about 1,800 resource nodes, a scripted player keeping units
   * moving) through the normal loading screen. Poll `screen === 'game'`.
   */
  startStress(seed?: number): void;
  /** WP12, additive. Set the camera zoom (0.5 to 2) about the centre of the view. Throws outside a match. */
  setZoom(zoom: number): void;
  /** WP12, additive. Frame-cost counters (see `debug/perf.ts`); off until `enable(true)`. */
  readonly perf: {
    enable(on: boolean): void;
    reset(): void;
    snapshot(): Record<string, PerfSnapshotEntry>;
  };
}

declare global {
  interface Window {
    __game?: GameDebugHook;
  }
}

/** Install the hook if enabled. */
export function installDebugHook(hook: GameDebugHook): void {
  if (DEBUG_HOOKS_ENABLED) window.__game = hook;
}
