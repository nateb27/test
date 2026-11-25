/**
 * Glue for the F3 debug overlay (plan 9.6): attaches a profiler and the debug
 * drawing layer to a running match, and issues the cheats through the normal
 * deterministic `cheat` command. Created only in dev and e2e builds.
 */

import type { DataRegistry } from '../../data/schema';
import { hashState } from '../../sim/hash';
import { RESOURCE_TYPES, type CommandInput, type PlayerId, type ReadonlyGameState, type ResourceType } from '../../sim/types';
import type { Match } from '../app/match';
import { DebugLayer, type DebugToggles } from './debugLayer';
import { countEntities, FrameProfiler, type EntityCounts, type ProfileSnapshot } from './profiler';

export interface DebugSnapshot {
  profile: ProfileSnapshot;
  counts: EntityCounts;
  tick: number;
  paused: boolean;
  cheats: { instantBuild: boolean; instantResearch: boolean };
  cursorTile: { tx: number; ty: number } | null;
}

/** Amount added by the "add resources" buttons. */
export const CHEAT_RESOURCE_AMOUNT = 1000;

/** The slice of `Match` the controller needs (so tests can pass a fake). */
export type DebugMatch = Pick<Match, 'sim' | 'renderer' | 'commands' | 'loop' | 'profiler' | 'debugFrame'> & {
  readonly input: { readonly selection: { readonly ids: readonly number[] } };
};

export class DebugController {
  readonly profiler = new FrameProfiler();
  readonly layer: DebugLayer;
  private attached = false;
  private armedUnit: string | null = null;
  private readonly onSpawnClick: (e: MouseEvent) => void;

  constructor(
    private readonly match: DebugMatch,
    parent: HTMLElement,
    private readonly registry: DataRegistry,
    private readonly playerId: PlayerId,
  ) {
    this.layer = new DebugLayer({
      parent,
      renderer: match.renderer,
      registry,
      getState: () => match.sim.state,
      selection: () => match.input.selection.ids,
    });
    // Capture phase on the canvas: an armed spawn click is consumed before selection sees it.
    this.onSpawnClick = (e: MouseEvent): void => {
      if (this.armedUnit === null || e.button !== 0) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      const r = match.renderer.canvas.getBoundingClientRect();
      const w = match.renderer.canvasToWorld(e.clientX - r.left, e.clientY - r.top);
      this.spawnUnit(this.armedUnit, w.x, w.y);
    };
    match.renderer.canvas.addEventListener('mousedown', this.onSpawnClick, true);
  }

  /** Start profiling and drawing (overlay opened). */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.profiler.reset();
    this.match.profiler = this.profiler;
    this.match.debugFrame = () => this.layer.update();
  }

  /** Stop profiling and drawing (overlay closed): the match is back to zero overhead. */
  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.match.profiler = null;
    this.match.debugFrame = null;
    this.armedUnit = null;
    this.layer.canvas.style.display = 'none';
  }

  get isAttached(): boolean {
    return this.attached;
  }

  destroy(): void {
    this.detach();
    this.match.renderer.canvas.removeEventListener('mousedown', this.onSpawnClick, true);
    this.layer.destroy();
  }

  setToggle(name: keyof DebugToggles, on: boolean): void {
    this.layer.toggles[name] = on;
  }

  snapshot(): DebugSnapshot {
    const state: ReadonlyGameState = this.match.sim.state;
    const player = state.players[this.playerId];
    return {
      profile: this.profiler.snapshot(),
      counts: countEntities(state),
      tick: state.tick,
      paused: this.match.loop.paused,
      cheats: { instantBuild: player?.cheats.instantBuild ?? false, instantResearch: player?.cheats.instantResearch ?? false },
      cursorTile: this.layer.cursorTile,
    };
  }

  /** FNV hash of the whole state (the same value the save/load and determinism checks use). */
  stateHash(): string {
    return hashState(this.match.sim.state);
  }

  // ------------------------------------------------------------- cheats

  private issue(input: CommandInput): void {
    this.match.commands.issue(input);
  }

  addResources(amount: number, which: readonly ResourceType[] = RESOURCE_TYPES): void {
    const amounts: Partial<Record<ResourceType, number>> = {};
    for (const r of which) amounts[r] = amount;
    this.issue({ type: 'cheat', cheat: { kind: 'addResources', amounts } });
  }

  setInstantBuild(enabled: boolean): void {
    this.issue({ type: 'cheat', cheat: { kind: 'instantBuild', enabled } });
  }

  setInstantResearch(enabled: boolean): void {
    this.issue({ type: 'cheat', cheat: { kind: 'instantResearch', enabled } });
  }

  spawnUnit(unitType: string, x: number, y: number): void {
    this.issue({ type: 'cheat', cheat: { kind: 'spawnUnit', unitType, x, y } });
  }

  /** Spawn at the last known cursor position (the world point the mouse was over). */
  spawnAtCursor(unitType: string): boolean {
    const w = this.layer.cursorWorld;
    if (w === null) return false;
    this.spawnUnit(unitType, w.x, w.y);
    return true;
  }

  /** While armed, a left click on the map spawns `unitType` at the click instead of selecting. `null` disarms. */
  armSpawn(unitType: string | null): void {
    this.armedUnit = unitType;
  }

  get armed(): string | null {
    return this.armedUnit;
  }

  get unitTypes(): readonly string[] {
    return this.registry.units.map((u) => u.id);
  }
}
