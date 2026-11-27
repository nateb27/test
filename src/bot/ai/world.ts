/**
 * The AI's read of the battlefield for one decision: own army, own buildings, enemy units and buildings, in one
 * pass over `sim.state.entities` (ascending id). Plain copies; nothing here survives the decision. There is no fog
 * of war in M2, so the AI sees exactly what the human sees on the map (no vision bonus).
 *
 * Every loop counts operations into `ops` (PLAN-M2 6.7 budgets are counted in operations, never milliseconds).
 */

import type { DataRegistry } from '../../data';
import type { BuildingId, EntityId, OrderState, PlayerId, ReadonlyEntity, Sim, UnitId } from '../../sim';
import { UNIT_CLASS, BUCKET_CELL, type UnitClass } from './difficulty';
import type { PowerTable } from './power';

export interface UnitInfo {
  id: EntityId;
  typeId: UnitId;
  owner: PlayerId;
  x: number;
  y: number;
  hp: number;
  cls: UnitClass;
  /** Auto-acquiring unit that can target units (tier 1 of 4.5). */
  fighting: boolean;
  siege: boolean;
  villager: boolean;
  power: number;
  order: Readonly<OrderState> | null;
  queued: number;
  /** Chasing (attack order) with no path left and no path request pending: the unit is not going anywhere. */
  stalled: boolean;
}

export interface BuildingInfo {
  id: EntityId;
  typeId: BuildingId;
  owner: PlayerId;
  tx: number;
  ty: number;
  size: number;
  cx: number;
  cy: number;
  constructed: boolean;
  hp: number;
  maxHp: number;
  builders: number;
  repairers: number;
  queueLength: number;
  queuedTechs: string[];
  /** Unit types queued here, front first. */
  queuedUnits: UnitId[];
  /** Def trains something (a producer for the defeat rule). */
  producer: boolean;
  rally: { x: number; y: number } | null;
}

/** Operation counter shared by every step of one decision. */
export interface Ops {
  n: number;
}

export interface AiWorld {
  tick: number;
  playerId: PlayerId;
  age: number;
  mapWidth: number;
  mapHeight: number;
  army: UnitInfo[];
  villagers: UnitInfo[];
  buildings: BuildingInfo[];
  enemyUnits: UnitInfo[];
  enemyBuildings: BuildingInfo[];
  /** Enemy players still playing, ascending. */
  enemies: PlayerId[];
  /** Own completed Town Center with the lowest id, else any own Town Center, else null. */
  tc: BuildingInfo | null;
  /** Enemy Town Center nearest to ours (ties: lowest id), else null. */
  enemyTc: BuildingInfo | null;
  byId: Map<EntityId, UnitInfo | BuildingInfo>;
}

const sq = (x: number): number => x * x;

/** Squared distance from a point to a building footprint (0 inside), or to a unit centre. */
export function distSqTo(x: number, y: number, t: UnitInfo | BuildingInfo): number {
  if ('size' in t) {
    const dx = x < t.tx ? t.tx - x : x > t.tx + t.size ? x - t.tx - t.size : 0;
    const dy = y < t.ty ? t.ty - y : y > t.ty + t.size ? y - t.ty - t.size : 0;
    return dx * dx + dy * dy;
  }
  return sq(t.x - x) + sq(t.y - y);
}

export function readWorld(sim: Sim, playerId: PlayerId, data: DataRegistry, powers: PowerTable, ops: Ops): AiWorld {
  const state = sim.state;
  const players = state.players;
  const enemies: PlayerId[] = [];
  for (const p of players) {
    if (p.id !== 0 && p.id !== playerId && p.outcome === 'playing') enemies.push(p.id);
  }
  const isEnemyOwner = (owner: PlayerId): boolean => owner !== 0 && owner !== playerId && players[owner]?.outcome !== 'defeated';
  const world: AiWorld = {
    tick: state.tick,
    playerId,
    age: players[playerId]?.age ?? 1,
    mapWidth: state.map.width,
    mapHeight: state.map.height,
    army: [],
    villagers: [],
    buildings: [],
    enemyUnits: [],
    enemyBuildings: [],
    enemies,
    tc: null,
    enemyTc: null,
    byId: new Map(),
  };
  const centre = data.start.centerBuilding;
  for (const e of state.entities as readonly ReadonlyEntity[]) {
    ops.n++;
    if (e.kind === 'node') continue;
    const mine = e.owner === playerId;
    if (!mine && !isEnemyOwner(e.owner)) continue;
    if (e.kind === 'unit') {
      if (e.hp <= 0) continue;
      const def = data.unit(e.typeId);
      const villager = def.gather !== undefined;
      const siege = def.combat.targets === 'buildings';
      const fighting = def.combat.autoAcquire && !siege;
      const info: UnitInfo = {
        id: e.id,
        typeId: e.typeId,
        owner: e.owner,
        x: e.pos.x,
        y: e.pos.y,
        hp: e.hp,
        cls: UNIT_CLASS[e.typeId] ?? 'sword',
        fighting,
        siege,
        villager,
        power: powers.power(e.owner, e.typeId, e.hp),
        order: e.currentOrder,
        queued: e.orderQueue.length,
        stalled:
          e.currentOrder !== null &&
          e.currentOrder.type === 'attack' &&
          e.currentOrder.phase === 'chasing' &&
          e.pendingPathRequestId === null &&
          (e.path === null || e.path.nextIndex >= e.path.waypoints.length),
      };
      world.byId.set(e.id, info);
      if (mine) (villager ? world.villagers : world.army).push(info);
      else world.enemyUnits.push(info);
    } else {
      if (e.hp <= 0) continue;
      const def = data.building(e.typeId);
      let maxHp = def.combat.hp;
      try {
        maxHp = sim.query.resolvedStat(e.owner, e.typeId, 'hp');
      } catch {
        // keep the base value
      }
      const info: BuildingInfo = {
        id: e.id,
        typeId: e.typeId,
        owner: e.owner,
        tx: e.tile.tx,
        ty: e.tile.ty,
        size: def.footprint,
        cx: e.tile.tx + def.footprint / 2,
        cy: e.tile.ty + def.footprint / 2,
        constructed: e.constructed,
        hp: e.hp,
        maxHp,
        builders: e.builderIds.length,
        repairers: e.repairerIds.length,
        queueLength: e.queue.length,
        queuedTechs: e.queue.flatMap((q) => (q.kind === 'tech' ? [q.techId] : [])),
        queuedUnits: e.queue.flatMap((q) => (q.kind === 'unit' ? [q.unitType] : [])),
        producer: def.trains.length > 0,
        rally: e.rally === null ? null : { x: e.rally.x, y: e.rally.y },
      };
      world.byId.set(e.id, info);
      if (mine) {
        world.buildings.push(info);
        if (e.typeId === centre && (world.tc === null || (!world.tc.constructed && info.constructed))) world.tc = info;
      } else world.enemyBuildings.push(info);
    }
  }
  const home = world.tc;
  let best = Infinity;
  for (const b of world.enemyBuildings) {
    ops.n++;
    if (b.typeId !== centre) continue;
    const d = home === null ? b.id : sq(b.cx - home.cx) + sq(b.cy - home.cy);
    if (d < best) {
      best = d;
      world.enemyTc = b;
    }
  }
  return world;
}

/**
 * A bucket grid (PLAN-M2 6.7: 8-tile cells) over points, built per decision. `near` visits the items of every cell
 * overlapping a square of radius `r` around a point, cell by cell in row-major order, items in insertion order.
 */
export class Buckets<T extends { x: number; y: number }> {
  private readonly cols: number;
  private readonly rows: number;
  private readonly cells: T[][];

  constructor(width: number, height: number, items: readonly T[], ops: Ops) {
    this.cols = Math.max(1, Math.ceil(width / BUCKET_CELL));
    this.rows = Math.max(1, Math.ceil(height / BUCKET_CELL));
    this.cells = [];
    for (let i = 0; i < this.cols * this.rows; i++) this.cells.push([]);
    for (const it of items) {
      ops.n++;
      this.cells[this.cellOf(it.x, it.y)]!.push(it);
    }
  }

  private clampCol(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor(x / BUCKET_CELL)));
  }

  private clampRow(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor(y / BUCKET_CELL)));
  }

  private cellOf(x: number, y: number): number {
    return this.clampRow(y) * this.cols + this.clampCol(x);
  }

  /** Items within `r` (Euclidean) of (x, y), in ascending cell then insertion order. */
  near(x: number, y: number, r: number, ops: Ops): T[] {
    const out: T[] = [];
    const c0 = this.clampCol(x - r);
    const c1 = this.clampCol(x + r);
    const r0 = this.clampRow(y - r);
    const r1 = this.clampRow(y + r);
    const rr = r * r;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        for (const it of this.cells[row * this.cols + col]!) {
          ops.n++;
          if (sq(it.x - x) + sq(it.y - y) <= rr) out.push(it);
        }
      }
    }
    return out;
  }
}

/**
 * Single-link clusters (link radius `link`) of units, ascending id inside each cluster; clusters ordered by their
 * lowest id. Uses a bucket grid, so the cost is about n times the units in neighbouring cells.
 */
export function clusters(units: readonly UnitInfo[], link: number, width: number, height: number, ops: Ops): UnitInfo[][] {
  if (units.length === 0) return [];
  const sorted = [...units].sort((a, b) => a.id - b.id);
  const grid = new Buckets(width, height, sorted, ops);
  const label = new Map<EntityId, number>();
  const out: UnitInfo[][] = [];
  for (const seed of sorted) {
    if (label.has(seed.id)) continue;
    const idx = out.length;
    const members: UnitInfo[] = [seed];
    label.set(seed.id, idx);
    for (let head = 0; head < members.length; head++) {
      const m = members[head]!;
      for (const n of grid.near(m.x, m.y, link, ops)) {
        if (label.has(n.id)) continue;
        label.set(n.id, idx);
        members.push(n);
      }
    }
    members.sort((a, b) => a.id - b.id);
    out.push(members);
  }
  return out;
}

export function centroid(units: readonly { x: number; y: number }[]): { x: number; y: number } {
  if (units.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const u of units) {
    x += u.x;
    y += u.y;
  }
  return { x: x / units.length, y: y / units.length };
}

export function sumPower(units: readonly UnitInfo[]): number {
  let p = 0;
  for (const u of units) p += u.power;
  return p;
}
