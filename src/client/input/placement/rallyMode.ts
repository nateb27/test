/**
 * Set-rally input mode: the next left click issues `setRally` for the selected
 * own buildings, onto the ground or onto the entity under the cursor.
 */

import type { DataRegistry } from '../../../data/schema';
import type { CommandInput, EntityId, PlayerId, ReadonlyEntity, Vec2 } from '../../../sim/types';
import type { CanvasPoint, InputMode } from '../gameInput';
import { entityCentre } from '../selection';

export interface RallyTarget {
  x: number;
  y: number;
  targetId?: EntityId;
}

/**
 * Where a rally click lands: a node or building under the cursor becomes an
 * entity rally (point = its footprint centre); a unit or empty ground is a
 * ground rally at the (clamped) clicked point.
 */
export function resolveRallyTarget(point: Vec2, target: ReadonlyEntity | null, registry: DataRegistry, mapW: number, mapH: number): RallyTarget {
  if (target !== null && target.kind !== 'unit') {
    const c = entityCentre(target, registry);
    return { x: c.x, y: c.y, targetId: target.id };
  }
  return { x: Math.min(mapW - 0.01, Math.max(0.01, point.x)), y: Math.min(mapH - 0.01, Math.max(0.01, point.y)) };
}

export interface RallyDeps {
  canvasToWorld(cx: number, cy: number): Vec2;
  pickEntity(cx: number, cy: number): EntityId | null;
  entityById(id: EntityId): ReadonlyEntity | undefined;
  /** Selected entity ids. */
  selection(): readonly EntityId[];
  playerId: PlayerId;
  registry: DataRegistry;
  mapSize(): { w: number; h: number };
  commands: { issue(input: CommandInput): unknown };
  onExit?(): void;
  onInvalid?(reason: string): void;
}

export interface RallyMode extends InputMode {
  readonly kind: 'rally';
  readonly active: boolean;
}

/** Own buildings among the selection that train units (the only ones with a rally point). */
export function rallyBuildings(deps: Pick<RallyDeps, 'selection' | 'entityById' | 'playerId' | 'registry'>): EntityId[] {
  const out: EntityId[] = [];
  for (const id of deps.selection()) {
    const e = deps.entityById(id);
    if (e === undefined || e.kind !== 'building' || e.owner !== deps.playerId) continue;
    const d = deps.registry.def(e.typeId);
    if (d !== undefined && d.kind === 'building' && d.trains.length > 0) out.push(id);
  }
  return out.sort((a, b) => a - b);
}

export function createRallyMode(deps: RallyDeps): RallyMode {
  let active = true;
  const exit = (): void => {
    if (!active) return;
    active = false;
    deps.onExit?.();
  };
  return {
    kind: 'rally',
    get active() {
      return active;
    },
    onLeftClick(p: CanvasPoint) {
      if (!active) return false;
      const ids = rallyBuildings(deps);
      if (ids.length === 0) {
        deps.onInvalid?.('Select a building that trains units');
        exit();
        return true;
      }
      const picked = deps.pickEntity(p.x, p.y);
      const target = picked === null ? null : (deps.entityById(picked) ?? null);
      const size = deps.mapSize();
      const t = resolveRallyTarget(deps.canvasToWorld(p.x, p.y), target, deps.registry, size.w, size.h);
      deps.commands.issue(
        t.targetId === undefined
          ? { type: 'setRally', buildingIds: ids, x: t.x, y: t.y }
          : { type: 'setRally', buildingIds: ids, x: t.x, y: t.y, targetId: t.targetId },
      );
      exit();
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
