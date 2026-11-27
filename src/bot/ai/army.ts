/**
 * Waves (PLAN-M2 6.5): `massing` -> `attacking` -> `retreating` -> `massing`. Defence (6.6) overrides all of these:
 * while a threat is answered no wave launches, and defenders are not given wave orders.
 *
 * Commands are re-issued only when they would change something (a new target or approach point, or an idle unit
 * far from it), so the AI does not spam orders, and every id it names was read from the current state.
 *
 * Town Center arrows are weighed with the fight model of `strike.ts`, never with a power figure: a target under the
 * arrows is taken only when the wave can finish it before the arrows thin it out (cheaply, for anything but the Town
 * Center itself). A Town Center the wave cannot take yet is not fed piecemeal: the wave waits just out of its reach,
 * gathers its reinforcements (and rams) and goes in together once the model says it wins.
 */

import { TICK_RATE, rngRange, type EntityId } from '../../sim';
import type { AiDecision } from './context';
import { waveThreshold } from './difficulty';
import { CombatTable, coveringTowers, enemyTowers, strike, type Tower } from './strike';
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
/** Hard: enemy army within this radius of a target, compared with 1.2x the wave (6.5). */
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
/** A building is a target only if the wave razes it within this many seconds (armour against its blows, repairers). */
const RAZE_SECONDS = 120;
/** A target under the arrows (other than the tower itself) is taken only if it costs at most this share of the wave (at least one unit). */
const STRIKE_LOSS = 0.25;
/** The assault on a tower starts when the gathered units deal this multiple of its hp before they die, and goes on at 1.0. */
const ASSAULT_MARGIN = 1.3;
const CONTINUE_MARGIN = 1;
/** The staging point lies this many tiles outside the tower's reach (towards home); units this close to it count as gathered. */
const STAGE_MARGIN = 3;
const GATHER_RADIUS = 8;
/** Units this close to a tower (footprint) take part in an assault in progress. */
const ASSAULT_RADIUS = 20;
/** Enemy villagers this close to an assaulted tower's footprint are cut down first. */
const SWEEP_RADIUS = 8;
/** Covered villagers this close to the first one form the group a wave or raid strikes at. */
const VILLAGER_GROUP = 10;

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
    // After the first wave (every difficulty): an enemy with almost no army is attacked at once (games must end).
    let enemyArmy = 0;
    for (const e of d.world.enemyUnits) if (e.fighting) enemyArmy += e.power;
    const poolPower = sumPower(pool);
    const defenceless = mem.waveNumber > 0 && !waitBreach && enemyArmy * 4 < poolPower;
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
      (defenceless && (fighters >= 3 || (p.siege.rams > 0 && rams >= p.siege.rams)));
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
  // Reinforce: all-in, the table's continuous reinforcement, or an enemy with almost no army left (every difficulty:
  // the units that would otherwise idle at home finish the game).
  const reinforce =
    allIn || (p.wave.reinforceFromWave !== null && mem.waveNumber >= p.wave.reinforceFromWave) || enemyPower * 4 < sumPower(units);
  if (reinforce && !defenceActive && !wave.raid) {
    // Reinforcements leave the rally point in groups, never one by one (all-in: at once). Rams go at once.
    const fresh = pool.filter((u) => !inWave.has(u.id));
    // An enemy with no fighting unit at all cannot pick off stragglers: then every unit goes at once too.
    const group = allIn || (d.finishing && enemyPower === 0) ? 1 : REINFORCE_GROUP;
    if (fresh.length >= group || fresh.some((u) => u.siege)) {
      wave.unitIds = [...wave.unitIds, ...fresh.map((u) => u.id)].sort((a, b) => a - b);
      wave.startPower += sumPower(fresh);
      units = [...units, ...fresh];
      // Fresh units walk to the current point.
      if (wave.orderX >= 0) sendGroup(d, fresh.filter((u) => !u.siege), wave.orderX, wave.orderY, true);
    }
  }
  const power = sumPower(units);
  const ctx: WaveContext = { table: new CombatTable(d), towers: enemyTowers(d) };
  const plan = choosePlan(d, units, ctx);
  // An assault the model says wins is carried through: losing units to the arrows is its price, not a reason to turn.
  const assault = plan !== null && plan.mode === 'assault';
  if (!allIn && !assault && p.retreatBelow !== null && wave.startPower > 0 && power < p.retreatBelow * wave.startPower) {
    retreat(d, units);
    return;
  }
  if (!allIn && wave.raid) {
    if (power < RAID_KEEP * wave.startPower || d.tick - wave.launchTick > RAID_SECONDS * TICK_RATE || localThreat(d, units, ctx.towers) > RAID_RETREAT * power) {
      retreat(d, units);
      return;
    }
    if (orderRaid(d, units, ctx)) return;
    // Nothing a raid can take (no exposed or cheaply reached villagers, no building it razes in time): home.
    if (plan === null || plan.mode !== 'strike') {
      retreat(d, units);
      return;
    }
  } else if (!allIn && p.localRetreat !== null && localThreat(d, units, ctx.towers) > p.localRetreat * power) {
    retreat(d, units);
    return;
  }
  if (plan !== null) orderWave(d, units, plan, ctx);
}

/**
 * Enemy fighting power within LOCAL_RADIUS of the wave centroid. Town Center arrows covering the centroid are added
 * (at TOWER_NOMINAL_HP) only when enemy fighting units are there too: arrows and an army together are a defence the
 * wave must out-power; arrows alone are weighed by the fight model of `strike` when the target is chosen.
 */
function localThreat(d: AiDecision, units: readonly UnitInfo[], towers: readonly Tower[]): number {
  const c = centroid(units);
  let threat = 0;
  for (const e of d.world.enemyUnits) {
    d.ops.n++;
    if (!e.fighting) continue;
    if ((e.x - c.x) * (e.x - c.x) + (e.y - c.y) * (e.y - c.y) <= LOCAL_RADIUS * LOCAL_RADIUS) threat += e.power;
  }
  if (threat > 0) for (const t of coveringTowers(towers, c.x, c.y, null)) threat += ((t.arrows * t.attack) / t.period) * TOWER_NOMINAL_HP;
  return threat;
}

/** Nominal hp that turns a tower's arrows into a power comparable with units' (with an army beside it). */
const TOWER_NOMINAL_HP = 300;

/** What one decision's target choice works with. */
interface WaveContext {
  table: CombatTable;
  towers: Tower[];
}

/**
 * The wave's job this decision:
 * - `strike`: take `target` (a building it razes in time, or a unit; `villagers`, when set, are cut down first);
 * - `assault`: go in on the tower `target` (villagers around it first), the model says the wave wins;
 * - `stage`: wait at `stage`, out of the tower's reach, until the gathered units can take it.
 */
interface WavePlan {
  target: BuildingInfo | UnitInfo;
  mode: 'strike' | 'assault' | 'stage';
  stage: { x: number; y: number } | null;
  villagers: UnitInfo[];
}

const plain = (target: BuildingInfo | UnitInfo): WavePlan => ({ target, mode: 'strike', stage: null, villagers: [] });

/**
 * Raid (hard's first wave): every unit gets an explicit `attack` on the exposed enemy villager nearest to it (out of
 * every Town Center's reach), re-chosen when its target dies or becomes covered; failing that, on villagers under the
 * arrows when the fight model says the raid kills them losing at most one raider per two villagers (never all of it).
 * Returns false when there
 * is no such villager (the wave then raids an outlying building it razes in time, or goes home).
 */
function orderRaid(d: AiDecision, units: readonly UnitInfo[], ctx: WaveContext): boolean {
  if (!d.combatOrders) return false;
  let pool = exposedVillagers(d, ctx.towers);
  if (pool.length === 0) pool = coveredVillagers(d, units, ctx, centroid(units), true) ?? [];
  if (pool.length === 0) return false;
  strikeVillagers(d, units, pool);
  return true;
}

/** Every fighting wave unit not already on one of `pool` (or on another unit) attacks the villager of `pool` nearest to it. */
function strikeVillagers(d: AiDecision, units: readonly UnitInfo[], pool: readonly UnitInfo[]): void {
  const ids = new Set<EntityId>(pool.map((v) => v.id));
  const byTarget: Record<number, EntityId[]> = {};
  for (const u of units) {
    d.ops.n++;
    if (u.siege || !u.fighting) continue;
    const o = u.order;
    if (o !== null && o.type === 'attack' && ids.has(o.targetId)) continue;
    if (o !== null && o.type === 'attack') {
      const other = d.world.byId.get(o.targetId);
      if (other !== undefined && 'cls' in other && other.fighting) continue;
    }
    const t = nearestUnit(d, pool, u);
    if (t === null) continue;
    (byTarget[t.id] ??= []).push(u.id);
  }
  for (const id of Object.keys(byTarget).map(Number).sort((a, b) => a - b)) {
    d.emit({ type: 'attack', unitIds: byTarget[id]!.sort((a, b) => a - b), targetId: id, queue: false });
  }
}

/** Enemy villagers out of every tower's reach (+1 tile) and RAID_TC_DISTANCE from every Town Center. Ascending id. */
function exposedVillagers(d: AiDecision, towers: readonly Tower[]): UnitInfo[] {
  const w = d.world;
  const centres = w.enemyBuildings.filter((b) => b.typeId === d.data.start.centerBuilding);
  return w.enemyUnits.filter(
    (u) =>
      u.villager &&
      coveringTowers(towers, u.x, u.y, null).length === 0 &&
      centres.every((t) => distSqTo(u.x, u.y, t) > RAID_TC_DISTANCE * RAID_TC_DISTANCE),
  );
}

/**
 * Enemy villagers under the arrows that the wave kills cheaply: the group (within VILLAGER_GROUP tiles) around the
 * covered villager nearest to `c`, if the fight model says the wave kills them all losing at most STRIKE_LOSS of its
 * units (a raid: one raider per two villagers, never all of it). Ascending id, or null.
 */
function coveredVillagers(d: AiDecision, units: readonly UnitInfo[], ctx: WaveContext, c: { x: number; y: number }, raid = false): UnitInfo[] | null {
  if (ctx.towers.length === 0) return null;
  const covered = d.world.enemyUnits.filter((u) => u.villager && coveringTowers(ctx.towers, u.x, u.y, null).length > 0);
  d.ops.n += d.world.enemyUnits.length;
  const first = nearestUnit(d, covered, c);
  if (first === null) return null;
  const group = covered.filter((v) => (v.x - first.x) * (v.x - first.x) + (v.y - first.y) * (v.y - first.y) <= VILLAGER_GROUP * VILLAGER_GROUP);
  let hp = 0;
  for (const v of group) hp += v.hp;
  const fighters = units.filter((u) => u.fighting);
  const cover = coveringTowers(ctx.towers, first.x, first.y, null);
  const s = strike(d, ctx.table, fighters, hp, (u) => ctx.table.dpsVsUnit(u, first), cover);
  // A raid trades: up to one raider for every two villagers (but never the whole raid); a wave, STRIKE_LOSS of itself.
  const cap = raid ? Math.min(fighters.length - 1, Math.max(1, Math.floor(group.length / 2))) : lossCap(fighters.length);
  return s.seconds !== null && s.lost <= cap ? group : null;
}

function lossCap(n: number): number {
  return Math.max(1, Math.floor(STRIKE_LOSS * n));
}

/** Units that can raze armoured buildings: siege (`targets: 'buildings'`) and the Siphonarios. */
export function isBreacher(u: UnitInfo): boolean {
  return u.siege || u.typeId === 'siphonarios';
}

/** Escorts stay with breachers until these are this close to the target. */
const ESCORT_RELEASE = 8;
/** Line units this close to a building target (or a unit target) get an explicit `attack` on it. */
const ATTACK_RADIUS = 10;

/** Issue the plan's orders to the wave. */
function orderWave(d: AiDecision, units: UnitInfo[], plan: WavePlan, ctx: WaveContext): void {
  if (plan.mode === 'stage') {
    stageWave(d, units, plan, ctx);
    return;
  }
  const wave = d.mem.wave!;
  const c = centroid(units);
  const target = plan.target;
  const breachers = units.filter(isBreacher);
  const line = units.filter((u) => !isBreacher(u));
  const building = 'size' in target ? target : null;
  // Escorts walk with the breachers until they are close to their target.
  let point = approach(d, target, c);
  if (breachers.length > 0 && building !== null && plan.mode === 'strike') {
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

  // Villagers first (under the arrows, or around an assaulted tower), every fighting line unit on the nearest one.
  if (plan.villagers.length > 0 && d.combatOrders) {
    strikeVillagers(d, line, plan.villagers);
    if (d.profile.target === 'armyAware') focusFire(d, units, c);
    return;
  }

  // Line units: explicit `attack` near the target (or on the tower in an assault); otherwise attack-move to the point.
  const explicit = d.combatOrders && (building === null || breachers.length === 0 || plan.mode === 'assault');
  const strikers: UnitInfo[] = [];
  const walkers: UnitInfo[] = [];
  for (const u of line) {
    d.ops.n++;
    const o = u.order;
    if (explicit && (plan.mode === 'assault' || distSqTo(u.x, u.y, target) <= ATTACK_RADIUS * ATTACK_RADIUS)) {
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

/**
 * Staging: every wave unit waits at the staging point. Units attacking something under the arrows are pulled out with
 * a plain `move` (an attack-move would let them fight on); the rest attack-move there (and fight what they meet).
 */
function stageWave(d: AiDecision, units: readonly UnitInfo[], plan: WavePlan, ctx: WaveContext): void {
  const wave = d.mem.wave!;
  const s = plan.stage!;
  const changed = wave.targetId !== plan.target.id || dist(s.x, s.y, wave.orderX, wave.orderY) > REORDER_DISTANCE;
  wave.targetId = plan.target.id;
  if (changed) {
    wave.orderX = s.x;
    wave.orderY = s.y;
  }
  const movers: UnitInfo[] = [];
  const walkers: UnitInfo[] = [];
  for (const u of units) {
    d.ops.n++;
    const o = u.order;
    const targetId = o === null ? null : o.type === 'attack' ? o.targetId : o.type === 'attackMove' && o.phase === 'engaging' ? o.targetId : null;
    if (targetId !== null && underArrows(d, ctx, targetId)) {
      movers.push(u);
      continue;
    }
    if (isEngaged(u)) continue;
    const heading = o !== null && (o.type === 'move' || o.type === 'attackMove') && dist(o.x, o.y, wave.orderX, wave.orderY) <= IDLE_RESEND;
    if ((changed && !heading) || (o === null && dist(u.x, u.y, wave.orderX, wave.orderY) > IDLE_RESEND)) walkers.push(u);
  }
  sendGroup(d, movers, wave.orderX, wave.orderY, false);
  sendGroup(d, walkers.filter((u) => !u.siege), wave.orderX, wave.orderY, true);
  sendGroup(d, walkers.filter((u) => u.siege), wave.orderX, wave.orderY, false);
}

/** Is the entity a tower, or a building or unit within a tower's reach? */
function underArrows(d: AiDecision, ctx: WaveContext, id: EntityId): boolean {
  const e = d.world.byId.get(id);
  if (e === undefined) return false;
  if ('size' in e) return ctx.towers.some((t) => t.b.id === e.id) || coveringTowers(ctx.towers, 0, 0, e).length > 0;
  return coveringTowers(ctx.towers, e.x, e.y, null).length > 0;
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

/** Standard priority (6.5): production 3, economy and drop-off 2, House 1 (the Town Center is handled as a tower). */
function priorityOf(d: AiDecision, b: BuildingInfo): number {
  if (b.typeId === d.data.start.centerBuilding) return 0;
  if (b.producer) return 3;
  const def = d.data.building(b.typeId);
  if (b.typeId === 'house' || (def.popProvided > 0 && def.dropOff.length === 0)) return 1;
  return 2;
}

/** Enemy villagers out of every tower's reach and 8+ tiles from Town Centers: the largest cluster's central villager. */
function raidTarget(d: AiDecision, towers: readonly Tower[]): UnitInfo | null {
  const w = d.world;
  const exposed = exposedVillagers(d, towers);
  const groups = clusters(exposed, 6, w.mapWidth, w.mapHeight, d.ops);
  let raid: UnitInfo[] | null = null;
  for (const g of groups) if (raid === null || g.length > raid.length) raid = g;
  if (raid === null) return null;
  return nearestUnit(d, raid, centroid(raid));
}

/**
 * Target choice (6.5, adapted to armoured buildings and Town Center arrows), in order:
 * 1. endgame (no completed enemy producer): the nearest villager, then any unit, then any building;
 * 2. with rams (above easy): the Town Center, when the assault wins (6.5 "Town Center first only with rams");
 * 3. the best building the wave razes within RAZE_SECONDS and, under the arrows, takes cheaply (easy: nearest;
 *    standard: 6.5 type priority, then distance; hard: the same among those whose nearby enemy army is at most 1.2x
 *    the wave);
 * 4. the largest cluster of exposed villagers; 5. villagers under the arrows, when cheap;
 * 6. the Town Center: assault when the gathered units win, otherwise stage out of its reach;
 * 7. the nearest building.
 */
function choosePlan(d: AiDecision, units: readonly UnitInfo[], ctx: WaveContext): WavePlan | null {
  const w = d.world;
  const c = centroid(units);
  if (!w.enemyBuildings.some((b) => b.producer && b.constructed)) {
    const vill = nearestUnit(d, w.enemyUnits.filter((u) => u.villager), c);
    const t = vill ?? nearestUnit(d, w.enemyUnits, c) ?? nearestBuilding(d, c);
    return t === null ? null : plain(t);
  }
  const rams = units.some((u) => u.typeId === 'batteringRam');
  if (rams && d.profile.target !== 'nearest') {
    const a = towerPlan(d, units, ctx, c);
    if (a !== null && a.mode === 'assault') return a;
  }
  const b = bestBuilding(d, units, ctx, c);
  if (b !== null) return plain(b);
  const raid = raidTarget(d, ctx.towers);
  if (raid !== null) return plain(raid);
  const cv = coveredVillagers(d, units, ctx, c);
  if (cv !== null) return { target: cv[0]!, mode: 'strike', stage: null, villagers: cv };
  const a = towerPlan(d, units, ctx, c);
  if (a !== null) return a;
  const nb = nearestBuilding(d, c);
  return nb === null ? null : plain(nb);
}

/** Damage per second of the whole wave against a building (siege included). */
function waveDps(units: readonly UnitInfo[], b: BuildingInfo, ctx: WaveContext): number {
  let s = 0;
  for (const u of units) s += ctx.table.dpsVsBuilding(u, b);
  return s;
}

/** Step 3 of `choosePlan`. */
function bestBuilding(d: AiDecision, units: readonly UnitInfo[], ctx: WaveContext, c: { x: number; y: number }): BuildingInfo | null {
  const w = d.world;
  const towerIds = new Set<EntityId>(ctx.towers.map((t) => t.b.id));
  const nearest = d.profile.target === 'nearest';
  const scored: { b: BuildingInfo; pr: number; dd: number }[] = [];
  for (const b of w.enemyBuildings) {
    d.ops.n++;
    if (towerIds.has(b.id)) continue;
    scored.push({ b, pr: nearest ? 0 : priorityOf(d, b), dd: distSqTo(c.x, c.y, b) });
  }
  scored.sort((x, y) => y.pr - x.pr || x.dd - y.dd || x.b.id - y.b.id);
  const dpsByType: Record<string, number> = {};
  const wavePower = sumPower(units);
  // A wave that out-powers every tower (at TOWER_NOMINAL_HP) and the whole enemy army together walks in anyway.
  let defenceTotal = 0;
  for (const t of ctx.towers) defenceTotal += ((t.arrows * t.attack) / t.period) * TOWER_NOMINAL_HP;
  for (const e of w.enemyUnits) if (e.fighting) defenceTotal += e.power;
  const overwhelming = wavePower > ARMY_AWARE_RATIO * defenceTotal;
  let grid: Buckets<UnitInfo> | null = null;
  const defenceAt = (b: BuildingInfo): number => {
    grid ??= new Buckets(w.mapWidth, w.mapHeight, w.enemyUnits.filter((e) => e.fighting), d.ops);
    let defence = 0;
    for (const e of grid.near(b.cx, b.cy, ARMY_AWARE_RADIUS + 3, d.ops)) {
      if (distSqTo(e.x, e.y, b) <= ARMY_AWARE_RADIUS * ARMY_AWARE_RADIUS) defence += e.power;
    }
    return defence;
  };
  for (const { b } of scored) {
    d.ops.n++;
    const heal = ctx.table.repairRate(b);
    let raw = dpsByType[b.typeId];
    if (raw === undefined) {
      d.ops.n += units.length;
      raw = waveDps(units, b, ctx);
      dpsByType[b.typeId] = raw;
    }
    const dps = raw - heal;
    if (dps <= 0 || b.hp / dps > RAZE_SECONDS) continue;
    if (d.profile.target === 'armyAware' && defenceAt(b) > ARMY_AWARE_RATIO * wavePower) continue;
    const cover = coveringTowers(ctx.towers, 0, 0, b);
    if (cover.length > 0 && !overwhelming && !nearest) {
      // Under the arrows (above easy): with enemy units there too, only an overwhelming wave goes in; with the arrows
      // alone, the fight model decides (the target must fall at a cost of at most STRIKE_LOSS of the wave).
      if (defenceAt(b) > 0) continue;
      const s = strike(d, ctx.table, units, b.hp, (u) => ctx.table.dpsVsBuilding(u, b), cover, heal);
      if (s.seconds === null || s.lost > lossCap(units.length)) continue;
    }
    return b;
  }
  return null;
}

/**
 * The tower nearest the wave: `assault` when the units gathered at its staging point (or already at it) win the fight
 * model with ASSAULT_MARGIN (an assault in progress goes on while the units around it win at all) and the enemy army
 * near it is not stronger than the wave; otherwise `stage`.
 */
function towerPlan(d: AiDecision, units: readonly UnitInfo[], ctx: WaveContext, c: { x: number; y: number }): WavePlan | null {
  let tw: Tower | null = null;
  let best = Infinity;
  for (const t of ctx.towers) {
    const dd = distSqTo(c.x, c.y, t.b);
    if (dd < best || (dd === best && tw !== null && t.b.id < tw.b.id)) {
      tw = t;
      best = dd;
    }
  }
  if (tw === null) return null;
  const tower = tw.b;
  const stage = stagePoint(d, tw);
  const assaultOn = units.some((u) => u.order !== null && u.order.type === 'attack' && u.order.targetId === tower.id);
  const attackers = units.filter((u) => {
    d.ops.n++;
    if (assaultOn) return distSqTo(u.x, u.y, tower) <= ASSAULT_RADIUS * ASSAULT_RADIUS;
    return dist(u.x, u.y, stage.x, stage.y) <= GATHER_RADIUS || distSqTo(u.x, u.y, tower) <= tw.reach * tw.reach;
  });
  const cover = coveringTowers(ctx.towers, 0, 0, tower);
  const margin = assaultOn ? CONTINUE_MARGIN : ASSAULT_MARGIN;
  const s = strike(d, ctx.table, attackers, tower.hp * margin, (u) => ctx.table.dpsVsBuilding(u, tower), cover, ctx.table.repairRate(tower));
  let ok = s.seconds !== null;
  if (ok) {
    let guards = 0;
    for (const e of d.world.enemyUnits) {
      d.ops.n++;
      if (e.fighting && distSqTo(e.x, e.y, tower) <= ARMY_AWARE_RADIUS * ARMY_AWARE_RADIUS) guards += e.power;
    }
    if (guards * ARMY_AWARE_RATIO > sumPower(attackers)) ok = false;
  }
  if (!ok) return { target: tower, mode: 'stage', stage, villagers: [] };
  const villagers = d.world.enemyUnits.filter((u) => u.villager && distSqTo(u.x, u.y, tower) <= SWEEP_RADIUS * SWEEP_RADIUS);
  return { target: tower, mode: 'assault', stage, villagers };
}

/** The point STAGE_MARGIN tiles outside the tower's reach on the line from it towards home, on a free tile. */
function stagePoint(d: AiDecision, tw: Tower): { x: number; y: number } {
  const h = d.home();
  const dx = h.x - tw.b.cx;
  const dy = h.y - tw.b.cy;
  const len = Math.sqrt(dx * dx + dy * dy);
  const r = tw.reach + STAGE_MARGIN;
  const x = len > 1e-6 ? tw.b.cx + (dx / len) * r : tw.b.cx + r;
  const y = len > 1e-6 ? tw.b.cy + (dy / len) * r : tw.b.cy;
  return d.freePoint(Math.min(d.world.mapWidth - 1.5, Math.max(1.5, x)), Math.min(d.world.mapHeight - 1.5, Math.max(1.5, y)));
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
