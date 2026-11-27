/**
 * The computer opponent (PLAN-M2 6): cadence, memory, stamping, save/restore. Owned by WP26 (AI).
 *
 * A command source only: it reads `sim.state` and `sim.query`, returns stamped `Command`s and never writes state. It
 * decides on ticks where `(tick + playerId * 7) % interval === 0` (the interval comes from the difficulty table) and
 * returns nothing on other ticks. Its randomness is its own sfc32 stream in memory (never `state.rng`), and it gets no
 * resource or vision bonus at any difficulty.
 *
 * Each decision runs the layers in this order (later layers see what earlier ones committed):
 *   1. upkeep: a lost Town Center first; desired-building bookkeeping
 *   2. defence (threats, defenders, villagers)
 *   3. repair, rebuild, unstaffed foundations, Houses for the army
 *   4. military buildings
 *   5. economy (at most once per game second, with the army reserve)
 *   6. army production, upgrades, rally points
 *   7. waves
 */

import { registry, type DataRegistry } from '../../data';
import { SaveError, type AiDifficulty, type Command, type ControllerSave, type PlayerId, type Sim } from '../../sim';
import type { Controller } from '../controller';
import { readView } from '../view';
import { runArmy, unstick } from './army';
import { AiDecision, type AiOptions } from './context';
import { runDefence } from './defence';
import { DIFFICULTY } from './difficulty';
import { economyDue, runEconomy } from './economy';
import { initialMemory, memoryToJson, parseMemory, type AiMemory } from './memory';
import { buildMilitary, research, setRallies, trainArmy } from './military';
import { PowerTable } from './power';
import { readWorld } from './world';
import { houses, noteBuildings, rebuild, rebuildCenter, repair, staffFoundations } from './upkeep';

export type { AiOptions } from './context';

/** Decision cost record (operations; diagnostics only, never saved). */
export interface AiCostStats {
  decisions: number;
  totalOps: number;
  maxOps: number;
  lastOps: number;
}

const DIFFICULTIES: readonly AiDifficulty[] = ['easy', 'standard', 'hard'];

export class AiPlayer implements Controller {
  /** Operation counts of the decisions made by this instance (not saved). */
  readonly cost: AiCostStats = { decisions: 0, totalOps: 0, maxOps: 0, lastOps: 0 };

  private constructor(
    readonly playerId: PlayerId,
    readonly difficulty: AiDifficulty,
    private readonly mem: AiMemory,
    private readonly options: AiOptions,
    private readonly data: DataRegistry,
  ) {}

  /** A fresh AI for `playerId`; its own rng stream is seeded from `seed` and `playerId` (PLAN-M2 6.2). */
  static create(playerId: PlayerId, difficulty: AiDifficulty, seed: number, options: AiOptions = {}, data: DataRegistry = registry): AiPlayer {
    if (!DIFFICULTIES.includes(difficulty)) throw new Error(`unknown AI difficulty ${String(difficulty)}`);
    return new AiPlayer(playerId, difficulty, initialMemory(seed, playerId), options, data);
  }

  /** Rebuild from a save. Throws `SaveError('corrupt')` on bad memory. */
  static restore(save: ControllerSave, options: AiOptions = {}, data: DataRegistry = registry): AiPlayer {
    if (save.kind !== 'ai') throw new SaveError('corrupt', 'This save is damaged: an AI controller is of an unknown kind');
    if (!DIFFICULTIES.includes(save.difficulty)) throw new SaveError('corrupt', 'This save is damaged: an AI controller has an unknown difficulty');
    if (!Number.isInteger(save.playerId) || save.playerId < 1) throw new SaveError('corrupt', 'This save is damaged: an AI controller has a bad player');
    return new AiPlayer(save.playerId, save.difficulty, parseMemory(save.memory), options, data);
  }

  /** Read-only view of the memory (tests and the debug hook). */
  get memory(): Readonly<AiMemory> {
    return this.mem;
  }

  /** Tick of the first wave launch, or null (PLAN-M2 6.2). */
  get firstWaveTick(): number | null {
    return this.mem.firstWaveTick;
  }

  /** Is `tick` one of this AI's decision ticks? */
  isDecisionTick(tick: number): boolean {
    return (tick + this.playerId * 7) % DIFFICULTY[this.difficulty].decisionInterval === 0;
  }

  update(sim: Sim): Command[] {
    const state = sim.state;
    if (!this.isDecisionTick(state.tick)) return [];
    const player = state.players[this.playerId];
    if (player === undefined || player.outcome !== 'playing' || state.match.endedTick !== null) return [];

    const ops = { n: 0 };
    const mem = this.mem;
    const powers = new PowerTable(sim.query, this.data);
    const world = readWorld(sim, this.playerId, this.data, powers, ops);
    const view = readView(sim, this.playerId, this.data);
    ops.n += state.entities.length;
    if (mem.homeX < 0 && world.tc !== null) {
      mem.homeX = world.tc.cx;
      mem.homeY = world.tc.cy;
    }
    const d = new AiDecision(sim, this.playerId, DIFFICULTY[this.difficulty], mem, this.data, world, view, powers, ops, this.options);
    // The army bank starts with the first Barracks, but not before the Township advance is clicked: in the Founding
    // Age food is the bottleneck and every coin goes to villagers and the advance (BALANCE.md).
    const advancing = world.tc !== null && world.tc.queuedTechs.length > 0;
    const armyStarted = (world.age >= 2 || advancing) && world.buildings.some((b) => b.typeId === 'barracks' && b.constructed);
    d.creditBank(player.stats.resourcesGathered, armyStarted);

    noteBuildings(d);
    rebuildCenter(d);
    const defending = runDefence(d);
    repair(d);
    rebuild(d);
    staffFoundations(d);
    houses(d);
    buildMilitary(d);
    if (economyDue(d)) runEconomy(d);
    trainArmy(d);
    research(d);
    setRallies(d);
    runArmy(d, defending);
    unstick(d);
    mem.decisions++;

    const cost = this.cost;
    cost.decisions++;
    cost.totalOps += ops.n;
    cost.lastOps = ops.n;
    if (ops.n > cost.maxOps) cost.maxOps = ops.n;
    return d.cmds.map((c) => ({ ...c, playerId: this.playerId, seq: mem.seq++ }) as Command);
  }

  save(): ControllerSave {
    return { playerId: this.playerId, kind: 'ai', difficulty: this.difficulty, memory: memoryToJson(this.mem) };
  }
}
