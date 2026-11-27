/**
 * Economy layer (PLAN-M2 6.4): the economy bot's `decide` with the difficulty's plan and the army reserve.
 *
 * The reserve handed to `decide` is the army share of the stockpile plus whatever earlier layers of this decision
 * committed (plus what the military layer is saving for its next building), so the economy can neither spend the
 * army's share nor double-spend. Villagers claimed by earlier layers (builders,
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
    const held = d.reserveAvailable(r);
    reserve[r] = committed + held + Math.min(d.saving[r], Math.max(0, d.stock[r] - held));
  }
  for (const v of view.villagers) {
    if (d.claimed.has(v.id) || d.mem.defence.villagerIds.includes(v.id)) v.claimed = true;
  }
  d.ops.n += view.villagers.length * 20 + view.nodes.length * 4;
  // Boom, then age: hold the villager count while the advance is saved for.
  let plan = d.profile.plan;
  if (d.ageCost !== null) plan = { ...plan, villagerCapByAge: { ...plan.villagerCapByAge, [d.world.age]: d.world.villagers.length } };
  // Once the gold within the work radius is mined out, the economy reaches for the far deposits (the late game would
  // otherwise stall: Rams, Cataphracts, archers and the last ages all need gold).
  if (!goldNear(d, plan.workRadius)) plan = { ...plan, workRadius: FAR_WORK_RADIUS };
  const cmds = decide(view, d.query, d.data, plan, reserve);
  for (const c of cmds) {
    d.emit(c);
    account(d, c);
  }
}

/** Work radius once the near gold is gone. */
const FAR_WORK_RADIUS = 60;

/** Is any gold node left within `radius` of the Town Center? */
function goldNear(d: AiDecision, radius: number): boolean {
  const tc = d.world.tc;
  if (tc === null) return true;
  for (const n of d.view.nodes) {
    d.ops.n++;
    if (n.resource === 'gold' && (n.cx - tc.cx) * (n.cx - tc.cx) + (n.cy - tc.cy) * (n.cy - tc.cy) <= radius * radius) return true;
  }
  return false;
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

/**
 * Villagers first (hard, from the Township Age): the Town Center queue is fed before any military spending, from the
 * whole stockpile, so the economy never stalls behind the army (a human "hard" build keeps the Town Center busy).
 * In the Founding Age the economy layer's own rule (with its hold before the advance) decides.
 */
export function feedTownCenter(d: AiDecision): void {
  const from = d.profile.villagersFirstFromAge;
  if (from === null || d.world.age < from || d.ageCost !== null) return;
  const centre = d.data.start.centerBuilding;
  const cost = d.cost('villager');
  let count = d.world.villagers.length;
  const centres = d.world.buildings.filter((b) => b.typeId === centre && b.constructed);
  for (const tc of centres) count += tc.queuedUnits.filter((u) => u === 'villager').length;
  for (const tc of centres) {
    d.ops.n++;
    if (tc.queuedTechs.length > 0) continue;
    const tcView = d.view.buildings.find((b) => b.id === tc.id);
    // The first Town Center keeps one villager in production (the economy layer adds the second); extra Town Centers
    // are not the economy layer's, so they keep two.
    const depth = tc === d.world.tc ? 1 : 2;
    let queued = tc.queueLength;
    while (queued < depth && count < d.profile.villagerTarget && d.popUsed < d.popCap && d.canAfford(cost, d.freeStock())) {
      d.ops.n++;
      d.pay(cost, false);
      d.popUsed++;
      d.emit({ type: 'train', buildingId: tc.id, unitType: 'villager' });
      queued++;
      count++;
      if (tcView !== undefined) tcView.queueLength++;
    }
  }
}
