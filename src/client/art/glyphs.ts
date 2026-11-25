/**
 * Small symbolic glyphs (crossed swords, bow, wheat ...). Used as the icon
 * plaque on building walls and as the artwork of tech / resource icons.
 * All glyphs fit in a circle of radius `r` around (cx, cy).
 */

import { circle, ellipse, line, outlinedLine, poly, rrect, type Ctx, type Pt } from './draw';
import { C, OUTLINE } from './palette';

export type GlyphName =
  | 'swords'
  | 'bow'
  | 'horse'
  | 'gear'
  | 'silk'
  | 'axe'
  | 'pick'
  | 'wheat'
  | 'house'
  | 'castle'
  | 'log'
  | 'cart'
  | 'saw'
  | 'drops'
  | 'fields'
  | 'scroll'
  | 'coin'
  | 'rock'
  | 'apple'
  | 'timbers'
  | 'pillar'
  | 'ram'
  | 'tower'
  | 'cross';

export interface GlyphInk {
  /** Main drawing colour. */
  ink: string;
  /** Accent colour (team or gold). */
  accent: string;
}

const P = (x: number, y: number): Pt => ({ x, y });

export function drawGlyph(ctx: Ctx, name: GlyphName, cx: number, cy: number, r: number, k: GlyphInk): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(r / 10, r / 10);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const o = (a: Pt, b: Pt, col: string, w: number): void => outlinedLine(ctx, a, b, col, w);
  switch (name) {
    case 'swords':
      o(P(-7, 7), P(6, -7), C.steel, 2);
      o(P(7, 7), P(-6, -7), C.steel, 2);
      line(ctx, P(-8, 4), P(-4, 8), C.gold, 2);
      line(ctx, P(8, 4), P(4, 8), C.gold, 2);
      break;
    case 'bow':
      ctx.beginPath();
      ctx.moveTo(-3, -9);
      ctx.quadraticCurveTo(10, 0, -3, 9);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 4.4;
      ctx.stroke();
      ctx.strokeStyle = C.woodLight;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      line(ctx, P(-3, -9), P(-3, 9), '#f2eedd', 0.9);
      o(P(-7, 0), P(8, 0), C.steel, 1.2);
      break;
    case 'horse':
      // Horse head profile.
      poly(ctx, [P(-6, 9), P(-5, -1), P(-2, -8), P(2, -9), P(1, -5), P(7, 1), P(8, 5), P(4, 6), P(0, 3), P(0, 9)], k.ink, OUTLINE, 1);
      circle(ctx, 3, -3, 0.9, OUTLINE, null);
      break;
    case 'gear':
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        o(P(Math.cos(a) * 6, Math.sin(a) * 6), P(Math.cos(a) * 9, Math.sin(a) * 9), k.ink, 3);
      }
      circle(ctx, 0, 0, 6.2, k.ink, OUTLINE, 1);
      circle(ctx, 0, 0, 2.4, k.accent, OUTLINE, 0.8);
      break;
    case 'silk':
      // A rolled bolt of silk with a ribbon.
      rrect(ctx, -9, -4, 18, 8, 4, k.accent, OUTLINE, 1);
      ellipse(ctx, 9, 0, 2, 4, k.ink, OUTLINE, 1);
      line(ctx, P(-6, -4), P(-6, 4), k.ink, 1.2);
      line(ctx, P(0, -4), P(0, 4), k.ink, 1.2);
      poly(ctx, [P(-2, 4), P(2, 4), P(5, 10), P(1, 8), P(-3, 10)], k.ink, OUTLINE, 0.8);
      break;
    case 'axe':
      o(P(-5, 9), P(4, -8), C.woodLight, 2.4);
      poly(ctx, [P(2, -9), P(9, -6), P(8, 2), P(3, -2)], C.steel, OUTLINE, 1);
      break;
    case 'pick':
      o(P(-6, 9), P(3, -7), C.woodLight, 2.4);
      ctx.beginPath();
      ctx.moveTo(-6, -4);
      ctx.quadraticCurveTo(2, -11, 10, -3);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 4.4;
      ctx.stroke();
      ctx.strokeStyle = C.steel;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      break;
    case 'wheat':
      line(ctx, P(0, 9), P(0, -7), C.goldDark, 1.6);
      for (let i = 0; i < 4; i++) {
        ellipse(ctx, -2.6, -6 + i * 3.4, 2.4, 1.3, C.food, OUTLINE, 0.7);
        ellipse(ctx, 2.6, -6 + i * 3.4, 2.4, 1.3, C.food, OUTLINE, 0.7);
      }
      ellipse(ctx, 0, -9, 1.3, 2, C.food, OUTLINE, 0.7);
      break;
    case 'house':
      poly(ctx, [P(-7, 0), P(7, 0), P(7, 8), P(-7, 8)], C.wall, OUTLINE, 1);
      poly(ctx, [P(-9, 1), P(0, -8), P(9, 1)], C.roofRed, OUTLINE, 1);
      rrect(ctx, -2, 3, 4, 5, 1, C.woodDark, null);
      break;
    case 'castle':
      poly(ctx, [P(-8, 8), P(-8, -2), P(-5, -2), P(-5, -5), P(-2, -5), P(-2, -2), P(2, -2), P(2, -5), P(5, -5), P(5, -2), P(8, -2), P(8, 8)], C.stoneLight, OUTLINE, 1);
      ctx.beginPath();
      ctx.arc(0, -3, 5, Math.PI, 0);
      ctx.fillStyle = C.gold;
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1;
      ctx.stroke();
      rrect(ctx, -2, 3, 4, 5, 1.5, C.woodDark, null);
      break;
    case 'log':
      rrect(ctx, -9, -2, 15, 8, 3, C.wood, OUTLINE, 1);
      ellipse(ctx, 6, 2, 2.2, 4, C.woodLight, OUTLINE, 0.8);
      rrect(ctx, -5, -8, 15, 8, 3, C.wood, OUTLINE, 1);
      ellipse(ctx, 10, -4, 2.2, 4, C.woodLight, OUTLINE, 0.8);
      break;
    case 'cart':
      rrect(ctx, -8, -4, 16, 8, 1.5, C.wood, OUTLINE, 1);
      circle(ctx, -4, 6, 3.4, C.woodLight, OUTLINE, 1);
      circle(ctx, 5, 6, 3.4, C.woodLight, OUTLINE, 1);
      o(P(8, -2), P(11, -7), C.woodDark, 1.6);
      break;
    case 'saw':
      poly(ctx, [P(-10, -3), P(10, -5), P(10, 3), P(-10, 1)], C.steel, OUTLINE, 1);
      for (let i = -9; i < 10; i += 3) poly(ctx, [P(i, 1), P(i + 1.5, 4.5), P(i + 3, 1.2)], C.steel, OUTLINE, 0.7);
      rrect(ctx, -12, -6, 4, 9, 1.5, C.woodDark, OUTLINE, 0.8);
      break;
    case 'drops':
      for (const [x, y, s] of [[-4, 0, 1], [4, 3, 0.8], [0, -6, 0.7]] as const) {
        poly(ctx, [P(x, y - 6 * s), P(x + 4 * s, y + 1 * s), P(x, y + 5 * s), P(x - 4 * s, y + 1 * s)], '#4f9bd6', OUTLINE, 1);
      }
      break;
    case 'fields':
      poly(ctx, [P(0, -8), P(10, -3), P(0, 8), P(-10, -3)], '#8a6a3a', OUTLINE, 1);
      for (let i = -2; i <= 2; i++) line(ctx, P(i * 3 - 3, -4 + Math.abs(i) * 0.2 + 3), P(i * 3 + 3, -4 + 8 - Math.abs(i) * 0.2 - 3), C.leafLight, 1.2);
      break;
    case 'scroll':
      rrect(ctx, -7, -8, 14, 16, 2, '#efe2bd', OUTLINE, 1);
      for (let i = 0; i < 3; i++) line(ctx, P(-4, -4 + i * 4), P(4, -4 + i * 4), k.ink, 1);
      circle(ctx, 4, 6, 2.6, k.accent, OUTLINE, 0.8);
      break;
    case 'coin':
      circle(ctx, 0, 0, 8, C.gold, OUTLINE, 1.2);
      circle(ctx, 0, 0, 5, null, C.goldDark, 1);
      line(ctx, P(0, -3), P(0, 3), C.goldDark, 1.6);
      break;
    case 'rock':
      poly(ctx, [P(-9, 7), P(-6, -2), P(0, -8), P(7, -4), P(9, 7)], C.stone, OUTLINE, 1.1);
      poly(ctx, [P(-2, -7), P(7, -4), P(9, 7), P(2, 7), P(0, 0)], C.stoneDark, OUTLINE, 0.8);
      break;
    case 'apple':
      circle(ctx, 0, 1, 7, C.berry, OUTLINE, 1.1);
      line(ctx, P(0, -6), P(1, -9), C.woodDark, 1.5);
      ellipse(ctx, 3.5, -7, 3, 1.6, C.leafLight, OUTLINE, 0.8);
      break;
    case 'timbers':
      o(P(-8, 8), P(-8, -6), C.wood, 3);
      o(P(8, 8), P(8, -6), C.wood, 3);
      o(P(-10, -6), P(10, -6), C.woodLight, 3);
      circle(ctx, 0, 3, 3, C.gold, OUTLINE, 1);
      break;
    case 'pillar':
      rrect(ctx, -3, -7, 6, 14, 1, C.stoneLight, OUTLINE, 1);
      rrect(ctx, -6, -9, 12, 4, 1.5, C.stone, OUTLINE, 1);
      rrect(ctx, -6, 6, 12, 4, 1.5, C.stone, OUTLINE, 1);
      break;
    case 'ram':
      o(P(-9, 2), P(8, 2), C.wood, 4);
      circle(ctx, 9, 2, 3, C.steelDark, OUTLINE, 1);
      poly(ctx, [P(-6, -2), P(6, -2), P(2, -8), P(-2, -8)], k.accent, OUTLINE, 1);
      circle(ctx, -5, 8, 2.6, C.woodDark, OUTLINE, 0.8);
      circle(ctx, 5, 8, 2.6, C.woodDark, OUTLINE, 0.8);
      break;
    case 'tower':
      poly(ctx, [P(-4, 9), P(-5, -5), P(5, -5), P(4, 9)], C.stoneLight, OUTLINE, 1);
      poly(ctx, [P(-7, -5), P(0, -11), P(7, -5)], C.roofRed, OUTLINE, 1);
      break;
    case 'cross':
      rrect(ctx, -2, -9, 4, 18, 1, k.accent, OUTLINE, 1);
      rrect(ctx, -6, -4, 12, 4, 1, k.accent, OUTLINE, 1);
      break;
  }
  ctx.restore();
}
