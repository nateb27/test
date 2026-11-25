/**
 * Pure (DOM-free) catalogue of every id the procedural art knows how to draw,
 * taken from plan section 5. Used by the generator, the renderer fall-backs
 * and the "every id resolves" test.
 *
 * Id conventions (data/schema.ts): sprites `unit.villager`, `building.house`,
 * `node.tree`; icons `icon.unit.villager`, `icon.tech.handCarts`,
 * `icon.resource.wood`, `icon.age.2`, `icon.civ.byzantines`.
 */

export const UNIT_IDS = [
  'villager',
  'spearman',
  'swordsman',
  'archer',
  'horseman',
  'lancer',
  'batteringRam',
  'trebuchet',
  'cataphract',
  'siphonarios',
] as const;

export const BUILDING_IDS = [
  'townCenter',
  'house',
  'mill',
  'lumberCamp',
  'miningCamp',
  'farm',
  'barracks',
  'archeryRange',
  'stable',
  'siegeWorkshop',
  'silkWorkshop',
] as const;

export const NODE_IDS = ['tree', 'berryBush', 'goldDeposit', 'stoneDeposit'] as const;

export const TECH_IDS = [
  'handCarts',
  'ironAxes',
  'frameSaws',
  'irrigation',
  'threeFieldSystem',
  'ironPicks',
  'timberedShafts',
  'guildCharters',
] as const;

export const RESOURCE_IDS = ['food', 'wood', 'gold', 'stone'] as const;
export const AGE_NUMBERS = [1, 2, 3, 4] as const;
export const CIV_IDS = ['byzantines'] as const;

export type UnitKey = (typeof UNIT_IDS)[number];
export type BuildingKey = (typeof BUILDING_IDS)[number];
export type NodeKey = (typeof NODE_IDS)[number];
export type TechKey = (typeof TECH_IDS)[number];
export type ResourceKey = (typeof RESOURCE_IDS)[number];

export type SpriteKind = 'unit' | 'building' | 'node';

/** Footprints (tiles) from plan 5.2/5.3, used when the data registry has no def. */
export const DEFAULT_FOOTPRINT: Readonly<Record<string, number>> = {
  townCenter: 4,
  house: 2,
  mill: 2,
  lumberCamp: 2,
  miningCamp: 2,
  farm: 2,
  barracks: 3,
  archeryRange: 3,
  stable: 3,
  siegeWorkshop: 3,
  silkWorkshop: 3,
  tree: 1,
  berryBush: 1,
  goldDeposit: 2,
  stoneDeposit: 2,
};

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const ALIASES: Readonly<Record<string, string>> = {
  ram: 'batteringRam',
  battering: 'batteringRam',
  berries: 'berryBush',
  berry: 'berryBush',
  bush: 'berryBush',
  gold: 'goldDeposit',
  goldmine: 'goldDeposit',
  stone: 'stoneDeposit',
  stonemine: 'stoneDeposit',
  rock: 'stoneDeposit',
  towncentre: 'townCenter',
  siegeworks: 'siegeWorkshop',
};

function lookup(list: readonly string[], key: string): string | null {
  const n = norm(key);
  for (const k of list) if (norm(k) === n) return k;
  const alias = ALIASES[n];
  if (alias !== undefined && list.includes(alias)) return alias;
  return null;
}

export interface ParsedSprite {
  kind: SpriteKind;
  /** Canonical key (one of the *_IDS), or null when unknown. */
  key: string | null;
  /** The raw id after the kind prefix. */
  raw: string;
}

export function parseSpriteId(id: string): ParsedSprite | null {
  const dot = id.indexOf('.');
  if (dot < 0) return null;
  const kind = id.slice(0, dot);
  const raw = id.slice(dot + 1);
  if (kind === 'unit') return { kind, key: lookup(UNIT_IDS, raw), raw };
  if (kind === 'building') return { kind, key: lookup(BUILDING_IDS, raw), raw };
  if (kind === 'node') return { kind, key: lookup(NODE_IDS, raw), raw };
  return null;
}

/** `'known'`: the generator draws it. `'fallback'`: the visible "?" placeholder is used. */
export function classifySprite(id: string): 'known' | 'fallback' {
  const p = parseSpriteId(id);
  return p !== null && p.key !== null ? 'known' : 'fallback';
}

export type IconSpec =
  | { type: 'unit' | 'building' | 'node' | 'tech'; key: string; generic: boolean }
  | { type: 'resource'; key: ResourceKey; generic: false }
  | { type: 'age'; key: '1' | '2' | '3' | '4'; generic: false }
  | { type: 'civ'; key: string; generic: boolean };

/** Resolve an icon id to what should be drawn; `null` means the fallback icon. */
export function parseIconId(id: string): IconSpec | null {
  const parts = id.split('.');
  if (parts[0] !== 'icon' || parts.length !== 3) return null;
  const group = parts[1]!;
  const raw = parts[2]!;
  switch (group) {
    case 'unit': {
      const key = lookup(UNIT_IDS, raw);
      return key === null ? null : { type: 'unit', key, generic: false };
    }
    case 'building': {
      const key = lookup(BUILDING_IDS, raw);
      return key === null ? null : { type: 'building', key, generic: false };
    }
    case 'node': {
      const key = lookup(NODE_IDS, raw);
      return key === null ? null : { type: 'node', key, generic: false };
    }
    case 'tech': {
      const key = lookup(TECH_IDS, raw);
      // Any other tech id (e.g. an age advance) gets a generic scroll glyph.
      return key === null ? { type: 'tech', key: raw, generic: true } : { type: 'tech', key, generic: false };
    }
    case 'resource': {
      const key = lookup(RESOURCE_IDS, raw);
      return key === null ? null : { type: 'resource', key: key as ResourceKey, generic: false };
    }
    case 'age':
      return raw === '1' || raw === '2' || raw === '3' || raw === '4' ? { type: 'age', key: raw, generic: false } : null;
    case 'civ': {
      const key = lookup(CIV_IDS, raw);
      return key === null ? { type: 'civ', key: raw, generic: true } : { type: 'civ', key, generic: false };
    }
    default:
      return null;
  }
}

export function classifyIcon(id: string): 'known' | 'generic' | 'fallback' {
  const spec = parseIconId(id);
  if (spec === null) return 'fallback';
  return spec.generic ? 'generic' : 'known';
}

/** Every sprite id the generator draws, in display order. */
export function allSpriteIds(): string[] {
  return [
    ...UNIT_IDS.map((k) => `unit.${k}`),
    ...BUILDING_IDS.map((k) => `building.${k}`),
    ...NODE_IDS.map((k) => `node.${k}`),
  ];
}

/** Every icon id the generator draws, in display order. */
export function allIconIds(): string[] {
  return [
    ...UNIT_IDS.map((k) => `icon.unit.${k}`),
    ...BUILDING_IDS.map((k) => `icon.building.${k}`),
    ...NODE_IDS.map((k) => `icon.node.${k}`),
    ...TECH_IDS.map((k) => `icon.tech.${k}`),
    ...RESOURCE_IDS.map((k) => `icon.resource.${k}`),
    ...AGE_NUMBERS.map((k) => `icon.age.${k}`),
    ...CIV_IDS.map((k) => `icon.civ.${k}`),
  ];
}
