/** `dropOff` order and command. Owned by WP6. */

import { notImplemented, type CommandHandler } from '../common';
import type { OrderHandler } from './index';

export const dropOffOrderHandler: OrderHandler<'dropOff'> = {
  begin: (_ctx, _unit, order) => ({ ...order, phase: 'start' }),
  /** STUB: finishes immediately. */
  run: () => 'done',
  end: () => {},
};

/** STUB: rejects. */
export const applyDropOffCommand: CommandHandler<'dropOff'> = (ctx, cmd) => notImplemented(ctx, cmd);
