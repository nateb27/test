/**
 * A running match: owns the sim, the fixed-tick loop, the command buffer and
 * the renderer, and drives them from requestAnimationFrame.
 */

import { hashState } from '../../sim/hash';
import type { EntityId, Sim, SimEvent } from '../../sim/types';
import { registry } from '../../data';
import type { AssetManifest } from '../art/manifest';
import { GameInput } from '../input';
import { createModeController, type ActiveMode, type ModeController } from '../input/placement';
import type { FrameProfiler } from '../debug/profiler';
import { WorldOverlays } from '../render/overlays';
import type { WorldRendererApi } from '../render/renderer';
import type { Minimap } from '../ui/minimap';
import { perf } from '../debug/perf';
import { CommandBuffer } from './commandBuffer';
import { FixedTickLoop } from './loop';

/** The local human player's id in single-player matches. */
export const LOCAL_PLAYER_ID = 1;

export type SimEventListener = (events: readonly SimEvent[]) => void;
export type ModeListener = (mode: ActiveMode | null) => void;

export class Match {
  readonly loop = new FixedTickLoop();
  readonly commands = new CommandBuffer(LOCAL_PLAYER_ID);
  /** Pointer/keyboard handling, selection and control groups (WP5). */
  readonly input: GameInput;
  /** Placement and rally modes (WP10). HUD callbacks: `modes.startPlacement(type)`, `modes.startRally()`. */
  readonly modes: ModeController;
  /** Selection rings, bars, rally flags, order markers, placement ghost (WP10). */
  readonly overlays: WorldOverlays;
  /** Debug overlay hooks (F3, dev and e2e builds): both stay null, and cost nothing, while the overlay is closed. */
  profiler: FrameProfiler | null = null;
  debugFrame: (() => void) | null = null;
  /** The mounted minimap, set by the game screen once the HUD slot exists (null before). */
  minimap: Minimap | null = null;
  /** Receives the text of a refused placement or rally click; the game screen points it at the HUD toasts. */
  onInvalid: (text: string) => void = () => {};
  /** Dev/e2e only: called before each tick with `state.tick` (the stress match's scripted player issues commands here). */
  beforeTick: ((tick: number) => void) | null = null;
  private readonly cleanup: (() => void)[] = [];
  private readonly listeners = new Set<SimEventListener>();
  private readonly modeListeners = new Set<ModeListener>();
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
      onInvalid: (text) => this.onInvalid(text),
      onChange: (mode) => {
        for (const l of this.modeListeners) l(mode);
      },
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
  }

  /** Be told when placement or rally mode starts or ends (`null` = no mode). */
  onModeChange(listener: ModeListener): () => void {
    this.modeListeners.add(listener);
    return () => this.modeListeners.delete(listener);
  }

  /** Selected entity ids (client state, ascending). */
  get selection(): readonly EntityId[] {
    return this.input.selection.ids;
  }

  private renderFrame(alpha: number): void {
    const t0 = perf.start();
    this.input.update();
    const t1 = perf.start();
    perf.end('frame.input', t0);
    this.renderer.render(this.sim.state, alpha);
    const t2 = perf.start();
    perf.end('frame.render', t1);
    this.overlays.update();
    perf.end('frame.overlays', t2);
    this.debugFrame?.();
    perf.end('frame.js', t0);
  }

  /** Subscribe to the events of every tick. Returns an unsubscribe function. */
  onEvents(listener: SimEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Run one tick with the buffered commands. */
  tick(): void {
    const profiler = this.profiler;
    const wall0 = profiler === null ? 0 : performance.now();
    const t0 = perf.start();
    this.beforeTick?.(this.sim.state.tick);
    const events = this.sim.step(this.commands.drain());
    perf.end('sim.step', t0);
    if (profiler !== null) profiler.recordTick(performance.now() - wall0);
    if (events.length > 0) {
      const t1 = perf.start();
      for (const l of this.listeners) l(events);
      perf.end('sim.listeners', t1);
    }
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
      this.profiler?.recordFrame(dt);
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
    this.modeListeners.clear();
    for (const c of this.cleanup) c();
    this.cleanup.length = 0;
    this.overlays.destroy();
    this.input.destroy();
    this.renderer.destroy();
  }
}
