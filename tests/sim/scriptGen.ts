/**
 * Deterministic script generator for the long-run determinism tests (WP12).
 *
 * `generateScript` plays one player through the public sim API (`sim.state`,
 * `sim.query`, `sim.step`) and records every command it issues. Choices come
 * from a seeded PRNG (`createRng(scriptSeed)`, separate from the sim's own)
 * and only ever pick commands the sim reports as valid (availability,
 * canPlace), apart from a sprinkling of deliberately invalid ones. The same
 * `(config, ticks, scriptSeed)` always yields the same log.
 *
 * It exercises gathering, building, training (including a pop-capped queue),
 * research and all four ages, rally points, moves, stops, drop-offs,
 * cancelling queue items and construction, deleting units and buildings, and
 * the cheat commands.
 */

import { registry } from '../../src/data';
import { CommandRecorder, createGame, hashState, type CommandLog } from '../../src/sim';
import { createRng, rngInt } from '../../src/sim/rng';
import { MAX_PRODUCTION_QUEUE } from '../../src/sim/types';
import {
  type BuildingEntity,
  type Command,
  type CommandInput,
  type EntityId,
  type GameConfig,
  type ResourceNodeEntity,
  type ResourceType,
  type RngState,
  type Sim,
  type SimEvent,
  type UnitEntity,
} from '../../src/sim/types';

const ME = 1;

export interface ScriptRun {
  log: CommandLog;
  /** `[tick, hash]` every `hashEvery` ticks of the live run. */
  hashes: [number, string][];
  /** Counts of command types in the log. */
  commandCounts: Record<string, number>;
  /** Counts of event types of the live run. */
  eventCounts: Record<string, number>;
  /** Highest age reached by player 1. */
  age: number;
  finalHash: string;
}

class Agent {
  readonly rng: RngState;
  private seq = 1;
  private out: Command[] = [];

  constructor(
    private readonly sim: Sim,
    seed: number,
  ) {
    this.rng = createRng(seed);
  }

  private pick<T>(list: readonly T[]): T | undefined {
    return list.length === 0 ? undefined : list[rngInt(this.rng, list.length)];
  }

  private chance(percent: number): boolean {
    return rngInt(this.rng, 1000) < percent * 10;
  }

  private issue(input: CommandInput): void {
    this.out.push({ ...input, playerId: ME, seq: this.seq++ } as Command);
  }

  private get player() {
    return this.sim.state.players[ME]!;
  }

  private mine<K extends 'unit' | 'building'>(kind: K): (K extends 'unit' ? UnitEntity : BuildingEntity)[] {
    return this.sim.state.entities.filter((e) => e.kind === kind && e.owner === ME) as never;
  }

  private nodes(): ResourceNodeEntity[] {
    return this.sim.state.entities.filter((e) => e.kind === 'node' && e.amount > 0) as ResourceNodeEntity[];
  }

  /** The commands for the step that runs when `state.tick === tick`. */
  decide(tick: number): Command[] {
    this.out = [];
    if (tick % 10 === 0) this.think(tick);
    return this.out;
  }

  private think(tick: number): void {
    const buildings = this.mine('building');
    const units = this.mine('unit');
    const tc = buildings.find((b) => b.typeId === 'townCenter');
    if (tc === undefined) return;
    const centre = { x: tc.tile.tx + 2, y: tc.tile.ty + 2 };

    // Resources arrive by cheat now and then so every age is reachable inside the run.
    if (tick % 400 === 0) {
      this.issue({ type: 'cheat', cheat: { kind: 'addResources', amounts: { food: 700, wood: 700, gold: 350, stone: 250 } } });
    }
    if (tick > 0 && tick % 3000 === 0) this.issue({ type: 'cheat', cheat: { kind: 'instantBuild', enabled: true } });
    if (tick > 0 && tick % 3000 === 100) this.issue({ type: 'cheat', cheat: { kind: 'instantBuild', enabled: false } });
    if (tick > 0 && tick % 7000 === 0) this.issue({ type: 'cheat', cheat: { kind: 'instantResearch', enabled: true } });
    if (tick > 0 && tick % 7000 === 60) this.issue({ type: 'cheat', cheat: { kind: 'instantResearch', enabled: false } });
    if (tick > 0 && tick % 5000 === 0) {
      this.issue({ type: 'cheat', cheat: { kind: 'spawnUnit', unitType: 'villager', x: centre.x + 5.5, y: centre.y + 5.5 } });
    }

    this.putIdleVillagersToWork(units, centre);
    this.train(buildings, units);
    this.build(tick, buildings, units, centre);
    this.research(buildings);
    this.mischief(buildings, units);
  }

  private putIdleVillagersToWork(units: UnitEntity[], centre: { x: number; y: number }): void {
    const idle = units.filter(
      (u) => u.typeId === 'villager' && u.currentOrder === null && u.orderQueue.length === 0 && u.pendingPathRequestId === null,
    );
    if (idle.length === 0) return;
    const wants: ResourceType[] = ['wood', 'food', 'food', 'wood', 'gold', 'stone'];
    const farms = this.mine('building').filter((b) => b.typeId === 'farm' && b.constructed && b.gathererIds.length === 0);
    const nodes = this.nodes();
    for (const u of idle.slice(0, 6)) {
      const want = this.pick(wants) as ResourceType;
      if (want === 'food' && farms.length > 0 && this.chance(60)) {
        const farm = farms.shift() as BuildingEntity;
        this.issue({ type: 'gather', unitIds: [u.id], nodeId: farm.id, queue: false });
        continue;
      }
      const candidates = nodes
        .filter((n) => registry.node(n.typeId).resource === want && n.gathererIds.length < registry.node(n.typeId).maxGatherers)
        .map((n) => ({ n, d: (n.tile.tx - u.pos.x) ** 2 + (n.tile.ty - u.pos.y) ** 2 }))
        .sort((a, b) => a.d - b.d || a.n.id - b.n.id)
        .slice(0, 4);
      const choice = this.pick(candidates);
      if (choice !== undefined) this.issue({ type: 'gather', unitIds: [u.id], nodeId: choice.n.id, queue: false });
    }
    // A few idle villagers wander (and later get put to work again).
    if (this.chance(8)) {
      const u = this.pick(idle) as UnitEntity;
      this.issue({ type: 'move', unitIds: [u.id], x: centre.x + rngInt(this.rng, 14) - 7 + 0.5, y: centre.y + rngInt(this.rng, 14) - 7 + 0.5, queue: false });
    }
  }

  private train(buildings: BuildingEntity[], units: UnitEntity[]): void {
    const villagers = units.filter((u) => u.typeId === 'villager').length;
    for (const b of buildings) {
      if (!b.constructed) continue;
      const def = registry.building(b.typeId);
      if (def.trains.length === 0 || b.queue.length >= 4) continue;
      const room = this.player.popCap - this.player.popUsed;
      // Mostly respect the cap; sometimes queue past it so items hold at 100%.
      if (room <= 0 && !this.chance(4)) continue;
      const options = def.trains.filter((id) => {
        if (id === 'villager' && villagers >= 70) return false;
        if (id !== 'villager' && units.length >= 140) return false;
        const av = this.sim.query.availability(ME, id);
        return av.available && av.affordable;
      });
      const choice = this.pick(options);
      if (choice !== undefined && this.chance(55)) this.issue({ type: 'train', buildingId: b.id, unitType: choice });
    }
  }

  private build(tick: number, buildings: BuildingEntity[], units: UnitEntity[], centre: { x: number; y: number }): void {
    if (tick % 30 !== 0 || buildings.length >= 70) return;
    const pending = buildings.filter((b) => !b.constructed).length;
    if (pending >= 3) return;
    const villagers = units.filter((u) => u.typeId === 'villager');
    if (villagers.length === 0) return;
    const ownedTypes = new Set(buildings.map((b) => b.typeId));
    const needHouse = this.player.popCap - this.player.popUsed < 6 && buildings.filter((b) => b.typeId === 'house' && !b.constructed).length === 0;
    const buildable = registry.buildings.filter((b) => b.buildable && this.sim.query.availability(ME, b.id).available);
    let type: string | undefined;
    if (needHouse) type = 'house';
    else {
      const fresh = buildable.filter((b) => !ownedTypes.has(b.id) && b.countsTowardAge);
      type = fresh.length > 0 && this.chance(70) ? (this.pick(fresh) as { id: string }).id : (this.pick(buildable) as { id: string } | undefined)?.id;
    }
    if (type === undefined) return;
    const av = this.sim.query.availability(ME, type);
    if (!av.affordable) return;
    const spot = this.spotNear(type, centre.x, centre.y, 3 + rngInt(this.rng, 12));
    if (spot === null) return;
    const count = 1 + rngInt(this.rng, 3);
    const builders = villagers
      .map((v) => ({ v, d: (v.pos.x - spot.tx) ** 2 + (v.pos.y - spot.ty) ** 2 }))
      .sort((a, b) => a.d - b.d || a.v.id - b.v.id)
      .slice(0, count)
      .map((e) => e.v.id);
    this.issue({ type: 'build', unitIds: builders, buildingType: type, tx: spot.tx, ty: spot.ty, queue: false });
  }

  /** A free spot (with a one-tile margin so buildings never wall each other in) on a ring around the centre. */
  private spotNear(type: string, cx: number, cy: number, minRing: number): { tx: number; ty: number } | null {
    const size = registry.building(type).footprint;
    const w = this.sim.state.map.width;
    const taken = new Set<number>();
    for (const e of this.sim.state.entities) {
      if (e.kind === 'unit') continue;
      const def = registry.def(e.typeId);
      const s = def !== undefined && (def.kind === 'building' || def.kind === 'node') ? def.footprint : 1;
      for (let y = e.tile.ty; y < e.tile.ty + s; y++) for (let x = e.tile.tx; x < e.tile.tx + s; x++) taken.add(y * w + x);
    }
    for (let r = minRing; r < 36; r++) {
      const offset = rngInt(this.rng, 8 * r + 1);
      const ring: { dx: number; dy: number }[] = [];
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) ring.push({ dx, dy });
      for (let k = 0; k < ring.length; k++) {
        const { dx, dy } = ring[(k + offset) % ring.length] as { dx: number; dy: number };
        const tx = Math.round(cx + dx - size / 2);
        const ty = Math.round(cy + dy - size / 2);
        if (tx < 3 || ty < 3 || tx + size > w - 3 || ty + size > w - 3) continue;
        let free = true;
        for (let y = ty - 1; y <= ty + size && free; y++) {
          for (let x = tx - 1; x <= tx + size; x++) {
            if (taken.has(y * w + x)) {
              free = false;
              break;
            }
          }
        }
        if (free && this.sim.query.canPlace(ME, type, tx, ty).ok) return { tx, ty };
      }
    }
    return null;
  }

  private research(buildings: BuildingEntity[]): void {
    for (const b of buildings) {
      if (!b.constructed || b.queue.length >= MAX_PRODUCTION_QUEUE || !this.chance(30)) continue;
      const def = registry.building(b.typeId);
      const options = def.researches.filter((id) => {
        const av = this.sim.query.availability(ME, id);
        return av.available && av.affordable;
      });
      // Age advances first: they are the long pole. They go into any queue with room, because since
      // WP13 (population counts living units only) villager queues are rarely short.
      const age = options.find((id) => registry.def(id)?.kind === 'tech' && registry.tech(id).advancesTo !== undefined);
      if (age === undefined && b.queue.length > 1) continue;
      const choice = age ?? this.pick(options);
      if (choice !== undefined) this.issue({ type: 'research', buildingId: b.id, techId: choice });
    }
  }

  /** Cancels, deletes, rally points, stops, drop-offs and a few invalid commands. */
  private mischief(buildings: BuildingEntity[], units: UnitEntity[]): void {
    const trainers = buildings.filter((b) => b.constructed && registry.building(b.typeId).trains.length > 0);
    if (this.chance(6)) {
      const b = this.pick(trainers);
      if (b !== undefined) {
        const nodes = this.nodes();
        const node = this.chance(50) ? this.pick(nodes) : undefined;
        if (node !== undefined) {
          this.issue({ type: 'setRally', buildingIds: [b.id], x: node.tile.tx + 0.5, y: node.tile.ty + 0.5, targetId: node.id });
        } else {
          this.issue({ type: 'setRally', buildingIds: [b.id], x: b.tile.tx + 6.5, y: b.tile.ty + 6.5 });
        }
      }
    }
    if (this.chance(5)) {
      const queued = buildings.filter((b) => b.queue.length > 0);
      const b = this.pick(queued);
      if (b !== undefined) this.issue({ type: 'cancelQueue', buildingId: b.id, index: rngInt(this.rng, b.queue.length) });
    }
    if (this.chance(4)) {
      const unfinished = buildings.filter((b) => !b.constructed);
      const b = this.pick(unfinished);
      if (b !== undefined) this.issue(this.chance(60) ? { type: 'cancelConstruction', buildingId: b.id } : { type: 'delete', entityIds: [b.id] });
    }
    if (this.chance(2)) {
      const deletable = buildings.filter((b) => b.typeId !== 'townCenter');
      const b = this.pick(deletable);
      if (b !== undefined) this.issue({ type: 'delete', entityIds: [b.id] });
    }
    if (this.chance(2)) {
      const u = this.pick(units);
      if (u !== undefined && units.length > 12) this.issue({ type: 'delete', entityIds: [u.id] });
    }
    if (this.chance(4)) {
      const group = units.filter(() => this.chance(10)).slice(0, 12);
      if (group.length > 0) this.issue({ type: 'stop', unitIds: group.map((u) => u.id) });
    }
    if (this.chance(4)) {
      const carrying = units.filter((u) => u.carried !== null);
      const u = this.pick(carrying);
      const drop = buildings.find((b) => b.constructed && registry.building(b.typeId).dropOff.length > 0);
      if (u !== undefined && drop !== undefined) this.issue({ type: 'dropOff', unitIds: [u.id], buildingId: drop.id });
    }
    if (this.chance(3)) {
      const group = units.filter(() => this.chance(8)).slice(0, 20);
      if (group.length > 1) {
        const tcb = buildings.find((b) => b.typeId === 'townCenter') as BuildingEntity;
        this.issue({ type: 'move', unitIds: group.map((u) => u.id), x: tcb.tile.tx + 8 + rngInt(this.rng, 10), y: tcb.tile.ty + 8 + rngInt(this.rng, 10), queue: this.chance(30) });
      }
    }
    // Invalid on purpose: the sim must reject them identically every time.
    if (this.chance(2)) {
      const kind = rngInt(this.rng, 4);
      const u = this.pick(units);
      if (kind === 0) this.issue({ type: 'gather', unitIds: [999_999], nodeId: 1, queue: false });
      else if (kind === 1 && u !== undefined) this.issue({ type: 'train', buildingId: u.id, unitType: 'villager' });
      else if (kind === 2) this.issue({ type: 'build', unitIds: u === undefined ? [1] : [u.id], buildingType: 'house', tx: 0, ty: 0, queue: false });
      else this.issue({ type: 'research', buildingId: buildings[0]?.id ?? 1, techId: 'nonexistentTech' });
    }
  }
}

/**
 * Play `ticks` ticks of a generated game and return the command log with
 * summary counts. The sim is a fresh `createGame(config)`.
 */
export function generateScript(config: GameConfig, ticks: number, scriptSeed: number, hashEvery = 100): ScriptRun {
  const sim = createGame(config);
  const agent = new Agent(sim, scriptSeed);
  const recorder = new CommandRecorder();
  const hashes: [number, string][] = [];
  const commandCounts: Record<string, number> = {};
  const eventCounts: Record<string, number> = {};
  for (let t = 0; t < ticks; t++) {
    const commands = agent.decide(t);
    recorder.record(t, commands);
    for (const c of commands) commandCounts[c.type] = (commandCounts[c.type] ?? 0) + 1;
    const events: SimEvent[] = sim.step(commands);
    for (const e of events) eventCounts[e.type] = (eventCounts[e.type] ?? 0) + 1;
    if ((t + 1) % hashEvery === 0) hashes.push([t + 1, hashState(sim.state)]);
  }
  return {
    log: recorder.log,
    hashes,
    commandCounts,
    eventCounts,
    age: sim.state.players[ME]!.age,
    finalHash: hashState(sim.state),
  };
}

export type { EntityId };
