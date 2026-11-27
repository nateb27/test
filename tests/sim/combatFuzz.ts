/**
 * Combat fuzz harness (WP33): a small two-player map with bases, soldiers of every type, villagers and tree clumps,
 * driven by random valid commands (attack, attackMove, hold, setStance, repair, move, stop, delete, resign, plus the
 * odd invalid one) from a seeded generator, with invariants checked after every tick:
 *
 * 1. no unit's current order names a removed entity (any `...Id` field) on two consecutive ticks (an order may
 *    point at an entity removed this tick until it next runs);
 * 2. progress: a unit with an `attack` or `attackMove` order whose target is alive moves, winds up, attacks or changes
 *    order within `STALL_TICKS`;
 * 3. no unit or building with hp <= 0 is still present one tick after it was first seen at hp <= 0;
 * 4. numbers: no NaN or infinity anywhere (`canonicalJson` throws on them), no negative accumulator, resources,
 *    carried amounts and hp are non-negative integers, hp <= the resolved maximum;
 * 5. population and stats: `popUsed` is the living units' pop cost; every removed unit or building either died (a
 *    `UnitDied`/`BuildingDestroyed` event this tick) or was deleted by an accepted `delete`; `unitsLost`,
 *    `unitsKilled`, `buildingsLost`, `buildingsDestroyed` move exactly with those events, never crediting the owner.
 *
 * `runFuzz` returns the violations (empty when clean) and hashes every 100 ticks, so callers can also compare two
 * runs and a run with a save/load in the middle.
 */

import { registry } from '../../src/data';
import { canonicalJson, hashState } from '../../src/sim/hash';
import { createBuilding, createNode, createUnit, findEntity } from '../../src/sim/entities';
import { createRng, rngInt } from '../../src/sim/rng';
import { deserialize, serialize } from '../../src/sim/serialize';
import { createInitialState, simFromState } from '../../src/sim/sim';
import type { Command, Entity, EntityId, GameState, PlayerId, RngState, Sim, SimEvent, UnitEntity } from '../../src/sim/types';

export const FUZZ_MAP = 40;
/** Longest a unit with a live attack or attack-move order may stand without acting (trebuchet cooldown 160 + slack). */
export const STALL_TICKS = 300;

const SOLDIERS = ['spearman', 'swordsman', 'archer', 'horseman', 'lancer', 'cataphract', 'batteringRam', 'trebuchet', 'siphonarios'];

/** Build the fuzz match for `seed`. Layout varies with the seed (tree clumps, unit mix, base corners). */
export function createFuzzMatch(seed: number): Sim {
  const rng = createRng(seed ^ 0x5eed);
  const state = createInitialState({ seed, mapSize: FUZZ_MAP, players: [{ civ: 'byzantines' }, { civ: 'byzantines' }], mode: 'conquest' }, registry);
  const W = FUZZ_MAP;
  // Bases in opposite corners: Town Center, Barracks, House, Mill.
  const base = (owner: PlayerId, ox: number, oy: number, dir: number): void => {
    createBuilding(state, 'townCenter', owner, ox, oy, true);
    createBuilding(state, 'barracks', owner, ox + dir * 6, oy, true);
    createBuilding(state, 'house', owner, ox, oy + dir * 6, true);
    createBuilding(state, 'mill', owner, ox + dir * 5, oy + dir * 5, true);
    if (rngInt(rng, 2) === 0) createBuilding(state, 'house', owner, ox + dir * 9, oy + dir * 2, false);
  };
  base(1, 3, 3, 1);
  base(2, W - 7, W - 7, -1);
  // Tree clumps in the middle band (obstacles; some form pockets).
  for (let k = 0; k < 6 + rngInt(rng, 6); k++) {
    const cx = 10 + rngInt(rng, W - 20);
    const cy = 10 + rngInt(rng, W - 20);
    for (let j = 0; j < 4 + rngInt(rng, 8); j++) {
      const tx = cx + rngInt(rng, 4) - 2;
      const ty = cy + rngInt(rng, 4) - 2;
      if (state.entities.some((e) => e.kind !== 'unit' && overlaps(e, tx, ty))) continue;
      createNode(state, 'tree', tx, ty, 100);
    }
  }
  const free = (x: number, y: number): boolean => !state.entities.some((e) => e.kind !== 'unit' && overlaps(e, Math.floor(x), Math.floor(y)));
  const spawn = (owner: PlayerId, type: string, cx: number, cy: number): void => {
    for (let tries = 0; tries < 20; tries++) {
      const x = cx + rngInt(rng, 80) / 10 - 4;
      const y = cy + rngInt(rng, 80) / 10 - 4;
      if (x > 0.5 && y > 0.5 && x < W - 0.5 && y < W - 0.5 && free(x, y)) {
        createUnit(state, type, owner, x, y);
        return;
      }
    }
  };
  for (const [owner, cx, cy] of [
    [1, 12, 12],
    [2, W - 12, W - 12],
  ] as const) {
    for (let i = 0; i < 4; i++) spawn(owner, 'villager', owner === 1 ? 9 : W - 9, owner === 1 ? 9 : W - 9);
    for (let i = 0; i < 10 + rngInt(rng, 6); i++) spawn(owner, SOLDIERS[rngInt(rng, SOLDIERS.length)]!, cx, cy);
  }
  for (const p of state.players) if (p.id !== 0) p.resources = { food: 2000, wood: 2000, gold: 2000, stone: 2000 };
  return simFromState(state, registry);
}

function overlaps(e: Entity, tx: number, ty: number): boolean {
  if (e.kind === 'unit') return false;
  const size = e.kind === 'building' ? registry.building(e.typeId).footprint : registry.node(e.typeId).footprint;
  return tx >= e.tile.tx && tx < e.tile.tx + size && ty >= e.tile.ty && ty < e.tile.ty + size;
}

/** Seeded command source: one random command for a random player on about a third of the ticks. */
export class FuzzCommander {
  private readonly rng: RngState;
  private seq = 1;

  constructor(seed: number) {
    this.rng = createRng((seed * 7919) ^ 0xc0ffee);
  }

  next(sim: Sim): Command[] {
    const r = this.rng;
    const state = sim.state as GameState;
    // Bursts of orders (300 ticks in every 800), then quiet stretches in which the orders play out (stalls show).
    if (rngInt(r, state.tick % 800 < 300 ? 8 : 150) !== 0) return [];
    const player = (1 + rngInt(r, 2)) as PlayerId;
    const own = state.entities.filter((e): e is UnitEntity => e.kind === 'unit' && e.owner === player);
    const enemies = state.entities.filter((e) => e.kind !== 'node' && e.owner !== player && e.owner !== 0);
    const pick = <T>(list: readonly T[]): T | undefined => (list.length === 0 ? undefined : list[rngInt(r, list.length)]);
    const subset = (): EntityId[] => {
      if (own.length === 0) return [];
      const n = 1 + rngInt(r, Math.min(6, own.length));
      const start = rngInt(r, own.length);
      const ids: EntityId[] = [];
      for (let i = 0; i < n; i++) ids.push(own[(start + i * 3) % own.length]!.id);
      return [...new Set(ids)].sort((a, b) => a - b);
    };
    const base = { playerId: player, seq: this.seq++ };
    const point = (): { x: number; y: number } => ({ x: rngInt(r, FUZZ_MAP * 10) / 10, y: rngInt(r, FUZZ_MAP * 10) / 10 });
    const roll = rngInt(r, 1000);
    const unitIds = subset();
    if (unitIds.length === 0 && roll < 990) return [];
    if (roll < 300) {
      const target = pick(enemies);
      if (target === undefined) return [];
      // Siege may only attack buildings: prefer a valid pairing, but let some invalid ones through.
      const ids = target.kind === 'unit' && rngInt(r, 8) !== 0 ? unitIds.filter((id) => !isSiege(state, id)) : unitIds;
      if (ids.length === 0) return [];
      return [{ ...base, type: 'attack', unitIds: ids, targetId: target.id, queue: rngInt(r, 6) === 0 }];
    }
    if (roll < 520) {
      // Mostly towards the enemy (a point near one of its entities), sometimes anywhere.
      const near = rngInt(r, 5) < 3 ? pick(enemies) : undefined;
      const at = near === undefined ? point() : anchor(near);
      const p = {
        x: Math.min(FUZZ_MAP - 0.01, Math.max(0, at.x + rngInt(r, 40) / 10 - 2)),
        y: Math.min(FUZZ_MAP - 0.01, Math.max(0, at.y + rngInt(r, 40) / 10 - 2)),
      };
      return [{ ...base, type: 'attackMove', unitIds, ...p, queue: rngInt(r, 6) === 0 }];
    }
    if (roll < 600) return [{ ...base, type: 'hold', unitIds }];
    if (roll < 680) return [{ ...base, type: 'setStance', unitIds, stance: rngInt(r, 2) === 0 ? 'aggressive' : 'standGround' }];
    if (roll < 760) {
      const damaged = state.entities.filter(
        (e) => e.kind === 'building' && e.owner === player && e.constructed && e.hp < registry.building(e.typeId).combat.hp,
      );
      const b = pick(damaged);
      const villagers = own.filter((u) => u.typeId === 'villager').map((u) => u.id);
      if (b === undefined || villagers.length === 0) return [];
      return [{ ...base, type: 'repair', unitIds: villagers.slice(0, 1 + rngInt(r, villagers.length)), buildingId: b.id, queue: false }];
    }
    if (roll < 880) return [{ ...base, type: 'move', unitIds, ...point(), queue: rngInt(r, 6) === 0 }];
    if (roll < 950) return [{ ...base, type: 'stop', unitIds }];
    if (roll < 990) {
      // Delete: mostly a unit, sometimes a building (never the last Town Center: that is rejected, which is fine too).
      const buildings = state.entities.filter((e) => e.kind === 'building' && e.owner === player);
      const victim = rngInt(r, 4) === 0 ? pick(buildings) : pick(own);
      if (victim === undefined) return [];
      return [{ ...base, type: 'delete', entityIds: [victim.id] }];
    }
    if (roll < 993) return [{ ...base, type: 'attack', unitIds, targetId: 999_999, queue: false }]; // invalid: unknown entity
    // Resign is rare and only late, so most runs fight to the end.
    if (state.tick > 1500) return [{ ...base, type: 'resign' }];
    return [];
  }
}

function anchor(e: Entity): { x: number; y: number } {
  if (e.kind === 'unit') return { x: e.pos.x, y: e.pos.y };
  const size = e.kind === 'building' ? registry.building(e.typeId).footprint : 1;
  return { x: e.tile.tx + size / 2, y: e.tile.ty + size / 2 };
}

function isSiege(state: GameState, id: EntityId): boolean {
  const e = findEntity(state, id);
  return e !== undefined && e.kind === 'unit' && registry.unit(e.typeId).combat.targets === 'buildings';
}

interface Watch {
  /** (unit id, missing target id) seen at the previous check. */
  missing: Set<string>;
  /** Entities seen at hp <= 0 at the previous check. */
  dead: Set<EntityId>;
  /** Per unit with a live attack/attackMove: tick of its last progress, and the fingerprint then. */
  progress: Map<EntityId, { tick: number; key: string }>;
}

function orderIdFields(order: object): [string, number][] {
  const out: [string, number][] = [];
  for (const [k, v] of Object.entries(order)) if (k.endsWith('Id') && typeof v === 'number') out.push([k, v]);
  return out;
}

/** Fingerprint of what counts as progress: position, order identity and phase, attack timing. */
function progressKey(u: UnitEntity): string {
  const o = u.currentOrder!;
  // Order identity only: bookkeeping such as `repathTick` changes while a stuck unit re-requests the same empty path.
  const target = 'targetId' in o ? o.targetId : null;
  const phase = 'phase' in o ? o.phase : '';
  return `${u.pos.x},${u.pos.y}|${o.type}:${phase}:${target}|${u.combat.lastAttackTick}|${u.combat.windup}`;
}

/**
 * Check the invariants after one step. `before` is the state's entity list before the step (ids and kinds),
 * `commands` the commands of that step, `events` its events.
 */
export function checkInvariants(
  sim: Sim,
  watch: Watch,
  before: Map<EntityId, Entity>,
  commands: readonly Command[],
  events: readonly SimEvent[],
): string[] {
  const state = sim.state as GameState;
  const tick = state.tick;
  const bad: string[] = [];
  const ids = new Set(state.entities.map((e) => e.id));

  // 4. Numbers (canonicalJson throws on NaN, Infinity, -0, undefined, class instances).
  try {
    canonicalJson(state);
  } catch (err) {
    bad.push(`t${tick}: canonicalJson threw: ${(err as Error).message}`);
  }
  const nonNegInt = (v: number, what: string): void => {
    if (!Number.isInteger(v) || v < 0) bad.push(`t${tick}: ${what} = ${v}`);
  };
  for (const p of state.players) {
    for (const [k, v] of Object.entries(p.resources)) nonNegInt(v, `p${p.id} ${k}`);
    walkAccumulators(p, `p${p.id}`, (path, v) => bad.push(`t${tick}: ${path} = ${v}`));
  }

  const living = new Map<PlayerId, number>();
  const missingNow = new Set<string>();
  const deadNow = new Set<EntityId>();
  for (const e of state.entities) {
    if (e.kind === 'node') continue;
    walkAccumulators(e, `${e.kind} ${e.id}`, (path, v) => bad.push(`t${tick}: ${path} = ${v}`));
    nonNegInt(e.hp, `${e.kind} ${e.id} hp`);
    const maxHp = e.kind === 'unit' ? sim.query.resolvedStat(e.owner, e.typeId, 'hp') : registry.building(e.typeId).combat.hp;
    if (e.hp > maxHp) bad.push(`t${tick}: ${e.kind} ${e.id} hp ${e.hp} > max ${maxHp}`);
    // 3. Dead entities do not survive a tick.
    if (e.hp <= 0) {
      if (watch.dead.has(e.id)) bad.push(`t${tick}: ${e.kind} ${e.id} (${e.typeId}) at hp 0 survived a tick`);
      deadNow.add(e.id);
    }
    if (e.kind !== 'unit') continue;
    living.set(e.owner, (living.get(e.owner) ?? 0) + registry.unit(e.typeId).popCost);
    if (e.carried !== null) nonNegInt(e.carried.amount, `unit ${e.id} carrying`);
    const o = e.currentOrder;
    if (o === null) {
      watch.progress.delete(e.id);
      continue;
    }
    // 1. No order names a removed entity on two consecutive checks.
    for (const [k, v] of orderIdFields(o)) {
      if (ids.has(v)) continue;
      const key = `${e.id}:${k}:${v}`;
      if (watch.missing.has(key)) bad.push(`t${tick}: unit ${e.id} ${o.type}.${k} names removed entity ${v} for two ticks`);
      missingNow.add(key);
    }
    // 2. Progress for live attack and attack-move orders.
    const liveAttack =
      o.type === 'attackMove' ||
      (o.type === 'attack' &&
        (() => {
          const t = findEntity(state, o.targetId);
          return t !== undefined && t.kind !== 'node' && t.hp > 0;
        })());
    if (!liveAttack || e.hp <= 0) {
      watch.progress.delete(e.id);
      continue;
    }
    const key = progressKey(e);
    const prev = watch.progress.get(e.id);
    if (prev === undefined || prev.key !== key) watch.progress.set(e.id, { tick, key });
    else if (tick - prev.tick > STALL_TICKS) {
      bad.push(
        `t${tick}: unit ${e.id} (${e.typeId}) stood still with ${canonicalJson(o)} since t${prev.tick} at (${e.pos.x.toFixed(2)},${e.pos.y.toFixed(2)})`,
      );
      watch.progress.set(e.id, { tick, key }); // report once per stall
    }
  }
  watch.missing = missingNow;
  watch.dead = deadNow;

  // 5. Population.
  for (const p of state.players) {
    if (p.id === 0) continue;
    if (p.popUsed !== (living.get(p.id) ?? 0)) bad.push(`t${tick}: p${p.id} popUsed ${p.popUsed} != living ${living.get(p.id) ?? 0}`);
  }
  // 5. Removals are deaths or deletes, and the stats move with the death events.
  const deleted = new Set<EntityId>();
  for (const c of commands) if (c.type === 'delete') for (const id of c.entityIds) deleted.add(id);
  const died = new Set<EntityId>();
  for (const ev of events) {
    if (ev.type === 'UnitDied') died.add(ev.unitId);
    if (ev.type === 'BuildingDestroyed') died.add(ev.buildingId);
  }
  for (const [id, e] of before) {
    if (e.kind === 'node' || ids.has(id)) continue;
    if (!died.has(id) && !deleted.has(id)) bad.push(`t${tick}: ${e.kind} ${id} vanished without dying or a delete`);
  }
  return bad;
}

/** Stats deltas from one step's death events, to compare with the players' stats. */
function expectedStatDeltas(events: readonly SimEvent[]): Map<PlayerId, { ul: number; uk: number; bl: number; bd: number }> {
  const m = new Map<PlayerId, { ul: number; uk: number; bl: number; bd: number }>();
  const get = (p: PlayerId): { ul: number; uk: number; bl: number; bd: number } => {
    let v = m.get(p);
    if (v === undefined) m.set(p, (v = { ul: 0, uk: 0, bl: 0, bd: 0 }));
    return v;
  };
  for (const ev of events) {
    if (ev.type === 'UnitDied') {
      get(ev.playerId).ul += 1;
      if (ev.killerPlayerId !== null) get(ev.killerPlayerId).uk += 1;
    } else if (ev.type === 'BuildingDestroyed') {
      get(ev.playerId).bl += 1;
      if (ev.killerPlayerId !== null) get(ev.killerPlayerId).bd += 1;
    }
  }
  return m;
}

function walkAccumulators(obj: object, path: string, report: (path: string, v: number) => void): void {
  for (const [k, v] of Object.entries(obj)) {
    if (!k.endsWith('Accumulator')) continue;
    if (typeof v === 'number') {
      if (!(v >= 0) || !Number.isFinite(v)) report(`${path}.${k}`, v);
    } else if (v !== null && typeof v === 'object') {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (typeof v2 === 'number' && (!(v2 >= 0) || !Number.isFinite(v2))) report(`${path}.${k}.${k2}`, v2);
      }
    }
  }
}

export interface FuzzResult {
  violations: string[];
  /** hashState every 100 ticks (and at the end). */
  hashes: string[];
  finalHash: string;
  /** Some counters to show the run did something. */
  deaths: number;
  buildingsDestroyed: number;
  defeated: number;
  commands: number;
  rejected: number;
}

export interface FuzzOptions {
  ticks: number;
  /** Replace the sim by `deserialize(serialize(sim))` before this tick. */
  saveLoadAt?: number;
  /** Check invariants (default true; off for a pure hash run). */
  check?: boolean;
}

/** Run one fuzz match. */
export function runFuzz(seed: number, opts: FuzzOptions): FuzzResult {
  let sim = createFuzzMatch(seed);
  const commander = new FuzzCommander(seed);
  const watch: Watch = { missing: new Set(), dead: new Set(), progress: new Map() };
  const violations: string[] = [];
  const hashes: string[] = [];
  let deaths = 0;
  let buildingsDestroyed = 0;
  let commandCount = 0;
  let rejected = 0;
  const check = opts.check ?? true;
  for (let i = 0; i < opts.ticks; i++) {
    if (opts.saveLoadAt === sim.state.tick) sim = deserialize(serialize(sim), registry);
    const commands = commander.next(sim);
    commandCount += commands.length;
    const before = check ? new Map(sim.state.entities.map((e) => [e.id, e as Entity])) : new Map<EntityId, Entity>();
    const statsBefore = sim.state.players.map((p) => ({
      ul: p.stats.unitsLost,
      uk: p.stats.unitsKilled,
      bl: p.stats.buildingsLost,
      bd: p.stats.buildingsDestroyed,
    }));
    const events = sim.step(commands);
    for (const ev of events) {
      if (ev.type === 'UnitDied' || ev.type === 'BuildingDestroyed') deaths++;
      if (ev.type === 'BuildingDestroyed') buildingsDestroyed++;
      if (ev.type === 'CommandRejected') rejected++;
    }
    if (check) {
      violations.push(...checkInvariants(sim, watch, before, commands, events));
      const exp = expectedStatDeltas(events);
      for (const p of sim.state.players) {
        if (p.id === 0) continue;
        const e = exp.get(p.id) ?? { ul: 0, uk: 0, bl: 0, bd: 0 };
        const b = statsBefore[p.id]!;
        const got = {
          ul: p.stats.unitsLost - b.ul,
          uk: p.stats.unitsKilled - b.uk,
          bl: p.stats.buildingsLost - b.bl,
          bd: p.stats.buildingsDestroyed - b.bd,
        };
        if (got.ul !== e.ul || got.uk !== e.uk || got.bl !== e.bl || got.bd !== e.bd) {
          violations.push(`t${sim.state.tick}: p${p.id} stats moved ${JSON.stringify(got)}, death events say ${JSON.stringify(e)}`);
        }
      }
      for (const ev of events) {
        if ((ev.type === 'UnitDied' || ev.type === 'BuildingDestroyed') && ev.killerPlayerId === ev.playerId) {
          violations.push(`t${sim.state.tick}: ${ev.type} credited to its own owner p${ev.playerId}`);
        }
      }
      if (violations.length > 50) break;
    }
    if (sim.state.tick % 100 === 0) hashes.push(hashState(sim.state));
  }
  const finalHash = hashState(sim.state);
  hashes.push(finalHash);
  const defeated = sim.state.players.filter((p) => p.defeatedTick !== null).length;
  return { violations, hashes, finalHash, deaths, buildingsDestroyed, defeated, commands: commandCount, rejected };
}
