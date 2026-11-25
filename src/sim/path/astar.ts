/**
 * A* on the 8-connected tile grid (plan 4.3). Owned by WP2.
 *
 * - Integer costs: 10 per straight step, 14 per diagonal step.
 * - Octile heuristic `10 * max(dx, dy) + 4 * min(dx, dy)` to the goal
 *   rectangle (admissible and consistent; no Math functions beyond min/max).
 * - No corner cutting: a diagonal step needs both orthogonal tiles walkable.
 * - Open-list ties: lowest f, then lowest h, then lowest tile index.
 * - Unreachable goal: returns the path to the expanded tile with the lowest
 *   heuristic distance to the goal (ties: lowest g, then lowest tile index).
 * - Expansions (closed nodes) are counted for the per-tick budget.
 */

import { isWalkable, tileAt, type PathGrid } from './grid';
import { NodeHeap } from './heap';
import type { PathGoal, TilePos } from '../types';

export const STRAIGHT_COST = 10;
export const DIAGONAL_COST = 14;

export interface AStarResult {
  /** Tile indices (`ty * width + tx`) from the search start to the end tile. Empty if there is no walkable start. */
  tiles: number[];
  /** The end tile satisfies the goal. */
  reached: boolean;
  /** The search stopped because it hit `maxExpansions`; `tiles` leads to the best tile so far. */
  capped: boolean;
  /** Nodes expanded (budget units). */
  expanded: number;
}

/** Goal as a rectangle for the heuristic plus a membership test. */
interface GoalShape {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Footprint interior (not a goal) for footprint goals; empty (x0 > x1) for tile goals. */
  fx0: number;
  fy0: number;
  fx1: number;
  fy1: number;
}

function goalShape(grid: PathGrid, goal: PathGoal): GoalShape {
  if (goal.kind === 'point') {
    const t = tileAt(grid, goal.x, goal.y);
    return { x0: t.tx, y0: t.ty, x1: t.tx, y1: t.ty, fx0: 1, fy0: 1, fx1: 0, fy1: 0 };
  }
  const { tx, ty } = goal.tile;
  const s = goal.size;
  return { x0: tx - 1, y0: ty - 1, x1: tx + s, y1: ty + s, fx0: tx, fy0: ty, fx1: tx + s - 1, fy1: ty + s - 1 };
}

function isGoalTile(g: GoalShape, x: number, y: number): boolean {
  if (x < g.x0 || x > g.x1 || y < g.y0 || y > g.y1) return false;
  return !(x >= g.fx0 && x <= g.fx1 && y >= g.fy0 && y <= g.fy1);
}

/** Octile distance from (x, y) to the goal rectangle, in cost units. */
function heuristic(g: GoalShape, x: number, y: number): number {
  const dx = Math.max(0, g.x0 - x, x - g.x1);
  const dy = Math.max(0, g.y0 - y, y - g.y1);
  return STRAIGHT_COST * Math.max(dx, dy) + (DIAGONAL_COST - STRAIGHT_COST) * Math.min(dx, dy);
}

/** Octile distance between two tiles, in cost units. */
export function octileDistance(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return STRAIGHT_COST * Math.max(dx, dy) + (DIAGONAL_COST - STRAIGHT_COST) * Math.min(dx, dy);
}

/**
 * Nearest walkable tile to (tx, ty) by squared distance, ties by lowest tile
 * index; the tile itself if walkable. `null` if the grid has no walkable tile.
 */
export function nearestWalkableTile(grid: PathGrid, tx: number, ty: number): TilePos | null {
  if (isWalkable(grid, tx, ty)) return { tx, ty };
  const maxR = Math.max(grid.width, grid.height) + Math.max(Math.abs(tx), Math.abs(ty));
  let best: TilePos | null = null;
  let bestD = 0;
  for (let r = 1; r <= maxR; r++) {
    // Every tile in ring r is at least r^2 away (squared); stop once no ring can beat the best.
    if (best !== null && r * r > bestD) break;
    const cand = nearestInRing(grid, tx, ty, r);
    if (cand === null) continue;
    const d = (cand.tx - tx) * (cand.tx - tx) + (cand.ty - ty) * (cand.ty - ty);
    if (
      best === null ||
      d < bestD ||
      (d === bestD && cand.ty * grid.width + cand.tx < best.ty * grid.width + best.tx)
    ) {
      best = cand;
      bestD = d;
    }
  }
  return best;
}

function nearestInRing(grid: PathGrid, tx: number, ty: number, r: number): TilePos | null {
  let best: TilePos | null = null;
  let bestD = 0;
  let bestI = 0;
  const consider = (x: number, y: number): void => {
    if (!isWalkable(grid, x, y)) return;
    const d = (x - tx) * (x - tx) + (y - ty) * (y - ty);
    const i = y * grid.width + x;
    if (best === null || d < bestD || (d === bestD && i < bestI)) {
      best = { tx: x, ty: y };
      bestD = d;
      bestI = i;
    }
  };
  for (let x = tx - r; x <= tx + r; x++) {
    consider(x, ty - r);
    consider(x, ty + r);
  }
  for (let y = ty - r + 1; y <= ty + r - 1; y++) {
    consider(tx - r, y);
    consider(tx + r, y);
  }
  return best;
}

const NEIGHBOUR_DX = new Int8Array([1, 0, -1, 0, 1, -1, -1, 1]);
const NEIGHBOUR_DY = new Int8Array([0, 1, 0, -1, 1, 1, -1, -1]);
/** Orthogonal neighbours (bit 0 E, 1 S, 2 W, 3 N) a diagonal step SE, SW, NW, NE passes between. */
const DIAGONAL_NEEDS = new Int8Array([1 | 2, 4 | 2, 4 | 8, 1 | 8]);
const neighbourOffsets = new Int32Array(8);

// Scratch buffers shared by all searches (not state; reset by generation stamps).
let scratchSize = 0;
let gScore = new Int32Array(0);
let parent = new Int32Array(0);
let openStamp = new Uint32Array(0);
let closedStamp = new Uint32Array(0);
let generation = 0;
const heap = new NodeHeap(4096);

function prepareScratch(n: number): number {
  if (n > scratchSize) {
    scratchSize = n;
    gScore = new Int32Array(n);
    parent = new Int32Array(n);
    openStamp = new Uint32Array(n);
    closedStamp = new Uint32Array(n);
    generation = 0;
  }
  generation++;
  if (generation >= 0xffffffff) {
    openStamp.fill(0);
    closedStamp.fill(0);
    generation = 1;
  }
  heap.clear();
  return generation;
}

/**
 * Find a path from `start` to `goal`. A blocked start (e.g. a unit standing
 * on a fresh foundation) searches from the nearest walkable tile instead, and
 * the returned `tiles` then begin at that tile.
 */
export function findPath(
  grid: PathGrid,
  start: TilePos,
  goal: PathGoal,
  maxExpansions: number = Number.MAX_SAFE_INTEGER,
): AStarResult {
  const { width } = grid;
  const clamped = tileAt(grid, start.tx, start.ty);
  const begin = nearestWalkableTile(grid, clamped.tx, clamped.ty);
  if (begin === null) return { tiles: [], reached: false, capped: false, expanded: 0 };

  const g = goalShape(grid, goal);
  const gen = prepareScratch(grid.width * grid.height);
  const startIndex = begin.ty * width + begin.tx;
  gScore[startIndex] = 0;
  parent[startIndex] = -1;
  openStamp[startIndex] = gen;
  heap.push(startIndex, heuristic(g, begin.tx, begin.ty), heuristic(g, begin.tx, begin.ty));

  let expanded = 0;
  let best = startIndex;
  let bestH = Number.MAX_SAFE_INTEGER;
  let bestG = 0;
  let reached = false;
  let capped = false;

  // Hot loop: locals and typed tables instead of repeated property reads and
  // helper calls. The moves and their order are exactly those of `canStep`
  // over DIR_X/DIR_Y: the four orthogonal steps (E, S, W, N) first, then the
  // four diagonals (SE, SW, NW, NE), each of which also needs its two
  // orthogonal neighbours walkable.
  const blocked = grid.blocked;
  const height = grid.height;
  const gx0 = g.x0;
  const gy0 = g.y0;
  const gx1 = g.x1;
  const gy1 = g.y1;
  const diff = DIAGONAL_COST - STRAIGHT_COST;
  const open = openStamp;
  const closed = closedStamp;
  const gs = gScore;
  const par = parent;
  const offsets = neighbourOffsets;
  offsets[0] = 1;
  offsets[1] = width;
  offsets[2] = -1;
  offsets[3] = -width;
  offsets[4] = width + 1;
  offsets[5] = width - 1;
  offsets[6] = -width - 1;
  offsets[7] = 1 - width;

  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur] === gen) continue;
    if (expanded >= maxExpansions) {
      capped = true;
      break;
    }
    closed[cur] = gen;
    expanded++;
    const cx = cur % width;
    const cy = (cur - cx) / width;
    const curG = gs[cur]!;
    const h = heuristic(g, cx, cy);
    if (h < bestH || (h === bestH && (curG < bestG || (curG === bestG && cur < best)))) {
      best = cur;
      bestH = h;
      bestG = curG;
    }
    if (isGoalTile(g, cx, cy)) {
      best = cur;
      reached = true;
      break;
    }
    // Bit d of `ok` says the orthogonal neighbour d (0 E, 1 S, 2 W, 3 N) is walkable.
    let ok = 0;
    if (cx + 1 < width && blocked[cur + 1] === 0) ok |= 1;
    if (cy + 1 < height && blocked[cur + width] === 0) ok |= 2;
    if (cx > 0 && blocked[cur - 1] === 0) ok |= 4;
    if (cy > 0 && blocked[cur - width] === 0) ok |= 8;
    for (let d = 0; d < 8; d++) {
      let ng: number;
      if (d < 4) {
        if ((ok & (1 << d)) === 0) continue;
        ng = curG + STRAIGHT_COST;
      } else {
        const need = DIAGONAL_NEEDS[d - 4] as number;
        if ((ok & need) !== need) continue;
        ng = curG + DIAGONAL_COST;
      }
      const ni = cur + (offsets[d] as number);
      if (d >= 4 && blocked[ni] !== 0) continue;
      if (closed[ni] === gen) continue;
      if (open[ni] === gen && ng >= gs[ni]!) continue;
      open[ni] = gen;
      gs[ni] = ng;
      par[ni] = cur;
      const nx = cx + (NEIGHBOUR_DX[d] as number);
      const ny = cy + (NEIGHBOUR_DY[d] as number);
      const dx = nx < gx0 ? gx0 - nx : nx > gx1 ? nx - gx1 : 0;
      const dy = ny < gy0 ? gy0 - ny : ny > gy1 ? ny - gy1 : 0;
      const nh = dx > dy ? STRAIGHT_COST * dx + diff * dy : STRAIGHT_COST * dy + diff * dx;
      heap.push(ni, ng + nh, nh);
    }
  }

  const tiles: number[] = [];
  for (let i = best; i !== -1; i = parent[i]!) tiles.push(i);
  tiles.reverse();
  return { tiles, reached, capped, expanded };
}
