/**
 * Where the art of a unit starts, so its health bar sits just above the head in every art mode.
 *
 * A unit's texture box has empty rows above the model (a lot in the rendered art, whose boxes share one size).
 * `SpriteAnimation.modelTop` says how many; without it the texture is scanned once (`emptyRowsAbove`). The result is
 * cached per asset, state and facing, so after warm-up a lookup allocates nothing. The renderer's `DrawnEntity.top`
 * wins when it provides one (it does for buildings; units use this until it does).
 */

import type { DataRegistry } from '../../../data/schema';
import type { ReadonlyEntity } from '../../../sim/types';
import { UNIT_STATE_FALLBACK, type AssetManifest, type SpriteAnimation, type SpriteAsset, type UnitAnimState } from '../../art/manifest';
import { emptyRowsAbove, unitAnimState, type DrawnEntity } from '../entities';

const NO_PAD = -1;

/** Fewest empty rows over the frames of an animation (the highest the model reaches), or null when unknown. */
export function animationPad(anim: SpriteAnimation): number | null {
  let best: number | null = null;
  for (let i = 0; i < anim.frames.length; i++) {
    const p = anim.modelTop?.[i] ?? emptyRowsAbove(anim.frames[i]!);
    if (p !== null && (best === null || p < best)) best = p;
  }
  return best;
}

export class UnitTopCache {
  private readonly assets = new Map<string, SpriteAsset | null>();
  /** Per asset: pad by `stateIndex * 8 + facing`; `undefined` = not measured yet, `NO_PAD` = unknown. */
  private readonly pads = new WeakMap<SpriteAsset, number[]>();

  constructor(
    private readonly registry: DataRegistry,
    private readonly manifest: AssetManifest | undefined,
  ) {}

  private asset(typeId: string): SpriteAsset | null {
    let a = this.assets.get(typeId);
    if (a === undefined) {
      const def = this.registry.def(typeId);
      a = this.manifest !== undefined && def !== undefined && def.kind === 'unit' && this.manifest.has(def.sprite) ? this.manifest.sprite(def.sprite) : null;
      this.assets.set(typeId, a);
    }
    return a;
  }

  /** World-pixel y of the top of the unit's model, or null when the art cannot say. */
  top(e: ReadonlyEntity, d: DrawnEntity): number | null {
    if (d.top !== null) return d.top;
    if (e.kind !== 'unit') return null;
    const asset = this.asset(e.typeId);
    if (asset === null) return null;
    const state = unitAnimState(e);
    let table = this.pads.get(asset);
    if (table === undefined) {
      table = [];
      this.pads.set(asset, table);
    }
    const key = STATE_INDEX[state] * 8 + (e.facing & 7);
    let pad = table[key];
    if (pad === undefined) {
      const found = this.pad(asset, state, e);
      pad = found ?? NO_PAD;
      table[key] = pad;
    }
    return pad === NO_PAD ? null : d.bounds.minY + pad;
  }

  private pad(asset: SpriteAsset, state: UnitAnimState, e: ReadonlyEntity): number | null {
    if (e.kind !== 'unit') return null;
    // Assets lacking a state fall back the way the renderer does (the unit is drawn from the fallback's frames).
    let use: UnitAnimState | null = state;
    while (use !== null && !asset.states.includes(use)) use = UNIT_STATE_FALLBACK[use];
    if (use === null) return null;
    return animationPad(asset.animation(use, e.facing, { age: 1, seed: e.id }));
  }
}

const STATE_INDEX = { idle: 0, walk: 1, work: 2, carry: 3, attack: 4, death: 5 } as const;
