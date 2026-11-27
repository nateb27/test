/**
 * Plain-language text for the HUD, all generated from data and sim values:
 * clock formatting, costs, unmet requirements and rejected-command toasts.
 */

import type { DataRegistry } from '../../data/schema';
import {
  ARMOR_CLASSES,
  RESOURCE_TYPES,
  type ArmorClass,
  type RejectReason,
  type ResourceAmounts,
  type ResourceType,
  type Stance,
  type UnavailableReason,
} from '../../sim/types';

/** `m:ss` (or `h:mm:ss` from one hour). */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Resources with a non-zero amount, in canonical order. */
export function nonZeroCosts(cost: Readonly<ResourceAmounts> | null): { resource: ResourceType; amount: number }[] {
  if (cost === null) return [];
  return RESOURCE_TYPES.filter((r) => cost[r] > 0).map((r) => ({ resource: r, amount: cost[r] }));
}

/** Display name of any def id (falls back to the id). */
export function defName(registry: DataRegistry, id: string): string {
  return registry.def(id)?.name ?? id;
}

/** Seconds as a short label, e.g. `45s` or `1m 30s`. */
export function formatSeconds(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest === 0 ? `${m}m` : `${m}m ${rest}s`;
}

/** One unmet requirement as a short sentence. */
export function describeUnavailable(reason: UnavailableReason, registry: DataRegistry): string {
  switch (reason.code) {
    case 'requiresAge':
      return `Requires ${registry.age(reason.age).name}`;
    case 'requiresBuilding':
      return `Requires ${defName(registry, reason.buildingId)}`;
    case 'requiresTech':
      return `Requires ${defName(registry, reason.techId)}`;
    case 'wrongCiv':
      return 'Not available to your civilization';
    case 'replaced':
      return `Replaced by ${defName(registry, reason.by)}`;
    case 'buildLimit':
      return `Limit of ${reason.limit} reached`;
    case 'alreadyResearched':
      return 'Already researched';
    case 'researchInProgress':
      return 'Already being researched';
    case 'ageBuildings':
      return `Needs ${reason.need} different buildings of this age (you have ${reason.have})`;
    case 'ageAdvanceInProgress':
      return 'An age advance is already in progress';
  }
}

/** "wood", "wood and gold", "food, wood and gold". */
function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1] ?? ''}`;
}

/** "Not enough wood" for a shortfall (every short resource is named). */
export function shortfallText(shortfall: Readonly<ResourceAmounts> | undefined): string {
  if (shortfall === undefined) return 'Not enough resources';
  const short: string[] = RESOURCE_TYPES.filter((r) => shortfall[r] > 0);
  return short.length === 0 ? 'Not enough resources' : `Not enough ${joinWords(short)}`;
}

/**
 * Plain text for every reject reason. A `Record` so adding a reason to the sim
 * contract fails to compile here until its toast text is written.
 */
export const REJECT_TEXT: Readonly<Record<RejectReason, string>> = {
  invalidCommand: 'That order was not understood',
  unknownEntity: 'That target no longer exists',
  notOwner: 'You do not control that',
  cannotPerform: 'That cannot do this',
  invalidTarget: 'Invalid target',
  notConstructed: 'Still under construction',
  notAvailable: 'Not available yet',
  cannotAfford: 'Not enough resources',
  cannotPlace: 'Cannot build there',
  queueFull: 'Production queue is full',
  invalidIndex: 'Nothing to cancel there',
  unknownDef: 'Unknown item',
  playerDefeated: 'You have been defeated',
};

/** Toast shown when a queue item is cancelled while the game is paused. */
export const CANCEL_PAUSED_TEXT = 'Cancel will apply when the game resumes';

/** Toast shown when a resignation is sent while the game is paused. */
export const RESIGN_PAUSED_TEXT = 'Resignation will apply when the game resumes';

/** Toast shown by the first Delete press on a completed building. */
export const DEMOLISH_PROMPT_TEXT = 'Press Delete again to demolish';

/** Toast for a refused `delete` (the sim only refuses a player's last Town Center with `cannotPerform`). */
export const LAST_TOWN_CENTER_TEXT = 'Your last Town Center cannot be demolished';

/** Toast text for a rejected command, using the extra detail the event carries. */
export function rejectionText(
  reason: RejectReason,
  detail: { unavailable?: readonly UnavailableReason[]; shortfall?: Readonly<ResourceAmounts>; commandType?: string },
  registry: DataRegistry,
): string {
  if (reason === 'cannotPerform' && detail.commandType === 'delete') return LAST_TOWN_CENTER_TEXT;
  if (reason === 'cannotAfford') return shortfallText(detail.shortfall);
  if (reason === 'notAvailable') {
    const first = detail.unavailable?.[0];
    return first === undefined ? REJECT_TEXT.notAvailable : describeUnavailable(first, registry);
  }
  return REJECT_TEXT[reason];
}

/** Message used when the population cap holds a finished unit back. */
export const POP_CAPPED_TEXT = 'Build more houses';

/** Names of the armour classes in the bonus lines ("+12 vs cavalry"). */
export const ARMOR_CLASS_TEXT: Readonly<Record<ArmorClass, string>> = {
  villager: 'villagers',
  infantry: 'infantry',
  spear: 'spearmen',
  archer: 'archers',
  cavalry: 'cavalry',
  siege: 'siege',
  building: 'buildings',
};

/** "+12 vs cavalry" lines of a unit's bonus table, in armour class order. */
export function bonusLines(bonus: Readonly<Partial<Record<ArmorClass, number>>>): string[] {
  const out: string[] = [];
  for (const c of ARMOR_CLASSES) {
    const v = bonus[c];
    if (v !== undefined && v > 0) out.push(`+${v} vs ${ARMOR_CLASS_TEXT[c]}`);
  }
  return out;
}

/** Stance names on the command card and in the selection panel. */
export const STANCE_TEXT: Readonly<Record<Stance, string>> = { aggressive: 'Aggressive', standGround: 'Stand ground' };

/** Toasts for `UnderAttack` (plan 7.3). */
export const ALERT_TEXT = {
  townCenter: 'Your Town Center is under attack!',
  building: 'Your buildings are under attack!',
  unit: 'Your units are under attack!',
} as const;

/** Toast for an own building that was destroyed. */
export const destroyedText = (name: string): string => `${name} destroyed`;

/** Prompt of the Resign confirmation. */
export const RESIGN_PROMPT_TEXT = 'Resign this match?';
