/**
 * Hash and value-noise helpers for the offline voxel renderer. Pure and deterministic (same inputs, same art on
 * every machine and in every worker), but they are client code: Math is used freely.
 */

export function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x1b873593);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hash2(x: number, y: number): number {
  return hash3(x, y, 1013);
}

/** Smooth 2D value noise in [0, 1]. */
export function vn2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let fx = x - xi;
  let fy = y - yi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Smooth 3D value noise in [0, 1]. */
export function vn3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  let fx = x - xi;
  let fy = y - yi;
  let fz = z - zi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const a0 = hash3(xi, yi, zi);
  const b0 = hash3(xi + 1, yi, zi);
  const c0 = hash3(xi, yi + 1, zi);
  const d0 = hash3(xi + 1, yi + 1, zi);
  const a1 = hash3(xi, yi, zi + 1);
  const b1 = hash3(xi + 1, yi, zi + 1);
  const c1 = hash3(xi, yi + 1, zi + 1);
  const d1 = hash3(xi + 1, yi + 1, zi + 1);
  const l0 = a0 + (b0 - a0) * fx + (c0 - a0) * fy + (a0 - b0 - c0 + d0) * fx * fy;
  const l1 = a1 + (b1 - a1) * fx + (c1 - a1) * fy + (a1 - b1 - c1 + d1) * fx * fy;
  return l0 + (l1 - l0) * fz;
}

export function fbm2(x: number, y: number, octaves: number): number {
  let s = 0;
  let a = 0.5;
  let t = 0;
  for (let i = 0; i < octaves; i++) {
    s += a * vn2(x, y);
    t += a;
    const nx = 1.6 * x + 1.2 * y + 7.3;
    const ny = -1.2 * x + 1.6 * y + 3.1;
    x = nx;
    y = ny;
    a *= 0.5;
  }
  return s / t;
}

export function fbm3(x: number, y: number, z: number, octaves: number): number {
  let s = 0;
  let a = 0.5;
  let t = 0;
  for (let i = 0; i < octaves; i++) {
    s += a * vn3(x, y, z);
    t += a;
    const nx = 1.6 * x + 1.2 * y + 7.3;
    const ny = -1.2 * x + 1.6 * y + 3.1;
    x = nx;
    y = ny;
    z = z * 2 + 5.7;
    a *= 0.5;
  }
  return s / t;
}

/**
 * 2D value noise that repeats every `period` lattice cells in x and y (`period` a positive integer). Used for the
 * terrain textures, which must tile.
 */
export function vn2p(x: number, y: number, period: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let fx = x - xi;
  let fy = y - yi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const w = (v: number): number => ((v % period) + period) % period;
  const x0 = w(xi);
  const x1 = w(xi + 1);
  const y0 = w(yi);
  const y1 = w(yi + 1);
  const a = hash3(x0, y0, seed);
  const b = hash3(x1, y0, seed);
  const c = hash3(x0, y1, seed);
  const d = hash3(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Periodic fBm: each octave doubles the lattice period, so the sum still repeats every `period` cells of octave 0. */
export function fbm2p(x: number, y: number, period: number, octaves: number, seed = 0): number {
  let s = 0;
  let a = 0.5;
  let t = 0;
  let p = period;
  for (let i = 0; i < octaves; i++) {
    s += a * vn2p(x, y, p, seed + i * 31);
    t += a;
    x = x * 2 + 17;
    y = y * 2 + 31;
    // The offsets are whole lattice cells, so periodicity holds.
    p *= 2;
    a *= 0.5;
  }
  return s / t;
}

/** Hash of an integer cell that repeats every `period` cells. */
export function hash2p(x: number, y: number, period: number, seed = 0): number {
  const w = (v: number): number => ((v % period) + period) % period;
  return hash3(w(x), w(y), 7919 + seed);
}

export function smooth(a: number, b: number, x: number): number {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

export function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}

export function fract(x: number): number {
  return x - Math.floor(x);
}

/** Small xorshift PRNG for model building. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
