/**
 * Site selection for buildings. Candidates are generated and scored from the bot's own view, then confirmed
 * with the sim's `canPlace` (the same function the sim validates with), so a chosen site is always legal.
 */

import type { BotView } from './view';
import type { BuildingId, PlayerId, SimQuery } from '../sim';
import type { DataRegistry } from '../data';

/** Per-tile "taken by a building, farm or node" grid, kept up to date as the decision places buildings. */
export class Blocked {
  readonly cells: Uint8Array;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.cells = new Uint8Array(width * height);
  }

  mark(tx: number, ty: number, size: number): void {
    for (let y = ty; y < ty + size; y++) {
      for (let x = tx; x < tx + size; x++) {
        if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.cells[y * this.width + x] = 1;
      }
    }
  }

  /** True if every tile of the footprint grown by `gap` tiles is free (out-of-map counts as blocked). */
  isFree(tx: number, ty: number, size: number, gap: number): boolean {
    for (let y = ty - gap; y < ty + size + gap; y++) {
      for (let x = tx - gap; x < tx + size + gap; x++) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
        if (this.cells[y * this.width + x] !== 0) return false;
      }
    }
    return true;
  }
}

/** Everything that takes tiles, farms included (they do not block walking, but nothing else may be built on them). */
export function blockedFromView(view: BotView): Blocked {
  const blocked = new Blocked(view.mapWidth, view.mapHeight);
  for (const n of view.nodes) blocked.mark(n.tx, n.ty, n.size);
  for (const b of view.buildings) blocked.mark(b.tx, b.ty, b.size);
  return blocked;
}

/** Tiles units cannot walk through: nodes and buildings other than farms. */
export function solidFromView(view: BotView): Blocked {
  const solid = new Blocked(view.mapWidth, view.mapHeight);
  for (const n of view.nodes) solid.mark(n.tx, n.ty, n.size);
  for (const b of view.buildings) if (b.typeId !== 'farm') solid.mark(b.tx, b.ty, b.size);
  return solid;
}

/** Flood fill (4-connected) over walkable tiles from `(sx, sy)`. */
export function floodReach(solid: Blocked, sx: number, sy: number, ops?: { n: number }): Uint8Array {
  const { width, height, cells } = solid;
  const seen = new Uint8Array(width * height);
  const queue: number[] = [];
  const start = sy * width + sx;
  if (sx < 0 || sy < 0 || sx >= width || sy >= height || cells[start] !== 0) return seen;
  seen[start] = 1;
  queue.push(start);
  const visit = (j: number): void => {
    if (seen[j] === 1 || cells[j] !== 0) return;
    seen[j] = 1;
    queue.push(j);
  };
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] as number;
    const x = i % width;
    const y = (i - x) / width;
    // Same order as before: left, right, up, down.
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (y > 0) visit(i - width);
    if (y < height - 1) visit(i + width);
  }
  if (ops !== undefined) ops.n += queue.length * 4;
  return seen;
}

/** Is any tile of the ring around the footprint (corners included) reachable? */
export function ringReachable(reach: Uint8Array, width: number, height: number, tx: number, ty: number, size: number): boolean {
  for (let y = ty - 1; y <= ty + size; y++) {
    for (let x = tx - 1; x <= tx + size; x++) {
      if (x >= tx && x < tx + size && y >= ty && y < ty + size) continue;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (reach[y * width + x] === 1) return true;
    }
  }
  return false;
}

export interface SpotRequest {
  type: BuildingId;
  /** Candidates are searched within `maxDist` (Chebyshev, tiles) of this point. */
  near: { x: number; y: number };
  maxDist: number;
  /** Free tiles required around the footprint. */
  gap: number;
  /** Lower is better. Ties go to the lowest tile index. */
  score: (cx: number, cy: number) => number;
  /** Keep this many tiles from the map edge. */
  edge?: number;
  /** Operations one `score` call costs (its inner loop), for the operation count; default 1. */
  scoreCost?: number;
}

export interface PlacementEnv {
  view: BotView;
  query: SimQuery;
  data: DataRegistry;
  playerId: PlayerId;
  blocked: Blocked;
  /** Operation counter (the AI's decision budget, PLAN-M2 6.7): footprint cells tested and candidates scored. */
  ops?: { n: number };
}

const MAX_CONFIRMS = 24;

type Candidate = { score: number; index: number; tx: number; ty: number };

/** Candidate order: score, then tile index (unique, so the order is total). */
function before(a: Candidate, b: Candidate): boolean {
  return a.score < b.score || (a.score === b.score && a.index < b.index);
}

/**
 * Best legal top-left tile for the request, or `null`. Does not reserve it.
 *
 * Free footprints are tested in constant time with a summed-area table of the blocked grid (built once per call over
 * the search window), and only the MAX_CONFIRMS best candidates are kept (insertion into a short sorted list), so a
 * call costs about the window's tiles plus the scored candidates; the result is exactly that of testing every
 * footprint tile by tile and sorting every candidate.
 */
export function findSpot(env: PlacementEnv, req: SpotRequest): { tx: number; ty: number } | null {
  const size = env.data.building(req.type).footprint;
  const edge = req.edge ?? 3;
  const { width, height, cells } = env.blocked;
  const x0 = Math.max(edge, Math.floor(req.near.x - req.maxDist));
  const x1 = Math.min(width - edge - size, Math.ceil(req.near.x + req.maxDist));
  const y0 = Math.max(edge, Math.floor(req.near.y - req.maxDist));
  const y1 = Math.min(height - edge - size, Math.ceil(req.near.y + req.maxDist));
  if (x1 < x0 || y1 < y0) return null;
  const g = req.gap;
  // Summed-area table over the grown window [wx0, wx1) x [wy0, wy1), clamped to the map; sat has one extra row and column.
  const wx0 = Math.max(0, x0 - g);
  const wy0 = Math.max(0, y0 - g);
  const wx1 = Math.min(width, x1 + size + g);
  const wy1 = Math.min(height, y1 + size + g);
  const sw = wx1 - wx0 + 1;
  const sat = new Int32Array(sw * (wy1 - wy0 + 1));
  for (let y = wy0; y < wy1; y++) {
    let row = 0;
    const base = (y - wy0 + 1) * sw;
    for (let x = wx0; x < wx1; x++) {
      row += cells[y * width + x]! !== 0 ? 1 : 0;
      sat[base + (x - wx0 + 1)] = sat[base - sw + (x - wx0 + 1)]! + row;
    }
  }
  const free = (tx: number, ty: number): boolean => {
    const ax = tx - g;
    const ay = ty - g;
    const bx = tx + size + g;
    const by = ty + size + g;
    if (ax < 0 || ay < 0 || bx > width || by > height) return false;
    const i0 = (ay - wy0) * sw;
    const i1 = (by - wy0) * sw;
    return sat[i1 + (bx - wx0)]! - sat[i0 + (bx - wx0)]! - sat[i1 + (ax - wx0)]! + sat[i0 + (ax - wx0)]! === 0;
  };
  const best: Candidate[] = [];
  let scored = 0;
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!free(tx, ty)) continue;
      const score = req.score(tx + size / 2, ty + size / 2);
      scored++;
      if (!Number.isFinite(score)) continue;
      const c = { score, index: ty * width + tx, tx, ty };
      if (best.length === MAX_CONFIRMS && !before(c, best[MAX_CONFIRMS - 1]!)) continue;
      let i = best.length;
      if (i === MAX_CONFIRMS) i--;
      else best.push(c);
      while (i > 0 && before(c, best[i - 1]!)) {
        best[i] = best[i - 1]!;
        i--;
      }
      best[i] = c;
    }
  }
  if (env.ops !== undefined) env.ops.n += (wx1 - wx0) * (wy1 - wy0) + (x1 - x0 + 1) * (y1 - y0 + 1) + scored * (req.scoreCost ?? 1);
  for (const c of best) {
    const result = env.query.canPlace(env.playerId, req.type, c.tx, c.ty);
    if (result.availability.available && result.tiles.every((t) => t === null)) return { tx: c.tx, ty: c.ty };
  }
  return null;
}
