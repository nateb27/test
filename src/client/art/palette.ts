/** Colour helpers and the team palette used by every procedural drawing. */

export const DEFAULT_PRIMARY = 0x6a2c91;
export const DEFAULT_SECONDARY = 0xd4af37;
export const OUTLINE = '#1d1426';

/** 0xRRGGBB -> '#rrggbb'. */
export function hex(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** Lighten (f > 0, towards white) or darken (f < 0, towards black) a colour. */
export function shade(n: number, f: number): string {
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const t = f < 0 ? 0 : 255;
  const p = Math.abs(f);
  const mix = (c: number): number => Math.round((t - c) * p + c);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

export interface TeamColors {
  primaryNum: number;
  secondaryNum: number;
  primary: string;
  primaryLight: string;
  primaryDark: string;
  secondary: string;
  secondaryLight: string;
  secondaryDark: string;
}

export function teamColors(primary: number, secondary: number): TeamColors {
  return {
    primaryNum: primary,
    secondaryNum: secondary,
    primary: hex(primary),
    primaryLight: shade(primary, 0.35),
    primaryDark: shade(primary, -0.4),
    secondary: hex(secondary),
    secondaryLight: shade(secondary, 0.4),
    secondaryDark: shade(secondary, -0.35),
  };
}

export const DEFAULT_TEAM = teamColors(DEFAULT_PRIMARY, DEFAULT_SECONDARY);

/** Fixed (non-team) colours. */
export const C = {
  skin: '#e2b48a',
  skinDark: '#b98560',
  wood: '#8a5a2e',
  woodDark: '#5d3b1c',
  woodLight: '#b98a52',
  steel: '#c9ced6',
  steelDark: '#7d8590',
  leather: '#6b4a2b',
  stone: '#9a9a96',
  stoneDark: '#6d6d6a',
  stoneLight: '#c4c2ba',
  wall: '#e6d8b8',
  wallDark: '#b8a67f',
  wallDarker: '#8f7e5c',
  roofRed: '#b8452f',
  roofRedLight: '#d9674a',
  roofRedDark: '#7e2a1c',
  leaf: '#3e7d34',
  leafDark: '#2a5a26',
  leafLight: '#62a048',
  gold: '#e2b93b',
  goldDark: '#a67c12',
  fire: '#ff9a2e',
  fireLight: '#ffe27a',
  horse: '#7a4b2a',
  horseDark: '#52311a',
  horseGrey: '#9b9ea6',
  berry: '#c42b3e',
  food: '#e6c25a',
};
