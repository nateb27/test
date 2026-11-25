/** Procedural resource-node drawings: tree, berry bush, gold and stone deposits. */

import { circle, ellipse, line, mulberry, poly, rrect, shadow, type Ctx, type Pt } from './draw';
import { C, OUTLINE } from './palette';
import type { NodeKey } from './catalog';

export interface NodeSize {
  w: number;
  h: number;
  ax: number;
  ay: number;
}

export const NODE_SIZES: Readonly<Record<NodeKey, NodeSize>> = {
  tree: { w: 76, h: 100, ax: 38, ay: 80 },
  berryBush: { w: 64, h: 54, ax: 32, ay: 38 },
  goldDeposit: { w: 132, h: 110, ax: 66, ay: 70 },
  stoneDeposit: { w: 132, h: 110, ax: 66, ay: 70 },
};

function tree(ctx: Ctx, s: NodeSize): void {
  const { ax, ay } = s;
  shadow(ctx, ax + 4, ay, 20, 8, 0.3);
  // Trunk with roots.
  poly(ctx, [{ x: ax - 4, y: ay + 1 }, { x: ax - 3, y: ay - 24 }, { x: ax + 3, y: ay - 24 }, { x: ax + 5, y: ay + 1 }], '#7a4f2b', OUTLINE, 1.3);
  line(ctx, { x: ax + 1, y: ay }, { x: ax + 1, y: ay - 22 }, '#5d3b1c', 1.2);
  // Canopy: stacked lobes, dark at the back and light on the upper left.
  const lobes: [number, number, number, string][] = [
    [-12, -34, 14, C.leafDark],
    [12, -34, 14, C.leafDark],
    [0, -26, 16, '#336b2d'],
    [-9, -46, 13, C.leaf],
    [10, -46, 12, C.leaf],
    [0, -58, 12, C.leafLight],
  ];
  for (const [dx, dy, r, col] of lobes) circle(ctx, ax + dx, ay + dy, r, col, OUTLINE, 1.3);
  // Highlights.
  for (const [dx, dy, r] of [[-5, -60, 4], [-12, -48, 4], [8, -50, 3]] as const) circle(ctx, ax + dx, ay + dy, r, '#8cc063', null);
}

function bush(ctx: Ctx, s: NodeSize): void {
  const { ax, ay } = s;
  shadow(ctx, ax + 2, ay, 20, 7, 0.28);
  const blobs: [number, number, number, string][] = [
    [-11, -6, 10, C.leafDark],
    [11, -6, 10, C.leafDark],
    [0, -10, 12, C.leaf],
    [-6, -14, 8, C.leafLight],
    [7, -13, 8, C.leaf],
  ];
  for (const [dx, dy, r, col] of blobs) circle(ctx, ax + dx, ay + dy, r, col, OUTLINE, 1.2);
  const rnd = mulberry(7);
  for (let i = 0; i < 11; i++) {
    const x = ax - 16 + rnd() * 32;
    const y = ay - 20 + rnd() * 18;
    circle(ctx, x, y, 2.6, C.berry, OUTLINE, 0.8);
    circle(ctx, x - 0.8, y - 0.9, 0.7, '#ffb0b8', null);
  }
}

function deposit(ctx: Ctx, s: NodeSize, kind: 'gold' | 'stone'): void {
  const { ax, ay } = s;
  // Dark ground patch (blends with grass).
  ctx.save();
  ctx.globalAlpha = 0.45;
  ellipse(ctx, ax, ay + 4, 52, 25, '#3a352c', null);
  ctx.restore();
  const rnd = mulberry(kind === 'gold' ? 11 : 23);
  const base = kind === 'gold' ? '#8e8a83' : '#a3a39e';
  const mid = kind === 'gold' ? '#6f6b66' : '#85857f';
  const light = kind === 'gold' ? '#b0aca4' : '#c8c7c0';
  const rocks: { x: number; y: number; r: number }[] = [
    { x: -26, y: 6, r: 14 },
    { x: 24, y: 8, r: 15 },
    { x: -4, y: -6, r: 19 },
    { x: -2, y: 14, r: 13 },
    { x: 14, y: -10, r: 12 },
    { x: -18, y: -10, r: 11 },
  ];
  rocks.sort((a, b) => a.y - b.y);
  for (const r of rocks) {
    const cx = ax + r.x;
    const cy = ay + r.y;
    const n = 7;
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r.r * (0.78 + rnd() * 0.3);
      pts.push({ x: cx + Math.cos(a) * rr, y: cy - r.r * 0.35 + Math.sin(a) * rr * 0.78 });
    }
    poly(ctx, pts, base, OUTLINE, 1.4);
    // Lit upper-left face and shaded right side.
    poly(ctx, [pts[4]!, pts[5]!, pts[6]!, pts[0]!, { x: cx, y: cy - r.r * 0.3 }], light, null);
    poly(ctx, [pts[0]!, pts[1]!, pts[2]!, pts[3]!, { x: cx, y: cy - r.r * 0.3 }], mid, null);
    poly(ctx, pts, null, OUTLINE, 1.2);
    if (kind === 'gold') {
      // Gold nuggets and veins.
      for (let i = 0; i < 3; i++) {
        const gx = cx - r.r * 0.5 + rnd() * r.r;
        const gy = cy - r.r * 0.6 + rnd() * r.r * 0.8;
        const g = 2.6 + rnd() * 2.6;
        poly(ctx, [{ x: gx - g, y: gy + g * 0.5 }, { x: gx - g * 0.4, y: gy - g }, { x: gx + g, y: gy - g * 0.3 }, { x: gx + g * 0.6, y: gy + g * 0.8 }], '#f2c933', OUTLINE, 0.9);
        line(ctx, { x: gx - g * 0.5, y: gy - g * 0.6 }, { x: gx + g * 0.2, y: gy - g * 0.8 }, '#fff3a6', 0.9);
      }
    } else {
      line(ctx, { x: cx - r.r * 0.4, y: cy - r.r * 0.9 }, { x: cx + r.r * 0.1, y: cy - r.r * 0.2 }, '#5b5b56', 1);
      line(ctx, { x: cx + r.r * 0.1, y: cy - r.r * 0.2 }, { x: cx + r.r * 0.5, y: cy - r.r * 0.3 }, '#5b5b56', 1);
    }
  }
  if (kind === 'gold') {
    // Loose ingots at the base: a clear gold cue at 0.5x zoom.
    for (const [dx, dy] of [[-34, 24], [30, 26], [8, 30]] as const) {
      rrect(ctx, ax + dx - 6, ay + dy - 3, 12, 6, 1.5, '#f2c933', OUTLINE, 1);
      line(ctx, { x: ax + dx - 4, y: ay + dy - 1.5 }, { x: ax + dx + 3, y: ay + dy - 1.5 }, '#fff3a6', 1);
    }
  } else {
    for (const [dx, dy] of [[-34, 24], [30, 26], [8, 30]] as const) {
      poly(ctx, [{ x: ax + dx - 6, y: ay + dy + 3 }, { x: ax + dx - 3, y: ay + dy - 4 }, { x: ax + dx + 4, y: ay + dy - 3 }, { x: ax + dx + 6, y: ay + dy + 3 }], '#b0afa8', OUTLINE, 1);
    }
  }
}

export function drawNode(ctx: Ctx, key: NodeKey): void {
  const s = NODE_SIZES[key];
  switch (key) {
    case 'tree':
      tree(ctx, s);
      break;
    case 'berryBush':
      bush(ctx, s);
      break;
    case 'goldDeposit':
      deposit(ctx, s, 'gold');
      break;
    case 'stoneDeposit':
      deposit(ctx, s, 'stone');
      break;
  }
}
