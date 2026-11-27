/**
 * Isometric projection (plan 2.4). The ONLY place projection maths lives.
 *
 * World space is in tiles; screen space here is "world pixels" at 1x zoom
 * with the origin at world (0, 0) (the top vertex of tile (0, 0)). The camera
 * (zoom, pan, canvas offset) is applied on top of these functions.
 *
 *   screenX = (x - y) * TILE_W / 2      (= 32 per tile)
 *   screenY = (x + y) * TILE_H / 2      (= 16 per tile)
 *
 * +x runs down-right on screen, +y runs down-left.
 */

import { TILE_H, TILE_W, type TilePos, type Vec2 } from '../../sim/types';

const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;

export interface ScreenPoint {
  x: number;
  y: number;
}

/** World (tiles) -> screen (world pixels at 1x). */
export function worldToScreen(x: number, y: number): ScreenPoint {
  return { x: (x - y) * HALF_W, y: (x + y) * HALF_H };
}

/** Screen pixels per tile of height above the ground (the rendered art's projection: `HALF_W * sqrt(1.5)`). */
export const HEIGHT_PX = HALF_W * Math.sqrt(1.5);

/** World (tiles) at height `z` tiles above the ground -> screen (world pixels at 1x). Projectiles in flight. */
export function worldToScreenZ(x: number, y: number, z: number): ScreenPoint {
  return { x: (x - y) * HALF_W, y: (x + y) * HALF_H - z * HEIGHT_PX };
}

/** Screen (world pixels at 1x) -> world (tiles). Exact inverse of worldToScreen. */
export function screenToWorld(sx: number, sy: number): Vec2 {
  const a = sx / HALF_W; // x - y
  const b = sy / HALF_H; // x + y
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** The tile containing a world point. */
export function worldToTile(x: number, y: number): TilePos {
  return { tx: Math.floor(x), ty: Math.floor(y) };
}

/** Screen (world pixels at 1x) -> tile under that point. */
export function screenToTile(sx: number, sy: number): TilePos {
  const w = screenToWorld(sx, sy);
  return worldToTile(w.x, w.y);
}

/** Centre of a tile in world space. */
export function tileCenter(tx: number, ty: number): Vec2 {
  return { x: tx + 0.5, y: ty + 0.5 };
}

/** Centre of a square footprint with top-left tile (tx, ty) and side `size`. */
export function footprintCenter(tx: number, ty: number, size: number): Vec2 {
  return { x: tx + size / 2, y: ty + size / 2 };
}

/**
 * Screen-space corners of a tile diamond (or square footprint of side `size`),
 * in order top, right, bottom, left.
 */
export function tileDiamond(tx: number, ty: number, size = 1): [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint] {
  return [
    worldToScreen(tx, ty),
    worldToScreen(tx + size, ty),
    worldToScreen(tx + size, ty + size),
    worldToScreen(tx, ty + size),
  ];
}

/**
 * Draw-order key: `x + y` of the entity's anchor (unit position, footprint
 * centre for buildings and nodes). Sort ascending; break ties by entity id.
 */
export function depthKey(x: number, y: number): number {
  return x + y;
}

/** Comparator for draw order: depth key, then id. */
export function compareDepth(a: { depth: number; id: number }, b: { depth: number; id: number }): number {
  return a.depth - b.depth || a.id - b.id;
}

/** Screen-space bounding box (world pixels) of a whole map of the given size. */
export function mapScreenBounds(width: number, height: number): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: worldToScreen(0, height).x,
    maxX: worldToScreen(width, 0).x,
    minY: 0,
    maxY: worldToScreen(width, height).y,
  };
}
