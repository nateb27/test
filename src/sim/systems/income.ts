/** Tick step 3: passive income (plan 4.8). Owned by WP8. */

import { resolvedStat } from '../rules/stats';
import { TICK_RATE, type SimContext } from '../types';

/**
 * The accumulator is snapped to a 1e-9 grid after every add. Rates such as
 * 0.25/20 = 0.0125 are not exact in binary, so without snapping 80 additions
 * can land a hair under 1 and the credit would drift a tick late.
 */
const GRID = 1e9;

/**
 * For every completed building with `income`, add `incomeRate / TICK_RATE`
 * to `incomeAccumulator` and move whole units to the owner.
 */
export function runIncome(ctx: SimContext): void {
  for (const e of ctx.state.entities) {
    if (e.kind !== 'building' || !e.constructed) continue;
    const def = ctx.data.building(e.typeId);
    if (def.income === undefined) continue;
    const player = ctx.state.players[e.owner];
    if (player === undefined) continue;
    const perTick = resolvedStat(ctx, e.owner, e.typeId, 'incomeRate') / TICK_RATE;
    let acc = Math.round((e.incomeAccumulator + perTick) * GRID) / GRID;
    const whole = Math.floor(acc);
    if (whole > 0) {
      player.resources[def.income.resource] += whole;
      acc = Math.round((acc - whole) * GRID) / GRID;
    }
    e.incomeAccumulator = acc;
  }
}
