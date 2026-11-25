/**
 * Procedural unit drawings. Each unit type is drawn from a screen-space facing
 * direction, so every facing can be produced; the manifest draws five views
 * (S, SE, E, NE, N) and mirrors the other three (plan 6.1).
 */

import type { Facing } from '../../sim/types';
import type { UnitAnimState } from './manifest';
import { circle, ellipse, line, outlinedLine, poly, rrect, shadow, type Ctx, type Pt } from './draw';
import { C, OUTLINE, type TeamColors } from './palette';
import type { UnitKey } from './catalog';

/** Unit vector on screen for each facing (see CLAUDE.md facing table). */
export const FACING_DIR: readonly Pt[] = [
  { x: 0.894, y: 0.447 }, // 0 SE
  { x: 0, y: 1 }, // 1 S
  { x: -0.894, y: 0.447 }, // 2 SW
  { x: -1, y: 0 }, // 3 W
  { x: -0.894, y: -0.447 }, // 4 NW
  { x: 0, y: -1 }, // 5 N
  { x: 0.894, y: -0.447 }, // 6 NE
  { x: 1, y: 0 }, // 7 E
];

/** Which drawn view each facing uses, and whether it is mirrored horizontally. */
export const FACING_SOURCE: readonly { src: Facing; mirror: boolean }[] = [
  { src: 0, mirror: false },
  { src: 1, mirror: false },
  { src: 0, mirror: true },
  { src: 7, mirror: true },
  { src: 6, mirror: true },
  { src: 5, mirror: false },
  { src: 6, mirror: false },
  { src: 7, mirror: false },
];

/** Facings that are actually drawn (the rest are mirrored). */
export const DRAWN_FACINGS: readonly Facing[] = [0, 1, 5, 6, 7];

export interface UnitSize {
  w: number;
  h: number;
  /** Feet / ground anchor in logical pixels. */
  ax: number;
  ay: number;
}

const HUMAN: UnitSize = { w: 64, h: 68, ax: 32, ay: 56 };
const HORSE: UnitSize = { w: 104, h: 96, ax: 52, ay: 76 };
const SIEGE: UnitSize = { w: 128, h: 112, ax: 64, ay: 86 };

export const UNIT_SIZES: Readonly<Record<UnitKey, UnitSize>> = {
  villager: HUMAN,
  spearman: HUMAN,
  swordsman: HUMAN,
  archer: HUMAN,
  siphonarios: HUMAN,
  horseman: HORSE,
  lancer: HORSE,
  cataphract: HORSE,
  batteringRam: SIEGE,
  trebuchet: SIEGE,
};

interface P {
  ctx: Ctx;
  ax: number;
  ay: number;
  dir: Pt;
  perp: Pt;
  state: UnitAnimState;
  frame: 0 | 1;
  team: TeamColors;
}

interface Layer {
  z: number;
  fn: () => void;
}

function flush(layers: Layer[]): void {
  layers.sort((a, b) => a.z - b.z);
  for (const l of layers) l.fn();
}

const fwdSign = (d: Pt): number => (d.x < -0.01 ? -1 : 1);

/** Tip of a prop of length L held at `hand`, swung by angle a (0 = straight up). */
function tipOf(hand: Pt, L: number, a: number, d: Pt): Pt {
  return { x: hand.x + fwdSign(d) * Math.sin(a) * L, y: hand.y - Math.cos(a) * L };
}

function swingAngle(p: P, rest: number, raised: number, lowered: number): number {
  if (p.state === 'work') return p.frame === 0 ? raised : lowered;
  if (p.state === 'walk' || p.state === 'carry') return rest + (p.frame === 0 ? -0.08 : 0.08);
  return rest;
}

// ---------------------------------------------------------------------------
// Humanoids
// ---------------------------------------------------------------------------

type HatKind = 'straw' | 'cap' | 'hood' | 'helm' | 'crest' | 'bronze' | 'plume';

interface HumanOpts {
  tunic: string;
  tunicDark: string;
  trim: string;
  legs: string;
  hat: HatKind;
  /** Draw legs (false for riders). */
  legsVisible?: boolean;
  /** Armour over the torso. */
  armor?: string;
  /** Hooks to add props. `hands` = right/left hand positions. */
  props?: (add: (z: number, fn: () => void) => void, hands: { r: Pt; l: Pt; chest: Pt; hip: Pt; head: Pt }) => void;
  /** Override pose (riders do not walk). */
  still?: boolean;
}

function paintHuman(p: P, o: HumanOpts): { chest: Pt; head: Pt; hip: Pt; handR: Pt; handL: Pt } {
  const { ctx, ax, ay, dir, perp, state, frame, team } = p;
  const layers: Layer[] = [];
  const add = (z: number, fn: () => void): void => {
    layers.push({ z, fn });
  };
  const moving = !o.still && (state === 'walk' || state === 'carry');
  const bob = moving ? (frame === 1 ? 1.4 : 0) : state === 'idle' && !o.still ? (frame === 1 ? 0.7 : 0) : 0;
  const lean = !o.still && state === 'work' ? (frame === 1 ? 3 : 0.5) : 0;
  const hip: Pt = { x: ax + dir.x * lean * 0.5, y: ay - 12 - bob };
  const chest: Pt = { x: hip.x + dir.x * lean, y: hip.y - 9 + lean * 0.35 };
  const head: Pt = { x: chest.x + dir.x * 1.2, y: chest.y - 8.5 };
  const hw = 3.8 + 2.2 * Math.abs(dir.y);
  const back = dir.y < -0.3;

  // Legs.
  if (o.legsVisible !== false) {
    const s = moving ? (frame === 1 ? 1 : -1) : 0;
    for (const side of [1, -1]) {
      const stride = s * side * 3.4;
      const foot: Pt = {
        x: ax + perp.x * 2.4 * side + dir.x * stride,
        y: ay + perp.y * 2.4 * side + dir.y * stride * 0.6 - (stride > 1.5 ? 1.4 : 0),
      };
      const top: Pt = { x: hip.x + perp.x * 2 * side, y: hip.y + perp.y * 2 * side };
      add(foot.y - ay - 0.5, () => {
        outlinedLine(ctx, top, foot, o.legs, 3.2);
        ellipse(ctx, foot.x, foot.y + 0.4, 2.4, 1.4, C.leather, OUTLINE, 0.8);
      });
    }
  }

  // Hands.
  const swing = state === 'work' && !o.still ? (frame === 1 ? 2 : -1) : 0;
  const handR: Pt = {
    x: chest.x + perp.x * (hw + 1.6) + dir.x * (3 + swing),
    y: chest.y + 5 + perp.y * (hw + 1.6) + dir.y * 1.5,
  };
  const handL: Pt = {
    x: chest.x - perp.x * (hw + 1.6) + dir.x * 2,
    y: chest.y + 5 - perp.y * (hw + 1.6) + dir.y * 1.2,
  };

  // Arms (behind or in front of the torso depending on side).
  for (const [hand, side] of [
    [handR, 1],
    [handL, -1],
  ] as const) {
    const shoulder: Pt = { x: chest.x + perp.x * hw * 0.9 * side, y: chest.y + perp.y * hw * 0.9 * side + 1 };
    add(hand.y - chest.y - 5 + (side === 1 ? 0.3 : -0.3), () => {
      outlinedLine(ctx, shoulder, hand, o.tunic, 2.8);
      circle(ctx, hand.x, hand.y, 1.9, C.skin, OUTLINE, 0.8);
    });
  }

  // Torso.
  add(0, () => {
    const pts: Pt[] = [
      { x: chest.x - hw * 1.1, y: chest.y - 3 },
      { x: chest.x + hw * 1.1, y: chest.y - 3 },
      { x: hip.x + hw, y: hip.y + 2.5 },
      { x: hip.x - hw, y: hip.y + 2.5 },
    ];
    poly(ctx, pts, o.tunic, OUTLINE, 1.2);
    if (o.armor !== undefined) {
      poly(ctx, [pts[0]!, pts[1]!, { x: chest.x + hw * 0.9, y: chest.y + 5 }, { x: chest.x - hw * 0.9, y: chest.y + 5 }], o.armor, OUTLINE, 0.8);
    }
    // Hem trim and belt (secondary colour = gold trim).
    line(ctx, { x: hip.x - hw, y: hip.y + 2 }, { x: hip.x + hw, y: hip.y + 2 }, o.trim, 1.6);
    line(ctx, { x: chest.x - hw, y: hip.y - 3 }, { x: chest.x + hw, y: hip.y - 3 }, o.tunicDark, 1.4);
    // Sash collar.
    if (!back) line(ctx, { x: chest.x - hw * 0.8, y: chest.y - 2.4 }, { x: chest.x + hw * 0.8, y: chest.y - 2.4 }, o.trim, 1.2);
  });

  // Head and hat.
  add(0.4, () => {
    circle(ctx, head.x, head.y, 4.6, C.skin, OUTLINE, 1.1);
    if (!back) {
      // Face hint: two eyes shifted along the facing.
      const ex = dir.x * 1.6;
      circle(ctx, head.x + ex - 1.3, head.y + 0.4, 0.55, OUTLINE, null);
      circle(ctx, head.x + ex + 1.3, head.y + 0.4, 0.55, OUTLINE, null);
    } else {
      ctx.beginPath();
      ctx.arc(head.x, head.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = C.woodDark;
      ctx.fill();
    }
    paintHat(ctx, head, o.hat, team, dir);
  });

  o.props?.(add, { r: handR, l: handL, chest, hip, head });
  flush(layers);
  return { chest, head, hip, handR, handL };
}

function paintHat(ctx: Ctx, head: Pt, hat: HatKind, team: TeamColors, dir: Pt): void {
  const { x, y } = head;
  switch (hat) {
    case 'straw':
      ellipse(ctx, x, y - 2.4, 8, 2.8, '#d9bb62', OUTLINE, 1);
      ctx.beginPath();
      ctx.ellipse(x, y - 3.4, 4.2, 3.2, 0, Math.PI, 0);
      ctx.fillStyle = '#e8cd7a';
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    case 'cap':
      ctx.beginPath();
      ctx.ellipse(x, y - 1.2, 5, 4.4, 0, Math.PI, 0);
      ctx.fillStyle = C.leather;
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1;
      ctx.stroke();
      line(ctx, { x: x - 5, y: y - 1.1 }, { x: x + 5, y: y - 1.1 }, team.primary, 1.6);
      break;
    case 'hood':
      ctx.beginPath();
      ctx.ellipse(x, y - 0.8, 5.6, 5.4, 0, Math.PI * 0.95, Math.PI * 0.05, false);
      ctx.fillStyle = '#4d7a3a';
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1;
      ctx.stroke();
      poly(ctx, [{ x: x - 1.5, y: y - 6.5 }, { x: x + 3 * Math.sign(dir.x || 1), y: y - 9 }, { x: x + 1.5, y: y - 5.5 }], '#3d6a2d', OUTLINE, 0.8);
      line(ctx, { x: x - 5, y: y - 0.6 }, { x: x + 5, y: y - 0.6 }, team.primary, 1.4);
      break;
    case 'helm':
    case 'crest':
    case 'plume':
    case 'bronze': {
      const metal = hat === 'bronze' ? '#b87d3a' : C.steel;
      const metalDark = hat === 'bronze' ? '#7d5320' : C.steelDark;
      ctx.beginPath();
      ctx.ellipse(x, y - 0.8, 5.4, 5.4, 0, Math.PI, 0);
      ctx.lineTo(x + 5.4, y + 0.6);
      ctx.lineTo(x - 5.4, y + 0.6);
      ctx.closePath();
      ctx.fillStyle = metal;
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.1;
      ctx.stroke();
      line(ctx, { x: x - 4.8, y: y + 0.2 }, { x: x + 4.8, y: y + 0.2 }, metalDark, 1.2);
      if (hat === 'crest' || hat === 'plume') {
        const base: Pt = { x, y: y - 6 };
        poly(ctx, [base, { x: x - 4 * (dir.x || 1), y: y - 11 }, { x: x - 1 * (dir.x || 1), y: y - 12 }, { x: x + 2, y: y - 6.3 }], team.primary, OUTLINE, 1);
        line(ctx, { x: x - 3 * (dir.x || 1), y: y - 10.3 }, { x: x, y: y - 6.6 }, team.secondary, 1);
      }
      break;
    }
  }
}

/** A sack on the back (villager carrying). */
function sack(p: P, add: (z: number, fn: () => void) => void, chest: Pt): void {
  const { ctx, dir } = p;
  const c: Pt = { x: chest.x - dir.x * 4.5, y: chest.y + 1 - dir.y * 2.5 };
  add(-dir.y * 3 - 1, () => {
    ellipse(ctx, c.x, c.y, 5.2, 5.8, '#c8a86a', OUTLINE, 1.1);
    line(ctx, { x: c.x - 2.5, y: c.y - 4.4 }, { x: c.x + 2.5, y: c.y - 4.6 }, C.woodDark, 1.4);
  });
}

function paintVillager(p: P): void {
  const { ctx, team } = p;
  paintHuman(p, {
    tunic: team.primary,
    tunicDark: team.primaryDark,
    trim: team.secondary,
    legs: '#6d5a40',
    hat: 'straw',
    props: (add, h) => {
      if (p.state === 'carry') sack(p, add, h.chest);
      const a = swingAngle(p, 0.35, -1.0, 1.1);
      const tip = tipOf(h.r, 15, a, p.dir);
      add(h.r.y - p.ay + 2, () => {
        outlinedLine(ctx, h.r, tip, C.woodLight, 1.8);
        // Axe head.
        const side = fwdSign(p.dir);
        const d = { x: tip.x - h.r.x, y: tip.y - h.r.y };
        const len = Math.hypot(d.x, d.y) || 1;
        const n = { x: (-d.y / len) * side, y: (d.x / len) * side };
        poly(
          ctx,
          [
            { x: tip.x - d.x * 0.1, y: tip.y - d.y * 0.1 },
            { x: tip.x + n.x * 6 - d.x * 0.02, y: tip.y + n.y * 6 - 2 },
            { x: tip.x + n.x * 5 - d.x * 0.15, y: tip.y + n.y * 5 + 3 },
            { x: tip.x - d.x * 0.25, y: tip.y - d.y * 0.25 },
          ],
          C.steel,
          OUTLINE,
          1,
        );
      });
    },
  });
}

function paintSpearman(p: P): void {
  const { ctx, team } = p;
  paintHuman(p, {
    tunic: team.primary,
    tunicDark: team.primaryDark,
    trim: team.secondary,
    legs: '#4a4038',
    hat: 'cap',
    armor: '#8a6a3a',
    props: (add, h) => {
      const a = p.state === 'work' ? (p.frame === 0 ? 0.55 : 1.35) : swingAngle(p, 0.06, 0, 0);
      const L = 34;
      const base: Pt = { x: h.r.x - Math.sin(a) * 6 * fwdSign(p.dir), y: h.r.y + Math.cos(a) * 6 };
      const tip = tipOf(base, L, a, p.dir);
      add(h.r.y - p.ay + 3, () => {
        outlinedLine(ctx, base, tip, C.woodLight, 2);
        // Leaf head and pennon in team colour.
        const d = { x: tip.x - base.x, y: tip.y - base.y };
        const len = Math.hypot(d.x, d.y);
        const u = { x: d.x / len, y: d.y / len };
        const nrm = { x: -u.y, y: u.x };
        poly(ctx, [
          { x: tip.x + u.x * 5, y: tip.y + u.y * 5 },
          { x: tip.x + nrm.x * 2.2, y: tip.y + nrm.y * 2.2 },
          { x: tip.x - nrm.x * 2.2, y: tip.y - nrm.y * 2.2 },
        ], C.steel, OUTLINE, 1);
        const pb: Pt = { x: tip.x - u.x * 3, y: tip.y - u.y * 3 };
        poly(ctx, [pb, { x: pb.x + nrm.x * 6 - u.x * 3, y: pb.y + nrm.y * 6 - u.y * 3 + 2 }, { x: pb.x - u.x * 6, y: pb.y - u.y * 6 }], team.primary, OUTLINE, 0.8);
      });
    },
  });
}

function paintSwordsman(p: P): void {
  const { ctx, team } = p;
  paintHuman(p, {
    tunic: team.primary,
    tunicDark: team.primaryDark,
    trim: team.secondary,
    legs: '#3f3f48',
    hat: 'crest',
    armor: C.steel,
    props: (add, h) => {
      const a = swingAngle(p, 0.55, -1.0, 1.25);
      const tip = tipOf(h.r, 17, a, p.dir);
      add(h.r.y - p.ay + 2, () => {
        outlinedLine(ctx, h.r, tip, '#e9eef5', 2.2);
        const d = { x: tip.x - h.r.x, y: tip.y - h.r.y };
        const len = Math.hypot(d.x, d.y);
        const n = { x: -d.y / len, y: d.x / len };
        const g = { x: h.r.x + (d.x / len) * 3, y: h.r.y + (d.y / len) * 3 };
        line(ctx, { x: g.x - n.x * 3.4, y: g.y - n.y * 3.4 }, { x: g.x + n.x * 3.4, y: g.y + n.y * 3.4 }, C.gold, 1.8);
      });
      // Shield on the left arm, large and team coloured.
      const s = h.l;
      add(s.y - p.ay + 3, () => {
        const sx = s.x + p.dir.x * 1;
        poly(ctx, [{ x: sx - 6.5, y: s.y - 9 }, { x: sx + 6.5, y: s.y - 9 }, { x: sx + 6, y: s.y + 1.5 }, { x: sx, y: s.y + 8 }, { x: sx - 6, y: s.y + 1.5 }], team.primary, OUTLINE, 1.3);
        line(ctx, { x: sx, y: s.y - 8.5 }, { x: sx, y: s.y + 7 }, team.secondary, 1.8);
        line(ctx, { x: sx - 5.2, y: s.y - 3 }, { x: sx + 5.2, y: s.y - 3 }, team.secondary, 1.8);
      });
    },
  });
}

function paintArcher(p: P): void {
  const { ctx, team } = p;
  paintHuman(p, {
    tunic: '#5a7f45',
    tunicDark: '#3d5a2f',
    trim: team.primary,
    legs: '#5a4630',
    hat: 'hood',
    props: (add, h) => {
      // Quiver on the back, with team-coloured fletching.
      const q: Pt = { x: h.chest.x - p.dir.x * 4.5, y: h.chest.y - 1 - p.dir.y * 2 };
      add(-p.dir.y * 3 - 1, () => {
        poly(ctx, [{ x: q.x - 2.2, y: q.y - 5 }, { x: q.x + 2.2, y: q.y - 6 }, { x: q.x + 3, y: q.y + 5 }, { x: q.x - 1.5, y: q.y + 5.5 }], C.leather, OUTLINE, 1);
        line(ctx, { x: q.x - 0.5, y: q.y - 5.5 }, { x: q.x - 1, y: q.y - 9 }, team.primary, 1.4);
        line(ctx, { x: q.x + 1.2, y: q.y - 5.8 }, { x: q.x + 1.7, y: q.y - 9 }, team.secondary, 1.4);
      });
      // Bow held in the left hand.
      const b = h.l;
      const drawn = p.state === 'work' && p.frame === 1;
      add(b.y - p.ay + 3, () => {
        const sgn = fwdSign(p.dir);
        const cx = b.x + sgn * 3.5;
        ctx.beginPath();
        ctx.moveTo(cx - sgn * 1, b.y - 12);
        ctx.quadraticCurveTo(cx + sgn * 7, b.y, cx - sgn * 1, b.y + 12);
        ctx.strokeStyle = OUTLINE;
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.strokeStyle = C.woodLight;
        ctx.lineWidth = 2;
        ctx.stroke();
        const mid: Pt = { x: drawn ? cx - sgn * 5 : cx - sgn * 1, y: b.y };
        line(ctx, { x: cx - sgn * 1, y: b.y - 12 }, mid, '#f2eedd', 0.9);
        line(ctx, mid, { x: cx - sgn * 1, y: b.y + 12 }, '#f2eedd', 0.9);
        if (drawn) outlinedLine(ctx, mid, { x: cx + sgn * 8, y: b.y }, '#e9eef5', 1.1);
      });
    },
  });
}

function paintSiphonarios(p: P): void {
  const { ctx, team } = p;
  paintHuman(p, {
    tunic: '#8a4a2a',
    tunicDark: '#5d2f18',
    trim: team.secondary,
    legs: '#3a2c24',
    hat: 'bronze',
    armor: team.primary,
    props: (add, h) => {
      // Pressure tank on the back (team-coloured band).
      const t: Pt = { x: h.chest.x - p.dir.x * 5, y: h.chest.y + 0.5 - p.dir.y * 2.5 };
      add(-p.dir.y * 3 - 1, () => {
        rrect(ctx, t.x - 4.5, t.y - 8, 9, 15, 3.5, '#b87d3a', OUTLINE, 1.1);
        line(ctx, { x: t.x - 4.5, y: t.y - 2 }, { x: t.x + 4.5, y: t.y - 2 }, team.primary, 2);
        line(ctx, { x: t.x - 4.5, y: t.y + 3 }, { x: t.x + 4.5, y: t.y + 3 }, team.secondary, 1.4);
      });
      // Nozzle: a long bronze tube held forward, with Greek fire at the mouth.
      const sgn = fwdSign(p.dir);
      const start = h.r;
      const lift = p.state === 'work' ? 6 : 3;
      const end: Pt = { x: start.x + p.dir.x * 17 + (p.dir.x === 0 ? sgn * 8 : 0), y: start.y - lift + p.dir.y * 7 };
      add(start.y - p.ay + 4, () => {
        outlinedLine(ctx, { x: h.chest.x, y: h.chest.y + 2 }, start, '#6d5a40', 1.6);
        outlinedLine(ctx, start, end, '#c58d44', 2.6);
        circle(ctx, end.x, end.y, 1.9, '#7d5320', OUTLINE, 0.9);
        const big = p.state === 'work';
        const len = big ? (p.frame === 0 ? 17 : 22) : 5;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const dl = Math.hypot(dx, dy) || 1;
        const u = { x: dx / dl, y: dy / dl };
        const n = { x: -u.y, y: u.x };
        const wid = big ? 5.2 : 2;
        poly(ctx, [
          { x: end.x + n.x * wid * 0.4, y: end.y + n.y * wid * 0.4 },
          { x: end.x + u.x * len * 0.55 + n.x * wid, y: end.y + u.y * len * 0.55 + n.y * wid },
          { x: end.x + u.x * len, y: end.y + u.y * len - 1.5 },
          { x: end.x + u.x * len * 0.55 - n.x * wid, y: end.y + u.y * len * 0.55 - n.y * wid },
          { x: end.x - n.x * wid * 0.4, y: end.y - n.y * wid * 0.4 },
        ], C.fire, '#8c2d0a', 1);
        poly(ctx, [
          end,
          { x: end.x + u.x * len * 0.6 + n.x * wid * 0.35, y: end.y + u.y * len * 0.6 + n.y * wid * 0.35 },
          { x: end.x + u.x * len * 0.8, y: end.y + u.y * len * 0.8 - 1 },
          { x: end.x + u.x * len * 0.6 - n.x * wid * 0.35, y: end.y + u.y * len * 0.6 - n.y * wid * 0.35 },
        ], C.fireLight, null);
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Horses and riders
// ---------------------------------------------------------------------------

interface HorseOpts {
  coat: string;
  coatDark: string;
  /** 'barding': team caparison; 'full': caparison + steel head armour. */
  armor: 'none' | 'barding' | 'full';
  rider: 'horseman' | 'lancer' | 'cataphract';
  scale: number;
}

function paintCavalry(p: P, o: HorseOpts): void {
  const { ctx, ax, ay, dir, perp, state, frame, team } = p;
  const layers: Layer[] = [];
  const add = (z: number, fn: () => void): void => {
    layers.push({ z, fn });
  };
  const k = o.scale;
  const dv: Pt = { x: dir.x, y: dir.y * 0.6 };
  const gallop = state === 'walk' || state === 'carry';
  const bob = gallop ? (frame === 1 ? 2 : 0) : state === 'idle' ? (frame === 1 ? 0.8 : 0) : 0;
  const c: Pt = { x: ax, y: ay - 17 * k - bob };
  const half = 12 * k;
  const rear: Pt = { x: c.x - dv.x * half, y: c.y - dv.y * half };
  const front: Pt = { x: c.x + dv.x * half, y: c.y + dv.y * half };
  const bodyW = 11.5 * k;

  // Legs: four, in diagonal pairs.
  const legSpec: [Pt, number][] = [
    [rear, 1],
    [front, -1],
    [rear, -1],
    [front, 1],
  ];
  legSpec.forEach(([root, phase], i) => {
    const side = i < 2 ? 1 : -1;
    const s = gallop ? (frame === 1 ? phase : -phase) * 4 : state === 'work' ? (i === 1 && frame === 1 ? 2.5 : 0) : 0;
    const top: Pt = { x: root.x + perp.x * 3 * side, y: root.y + perp.y * 3 * side + 3 };
    const foot: Pt = { x: top.x + dir.x * s, y: ay + perp.y * 3 * side + dir.y * s * 0.5 - (s > 2 ? 2 : 0) };
    add(foot.y - ay - 2, () => {
      outlinedLine(ctx, top, foot, o.coatDark, 3.4);
      circle(ctx, foot.x, foot.y, 1.8, '#2b2020', null);
    });
  });

  // Tail.
  add(-dv.y * 10 - 4, () => {
    outlinedLine(ctx, { x: rear.x, y: rear.y - 1 }, { x: rear.x - dv.x * 6 + 1, y: rear.y + 8 - dv.y * 3 }, o.coatDark, 3);
  });

  // Body.
  add(0, () => {
    line(ctx, rear, front, OUTLINE, bodyW + 2);
    line(ctx, rear, front, o.coat, bodyW);
    line(ctx, { x: rear.x, y: rear.y - bodyW * 0.28 }, { x: front.x, y: front.y - bodyW * 0.28 }, o.coatDark, 1.2);
    if (o.armor !== 'none') {
      const a: Pt = { x: c.x - dv.x * half * 0.85, y: c.y - dv.y * half * 0.85 + 0.5 };
      const b: Pt = { x: c.x + dv.x * half * 0.55, y: c.y + dv.y * half * 0.55 + 0.5 };
      line(ctx, a, b, OUTLINE, bodyW + 2.4);
      line(ctx, a, b, team.primary, bodyW + 0.4);
      line(ctx, { x: a.x, y: a.y + bodyW * 0.32 }, { x: b.x, y: b.y + bodyW * 0.32 }, team.secondary, 2);
      if (o.armor === 'full') {
        line(ctx, { x: a.x, y: a.y - bodyW * 0.3 }, { x: b.x, y: b.y - bodyW * 0.3 }, team.secondary, 1.3);
        circle(ctx, c.x, c.y, 2.2, team.secondary, OUTLINE, 0.8);
      }
    }
    // Saddle.
    ellipse(ctx, c.x, c.y - bodyW * 0.45, 4.2 * k, 2.3, C.leather, OUTLINE, 0.9);
  });

  // Neck and head.
  const neckBase: Pt = { x: front.x, y: front.y - 2 };
  const headPos: Pt = { x: front.x + dv.x * 8 * k + dir.x * 2, y: front.y + dv.y * 8 * k - 11 * k - (state === 'idle' && frame === 1 ? 1 : 0) + (dir.y > 0.5 ? 6 : 0) };
  add(dv.y * 10 + (dir.y > 0.5 ? 6 : -6), () => {
    line(ctx, neckBase, headPos, OUTLINE, 7.5 * k + 2);
    line(ctx, neckBase, headPos, o.coat, 7.5 * k);
    // Mane.
    line(ctx, { x: neckBase.x - dv.x * 1.2, y: neckBase.y - 2 }, { x: headPos.x - dv.x * 1.4, y: headPos.y - 1 }, o.coatDark, 2);
    // Muzzle.
    const muz: Pt = { x: headPos.x + dir.x * 5.5, y: headPos.y + 4 + (dir.y > 0.5 ? 2 : 0) };
    line(ctx, headPos, muz, OUTLINE, 6.4 * k + 2);
    line(ctx, headPos, muz, o.armor === 'full' ? C.steel : o.coat, 6.4 * k);
    if (o.armor === 'full') line(ctx, headPos, { x: headPos.x + dir.x * 2.5, y: headPos.y + 1.5 }, team.secondary, 3);
    // Ears.
    poly(ctx, [{ x: headPos.x - 1.5, y: headPos.y - 3.5 }, { x: headPos.x - 0.5, y: headPos.y - 7 }, { x: headPos.x + 1.2, y: headPos.y - 3 }], o.coatDark, OUTLINE, 0.8);
    if (dir.y > -0.3) circle(ctx, headPos.x + dir.x * 2, headPos.y - 0.3, 0.7, OUTLINE, null);
  });

  // Rider.
  add(1, () => {
    const riderAy = c.y - bodyW * 0.35 + 9;
    const rp: P = { ...p, ax: c.x, ay: riderAy };
    const hat: HatKind = o.rider === 'horseman' ? 'cap' : o.rider === 'lancer' ? 'helm' : 'plume';
    paintHuman(rp, {
      tunic: o.rider === 'cataphract' ? team.primary : team.primary,
      tunicDark: team.primaryDark,
      trim: team.secondary,
      legs: '#3f3f48',
      hat,
      armor: o.rider === 'horseman' ? '#8a6a3a' : C.steel,
      legsVisible: false,
      still: true,
      props: (addL, h) => {
        const sgn = fwdSign(dir);
        if (o.rider === 'horseman') {
          const a = state === 'work' ? (frame === 0 ? 0.3 : 1.25) : 0.12;
          const base: Pt = { x: h.r.x - Math.sin(a) * 5 * sgn, y: h.r.y + Math.cos(a) * 5 };
          const tip = tipOf(base, 24, a, dir);
          addL(h.r.y - riderAy + 3, () => {
            outlinedLine(ctx, base, tip, C.woodLight, 1.8);
            const u = { x: (tip.x - base.x) / 24, y: (tip.y - base.y) / 24 };
            poly(ctx, [{ x: tip.x + u.x * 4, y: tip.y + u.y * 4 }, { x: tip.x - u.y * 1.8, y: tip.y + u.x * 1.8 }, { x: tip.x + u.y * 1.8, y: tip.y - u.x * 1.8 }], C.steel, OUTLINE, 0.8);
          });
        } else if (o.rider === 'lancer') {
          // Long lance couched forward, with a team pennant.
          const a0: Pt = { x: h.r.x - dir.x * 12, y: h.r.y - dir.y * 5 + 2 };
          const lift = state === 'work' && frame === 1 ? -6 : 0;
          const a1: Pt = { x: h.r.x + dir.x * 26 + (dir.x === 0 ? sgn * 3 : 0), y: h.r.y + dir.y * 11 - 8 + lift };
          addL(h.r.y - riderAy + 3, () => {
            outlinedLine(ctx, a0, a1, C.woodLight, 1.9);
            const u = { x: a1.x - a0.x, y: a1.y - a0.y };
            const ul = Math.hypot(u.x, u.y) || 1;
            u.x /= ul;
            u.y /= ul;
            poly(ctx, [{ x: a1.x + u.x * 6, y: a1.y + u.y * 6 }, { x: a1.x - u.y * 2, y: a1.y + u.x * 2 }, { x: a1.x + u.y * 2, y: a1.y - u.x * 2 }], C.steel, OUTLINE, 0.8);
            const pb: Pt = { x: a1.x - u.x * 3, y: a1.y - u.y * 3 };
            poly(ctx, [pb, { x: pb.x - u.x * 9, y: pb.y - u.y * 9 + 4 }, { x: pb.x - u.x * 8, y: pb.y - u.y * 8 - 2 }], team.secondary, OUTLINE, 0.8);
          });
          // Kite shield.
          const s = h.l;
          addL(s.y - riderAy + 3, () => {
            poly(ctx, [{ x: s.x - 5.5, y: s.y - 7 }, { x: s.x + 5.5, y: s.y - 7 }, { x: s.x + 4.5, y: s.y + 2 }, { x: s.x, y: s.y + 8 }, { x: s.x - 4.5, y: s.y + 2 }], team.primaryLight, OUTLINE, 1.1);
            line(ctx, { x: s.x, y: s.y - 6 }, { x: s.x, y: s.y + 6 }, team.secondary, 1.5);
          });
        } else {
          // Cataphract: flanged mace.
          const a = swingAngle({ ...p, state }, 0.25, -1.1, 1.2);
          const tip = tipOf(h.r, 15, a, dir);
          addL(h.r.y - riderAy + 3, () => {
            outlinedLine(ctx, h.r, tip, C.steelDark, 2);
            circle(ctx, tip.x, tip.y, 3.6, '#e9d27a', OUTLINE, 1.1);
            for (const [dx, dy] of [[-4, 0], [4, 0], [0, -4], [0, 4]] as const) line(ctx, tip, { x: tip.x + dx, y: tip.y + dy }, OUTLINE, 1.4);
          });
          const s = h.l;
          addL(s.y - riderAy + 3, () => {
            circle(ctx, s.x, s.y - 1, 6.2, team.primaryLight, OUTLINE, 1.2);
            circle(ctx, s.x, s.y - 1, 2.4, team.secondary, OUTLINE, 0.8);
          });
        }
      },
    });
  });

  flush(layers);
}

// ---------------------------------------------------------------------------
// Siege
// ---------------------------------------------------------------------------

function wheel(ctx: Ctx, x: number, y: number, r: number, spin: number): void {
  ellipse(ctx, x, y, r * 0.62, r, C.woodDark, OUTLINE, 1.4);
  ellipse(ctx, x, y, r * 0.3, r * 0.5, C.woodLight, OUTLINE, 0.8);
  for (let i = 0; i < 4; i++) {
    const a = spin + (i * Math.PI) / 2;
    line(ctx, { x, y }, { x: x + Math.cos(a) * r * 0.55, y: y + Math.sin(a) * r * 0.9 }, C.woodDark, 1);
  }
}

function paintRam(p: P): void {
  const { ctx, ax, ay, dir, perp, state, frame, team } = p;
  const layers: Layer[] = [];
  const add = (z: number, fn: () => void): void => {
    layers.push({ z, fn });
  };
  const dv: Pt = { x: dir.x, y: dir.y * 0.6 };
  const c: Pt = { x: ax, y: ay - 14 };
  const half = 26;
  const rear: Pt = { x: c.x - dv.x * half, y: c.y - dv.y * half };
  const front: Pt = { x: c.x + dv.x * half, y: c.y + dv.y * half };
  const spin = state === 'walk' || state === 'carry' ? (frame === 1 ? 0.7 : 0) : 0;
  const ramOffset = state === 'work' ? (frame === 1 ? 9 : -5) : state === 'walk' || state === 'carry' ? (frame === 1 ? 1 : 0) : 0;

  // Wheels: four, at corners.
  for (const along of [-0.7, 0.7]) {
    for (const side of [-1, 1]) {
      const wp: Pt = { x: c.x + dv.x * half * along + perp.x * 11 * side, y: c.y + dv.y * half * along + perp.y * 11 * side * 0.8 + 9 };
      add(wp.y - ay, () => wheel(ctx, wp.x, wp.y, 7.5, spin));
    }
  }
  // Frame beams.
  add(-1, () => {
    for (const side of [-1, 1]) {
      const o: Pt = { x: perp.x * 9 * side, y: perp.y * 9 * side * 0.8 + 5 };
      outlinedLine(ctx, { x: rear.x + o.x, y: rear.y + o.y }, { x: front.x + o.x, y: front.y + o.y }, C.woodDark, 3);
    }
  });
  // The log, with iron head.
  const logA: Pt = { x: rear.x + dv.x * ramOffset, y: rear.y + dv.y * ramOffset + 2 };
  const logB: Pt = { x: front.x + dv.x * (ramOffset + 8), y: front.y + dv.y * (ramOffset + 8) + 2 };
  add(0.5, () => {
    outlinedLine(ctx, logA, logB, '#7a5230', 6);
    const u = { x: dv.x, y: dv.y };
    const ul = Math.hypot(u.x, u.y) || 1;
    ellipse(ctx, logB.x + (u.x / ul) * 1, logB.y + (u.y / ul) * 1, 4, 4, '#7d8590', OUTLINE, 1.2);
  });
  // Roof: gabled shed in team colour with timber ribs.
  add(2, () => {
    const l0: Pt = { x: rear.x - dv.x * 3, y: rear.y - 9 - dv.y * 3 };
    const l1: Pt = { x: front.x - dv.x * 3, y: front.y - 9 - dv.y * 3 };
    const sideOff = (s: number, h: number): Pt => ({ x: perp.x * 12 * s, y: perp.y * 12 * s * 0.8 + h });
    const pts: Pt[] = [
      { x: l0.x + sideOff(1, 4).x, y: l0.y + sideOff(1, 4).y },
      { x: l1.x + sideOff(1, 4).x, y: l1.y + sideOff(1, 4).y },
      { x: l1.x, y: l1.y - 6 },
      { x: l0.x, y: l0.y - 6 },
    ];
    poly(ctx, pts, team.primary, OUTLINE, 1.3);
    const pts2: Pt[] = [
      { x: l0.x + sideOff(-1, 4).x, y: l0.y + sideOff(-1, 4).y },
      { x: l1.x + sideOff(-1, 4).x, y: l1.y + sideOff(-1, 4).y },
      { x: l1.x, y: l1.y - 6 },
      { x: l0.x, y: l0.y - 6 },
    ];
    poly(ctx, pts2, team.primaryLight, OUTLINE, 1.3);
    line(ctx, { x: l0.x, y: l0.y - 6 }, { x: l1.x, y: l1.y - 6 }, team.secondary, 2);
    for (let i = 0; i <= 3; i++) {
      const t = i / 3;
      const a: Pt = { x: l0.x + (l1.x - l0.x) * t, y: l0.y + (l1.y - l0.y) * t - 6 };
      line(ctx, a, { x: a.x + sideOff(1, 4).x, y: a.y + sideOff(1, 4).y + 6 }, team.primaryDark, 1);
    }
  });
  flush(layers);
}

function paintTrebuchet(p: P): void {
  const { ctx, ax, ay, dir, perp, state, frame, team } = p;
  const dv: Pt = { x: dir.x, y: dir.y * 0.6 };
  const c: Pt = { x: ax, y: ay - 8 };
  // Base beams along the facing and across.
  const half = 24;
  const a: Pt = { x: c.x - dv.x * half, y: c.y - dv.y * half };
  const b: Pt = { x: c.x + dv.x * half, y: c.y + dv.y * half };
  const sideBeams: [Pt, Pt][] = [];
  for (const side of [-1, 1]) {
    const o: Pt = { x: perp.x * 11 * side, y: perp.y * 11 * side * 0.8 };
    sideBeams.push([{ x: a.x + o.x, y: a.y + o.y }, { x: b.x + o.x, y: b.y + o.y }]);
  }
  const layers: Layer[] = [];
  const add = (z: number, fn: () => void): void => {
    layers.push({ z, fn });
  };
  const pivot: Pt = { x: c.x, y: c.y - 32 };
  for (const side of [-1, 1]) {
    const o: Pt = { x: perp.x * 11 * side, y: perp.y * 11 * side * 0.8 };
    const [s0, s1] = sideBeams[side === -1 ? 0 : 1]!;
    add(o.y - 1, () => {
      outlinedLine(ctx, s0, s1, C.woodDark, 3.4);
      // A-frame leg pair meeting at the pivot height.
      const top: Pt = { x: pivot.x + o.x, y: pivot.y + o.y };
      outlinedLine(ctx, s0, top, C.wood, 3);
      outlinedLine(ctx, s1, top, C.wood, 3);
      circle(ctx, top.x, top.y, 2.2, C.steelDark, OUTLINE, 0.8);
    });
  }
  const theta = state === 'work' ? (frame === 0 ? 1.0 : -0.35) : state === 'walk' || state === 'carry' ? 0.5 + (frame === 1 ? 0.04 : 0) : 0.9;
  const armDir: Pt = { x: dv.x * Math.cos(theta), y: dv.y * Math.cos(theta) - Math.sin(theta) };
  const longEnd: Pt = { x: pivot.x + armDir.x * 34, y: pivot.y + armDir.y * 34 };
  const shortEnd: Pt = { x: pivot.x - armDir.x * 12, y: pivot.y - armDir.y * 12 };
  add(0, () => {
    outlinedLine(ctx, shortEnd, longEnd, C.woodLight, 3.6);
    // Counterweight box in team colour.
    rrect(ctx, shortEnd.x - 6.5, shortEnd.y - 2, 13, 13, 2, team.primary, OUTLINE, 1.3);
    line(ctx, { x: shortEnd.x - 6.5, y: shortEnd.y + 3 }, { x: shortEnd.x + 6.5, y: shortEnd.y + 3 }, team.secondary, 1.8);
    // Sling and stone.
    const sl: Pt = { x: longEnd.x + (state === 'work' && frame === 1 ? dv.x * 8 : 0), y: longEnd.y + (state === 'work' && frame === 1 ? -3 : 11) };
    line(ctx, longEnd, sl, '#e6dcc0', 1.1);
    circle(ctx, sl.x, sl.y, 3, C.stone, OUTLINE, 1);
  });
  flush(layers);
}

// ---------------------------------------------------------------------------

export type UnitPainter = (p: P) => void;

export const UNIT_PAINTERS: Readonly<Record<UnitKey, UnitPainter>> = {
  villager: paintVillager,
  spearman: paintSpearman,
  swordsman: paintSwordsman,
  archer: paintArcher,
  siphonarios: paintSiphonarios,
  horseman: (p) => paintCavalry(p, { coat: C.horse, coatDark: C.horseDark, armor: 'none', rider: 'horseman', scale: 1 }),
  lancer: (p) => paintCavalry(p, { coat: '#8d9096', coatDark: '#5a5d63', armor: 'barding', rider: 'lancer', scale: 1.08 }),
  cataphract: (p) => paintCavalry(p, { coat: '#3b2f2a', coatDark: '#241b18', armor: 'full', rider: 'cataphract', scale: 1.2 }),
  batteringRam: paintRam,
  trebuchet: paintTrebuchet,
};

export interface UnitFrameRequest {
  ctx: Ctx;
  unit: UnitKey;
  /** One of DRAWN_FACINGS. */
  facing: Facing;
  state: UnitAnimState;
  frame: 0 | 1;
  team: TeamColors;
}

/** Draw one animation frame into a context whose origin is the top-left of the unit canvas. */
export function drawUnitFrame(req: UnitFrameRequest): void {
  const size = UNIT_SIZES[req.unit];
  const dir = FACING_DIR[req.facing]!;
  const perp: Pt = { x: -dir.y, y: dir.x };
  const { ctx } = req;
  const big = size.w > 100 ? 1.35 : 1;
  shadow(ctx, size.ax, size.ay, 11 * big, 5 * big, 0.3);
  // Team-colour ground ring: readable at 0.5x zoom for every unit.
  ctx.save();
  ctx.globalAlpha = 0.95;
  ellipse(ctx, size.ax, size.ay, 12 * big, 5.6 * big, null, req.team.primary, 2.2);
  ctx.globalAlpha = 0.9;
  ellipse(ctx, size.ax, size.ay, 12 * big + 1.4, 5.6 * big + 0.7, null, OUTLINE, 0.8);
  ctx.restore();
  const p: P = { ctx, ax: size.ax, ay: size.ay, dir, perp, state: req.state, frame: req.frame, team: req.team };
  UNIT_PAINTERS[req.unit](p);
}
