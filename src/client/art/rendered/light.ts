/**
 * The approved light: midday sun (treatment 2, "P_MID") with the heavy weathering of treatment 3 (grit 1.0). The
 * low sun, long shadows and desaturation of treatment 3 are deliberately not used.
 */

export interface LightParams {
  /** Sun azimuth and elevation in degrees (azimuth 0 = +x, 90 = +y). */
  sunAz: number;
  sunEl: number;
  sunCol: readonly [number, number, number];
  skyCol: readonly [number, number, number];
  bounceCol: readonly [number, number, number];
  exposure: number;
  sat: number;
  contrast: number;
  /** Weathering strength: dirt, stains, moss, cracks (0..1). */
  grit: number;
  /** Terrain dryness multiplier. */
  dry: number;
  /** Shadow ray jitter (soft penumbra). */
  soft: number;
  /** Unit vector towards the sun (derived). */
  Lx: number;
  Ly: number;
  Lz: number;
}

function withSun(p: Omit<LightParams, 'Lx' | 'Ly' | 'Lz'>): LightParams {
  const az = (p.sunAz * Math.PI) / 180;
  const el = (p.sunEl * Math.PI) / 180;
  return { ...p, Lx: Math.cos(el) * Math.cos(az), Ly: Math.cos(el) * Math.sin(az), Lz: Math.sin(el) };
}

export const LIGHT: LightParams = withSun({
  sunAz: 150,
  sunEl: 50,
  sunCol: [2.9, 2.65, 2.25],
  skyCol: [0.55, 0.64, 0.82],
  bounceCol: [0.34, 0.29, 0.21],
  exposure: 1.12,
  sat: 0.95,
  contrast: 1.1,
  grit: 1.0,
  dry: 1.15,
  soft: 0.04,
});

/** Linear radiance -> display 0..255 (exposure, soft shoulder, saturation, contrast). Writes into `rgbOut`. */
export function toDisplay(r: number, g: number, b: number, rgbOut: Float32Array | number[], o = 0): void {
  const ex = LIGHT.exposure;
  r = Math.sqrt(1 - Math.exp(-r * ex));
  g = Math.sqrt(1 - Math.exp(-g * ex));
  b = Math.sqrt(1 - Math.exp(-b * ex));
  const l = 0.3 * r + 0.59 * g + 0.11 * b;
  const s = LIGHT.sat;
  r = l + (r - l) * s;
  g = l + (g - l) * s;
  b = l + (b - l) * s;
  const c = LIGHT.contrast;
  r = 0.5 + (r - 0.5) * c;
  g = 0.5 + (g - 0.5) * c;
  b = 0.5 + (b - 0.5) * c;
  rgbOut[o] = r < 0 ? 0 : r > 1 ? 255 : r * 255;
  rgbOut[o + 1] = g < 0 ? 0 : g > 1 ? 255 : g * 255;
  rgbOut[o + 2] = b < 0 ? 0 : b > 1 ? 255 : b * 255;
}
