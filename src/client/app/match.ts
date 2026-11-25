/**
 * A running match: owns the sim, the fixed-tick loop, the command buffer and
 * the renderer, and drives them from requestAnimationFrame.
 */

import { hashState } from '../../sim/hash';
import type { EntityId, Sim, SimEvent } from '../../sim/types';
import { registry } from '../../data';
import type { AssetManifest } from '../art/manifest';
import { GameInput } from '../input';
import { createModeController, type ModeController } from '../input/placement';
import { installPlacementDebug, tempCanPlace } from '../input/placement/tempDev';
import { WorldOverlays } from '../render/overlays';
import type { WorldRendererApi } from '../render/renderer';
import { mountTempMinimap } from '../ui/minimap';
import { CommandBuffer } from './commandBuffer';
import { FixedTickLoop } from './loop';

/** The local human player's id in single-player matches. */
export const LOCAL_PLAYER_ID = 1;

export type SimEventListener = (events: readonly SimEvent[]) => void;

export class Match {
  readonly loop = new FixedTickLoop();
  readonly commands = new CommandBuffer(LOCAL_PLAYER_ID);
  /** Pointer/keyboard handling, selection and control groups (WP5). */
  readonly input: GameInput;
  /** Placement and rally modes (WP10). HUD callbacks: `modes.startPlacement(type)`, `modes.startRally()`. */
  readonly modes: ModeController;
  /** Selection rings, bars, rally flags, order markers, placement ghost (WP10). */
  readonly overlays: WorldOverlays;
  private readonly cleanup: (() => void)[] = [];
  private readonly listeners = new Set<SimEventListener>();
  private rafId: number | null = null;
  private lastFrameMs: number | null = null;
  private alpha = 0;

  constructor(
    readonly sim: Sim,
    readonly renderer: WorldRendererApi,
    manifest?: AssetManifest,
  ) {
    this.input = new GameInput({ sim, renderer, commands: this.commands, loop: this.loop, playerId: LOCAL_PLAYER_ID });
    this.modes = createModeController({
      input: this.input,
      sim,
      renderer,
      commands: this.commands,
      playerId: LOCAL_PLAYER_ID,
      registry,
      canPlace: tempCanPlace(sim, LOCAL_PLAYER_ID, registry), // TEMPORARY (WP10): drop once WP7's canPlace is merged
    });
    this.overlays = new WorldOverlays({
      sim,
      renderer,
      registry,
      playerId: LOCAL_PLAYER_ID,
      selection: () => this.input.selection.ids,
      dragBox: () => this.input.dragBox,
      ghost: () => this.modes.ghost(),
      ...(manifest !== undefined ? { manifest } : {}),
    });
    this.cleanup.push(this.commands.onIssue((c) => this.overlays.notifyCommand(c)));
    // TEMPORARY (WP10): minimap before the HUD's `#minimap-slot` exists, and debug entry points for placement.
    const tmp = mountTempMinimap({ getState: () => sim.state, registry, playerId: LOCAL_PLAYER_ID, renderer, input: this.input });
    this.cleanup.push(() => tmp.dispose());
    this.cleanup.push(installPlacementDebug(this.modes, (x, y) => tmp.minimap.worldToPage(x, y), () => ({ ...this.overlays.stats })));
  }

  /** Selected entity ids (client state, ascending). */
  get selection(): readonly EntityId[] {
    return this.input.selection.ids;
  }

  private renderFrame(alpha: number): void {
    this.input.update();
    this.renderer.render(this.sim.state, alpha);
    this.overlays.update();
  }

  /** Subscribe to the events of every tick. Returns an unsubscribe function. */
  onEvents(listener: SimEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Run one tick with the buffered commands. */
  tick(): void {
    const events = this.sim.step(this.commands.drain());
    if (events.length > 0) for (const l of this.listeners) l(events);
  }

  /** Run n ticks immediately (debug / tests). */
  stepTicks(n: number): void {
    for (let i = 0; i < n; i++) this.tick();
    this.renderFrame(this.alpha);
  }

  hash(): string {
    return hashState(this.sim.state);
  }

  start(): void {
    if (this.rafId !== null) return;
    const frame = (nowMs: number): void => {
      const dt = this.lastFrameMs === null ? 0 : nowMs - this.lastFrameMs;
      this.lastFrameMs = nowMs;
      const { ticks, alpha } = this.loop.advance(dt);
      for (let i = 0; i < ticks; i++) this.tick();
      this.alpha = alpha;
      this.renderFrame(alpha);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.lastFrameMs = null;
  }

  destroy(): void {
    this.stop();
    this.listeners.clear();
    for (const c of this.cleanup) c();
    this.cleanup.length = 0;
    this.overlays.destroy();
    this.input.destroy();
    this.renderer.destroy();
  }
}
