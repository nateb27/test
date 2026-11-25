/**
 * Placement and rally input modes (WP10), plus the controller the HUD callbacks
 * connect to: `modes.startPlacement(buildingType)` for `onStartPlacement` and
 * `modes.startRally()` for `onStartRally`.
 */

import type { DataRegistry } from '../../../data/schema';
import type { BuildingId, EntityId, PlacementResult, PlayerId, ReadonlyEntity, Sim } from '../../../sim/types';
import type { WorldRendererApi } from '../../render/renderer';
import type { CommandSink, InputMode } from '../gameInput';
import { createPlacementMode, type PlacementMode } from './placementMode';
import { createRallyMode, type RallyMode } from './rallyMode';
import type { PlacementGhost } from './types';

export { createPlacementMode } from './placementMode';
export type { PlacementDeps, PlacementMode } from './placementMode';
export { createRallyMode, rallyBuildings, resolveRallyTarget } from './rallyMode';
export type { RallyDeps, RallyMode, RallyTarget } from './rallyMode';
export { describePlacementProblem } from './reason';
export { footprintCentre, snapFootprint } from './snap';
export type { PlacementGhost } from './types';

/** Selected own units whose def can build `buildingType`, ascending ids. */
export function selectedBuilders(
  selection: readonly EntityId[],
  entityById: (id: EntityId) => ReadonlyEntity | undefined,
  owner: PlayerId,
  buildingType: BuildingId,
  registry: DataRegistry,
): EntityId[] {
  const out: EntityId[] = [];
  for (const id of selection) {
    const e = entityById(id);
    if (e === undefined || e.kind !== 'unit' || e.owner !== owner) continue;
    const d = registry.def(e.typeId);
    if (d !== undefined && d.kind === 'unit' && d.builds !== undefined && d.builds.includes(buildingType)) out.push(id);
  }
  return out.sort((a, b) => a - b);
}

export interface ModeControllerDeps {
  input: { setMode(mode: InputMode | null): void; readonly selection: { readonly ids: readonly EntityId[] } };
  sim: Sim;
  renderer: WorldRendererApi;
  commands: CommandSink;
  playerId: PlayerId;
  registry: DataRegistry;
  /** Replaces `sim.query.canPlace` (tests, and the temporary fallback while the sim's is a stub). */
  canPlace?(buildingType: BuildingId, tx: number, ty: number): PlacementResult;
  /** Toast text for a refused click ("Not enough wood", "Blocked"). */
  onInvalid?(reason: string): void;
}

export interface ModeController {
  /** Enter placement mode for a building type (replaces any active mode). */
  startPlacement(buildingType: BuildingId): PlacementMode;
  /** Enter set-rally mode. */
  startRally(): RallyMode;
  /** Leave any active mode. */
  cancel(): void;
  readonly active: PlacementMode | RallyMode | null;
  /** The ghost of the active placement mode, else null. Read by the overlays. */
  ghost(): PlacementGhost | null;
}

export function createModeController(deps: ModeControllerDeps): ModeController {
  let active: PlacementMode | RallyMode | null = null;
  const entityById = (id: EntityId): ReadonlyEntity | undefined => deps.sim.query.entityById(id);

  const enter = <T extends PlacementMode | RallyMode>(mode: T): T => {
    active = mode;
    deps.input.setMode(mode);
    return mode;
  };
  const leave = (mode: PlacementMode | RallyMode): void => {
    if (active === mode) {
      active = null;
      deps.input.setMode(null);
    }
  };

  const controller: ModeController = {
    startPlacement(buildingType) {
      const mode: PlacementMode = createPlacementMode(buildingType, {
        canPlace: deps.canPlace ?? ((type, tx, ty) => deps.sim.query.canPlace(deps.playerId, type, tx, ty)),
        canvasToWorld: (x, y) => deps.renderer.canvasToWorld(x, y),
        footprint: (type) => {
          const d = deps.registry.def(type);
          return d !== undefined && d.kind === 'building' ? d.footprint : 1;
        },
        builders: (type) => selectedBuilders(deps.input.selection.ids, entityById, deps.playerId, type, deps.registry),
        commands: deps.commands,
        viewport: () => ({ w: deps.renderer.camera.viewW, h: deps.renderer.camera.viewH }),
        onExit: () => leave(mode),
        ...(deps.onInvalid !== undefined ? { onInvalid: deps.onInvalid } : {}),
      });
      return enter(mode);
    },
    startRally() {
      const mode: RallyMode = createRallyMode({
        canvasToWorld: (x, y) => deps.renderer.canvasToWorld(x, y),
        pickEntity: (x, y) => deps.renderer.pickEntity(x, y),
        entityById,
        selection: () => deps.input.selection.ids,
        playerId: deps.playerId,
        registry: deps.registry,
        mapSize: () => ({ w: deps.sim.state.map.width, h: deps.sim.state.map.height }),
        commands: deps.commands,
        onExit: () => leave(mode),
        ...(deps.onInvalid !== undefined ? { onInvalid: deps.onInvalid } : {}),
      });
      return enter(mode);
    },
    cancel() {
      if (active !== null) {
        const m = active;
        active = null;
        deps.input.setMode(null);
        m.onCancel?.();
      }
    },
    get active() {
      return active;
    },
    ghost() {
      return active !== null && active.kind === 'placement' ? active.ghost : null;
    },
  };
  return controller;
}
