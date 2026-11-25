/**
 * Command card content (plan 7.3): a pure function of the selection, the data
 * registry and the sim's `availability` / `resolvedStat` queries (supplied as
 * parameters so tests can pass fakes).
 *
 * Rules:
 * - Each selected own entity contributes the items it could show; a mixed
 *   selection shows only the items every entity has in common.
 * - Items for which `availability(...).hidden` is true (other civs, replaced
 *   defs) never appear, and neither does a tech the player already has.
 *   Everything else appears; unavailable ones are greyed (`enabled: false`)
 *   with the reasons from `availability`.
 * - Costs are the resolved (modifier-adjusted) ones from `availability`; times are `resolvedStat`.
 */

import type { BuildingDef, DataRegistry, ProducibleDef } from '../../data/schema';
import type {
  Availability,
  BuildingId,
  DefId,
  PlayerId,
  ProducibleId,
  ReadonlyEntity,
  StatKey,
} from '../../sim/types';
import {
  CARD_HOTKEYS,
  type CardAction,
  type CardButtonVM,
  type CardPage,
  type CommandCardVM,
} from './viewModel';

/** The sim queries the HUD needs (a subset of `SimQuery`, so tests pass fakes). */
export interface HudQueries {
  availability(playerId: PlayerId, defId: ProducibleId): Availability;
  resolvedStat(playerId: PlayerId, defId: DefId, stat: StatKey): number;
}

export const CARD_SLOTS = CARD_HOTKEYS.length;
/** Bottom-right slot: Back, Set Rally and Cancel construction. */
export const SLOT_CORNER = CARD_SLOTS - 1;
const SLOT_PAGE_ECONOMY = 0;
const SLOT_PAGE_MILITARY = 1;
const SLOT_STOP = 2;

export interface CardInput {
  playerId: PlayerId;
  civ: string | null;
  registry: DataRegistry;
  query: HudQueries;
  /** The selected entities that the local player owns. */
  selected: readonly ReadonlyEntity[];
  /** Requested page (client state); ignored unless every selected entity builds. */
  page: CardPage;
}

type ButtonBody = Omit<CardButtonVM, 'slot' | 'hotkey'>;

interface Item {
  key: string;
  fixedSlot: number | null;
  preferredSlot: number | null;
  body: ButtonBody;
}

/** The stat holding a def's production time in seconds. */
function timeStat(def: ProducibleDef): StatKey {
  switch (def.kind) {
    case 'unit':
      return 'trainTime';
    case 'building':
      return 'buildTime';
    case 'tech':
      return 'researchTime';
  }
}

/** True when the def can never be offered to this civ (data-level backstop for `availability.hidden`). */
function neverForCiv(def: ProducibleDef, civ: string | null): boolean {
  return def.civs !== undefined && civ !== null && !def.civs.includes(civ);
}

function defItem(input: CardInput, defId: ProducibleId, action: CardAction, preferred: number | null): Item | null {
  const def = input.registry.producible(defId);
  if (def === undefined) return null;
  const av = input.query.availability(input.playerId, defId);
  if (av.hidden || neverForCiv(def, input.civ)) return null;
  // A researched tech leaves the card of the building that offered it (plan 4.7).
  if (av.reasons.some((r) => r.code === 'alreadyResearched')) return null;
  return {
    key: `${action.type}:${defId}`,
    fixedSlot: null,
    preferredSlot: def.cardSlot ?? preferred,
    body: {
      action,
      label: def.name,
      icon: def.icon,
      defId,
      cost: { ...av.cost },
      timeSeconds: input.query.resolvedStat(input.playerId, defId, timeStat(def)),
      description: def.description,
      enabled: av.available,
      reasons: [...av.reasons],
      shortfall: { ...av.shortfall },
    },
  };
}

function plainItem(
  action: CardAction,
  label: string,
  icon: string,
  description: string,
  slot: number,
): Item {
  return {
    key: action.type === 'page' ? `page:${action.page}` : action.type,
    fixedSlot: slot,
    preferredSlot: null,
    body: {
      action,
      label,
      icon,
      defId: null,
      cost: null,
      timeSeconds: null,
      description,
      enabled: true,
      reasons: [],
      shortfall: null,
    },
  };
}

/** True for a unit that can construct buildings. */
function isBuilder(e: ReadonlyEntity, registry: DataRegistry): boolean {
  if (e.kind !== 'unit') return false;
  const def = registry.def(e.typeId);
  return def?.kind === 'unit' && (def.builds?.length ?? 0) > 0;
}

function buildItems(input: CardInput, page: Exclude<CardPage, 'main'>): Item[] {
  const items: Item[] = [];
  const seen = new Set<ProducibleId>();
  // Union over the selected builders, in data order of the first.
  for (const e of input.selected) {
    if (e.kind !== 'unit') continue;
    const def = input.registry.def(e.typeId);
    if (def?.kind !== 'unit') continue;
    for (const id of def.builds ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const b = input.registry.building(id) as BuildingDef;
      if (!b.buildable || b.buildMenu !== page) continue;
      const item = defItem(input, id, { type: 'place', buildingType: id as BuildingId }, null);
      if (item !== null) items.push(item);
    }
  }
  items.push(
    plainItem({ type: 'page', page: 'main' }, 'Back', 'icon.command.back', 'Return to the main commands.', SLOT_CORNER),
  );
  return items;
}

function unitItems(input: CardInput, e: ReadonlyEntity, page: CardPage): Item[] {
  const items: Item[] = [];
  if (page === 'main') {
    if (isBuilder(e, input.registry)) {
      items.push(
        plainItem(
          { type: 'page', page: 'economy' },
          'Economy',
          'icon.building.house',
          'Build houses, farms, drop-off camps and other economy buildings.',
          SLOT_PAGE_ECONOMY,
        ),
        plainItem(
          { type: 'page', page: 'military' },
          'Military',
          'icon.building.barracks',
          'Build barracks, ranges, stables and other military buildings.',
          SLOT_PAGE_MILITARY,
        ),
      );
    }
    items.push(plainItem({ type: 'stop' }, 'Stop', 'icon.command.stop', 'Stop what you are doing and stand still.', SLOT_STOP));
    return items;
  }
  return buildItems(input, page);
}

function buildingItems(input: CardInput, e: Extract<ReadonlyEntity, { kind: 'building' }>): Item[] {
  const def = input.registry.def(e.typeId);
  if (def?.kind !== 'building') return [];
  if (!e.constructed) {
    return [
      plainItem(
        { type: 'cancelConstruction' },
        'Cancel',
        'icon.command.cancel',
        'Cancel construction and get every resource back.',
        SLOT_CORNER,
      ),
    ];
  }
  const items: Item[] = [];
  // Stable slots (plan 7.3): an item's slot is its position in the building's data order for this civ
  // (units, then techs) for the whole match. Never-for-this-civ items take no slot; an item that is not
  // available yet stays greyed in its slot; a researched tech leaves its slot empty.
  let pos = 0;
  const ids: { id: ProducibleId; action: CardAction }[] = [
    ...def.trains.map((id) => ({ id, action: { type: 'train', unitType: id } as CardAction })),
    ...def.researches.map((id) => ({ id, action: { type: 'research', techId: id } as CardAction })),
  ];
  for (const { id, action } of ids) {
    const d = input.registry.producible(id);
    if (d === undefined || input.query.availability(input.playerId, id).hidden || neverForCiv(d, input.civ)) continue;
    const item = defItem(input, id, action, null);
    if (d.cardSlot !== undefined) {
      if (item !== null) items.push({ ...item, fixedSlot: d.cardSlot });
      continue;
    }
    if (item !== null && pos < SLOT_CORNER) items.push({ ...item, fixedSlot: pos });
    pos++;
  }
  if (def.trains.length > 0) {
    items.push(
      plainItem(
        { type: 'setRally' },
        'Set Rally',
        'icon.command.rally',
        'Then click the map to set where new units gather.',
        SLOT_CORNER,
      ),
    );
  }
  return items;
}

function entityItems(input: CardInput, e: ReadonlyEntity, page: CardPage): Item[] {
  switch (e.kind) {
    case 'unit':
      return unitItems(input, e, page);
    case 'building':
      return buildingItems(input, e);
    case 'node':
      return [];
  }
}

/** Slot assignment: fixed slots, then data-preferred slots, then data order into the free slots. */
function assignSlots(items: readonly Item[]): CardButtonVM[] {
  const taken = new Map<number, Item>();
  const rest: Item[] = [];
  for (const it of items) {
    if (it.fixedSlot !== null && !taken.has(it.fixedSlot)) taken.set(it.fixedSlot, it);
    else rest.push(it);
  }
  const unplaced: Item[] = [];
  for (const it of rest) {
    const p = it.preferredSlot;
    if (p !== null && p >= 0 && p < CARD_SLOTS && !taken.has(p)) taken.set(p, it);
    else unplaced.push(it);
  }
  let next = 0;
  for (const it of unplaced) {
    while (next < CARD_SLOTS && (taken.has(next) || next === SLOT_CORNER)) next++;
    if (next >= CARD_SLOTS) break;
    taken.set(next, it);
  }
  const out: CardButtonVM[] = [];
  for (const [slot, it] of [...taken.entries()].sort((a, b) => a[0] - b[0])) {
    out.push({ ...it.body, slot, hotkey: CARD_HOTKEYS[slot] as CardButtonVM['hotkey'] });
  }
  return out;
}

const PAGE_TITLE: Readonly<Record<CardPage, string>> = {
  main: 'Commands',
  economy: 'Build: Economy',
  military: 'Build: Military',
};

/**
 * Build the command card for the own entities in `input.selected`.
 * Returns null when nothing own is selected.
 */
export function buildCommandCard(input: CardInput): CommandCardVM | null {
  if (input.selected.length === 0) return null;
  const page: CardPage =
    input.page !== 'main' && input.selected.every((e) => isBuilder(e, input.registry)) ? input.page : 'main';

  let common: Item[] | null = null;
  for (const e of input.selected) {
    const items = entityItems(input, e, page);
    if (common === null) {
      common = items;
    } else {
      const keys = new Set(items.map((i) => i.key));
      common = common.filter((i) => keys.has(i.key));
    }
  }
  return { page, title: PAGE_TITLE[page], buttons: assignSlots(common ?? []) };
}
