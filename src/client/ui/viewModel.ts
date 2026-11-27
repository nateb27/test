/**
 * HUD view-model contract (plan 7.3). Built from sim state + client state at
 * HUD_REFRESH_HZ (not every frame) by a builder WP9 writes; Preact components
 * render only from this. Plain data, so component tests use fixture objects.
 */

import type { IconId } from '../../data/schema';
import type {
  AgeNumber,
  AttackType,
  BuildingId,
  EntityId,
  EntityKind,
  PlayerId,
  PlayerOutcome,
  PlayerStats,
  ProducibleId,
  ResourceAmounts,
  ResourceType,
  Stance,
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
  /** WP9 addition: `icon.age.N`. */
  ageIcon: IconId;
  idleVillagers: number;
  /** Elapsed game time in whole seconds (tick / TICK_RATE). */
  clockSeconds: number;
  speed: GameSpeed;
  paused: boolean;
  /** M2: own military units with no order, no queue and no path (units on hold do not count). */
  idleMilitary: number;
  /** M2: the local player's slot colour 0xRRGGBB (top-bar swatch; the HUD itself stays purple). */
  playerColor: number;
}

/** M2: the combat line of the selection panel (PLAN-M2 7.3). */
export interface CombatStatsVM {
  attack: number;
  attackType: AttackType;
  range: number;
  meleeArmor: number;
  pierceArmor: number;
  /** e.g. ['+12 vs cavalry']. */
  bonuses: string[];
  /** Town Center: 'Fires 2 arrows'. */
  note: string | null;
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
  /** A cancel was issued and has not been applied yet (it applies on the next tick, so not while paused). */
  cancelPending: boolean;
}

/** One extra line in the selection panel (WP13): passive income, drop-off, population, gatherers. */
export interface SelectionFactVM {
  /** Stable key, e.g. `income`, `dropOff`, `pop`, `gatherers`. */
  id: string;
  /** Short text beside the icons, e.g. `+0.25 gold/s`, `Drop-off`, `+10 population`, `Gatherers 2/5`. */
  text: string;
  /** Full sentence for the hover title and screen readers, e.g. `Drop-off for food, wood, gold and stone`. */
  title: string;
  /** Resource icons shown before the text (resource ids). */
  resources: ResourceType[];
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
  /** Units and buildings. M1 values until WP29 makes them real: `{ current: entity.hp, max: resolved max hp }`. */
  hp: { current: number; max: number } | null;
  carrying: { resource: ResourceType; amount: number } | null;
  /** Resource nodes: amount left. Farms: null (infinite). */
  remaining: number | null;
  /** Unfinished buildings: 0..1. */
  constructionProgress: number | null;
  /** Buildings: production queue, front first. */
  queue: QueueItemVM[];
  /** Extra facts about the entity (WP13), in display order. Empty when there are none. */
  facts: SelectionFactVM[];
  /** M2: owner's display name (shown in the owner colour for other players' entities). */
  ownerName: string;
  /** M2: combat line for units and buildings that fight, else null. */
  combat: CombatStatsVM | null;
  /** M2: stance of own units with `autoAcquire`, else null. */
  stance: Stance | null;
  /** M2: the building has repairers. */
  repairing: boolean;
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
  | { type: 'delete' }
  /** M2: enter attack-move target mode. */
  | { type: 'attackMove' }
  /** M2: hold position. */
  | { type: 'hold' }
  /** M2: set the stance of the selected units. */
  | { type: 'stance'; stance: Stance }
  /** M2: enter repair target mode. */
  | { type: 'repair' };

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
  /** M2: highlighted (the current stance). */
  active?: boolean;
}

export interface CommandCardVM {
  page: CardPage;
  /** WP9 addition: heading above the grid, e.g. "Commands" or "Build: Economy". */
  title: string;
  buttons: CardButtonVM[];
}

export type ToastKind = 'error' | 'info' | 'success';

export interface ToastVM {
  /** Unique, increasing; used as a key. */
  id: number;
  kind: ToastKind;
  /** What is shown: the message, followed by " ×N" once N identical toasts have been merged into it. */
  text: string;
  /** Client time (ms) at which it should disappear. */
  expiresAt: number;
  /** How many identical toasts were merged into this one (absent: just one). */
  count?: number;
  /** The message without the count; what identical toasts are matched on. */
  baseText?: string;
  /** Routine news (a unit finished training) that yields its slot to anything else. */
  routine?: boolean;
}

export interface BannerVM {
  /** WP9 addition: unique, increasing; used as a key so a new banner replays its animation. */
  id: number;
  kind: 'ageAdvanced' | 'objective' | 'defeated';
  title: string;
  subtitle: string;
}

/** M2: the end screen (PLAN-M2 7.3). */
export interface EndScreenVM {
  result: 'victory' | 'defeat' | 'draw';
  reason: 'conquest' | 'resigned' | 'opponentResigned';
  clockSeconds: number;
  players: {
    playerId: PlayerId;
    name: string;
    color: number;
    you: boolean;
    outcome: PlayerOutcome;
    stats: PlayerStats;
  }[];
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
  /** M2: the end screen, or null while the match is on. */
  endScreen: EndScreenVM | null;
  /** M2: the "Resign this match?" confirmation is open. */
  resignConfirmOpen: boolean;
}
