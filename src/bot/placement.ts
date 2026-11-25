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
export function floodReach(solid: Blocked, sx: number, sy: number): Uint8Array {
  const { width, height, cells } = solid;
  const seen = new Uint8Array(width * height);
  const queue: number[] = [];
  const start = sy * width + sx;
  if (sx < 0 || sy < 0 || sx >= width || sy >= height || cells[start] !== 0) return seen;
  seen[start] = 1;
  queue.push(start);
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] as number;
    const x = i % width;
    const y = (i - x) / width;
    const next = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1];
    for (const j of next) {
      if (j < 0 || seen[j] === 1 || cells[j] !== 0) continue;
      seen[j] = 1;
      queue.push(j);
    }
  }
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
}

export interface PlacementEnv {
  view: BotView;
  query: SimQuery;
  data: DataRegistry;
  playerId: PlayerId;
  blocked: Blocked;
}

const MAX_CONFIRMS = 24;

/** Best legal top-left tile for the request, or `null`. Does not reserve it. */
export function findSpot(env: PlacementEnv, req: SpotRequest): { tx: number; ty: number } | null {
  const size = env.data.building(req.type).footprint;
  const edge = req.edge ?? 3;
  const { width, height } = env.blocked;
  const x0 = Math.max(edge, Math.floor(req.near.x - req.maxDist));
  const x1 = Math.min(width - edge - size, Math.ceil(req.near.x + req.maxDist));
  const y0 = Math.max(edge, Math.floor(req.near.y - req.maxDist));
  const y1 = Math.min(height - edge - size, Math.ceil(req.near.y + req.maxDist));
  const candidates: { score: number; index: number; tx: number; ty: number }[] = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!env.blocked.isFree(tx, ty, size, req.gap)) continue;
      const score = req.score(tx + size / 2, ty + size / 2);
      if (!Number.isFinite(score)) continue;
      candidates.push({ score, index: ty * width + tx, tx, ty });
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.index - b.index);
  for (const c of candidates.slice(0, MAX_CONFIRMS)) {
    const result = env.query.canPlace(env.playerId, req.type, c.tx, c.ty);
    if (result.availability.available && result.tiles.every((t) => t === null)) return { tx: c.tx, ty: c.ty };
  }
  return null;
}
