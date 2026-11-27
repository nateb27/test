/**
 * Attack-move target mode (PLAN-M2 7.1): the next left click on the ground issues `attackMove` for the selected own
 * units, on an enemy it issues `attack`. Shift queues and keeps the mode; right click or Esc cancels.
 */

import type { DataRegistry } from '../../../data/schema';
import type { CommandInput, EntityId, PlayerId, ReadonlyEntity, Vec2 } from '../../../sim/types';
import type { CanvasPoint, InputMode, Modifiers } from '../gameInput';
import { resolveAttackMoveCommands } from './targeting';

export interface AttackMoveDeps {
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

export interface AttackMoveMode extends InputMode {
  readonly kind: 'attackMove';
  readonly active: boolean;
}

export function selectedEntities(deps: { selection(): readonly EntityId[]; entityById(id: EntityId): ReadonlyEntity | undefined }): ReadonlyEntity[] {
  const out: ReadonlyEntity[] = [];
  for (const id of deps.selection()) {
    const e = deps.entityById(id);
    if (e !== undefined) out.push(e);
  }
  return out;
}

export function createAttackMoveMode(deps: AttackMoveDeps): AttackMoveMode {
  let active = true;
  const exit = (): void => {
    if (!active) return;
    active = false;
    deps.onExit?.();
  };
  return {
    kind: 'attackMove',
    get active() {
      return active;
    },
    onLeftClick(p: CanvasPoint, mods: Modifiers) {
      if (!active) return false;
      const picked = deps.pickEntity(p.x, p.y);
      const target = picked === null ? null : (deps.entityById(picked) ?? null);
      const size = deps.mapSize();
      const w = deps.canvasToWorld(p.x, p.y);
      const point = { x: Math.min(size.w - 0.01, Math.max(0.01, w.x)), y: Math.min(size.h - 0.01, Math.max(0.01, w.y)) };
      const cmds = resolveAttackMoveCommands({
        selected: selectedEntities(deps),
        target,
        point,
        shift: mods.shift,
        owner: deps.playerId,
        registry: deps.registry,
      });
      if (cmds.length === 0) {
        deps.onInvalid?.('Select units that can attack');
        exit();
        return true;
      }
      for (const c of cmds) deps.commands.issue(c);
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
