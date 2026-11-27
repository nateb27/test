/**
 * Waves (PLAN-M2 6.5): `massing` -> `attacking` -> `retreating` -> `massing`. Defence (6.6) overrides all of these:
 * while a threat is answered no wave launches, and defenders are not given wave orders.
 *
 * Commands are re-issued only when they would change something (a new target or approach point, or an idle unit
 * far from it), so the AI does not spam orders, and every id it names was read from the current state.
 */

import { TICK_RATE, rngRange, type EntityId } from '../../sim';
import type { AiDecision } from './context';
import { waveThreshold } from './difficulty';
import { Buckets, centroid, clusters, distSqTo, sumPower, type BuildingInfo, type UnitInfo } from './world';

const dist = (ax: number, ay: number, bx: number, by: number): number => Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));

/** Massed units farther than this from the rally point walk back to it. */
const RALLY_SLACK = 8;
/** A retreat ends when every unit is this close to the rally point, or after RETREAT_MAX_SECONDS. */
const RETREAT_ARRIVED = 8;
const RETREAT_MAX_SECONDS = 45;
/** Reinforcements stream to an active wave in groups of at least this many. */
const REINFORCE_GROUP = 4;
/** Re-send the wave when its approach point moved this far. */
const REORDER_DISTANCE = 3;
/** Idle wave units farther than this from the approach point are sent again. */
const IDLE_RESEND = 5;
/** Hard: enemy army within this radius of the planned target, compared with 1.2x the wave (6.5). */
const ARMY_AWARE_RADIUS = 15;
const ARMY_AWARE_RATIO = 1.2;
/** Hard: villager clusters at least this far from any enemy Town Center are raid targets. */
const RAID_TC_DISTANCE = 8;
/** Hard focus fire: candidates within this radius of the wave centroid; attackers within FOCUS_JOIN of the target. */
const FOCUS_RADIUS = 6;
const FOCUS_JOIN = 8;

/** Schedule the first wave (once): earliest = table time + rng jitter, forced = earliest + forcedAfter. */
export function scheduleFirstWave(d: AiDecision): void {
  const mem = d.mem;
  if (mem.nextWaveEarliestTick >= 0) return;
  const w = d.profile.wave;
  const earliest = (w.earliest + rngRange(mem.rng, 0, w.jitter)) * TICK_RATE;
  mem.nextWaveEarliestTick = earliest;
  mem.nextWaveForcedTick = earliest + w.forcedAfter * TICK_RATE;
}

function endWave(d: AiDecision): void {
  const mem = d.mem;
  const w = d.profile.wave;
  mem.wave = null;
  mem.phase = 'massing';
  mem.nextWaveEarliestTick = d.tick + w.interval * TICK_RATE;
  mem.nextWaveForcedTick = mem.nextWaveEarliestTick + w.forcedAfter * TICK_RATE;
}

function isEngaged(u: UnitInfo): boolean {
  const o = u.order;
  if (o === null) return false;
  return o.type === 'attack' || o.type === 'hold' || (o.type === 'attackMove' && o.phase === 'engaging');
}

function isIdle(u: UnitInfo): boolean {
  return u.order === null && u.queued === 0;
}

/** Wave units still alive (and ids pruned in memory). */
export function waveUnits(d: AiDecision): UnitInfo[] {
  const wave = d.mem.wave;
  if (wave === null) return [];
  const out: UnitInfo[] = [];
  const ids: EntityId[] = [];
  for (const id of wave.unitIds) {
    d.ops.n++;
    const u = d.world.byId.get(id);
    if (u !== undefined && 'cls' in u && u.owner === d.playerId && !u.villager) {
      out.push(u);
      ids.push(id);
    }
  }
  wave.unitIds = ids;
  return out;
}

/** Send units to a point: `attackMove` (or `move` without combat), one group command. */
export function sendGroup(d: AiDecision, units: readonly UnitInfo[], x: number, y: number, attack: boolean): void {
  if (units.length === 0) return;
  const unitIds = units.map((u) => u.id).sort((a, b) => a - b);
  if (attack && d.combatOrders) d.emit({ type: 'attackMove', unitIds, x, y, queue: false });
  else d.emit({ type: 'move', unitIds, x, y, queue: false });
}

/** Wave recall (6.6): the wave stops attacking and joins the defence. Returns the recalled units. */
export function recallWave(d: AiDecision): UnitInfo[] {
  const units = waveUnits(d);
  endWave(d);
  return units;
}

/** Retreat (6.5): back to the rally point; the survivors merge into the next wave. */
function retreat(d: AiDecision, units: readonly UnitInfo[]): void {
  const wave = d.mem.wave;
  if (wave === null) return;
  const r = d.rally();
  d.mem.phase = 'retreating';
  wave.retreatTick = d.tick;
  wave.orderX = r.x;
  wave.orderY = r.y;
  sendGroup(d, units, r.x, r.y, false);
}

export function runArmy(d: AiDecision, defenceActive: boolean): void {
  const mem = d.mem;
  const p = d.profile;
  scheduleFirstWave(d);
  if (p.allIn !== null && mem.allInTick === null && d.tick >= p.allIn * TICK_RATE) mem.allInTick = d.tick;
  const allIn = mem.allInTick !== null;
  let units = waveUnits(d);
  const inWave = new Set<EntityId>(mem.wave?.unitIds ?? []);
  const defenders = new Set<EntityId>(mem.defence.defenderIds);
  const pool = d.world.army.filter((u) => !inWave.has(u.id) && !defenders.has(u.id));
  const rally = d.rally();

  if (mem.phase === 'retreating') {
    const wave = mem.wave;
    const arrived = units.every((u) => dist(u.x, u.y, rally.x, rally.y) <= RETREAT_ARRIVED);
    if (wave === null || arrived || d.tick - (wave.retreatTick ?? d.tick) >= RETREAT_MAX_SECONDS * TICK_RATE) {
      endWave(d);
      units = [];
    } else return;
  }

  if (mem.phase === 'massing') {
    // Stragglers (back from a defence, or idle elsewhere) walk to the rally point.
    const strays = pool.filter((u) => isIdle(u) && dist(u.x, u.y, rally.x, rally.y) > RALLY_SLACK);
    sendGroup(d, strays, rally.x, rally.y, false);
    if (defenceActive) return;
    const fighters = pool.filter((u) => !u.siege).length;
    const threshold = waveThreshold(p.wave, mem.waveNumber + 1);
    const ready =
      (allIn && fighters > 0) ||
      (d.tick >= mem.nextWaveEarliestTick && fighters >= threshold) ||
      (d.tick + p.decisionInterval > mem.nextWaveForcedTick && fighters >= Math.max(3, Math.ceil(threshold / 2)));
    if (!ready || d.world.enemies.length === 0) return;
    const ids = pool.map((u) => u.id).sort((a, b) => a - b);
    mem.wave = {
      unitIds: ids,
      targetId: null,
      orderX: -1,
      orderY: -1,
      launchTick: d.tick,
      startPower: sumPower(pool),
      retreatTick: null,
    };
    mem.phase = 'attacking';
    mem.waveNumber++;
    if (mem.firstWaveTick === null) mem.firstWaveTick = d.tick;
    units = pool;
    for (const u of pool) inWave.add(u.id);
  }

  // Attacking.
  const wave = mem.wave;
  if (wave === null) return;
  if (units.length === 0) {
    endWave(d);
    return;
  }
  const reinforce = allIn || (p.wave.reinforceFromWave !== null && mem.waveNumber >= p.wave.reinforceFromWave);
  if (reinforce && !defenceActive) {
    // Reinforcements leave the rally point in groups, never one by one (all-in: at once).
    const fresh = pool.filter((u) => !inWave.has(u.id));
    if (fresh.length >= (allIn ? 1 : REINFORCE_GROUP)) {
      wave.unitIds = [...wave.unitIds, ...fresh.map((u) => u.id)].sort((a, b) => a - b);
      wave.startPower += sumPower(fresh);
      units = [...units, ...fresh];
      // Fresh units walk to the current point.
      if (wave.orderX >= 0) sendGroup(d, fresh.filter((u) => !u.siege), wave.orderX, wave.orderY, true);
    }
  }
  const power = sumPower(units);
  if (!allIn && p.retreatBelow !== null && wave.startPower > 0 && power < p.retreatBelow * wave.startPower) {
    retreat(d, units);
    return;
  }
  orderWave(d, units);
}

/** Pick the target and (re)issue orders to the wave. */
function orderWave(d: AiDecision, units: UnitInfo[]): void {
  const wave = d.mem.wave!;
  const c = centroid(units);
  const target = chooseTarget(d, units, c);
  if (target === null) return;
  const point = approach(d, target, c);
  const changed = wave.targetId !== target.id || dist(point.x, point.y, wave.orderX, wave.orderY) > REORDER_DISTANCE;
  wave.targetId = target.id;
  if (changed) {
    wave.orderX = point.x;
    wave.orderY = point.y;
  }
  const siegeTarget = 'size' in target ? target : nearestBuilding(d, c);
  const siegePoint = siegeTarget !== null ? approach(d, siegeTarget, c) : point;
  const walkers: UnitInfo[] = [];
  const siege: UnitInfo[] = [];
  for (const u of units) {
    d.ops.n++;
    if (u.siege) {
      const o = u.order;
      if (d.combatOrders && siegeTarget !== null) {
        const onIt = o !== null && o.type === 'attack' && o.targetId === siegeTarget.id;
        if (!onIt) siege.push(u);
      } else if (changed || (isIdle(u) && dist(u.x, u.y, siegePoint.x, siegePoint.y) > IDLE_RESEND)) siege.push(u);
      continue;
    }
    if (isEngaged(u)) continue;
    if (changed || (isIdle(u) && dist(u.x, u.y, wave.orderX, wave.orderY) > IDLE_RESEND)) walkers.push(u);
  }
  sendGroup(d, walkers, wave.orderX, wave.orderY, true);
  if (siege.length > 0) {
    if (siegeTarget !== null && d.combatOrders) {
      d.emit({ type: 'attack', unitIds: siege.map((u) => u.id).sort((a, b) => a - b), targetId: siegeTarget.id, queue: false });
    } else sendGroup(d, siege, siegePoint.x, siegePoint.y, false);
  }
  if (d.profile.target === 'armyAware') focusFire(d, units, c);
}

function nearestBuilding(d: AiDecision, c: { x: number; y: number }): BuildingInfo | null {
  let best: BuildingInfo | null = null;
  let bestD = Infinity;
  for (const b of d.world.enemyBuildings) {
    d.ops.n++;
    const dd = distSqTo(c.x, c.y, b);
    if (dd < bestD) {
      best = b;
      bestD = dd;
    }
  }
  return best;
}

/** Standard priority (6.5): production 3, economy and drop-off 2, House 1, Town Center 0 (4 with rams). */
function priorityOf(d: AiDecision, b: BuildingInfo, rams: boolean): number {
  if (b.typeId === d.data.start.centerBuilding) return rams ? 4 : 0;
  if (b.producer) return 3;
  const def = d.data.building(b.typeId);
  if (b.typeId === 'house' || (def.popProvided > 0 && def.dropOff.length === 0)) return 1;
  return 2;
}

function chooseTarget(d: AiDecision, units: readonly UnitInfo[], c: { x: number; y: number }): BuildingInfo | UnitInfo | null {
  const w = d.world;
  const producers = w.enemyBuildings.filter((b) => b.producer && b.constructed);
  // Endgame (all difficulties): no production building left -> villagers, then any unit, then any building.
  if (producers.length === 0) {
    const vill = nearestUnit(d, w.enemyUnits.filter((u) => u.villager), c);
    if (vill !== null) return vill;
    const any = nearestUnit(d, w.enemyUnits, c);
    if (any !== null) return any;
    return nearestBuilding(d, c);
  }
  if (d.profile.target === 'nearest') return nearestBuilding(d, c);
  const rams = units.some((u) => u.typeId === 'batteringRam');
  let best: BuildingInfo | null = null;
  let bestP = -1;
  let bestD = Infinity;
  for (const b of w.enemyBuildings) {
    d.ops.n++;
    const pr = priorityOf(d, b, rams);
    const dd = distSqTo(c.x, c.y, b);
    if (pr > bestP || (pr === bestP && dd < bestD)) {
      best = b;
      bestP = pr;
      bestD = dd;
    }
  }
  if (best === null || d.profile.target !== 'armyAware') return best;
  return armyAware(d, units, best, rams, c);
}

/** Nominal hp that turns a defensive building's arrows into a power comparable with units'. */
const TOWER_NOMINAL_HP = 300;

/**
 * Hard (6.5): the highest-priority building whose defence (enemy fighting power within 15 tiles, plus the arrows of
 * any building with an attack in reach of it) is at most 1.2x the wave; if every building is defended that well, the
 * largest cluster of enemy villagers at least 8 tiles from every enemy Town Center; failing that, the planned target.
 */
function armyAware(
  d: AiDecision,
  units: readonly UnitInfo[],
  planned: BuildingInfo,
  rams: boolean,
  c: { x: number; y: number },
): BuildingInfo | UnitInfo {
  const w = d.world;
  const wavePower = sumPower(units);
  const fighters = w.enemyUnits.filter((e) => e.fighting);
  const grid = new Buckets(w.mapWidth, w.mapHeight, fighters, d.ops);
  const towers: { b: BuildingInfo; reach: number; power: number }[] = [];
  for (const b of w.enemyBuildings) {
    const a = d.data.building(b.typeId).combat.attack;
    if (a === undefined || !b.constructed) continue;
    const cooldownTicks = Math.max(1, Math.round(a.cooldown * TICK_RATE));
    towers.push({ b, reach: a.range + d.data.combat.reach + 1, power: ((a.arrows * a.attack * TICK_RATE) / cooldownTicks) * TOWER_NOMINAL_HP });
  }
  let best: BuildingInfo | null = null;
  let bestP = -1;
  let bestD = Infinity;
  for (const b of w.enemyBuildings) {
    d.ops.n++;
    let defence = 0;
    for (const e of grid.near(b.cx, b.cy, ARMY_AWARE_RADIUS + 3, d.ops)) {
      if (distSqTo(e.x, e.y, b) <= ARMY_AWARE_RADIUS * ARMY_AWARE_RADIUS) defence += e.power;
    }
    for (const t of towers) {
      // Nearest point of b to the tower's centre within the tower's reach.
      if (distSqTo(t.b.cx, t.b.cy, b) <= t.reach * t.reach) defence += t.power;
    }
    if (defence > ARMY_AWARE_RATIO * wavePower) continue;
    const pr = priorityOf(d, b, rams);
    const dd = distSqTo(c.x, c.y, b);
    if (pr > bestP || (pr === bestP && dd < bestD)) {
      best = b;
      bestP = pr;
      bestD = dd;
    }
  }
  if (best !== null) return best;
  const centres = w.enemyBuildings.filter((b) => b.typeId === d.data.start.centerBuilding);
  const exposed = w.enemyUnits.filter((u) => u.villager && centres.every((t) => distSqTo(u.x, u.y, t) > RAID_TC_DISTANCE * RAID_TC_DISTANCE));
  const groups = clusters(exposed, 6, w.mapWidth, w.mapHeight, d.ops);
  let raid: UnitInfo[] | null = null;
  for (const g of groups) if (raid === null || g.length > raid.length) raid = g;
  if (raid === null) return planned;
  return nearestUnit(d, raid, centroid(raid)) ?? planned;
}

function nearestUnit(d: AiDecision, units: readonly UnitInfo[], c: { x: number; y: number }): UnitInfo | null {
  let best: UnitInfo | null = null;
  let bestD = Infinity;
  for (const u of units) {
    d.ops.n++;
    const dd = (u.x - c.x) * (u.x - c.x) + (u.y - c.y) * (u.y - c.y);
    if (dd < bestD || (dd === bestD && best !== null && u.id < best.id)) {
      best = u;
      bestD = dd;
    }
  }
  return best;
}

/** Approach point of a target: a unit's position, or the point one tile outside a footprint facing `from`. */
function approach(d: AiDecision, t: BuildingInfo | UnitInfo, from: { x: number; y: number }): { x: number; y: number } {
  if (!('size' in t)) return { x: t.x, y: t.y };
  const x0 = t.tx - 1;
  const y0 = t.ty - 1;
  const x1 = t.tx + t.size + 1;
  const y1 = t.ty + t.size + 1;
  let x = Math.min(x1, Math.max(x0, from.x));
  let y = Math.min(y1, Math.max(y0, from.y));
  if (x > x0 && x < x1 && y > y0 && y < y1) {
    // Inside the grown footprint: push out through the nearest side.
    const sides = [x - x0, x1 - x, y - y0, y1 - y];
    const m = Math.min(...sides);
    if (m === sides[0]) x = x0;
    else if (m === sides[1]) x = x1;
    else if (m === sides[2]) y = y0;
    else y = y1;
  }
  x = Math.min(d.world.mapWidth - 0.5, Math.max(0.5, x));
  y = Math.min(d.world.mapHeight - 0.5, Math.max(0.5, y));
  return { x, y };
}

/** Hard (6.5): every decision, focus the lowest-hp enemy siege or archer near the wave. */
function focusFire(d: AiDecision, units: readonly UnitInfo[], c: { x: number; y: number }): void {
  if (!d.combatOrders) return;
  let target: UnitInfo | null = null;
  for (const e of d.world.enemyUnits) {
    d.ops.n++;
    if (!(e.siege || e.cls === 'archer')) continue;
    if ((e.x - c.x) * (e.x - c.x) + (e.y - c.y) * (e.y - c.y) > FOCUS_RADIUS * FOCUS_RADIUS) continue;
    if (target === null || e.hp < target.hp || (e.hp === target.hp && e.id < target.id)) target = e;
  }
  if (target === null) return;
  const t = target;
  const ids: EntityId[] = [];
  for (const u of units) {
    if (u.siege || !u.fighting) continue;
    if (u.order !== null && u.order.type === 'attack' && u.order.targetId === t.id) continue;
    if ((u.x - t.x) * (u.x - t.x) + (u.y - t.y) * (u.y - t.y) > FOCUS_JOIN * FOCUS_JOIN) continue;
    ids.push(u.id);
  }
  if (ids.length > 0) d.emit({ type: 'attack', unitIds: ids.sort((a, b) => a - b), targetId: t.id, queue: false });
}

/** At most this many stalled units are nudged per decision. */
const UNSTICK_PER_DECISION = 12;

/**
 * Defensive workaround: a unit chasing a building with no path and no pending request, close to the footprint but
 * outside its reach, would wait forever (it happens when the unit stands diagonally next to a footprint corner).
 * Such units get a `move` to a point just outside the footprint's nearest edge; once idle there they acquire the
 * building again from inside reach.
 */
export function unstick(d: AiDecision): void {
  let n = 0;
  for (const u of d.world.army) {
    if (n >= UNSTICK_PER_DECISION) return;
    d.ops.n++;
    if (!u.stalled || u.order === null || u.order.type !== 'attack') continue;
    const t = d.world.byId.get(u.order.targetId);
    if (t === undefined || !('size' in t)) continue;
    const c = d.data.unit(u.typeId).combat;
    const reach = c.range + d.data.combat.reach;
    const dd = distSqTo(u.x, u.y, t);
    if (dd <= reach * reach || dd > (reach + 2) * (reach + 2)) continue;
    const px = Math.min(t.tx + t.size, Math.max(t.tx, u.x));
    const py = Math.min(t.ty + t.size, Math.max(t.ty, u.y));
    const len = Math.sqrt(dd);
    const k = Math.min(reach * 0.5, 0.3) / len;
    const x = Math.min(d.world.mapWidth - 0.01, Math.max(0.01, px + (u.x - px) * k));
    const y = Math.min(d.world.mapHeight - 0.01, Math.max(0.01, py + (u.y - py) * k));
    d.emit({ type: 'move', unitIds: [u.id], x, y, queue: false });
    n++;
  }
}
