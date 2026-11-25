/**
 * Collects commands issued by the client between ticks and stamps them with
 * the local player id and a per-player sequence number.
 */

import type { Command, CommandInput, PlayerId } from '../../sim/types';

export class CommandBuffer {
  private pending: Command[] = [];
  private nextSeq = 1;
  private readonly listeners = new Set<(input: CommandInput) => void>();

  constructor(readonly playerId: PlayerId) {}

  /** Called for every issued command (order markers). Returns an unsubscribe function. */
  onIssue(listener: (input: CommandInput) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Queue a command for the next tick. */
  issue(input: CommandInput): Command {
    for (const l of this.listeners) l(input);
    const cmd = { ...input, playerId: this.playerId, seq: this.nextSeq++ } as Command;
    this.pending.push(cmd);
    return cmd;
  }

  /** Take every pending command (called once per tick). */
  drain(): Command[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }
}
