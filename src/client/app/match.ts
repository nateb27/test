/**
 * A running match: owns the sim, the fixed-tick loop, the command buffer and
 * the renderer, and drives them from requestAnimationFrame.
 */

import type { Controller } from '../../bot';
import { hashState } from '../../sim/hash';
import type { ControllerSave } from '../../sim';
import { type EntityId, type Sim, type SimEvent } from '../../sim/types';
import { registry } from '../../data';
import type { AssetManifest } from '../art/manifest';
import { GameInput } from '../input';
import { createModeController, type ActiveMode, type ModeController } from '../input/placement';
import type { FrameProfiler } from '../debug/profiler';
import type { FpsMeter } from './fpsMeter';
import { WorldOverlays } from '../render/overlays';
import type { WorldRendererApi } from '../render/renderer';
import type { Minimap } from '../ui/minimap';
import { registerControllerSaves } from '../ui/saveLoad';
import type { EndScreenVM } from '../ui/viewModel';
import { perf } from '../debug/perf';
import { ClientClock } from './clock';
import { CommandBuffer } from './commandBuffer';
import { EndWatcher } from './endScreen';
import { FixedTickLoop } from './loop';

/** The local human player's id in single-player matches. */
export const LOCAL_PLAYER_ID = 1;

export type SimEventListener = (events: readonly SimEvent[]) => void;
export type ModeListener = (mode: ActiveMode | null) => void;
export type EndScreenListener = (vm: EndScreenVM | null) => void;

export class Match {
  readonly loop = new FixedTickLoop();
  /** Clock for time-windowed UI rules; tests freeze it (`__game.freezeClock`). */
  readonly clock = new ClientClock();
  readonly commands = new CommandBuffer(LOCAL_PLAYER_ID);
  /** Pointer/keyboard handling, selection and control groups (WP5). */
  readonly input: GameInput;
  /** Placement and rally modes (WP10). HUD callbacks: `modes.startPlacement(type)`, `modes.startRally()`. */
  readonly modes: ModeController;
  /** Selection rings, bars, rally flags, order markers, placement ghost (WP10). */
  readonly overlays: WorldOverlays;
  /** Debug overlay hooks (F3, dev and e2e builds): both stay null, and cost nothing, while the overlay is closed. */
  profiler: FrameProfiler | null = null;
  /** The player's frame-rate readout (F3, `?fps=1`), fed while it is visible (fpsMeter.ts). */
  fpsMeter: FpsMeter | null = null;
  debugFrame: (() => void) | null = null;
  /** The mounted minimap, set by the game screen once the HUD slot exists (null before). */
  minimap: Minimap | null = null;
  /** Receives the text of a refused placement or rally click; the game screen points it at the HUD toasts. */
  onInvalid: (text: string) => void = () => {};
  /** Dev/e2e only: called after `stepTicks` and after the clock is advanced, so the HUD can rebuild at once instead of on its next timer. */
  afterStep: (() => void) | null = null;
  /** Dev/e2e only: called before each tick with `state.tick` (the stress match's scripted player issues commands here). */
  beforeTick: ((tick: number) => void) | null = null;
  /**
   * AI controllers (PLAN-M2 2.7), ascending player id. Their commands join the human's before every `sim.step`, so
   * the sim cannot tell them apart; they never run while `aiEnabled` is false or their player is defeated.
   */
  readonly controllers: readonly Controller[];
  aiEnabled = true;
  /** The end screen being shown (victory, defeat or draw), or null. Set when the match ends; cleared by `closeEndScreen`. */
  endScreen: EndScreenVM | null = null;
  private readonly endWatcher = new EndWatcher(LOCAL_PLAYER_ID);
  private readonly endListeners = new Set<EndScreenListener>();
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
    controllers: readonly Controller[] = [],
  ) {
    this.controllers = controllers;
    this.cleanup.push(registerControllerSaves(sim, () => this.saveControllers()));
    this.input = new GameInput({ sim, renderer, commands: this.commands, loop: this.loop, playerId: LOCAL_PLAYER_ID, now: this.clock.now });
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
      now: this.clock.now,
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

  /** What the save file's `controllers` block holds: every controller that has something to save. */
  saveControllers(): ControllerSave[] {
    const out: ControllerSave[] = [];
    for (const c of this.controllers) {
      const save = c.save();
      if (save !== null) out.push(save);
    }
    return out;
  }

  /** Be told when the end screen opens (with its view-model) or closes (null). */
  onEndScreen(listener: EndScreenListener): () => void {
    this.endListeners.add(listener);
    return () => this.endListeners.delete(listener);
  }

  /** "View map": close the end screen and resume play. The match goes on (the winner keeps playing, the loser watches). */
  closeEndScreen(): void {
    if (this.endScreen === null) return;
    this.endScreen = null;
    this.input.suspended = false;
    this.loop.paused = false;
    for (const l of this.endListeners) l(null);
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
    const meter = this.fpsMeter !== null && this.fpsMeter.visible ? this.fpsMeter.profiler : null;
    const wall0 = profiler === null && meter === null ? 0 : performance.now();
    const t0 = perf.start();
    this.beforeTick?.(this.sim.state.tick);
    const commands = this.commands.drain();
    if (this.aiEnabled) {
      const players = this.sim.state.players;
      for (const c of this.controllers) {
        if (players[c.playerId]?.outcome === 'defeated') continue;
        for (const cmd of c.update(this.sim)) commands.push(cmd);
      }
    }
    const events = this.sim.step(commands);
    perf.end('sim.step', t0);
    if (profiler !== null || meter !== null) {
      const ms = performance.now() - wall0;
      profiler?.recordTick(ms);
      meter?.recordTick(ms);
    }
    if (events.length > 0) {
      const t1 = perf.start();
      this.renderer.pushEvents(events); // decals and effects (WP27)
      this.noteEvents(events);
      for (const l of this.listeners) l(events);
      perf.end('sim.listeners', t1);
    }
  }

  /**
   * The end screen when the match is decided (the one mechanism: `HudViewModel.endScreen` stays null). Alerts are not
   * kept here: the HUD's notification centre handles every own `UnderAttack` once (toast, minimap ping, `Space`).
   */
  private noteEvents(events: readonly SimEvent[]): void {
    const vm = this.endWatcher.observe(events, this.sim.state);
    if (vm !== null) {
      this.endScreen = vm;
      this.loop.paused = true;
      this.input.suspended = true; // no hotkey (Space, Esc, Pause) acts on the game behind the end screen
      for (const l of this.endListeners) l(vm);
    }
  }

  /** Run n ticks immediately (debug / tests). `present: false` skips the redraw and the HUD rebuild (a long run of steps). */
  stepTicks(n: number, present = true): void {
    for (let i = 0; i < n; i++) this.tick();
    if (!present) return;
    this.afterStep?.();
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
      if (this.fpsMeter !== null && this.fpsMeter.visible) {
        this.fpsMeter.profiler.recordFrame(dt);
        this.fpsMeter.frame(nowMs);
      }
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
    this.endListeners.clear();
    for (const c of this.cleanup) c();
    this.cleanup.length = 0;
    this.modes.destroy();
    this.overlays.destroy();
    this.input.destroy();
    this.renderer.destroy();
  }
}
