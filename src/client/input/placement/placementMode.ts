/**
 * Building placement as an input mode (plan 4.5, 7.1). The ghost follows the
 * cursor snapped to tiles with the footprint centred under it; left click
 * issues `build` for the given builders; shift keeps the mode active (and
 * queues); right click or Esc cancels. All sim access is injected so the state
 * machine is unit testable.
 */

import type { BuildingId, CommandInput, EntityId, PlacementResult, Vec2 } from '../../../sim/types';
import type { CanvasPoint, InputMode, Modifiers } from '../gameInput';
import { describePlacementProblem } from './reason';
import { snapFootprint } from './snap';
import type { PlacementGhost } from './types';

export interface PlacementDeps {
  /** The sim's `canPlace` for the local player (injectable). */
  canPlace(buildingType: BuildingId, tx: number, ty: number): PlacementResult;
  /** Canvas CSS px -> world tiles. */
  canvasToWorld(cx: number, cy: number): Vec2;
  /** Footprint side of the building type. */
  footprint(buildingType: BuildingId): number;
  /** Selected villagers able to build this type, ascending ids. */
  builders(buildingType: BuildingId): readonly EntityId[];
  commands: { issue(input: CommandInput): unknown };
  /** Canvas size in CSS px; the ghost hides when the pointer is outside. Omit to always show. */
  viewport?(): { w: number; h: number };
  /** The mode ended (placed without shift, or cancelled). The owner must restore normal input. */
  onExit?(): void;
  /** A click was refused (invalid spot or no builders): text for a toast. */
  onInvalid?(reason: string): void;
  /** A build command was issued. */
  onPlaced?(tx: number, ty: number): void;
}

export interface PlacementMode extends InputMode {
  readonly kind: 'placement';
  readonly buildingType: BuildingId;
  readonly ghost: PlacementGhost;
  /** False once the mode ended. */
  readonly active: boolean;
  /** Recompute the ghost for a canvas point. */
  track(p: CanvasPoint): void;
}

export function createPlacementMode(buildingType: BuildingId, deps: PlacementDeps): PlacementMode {
  const size = Math.max(1, Math.round(deps.footprint(buildingType)));
  const ghost: PlacementGhost = {
    buildingType,
    size,
    tx: 0,
    ty: 0,
    visible: false,
    result: null,
    ok: false,
    tileOk: new Array<boolean>(size * size).fill(false),
    reason: null,
  };
  let active = true;

  const exit = (): void => {
    if (!active) return;
    active = false;
    ghost.visible = false;
    deps.onExit?.();
  };

  const track = (p: CanvasPoint): void => {
    const vp = deps.viewport?.();
    if (vp !== undefined && (p.x < 0 || p.y < 0 || p.x >= vp.w || p.y >= vp.h)) {
      ghost.visible = false;
      return;
    }
    const w = deps.canvasToWorld(p.x, p.y);
    const t = snapFootprint(w.x, w.y, size);
    ghost.tx = t.tx;
    ghost.ty = t.ty;
    const r = deps.canPlace(buildingType, t.tx, t.ty);
    ghost.result = r;
    ghost.ok = r.ok;
    // A result for another footprint size (a stub) cannot colour individual tiles: fall back to the overall answer.
    const perTile = r.tiles.length === size * size;
    for (let i = 0; i < ghost.tileOk.length; i++) ghost.tileOk[i] = perTile ? r.tiles[i] === null : r.ok;
    ghost.reason = describePlacementProblem(r);
    ghost.visible = true;
  };

  return {
    kind: 'placement',
    buildingType,
    ghost,
    get active() {
      return active;
    },
    track,
    onPointerMove(p) {
      if (active) track(p);
    },
    onLeftClick(p: CanvasPoint, mods: Modifiers) {
      if (!active) return false;
      track(p);
      if (!ghost.visible) return true;
      if (!ghost.ok) {
        deps.onInvalid?.(ghost.reason ?? 'Cannot build here');
        return true;
      }
      const unitIds = deps.builders(buildingType);
      if (unitIds.length === 0) {
        deps.onInvalid?.('Select a villager to build');
        return true;
      }
      deps.commands.issue({ type: 'build', unitIds: [...unitIds], buildingType, tx: ghost.tx, ty: ghost.ty, queue: mods.shift });
      deps.onPlaced?.(ghost.tx, ghost.ty);
      if (!mods.shift) exit();
      return true;
    },
    onRightClick() {
      if (!active) return false;
      exit();
      return true;
    },
    onCancel() {
      if (!active) return false;
      exit();
      return true;
    },
  };
}
