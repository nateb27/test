/**
 * Asset manifest contract (plan 6.1). Game code refers to art only through
 * SpriteId / IconId; M1 backs this with a procedural generator (WP3), later a
 * sprite-sheet manifest can replace it without game code changes.
 */

import { Texture } from 'pixi.js';
import type { IconId, SpriteId } from '../../data/schema';
import type { Facing } from '../../sim/types';

export type { IconId, SpriteId } from '../../data/schema';

/**
 * Animation states for units. The first four are what every unit art has; the rest are optional, more specific states
 * (added for the pre-rendered sheets): a villager's job (`chop`, `mine`, `farm`, `forage`, `build`, otherwise `work`),
 * walking with a load (`carryWood`... otherwise `carry`), `attack`, `death` (plays once) and `corpse`. Art that lacks
 * one is asked for the generic state instead (`GENERIC_STATE`).
 */
export type UnitAnimState =
  | 'idle'
  | 'walk'
  | 'work'
  | 'carry'
  | 'chop'
  | 'mine'
  | 'farm'
  | 'forage'
  | 'build'
  | 'carryWood'
  | 'carryFood'
  | 'carryGold'
  | 'carryStone'
  | 'attack'
  | 'death'
  | 'corpse';

/** The four states every unit art has. */
export type BasicUnitState = 'idle' | 'walk' | 'work' | 'carry';

/** The basic state to use when an art has no animation for a specific one. */
export const GENERIC_STATE: Readonly<Record<UnitAnimState, BasicUnitState>> = {
  idle: 'idle',
  walk: 'walk',
  work: 'work',
  carry: 'carry',
  chop: 'work',
  mine: 'work',
  farm: 'work',
  forage: 'work',
  build: 'work',
  carryWood: 'carry',
  carryFood: 'carry',
  carryGold: 'carry',
  carryStone: 'carry',
  attack: 'work',
  death: 'idle',
  corpse: 'idle',
};
/** Visual construction stages for buildings. */
export type BuildingStage = 'foundation' | 'scaffold' | 'complete';
/** Any sprite state. Nodes and other static sprites use 'default'. */
export type SpriteState = UnitAnimState | BuildingStage | 'default';

/** One looping animation for a state and facing. */
export interface SpriteAnimation {
  /** Frames in order (M1 placeholder units have two per state). Never empty. */
  readonly frames: readonly Texture[];
  /** Milliseconds per frame. Ignored for single-frame animations. */
  readonly frameMs: number;
  /**
   * Draw mirrored horizontally (scale.x = -1). Units draw 4 facings and
   * mirror the other 4.
   */
  readonly mirrorX: boolean;
  /**
   * Optional, per frame: empty rows above the model in texture pixels (not counting a baked shadow). Overlays that
   * sit on top of a sprite use it instead of scanning the texture.
   */
  readonly modelTop?: readonly number[];
  /**
   * Optional, per frame: the ground shadow as its own texture (same frame size and anchor as `frames`). The renderer
   * draws it on a layer under every entity, so shadows never cover figures.
   */
  readonly shadows?: readonly Texture[];
  /**
   * Optional, per frame: the figure's box (no shadow, no outline) in texture pixels of the untrimmed frame, for
   * picking.
   */
  readonly bodies?: readonly { readonly x: number; readonly y: number; readonly w: number; readonly h: number }[];
  /**
   * Optional, locomotion: ground distance in tiles covered by one loop. The renderer then advances frames by the
   * distance the unit moved (feet do not slide at any speed) instead of by time.
   */
  readonly cycle?: number;
  /** Optional: `false` plays the frames once and holds the last one (death). Default true. */
  readonly loop?: boolean;
}

/**
 * Optional per-entity context for `SpriteAsset.animation`: the owner's age (buildings show the look of the current
 * age) and a stable seed (entity id) for assets with several variants (trees).
 */
export interface SpriteContext {
  readonly age?: number;
  readonly seed?: number;
}

export interface SpriteAsset {
  readonly id: SpriteId;
  /**
   * Anchor in texture-normalized coordinates (0..1). Placed at the entity's
   * anchor point on screen (unit position, or footprint centre for buildings
   * and nodes).
   */
  readonly anchor: { readonly x: number; readonly y: number };
  /** States this sprite supports. */
  readonly states: readonly SpriteState[];
  /** Animation for a state and facing. Unsupported states fall back to the first state. */
  animation(state: SpriteState, facing: Facing, context?: SpriteContext): SpriteAnimation;
  /**
   * Optional: number of looks chosen by `context.seed`. When set the asset varies itself, so the renderer does not
   * mirror it for variety (that would flip its baked shadow).
   */
  readonly variants?: number;
}

/**
 * Optional terrain art: seamless RGBA textures that repeat every `period` world tiles, each `width` x `height`
 * screen pixels (64*period x 32*period). The terrain layer picks per pixel between them.
 */
export interface TerrainArt {
  readonly period: number;
  readonly width: number;
  readonly height: number;
  readonly grass: Uint8ClampedArray;
  readonly grass2: Uint8ClampedArray;
  readonly dry: Uint8ClampedArray;
  readonly dirt: Uint8ClampedArray;
}

/** Progress callback for loading: fraction in [0, 1]. */
export type LoadProgress = (fraction: number) => void;

export interface AssetManifest {
  /** Generate or load every asset. Must complete before any lookup. */
  load(onProgress?: LoadProgress): Promise<void>;
  has(id: SpriteId): boolean;
  /** World sprite. Throws for unknown ids (data validation guarantees coverage). */
  sprite(id: SpriteId): SpriteAsset;
  /** HUD icon as a texture (for in-canvas use, e.g. the carried-resource marker). */
  iconTexture(id: IconId): Texture;
  /** HUD icon as an image URL (data: or blob:) for the Preact DOM HUD. */
  iconUrl(id: IconId): string;
  /** Release GPU resources. */
  destroy(): void;
  /** Optional terrain textures (the default grass is drawn when absent or null). */
  terrain?(): TerrainArt | null;
}

/** Placeholder manifest used until WP3 provides the procedural one: everything is blank. */
export function createStubManifest(): AssetManifest {
  const blank: SpriteAnimation = { frames: [Texture.EMPTY], frameMs: 0, mirrorX: false };
  return {
    load: (onProgress) => {
      onProgress?.(1);
      return Promise.resolve();
    },
    has: () => false,
    sprite: (id) => ({
      id,
      anchor: { x: 0.5, y: 1 },
      states: ['default'],
      animation: () => blank,
    }),
    iconTexture: () => Texture.EMPTY,
    iconUrl: () => '',
    destroy: () => {},
  };
}
