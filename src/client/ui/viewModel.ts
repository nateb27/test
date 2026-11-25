/**
 * HUD view-model contract (plan 7.3). Built from sim state + client state at
 * HUD_REFRESH_HZ (not every frame) by a builder WP9 writes; Preact components
 * render only from this. Plain data, so component tests use fixture objects.
 */

import type { IconId } from '../../data/schema';
import type {
  AgeNumber,
  BuildingId,
  EntityId,
  EntityKind,
  ProducibleId,
  ResourceAmounts,
  ResourceType,
  TechId,
  UnavailableReason,
  UnitId,
} from '../../sim/types';
import type { GameSpeed } from '../app/loop';

/** How often the view-model is rebuilt. */
export const HUD_REFRESH_HZ = 10;

/** Command card hotkeys, row-major 3x5 (plan 7.1). Slot i uses CARD_HOTKEYS[i]. */
export const CARD_HOTKEYS = ['Q', 'W', 'E', 'R', 'T', 'A', 'S', 'D', 'F', 'G', 'Z', 'X', 'C', 'V', 'B'] as const;
export type CardHotkey = (typeof CARD_HOTKEYS)[number];

export interface TopBarVM {
  resources: ResourceAmounts;
  popUsed: number;
  popCap: number;
  /** popUsed >= popCap (highlight). */
  popCapped: boolean;
  age: AgeNumber;
  ageName: string;
  idleVillagers: number;
  /** Elapsed game time in whole seconds (tick / TICK_RATE). */
  clockSeconds: number;
  speed: GameSpeed;
  paused: boolean;
}

export interface QueueItemVM {
  /** Index in the building's queue (for the cancelQueue command). */
  index: number;
  kind: 'unit' | 'tech';
  defId: UnitId | TechId;
  name: string;
  icon: IconId;
  /** 0..1. */
  progress: number;
  /** Held at 100% because of the population cap. */
  popBlocked: boolean;
}

/** One selected entity in detail. */
export interface SingleSelectionVM {
  kind: 'single';
  entityId: EntityId;
  entityKind: EntityKind;
  defId: string;
  name: string;
  icon: IconId;
  /** Owner team colour 0xRRGGBB. */
  ownerColor: number;
  /** True if the local player owns it (commands available). */
  own: boolean;
  /** Provisional, from data; current HP equals max in M1 (no combat). */
  hp: { current: number; max: number } | null;
  carrying: { resource: ResourceType; amount: number } | null;
  /** Resource nodes: amount left. Farms: null (infinite). */
  remaining: number | null;
  /** Unfinished buildings: 0..1. */
  constructionProgress: number | null;
  /** Buildings: production queue, front first. */
  queue: QueueItemVM[];
}

export interface MultiSelectionEntryVM {
  entityId: EntityId;
  defId: string;
  icon: IconId;
  name: string;
}

export interface MultiSelectionVM {
  kind: 'multi';
  entries: MultiSelectionEntryVM[];
}

export type SelectionVM = { kind: 'none' } | SingleSelectionVM | MultiSelectionVM;

/** Command card pages for villagers (plan 7.3). */
export type CardPage = 'main' | 'economy' | 'military';

/** What clicking a command card button does. */
export type CardAction =
  | { type: 'train'; unitType: UnitId }
  | { type: 'research'; techId: TechId }
  /** Enter placement mode for a building. */
  | { type: 'place'; buildingType: BuildingId }
  | { type: 'page'; page: CardPage }
  | { type: 'stop' }
  /** Enter "click to set rally point" mode. */
  | { type: 'setRally' }
  | { type: 'cancelConstruction' }
  | { type: 'delete' };

export interface CardButtonVM {
  /** 0..14, row-major in the 3x5 grid. */
  slot: number;
  hotkey: CardHotkey;
  action: CardAction;
  label: string;
  icon: IconId;
  /** For train/research/place: the def, to look up tooltips. */
  defId: ProducibleId | null;
  /** Resolved cost, or null for actions without cost. */
  cost: ResourceAmounts | null;
  /** Resolved time in seconds, or null. */
  timeSeconds: number | null;
  description: string;
  /** Rules met (from `query.availability`); false renders greyed out. */
  enabled: boolean;
  /** Unmet requirements, for the greyed reason and tooltip. */
  reasons: UnavailableReason[];
  /** Resources currently short (render those costs red). All zero when affordable. */
  shortfall: ResourceAmounts | null;
}

export interface CommandCardVM {
  page: CardPage;
  buttons: CardButtonVM[];
}

export type ToastKind = 'error' | 'info' | 'success';

export interface ToastVM {
  /** Unique, increasing; used as a key. */
  id: number;
  kind: ToastKind;
  text: string;
  /** Client time (ms) at which it should disappear. */
  expiresAt: number;
}

export interface BannerVM {
  kind: 'ageAdvanced' | 'objective';
  title: string;
  subtitle: string;
}

export interface HudViewModel {
  topBar: TopBarVM;
  selection: SelectionVM;
  /** Null when nothing own is selected. */
  commandCard: CommandCardVM | null;
  toasts: ToastVM[];
  banner: BannerVM | null;
  /** In-match menu (Resume, Save, Load, Restart, Quit) is open. */
  menuOpen: boolean;
  /** Placement mode: the building being placed, or null. */
  placing: BuildingId | null;
}
