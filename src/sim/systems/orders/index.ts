/**
 * Tick step 4: unit order state machines, in ascending unit id. Owned by WP2.
 *
 * Each order type has an OrderHandler in its own file so WP2 (move),
 * WP6 (gather, dropOff) and WP7 (build, assist) never edit the same file.
 */

import { buildOrderHandler, assistOrderHandler } from './build';
import { dropOffOrderHandler } from './dropOff';
import { gatherOrderHandler } from './gather';
import { moveOrderHandler } from './move';
import { findEntity } from '../../entities';
import type { CommandHandler } from '../common';
import type { Order, OrderState, OrderType, SimContext, UnitEntity } from '../../types';

export type OrderOf<T extends OrderType> = Extract<Order, { type: T }>;
export type OrderStateOf<T extends OrderType> = Extract<OrderState, { type: T }>;

/**
 * Result of running an order for one tick:
 * - `running`: keep it as the current order.
 * - `done`: call `end`, then begin the next queued order (or idle).
 * - `{ replace }`: call `end`, then begin `replace` in its place, ahead of the
 *   queue (e.g. a finished farm build turning into gathering that farm).
 */
export type OrderStep = 'running' | 'done' | { replace: Order };

export interface OrderHandler<T extends OrderType> {
  /**
   * Turn a queued order into a running state (phase 'start'), or return
   * `null` if it is no longer valid (target gone etc.), in which case the
   * dispatcher skips to the next order.
   */
  begin(ctx: SimContext, unit: UnitEntity, order: OrderOf<T>): OrderStateOf<T> | null;
  /** Advance the state machine by one tick. */
  run(ctx: SimContext, unit: UnitEntity, state: OrderStateOf<T>): OrderStep;
  /**
   * Release anything the order holds (gatherer/builder slots). Called when
   * the order finishes or is interrupted (stop, replacing command, deletion).
   */
  end(ctx: SimContext, unit: UnitEntity, state: OrderStateOf<T>): void;
}

type HandlerTable = { [T in OrderType]: OrderHandler<T> };

export const orderHandlers: HandlerTable = {
  move: moveOrderHandler,
  gather: gatherOrderHandler,
  build: buildOrderHandler,
  assist: assistOrderHandler,
  dropOff: dropOffOrderHandler,
};

function handlerFor(type: OrderType): OrderHandler<OrderType> {
  return orderHandlers[type] as unknown as OrderHandler<OrderType>;
}

/** End the current order (if any) and clear it. Does not touch the queue. */
export function endCurrentOrder(ctx: SimContext, unit: UnitEntity): void {
  const current = unit.currentOrder;
  if (current === null) return;
  handlerFor(current.type).end(ctx, unit, current);
  unit.currentOrder = null;
  unit.path = null;
  unit.pendingPathRequestId = null;
}

/**
 * Give a unit an order. `queue: false` ends the current order and clears the
 * queue first. The order begins in the next orders step (tick step 4).
 */
export function assignOrder(ctx: SimContext, unit: UnitEntity, order: Order, queue: boolean): void {
  if (!queue) {
    endCurrentOrder(ctx, unit);
    unit.orderQueue = [];
  }
  unit.orderQueue.push(order);
}

/** Begin queued orders until one is valid or the queue is empty. */
function beginNext(ctx: SimContext, unit: UnitEntity, front: Order | null): void {
  let next: Order | undefined = front ?? unit.orderQueue.shift();
  while (next !== undefined) {
    const state = handlerFor(next.type).begin(ctx, unit, next as OrderOf<OrderType>);
    if (state !== null) {
      unit.currentOrder = state;
      return;
    }
    next = unit.orderQueue.shift();
  }
  unit.currentOrder = null;
}

/** Run one tick of every unit's order state machine, ascending id. */
export function runOrders(ctx: SimContext): void {
  for (const entity of ctx.state.entities) {
    if (entity.kind !== 'unit') continue;
    if (entity.currentOrder === null) {
      if (entity.orderQueue.length === 0) continue;
      beginNext(ctx, entity, null);
      if (entity.currentOrder === null) continue;
    }
    const current: OrderState = entity.currentOrder;
    const step = handlerFor(current.type).run(ctx, entity, current);
    if (step === 'running') continue;
    endCurrentOrder(ctx, entity);
    beginNext(ctx, entity, step === 'done' ? null : step.replace);
  }
}

export const applyStopCommand: CommandHandler<'stop'> = (ctx, cmd) => {
  // TODO(WP2): validate ownership; reject unknown/foreign units.
  for (const id of cmd.unitIds) {
    const unit = findEntity(ctx.state, id);
    if (unit === undefined || unit.kind !== 'unit' || unit.owner !== cmd.playerId) continue;
    endCurrentOrder(ctx, unit);
    unit.orderQueue = [];
  }
};
