/**
 * Procedural isometric buildings: stone/wood volumes with distinct roofs
 * (domes and red tile roofs for the Byzantine look), a team-colour banner and
 * trim, an icon plaque on the dark wall, and foundation / scaffold stages.
 */

import type { BuildingStage } from './manifest';
import { circle, ellipse, line, lerp, outlinedLine, poly, rrect, shadow, type Ctx, type Pt } from './draw';
import { drawGlyph, type GlyphName } from './glyphs';
import { C, OUTLINE, type TeamColors } from './palette';
import type { BuildingKey } from './catalog';

export interface BuildingDims {
  /** Footprint side in tiles. */
  n: number;
  /** Height of the main walls in pixels. */
  wall: number;
  /** Extra height above the walls (roofs, domes, flags). */
  extra: number;
}

export const BUILDING_DIMS: Readonly<Record<BuildingKey, BuildingDims>> = {
  townCenter: { n: 4, wall: 50, extra: 78 },
  house: { n: 2, wall: 20, extra: 34 },
  mill: { n: 2, wall: 20, extra: 64 },
  lumberCamp: { n: 2, wall: 18, extra: 30 },
  miningCamp: { n: 2, wall: 18, extra: 34 },
  farm: { n: 2, wall: 6, extra: 24 },
  barracks: { n: 3, wall: 28, extra: 52 },
  archeryRange: { n: 3, wall: 22, extra: 40 },
  stable: { n: 3, wall: 28, extra: 56 },
  siegeWorkshop: { n: 3, wall: 34, extra: 60 },
  silkWorkshop: { n: 3, wall: 30, extra: 66 },
};

export interface BuildingCanvasSize {
  w: number;
  h: number;
  /** Footprint centre in canvas pixels. */
  cx: number;
  cy: number;
}

export function buildingCanvasSize(key: BuildingKey): BuildingCanvasSize {
  const d = BUILDING_DIMS[key];
  const w = d.n * 64 + 40;
  const h = d.n * 32 + d.wall + d.extra + 22;
  return { w, h, cx: w / 2, cy: h - 12 - d.n * 16 };
}

interface Geo {
  cx: number;
  cy: number;
  n: number;
}

function corners(g: Geo, s: number, z: number): { T: Pt; R: Pt; B: Pt; L: Pt } {
  return {
    T: { x: g.cx, y: g.cy - s * 16 - z },
    R: { x: g.cx + s * 32, y: g.cy - z },
    B: { x: g.cx, y: g.cy + s * 16 - z },
    L: { x: g.cx - s * 32, y: g.cy - z },
  };
}

interface BoxCols {
  left: string;
  right: string;
  top: string;
  /** Texture line colours (left, right). */
  lineL: string;
  lineR: string;
}

const STONE: BoxCols = { left: C.wall, right: C.wallDark, top: '#f4ead2', lineL: '#cdbd98', lineR: '#9c8b66' };
const GREY: BoxCols = { left: '#a9adb5', right: '#7d828c', top: '#c3c7ce', lineL: '#8d929b', lineR: '#646973' };
export const WOOD: BoxCols = { left: '#a97b47', right: '#7d5730', top: '#c79c63', lineL: '#8a6035', lineR: '#5f4122' };

function box(ctx: Ctx, g: Geo, s: number, h: number, z0: number, cols: BoxCols): { T: Pt; R: Pt; B: Pt; L: Pt } {
  const b = corners(g, s, z0);
  const t = corners(g, s, z0 + h);
  poly(ctx, [b.L, b.B, t.B, t.L], cols.left, OUTLINE, 1.2);
  poly(ctx, [b.B, b.R, t.R, t.B], cols.right, OUTLINE, 1.2);
  // Horizontal courses.
  const rows = Math.max(1, Math.floor(h / 7));
  for (let i = 1; i < rows; i++) {
    const v = (h * i) / rows;
    line(ctx, { x: b.L.x, y: b.L.y - v }, { x: b.B.x, y: b.B.y - v }, cols.lineL, 0.6);
    line(ctx, { x: b.B.x, y: b.B.y - v }, { x: b.R.x, y: b.R.y - v }, cols.lineR, 0.6);
  }
  poly(ctx, [t.T, t.R, t.B, t.L], cols.top, OUTLINE, 1.2);
  return t;
}

/** Point on a wall: u along A->B, v up in pixels. */
function wp(A: Pt, B: Pt, u: number, v: number): Pt {
  return { x: A.x + (B.x - A.x) * u, y: A.y + (B.y - A.y) * u - v };
}

function wallRect(ctx: Ctx, A: Pt, B: Pt, u0: number, u1: number, v0: number, v1: number, fill: string, arch: boolean, stroke: string | null = OUTLINE): void {
  const pts = [wp(A, B, u0, v0), wp(A, B, u1, v0), wp(A, B, u1, v1), ...(arch ? [wp(A, B, (u0 + u1) / 2, v1 + (u1 - u0) * 22)] : []), wp(A, B, u0, v1)];
  poly(ctx, pts, fill, stroke, 1);
}

function windows(ctx: Ctx, A: Pt, B: Pt, us: number[], v0: number, v1: number, w: number, light: boolean): void {
  for (const u of us) wallRect(ctx, A, B, u - w / 2, u + w / 2, v0, v1, light ? '#35273d' : '#2b2030', true);
}

function plaque(ctx: Ctx, g: Geo, s: number, h: number, glyph: GlyphName, team: TeamColors, r: number, u = 0.5): void {
  const b = corners(g, s, 0);
  const p = wp(b.B, b.R, u, h * 0.55);
  circle(ctx, p.x, p.y, r + 2.2, team.secondary, OUTLINE, 1.2);
  circle(ctx, p.x, p.y, r + 0.4, team.primaryDark, null);
  drawGlyph(ctx, glyph, p.x, p.y, r * 0.85, { ink: team.secondaryLight, accent: team.secondary });
}

function tileLines(ctx: Ctx, a: Pt, b: Pt, apex: Pt, color: string, rows = 4): void {
  for (let i = 1; i <= rows; i++) {
    const t = i / (rows + 1);
    line(ctx, lerp(a, apex, t), lerp(b, apex, t), color, 0.7);
  }
}

interface RoofCols {
  left: string;
  right: string;
  back: string;
  line: string;
}
const RED: RoofCols = { left: C.roofRedLight, right: C.roofRed, back: C.roofRedDark, line: '#7a2a1c' };
const SLATE: RoofCols = { left: '#7e8aa0', right: '#5f6a80', back: '#47506a', line: '#3a4254' };
export const THATCH: RoofCols = { left: '#c9a85a', right: '#a38540', back: '#7e6530', line: '#6d5527' };

function hipRoof(ctx: Ctx, g: Geo, s: number, z: number, rise: number, over: number, cols: RoofCols): Pt {
  const c = corners(g, s + over, z);
  const apex: Pt = { x: g.cx, y: g.cy - z - rise };
  poly(ctx, [c.T, c.L, apex], cols.back, OUTLINE, 1);
  poly(ctx, [c.T, c.R, apex], cols.back, OUTLINE, 1);
  poly(ctx, [c.L, c.B, apex], cols.left, OUTLINE, 1.2);
  poly(ctx, [c.B, c.R, apex], cols.right, OUTLINE, 1.2);
  tileLines(ctx, c.L, c.B, apex, cols.line, 3);
  tileLines(ctx, c.B, c.R, apex, cols.line, 3);
  return apex;
}

function gableRoof(ctx: Ctx, g: Geo, s: number, z: number, rise: number, over: number, axis: 'x' | 'y', cols: RoofCols, gableFill = C.wall): void {
  const c = corners(g, s + over, z);
  const up = (p: Pt): Pt => ({ x: p.x, y: p.y - rise });
  if (axis === 'x') {
    const m1 = up(lerp(c.T, c.L, 0.5));
    const m2 = up(lerp(c.R, c.B, 0.5));
    poly(ctx, [c.T, c.R, m2, m1], cols.back, OUTLINE, 1);
    poly(ctx, [c.L, c.B, m2, m1], cols.left, OUTLINE, 1.2);
    tileLines(ctx, c.L, c.B, lerp(m1, m2, 0.5), cols.line, 3);
    // tile rows run parallel to the ridge
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      line(ctx, lerp(c.L, m1, t), lerp(c.B, m2, t), cols.line, 0.7);
    }
    poly(ctx, [c.R, c.B, m2], gableFill, OUTLINE, 1.2);
    line(ctx, m1, m2, cols.right, 2.2);
  } else {
    const m1 = up(lerp(c.T, c.R, 0.5));
    const m2 = up(lerp(c.L, c.B, 0.5));
    poly(ctx, [c.T, c.L, m2, m1], cols.back, OUTLINE, 1);
    poly(ctx, [c.R, c.B, m2, m1], cols.right, OUTLINE, 1.2);
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      line(ctx, lerp(c.R, m1, t), lerp(c.B, m2, t), cols.line, 0.7);
    }
    poly(ctx, [c.L, c.B, m2], gableFill, OUTLINE, 1.2);
    line(ctx, m1, m2, cols.left, 2.2);
  }
}

function dome(ctx: Ctx, x: number, baseY: number, r: number, h: number, team: TeamColors, color: 'gold' | 'team' = 'gold'): void {
  const mid = color === 'gold' ? '#e2b93b' : team.primary;
  const lite = color === 'gold' ? '#f7e08a' : team.primaryLight;
  const dark = color === 'gold' ? '#a67c12' : team.primaryDark;
  ctx.beginPath();
  ctx.ellipse(x, baseY, r, h, 0, Math.PI, 0);
  ctx.ellipse(x, baseY, r, r * 0.5, 0, 0, Math.PI);
  ctx.closePath();
  const gr = ctx.createLinearGradient(x - r, 0, x + r, 0);
  gr.addColorStop(0, lite);
  gr.addColorStop(0.45, mid);
  gr.addColorStop(1, dark);
  ctx.fillStyle = gr;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // Ribs.
  for (const k of [-0.5, 0, 0.5]) {
    ctx.beginPath();
    ctx.moveTo(x + k * r * 0.2, baseY + r * 0.5 * Math.sqrt(Math.max(0, 1 - k * k)));
    ctx.quadraticCurveTo(x + k * r * 1.2, baseY - h * 0.9, x, baseY - h);
    ctx.strokeStyle = dark;
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
  // Finial cross.
  const tip: Pt = { x, y: baseY - h };
  outlinedLine(ctx, tip, { x, y: tip.y - 9 }, '#f4e7b0', 1.6);
  outlinedLine(ctx, { x: x - 3, y: tip.y - 6.5 }, { x: x + 3, y: tip.y - 6.5 }, '#f4e7b0', 1.6);
}

function drum(ctx: Ctx, x: number, y: number, r: number, h: number, cols: BoxCols): void {
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.lineTo(x - r, y - h);
  ctx.ellipse(x, y - h, r, r * 0.5, 0, Math.PI, 0, true);
  ctx.lineTo(x + r, y);
  ctx.ellipse(x, y, r, r * 0.5, 0, 0, Math.PI);
  ctx.closePath();
  const gr = ctx.createLinearGradient(x - r, 0, x + r, 0);
  gr.addColorStop(0, cols.left);
  gr.addColorStop(1, cols.right);
  ctx.fillStyle = gr;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ellipse(ctx, x, y - h, r, r * 0.5, cols.top, OUTLINE, 1.2);
}

function banner(ctx: Ctx, base: Pt, height: number, team: TeamColors, flip = false): void {
  const top: Pt = { x: base.x, y: base.y - height };
  outlinedLine(ctx, base, top, '#d8cfae', 1.4);
  const sgn = flip ? -1 : 1;
  poly(ctx, [top, { x: top.x + 12 * sgn, y: top.y + 2 }, { x: top.x + 9 * sgn, y: top.y + 5.5 }, { x: top.x + 12 * sgn, y: top.y + 9 }, { x: top.x, y: top.y + 9 }], team.primary, OUTLINE, 1);
  line(ctx, { x: top.x + sgn, y: top.y + 4.6 }, { x: top.x + 8 * sgn, y: top.y + 4.6 }, team.secondary, 1.6);
  circle(ctx, top.x, top.y - 0.5, 1.4, team.secondary, OUTLINE, 0.6);
}

function cone(ctx: Ctx, x: number, y: number, r: number, h: number, left: string, right: string): void {
  poly(ctx, [{ x: x - r, y }, { x, y: y - h }, { x: x + r, y }], left, OUTLINE, 1.1);
  poly(ctx, [{ x, y: y - h }, { x: x + r, y }, { x, y: y + r * 0.5 }, { x: x, y }], right, null);
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.5, 0, 0, Math.PI);
  ctx.fillStyle = right;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.1;
  ctx.stroke();
}

function door(ctx: Ctx, A: Pt, B: Pt, u0: number, u1: number, h: number, team: TeamColors): void {
  wallRect(ctx, A, B, u0 - 0.03, u1 + 0.03, 0, h + 2, team.secondaryDark, true);
  wallRect(ctx, A, B, u0, u1, 0, h, '#3a2a22', true);
  line(ctx, wp(A, B, (u0 + u1) / 2, 0), wp(A, B, (u0 + u1) / 2, h + (u1 - u0) * 20), C.woodDark, 0.8);
}

function trim(ctx: Ctx, g: Geo, s: number, h: number, team: TeamColors): void {
  const b = corners(g, s, h - 3);
  const t = corners(g, s, h);
  poly(ctx, [b.L, b.B, t.B, t.L], team.primary, null);
  poly(ctx, [b.B, b.R, t.R, t.B], team.primaryDark, null);
  line(ctx, { x: t.L.x, y: t.L.y }, t.B, team.secondary, 1.2);
  line(ctx, t.B, t.R, team.secondaryDark, 1.2);
}

// ---------------------------------------------------------------------------
// Construction stages
// ---------------------------------------------------------------------------

function groundPlate(ctx: Ctx, g: Geo, s: number, fill: string, edge: string): void {
  const c = corners(g, s, 0);
  poly(ctx, [c.T, c.R, c.B, c.L], fill, OUTLINE, 1.2);
  const i = corners(g, s * 0.86, 0);
  poly(ctx, [i.T, i.R, i.B, i.L], null, edge, 1);
}

function stake(ctx: Ctx, p: Pt, h: number, team: TeamColors): void {
  outlinedLine(ctx, p, { x: p.x, y: p.y - h }, C.woodLight, 2);
  poly(ctx, [{ x: p.x, y: p.y - h }, { x: p.x + 8, y: p.y - h + 2 }, { x: p.x, y: p.y - h + 5 }], team.primary, OUTLINE, 0.9);
}

function paintFoundation(ctx: Ctx, g: Geo, dims: BuildingDims, team: TeamColors): void {
  const c = corners(g, dims.n * 0.98, 0);
  groundPlate(ctx, g, dims.n * 0.98, '#8d7a5a', '#6b5a3e');
  // Scattered stones and planks.
  const i = corners(g, dims.n * 0.5, 0);
  poly(ctx, [i.T, i.R, i.B, i.L], '#a8977a', OUTLINE, 0.8);
  for (const p of [c.T, c.R, c.L, c.B]) stake(ctx, p, 12, team);
  outlinedLine(ctx, { x: g.cx - 12, y: g.cy + 4 }, { x: g.cx + 10, y: g.cy - 4 }, C.woodLight, 3);
}

function paintScaffold(ctx: Ctx, g: Geo, dims: BuildingDims, team: TeamColors): void {
  groundPlate(ctx, g, dims.n * 0.98, '#8d7a5a', '#6b5a3e');
  const s = dims.n * 0.9;
  const wallH = Math.max(10, dims.wall * 0.5);
  box(ctx, g, s, wallH, 0, STONE);
  const full = dims.wall + 14;
  const o = corners(g, dims.n * 0.98, 0);
  const posts = [o.L, o.B, o.R];
  // Back post first, then the box is already drawn; poles in front.
  outlinedLine(ctx, o.T, { x: o.T.x, y: o.T.y - full }, C.woodLight, 2.2);
  for (const p of posts) outlinedLine(ctx, p, { x: p.x, y: p.y - full }, C.woodLight, 2.2);
  const top = corners(g, dims.n * 0.98, full);
  const mid = corners(g, dims.n * 0.98, full * 0.55);
  for (const level of [top, mid]) {
    outlinedLine(ctx, level.L, level.B, C.wood, 1.8);
    outlinedLine(ctx, level.B, level.R, C.wood, 1.8);
    outlinedLine(ctx, level.T, level.R, C.wood, 1.4);
    outlinedLine(ctx, level.T, level.L, C.wood, 1.4);
  }
  outlinedLine(ctx, o.L, mid.B, C.wood, 1.4);
  outlinedLine(ctx, o.B, mid.R, C.wood, 1.4);
  banner(ctx, { x: top.B.x, y: top.B.y }, 14, team);
}

// ---------------------------------------------------------------------------
// Completed buildings
// ---------------------------------------------------------------------------

function paintTownCenter(ctx: Ctx, g: Geo, team: TeamColors): void {
  // Stepped platform.
  box(ctx, g, 4, 8, 0, GREY);
  const keepS = 3.1;
  const wallH = 44;
  const t = box(ctx, g, keepS, wallH, 8, STONE);
  const bl = corners(g, keepS, 8);
  trim(ctx, g, keepS, 8 + wallH, team);
  windows(ctx, bl.L, bl.B, [0.2, 0.8], 14, 30, 0.1, false);
  windows(ctx, bl.B, bl.R, [0.2, 0.8], 14, 30, 0.1, false);
  door(ctx, bl.L, bl.B, 0.38, 0.62, 24, team);
  // Corner turrets with red conical roofs.
  const tower = (p: Pt, front: boolean): void => {
    const h = 26;
    const w = 7.5;
    poly(ctx, [{ x: p.x - w, y: p.y }, { x: p.x - w, y: p.y - h }, { x: p.x + w, y: p.y - h }, { x: p.x + w, y: p.y }], front ? C.wall : C.wallDark, OUTLINE, 1.1);
    line(ctx, { x: p.x, y: p.y }, { x: p.x, y: p.y - h }, C.wallDarker, 0.8);
    wallRect(ctx, { x: p.x - w, y: p.y }, { x: p.x + w, y: p.y }, 0.38, 0.62, h * 0.55, h * 0.8, '#2b2030', true);
    cone(ctx, p.x, p.y - h, w + 2, 20, C.roofRedLight, C.roofRed);
  };
  const turretBase = corners(g, keepS, 8);
  // Back corner (drawn first so the dome sits over it).
  tower(turretBase.T, false);
  tower(turretBase.L, false);
  tower(turretBase.R, false);
  // Central drum + gold dome.
  const dc: Pt = { x: g.cx, y: t.T.y + 16 };
  drum(ctx, dc.x, dc.y + 4, 26, 16, { ...STONE, top: '#f4ead2' });
  dome(ctx, dc.x, dc.y - 12, 26, 28, team, 'gold');
  banner(ctx, { x: dc.x + 0, y: dc.y - 40 }, 0, team);
  tower(turretBase.B, true);
  banner(ctx, { x: turretBase.B.x + 9, y: turretBase.B.y - 44 }, 22, team);
  plaque(ctx, g, keepS, wallH + 8, 'castle', team, 8, 0.5);
}

function paintHouse(ctx: Ctx, g: Geo, team: TeamColors): void {
  const t = box(ctx, g, 1.55, 20, 0, STONE);
  const b = corners(g, 1.55, 0);
  trim(ctx, g, 1.55, 20, team);
  door(ctx, b.L, b.B, 0.4, 0.62, 12, team);
  windows(ctx, b.L, b.B, [0.18], 9, 16, 0.12, false);
  windows(ctx, b.B, b.R, [0.25], 9, 16, 0.12, false);
  hipRoof(ctx, g, 1.55, 20, 18, 0.35, RED);
  banner(ctx, { x: t.R.x - 6, y: t.R.y + 4 }, 16, team);
  plaque(ctx, g, 1.55, 20, 'house', team, 4.5, 0.62);
}

function paintMill(ctx: Ctx, g: Geo, team: TeamColors): void {
  // Low granary plus a round tower with sails.
  box(ctx, g, 1.7, 14, 0, STONE);
  const b = corners(g, 1.7, 0);
  trim(ctx, g, 1.7, 14, team);
  door(ctx, b.L, b.B, 0.4, 0.62, 9, team);
  hipRoof(ctx, g, 1.7, 14, 10, 0.2, RED);
  // Tower.
  const tc: Pt = { x: g.cx + 10, y: g.cy - 2 };
  drum(ctx, tc.x, tc.y - 10, 13, 40, { ...STONE, top: STONE.top });
  cone(ctx, tc.x, tc.y - 50, 15, 16, team.primaryLight, team.primary);
  // Sails: a cross of wooden lattice with team cloth.
  const hub: Pt = { x: tc.x + 4, y: tc.y - 40 };
  const sail = (dx: number, dy: number): void => {
    const e: Pt = { x: hub.x + dx, y: hub.y + dy };
    outlinedLine(ctx, hub, e, C.woodDark, 2);
    const n = { x: -dy / Math.hypot(dx, dy), y: dx / Math.hypot(dx, dy) };
    poly(ctx, [lerp(hub, e, 0.25), lerp(hub, e, 1), { x: e.x + n.x * 7, y: e.y + n.y * 7 }, { x: hub.x + dx * 0.25 + n.x * 7, y: hub.y + dy * 0.25 + n.y * 7 }], '#efe6cb', OUTLINE, 0.9);
    line(ctx, lerp(hub, e, 0.25), lerp(hub, e, 1), team.primary, 1);
  };
  sail(0, -26);
  sail(26, 0);
  sail(0, 26);
  sail(-26, 0);
  circle(ctx, hub.x, hub.y, 3.2, team.secondary, OUTLINE, 1);
  plaque(ctx, g, 1.7, 14, 'wheat', team, 4.5, 0.58);
  // Sacks.
  for (const [x, y] of [[-26, 14], [-20, 18]] as const) ellipse(ctx, g.cx + x, g.cy + y, 4.5, 5, '#d9c58c', OUTLINE, 1);
}

function post(ctx: Ctx, p: Pt, h: number): void {
  outlinedLine(ctx, p, { x: p.x, y: p.y - h }, C.woodLight, 2.4);
}

function paintLumberCamp(ctx: Ctx, g: Geo, team: TeamColors): void {
  groundPlate(ctx, g, 1.95, '#8c7a58', '#6e5e42');
  const o = corners(g, 1.7, 0);
  const h = 24;
  post(ctx, o.T, h + 6);
  post(ctx, o.L, h + 2);
  // Lean-to roof: slope from back (high) to front (low).
  const hi = corners(g, 1.9, h + 8);
  const lo = corners(g, 1.9, h - 2);
  poly(ctx, [hi.T, hi.R, lo.R, lo.L, hi.L].slice(0, 5), '#7e5632', OUTLINE, 1.2);
  poly(ctx, [hi.L, hi.T, hi.R, lo.B, lo.L], null, null);
  poly(ctx, [hi.T, hi.R, lo.B, lo.L], '#9b6a3a', OUTLINE, 1.2);
  for (let i = 1; i < 5; i++) line(ctx, lerp(hi.T, hi.R, i / 5), lerp(lo.L, lo.B, i / 5), '#6b4527', 0.8);
  line(ctx, lo.L, lo.B, team.primary, 2.4);
  line(ctx, lo.B, lo.R, team.primaryDark, 2.4);
  post(ctx, o.B, h - 2);
  post(ctx, o.R, h + 2);
  // Log piles and a stump with axe.
  for (let r = 0; r < 3; r++) for (let i = 0; i < 3 - r; i++) {
    const x = g.cx - 24 + i * 9 + r * 4.5;
    const y = g.cy + 12 - r * 6;
    outlinedLine(ctx, { x, y }, { x: x + 10, y: y - 5 }, '#8a5a2e', 5);
    ellipse(ctx, x + 10, y - 5, 2.2, 2.6, '#d5a769', OUTLINE, 0.8);
  }
  rrect(ctx, g.cx + 14, g.cy + 6, 10, 8, 2, '#a5733d', OUTLINE, 1);
  outlinedLine(ctx, { x: g.cx + 19, y: g.cy + 8 }, { x: g.cx + 25, y: g.cy - 4 }, C.woodLight, 2);
  poly(ctx, [{ x: g.cx + 22, y: g.cy - 7 }, { x: g.cx + 30, y: g.cy - 4 }, { x: g.cx + 25, y: g.cy + 0 }], C.steel, OUTLINE, 0.9);
  banner(ctx, { x: o.R.x - 4, y: o.R.y - h + 2 }, 14, team);
  const b = corners(g, 1.9, 0);
  const p = wp(b.B, b.R, 0.5, 8);
  circle(ctx, p.x, p.y, 6, team.secondary, OUTLINE, 1);
  drawGlyph(ctx, 'axe', p.x, p.y, 5.2, { ink: team.primaryDark, accent: team.primary });
}

function paintMiningCamp(ctx: Ctx, g: Geo, team: TeamColors): void {
  groundPlate(ctx, g, 1.95, '#85806f', '#625e50');
  const o = corners(g, 1.55, 0);
  const h = 26;
  // Timber A-frame with a gabled shingle roof.
  post(ctx, o.T, h);
  post(ctx, o.L, h);
  post(ctx, o.R, h);
  post(ctx, o.B, h);
  gableRoof(ctx, g, 1.55, h, 14, 0.25, 'y', { left: '#8d8f99', right: '#6c6f7b', back: '#4c4f5a', line: '#3d404a' }, '#b09469');
  // Ore cart and rock/ore piles.
  rrect(ctx, g.cx + 12, g.cy + 8, 14, 9, 2, C.wood, OUTLINE, 1);
  for (const [x, dx] of [[g.cx + 15, 0], [g.cx + 23, 0]] as const) circle(ctx, x + dx, g.cy + 18, 2.6, '#444', OUTLINE, 0.8);
  circle(ctx, g.cx + 16, g.cy + 6, 3, C.gold, OUTLINE, 0.8);
  circle(ctx, g.cx + 21, g.cy + 6.5, 3, C.stone, OUTLINE, 0.8);
  for (const [x, y, c] of [[-26, 10, C.stone], [-20, 14, C.stoneDark], [-30, 16, C.gold], [-24, 18, C.stone]] as const) {
    poly(ctx, [{ x: g.cx + x - 5, y: g.cy + y + 3 }, { x: g.cx + x - 3, y: g.cy + y - 3 }, { x: g.cx + x + 3, y: g.cy + y - 4 }, { x: g.cx + x + 5, y: g.cy + y + 3 }], c, OUTLINE, 0.9);
  }
  line(ctx, { x: o.L.x, y: o.L.y - h * 0.55 }, { x: o.B.x, y: o.B.y - h * 0.55 }, team.primary, 2.4);
  line(ctx, { x: o.B.x, y: o.B.y - h * 0.55 }, { x: o.R.x, y: o.R.y - h * 0.55 }, team.primaryDark, 2.4);
  banner(ctx, { x: o.R.x + 2, y: o.R.y - h + 4 }, 14, team);
  const p = { x: g.cx - 2, y: g.cy + 14 };
  circle(ctx, p.x, p.y, 6.4, team.secondary, OUTLINE, 1);
  drawGlyph(ctx, 'pick', p.x, p.y, 5.4, { ink: team.primaryDark, accent: team.primary });
}

function paintFarm(ctx: Ctx, g: Geo, team: TeamColors, stage: BuildingStage): void {
  const s = 1.96;
  const c = corners(g, s, 0);
  poly(ctx, [c.T, c.R, c.B, c.L], '#7b5a35', OUTLINE, 1.2);
  const rows = 6;
  for (let i = 0; i < rows; i++) {
    const t0 = (i + 0.5) / rows;
    const a = lerp(c.T, c.R, 0.07);
    const A = lerp(lerp(c.T, c.L, t0), lerp(c.R, c.B, t0), 0.08);
    const Bp = lerp(lerp(c.T, c.L, t0), lerp(c.R, c.B, t0), 0.92);
    void a;
    line(ctx, A, Bp, '#5d4326', 1.4);
    if (stage !== 'foundation') {
      const ch = stage === 'complete' ? 6 : 2.5;
      for (let k = 0; k < 7; k++) {
        const p = lerp(A, Bp, (k + 0.5) / 7);
        outlinedLine(ctx, p, { x: p.x, y: p.y - ch }, stage === 'complete' ? '#cfae3c' : C.leafLight, 1.6);
        if (stage === 'complete') circle(ctx, p.x, p.y - 7, 1.6, '#e6c25a', null);
        line(ctx, { x: p.x - 2, y: p.y - 3 }, { x: p.x, y: p.y - 5 }, C.leafLight, 1);
      }
    }
  }
  // Fence posts in team colour at the corners.
  for (const p of [c.T, c.R, c.B, c.L]) {
    outlinedLine(ctx, p, { x: p.x, y: p.y - 7 }, team.primary, 2.2);
    circle(ctx, p.x, p.y - 8, 1.6, team.secondary, OUTLINE, 0.6);
  }
  const q = corners(g, s, 5);
  line(ctx, q.L, q.B, '#d7c493', 1.1);
  line(ctx, q.B, q.R, '#b7a373', 1.1);
}

function paintBarracks(ctx: Ctx, g: Geo, team: TeamColors): void {
  const s = 2.7;
  const h = 28;
  const t = box(ctx, g, s, h, 0, STONE);
  const b = corners(g, s, 0);
  trim(ctx, g, s, h, team);
  windows(ctx, b.L, b.B, [0.16, 0.84], 12, 22, 0.08, false);
  door(ctx, b.L, b.B, 0.4, 0.6, 18, team);
  windows(ctx, b.B, b.R, [0.2, 0.8], 12, 22, 0.08, false);
  gableRoof(ctx, g, s, h, 24, 0.3, 'x', RED);
  // Crenellated front wall bumps.
  for (let i = 0; i < 6; i++) {
    const p = wp(b.L, b.B, 0.07 + i * 0.17, h);
    rrect(ctx, p.x - 2, p.y - 5, 4, 5, 0.5, C.wall, OUTLINE, 0.7);
  }
  banner(ctx, { x: t.R.x - 5, y: t.R.y + 5 }, 30, team);
  banner(ctx, { x: t.L.x + 5, y: t.L.y + 5 }, 22, team, true);
  plaque(ctx, g, s, h, 'swords', team, 7.5, 0.5);
}

function paintArcheryRange(ctx: Ctx, g: Geo, team: TeamColors): void {
  groundPlate(ctx, g, 2.8, '#8e8764', '#6e684a');
  const s = 2.3;
  const o = corners(g, s, 0);
  const h = 24;
  post(ctx, o.T, h);
  post(ctx, o.L, h);
  // Low back wall.
  const bw = corners(g, s, 14);
  poly(ctx, [o.T, o.R, bw.R, bw.T], '#b69a6a', OUTLINE, 1);
  poly(ctx, [o.T, o.L, bw.L, bw.T], '#c8ad7c', OUTLINE, 1);
  hipRoof(ctx, g, s, h, 18, 0.25, RED);
  post(ctx, o.B, h);
  post(ctx, o.R, h);
  line(ctx, { x: o.L.x, y: o.L.y - h + 2 }, { x: o.B.x, y: o.B.y - h + 2 }, team.primary, 3);
  line(ctx, { x: o.B.x, y: o.B.y - h + 2 }, { x: o.R.x, y: o.R.y - h + 2 }, team.primaryDark, 3);
  // Targets in front of the range.
  for (const [x, y] of [[-34, 26], [30, 22]] as const) {
    outlinedLine(ctx, { x: g.cx + x - 4, y: g.cy + y + 8 }, { x: g.cx + x, y: g.cy + y - 6 }, C.woodDark, 2);
    outlinedLine(ctx, { x: g.cx + x + 4, y: g.cy + y + 8 }, { x: g.cx + x, y: g.cy + y - 6 }, C.woodDark, 2);
    ellipse(ctx, g.cx + x, g.cy + y - 10, 9, 10, '#f2e8c8', OUTLINE, 1);
    ellipse(ctx, g.cx + x, g.cy + y - 10, 6, 7, team.primary, null);
    ellipse(ctx, g.cx + x, g.cy + y - 10, 3, 3.5, team.secondary, OUTLINE, 0.6);
    line(ctx, { x: g.cx + x + 1, y: g.cy + y - 11 }, { x: g.cx + x + 8, y: g.cy + y - 17 }, '#ddd', 1);
  }
  banner(ctx, { x: o.R.x - 2, y: o.R.y - h + 2 }, 18, team);
  const p = { x: g.cx + 2, y: g.cy + 8 };
  circle(ctx, p.x, p.y, 7.4, team.primaryDark, OUTLINE, 1);
  circle(ctx, p.x, p.y, 7.4, null, team.secondary, 1.4);
  drawGlyph(ctx, 'bow', p.x, p.y, 6, { ink: team.secondaryLight, accent: team.secondary });
}

function paintStable(ctx: Ctx, g: Geo, team: TeamColors): void {
  const s = 2.6;
  const h = 26;
  const t = box(ctx, g, s, h, 0, { ...STONE, left: '#d9c392', right: '#a98f5b', top: '#e6d3a8', lineL: '#bda673', lineR: '#8a7344' });
  const b = corners(g, s, 0);
  trim(ctx, g, s, h, team);
  void t;
  // Wide double doors on the lit wall.
  door(ctx, b.L, b.B, 0.3, 0.7, 20, team);
  line(ctx, wp(b.L, b.B, 0.3, 11), wp(b.L, b.B, 0.7, 11), C.woodDark, 0.8);
  windows(ctx, b.B, b.R, [0.25, 0.75], 14, 22, 0.1, false);
  gableRoof(ctx, g, s, h, 26, 0.3, 'y', RED, '#d9c392');
  // Hay bales.
  for (const [x, y] of [[-40, 16], [-33, 20], [-37, 12]] as const) {
    rrect(ctx, g.cx + x - 6, g.cy + y - 4, 12, 8, 2, '#d9bb5a', OUTLINE, 1);
    line(ctx, { x: g.cx + x - 2, y: g.cy + y - 4 }, { x: g.cx + x - 2, y: g.cy + y + 4 }, '#a98a2c', 0.8);
  }
  // Weather vane.
  const apex = { x: g.cx + 2, y: g.cy - h - 32 };
  outlinedLine(ctx, { x: apex.x, y: apex.y + 6 }, { x: apex.x, y: apex.y - 8 }, C.steelDark, 1.4);
  drawGlyph(ctx, 'horse', apex.x + 5, apex.y - 9, 5, { ink: team.primary, accent: team.secondary });
  banner(ctx, { x: b.R.x - 4, y: b.R.y - h + 4 }, 18, team);
  plaque(ctx, g, s, h, 'horse', team, 7, 0.5);
}

function paintSiegeWorkshop(ctx: Ctx, g: Geo, team: TeamColors): void {
  const s = 2.7;
  const h = 34;
  const t = box(ctx, g, s, h, 0, GREY);
  const b = corners(g, s, 0);
  trim(ctx, g, s, h, team);
  // Big arched gate.
  door(ctx, b.L, b.B, 0.3, 0.7, 24, team);
  windows(ctx, b.B, b.R, [0.2, 0.8], 16, 28, 0.08, false);
  // Sawtooth slate roof: two gables side by side along y.
  const c = corners(g, s + 0.25, h);
  const mids = [0.25, 0.75];
  for (const m of mids) {
    const a0 = lerp(c.T, c.R, m - 0.25);
    const a1 = lerp(c.T, c.R, m + 0.25);
    const b0 = lerp(c.L, c.B, m - 0.25);
    const b1 = lerp(c.L, c.B, m + 0.25);
    const rise = 22;
    const r0 = lerp(a0, a1, 0.5);
    const r1 = lerp(b0, b1, 0.5);
    const ridge0 = { x: r0.x, y: r0.y - rise };
    const ridge1 = { x: r1.x, y: r1.y - rise };
    poly(ctx, [a0, a1, ridge0].length ? [a0, ridge0, ridge1, b0] : [], SLATE.back, OUTLINE, 1);
    poly(ctx, [a1, b1, ridge1, ridge0], SLATE.right, OUTLINE, 1.1);
    poly(ctx, [b0, b1, ridge1], '#d6d2c6', OUTLINE, 1);
    void SLATE;
  }
  // Crane / gantry with a hanging log and gear.
  const mast: Pt = { x: t.R.x - 16, y: t.R.y + 12 };
  outlinedLine(ctx, mast, { x: mast.x, y: mast.y - 40 }, C.woodDark, 3);
  outlinedLine(ctx, { x: mast.x, y: mast.y - 40 }, { x: mast.x - 26, y: mast.y - 34 }, C.wood, 2.4);
  line(ctx, { x: mast.x - 24, y: mast.y - 34 }, { x: mast.x - 24, y: mast.y - 22 }, '#e6dcc0', 1);
  rrect(ctx, mast.x - 30, mast.y - 22, 12, 5, 1.5, '#8a5a2e', OUTLINE, 0.9);
  banner(ctx, { x: t.L.x + 4, y: t.L.y + 6 }, 22, team, true);
  plaque(ctx, g, s, h, 'gear', team, 7.5, 0.5);
}

function paintSilkWorkshop(ctx: Ctx, g: Geo, team: TeamColors): void {
  const s = 2.7;
  const h = 30;
  const cols: BoxCols = { left: '#e8dcec', right: '#b9a5c4', top: '#f2e9f4', lineL: '#cdbad6', lineR: '#9a86a8' };
  const t = box(ctx, g, s, h, 0, cols);
  const b = corners(g, s, 0);
  trim(ctx, g, s, h, team);
  door(ctx, b.L, b.B, 0.38, 0.62, 20, team);
  windows(ctx, b.L, b.B, [0.15, 0.85], 14, 24, 0.08, false);
  windows(ctx, b.B, b.R, [0.2, 0.8], 14, 24, 0.08, false);
  // Team-coloured awning with gold fringe over the door.
  const a0 = wp(b.L, b.B, 0.28, 24);
  const a1 = wp(b.L, b.B, 0.72, 24);
  poly(ctx, [a0, a1, { x: a1.x + 6, y: a1.y + 8 }, { x: a0.x + 6, y: a0.y + 8 }], team.primary, OUTLINE, 1.1);
  line(ctx, { x: a0.x + 6, y: a0.y + 8 }, { x: a1.x + 6, y: a1.y + 8 }, team.secondary, 1.8);
  // Three domes: a big central one and two small ones.
  const centre: Pt = { x: g.cx, y: t.T.y + 22 };
  drum(ctx, t.T.x - 28 + 28, t.T.y + 22, 0.01, 0.01, cols);
  dome(ctx, t.L.x + 26, t.L.y + 2, 11, 12, team, 'team');
  dome(ctx, t.R.x - 26, t.R.y + 2, 11, 12, team, 'team');
  drum(ctx, centre.x, centre.y + 4, 22, 12, cols);
  dome(ctx, centre.x, centre.y - 8, 22, 26, team, 'gold');
  banner(ctx, { x: t.B.x + 14, y: t.B.y - 6 }, 20, team);
  plaque(ctx, g, s, h, 'silk', team, 7.5, 0.5);
  shadow(ctx, g.cx, g.cy + 2, 0, 0, 0);
}

const PAINTERS: Readonly<Record<BuildingKey, (ctx: Ctx, g: Geo, team: TeamColors, stage: BuildingStage) => void>> = {
  townCenter: (c, g, t) => paintTownCenter(c, g, t),
  house: (c, g, t) => paintHouse(c, g, t),
  mill: (c, g, t) => paintMill(c, g, t),
  lumberCamp: (c, g, t) => paintLumberCamp(c, g, t),
  miningCamp: (c, g, t) => paintMiningCamp(c, g, t),
  farm: (c, g, t, s) => paintFarm(c, g, t, s),
  barracks: (c, g, t) => paintBarracks(c, g, t),
  archeryRange: (c, g, t) => paintArcheryRange(c, g, t),
  stable: (c, g, t) => paintStable(c, g, t),
  siegeWorkshop: (c, g, t) => paintSiegeWorkshop(c, g, t),
  silkWorkshop: (c, g, t) => paintSilkWorkshop(c, g, t),
};

export function drawBuilding(ctx: Ctx, key: BuildingKey, team: TeamColors, stage: BuildingStage): void {
  const size = buildingCanvasSize(key);
  const dims = BUILDING_DIMS[key];
  const g: Geo = { cx: size.cx, cy: size.cy, n: dims.n };
  shadow(ctx, g.cx + 6, g.cy + 4, dims.n * 30, dims.n * 15, 0.22);
  if (stage === 'foundation') {
    if (key === 'farm') paintFarm(ctx, g, team, 'foundation');
    else paintFoundation(ctx, g, dims, team);
  } else if (stage === 'scaffold') {
    if (key === 'farm') {
      paintFarm(ctx, g, team, 'scaffold');
    } else paintScaffold(ctx, g, dims, team);
  } else PAINTERS[key](ctx, g, team, stage);
}
