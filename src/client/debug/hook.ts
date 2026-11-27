/**
 * `window.__game` test/debug hook (plan 9.3). Installed only in dev builds and
 * in the e2e build (`vite build --mode e2e`), never in the production build.
 */

import type { EntityId, JsonValue, MatchMode, PlayerId, ReadonlyGameState, ResourceAmounts, UnitId } from '../../sim/types';
import type { GameSpeed } from '../app/loop';
import type { EffectStats } from '../render/renderer';
import type { EndScreenVM } from '../ui/viewModel';
import type { PerfSnapshotEntry } from './perf';

export const DEBUG_HOOKS_ENABLED: boolean = import.meta.env.DEV || import.meta.env.MODE === 'e2e';

export type ScreenName = 'menu' | 'setup' | 'loading' | 'game';

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
  /** Active input mode (Build, Set Rally, Attack-move or Repair button), or null. */
  inputMode(): 'placement' | 'rally' | 'attackMove' | 'repair' | null;
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
    /** M2: spawn a unit at a world point; `owner` defaults to the local player (2 spawns an enemy). */
    spawnUnit(unitType: UnitId, x: number, y: number, owner?: PlayerId): void;
    /** M2: set an entity's hp (clamped to 0..max); 0 kills it. */
    setHp(entityId: EntityId, hp: number): void;
    /** M2: mark a player defeated as if conquered. */
    defeat(playerId: PlayerId): void;
  };
  /** M2: the human player's id (always 1). */
  readonly localPlayerId: PlayerId;
  /** M2: the match state, or null outside a match. */
  match(): { mode: MatchMode; winner: PlayerId | null; endedTick: number | null } | null;
  /** M2: AI controllers (`?ai=off` starts them disabled). */
  readonly ai: { setEnabled(on: boolean): void; enabled(): boolean; memory(playerId: PlayerId): JsonValue | null };
  /** M2: start the PLAN-M2 8.4 battle scenario through the loading screen. Poll `screen === 'game'`. */
  startBattle(seed?: number, perSide?: number): void;
  /** M2: the end screen view-model, or null while none is shown. */
  endScreen(): EndScreenVM | null;
  /** M2: live minimap alert pings (empty while the minimap is not mounted). */
  alerts(): { x: number; y: number; tick: number }[];
  /** M2: counts from the renderer's effect layer. Throws outside a match. */
  effects(): EffectStats;
  /** M2: the cursor the world canvas shows. */
  cursor(): 'default' | 'attack' | 'attackMove' | 'repair';
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
