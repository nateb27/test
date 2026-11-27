import { describe, expect, it } from 'vitest';
import { fpsFromUrl, fpsText } from '../../../src/client/app/fpsMeter';

describe('frame-rate readout (verification fix D4)', () => {
  it('formats fps and the sim cost per tick', () => {
    expect(fpsText(59.6, 0.4234, 1.87)).toBe('60 fps | sim 0.42 ms/tick (max 1.9)');
    expect(fpsText(0, 0, 0)).toBe('0 fps | sim 0.00 ms/tick (max 0.0)');
  });

  it('?fps=1 (or ?fps) turns it on; ?fps=0 and no parameter leave it off', () => {
    expect(fpsFromUrl('?fps=1')).toBe(true);
    expect(fpsFromUrl('?seed=3&fps')).toBe(true);
    expect(fpsFromUrl('?fps=0')).toBe(false);
    expect(fpsFromUrl('?seed=3')).toBe(false);
  });
});
