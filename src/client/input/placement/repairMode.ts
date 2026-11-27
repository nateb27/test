/**
 * Repair target mode (PLAN-M2 7.1): a left click on an own damaged, completed building issues `repair` for the
 * selected units that can build it; anything else toasts and the mode stays. Shift queues and keeps the mode;
 * right click or Esc cancels.
 */

import type { DataRegistry } from '../../../data/schema';
import type { CommandInput, EntityId, PlayerId, ReadonlyEntity } from '../../../sim/types';
import type { CanvasPoint, InputMode, Modifiers } from '../gameInput';
import { selectedEntities } from './attackMoveMode';
import { isDamagedOwnBuilding, repairers } from './targeting';

export const REPAIR_HINT = 'Choose a damaged building of yours';

export interface RepairDeps {
  pickEntity(cx: number, cy: number): EntityId | null;
  entityById(id: EntityId): ReadonlyEntity | undefined;
  selection(): readonly EntityId[];
  playerId: PlayerId;
  registry: DataRegistry;
  /** Resolved max hp of an entity for its owner. */
  maxHp(e: ReadonlyEntity): number;
  commands: { issue(input: CommandInput): unknown };
  onExit?(): void;
  onInvalid?(reason: string): void;
}

export interface RepairMode extends InputMode {
  readonly kind: 'repair';
  readonly active: boolean;
}

export function createRepairMode(deps: RepairDeps): RepairMode {
  let active = true;
  const exit = (): void => {
    if (!active) return;
    active = false;
    deps.onExit?.();
  };
  return {
    kind: 'repair',
    get active() {
      return active;
    },
    onLeftClick(p: CanvasPoint, mods: Modifiers) {
      if (!active) return false;
      const picked = deps.pickEntity(p.x, p.y);
      const target = picked === null ? null : (deps.entityById(picked) ?? null);
      if (target === null || !isDamagedOwnBuilding(target, deps.playerId, deps.maxHp)) {
        deps.onInvalid?.(REPAIR_HINT);
        return true;
      }
      const unitIds = repairers(selectedEntities(deps), target, deps.playerId, deps.registry);
      if (unitIds.length === 0) {
        deps.onInvalid?.('Select villagers to repair');
        exit();
        return true;
      }
      deps.commands.issue({ type: 'repair', unitIds, buildingId: target.id, queue: mods.shift });
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
