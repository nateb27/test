/**
 * The HUD view-model builder (plan 7.3): a pure function from read-only sim
 * state, the selection, client-side UI state and the sim queries to a
 * `HudViewModel`. Components render only from the result.
 */

import type { DataRegistry } from '../../data/schema';
import {
  TICK_RATE,
  type BuildingId,
  type EntityId,
  type PlayerId,
  type ReadonlyEntity,
  type ReadonlyGameState,
} from '../../sim/types';
import type { GameSpeed } from '../app/loop';
import { isIdleVillager } from '../input/selection';
import { buildCommandCard, type HudQueries } from './commandCard';
import type {
  BannerVM,
  CardPage,
  HudViewModel,
  MultiSelectionVM,
  QueueItemVM,
  SelectionVM,
  SingleSelectionVM,
  ToastVM,
  TopBarVM,
} from './viewModel';

/** Client-side UI state that is not in the sim. */
export interface HudClientState {
  speed: GameSpeed;
  paused: boolean;
  page: CardPage;
  menuOpen: boolean;
  placing: BuildingId | null;
  toasts: readonly ToastVM[];
  banner: BannerVM | null;
}

export interface BuildViewModelInput {
  state: ReadonlyGameState;
  playerId: PlayerId;
  registry: DataRegistry;
  query: HudQueries;
  selection: readonly EntityId[];
  client: HudClientState;
}

const UNKNOWN_ICON = 'icon.unknown';
const NEUTRAL_COLOR = 0x9e9e9e;

/** Binary search in the ascending entity list. */
function findEntity(state: ReadonlyGameState, id: EntityId): ReadonlyEntity | undefined {
  let lo = 0;
  let hi = state.entities.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const e = state.entities[mid] as ReadonlyEntity;
    if (e.id === id) return e;
    if (e.id < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

export function buildTopBar(input: BuildViewModelInput): TopBarVM {
  const { state, playerId, registry, client } = input;
  const player = state.players[playerId];
  if (player === undefined) throw new Error(`No player ${playerId}`);
  let idle = 0;
  for (const e of state.entities) if (isIdleVillager(e, playerId, registry)) idle++;
  const age = registry.age(player.age);
  return {
    resources: { ...player.resources },
    popUsed: player.popUsed,
    popCap: player.popCap,
    popCapped: player.popUsed >= player.popCap,
    age: player.age,
    ageName: age.name,
    ageIcon: age.icon,
    idleVillagers: idle,
    clockSeconds: Math.floor(state.tick / TICK_RATE),
    speed: client.speed,
    paused: client.paused,
  };
}

function queueItems(input: BuildViewModelInput, e: Extract<ReadonlyEntity, { kind: 'building' }>): QueueItemVM[] {
  return e.queue.map((item, index): QueueItemVM => {
    const defId = item.kind === 'unit' ? item.unitType : item.techId;
    const def = input.registry.def(defId);
    return {
      index,
      kind: item.kind,
      defId,
      name: def?.name ?? defId,
      icon: def !== undefined && def.kind !== 'node' ? def.icon : UNKNOWN_ICON,
      progress: item.ticksTotal > 0 ? Math.min(1, item.ticksDone / item.ticksTotal) : 1,
      popBlocked: item.kind === 'unit' && item.popCapNotified,
    };
  });
}

function entityName(registry: DataRegistry, e: ReadonlyEntity): { name: string; icon: string } {
  const def = registry.def(e.typeId);
  if (def === undefined) return { name: e.typeId, icon: UNKNOWN_ICON };
  return { name: def.name, icon: def.icon };
}

function singleSelection(input: BuildViewModelInput, e: ReadonlyEntity): SingleSelectionVM {
  const { registry, state, playerId } = input;
  const def = registry.def(e.typeId);
  const { name, icon } = entityName(registry, e);
  let hp: SingleSelectionVM['hp'] = null;
  if (def !== undefined && def.kind !== 'node' && def.kind !== 'tech') {
    const max = def.combat.hp;
    const current = e.kind === 'building' && !e.constructed ? Math.max(1, Math.round(max * e.progress)) : max;
    hp = { current, max };
  }
  return {
    kind: 'single',
    entityId: e.id,
    entityKind: e.kind,
    defId: e.typeId,
    name,
    icon,
    ownerColor: state.players[e.owner]?.color ?? NEUTRAL_COLOR,
    own: e.owner === playerId,
    hp,
    carrying: e.kind === 'unit' && e.carried !== null ? { resource: e.carried.type, amount: e.carried.amount } : null,
    remaining: e.kind === 'node' ? e.amount : null,
    constructionProgress: e.kind === 'building' && !e.constructed ? e.progress : null,
    queue: e.kind === 'building' && e.owner === playerId ? queueItems(input, e) : [],
  };
}

function selectedEntities(input: BuildViewModelInput): ReadonlyEntity[] {
  const out: ReadonlyEntity[] = [];
  for (const id of input.selection) {
    const e = findEntity(input.state, id);
    if (e !== undefined) out.push(e);
  }
  return out;
}

export function buildSelection(input: BuildViewModelInput, entities = selectedEntities(input)): SelectionVM {
  const first = entities[0];
  if (first === undefined) return { kind: 'none' };
  if (entities.length === 1) return singleSelection(input, first);
  const multi: MultiSelectionVM = {
    kind: 'multi',
    entries: entities.map((e) => ({ entityId: e.id, defId: e.typeId, ...entityName(input.registry, e) })),
  };
  return multi;
}

/** Build the whole view-model. */
export function buildHudViewModel(input: BuildViewModelInput): HudViewModel {
  const entities = selectedEntities(input);
  const own = entities.filter((e) => e.owner === input.playerId);
  const civ = input.state.players[input.playerId]?.civ ?? null;
  const commandCard =
    own.length === 0 || own.length !== entities.length
      ? null
      : buildCommandCard({
          playerId: input.playerId,
          civ,
          registry: input.registry,
          query: input.query,
          selected: own,
          page: input.client.page,
        });
  return {
    topBar: buildTopBar(input),
    selection: buildSelection(input, entities),
    commandCard,
    toasts: [...input.client.toasts],
    banner: input.client.banner,
    menuOpen: input.client.menuOpen,
    placing: input.client.placing,
  };
}
