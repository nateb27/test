/**
 * Phase 2 integration: the whole economy loop on the real data with no mocks.
 *
 * One headless Byzantine match is played with commands only (the resource
 * cheat is used for speed, never instant-build): gather each resource, build a
 * House, Lumber Camp and Farm, hit the population cap, research, advance
 * through all four ages, train the unique units and build Silk Workshops. The
 * tests run in order and share the match. The last tests replay the recorded
 * command log twice (identical hashes) and once with a save/load in the middle.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { createRegistry, registry } from '../../src/data';
import { createGame, deserialize, hashState, serialize } from '../../src/sim';
import {
  TICK_RATE,
  type BuildingEntity,
  type Command,
  type CommandInput,
  type EntityId,
  type GameConfig,
  type ReadonlyEntity,
  type ResourceNodeEntity,
  type ResourceType,
  type Sim,
  type SimEvent,
  type UnitEntity,
} from '../../src/sim/types';

const CONFIG: GameConfig = { seed: 4242, mapSize: 120, players: [{ civ: 'byzantines' }] };
const ME = 1;
/** Ticks between recorded state hashes (hashing the whole state is not free). */
const CHECKPOINT = 1000;

// ---------------------------------------------------------------------------
// Driver: issues commands, steps the sim, records the command log and events
// ---------------------------------------------------------------------------

class Driver {
  readonly sim: Sim = createGame(CONFIG);
  /** Commands applied at each tick (the value of `state.tick` before the step). */
  readonly log = new Map<number, Command[]>();
  readonly events: SimEvent[] = [];
  /** `hashState` at every multiple of CHECKPOINT ticks. */
  readonly hashes = new Map<number, string>();
  private seq = 1;
  private pending: Command[] = [];

  get tick(): number {
    return this.sim.state.tick;
  }

  issue(input: CommandInput): void {
    this.pending.push({ ...input, playerId: ME, seq: this.seq++ } as Command);
  }

  /** Step `n` ticks; pending commands go into the first. Returns the events of those ticks. */
  run(n: number): SimEvent[] {
    const out: SimEvent[] = [];
    for (let i = 0; i < n; i++) {
      const cmds = this.pending;
      this.pending = [];
      if (cmds.length > 0) this.log.set(this.tick, cmds);
      out.push(...this.sim.step(cmds));
      if (this.tick % CHECKPOINT === 0) this.hashes.set(this.tick, hashState(this.sim.state));
    }
    this.events.push(...out);
    return out;
  }

  /** Step until `done()` or `max` ticks; fails if the condition never holds. */
  until(done: () => boolean, max: number, what: string): void {
    for (let i = 0; i < max; i++) {
      if (done()) return;
      this.run(1);
    }
    if (!done()) throw new Error(`timed out after ${max} ticks waiting for: ${what}`);
  }

  cheat(amounts: Partial<Record<ResourceType, number>>): void {
    this.issue({ type: 'cheat', cheat: { kind: 'addResources', amounts } });
  }

  get player() {
    return this.sim.state.players[ME]!;
  }

  entity(id: EntityId): ReadonlyEntity | undefined {
    return this.sim.query.entityById(id) as ReadonlyEntity | undefined;
  }

  unit(id: EntityId): UnitEntity {
    const e = this.entity(id);
    if (e === undefined || e.kind !== 'unit') throw new Error(`no unit ${id}`);
    return e as UnitEntity;
  }

  building(id: EntityId): BuildingEntity {
    const e = this.entity(id);
    if (e === undefined || e.kind !== 'building') throw new Error(`no building ${id}`);
    return e as BuildingEntity;
  }

  villagers(): UnitEntity[] {
    return this.sim.state.entities.filter(
      (e) => e.kind === 'unit' && e.owner === ME && e.typeId === 'villager',
    ) as UnitEntity[];
  }

  buildings(type: string, constructedOnly = true): BuildingEntity[] {
    return this.sim.state.entities.filter(
      (e) => e.kind === 'building' && e.owner === ME && e.typeId === type && (!constructedOnly || e.constructed),
    ) as BuildingEntity[];
  }

  townCenter(): BuildingEntity {
    return this.buildings('townCenter')[0]!;
  }

  /** Nearest node of a type to a point (ties by id) that no unit is working. */
  nearestNode(typeId: string, x: number, y: number, skip: ReadonlySet<EntityId> = new Set()): ResourceNodeEntity {
    let best: ResourceNodeEntity | null = null;
    let bestD = 0;
    for (const e of this.sim.state.entities) {
      if (e.kind !== 'node' || e.typeId !== typeId || e.amount <= 0 || e.gathererIds.length > 0 || skip.has(e.id)) continue;
      const size = registry.node(e.typeId).footprint;
      const d = Math.hypot(e.tile.tx + size / 2 - x, e.tile.ty + size / 2 - y);
      if (best === null || d < bestD) {
        best = e as ResourceNodeEntity;
        bestD = d;
      }
    }
    if (best === null) throw new Error(`no free ${typeId}`);
    return best;
  }

  /** Tiles taken by buildings and nodes (including non-blocking farms). */
  private taken(): Set<number> {
    const w = this.sim.state.map.width;
    const set = new Set<number>();
    for (const e of this.sim.state.entities) {
      if (e.kind === 'unit') continue;
      const def = registry.def(e.typeId);
      const size = def !== undefined && (def.kind === 'building' || def.kind === 'node') ? def.footprint : 1;
      for (let y = e.tile.ty; y < e.tile.ty + size; y++) for (let x = e.tile.tx; x < e.tile.tx + size; x++) set.add(y * w + x);
    }
    return set;
  }

  /**
   * A valid spot for `type` near (cx, cy): the sim's own `canPlace` says ok and the footprint plus a
   * one-tile margin is free, so buildings never wall each other in. Rings outward from the centre.
   */
  spotNear(type: string, cx: number, cy: number, minRing = 0): { tx: number; ty: number } {
    const size = registry.building(type).footprint;
    const taken = this.taken();
    const w = this.sim.state.map.width;
    for (let r = minRing; r < 40; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = Math.round(cx + dx - size / 2);
          const ty = Math.round(cy + dy - size / 2);
          let free = tx > 2 && ty > 2 && tx + size < w - 2 && ty + size < w - 2;
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
    }
    throw new Error(`no spot for ${type}`);
  }

  /** Place `type` with `builders` near a point, wait until it completes, return it. */
  buildAndWait(type: string, builders: EntityId[], cx: number, cy: number, minRing = 0): BuildingEntity {
    const before = new Set(this.buildings(type, false).map((b) => b.id));
    const { tx, ty } = this.spotNear(type, cx, cy, minRing);
    this.issue({ type: 'build', unitIds: builders, buildingType: type, tx, ty, queue: false });
    this.run(2);
    const placed = this.buildings(type, false).find((b) => !before.has(b.id));
    if (placed === undefined) {
      throw new Error(`${type} was not placed: ${JSON.stringify(this.rejections())}`);
    }
    this.until(() => this.building(placed.id).constructed, 6000, `${type} complete`);
    return this.building(placed.id);
  }

  rejections(): SimEvent[] {
    return this.events.filter((e) => e.type === 'CommandRejected');
  }
}

const d = new Driver();
let tcCentre = { x: 0, y: 0 };

beforeAll(() => {
  const tc = d.townCenter();
  tcCentre = { x: tc.tile.tx + 2, y: tc.tile.ty + 2 };
});

const count = (type: SimEvent['type']): number => d.events.filter((e) => e.type === type).length;

// ---------------------------------------------------------------------------
// The match
// ---------------------------------------------------------------------------

describe('economy loop (real data, commands only)', () => {
  it('starts with a Town Center, six villagers and the plan stockpile', () => {
    expect(d.villagers()).toHaveLength(6);
    expect(d.player.resources).toEqual({ food: 200, wood: 200, gold: 100, stone: 0 });
    expect(d.player.popCap).toBe(10);
    expect(d.player.popUsed).toBe(6);
    expect(d.player.age).toBe(1);
  });

  it('gathers each of the four resources and returns it to the Town Center', () => {
    const vs = d.villagers();
    const picks: { type: string; resource: ResourceType; id: EntityId }[] = [
      { type: 'tree', resource: 'wood', id: d.nearestNode('tree', tcCentre.x, tcCentre.y).id },
      { type: 'berryBush', resource: 'food', id: d.nearestNode('berryBush', tcCentre.x, tcCentre.y).id },
      { type: 'goldDeposit', resource: 'gold', id: d.nearestNode('goldDeposit', tcCentre.x, tcCentre.y).id },
      { type: 'stoneDeposit', resource: 'stone', id: d.nearestNode('stoneDeposit', tcCentre.x, tcCentre.y).id },
    ];
    const start = { ...d.player.resources };
    picks.forEach((p, i) => d.issue({ type: 'gather', unitIds: [vs[i]!.id], nodeId: p.id, queue: false }));
    d.run(2);
    for (const [i, p] of picks.entries()) {
      const order = d.unit(vs[i]!.id).currentOrder;
      expect(order?.type, p.type).toBe('gather');
    }
    d.until(() => picks.every((p) => d.player.resources[p.resource] > start[p.resource]), 4000, 'every resource delivered');
    for (const p of picks) {
      expect(d.player.resources[p.resource] - start[p.resource], p.resource).toBeGreaterThanOrEqual(10);
    }
    // The nodes lost exactly what was taken.
    const node = d.entity(picks[0]!.id) as ResourceNodeEntity;
    expect(node.amount).toBeLessThan(registry.node('tree').amount);
  });

  it('builds a House: +10 population cap, wood spent, event emitted', () => {
    d.cheat({ food: 2000, wood: 2000, gold: 500, stone: 500 });
    d.run(1);
    const before = { cap: d.player.popCap, wood: d.player.resources.wood };
    const builders = d.villagers().slice(4, 6).map((v) => v.id);
    const house = d.buildAndWait('house', builders, tcCentre.x, tcCentre.y, 5);
    expect(house.constructed).toBe(true);
    expect(d.player.popCap).toBe(before.cap + 10);
    // Cost was deducted when the foundation was placed (no income meanwhile except gathering, which only adds).
    expect(d.player.resources.wood).toBeLessThanOrEqual(before.wood - 50 + 200);
    expect(count('BuildingCompleted')).toBeGreaterThanOrEqual(1);
    // Builders are idle (a House gives no follow-up work).
    d.run(3);
    for (const id of builders) expect(d.unit(id).currentOrder).toBeNull();
  });

  it('builds a Lumber Camp next to trees: the builder starts gathering wood on its own', () => {
    const tree = d.nearestNode('tree', tcCentre.x + 10, tcCentre.y + 10);
    const builder = d.villagers()[5]!;
    const camp = d.buildAndWait('lumberCamp', [builder.id], tree.tile.tx + 0.5, tree.tile.ty + 0.5);
    expect(camp.constructed).toBe(true);
    d.run(2);
    const order = d.unit(builder.id).currentOrder;
    expect(order?.type).toBe('gather');
    const target = d.entity((order as { targetId: EntityId }).targetId);
    expect(target?.kind).toBe('node');
    expect(registry.node((target as ResourceNodeEntity).typeId).resource).toBe('wood');
    // And it delivers to the camp: wood rises with the camp as the nearest drop-off.
    const wood = d.player.resources.wood;
    d.until(() => d.player.resources.wood > wood, 3000, 'camp deliveries');
  });

  it('builds a Farm for 20% less (Themata) and the builder works it', () => {
    const av = d.sim.query.availability(ME, 'farm');
    expect(av.cost.wood).toBe(Math.round(registry.building('farm').cost.wood! * 0.8));
    const builder = d.villagers()[4]!;
    const wood = d.player.resources.wood;
    const placedAt = d.tick;
    const farm = d.buildAndWait('farm', [builder.id], tcCentre.x, tcCentre.y, 4);
    expect(wood - d.player.resources.wood).toBeGreaterThanOrEqual(0); // gatherers may add wood meanwhile
    const placed = d.log.get(placedAt)?.find((c) => c.type === 'build');
    expect(placed).toBeDefined();
    d.run(2);
    const order = d.unit(builder.id).currentOrder;
    expect(order?.type).toBe('gather');
    expect((order as { targetId: EntityId }).targetId).toBe(farm.id);
    const food = d.player.resources.food;
    d.until(() => d.player.resources.food > food, 3000, 'farm deliveries');
  });

  it('charges the Themata price when a farm is placed and refunds it on cancel', () => {
    const idle = d.villagers().find((v) => v.currentOrder === null) ?? d.villagers()[0]!;
    const { tx, ty } = d.spotNear('farm', tcCentre.x, tcCentre.y, 4);
    d.issue({ type: 'build', unitIds: [idle.id], buildingType: 'farm', tx, ty, queue: false });
    d.run(1);
    const foundation = d.buildings('farm', false).find((b) => !b.constructed)!;
    expect(foundation.costPaid.wood).toBe(40);
    expect(foundation.costPaid.food + foundation.costPaid.gold + foundation.costPaid.stone).toBe(0);
    d.issue({ type: 'cancelConstruction', buildingId: foundation.id });
    d.run(2);
    expect(d.entity(foundation.id)).toBeUndefined();
  });

  it('trains villagers up to the population cap: the next one holds, a House releases it', () => {
    d.cheat({ food: 3000, wood: 1000 });
    const tc = d.townCenter();
    const cap = d.player.popCap;
    expect(cap).toBe(20); // Town Center + one House
    // Train to the cap in batches (a queue holds 10).
    const queueMore = (): void => {
      const room = cap - d.player.popUsed;
      for (let i = 0; i < Math.min(room, 10 - d.building(tc.id).queue.length); i++) {
        d.issue({ type: 'train', buildingId: tc.id, unitType: 'villager' });
      }
      d.run(1);
    };
    queueMore();
    d.until(
      () => {
        if (d.building(tc.id).queue.length === 0 && d.player.popUsed < cap) queueMore();
        return d.villagers().length === cap;
      },
      30 * 400,
      'population at the cap',
    );
    expect(d.player.popUsed).toBe(cap);
    expect(count('PopulationCapped')).toBe(0); // nothing was ever refused or held yet
    // One more: it is accepted into the queue (cost paid), finishes, and holds.
    d.issue({ type: 'train', buildingId: tc.id, unitType: 'villager' });
    d.run(2);
    expect(d.building(tc.id).queue).toHaveLength(1);
    d.until(() => d.events.some((e) => e.type === 'PopulationCapped'), 25 * TICK_RATE, 'PopulationCapped');
    const held = d.building(tc.id).queue[0]!;
    expect(held.ticksDone).toBe(held.ticksTotal);
    expect((held as { popCapNotified: boolean }).popCapNotified).toBe(true);
    d.run(300);
    expect(d.villagers()).toHaveLength(cap); // still held
    expect(count('PopulationCapped')).toBe(1); // announced once
    expect(d.player.popUsed).toBe(cap); // queued units do not count (plan 4.6)
    // A second House releases it.
    const builders = d.villagers().slice(0, 2).map((v) => v.id);
    d.buildAndWait('house', builders, tcCentre.x, tcCentre.y, 6);
    d.run(5);
    expect(d.player.popCap).toBe(30);
    expect(d.villagers()).toHaveLength(cap + 1);
    expect(d.building(tc.id).queue).toHaveLength(0);
  });

  it('advances through Township Age (needs two age-1 building types) and researches Iron Axes with a measurable gain', () => {
    // The Town Center and House do not count: Lumber Camp and Farm do.
    expect(d.sim.query.availability(ME, 'townshipAge').available).toBe(true);
    const tc = d.townCenter();
    d.issue({ type: 'research', buildingId: tc.id, techId: 'townshipAge' });
    d.run(2);
    d.until(() => d.player.age === 2, 60 * TICK_RATE + 100, 'Township Age');
    expect(d.events.filter((e) => e.type === 'AgeAdvanced')).toHaveLength(1);

    const camp = d.buildings('lumberCamp')[0]!;
    const rateBefore = d.sim.query.resolvedStat(ME, 'villager', 'gatherRate.wood');
    expect(rateBefore).toBeCloseTo(0.4, 9);
    const sample = (): number => measureWoodPerSecond(d, camp);
    const before = sample();
    d.issue({ type: 'research', buildingId: camp.id, techId: 'ironAxes' });
    d.run(2);
    d.until(() => d.player.researched.includes('ironAxes'), 30 * TICK_RATE + 100, 'Iron Axes');
    const rateAfter = d.sim.query.resolvedStat(ME, 'villager', 'gatherRate.wood');
    expect(rateAfter).toBeCloseTo(0.46, 9);
    const after = sample();
    // The real harvest rate in the sim follows: +15%.
    expect(before).toBeCloseTo(0.4, 2);
    expect(after).toBeCloseTo(0.46, 2);
    expect(after / before).toBeCloseTo(1.15, 2);
  });

  it('advances to Citadel Age through two Age-2 buildings, and the Cataphract replaces the Lancer', () => {
    d.cheat({ food: 5000, wood: 3000, gold: 3000, stone: 1500 });
    d.run(1);
    // Age 2 buildings need Township Age; the age advance needs two distinct Age-2 building types.
    expect(d.sim.query.availability(ME, 'citadelAge').reasons).toEqual([{ code: 'ageBuildings', have: 0, need: 2 }]);
    const vs = d.villagers().map((v) => v.id);
    d.buildAndWait('archeryRange', vs.slice(0, 4), tcCentre.x, tcCentre.y, 8);
    expect(d.sim.query.availability(ME, 'citadelAge').reasons).toEqual([{ code: 'ageBuildings', have: 1, need: 2 }]);
    const stable = d.buildAndWait('stable', vs.slice(0, 4), tcCentre.x, tcCentre.y, 8);
    expect(d.sim.query.availability(ME, 'citadelAge').available).toBe(true);
    d.issue({ type: 'research', buildingId: d.townCenter().id, techId: 'citadelAge' });
    d.run(2);
    d.until(() => d.player.age === 3, 90 * TICK_RATE + 100, 'Citadel Age');

    // The Byzantine tree shows the Cataphract and never the Lancer.
    const cat = d.sim.query.availability(ME, 'cataphract');
    expect(cat.available).toBe(true);
    expect(cat.hidden).toBe(false);
    const lancer = d.sim.query.availability(ME, 'lancer');
    expect(lancer.hidden).toBe(true);
    expect(lancer.available).toBe(false);
    expect(lancer.reasons).toEqual([{ code: 'replaced', by: 'cataphract' }]);

    d.issue({ type: 'train', buildingId: stable.id, unitType: 'lancer' });
    d.run(1);
    const refusal = d.rejections().at(-1);
    expect(refusal).toMatchObject({ type: 'CommandRejected', commandType: 'train', reason: 'notAvailable' });
    expect(d.building(stable.id).queue).toHaveLength(0);

    d.issue({ type: 'train', buildingId: stable.id, unitType: 'cataphract' });
    d.run(2);
    expect(d.building(stable.id).queue).toHaveLength(1);
    d.until(() => d.events.some((e) => e.type === 'UnitTrained' && e.unitType === 'cataphract'), 40 * TICK_RATE, 'a Cataphract');
  });

  it('Silk Workshops pay gold with no gold gatherers; a fourth is refused', () => {
    // Nobody is mining: stop everyone first.
    d.issue({ type: 'stop', unitIds: d.villagers().map((v) => v.id) });
    d.run(2);
    const vs = d.villagers().map((v) => v.id);
    expect(d.villagers().every((v) => v.currentOrder === null)).toBe(true);
    d.cheat({ wood: 3000, stone: 2000 });
    d.run(1);

    const goldOver = (ticks: number): number => {
      const g0 = d.player.resources.gold;
      d.run(ticks);
      return d.player.resources.gold - g0;
    };
    const idleGold = goldOver(TICK_RATE * 20);
    expect(idleGold).toBe(0); // nothing produces gold yet

    d.buildAndWait('silkWorkshop', vs.slice(0, 4), tcCentre.x, tcCentre.y, 10);
    d.issue({ type: 'stop', unitIds: vs });
    d.run(2);
    expect(goldOver(TICK_RATE * 40)).toBe(10); // 0.25 gold per second
    d.buildAndWait('silkWorkshop', vs.slice(0, 4), tcCentre.x, tcCentre.y, 10);
    d.buildAndWait('silkWorkshop', vs.slice(0, 4), tcCentre.x, tcCentre.y, 10);
    d.issue({ type: 'stop', unitIds: vs });
    d.run(2);
    expect(d.buildings('silkWorkshop')).toHaveLength(3);
    expect(goldOver(TICK_RATE * 40)).toBe(30); // three workshops: 0.75 gold per second

    // No fourth, by command or by the placement query the HUD ghost uses.
    const spot = d.spotNear('house', tcCentre.x + 12, tcCentre.y - 12);
    const result = d.sim.query.canPlace(ME, 'silkWorkshop', spot.tx, spot.ty);
    expect(result.ok).toBe(false);
    expect(result.availability.reasons).toContainEqual({ code: 'buildLimit', limit: 3 });
    const built = d.buildings('silkWorkshop', false).length;
    d.issue({ type: 'build', unitIds: [vs[0]!], buildingType: 'silkWorkshop', tx: spot.tx, ty: spot.ty, queue: false });
    d.run(2);
    expect(d.rejections().at(-1)).toMatchObject({ commandType: 'build', reason: 'notAvailable' });
    expect(d.buildings('silkWorkshop', false)).toHaveLength(built);
  });

  it('reaches the Empire Age: Siphonarios become trainable and the objective fires once', () => {
    const vs = d.villagers().map((v) => v.id);
    // Age 3 buildings for the age advance: Silk Workshops are three of one type (one distinct type) plus a Siege Workshop.
    expect(d.sim.query.availability(ME, 'empireAge').reasons).toEqual([{ code: 'ageBuildings', have: 1, need: 2 }]);
    d.cheat({ food: 5000, gold: 3000, wood: 2000, stone: 2000 });
    d.run(1);
    const siege = d.buildAndWait('siegeWorkshop', vs.slice(0, 4), tcCentre.x, tcCentre.y, 10);
    expect(d.sim.query.availability(ME, 'siphonarios').available).toBe(false); // needs Empire Age
    d.issue({ type: 'research', buildingId: d.townCenter().id, techId: 'empireAge' });
    d.run(2);
    d.until(() => d.player.age === 4, 120 * TICK_RATE + 100, 'Empire Age');
    d.run(5);
    expect(d.events.filter((e) => e.type === 'AgeAdvanced').map((e) => (e as { age: number }).age)).toEqual([2, 3, 4]);
    expect(count('ObjectiveCompleted')).toBe(1);
    const objective = d.sim.state.objectives.entries[0]!;
    expect(objective.completedTick).not.toBeNull();

    expect(d.sim.query.availability(ME, 'siphonarios').available).toBe(true);
    d.issue({ type: 'train', buildingId: siege.id, unitType: 'siphonarios' });
    d.run(2);
    expect(d.building(siege.id).queue).toHaveLength(1);
    d.until(() => d.events.some((e) => e.type === 'UnitTrained' && e.unitType === 'siphonarios'), 40 * TICK_RATE, 'a Siphonarios');

    // The match goes on as a sandbox; the objective does not fire again.
    d.run(400);
    expect(count('ObjectiveCompleted')).toBe(1);
  });

  it('Hand Carts: carry capacity and speed follow the tech in the real loop', () => {
    expect(d.sim.query.resolvedStat(ME, 'villager', 'carryCapacity')).toBe(10);
    d.cheat({ food: 2000, wood: 2000 });
    d.issue({ type: 'research', buildingId: d.townCenter().id, techId: 'handCarts' });
    d.run(2);
    d.until(() => d.player.researched.includes('handCarts'), 45 * TICK_RATE + 100, 'Hand Carts');
    expect(d.sim.query.resolvedStat(ME, 'villager', 'carryCapacity')).toBe(15);
    expect(d.sim.query.resolvedStat(ME, 'villager', 'speed')).toBeCloseTo(1.1, 9);

    // A villager now fills up to 15 before walking back.
    const v = d.villagers()[0]!;
    const tree = d.nearestNode('tree', tcCentre.x, tcCentre.y);
    d.issue({ type: 'gather', unitIds: [v.id], nodeId: tree.id, queue: false });
    let most = 0;
    const wood0 = d.player.resources.wood;
    d.until(() => {
      most = Math.max(most, d.unit(v.id).carried?.amount ?? 0);
      return d.player.resources.wood >= wood0 + 15;
    }, 5000, 'a delivery of 15');
    expect(most).toBe(15);

    // And walks 10% faster: per-tick displacement on a straight leg.
    const spot = d.spotNear('house', tcCentre.x, tcCentre.y, 9);
    d.issue({ type: 'move', unitIds: [v.id], x: spot.tx + 1, y: spot.ty + 1, queue: false });
    d.run(3);
    let moving = 0;
    d.until(() => {
      const u = d.unit(v.id);
      moving = Math.hypot(u.pos.x - u.prevPos.x, u.pos.y - u.prevPos.y);
      return moving > 0;
    }, 100, 'the villager walks');
    expect(moving).toBeCloseTo(1.1 / TICK_RATE, 6);
  });

  it('Themata: farms are worked 10% faster', () => {
    const farm = d.buildings('farm')[0]!;
    expect(d.sim.query.resolvedStat(ME, 'villager', 'gatherRate.farm')).toBeCloseTo(0.35 * 1.1, 9);
    d.issue({ type: 'stop', unitIds: d.villagers().map((u) => u.id) });
    d.run(2);
    const v = d.villagers()[1]!;
    d.issue({ type: 'gather', unitIds: [v.id], nodeId: farm.id, queue: false });
    d.until(() => {
      const o = d.unit(v.id).currentOrder;
      return o?.type === 'gather' && o.phase === 'harvesting' && (d.unit(v.id).carried?.amount ?? 0) === 0;
    }, 3000, 'farming starts');
    const eff = (): number => {
      const u = d.unit(v.id);
      const o = u.currentOrder;
      return (u.carried?.amount ?? 0) + (o?.type === 'gather' ? o.harvestAccumulator : 0);
    };
    const t0 = eff();
    d.run(100);
    expect((eff() - t0) / 5).toBeCloseTo(0.385, 2);
    d.issue({ type: 'stop', unitIds: [v.id] });
    d.run(2);
  });

  it('a rally point on a berry bush sends new villagers to gather it (the real gather handler runs)', () => {
    const tc = d.townCenter();
    const bush = d.nearestNode('berryBush', tcCentre.x, tcCentre.y);
    d.issue({ type: 'setRally', buildingIds: [tc.id], x: bush.tile.tx + 0.5, y: bush.tile.ty + 0.5, targetId: bush.id });
    d.cheat({ food: 500 });
    d.issue({ type: 'train', buildingId: tc.id, unitType: 'villager' });
    d.run(2);
    const before = d.events.filter((e) => e.type === 'UnitTrained').length;
    d.until(() => d.events.filter((e) => e.type === 'UnitTrained').length > before, 25 * TICK_RATE, 'a villager');
    const last = d.events.filter((e) => e.type === 'UnitTrained').at(-1) as { unitId: EntityId };
    d.run(2);
    const order = d.unit(last.unitId).currentOrder;
    expect(order?.type).toBe('gather');
    expect((order as { targetId: EntityId }).targetId).toBe(bush.id);
    d.until(() => {
      const o = d.unit(last.unitId).currentOrder;
      return o?.type === 'gather' && o.phase === 'harvesting';
    }, 2000, 'harvesting berries');
    d.until(() => (d.unit(last.unitId).carried?.amount ?? 0) > 3, 600, 'berries in hand');
    expect(d.unit(last.unitId).carried?.type).toBe('food');
    d.issue({ type: 'setRally', buildingIds: [tc.id], x: tcCentre.x, y: tcCentre.y + 5 });
    d.run(1);
  });

  it('deleting a building refunds its queue in full, like cancelling', () => {
    d.issue({ type: 'stop', unitIds: d.villagers().map((u) => u.id) });
    d.run(2);
    const range = d.buildings('archeryRange')[0]!;
    d.cheat({ wood: 500, gold: 500 });
    d.run(1);
    const before = { ...d.player.resources };
    const used = d.player.popUsed;
    d.issue({ type: 'train', buildingId: range.id, unitType: 'archer' });
    d.issue({ type: 'train', buildingId: range.id, unitType: 'archer' });
    d.run(2);
    expect(d.building(range.id).queue).toHaveLength(2);
    expect(d.player.resources.wood).toBe(before.wood - 60);
    expect(d.player.popUsed).toBe(used); // queued units do not count
    d.issue({ type: 'delete', entityIds: [range.id] });
    d.run(3);
    expect(d.entity(range.id)).toBeUndefined();
    expect(d.player.resources.wood).toBe(before.wood);
    expect(d.player.resources.food).toBe(before.food);
    expect(d.player.popUsed).toBe(used);
    // Gold is only changed by the Silk Workshops during these ticks (3 x 0.25 x 5 ticks / 20 is below 1).
    expect(d.player.resources.gold - before.gold).toBeLessThanOrEqual(1);
  });
});

/** Wood per second harvested by a fresh villager on a tree near `camp`, measured over 200 harvesting ticks. */
function measureWoodPerSecond(drv: Driver, camp: BuildingEntity): number {
  const tree = drv.nearestNode('tree', camp.tile.tx + 1, camp.tile.ty + 1);
  const v = drv.villagers().find((u) => u.currentOrder === null) ?? drv.villagers()[0]!;
  drv.issue({ type: 'gather', unitIds: [v.id], nodeId: tree.id, queue: false });
  drv.until(() => {
    const u = drv.unit(v.id);
    return u.currentOrder?.type === 'gather' && u.currentOrder.phase === 'harvesting' && (u.carried?.amount ?? 0) === 0;
  }, 3000, 'harvesting starts');
  const effective = (): number => {
    const u = drv.unit(v.id);
    const o = u.currentOrder;
    return (u.carried?.amount ?? 0) + (o?.type === 'gather' ? o.harvestAccumulator : 0);
  };
  const t0 = effective();
  drv.run(200);
  const gained = effective() - t0;
  drv.issue({ type: 'stop', unitIds: [v.id] });
  drv.run(1);
  return gained / (200 / TICK_RATE);
}

// ---------------------------------------------------------------------------
// Determinism: the recorded command script, replayed
// ---------------------------------------------------------------------------

/** Replay the log on a fresh match, optionally saving and loading in the middle. Returns the hashes at the checkpoints. */
function replay(log: ReadonlyMap<number, Command[]>, ticks: number, saveLoadAt: readonly number[] = []): { hashes: Map<number, string>; final: string } {
  let sim = createGame(CONFIG);
  const hashes = new Map<number, string>();
  while (sim.state.tick < ticks) {
    const tick = sim.state.tick;
    if (saveLoadAt.includes(tick)) sim = deserialize(serialize(sim));
    sim.step(log.get(tick) ?? []);
    if (sim.state.tick % CHECKPOINT === 0) hashes.set(sim.state.tick, hashState(sim.state));
  }
  return { hashes, final: hashState(sim.state) };
}

describe('economy loop determinism', () => {
  it('the same command script gives identical hashes at every checkpoint and at the end', { timeout: 120_000 }, () => {
    const ticks = d.tick;
    expect(ticks).toBeGreaterThan(10_000);
    expect(d.hashes.size).toBeGreaterThan(10);
    const a = replay(d.log, ticks);
    const b = replay(d.log, ticks);
    expect(a.final).toBe(hashState(d.sim.state));
    expect(b.final).toBe(a.final);
    for (const [tick, h] of d.hashes) {
      expect(a.hashes.get(tick), `tick ${tick}`).toBe(h);
      expect(b.hashes.get(tick), `tick ${tick}`).toBe(h);
    }
  });

  it('a save and load in the middle of the run (twice) changes nothing', { timeout: 120_000 }, () => {
    const ticks = d.tick;
    const mid = [Math.floor(ticks / 3), Math.floor((2 * ticks) / 3)];
    const r = replay(d.log, ticks, mid);
    expect(r.final).toBe(hashState(d.sim.state));
    for (const [tick, h] of d.hashes) expect(r.hashes.get(tick), `tick ${tick}`).toBe(h);
  });

  it('the save round-trips byte for byte', () => {
    const json = serialize(d.sim);
    expect(serialize(deserialize(json))).toBe(json);
  });
});

// ---------------------------------------------------------------------------
// Construction time responds to the resolved stats (no real tech changes build times, so a civ bonus does)
// ---------------------------------------------------------------------------

describe('construction time follows the resolved stat cache', () => {
  function ticksToBuildHouse(factor: number): number {
    const civ = registry.civ('byzantines');
    const data = createRegistry({
      units: registry.units,
      buildings: registry.buildings,
      techs: registry.techs,
      ages: registry.ages,
      civs: [
        {
          ...civ,
          bonuses: [...civ.bonuses, { name: 'Quick', description: '', modifiers: [{ select: { ids: ['house'] }, stat: 'buildTime', op: 'mul', value: factor }] }],
        },
      ],
      nodes: registry.nodes,
      terrains: registry.terrains,
      start: registry.start,
      combat: registry.combat,
    });
    const sim = createGame(CONFIG, data);
    const entities = sim.state.entities;
    const tc = entities.find((e) => e.kind === 'building' && e.owner === ME)!;
    const builder = entities.find((e) => e.kind === 'unit' && e.owner === ME)!;
    if (tc.kind !== 'building') throw new Error('no tc');
    // A house right beside the Town Center so the walk is a constant few ticks.
    let seq = 1;
    let placed = -1;
    for (const [dx, dy] of [[4, 0], [-3, 0], [0, 4], [0, -3], [5, 5], [-4, -4]] as const) {
      const r = sim.query.canPlace(ME, 'house', tc.tile.tx + dx, tc.tile.ty + dy);
      if (!r.ok) continue;
      sim.step([{ type: 'build', playerId: ME, seq: seq++, unitIds: [builder.id], buildingType: 'house', tx: tc.tile.tx + dx, ty: tc.tile.ty + dy, queue: false }]);
      placed = sim.state.entities.find((e) => e.kind === 'building' && e.typeId === 'house')!.id;
      break;
    }
    if (placed < 0) throw new Error('no spot');
    let working = -1;
    for (let t = 0; t < 4000; t++) {
      const b = sim.state.entities.find((e) => e.id === placed)!;
      if (b.kind === 'building' && b.builderIds.length > 0 && working < 0) working = t;
      if (b.kind === 'building' && b.constructed) return t - working;
      sim.step([]);
    }
    throw new Error('never finished');
  }

  it('halving the resolved buildTime halves the ticks a single builder needs', () => {
    const normal = ticksToBuildHouse(1);
    const quick = ticksToBuildHouse(0.5);
    expect(normal).toBeGreaterThanOrEqual(399);
    expect(normal).toBeLessThanOrEqual(402);
    expect(quick).toBeGreaterThanOrEqual(199);
    expect(quick).toBeLessThanOrEqual(202);
  });
});
