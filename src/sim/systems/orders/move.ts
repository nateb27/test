/** `move` order and command. Owned by WP2. */

import { notImplemented, type CommandHandler } from '../common';
import type { OrderHandler } from './index';

export const moveOrderHandler: OrderHandler<'move'> = {
  begin: (_ctx, _unit, order) => ({ ...order, phase: 'start' }),
  /** STUB: finishes immediately. */
  run: () => 'done',
  end: () => {},
};

/** STUB: rejects. */
export const applyMoveCommand: CommandHandler<'move'> = (ctx, cmd) => notImplemented(ctx, cmd);
