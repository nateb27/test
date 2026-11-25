import type { BuildingId, PlacementResult } from '../../../sim/types';

/** What the placement mode shows under the cursor. Read by the ghost overlay. */
export interface PlacementGhost {
  buildingType: BuildingId;
  /** Footprint side in tiles. */
  size: number;
  /** Top-left tile of the snapped footprint. */
  tx: number;
  ty: number;
  /** False until the pointer has been over the game canvas. */
  visible: boolean;
  /** Last sim answer, or null before the first pointer move. */
  result: PlacementResult | null;
  /** Overall valid. */
  ok: boolean;
  /** Per footprint tile (row-major): true when that tile is fine. Length size * size. */
  tileOk: boolean[];
  /** Short reason text when invalid, else null. */
  reason: string | null;
}
