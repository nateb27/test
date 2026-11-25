/**
 * A running match: owns the sim, the fixed-tick loop, the command buffer and
 * the renderer, and drives them from requestAnimationFrame.
 */

import { hashState } from '../../sim/hash';
import type { EntityId, Sim, SimEvent } from '../../sim/types';
import type { WorldRenderer } from '../render/renderer';
import { CommandBuffer } from './commandBuffer';
import { FixedTickLoop } from './loop';

/** The local human player's id in single-player matches. */
export const LOCAL_PLAYER_ID = 1;

export type SimEventListener = (events: readonly SimEvent[]) => void;

export class Match {
  readonly loop = new FixedTickLoop();
  readonly commands = new CommandBuffer(LOCAL_PLAYER_ID);
  /** Selected entity ids (client state; WP5 owns selection logic). */
  selection: EntityId[] = [];
  private readonly listeners = new Set<SimEventListener>();
  private rafId: number | null = null;
  private lastFrameMs: number | null = null;
  private alpha = 0;

  constructor(
    readonly sim: Sim,
    readonly renderer: WorldRenderer,
  ) {}

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
    this.renderer.render(this.sim.state, this.alpha);
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
      this.renderer.render(this.sim.state, alpha);
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
    this.renderer.destroy();
  }
}
