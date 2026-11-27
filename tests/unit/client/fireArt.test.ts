/**
 * WP34 art: the pixel-art building fire and smoke (`art/fire.ts`) and the projectile scale that keeps arrows legible
 * at every zoom (`render/effects/layer.ts` `projectileScale`).
 */

import { describe, expect, it } from 'vitest';
import { FIRE_LARGE, FIRE_SMALL, firePixels, periodicFbm, smokePixels, type PaletteLookup, type PixelFrame } from '../../../src/client/art/fire';
import { sharedQuantizer } from '../../../src/client/art/rendered/quantize';
import { projectileScale } from '../../../src/client/render/effects/layer';

const pal: PaletteLookup = sharedQuantizer()!;
const N = 8;

function colours(px: PixelFrame): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < px.data.length; i += 4) if (px.data[i + 3]! > 0) out.add(`${px.data[i]},${px.data[i + 1]},${px.data[i + 2]}`);
  return out;
}

const palette = new Set<string>();
for (let i = 0; i < pal.pal.length; i += 3) palette.add(`${pal.pal[i]},${pal.pal[i + 1]},${pal.pal[i + 2]}`);

describe('pixel fire and smoke', () => {
  it('uses only colours of the shared art palette', () => {
    for (const px of [firePixels(FIRE_SMALL, 0, N, pal), firePixels(FIRE_LARGE, 3, N, pal), smokePixels(5, N, pal)]) {
      for (const c of colours(px)) expect(palette.has(c), c).toBe(true);
    }
  });

  it('has hot ember-coloured cores, dark soot and no flat cartoon colour', () => {
    const px = firePixels(FIRE_LARGE, 2, N, pal);
    let hot = 0;
    let soot = 0;
    let pure = 0;
    for (let i = 0; i < px.data.length; i += 4) {
      if (px.data[i + 3] === 0) continue;
      const [r, g, b] = [px.data[i]!, px.data[i + 1]!, px.data[i + 2]!];
      if (r > 220 && g > 170) hot++;
      if (r < 60 && g < 60 && b < 60) soot++;
      // The old flames were saturated #d8461c / #ff..: a red channel near full with a starved blue.
      if (r > 230 && b < 40 && g < 120) pure++;
    }
    expect(hot).toBeGreaterThan(5);
    expect(soot).toBeGreaterThan(40);
    expect(pure).toBe(0);
  });

  it('animates: every frame differs from the next, and the loop closes (the field is periodic over the cycle)', () => {
    const frames = Array.from({ length: N }, (_, f) => firePixels(FIRE_SMALL, f, N, pal));
    for (let f = 0; f < N; f++) expect(Buffer.from(frames[f]!.data).equals(Buffer.from(frames[(f + 1) % N]!.data))).toBe(false);
    // Frame N would be frame 0 again.
    expect(Buffer.from(firePixels(FIRE_SMALL, N, N, pal).data).equals(Buffer.from(frames[0]!.data))).toBe(true);
    expect(periodicFbm(1.3, 0.2, 4, 9)).toBeCloseTo(periodicFbm(1.3, 4.2, 4, 9), 10);
  });

  it('is deterministic, and the soot under the flames does not move between frames', () => {
    expect(Buffer.from(firePixels(FIRE_LARGE, 4, N, pal).data).equals(Buffer.from(firePixels(FIRE_LARGE, 4, N, pal).data))).toBe(true);
    const a = firePixels(FIRE_LARGE, 0, N, pal);
    const b = firePixels(FIRE_LARGE, 5, N, pal);
    // The topmost rows hold soot only (flames never reach them): identical in every frame.
    const rows = 2;
    expect(Buffer.from(a.data.subarray(0, a.w * rows * 4)).equals(Buffer.from(b.data.subarray(0, b.w * rows * 4)))).toBe(true);
  });

  it('smoke is dark near the fire and paler higher up', () => {
    const px = smokePixels(0, N, pal);
    const lum = (y0: number, y1: number): number => {
      let s = 0;
      let n = 0;
      for (let y = y0; y < y1; y++)
        for (let x = 0; x < px.w; x++) {
          const i = (y * px.w + x) * 4;
          if (px.data[i + 3] === 0) continue;
          s += px.data[i]! + px.data[i + 1]! + px.data[i + 2]!;
          n++;
        }
      return n === 0 ? NaN : s / n / 3;
    };
    expect(lum(px.h - 24, px.h - 4)).toBeLessThan(lum(10, 34));
    expect(lum(px.h - 24, px.h - 4)).toBeLessThan(70);
  });
});

describe('projectile scale by zoom', () => {
  it('an arrow (12 px of art) is 12 to 18 px on screen at every zoom, 1:1 at 1x', () => {
    for (const z of [0.5, 0.6, 0.75, 1, 1.25, 1.5, 2]) {
      const onScreen = 12 * projectileScale(z) * z;
      expect(onScreen, `zoom ${z}`).toBeGreaterThanOrEqual(12 - 1e-9);
      expect(onScreen, `zoom ${z}`).toBeLessThanOrEqual(18 + 1e-9);
    }
    expect(projectileScale(1)).toBe(1);
    expect(projectileScale(0.5)).toBe(2); // was 6 px on screen
    expect(12 * projectileScale(2) * 2).toBe(18); // was 24 px
  });
});
