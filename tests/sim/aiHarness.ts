/**
 * Headless AI matches (PLAN-M2 2.7, 8.1): drives `AiPlayer`s exactly like `Match.tick()` does (commands from every
 * controller, then `sim.step`) and records what the AI tests need: age and first-wave ticks, command counts and
 * rejections per player, stuck units, decision cost, the outcome and a command log.
 */

import { AiPlayer, EconomyBot, type AiOptions, type Controller } from '../../src/bot';
import {
  TICK_RATE,
  createGame,
  deserializeSave,
  hashState,
  serialize,
  type AiDifficulty,
  type Command,
  type CommandRejectedEvent,
  type GameConfig,
  type PlayerConfig,
  type Sim,
  type UnitEntity,
} from '../../src/sim';
import { isMoving, STUCK_TICKS } from './botHarness';

/** What sits in a player slot: an AI difficulty, the M1 economy bot, or nobody (an idle player). */
export type Seat = AiDifficulty | 'economy' | 'idle';

export interface MatchOptions {
  seed: number;
  seats: readonly Seat[];
  /** Stop at this tick (default 30 minutes). */
  maxTicks?: number;
  /** AI command style (default 'combat'; 'move' while combat commands are stubs). */
  orders?: AiOptions['orders'];
  /** Stop once the match has a result (default true). */
  stopOnEnd?: boolean;
  /** Stop once every AI has launched its first wave and reached Age 2. */
  stopAfterFirstWave?: boolean;
  /** Save and restore the sim and every AI through a v2 save file every this many ticks. */
  saveEvery?: number | null;
  /** Record a hash every this many ticks (default none). */
  hashEvery?: number | null;
  /** Record the command log (default false). */
  log?: boolean;
  /** Track units stuck in a moving order (default true). */
  trackStuck?: boolean;
  /** Measure the wall-clock time of each decision (default false). */
  timeDecisions?: boolean;
}

export interface SeatReport {
  playerId: number;
  seat: Seat;
  /** Tick each age was reached (index = age - 1), from the player's stats. */
  ageTicks: (number | null)[];
  firstWaveTick: number | null;
  commands: number;
  rejections: CommandRejectedEvent[];
  stuck: { unitId: number; type: string; order: string; x: number; y: number; sinceTick: number }[];
  /** AI only: operation counts and (if measured) decision times in ms. */
  ops: { decisions: number; total: number; max: number } | null;
  decisionMs: number[];
  outcome: string;
  /** Military units alive at the end. */
  army: number;
  villagers: number;
}

export interface MatchReport {
  seed: number;
  sim: Sim;
  controllers: (Controller | null)[];
  seats: SeatReport[];
  endTick: number;
  winner: number | null;
  hashes: string[];
  log: Command[][];
}

function makeController(seat: Seat, playerId: number, seed: number, orders: AiOptions['orders']): Controller | null {
  if (seat === 'idle') return null;
  if (seat === 'economy') return new EconomyBot(playerId);
  return AiPlayer.create(playerId, seat, seed, { orders });
}

export function matchConfig(seed: number, seats: readonly Seat[]): GameConfig {
  const players: PlayerConfig[] = seats.map((s) =>
    s === 'idle' || s === 'economy' ? { civ: 'byzantines', controller: 'human' } : { civ: 'byzantines', controller: 'ai', difficulty: s },
  );
  return { seed, mapSize: 120, players, mode: seats.length === 2 ? 'conquest' : 'sandbox' };
}

export function playMatch(opts: MatchOptions): MatchReport {
  const maxTicks = opts.maxTicks ?? 30 * 60 * TICK_RATE;
  const orders = opts.orders ?? 'combat';
  let sim = createGame(matchConfig(opts.seed, opts.seats));
  let controllers = opts.seats.map((s, i) => makeController(s, i + 1, opts.seed, orders));
  const seats: SeatReport[] = opts.seats.map((seat, i) => ({
    playerId: i + 1,
    seat,
    ageTicks: [0, null, null, null],
    firstWaveTick: null,
    commands: 0,
    rejections: [],
    stuck: [],
    ops: null,
    decisionMs: [],
    outcome: 'playing',
    army: 0,
    villagers: 0,
  }));
  const hashes: string[] = [];
  const log: Command[][] = [];
  const lastPos = new Map<number, { x: number; y: number; since: number }>();
  const reported = new Set<number>();
  const trackStuck = opts.trackStuck ?? true;
  const opsCarry = seats.map(() => ({ decisions: 0, total: 0, max: 0 }));

  while (sim.state.tick < maxTicks) {
    const cmds: Command[] = [];
    controllers.forEach((c, i) => {
      if (c === null) return;
      const t0 = opts.timeDecisions ? performance.now() : 0;
      const out = c.update(sim);
      if (opts.timeDecisions && c instanceof AiPlayer && c.isDecisionTick(sim.state.tick)) seats[i]!.decisionMs.push(performance.now() - t0);
      seats[i]!.commands += out.length;
      cmds.push(...out);
    });
    if (opts.log) log.push(cmds);
    const events = sim.step(cmds);
    for (const e of events) {
      if (e.type === 'CommandRejected') seats[e.playerId - 1]?.rejections.push(e);
    }
    const tick = sim.state.tick;
    if (opts.hashEvery && tick % opts.hashEvery === 0) hashes.push(hashState(sim.state));
    if (trackStuck) trackUnits(sim, seats, lastPos, reported);
    if (opts.saveEvery && tick % opts.saveEvery === 0) {
      controllers.forEach((c, i) => {
        if (c instanceof AiPlayer) {
          opsCarry[i]!.decisions += c.cost.decisions;
          opsCarry[i]!.total += c.cost.totalOps;
          opsCarry[i]!.max = Math.max(opsCarry[i]!.max, c.cost.maxOps);
        }
      });
      const saves = controllers.flatMap((c) => {
        const s = c?.save();
        return s === null || s === undefined ? [] : [s];
      });
      const loaded = deserializeSave(serialize(sim, saves));
      sim = loaded.sim;
      controllers = controllers.map((c) => {
        if (!(c instanceof AiPlayer)) return c;
        const save = loaded.controllers.find((s) => s.playerId === c.playerId);
        if (save === undefined) throw new Error(`no saved controller for player ${c.playerId}`);
        return AiPlayer.restore(save, { orders });
      });
    }
    if ((opts.stopOnEnd ?? true) && sim.state.match.endedTick !== null) break;
    if (opts.stopAfterFirstWave && tick % TICK_RATE === 0) {
      const done = controllers.every((c) => !(c instanceof AiPlayer) || (c.firstWaveTick !== null && sim.state.players[c.playerId]!.age >= 2));
      if (done) break;
    }
  }

  controllers.forEach((c, i) => {
    const r = seats[i]!;
    const p = sim.state.players[i + 1]!;
    r.ageTicks = [...p.stats.ageReachedTick];
    r.outcome = p.outcome;
    if (c instanceof AiPlayer) {
      r.firstWaveTick = c.firstWaveTick;
      const carry = opsCarry[i]!;
      r.ops = { decisions: carry.decisions + c.cost.decisions, total: carry.total + c.cost.totalOps, max: Math.max(carry.max, c.cost.maxOps) };
    }
  });
  for (const e of sim.state.entities) {
    if (e.kind !== 'unit' || e.owner < 1) continue;
    const r = seats[e.owner - 1];
    if (r === undefined) continue;
    if (e.typeId === 'villager') r.villagers++;
    else r.army++;
  }
  return { seed: opts.seed, sim, controllers, seats, endTick: sim.state.tick, winner: sim.state.match.winner, hashes, log };
}

function trackUnits(
  sim: Sim,
  seats: SeatReport[],
  lastPos: Map<number, { x: number; y: number; since: number }>,
  reported: Set<number>,
): void {
  const tick = sim.state.tick;
  for (const e of sim.state.entities) {
    if (e.kind !== 'unit' || e.owner < 1) continue;
    const r = seats[e.owner - 1];
    if (r === undefined || r.seat === 'idle' || r.seat === 'economy') continue;
    const u = e as Readonly<UnitEntity>;
    const last = lastPos.get(u.id);
    if (last === undefined || !isMoving(u) || Math.abs(last.x - u.pos.x) > 1e-6 || Math.abs(last.y - u.pos.y) > 1e-6) {
      lastPos.set(u.id, { x: u.pos.x, y: u.pos.y, since: tick });
    } else if (tick - last.since > STUCK_TICKS && !reported.has(u.id)) {
      reported.add(u.id);
      r.stuck.push({ unitId: u.id, type: u.typeId, order: u.currentOrder?.type ?? 'none', x: u.pos.x, y: u.pos.y, sinceTick: last.since });
    }
  }
}

export function fmtTick(tick: number | null | undefined): string {
  if (tick === null || tick === undefined) return 'never';
  const s = tick / TICK_RATE;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s - m * 60)).padStart(2, '0')}`;
}

export const MIN = 60 * TICK_RATE;
