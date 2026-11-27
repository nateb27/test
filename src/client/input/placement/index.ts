/**
 * Placement and rally input modes (WP10), plus the controller the HUD callbacks
 * connect to: `modes.startPlacement(buildingType)` for `onStartPlacement` and
 * `modes.startRally()` for `onStartRally`.
 */

import type { DataRegistry } from '../../../data/schema';
import type { BuildingId, EntityId, PlacementResult, PlayerId, ReadonlyEntity, Sim } from '../../../sim/types';
import type { WorldRendererApi } from '../../render/renderer';
import type { CommandSink, InputMode } from '../gameInput';
import { createAttackMoveMode, type AttackMoveMode } from './attackMoveMode';
import { createCursorController, type CursorKind } from './cursors';
import { createPlacementMode, type PlacementMode } from './placementMode';
import { createRallyMode, type RallyMode } from './rallyMode';
import { createRepairMode, type RepairMode } from './repairMode';
import type { PlacementGhost } from './types';

export { createPlacementMode } from './placementMode';
export type { PlacementDeps, PlacementMode } from './placementMode';
export { createRallyMode, rallyBuildings, resolveRallyTarget } from './rallyMode';
export type { RallyDeps, RallyMode, RallyTarget } from './rallyMode';
export { createAttackMoveMode } from './attackMoveMode';
export type { AttackMoveDeps, AttackMoveMode } from './attackMoveMode';
export { createRepairMode, REPAIR_HINT } from './repairMode';
export type { RepairDeps, RepairMode } from './repairMode';
export { createCursorController, cursorCss, resolveCursor } from './cursors';
export type { CursorController, CursorDeps, CursorKind } from './cursors';
export {
  anySelectedCanTarget,
  attackers,
  canAttack,
  canTarget,
  isDamagedOwnBuilding,
  isEnemyOf,
  repairers,
  resolveAttackMoveCommands,
} from './targeting';
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
  /** Replaces `sim.query.canPlace` (tests only; the game uses the sim's). */
  canPlace?(buildingType: BuildingId, tx: number, ty: number): PlacementResult;
  /** Toast text for a refused click ("Not enough wood", "Blocked"). */
  onInvalid?(reason: string): void;
  /** The active mode changed (started, replaced or ended); `null` when none is active. */
  onChange?(mode: ActiveMode | null): void;
}

export type ActiveMode = PlacementMode | RallyMode | AttackMoveMode | RepairMode;

export interface ModeController {
  /** Enter placement mode for a building type (replaces any active mode). */
  startPlacement(buildingType: BuildingId): PlacementMode;
  /** Enter set-rally mode. */
  startRally(): RallyMode;
  /** Enter attack-move target mode (command card A). */
  startAttackMove(): AttackMoveMode;
  /** Enter repair target mode (villager card R). */
  startRepair(): RepairMode;
  /** The cursor the world canvas shows: `attackMove` and `repair` in those modes, `attack` over an attackable enemy. */
  cursor(): CursorKind;
  /** Remove the cursor listeners and restore the canvas cursor. */
  destroy(): void;
  /** Leave any active mode. */
  cancel(): void;
  /**
   * The active placement or rally mode, else null. Target modes (attack-move, repair) are in `target`: this member
   * keeps its M1 type because the debug hook's `inputMode()` is typed by it.
   */
  readonly active: PlacementMode | RallyMode | null;
  /** The active attack-move or repair mode, else null. */
  readonly target: AttackMoveMode | RepairMode | null;
  /** Kind of whichever mode is active, or null. */
  modeKind(): ActiveMode['kind'] | null;
  /** The ghost of the active placement mode, else null. Read by the overlays. */
  ghost(): PlacementGhost | null;
}

export function createModeController(deps: ModeControllerDeps): ModeController {
  let active: ActiveMode | null = null;
  const entityById = (id: EntityId): ReadonlyEntity | undefined => deps.sim.query.entityById(id);
  const maxHp = (e: ReadonlyEntity): number => {
    try {
      return deps.sim.query.resolvedStat(e.owner, e.typeId, 'hp');
    } catch {
      return 0;
    }
  };

  const selectionStore = (deps.input as { selection: { subscribe?: (l: () => void) => () => void } }).selection;
  const cursors = createCursorController({
    canvas: deps.renderer.canvas,
    pickEntity: (x, y) => deps.renderer.pickEntity(x, y),
    entityById,
    selection: () => deps.input.selection.ids,
    playerId: deps.playerId,
    registry: deps.registry,
    modeKind: () => active?.kind ?? null,
    ...(typeof selectionStore.subscribe === 'function' ? { onSelection: (l: () => void) => selectionStore.subscribe!(l) } : {}),
  });

  const enter = <T extends ActiveMode>(mode: T): T => {
    active = mode;
    deps.input.setMode(mode);
    deps.onChange?.(mode);
    cursors.refresh();
    return mode;
  };
  const leave = (mode: ActiveMode): void => {
    if (active === mode) {
      active = null;
      deps.input.setMode(null);
      deps.onChange?.(null);
      cursors.refresh();
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
    startAttackMove() {
      const mode: AttackMoveMode = createAttackMoveMode({
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
    startRepair() {
      const mode: RepairMode = createRepairMode({
        pickEntity: (x, y) => deps.renderer.pickEntity(x, y),
        entityById,
        selection: () => deps.input.selection.ids,
        playerId: deps.playerId,
        registry: deps.registry,
        maxHp,
        commands: deps.commands,
        onExit: () => leave(mode),
        ...(deps.onInvalid !== undefined ? { onInvalid: deps.onInvalid } : {}),
      });
      return enter(mode);
    },
    cursor: () => cursors.current(),
    destroy: () => {
      removeDebug();
      cursors.destroy();
    },
    cancel() {
      if (active !== null) {
        const m = active;
        active = null;
        deps.input.setMode(null);
        m.onCancel?.();
        deps.onChange?.(null);
        cursors.refresh();
      }
    },
    get active() {
      return active !== null && (active.kind === 'placement' || active.kind === 'rally') ? active : null;
    },
    get target() {
      return active !== null && (active.kind === 'attackMove' || active.kind === 'repair') ? active : null;
    },
    modeKind: () => active?.kind ?? null,
    ghost() {
      return active !== null && active.kind === 'placement' ? active.ghost : null;
    },
  };
  const removeDebug = exposeForDebug(controller);
  return controller;
}

/** What `window.__game.wp28` offers in dev and e2e builds (the e2e specs enter the target modes through it). */
export interface ModeDebugApi {
  startMode(kind: 'attackMove' | 'repair'): void;
  cursor(): CursorKind;
  modeKind(): ActiveMode['kind'] | null;
}

/**
 * Dev and e2e builds only: put the mode controller on the `__game` hook as `wp28`, until the command card buttons
 * (WP29) and the hook (WP30) can start these modes. Returns the remover.
 */
function exposeForDebug(c: ModeController): () => void {
  if (!(import.meta.env.DEV || import.meta.env.MODE === 'e2e') || typeof window === 'undefined') return () => {};
  const game = (window as unknown as { __game?: object }).__game;
  if (game === undefined) return () => {};
  const api: ModeDebugApi = {
    startMode(kind) {
      if (kind === 'attackMove') c.startAttackMove();
      else c.startRepair();
    },
    cursor: () => c.cursor(),
    modeKind: () => c.modeKind(),
  };
  Object.defineProperty(game, 'wp28', { value: api, configurable: true, enumerable: false });
  return () => {
    Reflect.deleteProperty(game, 'wp28');
  };
}
