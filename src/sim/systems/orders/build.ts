/** `build` and `assist` orders, `assist` command. Owned by WP7. */

import { notImplemented, type CommandHandler } from '../common';
import type { OrderHandler } from './index';

export const buildOrderHandler: OrderHandler<'build'> = {
  begin: (_ctx, _unit, order) => ({ ...order, phase: 'start' }),
  /** STUB: finishes immediately. */
  run: () => 'done',
  end: () => {},
};

export const assistOrderHandler: OrderHandler<'assist'> = {
  begin: (_ctx, _unit, order) => ({ ...order, phase: 'start' }),
  /** STUB: finishes immediately. */
  run: () => 'done',
  end: () => {},
};

/** STUB: rejects. */
export const applyAssistCommand: CommandHandler<'assist'> = (ctx, cmd) => notImplemented(ctx, cmd);
