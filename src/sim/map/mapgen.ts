/**
 * Seeded map generation (plan 4.2). Owned by WP1.
 *
 * Everything is drawn from `state.rng`, re-seeded per attempt with
 * `seed + attempt`. After each attempt the map is validated (start constraints,
 * flood-fill reachability, reachable approach to every guaranteed resource);
 * on failure the next attempt uses `seed + 1`, and so on. `state.mapSeed` ends
 * up as the seed that produced the final map.
 *
 * Node and building defs are found through the registry: the Town Center is
 * `data.start.centerBuilding`, and node defs are chosen by `gatherKind`
 * (wood, berries, gold, stone). A kind the registry has no def for is skipped.
 */

import type { DataRegistry, NodeDef } from '../../data/schema';
import { createBuilding, createNode, createUnit } from '../entities';
import { buildingCombat, unitCombat } from '../systems/combat/damage';
import { createRng, rngInt, rngRange } from '../rng';
import type {
  EntityId,
  Facing,
  GameConfig,
  GameState,
  GatherKind,
  PlayerId,
  SimContext,
  TilePos,
  Vec2,
} from '../types';
import { setFootprint } from './occupancy';

/** Start position must be at least this far from every map edge (capped on small maps). */
export const START_EDGE_DISTANCE = 25;
/** No nodes within this radius of a Town Center anchor, except the guaranteed berry patches. */
export const CLEAR_RADIUS = 8;
/** Share of tiles covered by trees (guaranteed stands included). */
export const FOREST_COVERAGE = 0.12;
/** At least this share of free walkable tiles must be reachable from the first Town Center. */
export const MIN_REACHABLE_SHARE = 0.95;
/** Attempts (seed, seed+1, ...) before giving up and keeping the last map. */
export const MAX_MAP_ATTEMPTS = 24;

export type GuaranteedKind = 'berries' | 'gold' | 'stone' | 'tree';

/** Guaranteed resources near every start (plan 4.2): clusters, nodes per cluster, distance range. */
export const GUARANTEED: readonly { kind: GuaranteedKind; clusters: number; lo: number; hi: number }[] = [
  { kind: 'berries', clusters: 2, lo: 6, hi: 10 },
  { kind: 'gold', clusters: 1, lo: 10, hi: 14 },
  { kind: 'stone', clusters: 1, lo: 12, hi: 16 },
  { kind: 'tree', clusters: 3, lo: 8, hi: 14 },
];

const GATHER_KIND: Record<GuaranteedKind, GatherKind> = {
  berries: 'berries',
  gold: 'gold',
  stone: 'stone',
  tree: 'wood',
};

/** What generation produced for one player. */
export interface StartReport {
  playerId: PlayerId;
  /** Footprint centre of the Town Center. */
  anchor: Vec2;
  townCenterId: EntityId | null;
  /** Top-left tile of the Town Center footprint. */
  townCenterTile: TilePos;
  unitIds: EntityId[];
  /** Every guaranteed node, one entry per cluster. */
  guaranteed: { kind: GuaranteedKind; nodeIds: EntityId[] }[];
}

export interface MapGenReport {
  mapSeed: number;
  /** Number of attempts made (1 = the first seed worked). */
  attempts: number;
  /** `false` only if every attempt failed validation (the last map is kept). */
  valid: boolean;
  starts: StartReport[];
}

// ---------------------------------------------------------------------------
// Working grid
// ---------------------------------------------------------------------------

interface Grid {
  ctx: SimContext;
  width: number;
  height: number;
  /** Group id of the node cluster covering each tile (0 = none). Used for spacing. */
  tag: Int32Array;
  /** Player whose start zone covers the tile (0 = none). */
  zone: Uint8Array;
  walkable: Uint8Array;
  nextGroup: number;
  anchors: Vec2[];
}

function nodeDefFor(data: DataRegistry, kind: GuaranteedKind): NodeDef | undefined {
  return data.nodes.find((n) => n.gatherKind === GATHER_KIND[kind]);
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function startEdge(size: number): number {
  return Math.min(START_EDGE_DISTANCE, Math.floor(size / 4));
}

/** Integer start tiles (the tile at the Town Center's middle) for each player. */
function startTiles(state: GameState, count: number): TilePos[] {
  const size = state.map.width;
  const lo = startEdge(size);
  const hi = size - 1 - lo;
  const mid = Math.floor(size / 2);
  const jitterMax = Math.max(0, Math.min(8, Math.floor((hi - lo) / 4)));
  const spots: TilePos[] = [
    { tx: lo, ty: lo },
    { tx: hi, ty: hi },
    { tx: hi, ty: lo },
    { tx: lo, ty: hi },
    { tx: mid, ty: lo },
    { tx: mid, ty: hi },
    { tx: lo, ty: mid },
    { tx: hi, ty: mid },
  ];
  if (count > spots.length) throw new Error(`mapgen supports at most ${spots.length} players`);
  // Mirror horizontally half of the time; the first two spots stay opposite corners.
  const mirror = rngInt(state.rng, 2) === 1;
  const out: TilePos[] = [];
  for (let i = 0; i < count; i++) {
    const spot = spots[i] as TilePos;
    const jx = rngRange(state.rng, 0, jitterMax);
    const jy = rngRange(state.rng, 0, jitterMax);
    let tx = spot.tx === lo ? lo + jx : spot.tx === hi ? hi - jx : spot.tx;
    const ty = spot.ty === lo ? lo + jy : spot.ty === hi ? hi - jy : spot.ty;
    if (mirror) tx = size - 1 - tx;
    out.push({ tx, ty });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Placement helpers
// ---------------------------------------------------------------------------

/** Node footprint fits: in bounds (1 tile margin), untagged, walkable, in `player`'s or no zone, padding clear. */
function canPlaceNode(g: Grid, tx: number, ty: number, size: number, group: number, player: number): boolean {
  if (tx < 1 || ty < 1 || tx + size > g.width - 1 || ty + size > g.height - 1) return false;
  for (let y = ty - 1; y <= ty + size; y++) {
    for (let x = tx - 1; x <= tx + size; x++) {
      const i = y * g.width + x;
      const t = g.tag[i] as number;
      const inside = x >= tx && x < tx + size && y >= ty && y < ty + size;
      if (inside) {
        if (t !== 0 || g.walkable[i] === 0) return false;
        const z = g.zone[i] as number;
        if (z !== 0 && z !== player) return false;
      } else if (t !== 0 && t !== group) {
        return false;
      }
    }
  }
  return true;
}

function markTiles(g: Grid, tx: number, ty: number, size: number, group: number): void {
  for (let y = ty; y < ty + size; y++) {
    for (let x = tx; x < tx + size; x++) g.tag[y * g.width + x] = group;
  }
}

/** Candidate cluster layouts as top-left offsets, drawn from the rng. */
function fixedLayout(g: Grid, kind: GuaranteedKind): TilePos[] | null {
  const rng = g.ctx.state.rng;
  switch (kind) {
    case 'berries': {
      const wide = rngInt(rng, 2) === 0;
      const out: TilePos[] = [];
      for (let j = 0; j < (wide ? 2 : 3); j++) {
        for (let i = 0; i < (wide ? 3 : 2); i++) out.push({ tx: i - 1, ty: j - 1 });
      }
      return out;
    }
    case 'gold':
      return [
        { tx: -1, ty: -1 },
        { tx: 0, ty: -1 },
        { tx: -1, ty: 0 },
        { tx: 0, ty: 0 },
      ];
    case 'stone': {
      const variants: TilePos[][] = [
        [{ tx: -1, ty: -1 }, { tx: 0, ty: -1 }, { tx: -1, ty: 0 }],
        [{ tx: -1, ty: -1 }, { tx: 0, ty: -1 }, { tx: 0, ty: 0 }],
        [{ tx: -1, ty: -1 }, { tx: -1, ty: 0 }, { tx: 0, ty: 0 }],
        [{ tx: 0, ty: -1 }, { tx: -1, ty: 0 }, { tx: 0, ty: 0 }],
      ];
      return variants[rngInt(rng, variants.length)] as TilePos[];
    }
    case 'tree':
      return null;
  }
}

const DIRS: readonly TilePos[] = [
  { tx: 1, ty: 0 },
  { tx: 0, ty: 1 },
  { tx: -1, ty: 0 },
  { tx: 0, ty: -1 },
];

/**
 * Grow a blob of 1x1 tiles from (cx, cy) by random frontier expansion.
 * Tiles are marked with `group` as they are accepted; the caller unmarks on failure.
 */
function growBlob(
  g: Grid,
  cx: number,
  cy: number,
  count: number,
  group: number,
  player: number,
  accept: (tx: number, ty: number) => boolean,
): TilePos[] {
  const rng = g.ctx.state.rng;
  const tiles: TilePos[] = [];
  if (!canPlaceNode(g, cx, cy, 1, group, player) || !accept(cx, cy)) return tiles;
  tiles.push({ tx: cx, ty: cy });
  markTiles(g, cx, cy, 1, group);
  for (let attempt = 0; attempt < count * 8 && tiles.length < count; attempt++) {
    const from = tiles[rngInt(rng, tiles.length)] as TilePos;
    const d = DIRS[rngInt(rng, 4)] as TilePos;
    const tx = from.tx + d.tx;
    const ty = from.ty + d.ty;
    if (tx < 1 || ty < 1 || tx >= g.width - 1 || ty >= g.height - 1) continue;
    if (g.tag[ty * g.width + tx] === group) continue;
    if (!canPlaceNode(g, tx, ty, 1, group, player) || !accept(tx, ty)) continue;
    tiles.push({ tx, ty });
    markTiles(g, tx, ty, 1, group);
  }
  return tiles;
}

function unmark(g: Grid, tiles: readonly TilePos[], size: number): void {
  for (const t of tiles) markTiles(g, t.tx, t.ty, size, 0);
}

/** Create the node entities for placed tiles and block them in the occupancy grid. */
function commitNodes(g: Grid, def: NodeDef, tiles: readonly TilePos[]): EntityId[] {
  const { state, runtime } = g.ctx;
  const ids: EntityId[] = [];
  for (const t of tiles) {
    ids.push(createNode(state, def.id, t.tx, t.ty, def.amount).id);
    if (def.blocking) setFootprint(runtime.occupancy, g.width, g.height, t, def.footprint, 1);
  }
  return ids;
}

/** Every blob tile has an edge-adjacent tile outside all node groups (so it can be approached). */
function everyTileOpen(g: Grid, tiles: readonly TilePos[]): boolean {
  return tiles.every((t) =>
    DIRS.some((d) => {
      const x = t.tx + d.tx;
      const y = t.ty + d.ty;
      return x >= 0 && y >= 0 && x < g.width && y < g.height && g.tag[y * g.width + x] === 0;
    }),
  );
}

interface GroupOptions {
  kind: GuaranteedKind;
  def: NodeDef;
  player: number;
  /** Picks a candidate cluster centre tile, or `null` to skip this attempt. */
  sampleCenter: () => TilePos | null;
  /** Extra per-node acceptance (distance ranges and so on); called with the node's top-left. */
  nodeOk: (tx: number, ty: number) => boolean;
  attempts: number;
}

/** Try to place one cluster. Returns the node ids, or `null` if no attempt succeeded. */
function placeCluster(g: Grid, o: GroupOptions): EntityId[] | null {
  const size = o.def.footprint;
  for (let attempt = 0; attempt < o.attempts; attempt++) {
    const c = o.sampleCenter();
    if (c === null) continue;
    const group = g.nextGroup++;
    const offsets = fixedLayout(g, o.kind);
    let tiles: TilePos[];
    if (offsets === null) {
      const count = rngRange(g.ctx.state.rng, 6, 9);
      tiles = growBlob(g, c.tx, c.ty, count, group, o.player, o.nodeOk);
      if (tiles.length < 5 || !everyTileOpen(g, tiles)) {
        unmark(g, tiles, 1);
        continue;
      }
    } else {
      tiles = [];
      let ok = true;
      for (const off of offsets) {
        const tx = c.tx + off.tx * size;
        const ty = c.ty + off.ty * size;
        if (!canPlaceNode(g, tx, ty, size, group, o.player) || !o.nodeOk(tx, ty)) {
          ok = false;
          break;
        }
        tiles.push({ tx, ty });
        markTiles(g, tx, ty, size, group);
      }
      if (!ok) {
        unmark(g, tiles, size);
        continue;
      }
    }
    return commitNodes(g, o.def, tiles);
  }
  return null;
}

// ---------------------------------------------------------------------------
// One generation attempt
// ---------------------------------------------------------------------------

/** Ring tiles (clockwise from top-left) one step outside a square footprint. */
function ringAround(tile: TilePos, size: number): TilePos[] {
  const x0 = tile.tx - 1;
  const y0 = tile.ty - 1;
  const x1 = tile.tx + size;
  const y1 = tile.ty + size;
  const ring: TilePos[] = [];
  for (let x = x0; x < x1; x++) ring.push({ tx: x, ty: y0 });
  for (let y = y0; y < y1; y++) ring.push({ tx: x1, ty: y });
  for (let x = x1; x > x0; x--) ring.push({ tx: x, ty: y1 });
  for (let y = y1; y > y0; y--) ring.push({ tx: x0, ty: y });
  return ring;
}

/**
 * Two-player maps: create the point mirror of every node (after all originals, so player 1's nodes have the lower
 * ids) and give player 2 the mirrored guaranteed clusters.
 */
function mirrorNodes(g: Grid, starts: StartReport[]): void {
  const { state, runtime, data } = g.ctx;
  const mirrorOf = new Map<EntityId, EntityId>();
  const originals = state.entities.filter((e) => e.kind === 'node');
  for (const n of originals) {
    if (n.kind !== 'node') continue;
    const def = data.node(n.typeId);
    const t: TilePos = { tx: g.width - n.tile.tx - def.footprint, ty: g.height - n.tile.ty - def.footprint };
    mirrorOf.set(n.id, createNode(state, n.typeId, t.tx, t.ty, n.amount).id);
    if (def.blocking) setFootprint(runtime.occupancy, g.width, g.height, t, def.footprint, 1);
  }
  const second = starts[1];
  if (second === undefined) return;
  for (const grp of starts[0]!.guaranteed) {
    second.guaranteed.push({ kind: grp.kind, nodeIds: grp.nodeIds.map((id) => mirrorOf.get(id) as EntityId) });
  }
}

function attempt(ctx: SimContext, config: GameConfig, seed: number): { starts: StartReport[]; grid: Grid } {
  const { state, data } = ctx;
  const width = state.map.width;
  const height = state.map.height;
  state.mapSeed = seed;
  state.rng = createRng(seed);
  state.entities = [];
  state.nextEntityId = 1;
  state.pathQueue = [];
  if (ctx.runtime.occupancy.length !== width * height) ctx.runtime.occupancy = new Uint8Array(width * height);
  else ctx.runtime.occupancy.fill(0);

  const walkable = new Uint8Array(width * height);
  for (let i = 0; i < walkable.length; i++) {
    const terrain = data.terrains.find((t) => t.id === state.map.tiles[i]);
    walkable[i] = terrain !== undefined && terrain.walkable ? 1 : 0;
  }
  const g: Grid = {
    ctx,
    width,
    height,
    tag: new Int32Array(width * height),
    zone: new Uint8Array(width * height),
    walkable,
    nextGroup: 1,
    anchors: [],
  };
  const rng = state.rng;
  const centerDef = data.buildings.find((b) => b.id === data.start.centerBuilding);
  const fp = centerDef?.footprint ?? 1;
  const starts: StartReport[] = [];
  // Two players (PLAN-M2 4.15): player 1 is chosen exactly as in M1 (same rng draws), player 2 is its point mirror.
  const mirrored = config.players.length === 2;
  const startTilesList = startTiles(state, mirrored ? 1 : config.players.length);
  const playerCount = mirrored ? 2 : startTilesList.length;
  /** Tiles with `tx + ty` above this are the mirrored half (two-player maps; the 3 anti-diagonals between stay empty). */
  const halfLimit = Math.floor((width + height) / 2) - 3;
  const inHalf = (tx: number, ty: number, size: number): boolean => !mirrored || tx + ty + 2 * (size - 1) <= halfLimit;
  /** Point mirror of a square footprint's top-left tile. */
  const mirrorTile = (t: TilePos, size: number): TilePos => ({ tx: width - t.tx - size, ty: height - t.ty - size });
  const mirroredUnits: { typeId: string; x: number; y: number; facing: number }[] = [];

  // Town Centers, start zones and starting units.
  for (let p = 0; p < playerCount; p++) {
    const playerId = p + 1;
    let tcTile: TilePos;
    if (mirrored && p === 1) {
      tcTile = mirrorTile(starts[0]!.townCenterTile, fp);
    } else {
      const s = startTilesList[p] as TilePos;
      tcTile = { tx: s.tx - Math.floor(fp / 2), ty: s.ty - Math.floor(fp / 2) };
    }
    const anchor: Vec2 = { x: tcTile.tx + fp / 2, y: tcTile.ty + fp / 2 };
    g.anchors.push(anchor);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (dist(x + 0.5, y + 0.5, anchor.x, anchor.y) <= CLEAR_RADIUS) g.zone[y * width + x] = playerId;
      }
    }
    const group = g.nextGroup++;
    markTiles(g, tcTile.tx, tcTile.ty, fp, group);
    let townCenterId: EntityId | null = null;
    if (centerDef !== undefined) {
      const tcHp = buildingCombat(ctx, playerId, centerDef.id).maxHp;
      townCenterId = createBuilding(state, centerDef.id, playerId, tcTile.tx, tcTile.ty, true, undefined, data, tcHp).id;
      if (centerDef.blocking) setFootprint(ctx.runtime.occupancy, width, height, tcTile, fp, 1);
    }
    const unitIds: EntityId[] = [];
    if (mirrored && p === 1) {
      for (const u of mirroredUnits) {
        const hp = unitCombat(ctx, playerId, u.typeId).maxHp;
        unitIds.push(createUnit(state, u.typeId, playerId, width - u.x, height - u.y, ((u.facing + 4) % 8) as Facing, hp).id);
      }
    } else {
      const total = data.start.units.reduce((n, u) => n + u.count, 0);
      const ring = ringAround(tcTile, fp);
      const offset = rngInt(rng, ring.length);
      let k = 0;
      for (const u of data.start.units) {
        for (let i = 0; i < u.count; i++, k++) {
          const t = ring[(offset + Math.floor((k * ring.length) / total)) % ring.length] as TilePos;
          const hp = unitCombat(ctx, playerId, u.unitType).maxHp;
          unitIds.push(createUnit(state, u.unitType, playerId, t.tx + 0.5, t.ty + 0.5, 1, hp).id);
          if (mirrored) mirroredUnits.push({ typeId: u.unitType, x: t.tx + 0.5, y: t.ty + 0.5, facing: 1 });
        }
      }
    }
    starts.push({ playerId, anchor, townCenterId, townCenterTile: tcTile, unitIds, guaranteed: [] });
  }

  // Guaranteed resources near each start.
  for (const start of mirrored ? starts.slice(0, 1) : starts) {
    for (const spec of GUARANTEED) {
      const def = nodeDefFor(data, spec.kind);
      if (def === undefined) continue;
      const { anchor } = start;
      for (let c = 0; c < spec.clusters; c++) {
        const ids = placeCluster(g, {
          kind: spec.kind,
          def,
          player: start.playerId,
          attempts: 400,
          sampleCenter: () => {
            const tx = Math.floor(anchor.x) + rngRange(rng, -spec.hi, spec.hi);
            const ty = Math.floor(anchor.y) + rngRange(rng, -spec.hi, spec.hi);
            const d = dist(tx + 0.5, ty + 0.5, anchor.x, anchor.y);
            return d >= spec.lo && d <= spec.hi ? { tx, ty } : null;
          },
          nodeOk: (tx, ty) => {
            const d = dist(tx + def.footprint / 2, ty + def.footprint / 2, anchor.x, anchor.y);
            return d >= spec.lo && d <= spec.hi;
          },
        });
        if (ids !== null) start.guaranteed.push({ kind: spec.kind, nodeIds: ids });
      }
    }
  }
  // Reserve the mirrored guaranteed clusters (entities are created at the end) so nothing else lands on them.
  if (mirrored) {
    for (const grp of starts[0]!.guaranteed) {
      const group = g.nextGroup++;
      for (const id of grp.nodeIds) {
        const n = state.entities.find((e) => e.id === id);
        if (n === undefined || n.kind !== 'node') continue;
        const size = data.node(n.typeId).footprint;
        const m = mirrorTile(n.tile, size);
        markTiles(g, m.tx, m.ty, size, group);
      }
    }
  }

  // Scattered extra clusters, spaced apart and away from every start.
  const area = (width * height) / 14400;
  const scatterCenters: TilePos[] = [];
  const scatter: { kind: GuaranteedKind; count: number }[] = [
    { kind: 'gold', count: Math.max(1, Math.round(4 * area)) },
    { kind: 'stone', count: Math.max(1, Math.round(3 * area)) },
    { kind: 'berries', count: Math.max(1, Math.round(4 * area)) },
  ];
  for (const spec of scatter) {
    const def = nodeDefFor(data, spec.kind);
    if (def === undefined) continue;
    const count = mirrored ? Math.ceil(spec.count / 2) : spec.count;
    for (let c = 0; c < count; c++) {
      const chosen: { tile: TilePos | null } = { tile: null };
      const ids = placeCluster(g, {
        kind: spec.kind,
        def,
        player: 0,
        attempts: 80,
        sampleCenter: () => {
          const tx = rngRange(rng, 4, width - 5);
          const ty = rngRange(rng, 4, height - 5);
          if (g.anchors.some((a) => dist(tx + 0.5, ty + 0.5, a.x, a.y) < 20)) return null;
          if (scatterCenters.some((s) => dist(tx, ty, s.tx, s.ty) < 14)) return null;
          chosen.tile = { tx, ty };
          return chosen.tile;
        },
        nodeOk: (tx, ty) => inHalf(tx, ty, def.footprint),
      });
      if (ids !== null && chosen.tile !== null) scatterCenters.push(chosen.tile);
    }
  }

  // Forests: seeded blobs until trees cover roughly FOREST_COVERAGE of the map.
  const treeDef = nodeDefFor(data, 'tree');
  if (treeDef !== undefined) {
    const treeWeight = mirrored ? 2 : 1;
    let trees = state.entities.filter((e) => e.kind === 'node' && e.typeId === treeDef.id).length * treeWeight;
    const target = Math.floor(width * height * FOREST_COVERAGE);
    for (let i = 0; i < 900 && trees < target; i++) {
      const cx = rngRange(rng, 2, width - 3);
      const cy = rngRange(rng, 2, height - 3);
      const group = g.nextGroup++;
      const count = rngRange(rng, 20, 80);
      const tiles = growBlob(
        g,
        cx,
        cy,
        count,
        group,
        0,
        (tx, ty) => inHalf(tx, ty, 1) && g.anchors.every((a) => dist(tx + 0.5, ty + 0.5, a.x, a.y) >= 15),
      );
      if (tiles.length < 10) {
        unmark(g, tiles, 1);
        continue;
      }
      commitNodes(g, treeDef, tiles);
      trees += tiles.length * treeWeight;
    }
  }

  if (mirrored) mirrorNodes(g, starts);
  return { starts, grid: g };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Edge-adjacent tiles of a square footprint that are inside the map. */
function perimeter(tile: TilePos, size: number, width: number, height: number): TilePos[] {
  const out: TilePos[] = [];
  for (let i = 0; i < size; i++) {
    out.push({ tx: tile.tx + i, ty: tile.ty - 1 });
    out.push({ tx: tile.tx + i, ty: tile.ty + size });
    out.push({ tx: tile.tx - 1, ty: tile.ty + i });
    out.push({ tx: tile.tx + size, ty: tile.ty + i });
  }
  return out.filter((t) => t.tx >= 0 && t.ty >= 0 && t.tx < width && t.ty < height);
}

/**
 * Flood-fill (4-connected) over free walkable tiles from the first start's
 * Town Center. Returns the reached mask and the number of free tiles.
 */
function floodFrom(ctx: SimContext, g: Grid, seeds: readonly TilePos[]): { reached: Uint8Array; free: number } {
  const { width, height } = g;
  const occ = ctx.runtime.occupancy;
  const isFree = (i: number): boolean => occ[i] === 0 && g.walkable[i] === 1;
  let free = 0;
  for (let i = 0; i < occ.length; i++) if (isFree(i)) free++;
  const reached = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (const s of seeds) {
    const i = s.ty * width + s.tx;
    if (isFree(i) && reached[i] === 0) {
      reached[i] = 1;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++] as number;
    const x = i % width;
    const y = (i - x) / width;
    const neighbours = [
      x > 0 ? i - 1 : -1,
      x < width - 1 ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y < height - 1 ? i + width : -1,
    ];
    for (const n of neighbours) {
      if (n >= 0 && reached[n] === 0 && isFree(n)) {
        reached[n] = 1;
        queue[tail++] = n;
      }
    }
  }
  return { reached, free };
}

/** Whether the generated map satisfies the plan 4.2 validation rules. */
function validate(ctx: SimContext, g: Grid, starts: readonly StartReport[]): boolean {
  const { state, data } = ctx;
  const { width, height } = g;
  const edge = startEdge(width);
  for (const s of starts) {
    const a = s.anchor;
    if (a.x < edge || a.y < edge || width - a.x < edge || height - a.y < edge) return false;;
  }
  if (starts.length === 0) return true;

  const centerDef = data.buildings.find((b) => b.id === data.start.centerBuilding);
  const fp = centerDef?.footprint ?? 1;
  const seedsOf = (s: StartReport): TilePos[] =>
    perimeter({ tx: Math.round(s.anchor.x - fp / 2), ty: Math.round(s.anchor.y - fp / 2) }, fp, width, height);
  const { reached, free } = floodFrom(ctx, g, seedsOf(starts[0] as StartReport));
  let reachedCount = 0;
  for (let i = 0; i < reached.length; i++) reachedCount += reached[i] as number;
  if (free > 0 && reachedCount < free * MIN_REACHABLE_SHARE) return false;

  const reachable = (t: TilePos): boolean => reached[t.ty * width + t.tx] === 1;
  for (const s of starts) {
    if (!seedsOf(s).some(reachable)) return false;;
    for (const unitId of s.unitIds) {
      const u = state.entities.find((e) => e.id === unitId);
      if (u === undefined || u.kind !== 'unit') return false;
      if (!reachable({ tx: Math.floor(u.pos.x), ty: Math.floor(u.pos.y) })) return false;;
    }
    for (const group of s.guaranteed) {
      for (const id of group.nodeIds) {
        const n = state.entities.find((e) => e.id === id);
        if (n === undefined || n.kind !== 'node') return false;
        const size = data.node(n.typeId).footprint;
        if (!perimeter(n.tile, size, width, height).some(reachable)) return false;;
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Like `generateMap`, but returns what was generated (start anchors and the
 * ids of guaranteed resources) so tests and tools can check the result.
 */
export function generateMapReport(ctx: SimContext, config: GameConfig): MapGenReport {
  const baseSeed = ctx.state.seed;
  let last: { starts: StartReport[]; grid: Grid } | null = null;
  for (let k = 0; k < MAX_MAP_ATTEMPTS; k++) {
    last = attempt(ctx, config, (baseSeed + k) >>> 0);
    if (validate(ctx, last.grid, last.starts)) {
      return { mapSeed: ctx.state.mapSeed, attempts: k + 1, valid: true, starts: last.starts };
    }
  }
  return {
    mapSeed: ctx.state.mapSeed,
    attempts: MAX_MAP_ATTEMPTS,
    valid: false,
    starts: (last as { starts: StartReport[] }).starts,
  };
}

/**
 * Populate a fresh state with resource nodes, each player's Town Center and
 * starting units, using only `ctx.state.rng`. Sets `state.mapSeed` to the seed
 * that produced the final map (`seed + k` after k failed validations).
 */
export function generateMap(ctx: SimContext, config: GameConfig): void {
  generateMapReport(ctx, config);
}
