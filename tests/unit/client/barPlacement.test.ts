import type { Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { emptyRowsAbove } from '../../../src/client/render/entities';
import { barCentreY } from '../../../src/client/render/overlays/logic';

/** A texture backed by a fake 2D canvas whose pixels are transparent above `firstOpaqueRow`. */
function fakeTexture(w: number, h: number, firstOpaqueRow: number, resolution = 1): Texture {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let row = firstOpaqueRow; row < h; row++) data[(row * w + 3) * 4 + 3] = 255;
  const ctx = { getImageData: () => ({ data }) };
  return {
    source: { resource: { getContext: () => ctx }, resolution },
    frame: { x: 0, y: 0, width: w / resolution, height: h / resolution },
  } as unknown as Texture;
}

describe('progress bar placement', () => {
  it('finds the first visible row of a sprite, in world pixels', () => {
    expect(emptyRowsAbove(fakeTexture(10, 40, 17))).toBe(17);
    expect(emptyRowsAbove(fakeTexture(10, 40, 16, 2))).toBe(8);
    expect(emptyRowsAbove(fakeTexture(10, 40, 40))).toBeNull(); // fully transparent
  });

  it('is unmeasurable (null) for a texture that is not a readable canvas', () => {
    const tex = { source: { resource: {} }, frame: { x: 0, y: 0, width: 4, height: 4 } } as unknown as Texture;
    expect(emptyRowsAbove(tex)).toBeNull();
  });

  it('sits a fixed number of screen pixels above the art top at 0.5x, 1x and 2x', () => {
    const top = -120; // world px of the art top relative to the origin
    for (const zoom of [0.5, 1, 2]) {
      const inv = 1 / zoom;
      const y = barCentreY(0, top, 3, true, 6 * inv);
      // World -> screen is a scale by `zoom`: the bar centre is 6 screen px above the art top at every zoom,
      // and the art top itself moves with the building.
      expect((top - y) * zoom).toBeCloseTo(6, 9);
      expect(y * zoom).toBeCloseTo(top * zoom - 6, 9);
    }
  });

  it('falls back to a footprint estimate that is still in world pixels', () => {
    expect(barCentreY(100, null, 3, true, 6)).toBe(100 - (28 * 3 + 24));
    expect(barCentreY(100, null, 2, false, 6)).toBe(100 - (14 * 2 + 12));
  });
});
