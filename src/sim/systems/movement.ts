/** Tick step 6: movement integration and idle separation (plan 4.3). Owned by WP2. */

import type { SimContext } from '../types';

/**
 * First set `prevPos = pos` for EVERY unit (so the renderer can interpolate),
 * then move units along their paths at their resolved speed / TICK_RATE,
 * update facing, then push apart idle units closer than SEPARATION_RADIUS.
 * STUB: only copies prevPos.
 */
export function runMovement(ctx: SimContext): void {
  for (const entity of ctx.state.entities) {
    if (entity.kind !== 'unit') continue;
    entity.prevPos.x = entity.pos.x;
    entity.prevPos.y = entity.pos.y;
  }
}
