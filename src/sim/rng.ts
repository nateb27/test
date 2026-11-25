/**
 * Seeded PRNG (sfc32). Uses only 32-bit integer add, xor and shifts, so it is
 * bit-identical on every engine. State lives in `GameState.rng`; every
 * function here mutates the given state in place.
 */

import type { RngState } from './types';

/** Create a PRNG state from a seed (any integer; only the low 32 bits are used). */
export function createRng(seed: number): RngState {
  const rng: RngState = { a: 0x9e3779b9, b: 0x243f6a88, c: 0xb7e15162, d: seed >>> 0 };
  for (let i = 0; i < 15; i++) rngNextUint32(rng);
  return rng;
}

/** Next uint32 in [0, 2^32). */
export function rngNextUint32(rng: RngState): number {
  const a = rng.a | 0;
  const b = rng.b | 0;
  let c = rng.c | 0;
  let d = rng.d | 0;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  rng.a = (b ^ (b >>> 9)) >>> 0;
  rng.b = (c + (c << 3)) >>> 0;
  c = (c << 21) | (c >>> 11);
  rng.c = (c + t) >>> 0;
  rng.d = d >>> 0;
  return t >>> 0;
}

/** Next float in [0, 1). */
export function rngFloat(rng: RngState): number {
  return rngNextUint32(rng) / 4294967296;
}

/** Next integer in [0, n). `n` must be a positive integer <= 2^32. */
export function rngInt(rng: RngState, n: number): number {
  return Math.floor(rngFloat(rng) * n);
}

/** Next integer in [min, max] inclusive. */
export function rngRange(rng: RngState, min: number, max: number): number {
  return min + rngInt(rng, max - min + 1);
}

/** Shuffle an array in place (Fisher-Yates). */
export function rngShuffle<T>(rng: RngState, list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = rngInt(rng, i + 1);
    const tmp = list[i] as T;
    list[i] = list[j] as T;
    list[j] = tmp;
  }
  return list;
}
