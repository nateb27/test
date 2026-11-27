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
/** A wave waits at most this long past its forced tick for its rams. */
const BREACH_WAIT_SECONDS = 90;
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
/** Local power check (hard): enemy fighting units within this radius of the wave centroid. */
const LOCAL_RADIUS = 12;
/** A raid pulls out when the enemy power around it exceeds this multiple of its own, or below RAID_KEEP of its start power. */
const RAID_RETREAT = 0.7;
const RAID_KEEP = 0.5;
/** A raid goes home after this long. */
const RAID_SECONDS = 150;

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
    const half = Math.max(3, Math.ceil(threshold / 2));
    // Once a Siege Workshop stands, a wave waits for its rams (they raze the armoured production buildings), at most
    // BREACH_WAIT_SECONDS past the forced tick.
    const workshop = d.world.buildings.some((b) => b.typeId === 'siegeWorkshop' && b.constructed);
    const rams = pool.filter((u) => u.typeId === 'batteringRam').length;
    const breachDeadline = mem.nextWaveForcedTick + BREACH_WAIT_SECONDS * TICK_RATE;
    // A wave twice its threshold does not wait: numbers raze soft targets and clear the way for the next rams.
    const waitBreach = workshop && p.siege.rams > 0 && rams < p.siege.rams && d.tick < breachDeadline && fighters < 2 * threshold;
    // Above easy, after the first wave: an enemy with almost no army is attacked at once (games must end).
    let enemyArmy = 0;
    for (const e of d.world.enemyUnits) if (e.fighting) enemyArmy += e.power;
    const poolPower = sumPower(pool);
    const defenceless = p.target !== 'nearest' && mem.waveNumber > 0 && !waitBreach && enemyArmy * 4 < poolPower;
    const raid = p.raidFirstWave && mem.waveNumber === 0;
    // Hard commits only when stronger than the whole enemy army (the raid excepted: it avoids the army), or when the
    // army has outgrown waiting (twice its threshold, or the population is nearly full).
    const outgrown = d.popUsed >= 190 || (p.commitRatio === null && fighters >= 2 * threshold);
    const strong = raid || p.commitRatio === null || poolPower >= p.commitRatio * enemyArmy || outgrown;
    const forcedStrong = raid || p.commitRatio === null || poolPower >= enemyArmy || outgrown;
    const forcedDue = d.tick + p.decisionInterval > mem.nextWaveForcedTick;
    if (!raid && p.commitRatio !== null && forcedDue && !forcedStrong && !waitBreach) {
      // Too weak to force a launch: keep massing and look again shortly.
      mem.nextWaveForcedTick = d.tick + 20 * TICK_RATE;
    }
    const ready =
      (allIn && fighters > 0) ||
      (!waitBreach && d.tick >= mem.nextWaveEarliestTick && fighters >= threshold && strong) ||
      (!waitBreach && forcedDue && fighters >= (raid ? 2 : half) && forcedStrong) ||
      (d.tick >= breachDeadline && fighters >= half && forcedStrong) ||
      (defenceless && fighters >= 3);
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
      raid,
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
  let enemyPower = 0;
  for (const e of d.world.enemyUnits) if (e.fighting) enemyPower += e.power;
  // Reinforce: all-in, the table's continuous reinforcement, or (above easy) an enemy with almost no army left.
  const reinforce =
    allIn ||
    (p.wave.reinforceFromWave !== null && mem.waveNumber >= p.wave.reinforceFromWave) ||
    (p.target !== 'nearest' && enemyPower * 4 < sumPower(units));
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
  if (!allIn && wave.raid) {
    if (power < RAID_KEEP * wave.startPower || d.tick - wave.launchTick > RAID_SECONDS * TICK_RATE || localThreat(d, units) > RAID_RETREAT * power) {
      retreat(d, units);
      return;
    }
    if (orderRaid(d, units)) return;
  } else if (!allIn && p.localRetreat !== null && localThreat(d, units) > p.localRetreat * power) {
    retreat(d, units);
    return;
  }
  orderWave(d, units);
}

/** Enemy fighting power within LOCAL_RADIUS of the wave centroid, plus the arrows of any tower in reach of it. */
function localThreat(d: AiDecision, units: readonly UnitInfo[]): number {
  const c = centroid(units);
  let threat = 0;
  for (const e of d.world.enemyUnits) {
    d.ops.n++;
    if (!e.fighting) continue;
    if ((e.x - c.x) * (e.x - c.x) + (e.y - c.y) * (e.y - c.y) <= LOCAL_RADIUS * LOCAL_RADIUS) threat += e.power;
  }
  for (const t of towersOf(d)) if (covered([t], c.x, c.y, null)) threat += t.power;
  return threat;
}

/**
 * Raid (hard's first wave): every unit gets an explicit `attack` on the exposed enemy villager nearest to it (out of
 * every Town Center's reach), re-chosen when its target dies or becomes covered. Returns false when there is no
 * exposed villager (the wave then picks a target like any other wave: soft buildings out of arrow reach).
 */
function orderRaid(d: AiDecision, units: readonly UnitInfo[]): boolean {
  if (!d.combatOrders) return false;
  const exposed = exposedVillagers(d);
  if (exposed.length === 0) return false;
  const exposedIds = new Set<EntityId>(exposed.map((v) => v.id));
  const byTarget: Record<number, EntityId[]> = {};
  for (const u of units) {
    if (u.siege || !u.fighting) continue;
    const o = u.order;
    if (o !== null && o.type === 'attack' && exposedIds.has(o.targetId)) continue;
    const t = nearestUnit(d, exposed, u);
    if (t === null) continue;
    (byTarget[t.id] ??= []).push(u.id);
  }
  for (const id of Object.keys(byTarget).map(Number).sort((a, b) => a - b)) {
    d.emit({ type: 'attack', unitIds: byTarget[id]!.sort((a, b) => a - b), targetId: id, queue: false });
  }
  return true;
}

/** Enemy villagers out of every tower's reach (+1 tile) and RAID_TC_DISTANCE from every Town Center. Ascending id. */
function exposedVillagers(d: AiDecision): UnitInfo[] {
  const w = d.world;
  const towers = towersOf(d);
  const centres = w.enemyBuildings.filter((b) => b.typeId === d.data.start.centerBuilding);
  return w.enemyUnits.filter(
    (u) => u.villager && !covered(towers, u.x, u.y, null) && centres.every((t) => distSqTo(u.x, u.y, t) > RAID_TC_DISTANCE * RAID_TC_DISTANCE),
  );
}

/** Units that can raze armoured buildings: siege (`targets: 'buildings'`) and the Siphonarios. */
export function isBreacher(u: UnitInfo): boolean {
  return u.siege || u.typeId === 'siphonarios';
}

/**
 * A building line infantry can bring down: melee armour at most SOFT_ARMOR (Houses, Mills, camps, farms). Production
 * buildings and the Town Center are armoured against blows and are left to breachers (WP25 balance results).
 */
const SOFT_ARMOR = 4;
function isSoft(d: AiDecision, b: BuildingInfo): boolean {
  let armor = d.data.building(b.typeId).combat.meleeArmor;
  try {
    armor = d.query.resolvedStat(b.owner, b.typeId, 'meleeArmor');
  } catch {
    // keep the base value
  }
  return armor <= SOFT_ARMOR;
}
/** Escorts stay with breachers until these are this close to the target. */
const ESCORT_RELEASE = 8;
/** Line units this close to a soft target (or a unit target) get an explicit `attack` on it. */
const ATTACK_RADIUS = 10;

/** Pick the target and (re)issue orders to the wave. */
function orderWave(d: AiDecision, units: UnitInfo[]): void {
  const wave = d.mem.wave!;
  const c = centroid(units);
  const target = chooseTarget(d, units, c);
  if (target === null) return;
  const breachers = units.filter(isBreacher);
  const line = units.filter((u) => !isBreacher(u));
  const building = 'size' in target ? target : null;
  // Escorts walk with the breachers until they are close to their target.
  let point = approach(d, target, c);
  if (breachers.length > 0 && building !== null) {
    const bc = centroid(breachers);
    const far = Math.sqrt(distSqTo(bc.x, bc.y, building));
    if (far > ESCORT_RELEASE) {
      const ap = approach(d, building, bc);
      const len = Math.max(1e-6, dist(bc.x, bc.y, ap.x, ap.y));
      const k = Math.min(2, len) / len;
      point = { x: bc.x + (ap.x - bc.x) * k, y: bc.y + (ap.y - bc.y) * k };
    }
  }
  const changed = wave.targetId !== target.id || dist(point.x, point.y, wave.orderX, wave.orderY) > REORDER_DISTANCE;
  wave.targetId = target.id;
  if (changed) {
    wave.orderX = point.x;
    wave.orderY = point.y;
  }

  // Breachers: an explicit `attack` on the target building (or the nearest building when the target is a unit).
  const breachTarget = building ?? nearestBuilding(d, c);
  const breachPoint = breachTarget !== null ? approach(d, breachTarget, c) : point;
  const toBreach: UnitInfo[] = [];
  for (const u of breachers) {
    d.ops.n++;
    const o = u.order;
    if (d.combatOrders && breachTarget !== null) {
      if (!(o !== null && o.type === 'attack' && o.targetId === breachTarget.id)) toBreach.push(u);
    } else if (changed || (isIdle(u) && dist(u.x, u.y, breachPoint.x, breachPoint.y) > IDLE_RESEND)) toBreach.push(u);
  }
  if (toBreach.length > 0) {
    if (breachTarget !== null && d.combatOrders) {
      d.emit({ type: 'attack', unitIds: toBreach.map((u) => u.id).sort((x, y) => x - y), targetId: breachTarget.id, queue: false });
    } else sendGroup(d, toBreach, breachPoint.x, breachPoint.y, false);
  }

  // Line units: explicit `attack` near a soft building or a unit target; otherwise attack-move to the point.
  const explicit = d.combatOrders && (building === null || (isSoft(d, building) && breachers.length === 0));
  const strikers: UnitInfo[] = [];
  const walkers: UnitInfo[] = [];
  for (const u of line) {
    d.ops.n++;
    const o = u.order;
    if (explicit && distSqTo(u.x, u.y, target) <= ATTACK_RADIUS * ATTACK_RADIUS) {
      const onIt = o !== null && o.type === 'attack' && o.targetId === target.id;
      const other = o !== null && o.type === 'attack' ? d.world.byId.get(o.targetId) : undefined;
      const fightingUnit = other !== undefined && !('size' in other);
      if (!onIt && !fightingUnit) strikers.push(u);
      continue;
    }
    if (isEngaged(u)) continue;
    if (changed || (isIdle(u) && dist(u.x, u.y, wave.orderX, wave.orderY) > IDLE_RESEND)) walkers.push(u);
  }
  if (strikers.length > 0) d.emit({ type: 'attack', unitIds: strikers.map((u) => u.id).sort((x, y) => x - y), targetId: target.id, queue: false });
  sendGroup(d, walkers, wave.orderX, wave.orderY, true);
  if (d.profile.target === 'armyAware') focusFire(d, units, c);
}

function nearestBuilding(d: AiDecision, c: { x: number; y: number }, among?: readonly BuildingInfo[]): BuildingInfo | null {
  let best: BuildingInfo | null = null;
  let bestD = Infinity;
  for (const b of among ?? d.world.enemyBuildings) {
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

/** Nominal hp that turns a defensive building's arrows into a power comparable with units'. */
const TOWER_NOMINAL_HP = 300;

/** Enemy buildings with an attack (Town Centers): the building, reach (+1 tile margin) and a nominal power. */
function towersOf(d: AiDecision): { b: BuildingInfo; reach: number; power: number }[] {
  const towers: { b: BuildingInfo; reach: number; power: number }[] = [];
  for (const b of d.world.enemyBuildings) {
    const a = d.data.building(b.typeId).combat.attack;
    if (a === undefined || !b.constructed) continue;
    const cooldownTicks = Math.max(1, Math.round(a.cooldown * TICK_RATE));
    towers.push({ b, reach: a.range + d.data.combat.reach + 1, power: ((a.arrows * a.attack * TICK_RATE) / cooldownTicks) * TOWER_NOMINAL_HP });
  }
  return towers;
}

/** Is the building `t` (or, with `t` null, the point) within any tower's reach of its centre? */
function covered(towers: readonly { b: BuildingInfo; reach: number }[], x: number, y: number, t: BuildingInfo | null): boolean {
  for (const tw of towers) {
    const dd = t !== null ? distSqTo(tw.b.cx, tw.b.cy, t) : (tw.b.cx - x) * (tw.b.cx - x) + (tw.b.cy - y) * (tw.b.cy - y);
    if (dd <= tw.reach * tw.reach) return true;
  }
  return false;
}

/** Enemy villagers out of every tower's reach and 8+ tiles from Town Centers: the largest cluster's central villager. */
function raidTarget(d: AiDecision): UnitInfo | null {
  const w = d.world;
  const exposed = exposedVillagers(d);
  const groups = clusters(exposed, 6, w.mapWidth, w.mapHeight, d.ops);
  let raid: UnitInfo[] | null = null;
  for (const g of groups) if (raid === null || g.length > raid.length) raid = g;
  if (raid === null) return null;
  return nearestUnit(d, raid, centroid(raid));
}

/**
 * Target choice (6.5, adapted to armoured production buildings). Without breachers the wave goes only for soft
 * buildings (above easy, only those out of Town Center arrow reach), then for exposed villagers; with breachers the
 * 6.5 priorities apply to every building. Endgame (no completed enemy producer): villagers, any unit, any building.
 */
function chooseTarget(d: AiDecision, units: readonly UnitInfo[], c: { x: number; y: number }): BuildingInfo | UnitInfo | null {
  const w = d.world;
  const producers = w.enemyBuildings.filter((b) => b.producer && b.constructed);
  if (producers.length === 0) {
    const vill = nearestUnit(d, w.enemyUnits.filter((u) => u.villager), c);
    if (vill !== null) return vill;
    const any = nearestUnit(d, w.enemyUnits, c);
    if (any !== null) return any;
    return nearestBuilding(d, c);
  }
  const breach = units.some(isBreacher);
  const soft = breach ? w.enemyBuildings : w.enemyBuildings.filter((b) => isSoft(d, b));
  if (d.profile.target === 'nearest') return nearestBuilding(d, c, soft) ?? nearestBuilding(d, c);
  const towers = towersOf(d);
  // Arrow cover matters only while the wave is not overwhelming: past 1.2x (all towers + the whole enemy army) it
  // walks in anyway.
  let defence = 0;
  for (const t of towers) defence += t.power;
  for (const e of w.enemyUnits) if (e.fighting) defence += e.power;
  const overwhelming = sumPower(units) > ARMY_AWARE_RATIO * defence;
  const candidates = breach || overwhelming ? soft : soft.filter((b) => !covered(towers, 0, 0, b));
  const rams = units.some((u) => u.typeId === 'batteringRam');
  let best: BuildingInfo | null = null;
  let bestP = -1;
  let bestD = Infinity;
  for (const b of candidates) {
    d.ops.n++;
    const pr = priorityOf(d, b, rams);
    const dd = distSqTo(c.x, c.y, b);
    if (pr > bestP || (pr === bestP && dd < bestD)) {
      best = b;
      bestP = pr;
      bestD = dd;
    }
  }
  if (best !== null && d.profile.target === 'armyAware') return armyAware(d, units, candidates, best, rams, c);
  if (best !== null) return best;
  return raidTarget(d) ?? nearestBuilding(d, c, soft) ?? nearestBuilding(d, c);
}

/**
 * Hard (6.5): among the candidates, the highest-priority building whose defence (enemy fighting power within 15
 * tiles, plus the arrows of any building with an attack in reach of it) is at most 1.2x the wave; if every candidate
 * is defended that well, the largest exposed villager cluster; failing that, the planned target.
 */
function armyAware(
  d: AiDecision,
  units: readonly UnitInfo[],
  candidates: readonly BuildingInfo[],
  planned: BuildingInfo,
  rams: boolean,
  c: { x: number; y: number },
): BuildingInfo | UnitInfo {
  const w = d.world;
  const wavePower = sumPower(units);
  const fighters = w.enemyUnits.filter((e) => e.fighting);
  const grid = new Buckets(w.mapWidth, w.mapHeight, fighters, d.ops);
  const towers = towersOf(d);
  let best: BuildingInfo | null = null;
  let bestP = -1;
  let bestD = Infinity;
  for (const b of candidates) {
    d.ops.n++;
    let defence = 0;
    for (const e of grid.near(b.cx, b.cy, ARMY_AWARE_RADIUS + 3, d.ops)) {
      if (distSqTo(e.x, e.y, b) <= ARMY_AWARE_RADIUS * ARMY_AWARE_RADIUS) defence += e.power;
    }
    for (const t of towers) if (distSqTo(t.b.cx, t.b.cy, b) <= t.reach * t.reach) defence += t.power;
    if (defence > ARMY_AWARE_RATIO * wavePower) continue;
    const pr = priorityOf(d, b, rams);
    const dd = distSqTo(c.x, c.y, b);
    if (pr > bestP || (pr === bestP && dd < bestD)) {
      best = b;
      bestP = pr;
      bestD = dd;
    }
  }
  return best ?? raidTarget(d) ?? planned;
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
