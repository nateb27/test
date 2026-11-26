/**
 * Units: figures built from capsules, ellipsoids and discs posed with a small joint rig (hips, knees, shoulders,
 * elbows, a held tool) per animation frame, then voxelized at the facing's rotation. Body frame: a forward, b to the
 * figure's left, z up, origin between the feet.
 */

import type { UnitKey } from '../../catalog';
import type { UnitAnimState } from '../../manifest';
import { M } from '../materials';
import { Model } from '../voxel';

// ---------------------------------------------------------------------------
// Figure: primitives in body space, voxelized at a rotation
// ---------------------------------------------------------------------------

type V3 = [number, number, number];

interface Cap {
  t: 0;
  a: V3;
  b: V3;
  ra: number;
  rb: number;
  m: number;
}
interface Ell {
  t: 1;
  c: V3;
  r: V3;
  m: number;
}
interface Disc {
  t: 2;
  c: V3;
  n: V3;
  r: number;
  th: number;
  m: number;
  rim: number;
  boss: number;
}
type Prim = Cap | Ell | Disc;

export class Figure {
  readonly prims: Prim[] = [];
  cap(a: V3, b: V3, ra: number, rb: number, m: number): void {
    this.prims.push({ t: 0, a, b, ra, rb, m });
  }
  ell(c: V3, rx: number, ry: number, rz: number, m: number): void {
    this.prims.push({ t: 1, c, r: [rx, ry, rz], m });
  }
  disc(c: V3, n: V3, r: number, th: number, m: number, rim = 0, boss = 0): void {
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    this.prims.push({ t: 2, c, n: [n[0] / l, n[1] / l, n[2] / l], r, th, m, rim, boss });
  }
  /** Uniform scale about the origin. */
  scale(k: number): void {
    for (const p of this.prims) {
      if (p.t === 0) {
        p.a = [p.a[0] * k, p.a[1] * k, p.a[2] * k];
        p.b = [p.b[0] * k, p.b[1] * k, p.b[2] * k];
        p.ra *= k;
        p.rb *= k;
      } else if (p.t === 1) {
        p.c = [p.c[0] * k, p.c[1] * k, p.c[2] * k];
        p.r = [p.r[0] * k, p.r[1] * k, p.r[2] * k];
      } else {
        p.c = [p.c[0] * k, p.c[1] * k, p.c[2] * k];
        p.r *= k;
        p.th *= k;
      }
    }
  }
  /** Write into `m`, body origin at world (cx, cy), forward rotated by th from +x. Later primitives win. */
  voxelize(m: Model, cx: number, cy: number, th: number): void {
    const c = Math.cos(th);
    const s = Math.sin(th);
    const W = (p: V3): V3 => [cx + p[0] * c - p[1] * s, cy + p[0] * s + p[1] * c, p[2]];
    for (const p of this.prims) {
      if (p.t === 0) {
        const a = W(p.a);
        const b = W(p.b);
        m.capsule(a[0], a[1], a[2], b[0], b[1], b[2], p.ra, p.rb, p.m);
      } else if (p.t === 1) {
        const q = W(p.c);
        const [rx, ry, rz] = p.r;
        const e = Math.max(rx, ry);
        m.op(q[0] - e, q[1] - e, q[2] - rz, q[0] + e, q[1] + e, q[2] + rz, (x, y, z) => {
          const dx = x - q[0];
          const dy = y - q[1];
          const u = (dx * c + dy * s) / rx;
          const v = (-dx * s + dy * c) / ry;
          const w = (z - q[2]) / rz;
          return u * u + v * v + w * w < 1 ? p.m : 0;
        }, 0);
      } else {
        const q = W(p.c);
        const n: V3 = [p.n[0] * c - p.n[1] * s, p.n[0] * s + p.n[1] * c, p.n[2]];
        m.disc(q[0], q[1], q[2], n[0], n[1], n[2], p.r, p.th, p.m, p.rim, p.boss);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Joint rig
// ---------------------------------------------------------------------------

/** Joint angles (radians). Pitch: forward swing from hanging down. Abduction: out to the side. */
export interface Pose {
  hipL: number;
  hipR: number;
  kneeL: number;
  kneeR: number;
  shL: [number, number];
  shR: [number, number];
  elL: number;
  elR: number;
  /** Forward lean of the torso. */
  lean: number;
  /** Height offset (bob). */
  bob: number;
}

export const STAND: Pose = { hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, shL: [0.1, 0.18], shR: [0.1, 0.18], elL: 0.35, elR: 0.35, lean: 0, bob: 0 };

/** Limb direction for a pitch and abduction, side = +1 left, -1 right. */
function limbDir(pitch: number, abd: number, side: number): V3 {
  return [Math.sin(pitch) * Math.cos(abd), side * Math.sin(abd), -Math.cos(pitch) * Math.cos(abd)];
}
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

export interface HumanLook {
  tunic: number;
  sleeve?: number;
  legs?: number;
  head: 'hair' | 'hood' | 'helmet' | 'crest' | 'cap' | 'straw' | 'plume';
  hoodM?: number;
  torso?: number;
  cloak?: number;
  seated?: boolean;
  z0?: number;
}

export interface Hands {
  l: V3;
  r: V3;
  chest: V3;
  back: V3;
  head: V3;
}

/** A human figure posed by `p`. Returns the hand positions (for tools). */
export function human(f: Figure, o: HumanLook, p: Pose): Hands {
  const z0 = (o.z0 ?? 0) + p.bob;
  const lean = p.lean;
  const tun = o.tunic;
  const legM = o.legs ?? M.HOSE;
  // Torso tilts forward about the hips.
  const hipZ = z0 + 0.28;
  const T = (h: number, fwd = 0): V3 => [Math.sin(lean) * h + fwd, 0, hipZ + Math.cos(lean) * h];
  const neck = T(0.19);
  const head = T(0.25);
  const shZ = T(0.165);
  // Legs.
  const legY = 0.035;
  if (o.seated === true) {
    for (const side of [1, -1]) {
      const by = side * (legY + 0.035);
      f.cap([0.02, side * legY, z0 + 0.29], [0.13, by, z0 + 0.25], 0.028, 0.025, legM);
      f.cap([0.13, by, z0 + 0.25], [0.1, by + side * 0.01, z0 + 0.08], 0.024, 0.02, legM);
      f.ell([0.12, by + side * 0.01, z0 + 0.065], 0.032, 0.02, 0.018, M.LEATHER);
    }
  } else {
    for (const side of [1, -1]) {
      const hip = side > 0 ? p.hipL : p.hipR;
      const knee = side > 0 ? p.kneeL : p.kneeR;
      const hj: V3 = [0, side * legY, z0 + 0.27];
      const kj = add(hj, limbDir(hip, 0.02, side), 0.13);
      const aj = add(kj, limbDir(hip - knee, 0.0, side), 0.12);
      f.cap(hj, kj, 0.029, 0.024, legM);
      f.cap(kj, aj, 0.024, 0.02, legM);
      f.ell([aj[0] + 0.014, aj[1], Math.max(0.017, aj[2] - 0.01)], 0.035, 0.021, 0.018, M.LEATHER);
    }
  }
  // Torso, belt, skirt.
  if (o.cloak !== undefined) f.cap(add(T(0.17), [-0.035, 0, 0]), add(T(-0.06), [-0.055, 0, 0]), 0.07, 0.085, o.cloak);
  f.cap(T(0.02), T(0.15), 0.063, 0.07, o.torso ?? tun);
  f.ell(T(0.02), 0.067, 0.067, 0.017, M.LEATHER);
  if (o.seated !== true) f.cap(T(0.02), [Math.sin(lean) * -0.08, 0, z0 + 0.18], 0.067, 0.082, tun);
  // Arms.
  const hands: V3[] = [];
  for (const side of [1, -1]) {
    const sh = side > 0 ? p.shL : p.shR;
    const el = side > 0 ? p.elL : p.elR;
    const sj = add(shZ, [0, side * 0.075, 0]);
    const ej = add(sj, limbDir(sh[0] + lean, sh[1], side), 0.11);
    const hj = add(ej, limbDir(sh[0] + lean + el, sh[1] * 0.6, side), 0.1);
    f.cap(sj, ej, 0.027, 0.023, o.torso ?? tun);
    f.cap(ej, hj, 0.021, 0.018, o.sleeve ?? tun);
    f.ell(hj, 0.019, 0.019, 0.019, M.SKIN);
    hands.push(hj);
  }
  // Neck and head.
  f.cap(neck, add(neck, [0, 0, 0.035]), 0.022, 0.02, M.SKIN);
  f.ell(add(head, [0.004, 0, 0.0]), 0.041, 0.039, 0.045, M.SKIN);
  const hz = head;
  switch (o.head) {
    case 'helmet':
      f.ell(add(hz, [-0.004, 0, 0.025]), 0.049, 0.048, 0.037, M.METAL);
      f.cap(add(hz, [0.02, 0, 0.005]), add(hz, [0.05, 0, -0.005]), 0.006, 0.006, M.METAL);
      break;
    case 'crest':
      f.ell(add(hz, [-0.004, 0, 0.025]), 0.049, 0.048, 0.037, M.METAL);
      f.cap(add(hz, [-0.045, 0, 0.05]), add(hz, [0.03, 0, 0.07]), 0.016, 0.012, M.REDCLOTH);
      f.cap(add(hz, [-0.05, 0, 0.0]), add(hz, [-0.05, 0, -0.04]), 0.03, 0.02, M.SCALE);
      break;
    case 'plume':
      f.ell(add(hz, [-0.004, 0, 0.025]), 0.05, 0.049, 0.04, M.GOLDTRIM);
      f.cap(add(hz, [0, 0, 0.06]), add(hz, [-0.03, 0, 0.12]), 0.014, 0.022, M.BLUE);
      break;
    case 'cap':
      f.ell(add(hz, [-0.006, 0, 0.03]), 0.046, 0.046, 0.034, o.hoodM ?? M.REDCLOTH);
      break;
    case 'straw':
      f.disc(add(hz, [0, 0, 0.034]), [0, 0, 1], 0.075, 0.006, M.STRAW);
      f.ell(add(hz, [0, 0, 0.043]), 0.035, 0.035, 0.025, M.STRAW);
      break;
    case 'hood':
      f.ell(add(hz, [-0.01, 0, 0.022]), 0.048, 0.047, 0.04, o.hoodM ?? M.WOOL);
      f.cap(add(hz, [-0.02, 0, -0.03]), add(hz, [-0.03, 0, -0.07]), 0.04, 0.05, o.hoodM ?? M.WOOL);
      break;
    default:
      f.ell(add(hz, [-0.01, 0, 0.022]), 0.047, 0.046, 0.037, M.HAIR);
  }
  return { l: hands[0]!, r: hands[1]!, chest: T(0.12, 0.06), back: T(0.12, -0.08), head: hz };
}

/** A straight held item from the hand along (pitch from vertical-up, yaw towards left), with a head. */
function held(f: Figure, hand: V3, up: number, fwd: number, len: number, back: number, r: number, mt: number): { tip: V3; dir: V3 } {
  const l = Math.hypot(up, fwd) || 1;
  const d: V3 = [fwd / l, 0, up / l];
  const a = add(hand, d, -back);
  const tip = add(hand, d, len - back);
  f.cap(a, tip, r, r, mt);
  return { tip, dir: d };
}

// ---------------------------------------------------------------------------
// Poses per state and frame
// ---------------------------------------------------------------------------

function walkPose(frame: number, swing = 0.38): Pose {
  const s = frame === 0 ? 1 : -1;
  return {
    hipL: swing * s,
    hipR: -swing * s,
    kneeL: s < 0 ? 0.35 : 0.1,
    kneeR: s > 0 ? 0.35 : 0.1,
    shL: [-0.35 * s, 0.14],
    shR: [0.35 * s, 0.14],
    elL: 0.35,
    elR: 0.35,
    lean: 0.06,
    bob: 0,
  };
}

function withArms(p: Pose, shL: [number, number], elL: number, shR: [number, number], elR: number, lean = p.lean): Pose {
  return { ...p, shL, elL, shR, elR, lean };
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export interface UnitBuild {
  fig: Figure;
  /** Model grid size (tiles) and resolution. */
  size: number;
  height: number;
  res: number;
}

const HUMAN_RES = 46;

function villager(state: UnitAnimState, frame: number): UnitBuild {
  const f = new Figure();
  const look: HumanLook = { tunic: M.BLUE, sleeve: M.WOOL, head: 'hood', hoodM: M.LINEN };
  if (state === 'work') {
    // Swing a pick-axe overhead (frame 0) and down (frame 1).
    const up = frame === 0;
    const p = withArms({ ...STAND, hipL: 0.22, hipR: -0.12, kneeL: 0.2, kneeR: 0.05 }, up ? [2.6, 0.12] : [1.0, 0.1], up ? 0.3 : 0.2, up ? [2.5, 0.0] : [1.0, -0.02], up ? 0.3 : 0.2, up ? -0.05 : 0.32);
    const h = human(f, look, p);
    const hand: V3 = [(h.l[0] + h.r[0]) / 2, 0, (h.l[2] + h.r[2]) / 2];
    const t = held(f, hand, up ? 0.9 : -0.25, up ? -0.45 : 1, 0.3, 0.06, 0.011, M.TOOLWOOD);
    const n: V3 = [-t.dir[2], 0, t.dir[0]];
    f.cap(add(t.tip, n, -0.07), add(t.tip, n, 0.07), 0.016, 0.006, M.IRONDARK);
  } else if (state === 'carry') {
    const p = withArms(walkPose(frame, 0.3), [-0.25 * (frame === 0 ? 1 : -1), 0.14], 0.35, [2.7, 0.35], 0.9, 0.12);
    const h = human(f, look, p);
    // Sack over the right shoulder.
    f.ell(add(h.back, [0.0, -0.05, 0.09]), 0.095, 0.085, 0.075, M.SACK);
    f.ell(add(h.back, [0.03, -0.08, 0.15]), 0.05, 0.045, 0.04, M.STRAW);
  } else if (state === 'walk') {
    const h = human(f, look, walkPose(frame));
    held(f, h.r, 0.15, 1, 0.2, 0.08, 0.009, M.TOOLWOOD);
  } else {
    const h = human(f, look, frame === 0 ? STAND : withArms(STAND, [0.15, 0.2], 0.5, [0.05, 0.18], 0.3));
    f.ell(add(h.back, [0.02, 0.06, -0.04]), 0.035, 0.03, 0.04, M.SACK);
  }
  return { fig: f, size: 1, height: 0.85, res: HUMAN_RES };
}

function footSoldier(kind: 'spearman' | 'swordsman' | 'archer' | 'siphonarios', state: UnitAnimState, frame: number): UnitBuild {
  const f = new Figure();
  const moving = state === 'walk' || state === 'carry';
  const base = moving ? walkPose(frame, 0.32) : { ...STAND, hipL: 0.12, hipR: -0.1, kneeL: 0.08, kneeR: 0.05 };
  if (kind === 'spearman') {
    const thrust = state === 'work' && frame === 1;
    const p = withArms(base, [0.75, 0.32], 0.5, state === 'work' ? (thrust ? [1.45, 0.05] : [0.9, 0.1]) : [0.3, 0.12], state === 'work' ? (thrust ? 0.05 : 0.6) : 0.9, state === 'work' ? (thrust ? 0.25 : 0.05) : base.lean);
    const h = human(f, { tunic: M.BLUE, sleeve: M.LINEN, head: 'helmet', cloak: M.WOOL, torso: M.LEATHER }, p);
    const spearUp = state === 'work' ? 0.25 : 1;
    const sp = held(f, h.r, spearUp, state === 'work' ? 1 : 0.12, 0.98, 0.4, 0.009, M.TOOLWOOD);
    f.cap(sp.tip, add(sp.tip, sp.dir, 0.08), 0.016, 0.002, M.METAL);
    f.disc(add(h.l, [0.05, 0.03, 0.02]), [0.75, 0.55, 0.1], 0.09, 0.01, M.BLUEPAINT, M.IRONDARK, M.METAL);
  } else if (kind === 'swordsman') {
    const up = state === 'work' && frame === 0;
    const p = withArms(base, [0.7, 0.3], 0.55, state === 'work' ? (up ? [2.6, 0.2] : [1.25, 0.05]) : [0.25, 0.15], state === 'work' ? (up ? 0.4 : 0.15) : 0.6, state === 'work' ? (up ? -0.02 : 0.2) : base.lean);
    const h = human(f, { tunic: M.BLUE, sleeve: M.SCALE, head: 'crest', torso: M.SCALE, legs: M.LEATHER }, p);
    const sw = held(f, h.r, state === 'work' ? (up ? 1 : 0.1) : 0.5, state === 'work' ? (up ? -0.3 : 1) : 0.8, 0.24, 0.03, 0.011, M.METAL);
    f.cap(add(h.r, sw.dir, -0.03), add(h.r, sw.dir, -0.07), 0.012, 0.012, M.LEATHER);
    // Long oval shield (skoutarion) in team paint.
    f.ell(add(h.l, [0.06, 0.04, 0.0]), 0.02, 0.085, 0.14, M.BLUEPAINT);
    f.ell(add(h.l, [0.075, 0.04, 0.0]), 0.012, 0.02, 0.02, M.GOLDTRIM);
  } else if (kind === 'archer') {
    const draw = state === 'work';
    const full = draw && frame === 1;
    const p = withArms(base, draw ? [1.5, 0.15] : [0.2, 0.18], draw ? 0.0 : 0.5, draw ? [1.45, -0.25] : [0.15, 0.15], draw ? (full ? 1.9 : 1.2) : 0.4, base.lean);
    const h = human(f, { tunic: M.BLUE, sleeve: M.LINEN, head: 'cap', hoodM: M.REDCLOTH, legs: M.HOSE }, p);
    // Bow: an arc of short capsules in the plane of the left arm.
    const c = h.l;
    const bend = full ? 0.07 : 0.05;
    let prev: V3 | null = null;
    for (let i = 0; i <= 6; i++) {
      const t = i / 6 - 0.5;
      const pt: V3 = draw ? [c[0] + bend * (1 - 4 * t * t), c[1], c[2] + t * 0.34] : [c[0] - 0.01, c[1] + 0.02, c[2] + t * 0.34];
      if (prev !== null) f.cap(prev, pt, 0.009, 0.009, M.TOOLWOOD);
      prev = pt;
    }
    if (draw) {
      f.cap([c[0], c[1], c[2] + 0.17], h.r, 0.003, 0.003, M.LINEN);
      f.cap([c[0], c[1], c[2] - 0.17], h.r, 0.003, 0.003, M.LINEN);
      f.cap(h.r, add(c, [0.06, 0, 0]), 0.004, 0.004, M.TOOLWOOD);
    }
    // Quiver on the back.
    f.cap(add(h.back, [-0.02, -0.03, -0.1]), add(h.back, [-0.04, -0.05, 0.08]), 0.025, 0.028, M.LEATHER);
    f.cap(add(h.back, [-0.04, -0.05, 0.08]), add(h.back, [-0.045, -0.055, 0.12]), 0.016, 0.016, M.LINEN);
  } else {
    // Siphonarios: bronze siphon held at the hip, tank on the back, leather apron.
    const fire = state === 'work';
    const p = withArms(base, [0.95, 0.15], 0.6, [0.6, -0.05], 0.9, fire ? 0.12 : base.lean);
    const h = human(f, { tunic: M.BLUE, sleeve: M.LEATHER, head: 'helmet', torso: M.LEATHER }, p);
    const mid: V3 = [(h.l[0] + h.r[0]) / 2 + 0.02, 0, (h.l[2] + h.r[2]) / 2];
    const tube = held(f, mid, fire ? 0.05 : 0.25, 1, 0.3, 0.12, 0.022, M.BRONZE);
    f.cap(tube.tip, add(tube.tip, tube.dir, 0.04), 0.03, 0.016, M.BRONZE);
    f.cap(add(h.back, [-0.02, 0, -0.06]), add(h.back, [-0.02, 0, 0.1]), 0.06, 0.06, M.BRONZE);
    f.cap(add(h.back, [-0.02, 0, 0.1]), add(h.back, [-0.02, 0, 0.13]), 0.04, 0.02, M.IRONDARK);
    f.cap(add(h.back, [0.02, -0.05, -0.04]), add(mid, [-0.08, 0, 0]), 0.008, 0.008, M.LEATHER);
    if (fire) {
      const fl = frame === 0 ? 0.14 : 0.22;
      f.cap(add(tube.tip, tube.dir, 0.05), add(tube.tip, [tube.dir[0], 0, tube.dir[2] + 0.15], fl), 0.03, 0.06, M.FIRE);
    }
  }
  return { fig: f, size: 1, height: 1.15, res: HUMAN_RES };
}

/** Horse in body space (k = size). `gait` 0 standing, 1/2 gallop frames. Returns the saddle height. */
function horseBody(f: Figure, coat: number, k: number, gait: number, barding: number): number {
  const C = (a: V3, b: V3, ra: number, rb: number, m: number): void => f.cap([a[0] * k, a[1] * k, a[2] * k], [b[0] * k, b[1] * k, b[2] * k], ra * k, rb * k, m);
  const S = (c: V3, rx: number, ry: number, rz: number, m: number): void => f.ell([c[0] * k, c[1] * k, c[2] * k], rx * k, ry * k, rz * k, m);
  const lift = gait === 0 ? 0 : 0.015;
  S([0, 0, 0.37 + lift], 0.25, 0.1, 0.105, coat);
  S([0.15, 0, 0.39 + lift], 0.12, 0.095, 0.105, coat);
  const neckUp = gait === 2 ? 0.55 : 0.6;
  C([0.19, 0, 0.42 + lift], [0.3, 0, neckUp + lift], 0.07, 0.045, coat);
  C([0.24, 0, 0.47 + lift], [0.3, 0, neckUp + 0.02 + lift], 0.03, 0.02, M.HORSEDK);
  C([0.3, 0, neckUp - 0.01 + lift], [0.42, 0, neckUp - 0.1 + lift], 0.042, 0.03, coat);
  C([0.29, 0.02, neckUp + 0.01 + lift], [0.28, 0.025, neckUp + 0.06 + lift], 0.012, 0.005, coat);
  C([0.29, -0.02, neckUp + 0.01 + lift], [0.28, -0.025, neckUp + 0.06 + lift], 0.012, 0.005, coat);
  C([-0.24, 0, 0.41 + lift], [-0.32, 0, gait === 0 ? 0.2 : 0.28], 0.03, 0.02, M.HORSEDK);
  C([0.33, 0.04, neckUp - 0.05 + lift], [0.12, 0.08, 0.6], 0.004, 0.004, M.LEATHER);
  const legs: [number, number, number][] = [
    [0.16, 0.055, 1],
    [0.15, -0.055, -1],
    [-0.17, 0.055, -1],
    [-0.17, -0.055, 1],
  ];
  for (const [x, y, ph] of legs) {
    const swing = gait === 0 ? 0 : (gait === 1 ? ph : -ph) * 0.4;
    const kx = x + Math.sin(swing) * 0.15;
    const kz = 0.3 + lift - Math.cos(swing) * 0.15;
    const bend = gait === 0 ? 0 : Math.max(0, -swing) * 1.2 + 0.1;
    const fx = kx + Math.sin(swing - bend * (x > 0 ? 1 : -1)) * 0.13;
    const fz = Math.max(0.02, kz - Math.cos(swing - bend) * 0.13);
    C([x, y, 0.3 + lift], [kx, y, kz], 0.032, 0.024, coat);
    C([kx, y, kz], [fx, y, fz], 0.022, 0.018, M.HORSEDK);
    S([fx, y, fz - 0.005], 0.025, 0.022, 0.016, M.HORSEDK);
  }
  if (barding) {
    S([0.02, 0, 0.38 + lift], 0.27, 0.115, 0.1, barding);
    C([0.19, 0, 0.43 + lift], [0.28, 0, neckUp - 0.02 + lift], 0.075, 0.05, barding);
    C([0.3, 0, neckUp + lift], [0.4, 0, neckUp - 0.09 + lift], 0.046, 0.034, barding);
  }
  return (0.465 + lift) * k;
}

function cavalry(kind: 'horseman' | 'lancer' | 'cataphract', state: UnitAnimState, frame: number): UnitBuild {
  const f = new Figure();
  const gait = state === 'walk' || state === 'carry' ? 1 + frame : 0;
  const k = kind === 'cataphract' ? 1.3 : kind === 'lancer' ? 1.26 : 1.22;
  const coat = kind === 'horseman' ? M.HORSE : kind === 'lancer' ? M.HORSEGREY : M.HORSEBLK;
  const seat = horseBody(f, coat, k, gait, kind === 'cataphract' ? M.SCALE : 0);
  // Saddle cloth in team colour.
  f.cap([-0.1 * k, 0, 0.42 * k], [0.08 * k, 0, 0.42 * k], 0.105 * k, 0.105 * k, M.BLUE);
  if (kind === 'lancer' || kind === 'cataphract') f.ell([-0.14 * k, 0, 0.36 * k], 0.09 * k, 0.11 * k, 0.07 * k, M.BLUE);
  const attack = state === 'work';
  const z0 = seat - 0.262;
  const p: Pose = withArms(STAND, attack ? (frame === 0 ? [0.6, 0.3] : [1.3, 0.1]) : [0.7, 0.25], 0.5, attack ? (frame === 0 ? [1.2, 0.15] : [1.55, 0.05]) : [0.6, 0.18], attack ? 0.2 : 0.6, attack && frame === 1 ? 0.2 : 0);
  const look: HumanLook =
    kind === 'horseman'
      ? { tunic: M.BLUE, sleeve: M.LINEN, head: 'helmet', cloak: M.REDCLOTH, seated: true, z0 }
      : kind === 'lancer'
        ? { tunic: M.BLUE, sleeve: M.SCALE, head: 'plume', torso: M.SCALE, cloak: M.BLUE, seated: true, z0 }
        : { tunic: M.BLUE, sleeve: M.SCALE, head: 'crest', torso: M.SCALE, legs: M.SCALE, seated: true, z0 };
  const h = human(f, look, p);
  const lanceLen = kind === 'horseman' ? 0.8 : 1.05;
  const couch = attack && frame === 1;
  const ln = held(f, h.r, couch ? 0.05 : 0.35, 1, lanceLen, 0.35, 0.009, M.TOOLWOOD);
  f.cap(ln.tip, add(ln.tip, ln.dir, 0.07), 0.015, 0.002, M.METAL);
  if (kind !== 'horseman') {
    // Pennant in team colour behind the lance head.
    const b = add(ln.tip, ln.dir, -0.05);
    f.cap(b, add(b, [-ln.dir[0], 0.0, -0.06]), 0.02, 0.006, M.BLUE);
  }
  f.disc(add(h.l, [0.03, 0.04, 0.0]), [0.4, 0.9, 0.1], kind === 'cataphract' ? 0.075 : 0.085, 0.01, M.BLUEPAINT, M.IRONDARK, M.METAL);
  return { fig: f, size: 1.6, height: 1.25, res: 40 };
}

function batteringRam(state: UnitAnimState, frame: number): UnitBuild {
  const f = new Figure();
  const L = 0.62;
  const Wd = 0.26;
  const H = 0.42;
  const hit = state === 'work' ? (frame === 1 ? 0.14 : -0.06) : 0;
  const roll = state === 'walk' || state === 'carry' ? frame * 0.4 : 0;
  // Wheels.
  for (const x of [-0.38, 0.38]) {
    for (const y of [-Wd - 0.03, Wd + 0.03]) {
      f.disc([x, y, 0.11], [0, 1, 0], 0.11, 0.025, M.PLANK, M.IRONDARK, M.IRONDARK);
      f.cap([x + Math.cos(roll) * 0.09, y + Math.sign(y) * 0.027, 0.11 + Math.sin(roll) * 0.09], [x - Math.cos(roll) * 0.09, y + Math.sign(y) * 0.027, 0.11 - Math.sin(roll) * 0.09], 0.01, 0.01, M.OLDWOOD);
    }
  }
  // Chassis and posts.
  for (const y of [-Wd, Wd]) {
    f.cap([-L, y, 0.13], [L, y, 0.13], 0.03, 0.03, M.TIMBH);
    for (const x of [-L + 0.05, 0, L - 0.05]) f.cap([x, y, 0.13], [x, y * 0.35, H], 0.022, 0.02, M.TIMBV);
  }
  // Hide-covered gabled roof: rows of capsules down both slopes.
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    for (const side of [1, -1]) {
      const y = side * (0.05 + t * (Wd + 0.04));
      const z = H + 0.12 - t * 0.2;
      f.cap([-L - 0.02, y, z], [L + 0.02, y, z], 0.03, 0.03, i % 3 === 1 ? M.BLUE : M.LEATHER);
    }
  }
  f.cap([-L - 0.02, 0, H + 0.13], [L + 0.02, 0, H + 0.13], 0.03, 0.03, M.TIMBH);
  // Ram log on chains, iron head.
  const rx0 = -0.5 + hit;
  const rx1 = 0.78 + hit;
  f.cap([rx0, 0, 0.3], [rx1, 0, 0.3], 0.045, 0.045, M.BARK);
  f.cap([rx1, 0, 0.3], [rx1 + 0.1, 0, 0.3], 0.06, 0.045, M.IRONDARK);
  f.ell([rx1 + 0.1, 0, 0.3], 0.03, 0.055, 0.055, M.METAL);
  for (const x of [-0.2, 0.25]) f.cap([x + hit * 0.5, 0, 0.3], [x, 0, H + 0.1], 0.006, 0.006, M.IRONDARK);
  return { fig: f, size: 2.2, height: 0.9, res: 32 };
}

function trebuchet(state: UnitAnimState, frame: number): UnitBuild {
  const f = new Figure();
  // Arm angle: cocked (long end down at the back) or thrown (long end up front).
  const theta = state === 'work' ? (frame === 0 ? -0.9 : 1.15) : state === 'walk' || state === 'carry' ? 1.05 + frame * 0.05 : 1.1;
  const roll = state === 'walk' || state === 'carry' ? frame * 0.5 : 0;
  const B = 0.55;
  const Wd = 0.24;
  for (const y of [-Wd, Wd]) {
    f.cap([-B, y, 0.12], [B, y, 0.12], 0.035, 0.035, M.TIMBH);
    f.cap([-B * 0.8, y, 0.12], [0, y * 0.8, 0.9], 0.03, 0.026, M.TIMBV);
    f.cap([B * 0.8, y, 0.12], [0, y * 0.8, 0.9], 0.03, 0.026, M.TIMBV);
    f.cap([-B * 0.5, y, 0.45], [B * 0.5, y, 0.45], 0.02, 0.02, M.TIMBH);
    for (const x of [-B + 0.08, B - 0.08]) {
      f.disc([x, y + Math.sign(y) * 0.05, 0.11], [0, 1, 0], 0.11, 0.022, M.PLANK, M.IRONDARK, M.IRONDARK);
      f.cap([x + Math.cos(roll) * 0.09, y + Math.sign(y) * 0.075, 0.11 + Math.sin(roll) * 0.09], [x - Math.cos(roll) * 0.09, y + Math.sign(y) * 0.075, 0.11 - Math.sin(roll) * 0.09], 0.009, 0.009, M.OLDWOOD);
    }
  }
  f.cap([-B, -Wd, 0.12], [-B, Wd, 0.12], 0.035, 0.035, M.TIMBH);
  f.cap([B, -Wd, 0.12], [B, Wd, 0.12], 0.035, 0.035, M.TIMBH);
  const pivot: V3 = [0, 0, 0.9];
  f.cap([0, -Wd * 0.85, 0.9], [0, Wd * 0.85, 0.9], 0.025, 0.025, M.IRONDARK);
  const dir: V3 = [Math.cos(theta), 0, Math.sin(theta)];
  const longEnd = add(pivot, dir, 0.85);
  const shortEnd = add(pivot, dir, -0.28);
  f.cap(shortEnd, longEnd, 0.04, 0.022, M.TIMBH);
  // Counterweight box hanging under the short end, team cloth on it.
  const cw: V3 = [shortEnd[0], 0, Math.max(0.3, shortEnd[2] - 0.22)];
  f.cap(shortEnd, cw, 0.008, 0.008, M.IRONDARK);
  f.ell(cw, 0.12, 0.13, 0.11, M.PLANK);
  f.ell(add(cw, [0.0, 0, 0.0]), 0.124, 0.06, 0.07, M.BLUE);
  // Sling.
  const sl: V3 = state === 'work' && frame === 1 ? add(longEnd, [0.15, 0, 0.1]) : [longEnd[0] + 0.05, 0, Math.max(0.15, longEnd[2] - 0.25)];
  f.cap(longEnd, sl, 0.005, 0.005, M.ROPE);
  f.ell(sl, 0.035, 0.035, 0.035, M.ROCK);
  return { fig: f, size: 2.6, height: 2.0, res: 30 };
}

export function buildUnit(key: UnitKey, state: UnitAnimState, frame: number): UnitBuild {
  switch (key) {
    case 'villager':
      return villager(state, frame);
    case 'spearman':
    case 'swordsman':
    case 'archer':
    case 'siphonarios':
      return footSoldier(key, state, frame);
    case 'horseman':
    case 'lancer':
    case 'cataphract':
      return cavalry(key, state, frame);
    case 'batteringRam':
      return batteringRam(state, frame);
    case 'trebuchet':
      return trebuchet(state, frame);
  }
}

/** The voxel model of a unit frame at a facing (0..7, see CLAUDE.md), feet at world (0, 0). */
export function unitModel(key: UnitKey, state: UnitAnimState, frame: number, facing: number, resScale = 1): Model {
  const b = buildUnit(key, state, frame);
  const res = Math.round(b.res * resScale);
  const m = new Model(-b.size / 2, -b.size / 2, b.size, b.size, b.height, res);
  m.faceW = 0.15;
  // Model ops take grid-local coordinates: the grid centre is world (0, 0).
  b.fig.voxelize(m, b.size / 2, b.size / 2, (facing * Math.PI) / 4);
  return m;
}
