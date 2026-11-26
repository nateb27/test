/**
 * The renderer's camera: the game's isometric projection (src/client/render/iso.ts) extended with height.
 *
 *   screenX = (x - y) * TILE_W / 2
 *   screenY = (x + y) * TILE_H / 2 - z * ZS
 *
 * A view ray through a screen pixel runs along (1, 1, K) in world space: moving t along it changes neither screen
 * coordinate. t = 0 is the ground point (z = 0) under that pixel.
 */

import { TILE_H, TILE_W } from '../../../sim/types';

export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;
/** Screen pixels per tile of height. */
export const ZS = HALF_W * Math.sqrt(1.5);
/** View ray z step per unit of t. */
export const K = (2 * HALF_H) / ZS;

export function projectX(x: number, y: number): number {
  return (x - y) * HALF_W;
}

export function projectY(x: number, y: number, z: number): number {
  return (x + y) * HALF_H - z * ZS;
}

/** Ground point (z = 0) under a screen point, in world tiles. */
export function groundAt(sx: number, sy: number): { x: number; y: number } {
  const a = sx / HALF_W;
  const b = sy / HALF_H;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}
