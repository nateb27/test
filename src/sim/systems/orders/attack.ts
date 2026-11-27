/** `attack` order and command (PLAN-M2 3.3, 4.5, 4.6, 4.8). Owned by WP21 (Combat core). */

import { findEntity } from '../../entities';
import { isEnemy, unitCombat } from '../combat/damage';
import { canTarget, engage, leashBroken, standStill, targetFor } from '../combat/engage';
import { reject, type CommandHandler } from '../common';
import { assignOrder, validateOwnUnits, type OrderHandler } from './index';

/**
 * Attack one entity: chase it (no leash for commanded attacks; leash around `anchor` for `auto` ones) and stand in
 * phase `attacking` while it is in reach; done when it is gone (then the unit scans again next tick).
 * Stand-ground auto engagements never chase: out of reach they end.
 */
export const attackOrderHandler: OrderHandler<'attack'> = {
  begin: (ctx, unit, order) => {
    const profile = unitCombat(ctx, unit.owner, unit.typeId);
    if (targetFor(ctx, unit, profile, order.targetId) === undefined) return null;
    return {
      type: 'attack',
      targetId: order.targetId,
      auto: order.auto,
      phase: 'start',
      anchor: order.auto ? { x: unit.pos.x, y: unit.pos.y } : null,
      repathTick: ctx.state.tick,
    };
  },
  run: (ctx, unit, state) => {
    const profile = unitCombat(ctx, unit.owner, unit.typeId);
    const target = targetFor(ctx, unit, profile, state.targetId);
    if (target === undefined) {
      unit.combat.nextScanTick = ctx.state.tick + 1;
      standStill(unit);
      return 'done';
    }
    if (state.auto && state.anchor !== null && leashBroken(ctx, state.anchor, target)) {
      unit.combat.nextScanTick = ctx.state.tick + 1;
      return { replace: { type: 'move', x: state.anchor.x, y: state.anchor.y } };
    }
    const mayChase = !(state.auto && unit.stance === 'standGround');
    const result = engage(ctx, unit, profile, target, mayChase, state);
    if (result === 'outOfReach') {
      unit.combat.nextScanTick = ctx.state.tick + 1;
      return 'done';
    }
    state.phase = result;
    return 'running';
  },
  end: () => {},
};

/**
 * All-or-nothing (`validateOwnUnits`): target exists (`unknownEntity`), is an enemy unit or building with hp > 0
 * (`invalidTarget`), every unit can target it (`cannotPerform`).
 */
export const applyAttackCommand: CommandHandler<'attack'> = (ctx, cmd) => {
  const units = validateOwnUnits(ctx, cmd, cmd.unitIds);
  if (units === null || units.length === 0) return;
  const target = findEntity(ctx.state, cmd.targetId);
  if (target === undefined) {
    reject(ctx, cmd, 'unknownEntity');
    return;
  }
  if (target.kind === 'node' || target.hp <= 0 || !isEnemy(cmd.playerId, target.owner)) {
    reject(ctx, cmd, 'invalidTarget');
    return;
  }
  for (const unit of units) {
    if (!canTarget(unit, unitCombat(ctx, unit.owner, unit.typeId), target)) {
      reject(ctx, cmd, 'cannotPerform');
      return;
    }
  }
  for (const unit of units) assignOrder(ctx, unit, { type: 'attack', targetId: target.id, auto: false }, cmd.queue);
};

