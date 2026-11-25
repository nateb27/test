/**
 * Runs the economy bot on the real sim and records what the balance report and the pacing test need:
 * age timings, stuck units, negative resources, income and population samples, the command log.
 */

import { EconomyBot } from '../../src/bot';
import { registry } from '../../src/data';
import { createGame } from '../../src/sim';
import {
  RESOURCE_TYPES,
  TICK_RATE,
  type Command,
  type GameConfig,
  type ResourceAmounts,
  type ReadonlyEntity,
  type Sim,
  type SimEvent,
  type UnitEntity,
} from '../../src/sim/types';

export const ME = 1;
/** A unit that wants to move but has not changed position for this long is stuck (plan 9.1). */
export const STUCK_TICKS = 30 * TICK_RATE;

export interface StuckReport {
  unitId: number;
  order: string;
  phase: string;
  x: number;
  y: number;
  sinceTick: number;
}

export interface Sample {
  minute: number;
  villagers: number;
  popUsed: number;
  popCap: number;
  stock: ResourceAmounts;
  /** Gathered in the minute before this sample (approximate: positive stockpile steps per tick). */
  income: ResourceAmounts;
  /** Villagers by what they are doing. */
  byTask: Record<string, number>;
}

export interface BotRun {
  seed: number;
  sim: Sim;
  bot: EconomyBot;
  /** Game seconds at which each age was reached (index = age). */
  ageSeconds: Record<number, number>;
  stuck: StuckReport[];
  negativeResource: { tick: number; resources: ResourceAmounts } | null;
  samples: Sample[];
  rejections: SimEvent[];
  idleVillagerSeconds: number;
  /** Villagers idle for 5+ seconds in a row: [seconds, unit id]. */
  longIdle: [number, number][];
  /** Sim invariants the bot's play should never break (node slots, gather slots, abandoned foundations). */
  violations: string[];
  /** Seconds the Town Center queue spent empty / researching / held at the population cap, per age. */
  tcTime: Record<number, { idle: number; research: number; held: number; train: number }>;
  log: Map<number, Command[]>;
  endSeconds: number;
}

export interface RunOptions {
  /** Stop when this age is reached (default 4) or at `maxSeconds`. */
  untilAge?: number;
  maxSeconds?: number;
  mapSize?: number;
  sampleSeconds?: number;
  /** Called after every step (debug hooks). */
  onTick?: (sim: Sim) => void;
}

function isMoving(u: UnitEntity): boolean {
  const o = u.currentOrder;
  if (o === null) return false;
  if (u.pendingPathRequestId !== null) return true;
  switch (o.type) {
    case 'gather':
      return o.phase === 'toNode' || o.phase === 'toDropOff';
    case 'build':
    case 'assist':
      return o.phase === 'toSite';
    case 'move':
    case 'dropOff':
      return o.phase === 'walking';
  }
}

export function playBot(seed: number, opts: RunOptions = {}): BotRun {
  const config: GameConfig = { seed, mapSize: opts.mapSize ?? 120, players: [{ civ: 'byzantines' }] };
  const sim = createGame(config);
  const bot = new EconomyBot(ME);
  const untilAge = opts.untilAge ?? 4;
  const maxTicks = (opts.maxSeconds ?? 30 * 60) * TICK_RATE;
  const run: BotRun = {
    seed,
    sim,
    bot,
    ageSeconds: { 1: 0 },
    stuck: [],
    negativeResource: null,
    samples: [],
    rejections: [],
    idleVillagerSeconds: 0,
    longIdle: [],
    violations: [],
    tcTime: {},
    log: new Map(),
    endSeconds: 0,
  };
  const lastPos = new Map<number, { x: number; y: number; since: number }>();
  const reported = new Set<number>();
  const idleSince = new Map<number, number>();
  const foundationSince = new Map<number, number>();
  const prev: ResourceAmounts = { ...sim.state.players[ME]!.resources };
  const income: ResourceAmounts = { food: 0, wood: 0, gold: 0, stone: 0 };

  while (sim.state.tick < maxTicks) {
    const commands = bot.update(sim);
    if (commands.length > 0) run.log.set(sim.state.tick, commands);
    const events = sim.step(commands);
    for (const e of events) {
      if (e.type === 'AgeAdvanced' && e.playerId === ME) run.ageSeconds[e.age] = sim.state.tick / TICK_RATE;
      if (e.type === 'CommandRejected') run.rejections.push(e);
    }
    opts.onTick?.(sim);
    const tick = sim.state.tick;
    const player = sim.state.players[ME]!;
    for (const r of RESOURCE_TYPES) {
      if (player.resources[r] < 0 && run.negativeResource === null) run.negativeResource = { tick, resources: { ...player.resources } };
      const delta = player.resources[r] - prev[r];
      if (delta > 0) income[r] += delta;
      prev[r] = player.resources[r];
    }
    for (const e of sim.state.entities) {
      if (e.kind !== 'unit' || e.owner !== ME) continue;
      const u = e as UnitEntity;
      const last = lastPos.get(u.id);
      if (last === undefined || !isMoving(u) || Math.abs(last.x - u.pos.x) > 1e-6 || Math.abs(last.y - u.pos.y) > 1e-6) {
        lastPos.set(u.id, { x: u.pos.x, y: u.pos.y, since: tick });
      } else if (tick - last.since > STUCK_TICKS && !reported.has(u.id)) {
        reported.add(u.id);
        run.stuck.push({
          unitId: u.id,
          order: u.currentOrder?.type ?? 'none',
          phase: u.currentOrder !== null && 'phase' in u.currentOrder ? u.currentOrder.phase : '',
          x: u.pos.x,
          y: u.pos.y,
          sinceTick: last.since,
        });
      }
    }
    if (tick % TICK_RATE === 0) {
      checkInvariants(sim, run.violations, foundationSince);
      const tc = sim.state.entities.find((e) => e.kind === 'building' && e.owner === ME && e.typeId === 'townCenter');
      if (tc !== undefined && tc.kind === 'building') {
        const bucket = (run.tcTime[player.age] ??= { idle: 0, research: 0, held: 0, train: 0 });
        const head = tc.queue[0];
        if (head === undefined) bucket.idle++;
        else if (head.kind === 'tech') bucket.research++;
        else if (head.ticksDone >= head.ticksTotal) bucket.held++;
        else bucket.train++;
      }
      for (const e of sim.state.entities) {
        if (e.kind === 'unit' && e.owner === ME && e.typeId === 'villager' && e.currentOrder === null && e.orderQueue.length === 0) {
          run.idleVillagerSeconds++;
          const since = idleSince.get(e.id);
          if (since === undefined) idleSince.set(e.id, tick);
          else if (tick - since === 5 * TICK_RATE) run.longIdle.push([tick / TICK_RATE, e.id]);
        } else if (e.kind === 'unit' && e.owner === ME) idleSince.delete(e.id);
      }
    }
    if (tick % ((opts.sampleSeconds ?? 60) * TICK_RATE) === 0) {
      const byTask: Record<string, number> = {};
      let villagers = 0;
      for (const e of sim.state.entities) {
        if (e.kind !== 'unit' || e.owner !== ME || e.typeId !== 'villager') continue;
        villagers++;
        const o = e.currentOrder;
        let key = 'idle';
        if (o !== null) {
          key = o.type === 'gather' ? `gather.${o.resource}` : o.type;
        }
        byTask[key] = (byTask[key] ?? 0) + 1;
      }
      run.samples.push({
        minute: tick / TICK_RATE / 60,
        villagers,
        popUsed: player.popUsed,
        popCap: player.popCap,
        stock: { ...player.resources },
        income: { ...income },
        byTask,
      });
      for (const r of RESOURCE_TYPES) income[r] = 0;
    }
    if (player.age >= untilAge) break;
  }
  run.endSeconds = sim.state.tick / TICK_RATE;
  return run;
}

export function fmtTime(seconds: number | undefined): string {
  if (seconds === undefined) return 'never';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** A foundation nobody works on for this long counts as abandoned. */
const ABANDONED_TICKS = 40 * TICK_RATE;

function checkInvariants(sim: Sim, out: string[], foundationSince: Map<number, number>): void {
  if (out.length > 20) return;
  const tick = sim.state.tick;
  const byId = new Map<number, ReadonlyEntity>();
  for (const e of sim.state.entities) byId.set(e.id, e);
  for (const e of sim.state.entities) {
    if (e.kind === 'node') {
      const max = registry.node(e.typeId).maxGatherers;
      if (e.gathererIds.length > max) out.push(`t${tick}: node ${e.id} (${e.typeId}) has ${e.gathererIds.length} gatherers, max ${max}`);
    } else if (e.kind === 'unit' && e.owner === ME && e.currentOrder?.type === 'gather' && e.currentOrder.phase === 'harvesting') {
      const target = byId.get(e.currentOrder.targetId);
      if (target !== undefined && target.kind !== 'unit' && !target.gathererIds.includes(e.id)) {
        out.push(`t${tick}: unit ${e.id} harvests ${target.typeId} ${target.id} without holding its slot`);
      }
    } else if (e.kind === 'building' && e.owner === ME && !e.constructed) {
      const last = foundationSince.get(e.id);
      if (e.builderIds.length > 0 || last === undefined) foundationSince.set(e.id, tick);
      else if (tick - last > ABANDONED_TICKS) {
        out.push(`t${tick}: foundation ${e.id} (${e.typeId}) has had no builder since t${last}`);
        foundationSince.set(e.id, tick);
      }
    }
  }
}
