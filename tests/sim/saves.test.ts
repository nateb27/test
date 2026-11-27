/**
 * WP12: the save format and exact restore.
 *
 * - The format carries a `version`; unknown, newer, older or malformed files
 *   are refused with typed errors, and the UI turns them into plain messages.
 * - A save taken at any point restores exactly: mid-construction, mid-research,
 *   mid-path (with a non-empty path queue), units carrying resources, a queue
 *   held at the population cap, and a 200-unit stress match. "Exactly" means
 *   the re-serialised text is identical, the derived caches answer every
 *   query the same way, and both sims then evolve identically.
 * - `tests/sim/fixtures/save-v1.json` is a committed version-1 save (frozen: it
 *   is never regenerated). It must keep loading through the v1 -> v2 migration;
 *   its re-serialised form is `save-v1-as-v2.json` (tests/sim/m2contracts.test.ts).
 *   If a suite fails on these, the format changed: bump SAVE_VERSION and add a
 *   migration in src/sim/serialize.ts.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { registry } from '../../src/data';
import {
  createGame,
  deserialize,
  hashState,
  SaveError,
  SaveVersionError,
  serialize,
  type BuildingEntity,
  type Command,
  type CommandInput,
  type EntityId,
  type GameConfig,
  type Sim,
  type StatKey,
  type UnitEntity,
} from '../../src/sim';
import { createStressScenario } from '../../src/sim/stress';
import { SAVE_VERSION } from '../../src/sim/types';
import { parseSave } from '../../src/client/ui/saveLoad';

const ME = 1;
const CONFIG: GameConfig = { seed: 31, mapSize: 120, players: [{ civ: 'byzantines' }] };
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'save-v1.json');

// ---------------------------------------------------------------------------
// A small driver (commands are stamped and stepped one tick at a time)
// ---------------------------------------------------------------------------

class Game {
  readonly sim: Sim;
  private seq = 1;
  private pending: Command[] = [];

  constructor(config: GameConfig = CONFIG) {
    this.sim = createGame(config);
  }

  issue(input: CommandInput): void {
    this.pending.push({ ...input, playerId: ME, seq: this.seq++ } as Command);
  }

  run(n: number): void {
    for (let i = 0; i < n; i++) {
      const cmds = this.pending;
      this.pending = [];
      this.sim.step(cmds);
    }
  }

  until(done: () => boolean, max: number, what: string): void {
    for (let i = 0; i < max && !done(); i++) this.run(1);
    if (!done()) throw new Error(`timed out waiting for: ${what}`);
  }

  get player() {
    return this.sim.state.players[ME]!;
  }

  units(): UnitEntity[] {
    return this.sim.state.entities.filter((e) => e.kind === 'unit' && e.owner === ME) as UnitEntity[];
  }

  buildings(type?: string): BuildingEntity[] {
    return this.sim.state.entities.filter(
      (e) => e.kind === 'building' && e.owner === ME && (type === undefined || e.typeId === type),
    ) as BuildingEntity[];
  }

  townCenter(): BuildingEntity {
    return this.buildings('townCenter')[0]!;
  }

  nearestNode(type: string, skip = 0): EntityId {
    const tc = this.townCenter();
    const nodes = this.sim.state.entities
      .filter((e) => e.kind === 'node' && e.typeId === type)
      .map((e) => ({ id: e.id, d: ((e as { tile: { tx: number } }).tile.tx - tc.tile.tx) ** 2 + ((e as { tile: { ty: number } }).tile.ty - tc.tile.ty) ** 2 }))
      .sort((a, b) => a.d - b.d || a.id - b.id);
    return nodes[skip]!.id;
  }

  /** A free 2x2 spot near the Town Center per the sim's own `canPlace`. */
  spot(type: string, ring: number): { tx: number; ty: number } {
    const tc = this.townCenter();
    for (let r = ring; r < 30; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = tc.tile.tx + 2 + dx;
          const ty = tc.tile.ty + 2 + dy;
          if (this.sim.query.canPlace(ME, type, tx, ty).ok) return { tx, ty };
        }
      }
    }
    throw new Error(`no spot for ${type}`);
  }

  rich(): void {
    this.issue({ type: 'cheat', cheat: { kind: 'addResources', amounts: { food: 3000, wood: 3000, gold: 1500, stone: 1500 } } });
    this.run(1);
  }
}

// ---------------------------------------------------------------------------
// "Restores exactly"
// ---------------------------------------------------------------------------

/** Answers of the read-only queries that depend on derived caches, over the whole map and every def. */
function cacheView(sim: Sim): unknown {
  const { width, height } = sim.state.map;
  const placeable: string[] = [];
  const tc = sim.state.entities.find((e) => e.kind === 'building' && e.owner === ME);
  const near = tc === undefined || tc.kind === 'unit' ? { tx: 0, ty: 0 } : tc.tile;
  for (let ty = 0; ty < height; ty += 1) {
    let row = '';
    for (let tx = 0; tx < width; tx += 1) {
      // Every tile around the Town Center, a sparse sample of the rest of the map.
      const close = Math.abs(tx - near.tx) <= 14 && Math.abs(ty - near.ty) <= 14;
      if (!close && (tx % 3 !== 0 || ty % 3 !== 0)) continue;
      const r = sim.query.canPlace(ME, 'house', tx, ty);
      row += r.tiles.map((t) => (t === null ? '.' : t[0])).join('');
      row += r.ok ? 'Y' : 'n';
    }
    placeable.push(row);
  }
  const stats: Record<string, number | null> = {};
  const keys: StatKey[] = [
    'hp', 'attack', 'meleeArmor', 'pierceArmor', 'range', 'speed', 'carryCapacity', 'gatherRate.wood', 'gatherRate.berries', 'gatherRate.farm',
    'gatherRate.gold', 'gatherRate.stone', 'popCost', 'popProvided', 'trainTime', 'buildTime', 'researchTime', 'incomeRate',
    'cost.food', 'cost.wood', 'cost.gold', 'cost.stone',
  ];
  const ids = [...registry.units, ...registry.buildings, ...registry.techs].map((d) => d.id);
  for (const player of [ME]) {
    for (const id of ids) {
      for (const key of keys) {
        let v: number | null;
        try {
          v = sim.query.resolvedStat(player, id, key);
        } catch {
          v = null;
        }
        stats[`${player}/${id}/${key}`] = v;
      }
    }
  }
  const availability = ids.map((id) => sim.query.availability(ME, id));
  const rect = sim.query.entitiesInRect(0, 0, width, height).map((e) => e.id);
  return { placeable, stats, availability, rect };
}

/**
 * Save `sim`, load it, and prove the copy is the same game: identical text on
 * re-serialising, identical answers from cache-backed queries, and identical
 * states for `ticks` further ticks (compared every 5 ticks and at the end).
 */
function expectExactRestore(sim: Sim, ticks = 150, commands: (tick: number) => Command[] = () => []): Sim {
  const json = serialize(sim);
  const copy = deserialize(json);
  expect(serialize(copy)).toBe(json);
  expect(hashState(copy.state)).toBe(hashState(sim.state));
  expect(cacheView(copy)).toEqual(cacheView(sim));
  for (let i = 0; i < ticks; i++) {
    const cmds = commands(sim.state.tick);
    sim.step(cmds);
    copy.step(cmds);
    if (i % 5 === 4) expect(hashState(copy.state), `tick ${sim.state.tick}`).toBe(hashState(sim.state));
  }
  expect(serialize(copy)).toBe(serialize(sim));
  return copy;
}

// ---------------------------------------------------------------------------
// Format and errors
// ---------------------------------------------------------------------------

describe('save format', () => {
  const json = serialize(createGame(CONFIG));

  it('is canonical JSON with a version field and nothing derived', () => {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['controllers', 'state', 'version']);
    expect(parsed.controllers).toEqual([]);
    expect(parsed.version).toBe(SAVE_VERSION);
    expect(json).not.toContain('"occupancy"');
    expect(json).not.toContain('"resolvedStats"');
    expect(json).not.toContain('"pendingRemoval"');
  });

  it('refuses a newer version with a typed error that says so', () => {
    const newer = json.replace(`"version":${SAVE_VERSION}`, `"version":${SAVE_VERSION + 1}`);
    let caught: unknown;
    try {
      deserialize(newer);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SaveVersionError);
    expect(caught).toBeInstanceOf(SaveError);
    const err = caught as SaveVersionError;
    expect(err.code).toBe('unsupportedVersion');
    expect(err.direction).toBe('newer');
    expect(err.found).toBe(SAVE_VERSION + 1);
    expect(err.expected).toBe(SAVE_VERSION);
    expect(err.message).toMatch(/Unsupported save version/);
  });

  it('refuses an older version with no migration, and a non-integer version', () => {
    const older = json.replace(`"version":${SAVE_VERSION}`, '"version":0');
    expect(() => deserialize(older)).toThrow(SaveVersionError);
    try {
      deserialize(older);
    } catch (e) {
      expect((e as SaveVersionError).direction).toBe('older');
    }
    for (const v of ['"1"', '1.5', 'null', 'true']) {
      const odd = json.replace(`"version":${SAVE_VERSION}`, `"version":${v}`);
      expect(() => deserialize(odd), v).toThrow(SaveError);
    }
  });

  it('refuses files that are not saves, with a code for each case', () => {
    const code = (text: string): string => {
      try {
        deserialize(text);
      } catch (e) {
        return (e as SaveError).code;
      }
      return 'loaded';
    };
    expect(code('')).toBe('invalidJson');
    expect(code('{nope')).toBe('invalidJson');
    expect(code('[]')).toBe('notASave');
    expect(code('42')).toBe('notASave');
    expect(code('{"state":{}}')).toBe('notASave');
    expect(code('{"version":1}')).toBe('notASave');
    expect(code('{"version":1,"state":{"tick":"x"}}')).toBe('corrupt');
  });

  it('refuses damaged states instead of loading them', () => {
    const damage = (edit: (s: Record<string, unknown>) => void): string => {
      const file = JSON.parse(json) as { state: Record<string, unknown> };
      edit(file.state);
      try {
        deserialize(JSON.stringify(file));
      } catch (e) {
        expect(e).toBeInstanceOf(SaveError);
        return (e as SaveError).code;
      }
      return 'loaded';
    };
    expect(damage((s) => { s.tick = -1; })).toBe('corrupt');
    expect(damage((s) => { (s.map as { tiles: unknown[] }).tiles.pop(); })).toBe('corrupt');
    expect(damage((s) => { (s.entities as { typeId: string }[])[0]!.typeId = 'dragon'; })).toBe('corrupt');
    expect(damage((s) => { (s.entities as { id: number }[])[1]!.id = (s.entities as { id: number }[])[0]!.id; })).toBe('corrupt');
    expect(damage((s) => { (s.players as { age: number }[])[1]!.age = 9; })).toBe('corrupt');
    expect(damage((s) => { s.rng = null; })).toBe('corrupt');
    expect(damage(() => {})).toBe('loaded');
  });

  it('refuses hand-edited saves with bad queue items, positions, references and numbers', () => {
    type E = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const load = (edit: (s: { entities: E[]; pathQueue: E[] }) => void): string => {
      const file = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { state: { entities: E[]; pathQueue: E[] } };
      edit(file.state);
      try {
        deserialize(JSON.stringify(file));
      } catch (e) {
        expect(e).toBeInstanceOf(SaveError);
        expect((e as SaveError).code).toBe('corrupt');
        return (e as SaveError).message;
      }
      return 'loaded';
    };
    const tcWithQueue = (s: { entities: E[] }): E => s.entities.find((e) => e.kind === 'building' && e.queue.length > 0)!;
    const unit = (s: { entities: E[] }): E => s.entities.find((e) => e.kind === 'unit' && e.carried !== undefined)!;
    const item = (s: { entities: E[] }): E => tcWithQueue(s).queue[0];

    expect(load((s) => { item(s).ticksTotal = 'x'; })).toMatch(/queue item 1 .*invalid progress/);
    expect(load((s) => { item(s).ticksDone = item(s).ticksTotal + 1; })).toMatch(/invalid progress/);
    expect(load((s) => { item(s).kind = 'banana'; })).toMatch(/neither a unit nor a technology/);
    expect(load((s) => { item(s).kind = 'unit'; item(s).unitType = 'dragon'; })).toMatch(/not a known unit/);
    expect(load((s) => { item(s).kind = 'tech'; item(s).techId = 'villager'; })).toMatch(/not a known technology/);
    expect(load((s) => { item(s).costPaid.food = 1.5; })).toMatch(/invalid cost/);
    expect(load((s) => { delete item(s).costPaid; })).toMatch(/invalid cost/);
    expect(load((s) => { tcWithQueue(s).queue = Array.from({ length: 11 }, () => ({ ...item(s) })); })).toMatch(/too many/);
    expect(load((s) => { unit(s).pos = { x: 5000, y: -3 }; })).toMatch(/position outside the map/);
    expect(load((s) => { unit(s).prevPos = { x: -1, y: 4 }; })).toMatch(/position outside the map/);
    expect(load((s) => { unit(s).facing = 8; })).toMatch(/facing/);
    expect(load((s) => { unit(s).orderQueue = [{ type: 'gather', targetId: 'tree' }]; })).toMatch(/order queue/);
    // An order whose target is gone is legitimate (cleanup runs before the order notices) and still loads.
    expect(load((s) => { unit(s).orderQueue = [{ type: 'gather', targetId: 99999 }]; })).toBe('loaded');
    expect(load((s) => { unit(s).orderQueue = [{ type: 'dance' }]; })).toMatch(/order queue/);
    expect(load((s) => { unit(s).orderQueue = [{ type: 'move', x: 1e9, y: 0 }]; })).toMatch(/order queue/);
    expect(load((s) => { unit(s).carried = { type: 'wood', amount: 2.5 }; })).toMatch(/load/);
    expect(load((s) => { tcWithQueue(s).tile = { tx: 9999, ty: 0 }; })).toMatch(/outside the map/);
    expect(load((s) => { tcWithQueue(s).gathererIds = [99999]; })).toMatch(/gatherer list/);
    expect(load((s) => { tcWithQueue(s).rally = { x: 1, y: 1, targetId: 99999 }; })).toMatch(/rally/);
    expect(load((s) => { tcWithQueue(s).costPaid.wood = 0.5; })).toMatch(/cost record/);
    expect(load((s) => { s.pathQueue = [{ id: 1, unitId: 99999, from: { tx: 0, ty: 0 }, goal: { kind: 'point', x: 1, y: 1 } }]; })).toMatch(/path request/);
    expect(load(() => {})).toBe('loaded');
  });

  it('says what is wrong with a version that is not a number', () => {
    for (const [v, re] of [['"1"', /not a number/], ['null', /not a number/], ['1.5', /not a whole number/]] as const) {
      const text = json.replace(`"version":${SAVE_VERSION}`, `"version":${v}`);
      let msg = '';
      try {
        deserialize(text);
      } catch (e) {
        msg = (e as SaveError).message;
      }
      expect(msg, v).toMatch(re);
      expect(msg, v).not.toMatch(/save version 1; this game reads/);
      const ui = parseSave(text);
      expect(ui.ok).toBe(false);
      if (!ui.ok) expect(ui.message, v).toMatch(/unrecognised version/);
    }
  });

  it('the UI turns the typed errors into plain-language results', () => {
    const newer = parseSave(json.replace(`"version":${SAVE_VERSION}`, `"version":${SAVE_VERSION + 1}`));
    expect(newer).toMatchObject({ ok: false, kind: 'unsupportedVersion' });
    if (!newer.ok) expect(newer.message).toMatch(/different version.*newer build/s);
    const older = parseSave(json.replace(`"version":${SAVE_VERSION}`, '"version":0'));
    expect(older).toMatchObject({ ok: false, kind: 'unsupportedVersion' });
    expect(parseSave('{nope')).toMatchObject({ ok: false, kind: 'corrupt' });
    expect(parseSave('{"version":1,"state":{"tick":"x"}}')).toMatchObject({ ok: false, kind: 'corrupt' });
    expect(parseSave(json)).toMatchObject({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// A save at any point restores exactly
// ---------------------------------------------------------------------------

const LONG = 120_000;

describe('restores exactly', () => {
  it('a fresh match', () => {
    expectExactRestore(new Game().sim, 50);
  }, LONG);

  it('mid-construction (foundation partly built, builders working)', () => {
    const g = new Game();
    g.rich();
    const builders = g.units().slice(0, 3).map((u) => u.id);
    const { tx, ty } = g.spot('house', 4);
    g.issue({ type: 'build', unitIds: builders, buildingType: 'house', tx, ty, queue: false });
    g.until(() => g.buildings('house').some((h) => !h.constructed && h.progress > 0.2 && h.progress < 0.8), 800, 'a half-built house');
    const house = g.buildings('house')[0]!;
    expect(house.builderIds.length).toBeGreaterThan(0);
    const copy = expectExactRestore(g.sim, 400);
    expect(copy.state.entities.find((e) => e.id === house.id)).toMatchObject({ constructed: true });
  }, LONG);

  it('mid-research and mid-training (queue items part done)', () => {
    const g = new Game();
    g.rich();
    // Township Age needs two kinds of Age 1 building; instant build gets them up at once.
    g.issue({ type: 'cheat', cheat: { kind: 'instantBuild', enabled: true } });
    const vs = g.units().map((u) => u.id);
    const camp = g.spot('lumberCamp', 4);
    g.issue({ type: 'build', unitIds: vs.slice(0, 2), buildingType: 'lumberCamp', tx: camp.tx, ty: camp.ty, queue: false });
    g.run(2);
    const farm = g.spot('farm', 4);
    g.issue({ type: 'build', unitIds: vs.slice(2, 4), buildingType: 'farm', tx: farm.tx, ty: farm.ty, queue: false });
    g.until(() => g.buildings('lumberCamp').every((b) => b.constructed) && g.buildings('farm').every((b) => b.constructed) && g.buildings('farm').length === 1, 400, 'camp and farm');
    g.issue({ type: 'cheat', cheat: { kind: 'instantBuild', enabled: false } });
    const tc = g.townCenter();
    g.issue({ type: 'research', buildingId: tc.id, techId: 'townshipAge' });
    for (let i = 0; i < 3; i++) g.issue({ type: 'train', buildingId: tc.id, unitType: 'villager' });
    g.until(() => g.townCenter().queue.some((q) => q.ticksDone > 100 && q.ticksDone < q.ticksTotal - 100), 1500, 'a started queue item');
    expect(g.townCenter().queue.length).toBeGreaterThan(1);
    expect(g.player.age).toBe(1);
    const copy = expectExactRestore(g.sim, 1500);
    expect(copy.state.players[ME]!.age).toBe(2);
    expect(copy.state.players[ME]!.researched).toContain('townshipAge');
  }, LONG);

  it('mid-path, with requests waiting in the path queue', () => {
    // 200 villagers all ask for a path on the first tick: the per-tick budget makes the queue back up.
    const sc = createStressScenario(5);
    const units = (): UnitEntity[] => sc.sim.state.entities.filter((e) => e.kind === 'unit') as UnitEntity[];
    for (let i = 0; i < 12 && sc.sim.state.pathQueue.length === 0; i++) sc.sim.step(sc.commands(sc.sim.state.tick));
    sc.sim.step(sc.commands(sc.sim.state.tick));
    expect(sc.sim.state.pathQueue.length).toBeGreaterThan(0);
    expect(units().some((u) => u.path !== null)).toBe(true);
    expect(units().some((u) => u.pendingPathRequestId !== null)).toBe(true);
    expectExactRestore(sc.sim, 60, (tick) => sc.commands(tick));
    // Later, with units well along their paths (past waypoints) and fresh requests still arriving.
    for (let i = 0; i < 150; i++) sc.sim.step(sc.commands(sc.sim.state.tick));
    expect(units().some((u) => u.path !== null && u.path.nextIndex > 0)).toBe(true);
    expectExactRestore(sc.sim, 100, (tick) => sc.commands(tick));
  }, LONG);

  it('units carrying resources, harvesting with a partial load, and heading to a drop-off', () => {
    const g = new Game();
    const vs = g.units();
    g.issue({ type: 'gather', unitIds: [vs[0]!.id, vs[1]!.id], nodeId: g.nearestNode('tree'), queue: false });
    g.issue({ type: 'gather', unitIds: [vs[2]!.id], nodeId: g.nearestNode('berryBush'), queue: false });
    g.issue({ type: 'gather', unitIds: [vs[3]!.id], nodeId: g.nearestNode('goldDeposit'), queue: false });
    const phases = (): string[] => g.units().map((u) => (u.currentOrder?.type === 'gather' ? `${u.currentOrder.phase}${u.carried !== null ? '+' : ''}` : ''));
    g.until(() => phases().includes('toDropOff+') && phases().includes('harvesting+'), 2000, 'a carrier and a harvester');
    const carriers = g.units().filter((u) => u.carried !== null);
    expect(carriers.length).toBeGreaterThan(1);
    expect(g.units().some((u) => u.currentOrder?.type === 'gather' && u.currentOrder.harvestAccumulator > 0)).toBe(true);
    expectExactRestore(g.sim, 600);
  }, LONG);

  it('a queue held at the population cap, with a rally point set', () => {
    const g = new Game();
    g.rich();
    const tc = g.townCenter();
    g.issue({ type: 'setRally', buildingIds: [tc.id], x: tc.tile.tx + 8.5, y: tc.tile.ty + 8.5 });
    const room = g.player.popCap - g.player.popUsed;
    for (let i = 0; i < Math.min(10, room + 2); i++) g.issue({ type: 'train', buildingId: tc.id, unitType: 'villager' });
    g.until(() => g.townCenter().queue.some((q) => q.kind === 'unit' && q.popCapNotified), 2600, 'a held item');
    expect(g.townCenter().rally).not.toBeNull();
    const copy = expectExactRestore(g.sim, 100);
    // A House built after loading releases the held unit the same way in both.
    const builders = copy.state.entities.filter((e) => e.kind === 'unit').slice(0, 2).map((e) => e.id);
    const { tx, ty } = g.spot('house', 5);
    const build: Command = { type: 'build', playerId: ME, seq: 1000, unitIds: builders, buildingType: 'house', tx, ty, queue: false };
    const json = serialize(g.sim);
    const a = deserialize(json);
    const b = deserialize(json);
    a.step([build]);
    b.step([build]);
    for (let i = 0; i < 500; i++) {
      a.step([]);
      b.step([]);
    }
    expect(hashState(a.state)).toBe(hashState(b.state));
    expect(a.state.players[ME]!.popCap).toBe(g.player.popCap + 10);
  }, LONG);

  it('every few ticks of the 200-unit stress match', () => {
    const sc = createStressScenario(3);
    for (let i = 0; i < 400; i++) sc.sim.step(sc.commands(sc.sim.state.tick));
    for (let round = 0; round < 6; round++) {
      expectExactRestore(sc.sim, 23, (tick) => sc.commands(tick));
    }
  }, LONG);
});

// ---------------------------------------------------------------------------
// The committed fixture
// ---------------------------------------------------------------------------

// The fixture was made (in M1) by a short scripted game on a 48x48 map: gathering, a house under way, queues, a rally
// point. It is frozen as a version-1 file and is no longer regenerated.
describe('committed save fixture (format v1)', () => {
  const text = readFileSync(FIXTURE, 'utf8').trim();

  it('is a version-1 save of a game in progress', () => {
    const file = JSON.parse(text) as { version: number; state: { tick: number; entities: { kind: string }[] } };
    expect(file.version).toBe(1);
    expect(file.state.tick).toBe(421);
    expect(file.state.entities.filter((e) => e.kind === 'unit').length).toBeGreaterThanOrEqual(6);
    expect(text.length).toBeLessThan(120_000);
  });

  it('still loads (through the v1 -> v2 migration) and re-serialises stably as version 2', () => {
    const sim = deserialize(text);
    expect(sim.state.tick).toBe(421);
    const v2 = serialize(sim);
    expect(JSON.parse(v2).version).toBe(2);
    expect(serialize(deserialize(v2))).toBe(v2);
    expect(sim.state.match.mode).toBe('sandbox');
    expect(parseSave(text)).toMatchObject({ ok: true });
  });

  it('restores the whole game: queues, orders, a half-built house and carried loads', () => {
    const sim = deserialize(text);
    const mine = sim.state.entities.filter((e) => e.owner === ME);
    const tc = mine.find((e) => e.kind === 'building' && e.typeId === 'townCenter') as BuildingEntity;
    expect(tc.queue.length).toBeGreaterThan(0);
    expect(tc.rally).not.toBeNull();
    expect(mine.some((e) => e.kind === 'building' && e.typeId === 'house')).toBe(true);
    expect(mine.some((e) => e.kind === 'unit' && e.currentOrder !== null)).toBe(true);
    expect(sim.query.resolvedStat(ME, 'villager', 'carryCapacity')).toBeGreaterThanOrEqual(10);
  });

  it('plays on deterministically: two loads, two runs, one result', () => {
    const a = deserialize(text);
    const b = deserialize(text);
    for (let i = 0; i < 600; i++) {
      a.step([]);
      b.step([]);
    }
    expect(hashState(a.state)).toBe(hashState(b.state));
    expect(a.state.tick).toBe(1021);
    // Something happened: the house went up and villagers were trained.
    expect(a.state.entities.filter((e) => e.kind === 'unit' && e.owner === ME).length).toBeGreaterThan(6);
  });
});
