/**
 * Economy layer (PLAN-M2 6.4): the economy bot's `decide` with the difficulty's plan and the army reserve.
 *
 * The reserve handed to `decide` is the army share of the stockpile plus whatever earlier layers of this decision
 * committed, so the economy can neither spend the army's share nor double-spend. Villagers claimed by earlier layers (builders,
 * repairers, evacuated or fighting villagers) are marked claimed so the economy leaves them alone.
 */

import { RESOURCE_TYPES, type CommandInput, type ResourceAmounts } from '../../sim';
import { decide } from '../economyBot';
import type { AiDecision } from './context';

/** The economy runs at most once per game second (staggered with the decision cadence). */
export function economyDue(d: AiDecision): boolean {
  const every = Math.max(1, Math.ceil(20 / d.profile.decisionInterval));
  return d.mem.decisions % every === 0;
}

export function runEconomy(d: AiDecision): void {
  const view = d.view;
  const reserve: ResourceAmounts = { food: 0, wood: 0, gold: 0, stone: 0 };
  for (const r of RESOURCE_TYPES) {
    const committed = view.resources[r] - d.stock[r];
    reserve[r] = committed + d.reserveAvailable(r);
  }
  for (const v of view.villagers) {
    if (d.claimed.has(v.id) || d.mem.defence.villagerIds.includes(v.id)) v.claimed = true;
  }
  d.ops.n += view.villagers.length * 20 + view.nodes.length * 4;
  const cmds = decide(view, d.query, d.data, d.profile.plan, reserve);
  for (const c of cmds) {
    d.emit(c);
    account(d, c);
  }
}

/** Charge what an economy command costs to the decision's stockpile. */
function account(d: AiDecision, c: CommandInput): void {
  let id: string | null = null;
  if (c.type === 'build') id = c.buildingType;
  else if (c.type === 'train') id = c.unitType;
  else if (c.type === 'research') id = c.techId;
  if (c.type === 'train') d.popUsed += d.data.unit(c.unitType).popCost;
  if (id === null) return;
  d.pay(d.cost(id), false);
}
