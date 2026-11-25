/**
 * Asset manifest contract (plan 6.1). Game code refers to art only through
 * SpriteId / IconId; M1 backs this with a procedural generator (WP3), later a
 * sprite-sheet manifest can replace it without game code changes.
 */

import { Texture } from 'pixi.js';
import type { IconId, SpriteId } from '../../data/schema';
import type { Facing } from '../../sim/types';

export type { IconId, SpriteId } from '../../data/schema';

/** Animation states for units. */
export type UnitAnimState = 'idle' | 'walk' | 'work' | 'carry';
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
  animation(state: SpriteState, facing: Facing): SpriteAnimation;
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
