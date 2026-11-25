/**
 * Minimap geometry (pure). The whole map is drawn as the same 2:1 isometric
 * diamond the game uses, scaled to fit the canvas:
 *
 *   px = ox + (x - y) * k          py = oy + (x + y) * k / 2
 *
 * (x, y) are world tiles; (px, py) are CSS pixels inside the minimap.
 */

import type { Vec2 } from '../../../sim/types';

export interface MinimapView {
  mapW: number;
  mapH: number;
  /** Canvas size in CSS px. */
  width: number;
  height: number;
  /** Pixels per tile along one diamond edge's horizontal component. */
  k: number;
  /** Pixel position of world (0, 0), the top vertex of the diamond. */
  ox: number;
  oy: number;
}

/** Fit the map diamond into `width` x `height` with `pad` px around it. */
export function createMinimapView(mapW: number, mapH: number, width: number, height: number, pad = 2): MinimapView {
  const span = Math.max(1, mapW + mapH);
  const k = Math.max(0.01, Math.min((width - 2 * pad) / span, (height - 2 * pad) / (span / 2)));
  const contentW = span * k;
  const contentH = contentW / 2;
  return {
    mapW,
    mapH,
    width,
    height,
    k,
    ox: (width - contentW) / 2 + mapH * k,
    oy: (height - contentH) / 2,
  };
}

export function worldToMinimap(v: MinimapView, x: number, y: number): Vec2 {
  return { x: v.ox + (x - y) * v.k, y: v.oy + ((x + y) * v.k) / 2 };
}

/** Exact inverse of `worldToMinimap` (not clamped to the map). */
export function minimapToWorld(v: MinimapView, px: number, py: number): Vec2 {
  const a = (px - v.ox) / v.k; // x - y
  const b = ((py - v.oy) * 2) / v.k; // x + y
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** Keep a world point inside the map. */
export function clampToMap(v: MinimapView, p: Vec2): Vec2 {
  return { x: Math.min(v.mapW, Math.max(0, p.x)), y: Math.min(v.mapH, Math.max(0, p.y)) };
}

/** True when a minimap pixel lies inside the map diamond. */
export function insideDiamond(v: MinimapView, px: number, py: number): boolean {
  const w = minimapToWorld(v, px, py);
  return w.x >= 0 && w.x <= v.mapW && w.y >= 0 && w.y <= v.mapH;
}

/** The camera's visible area (four world corners from `visibleWorldCorners()`) as minimap pixels. */
export function cameraOutline(v: MinimapView, corners: readonly [Vec2, Vec2, Vec2, Vec2]): [Vec2, Vec2, Vec2, Vec2] {
  return [
    worldToMinimap(v, corners[0].x, corners[0].y),
    worldToMinimap(v, corners[1].x, corners[1].y),
    worldToMinimap(v, corners[2].x, corners[2].y),
    worldToMinimap(v, corners[3].x, corners[3].y),
  ];
}
