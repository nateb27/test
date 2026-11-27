/**
 * A command source beside the human (PLAN-M2 2.7, 6.1). `Match.tick()` runs `commands = human.drain()`, then
 * `commands.push(...controller.update(sim))` for each controller, then `sim.step(commands)`. Contract: change only
 * through the orchestrator. Owned by WP26.
 */

import type { Command, ControllerSave, PlayerId, Sim } from '../sim';

export interface Controller {
  readonly playerId: PlayerId;
  /** Called before every sim.step; returns stamped commands (empty except on decision ticks). */
  update(sim: Sim): Command[];
  /** What to store in the save file's `controllers` block, or null for nothing (the economy bot). */
  save(): ControllerSave | null;
}
