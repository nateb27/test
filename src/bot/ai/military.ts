/**
 * Military layer (PLAN-M2 6.3, 6.4): production buildings on the difficulty's schedule, unit choice by
 * `score - currentShare`, siege by rule, upgrades, rally points.
 */

import type { BuildingId, UnitId } from '../../sim';
import type { AiDecision } from './context';
import { COUNTER, FINISH_FIXED, UNIT_CLASS, UPGRADE_LINE, unitForClass, type UnitClass } from './difficulty';
import type { BuildingInfo } from './world';

/** Buildings whose units the AI trains. */
export const MILITARY_PRODUCERS: readonly string[] = ['barracks', 'archeryRange', 'stable', 'siegeWorkshop'];
const SIEGE_TYPES: readonly UnitId[] = ['batteringRam', 'trebuchet'];
const RAM: UnitId = 'batteringRam';
const CANDIDATE_CLASSES: readonly UnitClass[] = ['spear', 'sword', 'archer', 'horse'];

/** Production buildings on the schedule; one new site per decision. */
export function buildMilitary(d: AiDecision): void {
  const w = d.world;
  if (w.tc === null || !w.tc.constructed) return;
  const p = d.profile;
  const wanted: { type: BuildingId; count: number }[] = [];
  const time = d.tick / 20;
  if (w.villagers.length >= p.firstBarracks.villagers || (p.firstBarracks.seconds !== null && time >= p.firstBarracks.seconds)) {
    wanted.push({ type: 'barracks', count: 1 });
  }
  // Age 2 buildings, then (rams as soon as they can be had) the Siege Workshop, then the rest of the schedule.
  for (const m of p.militaryBuildings) if (m.age <= 2 && w.age >= m.age && w.villagers.length >= (m.villagers ?? 0)) wanted.push({ type: m.type, count: m.count });
  if (w.age >= 3 && (p.siege.rams > 0 || p.siege.siphonarioi > 0)) wanted.push({ type: 'siegeWorkshop', count: 1 });
  for (const m of p.militaryBuildings) if (m.age > 2 && w.age >= m.age && w.villagers.length >= (m.villagers ?? 0)) wanted.push({ type: m.type, count: m.count });
  const extra = floatProducer(d);
  if (extra !== null) wanted.push(extra);
  for (const want of wanted) {
    d.ops.n++;
    if (d.countOf(want.type) >= want.count) continue;
    // One unfinished military site at a time keeps builders on the economy.
    if (d.view.buildings.some((b) => !b.constructed && MILITARY_PRODUCERS.includes(b.typeId))) return;
    if (!d.available(want.type)) continue;
    const cost = d.cost(want.type);
    if (!d.canAfford(cost)) {
      // From the Township Age, save for it: the economy may not spend these resources this decision. (Not in the
      // Founding Age, where every coin goes to villagers and the advance.)
      if (w.age >= 2) for (const r of ['food', 'wood', 'gold', 'stone'] as const) d.saving[r] = cost[r];
      return;
    }
    const spot = d.baseSpot(want.type, 8);
    if (spot === null) continue;
    const size = d.data.building(want.type).footprint;
    const builders = d.pickBuilders(spot.tx + size / 2, spot.ty + size / 2, 3);
    d.construct(want.type, spot, builders, false);
    return;
  }
}

/**
 * Never float (`floatProducers`, hard): every completed military producer busy and food plus wood beyond the army
 * reserve at the threshold -> one more of the gold-free producer whose unit the stock affords best (Stable for
 * horsemen when food leads, else Barracks for spearmen).
 */
function floatProducer(d: AiDecision): { type: BuildingId; count: number } | null {
  const f = d.profile.floatProducers;
  if (f === null || d.world.age < 2) return null;
  let producers = 0;
  let idle = 0;
  for (const b of d.world.buildings) {
    d.ops.n++;
    if (!MILITARY_PRODUCERS.includes(b.typeId)) continue;
    producers++;
    // Ranges and workshops can sit idle for want of gold; only the gold-free producers count.
    if ((b.typeId === 'barracks' || b.typeId === 'stable') && (!b.constructed || b.queueLength === 0)) idle++;
  }
  if (idle > 0 || producers >= f.maxProducers) return null;
  const free = d.freeStock();
  // Finishing a beaten enemy: more producers sooner (half the stock).
  if (free.food + free.wood < (d.finishing ? f.stock / 2 : f.stock)) return null;
  const type: BuildingId = free.food >= 2 * free.wood ? 'stable' : 'barracks';
  return { type, count: d.countOf(type) + 1 };
}

/** Point every military producer's rally at the rally point. */
export function setRallies(d: AiDecision): void {
  const r = d.rally();
  const ids: number[] = [];
  for (const b of d.world.buildings) {
    d.ops.n++;
    if (!b.constructed || !MILITARY_PRODUCERS.includes(b.typeId)) continue;
    if (b.rally !== null && Math.abs(b.rally.x - r.x) + Math.abs(b.rally.y - r.y) < 2) continue;
    ids.push(b.id);
  }
  if (ids.length > 0) d.emit({ type: 'setRally', buildingIds: ids, x: r.x, y: r.y });
}

/** `counter[class]` of 6.4, normalised by total enemy fighting power; null when the enemy has no army. */
function counterScores(d: AiDecision): Record<UnitClass, number> | null {
  const raw: Record<string, number> = {};
  let total = 0;
  for (const e of d.world.enemyUnits) {
    d.ops.n++;
    if (!e.fighting) continue;
    total += e.power;
    for (const c of CANDIDATE_CLASSES) raw[c] = (raw[c] ?? 0) + (COUNTER[c][e.cls] ?? 0) * e.power;
  }
  if (total <= 0) return null;
  const out = { spear: 0, sword: 0, archer: 0, horse: 0, heavyCav: 0, siege: 0, villager: 0 };
  for (const c of CANDIDATE_CLASSES) out[c] = (raw[c] ?? 0) / total;
  return out;
}

function lineOf(building: string): 'infantry' | 'archer' | 'cavalry' | null {
  return UPGRADE_LINE[building] ?? null;
}

/** Train from every idle producer (queue under 2) within the military budget. */
export function trainArmy(d: AiDecision): void {
  const w = d.world;
  const p = d.profile;
  const c = p.counterWeight;
  const counter = c > 0 ? counterScores(d) : null;
  const shareCount: Record<string, number> = {};
  let armySize = 0;
  for (const u of w.army) {
    if (u.siege) continue;
    armySize++;
    const cls = u.cls === 'heavyCav' ? 'horse' : u.cls;
    shareCount[cls] = (shareCount[cls] ?? 0) + 1;
  }
  const producers = w.buildings.filter((b) => b.constructed && MILITARY_PRODUCERS.includes(b.typeId)).sort((a, b) => a.id - b.id);
  const ramAt = trainRam(d, producers);
  for (const b of producers) {
    d.ops.n += 4;
    if (b.queueLength >= 2 || b.id === ramAt) continue;
    const unit = b.typeId === 'siegeWorkshop' ? siegeChoice(d, b) : lineChoice(d, b, counter, shareCount, armySize);
    if (unit === null) continue;
    const cost = d.cost(unit);
    const pop = d.data.unit(unit).popCost;
    if (d.popUsed + pop > d.popCap) return;
    if (!d.canAfford(cost, d.militaryBudget())) continue;
    d.pay(cost, true);
    d.popUsed += pop;
    d.emit({ type: 'train', buildingId: b.id, unitType: unit });
    const line = lineOf(b.typeId);
    if (line !== null) d.mem.trained[line]++;
    const cls = UNIT_CLASS[unit] ?? 'sword';
    const key = cls === 'heavyCav' ? 'horse' : cls;
    shareCount[key] = (shareCount[key] ?? 0) + 1;
    armySize++;
  }
}

/**
 * Rams first (6.3 siege, "as soon as it can"): while the AI has fewer than `siege.rams` (alive and queued), one is
 * queued per decision, from the whole stockpile (less an advance being saved for), at a Siege Workshop (Citadel Age).
 * While finishing a beaten enemy also at a Barracks, from the Township Age (the Barracks builds rams from Age 2): the
 * Siege Workshop first, then the shortest queue, then the lowest id. Returns the producer used, or null.
 */
function trainRam(d: AiDecision, producers: readonly BuildingInfo[]): number | null {
  if (!ramWanted(d)) return null;
  let best: BuildingInfo | null = null;
  for (const b of producers) {
    d.ops.n++;
    const workshop = b.typeId === 'siegeWorkshop';
    // The Barracks builds rams only while finishing; otherwise they come from the Siege Workshop (Age 3).
    if (b.queueLength >= 2 || !d.data.building(b.typeId).trains.includes(RAM) || (!workshop && !d.finishing)) continue;
    const bestWorkshop = best !== null && best.typeId === 'siegeWorkshop';
    if (best === null || (workshop && !bestWorkshop) || (workshop === bestWorkshop && b.queueLength < best.queueLength)) best = b;
  }
  if (best === null) return null;
  const cost = d.cost(RAM);
  const budget = { ...d.stock };
  if (d.ageCost !== null) for (const r of ['food', 'wood', 'gold', 'stone'] as const) budget[r] = Math.max(0, budget[r] - d.ageCost[r]);
  const pop = d.data.unit(RAM).popCost;
  if (d.popUsed + pop > d.popCap || !d.canAfford(cost, budget)) return null;
  d.pay(cost, true);
  d.popUsed += pop;
  d.emit({ type: 'train', buildingId: best.id, unitType: RAM });
  return best.id;
}

/** Does the AI want another ram now (see `trainRam`)? */
function ramWanted(d: AiDecision): boolean {
  const s = d.profile.siege;
  if (s.rams <= 0 || d.world.age < (d.finishing ? 2 : 3) || !d.available(RAM)) return false;
  let have = 0;
  for (const b of d.world.buildings) {
    d.ops.n++;
    for (const q of b.queuedUnits) if (q === RAM) have++;
  }
  for (const u of d.world.army) if (u.typeId === RAM) have++;
  return have < s.rams;
}

/**
 * Before the economy spends: while a ram is wanted and a building that trains it stands, its cost is held back from
 * the economy this decision (rams do not wait for the wood that farms and Houses would otherwise take first).
 */
export function saveForRam(d: AiDecision): void {
  if (!ramWanted(d)) return;
  const from = (b: BuildingInfo): boolean => b.constructed && (b.typeId === 'siegeWorkshop' || (d.finishing && d.data.building(b.typeId).trains.includes(RAM)));
  if (!d.world.buildings.some(from)) return;
  const cost = d.cost(RAM);
  for (const r of ['food', 'wood', 'gold', 'stone'] as const) d.saving[r] = Math.max(d.saving[r], cost[r]);
}

/** Best unit for a Barracks, Archery Range or Stable: highest `score - currentShare` among the affordable, available ones. */
function lineChoice(
  d: AiDecision,
  b: BuildingInfo,
  counter: Record<UnitClass, number> | null,
  shareCount: Record<string, number>,
  armySize: number,
): UnitId | null {
  const p = d.profile;
  const c = p.counterWeight;
  const trains = d.data.building(b.typeId).trains;
  // Finishing an enemy with no army at all (counter weight above 0): units that raze buildings and outlast arrows.
  const fixedTable = d.finishing && counter === null && c > 0 ? FINISH_FIXED : p.fixed;
  let best: UnitId | null = null;
  let bestScore = -Infinity;
  for (const cls of CANDIDATE_CLASSES) {
    d.ops.n++;
    const fixed = fixedTable[cls] ?? 0;
    if ((c === 0 || fixedTable === FINISH_FIXED) && fixed <= 0) continue;
    // The Cataphract replaces the Horseman from Age 3, but a Horseman (no gold) is trained when it is unaffordable.
    const preferred = unitForClass(cls, d.world.age);
    const options: UnitId[] = preferred === null ? [] : preferred === 'cataphract' ? ['cataphract', 'horseman'] : [preferred];
    const budget = d.militaryBudget();
    const unit = options.find((u) => trains.includes(u) && d.available(u) && d.canAfford(d.cost(u), budget)) ?? null;
    if (unit === null) continue;
    const ctr = counter === null ? fixed : counter[cls];
    const score = (1 - c) * fixed + c * ctr;
    const share = armySize > 0 ? (shareCount[cls] ?? 0) / armySize : 0;
    const value = score - share;
    if (value > bestScore + 1e-9) {
      best = unit;
      bestScore = value;
    }
  }
  return best;
}

/** Siege Workshop: rams from Age 3, trebuchets and Siphonarioi from Age 4, up to the per-wave counts. */
function siegeChoice(d: AiDecision, b: BuildingInfo): UnitId | null {
  const s = d.profile.siege;
  const have: Record<string, number> = {};
  for (const u of d.world.army) if (SIEGE_TYPES.includes(u.typeId) || u.typeId === 'siphonarios') have[u.typeId] = (have[u.typeId] ?? 0) + 1;
  for (const q of b.queuedUnits) have[q] = (have[q] ?? 0) + 1;
  // Rams are queued by `trainRam`.
  const wants: [UnitId, number, number][] = [
    ['trebuchet', s.trebuchets, 4],
    ['siphonarios', s.siphonarioi, 4],
  ];
  for (const [unit, count, age] of wants) {
    if (d.world.age < age || (have[unit] ?? 0) >= count) continue;
    if (d.available(unit)) return unit;
  }
  return null;
}

/** Military upgrades per the difficulty: one research per decision. */
export function research(d: AiDecision): void {
  const p = d.profile;
  if (p.upgrades === 'none' || d.world.age < p.upgradesFromAge) return;
  let lines: string[] = ['infantry', 'archer', 'cavalry'];
  if (p.upgrades === 'topTwoLevelOne') {
    const t = d.mem.trained;
    lines = (['infantry', 'archer', 'cavalry'] as const)
      .map((l, i) => ({ l, n: t[l], i }))
      .sort((a, b) => b.n - a.n || a.i - b.i)
      .slice(0, 2)
      .filter((x) => x.n > 0)
      .map((x) => x.l);
  }
  const researched = d.sim.state.players[d.playerId]?.researched ?? [];
  for (const b of d.world.buildings) {
    d.ops.n++;
    if (!b.constructed) continue;
    const line = lineOf(b.typeId);
    if (line === null || !lines.includes(line)) continue;
    if (b.queuedTechs.length > 0 || b.queueLength > 1) continue;
    for (const techId of d.data.building(b.typeId).researches) {
      const tech = d.data.tech(techId);
      if (researched.includes(techId)) continue;
      if (p.upgrades === 'topTwoLevelOne' && (tech.requiresTechs ?? []).length > 0) continue;
      if (!d.available(techId)) continue;
      const cost = d.cost(techId);
      if (!d.canAfford(cost, d.militaryBudget())) continue;
      d.pay(cost, true);
      d.emit({ type: 'research', buildingId: b.id, techId });
      return;
    }
  }
}
