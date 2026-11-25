/**
 * Shared helpers and handler types for systems. Owned by WP1.
 */

import type {
  Command,
  CommandRejectedEvent,
  CommandType,
  RejectReason,
  SimContext,
  SimEvent,
} from '../types';

/** The command variant with the given `type`. */
export type CommandOf<T extends CommandType> = Extract<Command, { type: T }>;

/**
 * Applies one validated-for-shape command of type T. Handlers do their own
 * rule validation and call `reject` on failure (and then change nothing).
 */
export type CommandHandler<T extends CommandType> = (ctx: SimContext, cmd: CommandOf<T>) => void;

/** Emit an event for this tick. */
export function emit(ctx: SimContext, event: SimEvent): void {
  ctx.events.push(event);
}

/** Emit a CommandRejected event for `cmd`. */
export function reject(
  ctx: SimContext,
  cmd: Command,
  reason: RejectReason,
  details: Pick<CommandRejectedEvent, 'unavailable' | 'shortfall' | 'placement'> = {},
): void {
  emit(ctx, {
    type: 'CommandRejected',
    playerId: cmd.playerId,
    seq: cmd.seq,
    commandType: cmd.type,
    reason,
    ...details,
  });
}

/** Placeholder handler used until a work package implements the command. */
export function notImplemented(ctx: SimContext, cmd: Command): void {
  reject(ctx, cmd, 'invalidCommand');
}
