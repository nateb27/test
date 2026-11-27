import type { GameSpeed } from '../../app/loop';
import type { EntityId } from '../../../sim/types';

/** What the components can ask the HUD to do. `HudController` implements it; tests pass fakes. */
export interface HudActions {
  clickSlot(slot: number): void;
  narrowSelection(id: EntityId): void;
  cancelQueueItem(buildingId: EntityId, index: number): void;
  cycleIdleVillager(): void;
  cycleIdleMilitary(): void;
  setSpeed(speed: GameSpeed): void;
  togglePause(): void;
}
