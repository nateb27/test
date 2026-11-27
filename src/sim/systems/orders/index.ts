/**
 * Tick step 4: unit order state machines, in ascending unit id. Owned by WP2.
 *
 * Each order type has an OrderHandler in its own file so WP2 (move),
 * WP6 (gather, dropOff) and WP7 (build, assist) never edit the same file.
 */

import { attackOrderHandler } from './attack';
import { attackMoveOrderHandler } from './attackMove';
import { buildOrderHandler, assistOrderHandler } from './build';
import { dropOffOrderHandler } from './dropOff';
import { gatherOrderHandler } from './gather';
import { holdOrderHandler } from './hold';
import { moveOrderHandler } from './move';
import { repairOrderHandler } from './repair';
import { findEntity } from '../../entities';
import { reject, type CommandHandler } from '../common';
import type { Command, EntityId, Order, OrderState, OrderType, SimContext, UnitEntity } from '../../types';

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

/**
 * Getters keep the table lazy: order files import helpers from this module,
 * and a lazy table makes that import cycle safe in any load order.
 */
export const orderHandlers: HandlerTable = {
  get move() {
    return moveOrderHandler;
  },
  get gather() {
    return gatherOrderHandler;
  },
  get build() {
    return buildOrderHandler;
  },
  get assist() {
    return assistOrderHandler;
  },
  get dropOff() {
    return dropOffOrderHandler;
  },
  get attack() {
    return attackOrderHandler; // orders/attack.ts (WP21)
  },
  get attackMove() {
    return attackMoveOrderHandler; // orders/attackMove.ts (WP21)
  },
  get hold() {
    return holdOrderHandler; // orders/hold.ts (WP21)
  },
  get repair() {
    return repairOrderHandler; // orders/repair.ts (WP24)
  },
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

/**
 * Resolve a command's unit ids to the issuing player's units, ascending id,
 * duplicates removed. All-or-nothing: if any id is unknown (`unknownEntity`),
 * owned by someone else (`notOwner`) or not a unit (`cannotPerform`), the
 * command is rejected with that reason (first failing id in ascending order)
 * and `null` is returned. An empty list returns `[]` without rejecting
 * (shape validation is command intake's job).
 */
export function validateOwnUnits(ctx: SimContext, cmd: Command, ids: readonly EntityId[]): UnitEntity[] | null {
  const sorted = [...ids].sort((a, b) => a - b);
  const units: UnitEntity[] = [];
  let last = -1;
  for (const id of sorted) {
    if (id === last) continue;
    last = id;
    const entity = findEntity(ctx.state, id);
    if (entity === undefined) {
      reject(ctx, cmd, 'unknownEntity');
      return null;
    }
    if (entity.owner !== cmd.playerId) {
      reject(ctx, cmd, 'notOwner');
      return null;
    }
    if (entity.kind !== 'unit') {
      reject(ctx, cmd, 'cannotPerform');
      return null;
    }
    units.push(entity);
  }
  return units;
}

/** Clears current order and queue of the issuing player's units; they idle where they stand. */
export const applyStopCommand: CommandHandler<'stop'> = (ctx, cmd) => {
  const units = validateOwnUnits(ctx, cmd, cmd.unitIds);
  if (units === null) return;
  for (const unit of units) {
    endCurrentOrder(ctx, unit);
    unit.orderQueue = [];
  }
};
