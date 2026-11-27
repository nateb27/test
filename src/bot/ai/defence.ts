/**
 * Defence (PLAN-M2 6.6): threat detection and response.
 *
 * Threat: enemy fighting and siege units within THREAT_RADIUS tiles of any own building (footprint distance), grouped
 * by single-link clustering (CLUSTER_LINK tiles, ascending id). The strongest cluster (ties: lowest id) is answered
 * after the difficulty's reaction delay by every own fighting unit not in a wave more than WAVE_HOME_RADIUS tiles
 * from home. Standard and hard recall the wave when the threat is over twice the defenders' power. Villagers per the
 * difficulty: none (easy), evacuate (standard), or fight small raids of at most 2 units with the 4 nearest villagers
 * and evacuate otherwise (hard). Held villagers go back to the economy once no threat has been seen for
 * THREAT_CLEAR_SECONDS.
 */

import { TICK_RATE, type EntityId } from '../../sim';
import { recallWave, sendGroup, waveUnits } from './army';
import type { AiDecision } from './context';
import { CLUSTER_LINK, THREAT_CLEAR_SECONDS, THREAT_RADIUS, WAVE_HOME_RADIUS } from './difficulty';
import { Buckets, centroid, clusters, distSqTo, sumPower, type BuildingInfo, type UnitInfo } from './world';

/** Villagers within this distance of a threat unit are evacuated. */
const EVACUATE_RADIUS = 10;
/** Raids of at most this many units are fought by villagers at hard. */
const SMALL_RAID = 2;
const RAID_FIGHTERS = 4;
/** Re-send defenders when the threat centroid moved this far. */
const DEFENCE_REORDER = 4;

const sq = (x: number): number => x * x;

/** Enemy fighting/siege units within THREAT_RADIUS of any own building. Ascending id. */
export function findThreats(d: AiDecision): UnitInfo[] {
  const w = d.world;
  if (w.buildings.length === 0 || w.enemyUnits.length === 0) return [];
  const pts = w.buildings.map((b) => ({ x: b.cx, y: b.cy, b }));
  const grid = new Buckets(w.mapWidth, w.mapHeight, pts, d.ops);
  const out: UnitInfo[] = [];
  for (const e of w.enemyUnits) {
    d.ops.n++;
    if (e.villager) continue;
    // Building centres are at most 2*sqrt(2) from their footprint edge (4x4 Town Center).
    const near = grid.near(e.x, e.y, THREAT_RADIUS + 3, d.ops);
    if (near.some((p) => distSqTo(e.x, e.y, p.b) <= THREAT_RADIUS * THREAT_RADIUS)) out.push(e);
  }
  return out;
}

/** Runs the defence; returns true while a threat is being answered (waves hold off). */
export function runDefence(d: AiDecision): boolean {
  const mem = d.mem;
  const def = mem.defence;
  // Prune the dead from the held lists.
  def.defenderIds = def.defenderIds.filter((id) => d.world.byId.has(id));
  def.villagerIds = def.villagerIds.filter((id) => d.world.byId.has(id));

  const threats = findThreats(d);
  if (threats.length === 0) {
    if (def.lastSeenTick !== null && d.tick - def.lastSeenTick >= THREAT_CLEAR_SECONDS * TICK_RATE) clear(d);
    def.sinceTick = null;
    return def.active && def.lastSeenTick !== null && d.tick - def.lastSeenTick < THREAT_CLEAR_SECONDS * TICK_RATE;
  }
  def.lastSeenTick = d.tick;
  if (def.sinceTick === null) def.sinceTick = d.tick;
  if (d.tick - def.sinceTick < d.profile.reactionDelay * TICK_RATE) return def.active;

  const groups = clusters(threats, CLUSTER_LINK, d.world.mapWidth, d.world.mapHeight, d.ops);
  let main = groups[0]!;
  let mainPower = sumPower(main);
  for (const g of groups) {
    const pw = sumPower(g);
    if (pw > mainPower) {
      main = g;
      mainPower = pw;
    }
  }
  const c = centroid(main);
  const moved = !def.active || sq(c.x - def.x) + sq(c.y - def.y) > DEFENCE_REORDER * DEFENCE_REORDER;
  def.active = true;
  if (moved) {
    def.x = c.x;
    def.y = c.y;
  }

  // Defenders: fighting units not in a wave far from home.
  const home = d.home();
  const wave = waveUnits(d);
  const waveAway = wave.length > 0 && sq(centroid(wave).x - home.x) + sq(centroid(wave).y - home.y) > WAVE_HOME_RADIUS * WAVE_HOME_RADIUS;
  const inWave = new Set<EntityId>(mem.wave?.unitIds ?? []);
  let defenders = d.world.army.filter((u) => u.fighting && !(waveAway && inWave.has(u.id)));
  const threatPower = sumPower(threats);
  if (!waveAway && wave.length > 0) recallWave(d);
  else if (waveAway && d.profile.retreatBelow !== null && threatPower > 2 * sumPower(defenders)) {
    def.recalled = true;
    defenders = [...defenders, ...recallWave(d).filter((u) => u.fighting)];
  }
  const ids = new Set<EntityId>(def.defenderIds);
  const send: UnitInfo[] = [];
  for (const u of defenders) {
    d.ops.n++;
    const engaged = u.order !== null && (u.order.type === 'attack' || (u.order.type === 'attackMove' && u.order.phase === 'engaging'));
    if (engaged) {
      ids.add(u.id);
      continue;
    }
    if (moved || !ids.has(u.id) || (u.order === null && sq(u.x - def.x) + sq(u.y - def.y) > 25)) send.push(u);
    ids.add(u.id);
  }
  sendGroup(d, send, def.x, def.y, true);
  def.defenderIds = [...ids].sort((a, b) => a - b);

  villagers(d, threats, main);
  return true;
}

/** End of a threat: defenders walk back to the rally point, villagers return to the economy. */
function clear(d: AiDecision): void {
  const def = d.mem.defence;
  const r = d.rally();
  const back: UnitInfo[] = [];
  for (const id of def.defenderIds) {
    const u = d.world.byId.get(id);
    if (u !== undefined && 'cls' in u && (u.order === null || u.order.type === 'attackMove')) back.push(u);
  }
  sendGroup(d, back, r.x, r.y, false);
  def.active = false;
  def.recalled = false;
  def.defenderIds = [];
  def.villagerIds = [];
  def.sinceTick = null;
  def.lastSeenTick = null;
}

function villagers(d: AiDecision, threats: readonly UnitInfo[], main: readonly UnitInfo[]): void {
  const mode = d.profile.villagers;
  if (mode === 'none') return;
  const def = d.mem.defence;
  const held = new Set<EntityId>(def.villagerIds);
  if (mode === 'fightSmall' && main.length <= SMALL_RAID && threats.length <= SMALL_RAID && d.combatOrders) {
    const fighting = d.world.villagers.filter((v) => held.has(v.id) && v.order !== null && v.order.type === 'attack').length;
    if (fighting < RAID_FIGHTERS) {
      const c = centroid(main);
      const target = [...main].sort((a, b) => sq(a.x - c.x) + sq(a.y - c.y) - (sq(b.x - c.x) + sq(b.y - c.y)) || a.id - b.id)[0]!;
      const pick = d.world.villagers
        .filter((v) => !held.has(v.id) && !d.claimed.has(v.id))
        .map((v) => ({ v, dd: sq(v.x - target.x) + sq(v.y - target.y) }))
        .sort((a, b) => a.dd - b.dd || a.v.id - b.v.id)
        .slice(0, RAID_FIGHTERS - fighting)
        .map((x) => x.v);
      if (pick.length > 0) {
        d.emit({ type: 'attack', unitIds: pick.map((v) => v.id).sort((a, b) => a - b), targetId: target.id, queue: false });
        for (const v of pick) {
          held.add(v.id);
          d.claim(v.id);
        }
      }
    }
    def.villagerIds = [...held].sort((a, b) => a - b);
    return;
  }
  // Evacuate villagers near any threat unit to the Town Center.
  const tc: BuildingInfo | null = d.world.tc;
  const runners: UnitInfo[] = [];
  for (const v of d.world.villagers) {
    d.ops.n++;
    if (held.has(v.id) || d.claimed.has(v.id)) continue;
    let near = false;
    for (const t of threats) {
      d.ops.n++;
      if (sq(t.x - v.x) + sq(t.y - v.y) <= EVACUATE_RADIUS * EVACUATE_RADIUS) {
        near = true;
        break;
      }
    }
    if (near) runners.push(v);
  }
  if (runners.length > 0) {
    const h = tc !== null ? { x: tc.cx, y: tc.cy } : d.home();
    const p = d.freePoint(h.x + (tc !== null ? tc.size / 2 + 1 : 0), h.y + (tc !== null ? tc.size / 2 + 1 : 0));
    sendGroup(d, runners, p.x, p.y, false);
    for (const v of runners) {
      held.add(v.id);
      d.claim(v.id);
    }
  }
  def.villagerIds = [...held].sort((a, b) => a - b);
}
