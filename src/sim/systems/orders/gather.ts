/** `gather` order and command. Owned by WP6. */

import { notImplemented, type CommandHandler } from '../common';
import type { OrderHandler } from './index';

export const gatherOrderHandler: OrderHandler<'gather'> = {
  /** STUB: never starts (needs the target's resource and anchor). */
  begin: () => null,
  /** STUB: finishes immediately. */
  run: () => 'done',
  end: () => {},
};

/** STUB: rejects. */
export const applyGatherCommand: CommandHandler<'gather'> = (ctx, cmd) => notImplemented(ctx, cmd);
