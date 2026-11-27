/**
 * Repair and rebuild (PLAN-M2 6.6).
 *
 * - `desiredBuildings` remembers the most completed buildings of each type the AI ever had.
 * - A lost Town Center is rebuilt first, ahead of everything, once the AI has a villager and the stone (and wood).
 * - Other missing buildings are re-placed through the base site search, per the difficulty's rebuild policy.
 *   Farms, camps and Mills are left to the economy layer, which places them on demand next to the resource.
 * - Repair (standard, hard): a completed building below 70% hp with no enemy within 8 tiles gets 2 repairers
 *   (Town Center: 4), one building per decision.
 * - Foundations of the AI's own buildings that lost every builder get two again.
 */

import type { BuildingId, EntityId } from '../../sim';
import type { AiDecision } from './context';
import { REPAIR_BELOW, REPAIR_SAFE_RADIUS } from './difficulty';
import { MILITARY_PRODUCERS } from './military';
import { distSqTo, type BuildingInfo } from './world';

/** Left to the economy layer (placed next to resources on demand). */
const ECONOMY_PLACED: readonly string[] = ['farm', 'mill', 'lumberCamp', 'miningCamp'];

/** Record completed buildings into `desiredBuildings` (sorted by type). */
export function noteBuildings(d: AiDecision): void {
  const counts: Record<string, number> = {};
  for (const b of d.world.buildings) {
    d.ops.n++;
    if (b.constructed) counts[b.typeId] = (counts[b.typeId] ?? 0) + 1;
  }
  const desired = d.mem.desiredBuildings;
  for (const type of Object.keys(counts).sort()) {
    const n = counts[type]!;
    const entry = desired.find((e) => e.type === type);
    if (entry === undefined) desired.push({ type, count: n });
    else if (n > entry.count) entry.count = n;
  }
  desired.sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
}

/** Top priority: no Town Center at all (not even a foundation) -> place one near home. Returns true if it acted. */
export function rebuildCenter(d: AiDecision): boolean {
  const centre = d.data.start.centerBuilding;
  if (d.world.buildings.some((b) => b.typeId === centre)) return false;
  if (d.view.villagers.length === 0 || d.stock.stone < 100) return false;
  if (!d.available(centre) || !d.canAfford(d.cost(centre))) return false;
  const home = d.home();
  const spot = d.baseSpot(centre, 0, home, 16);
  if (spot === null) return false;
  const size = d.data.building(centre).footprint;
  const builders = d.pickBuilders(spot.tx + size / 2, spot.ty + size / 2, 6);
  return d.construct(centre, spot, builders, false);
}

function rebuildable(d: AiDecision, type: string): boolean {
  const policy = d.profile.rebuild;
  if (policy === 'housesAndCenter') return type === 'house' || type === d.data.start.centerBuilding;
  if (ECONOMY_PLACED.includes(type)) return false;
  if (policy === 'desired') return type !== 'house';
  return true;
}

/** Re-place one missing building per decision. */
export function rebuild(d: AiDecision): void {
  if (d.world.tc === null || !d.world.tc.constructed) return;
  for (const e of d.mem.desiredBuildings) {
    d.ops.n++;
    if (!rebuildable(d, e.type) || e.type === d.data.start.centerBuilding) continue;
    if (d.countOf(e.type) >= e.count) continue;
    const type = e.type as BuildingId;
    if (!d.available(type) || !d.canAfford(d.cost(type))) continue;
    const spot = d.baseSpot(type, type === 'house' ? 7 : 8);
    if (spot === null) continue;
    const size = d.data.building(type).footprint;
    const builders = d.pickBuilders(spot.tx + size / 2, spot.ty + size / 2, type === 'house' ? 2 : 3);
    if (d.construct(type, spot, builders, false)) return;
  }
}

/** Repair one damaged, safe building per decision (standard and hard; only with combat orders). */
export function repair(d: AiDecision): void {
  if (!d.profile.repair || !d.combatOrders) return;
  const onIt: Record<number, number> = {};
  for (const v of d.world.villagers) {
    const o = v.order;
    if (o !== null && o.type === 'repair') onIt[o.buildingId] = (onIt[o.buildingId] ?? 0) + 1;
  }
  const candidates = d.world.buildings
    .filter((b) => b.constructed && b.hp < REPAIR_BELOW * b.maxHp)
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.id - b.id);
  for (const b of candidates) {
    d.ops.n++;
    if (enemyNear(d, b)) continue;
    const want = b.typeId === d.data.start.centerBuilding ? 4 : 2;
    const have = Math.max(b.repairers, onIt[b.id] ?? 0);
    if (have >= want) continue;
    const pick = d.pickBuilders(b.cx, b.cy, want - have);
    if (pick.length === 0) return;
    d.emit({ type: 'repair', unitIds: pick.map((v) => v.id).sort((x, y) => x - y), buildingId: b.id, queue: false });
    for (const v of pick) d.claim(v);
    return;
  }
}

function enemyNear(d: AiDecision, b: BuildingInfo): boolean {
  for (const e of d.world.enemyUnits) {
    d.ops.n++;
    if (distSqTo(e.x, e.y, b) <= REPAIR_SAFE_RADIUS * REPAIR_SAFE_RADIUS) return true;
  }
  return false;
}

/** Foundations (other than farms) nobody is building or walking to get two builders (an abandoned camp would otherwise be re-placed by the economy, wasting its cost). */
export function staffFoundations(d: AiDecision): void {
  if (d.mem.defence.active) return;
  const coming: Record<number, number> = {};
  for (const v of d.view.villagers) {
    if (v.task.kind === 'build') coming[v.task.buildingId] = (coming[v.task.buildingId] ?? 0) + 1;
  }
  for (const b of d.world.buildings) {
    d.ops.n++;
    if (b.constructed || b.typeId === 'farm') continue;
    if (b.builders > 0 || (coming[b.id] ?? 0) > 0) continue;
    const pick = d.pickBuilders(b.cx, b.cy, b.typeId === d.data.start.centerBuilding ? 4 : 2);
    if (pick.length === 0) return;
    const ids: EntityId[] = pick.map((v) => v.id).sort((x, y) => x - y);
    d.emit({ type: 'assist', unitIds: ids, buildingId: b.id, queue: false });
    for (const v of pick) d.claim(v);
    return;
  }
}

/**
 * Houses ahead of the population cap, paid from the whole stockpile (the army needs room too). The margin grows with
 * the number of military producers, which add population much faster than the Town Center alone. The economy layer's
 * own House rule then sees the site and does not build a second one.
 */
export function houses(d: AiDecision): void {
  const tc = d.world.tc;
  if (tc === null || !tc.constructed) return;
  let producers = 0;
  let inFlight = 0;
  for (const b of d.view.buildings) {
    d.ops.n++;
    if (MILITARY_PRODUCERS.includes(b.typeId) && b.constructed) producers++;
    if (b.typeId === 'house' && !b.constructed) inFlight++;
  }
  if (producers === 0) return;
  const margin = d.profile.plan.houseMargin + 2 * producers;
  const futureCap = Math.min(200, d.popCap + inFlight * 10);
  if (futureCap >= 200 || futureCap - d.popUsed >= margin || inFlight >= 2) return;
  if (!d.available('house') || !d.canAfford(d.cost('house'))) return;
  const spot = d.baseSpot('house', 7);
  if (spot === null) return;
  d.construct('house', spot, d.pickBuilders(spot.tx + 1, spot.ty + 1, 2), false);
}
