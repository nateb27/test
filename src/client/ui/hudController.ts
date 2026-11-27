/**
 * Glue between a running match and the HUD components.
 *
 * - Holds client-only HUD state (card page, menu, placing, toasts).
 * - Rebuilds the view-model at HUD_REFRESH_HZ and immediately on selection
 *   change, page change and incoming sim events, then notifies subscribers.
 * - Routes command-card activation (hotkeys via `input.onCardSlot`, clicks via
 *   `input.triggerCardSlot`) to commands issued through the CommandBuffer, or
 *   to the injected placement / rally callbacks.
 *
 * It depends only on the small structural `HudMatch` interface, so tests pass
 * a fake match.
 */

import { registry as defaultRegistry } from '../../data';
import type { DataRegistry } from '../../data/schema';
import {
  RESOURCE_TYPES,
  TICK_RATE,
  type BuildingId,
  type CommandInput,
  type EntityId,
  type PlayerId,
  type ProducibleId,
  type ReadonlyEntity,
  type ReadonlyGameState,
  type SimEvent,
  type SimQuery,
} from '../../sim/types';
import type { GameSpeed } from '../app/loop';
import type { UiAction } from '../input/gameInput';
import type { HotkeyAction } from '../input/hotkeys';
import { perf } from '../debug/perf';
import { buildHudViewModel, type HudClientState } from './buildViewModel';
import type { HudQueries } from './commandCard';
import { NotificationCenter } from './notifications';
import { CANCEL_PAUSED_TEXT, DEMOLISH_PROMPT_TEXT, RESIGN_PAUSED_TEXT, describeUnavailable, repairStalledText } from './text';
import { HUD_REFRESH_HZ, type CardButtonVM, type CardPage, type HudViewModel } from './viewModel';

/** The slice of `GameInput` the HUD uses. */
export interface HudInput {
  readonly selection: {
    readonly ids: readonly EntityId[];
    set(ids: readonly EntityId[]): void;
    subscribe(listener: (ids: readonly EntityId[]) => void): () => void;
  };
  onCardSlot(listener: (slot: number) => void): () => void;
  triggerCardSlot(slot: number): void;
  onUiAction(listener: (action: UiAction) => void): () => void;
  perform(action: HotkeyAction): void;
  /** M2: an `UnderAttack` alert at a world point (the `Space` target). */
  noteAlert?(x: number, y: number): void;
}

/** The slice of `Match` the HUD uses. */
export interface HudMatch {
  readonly sim: { readonly state: ReadonlyGameState; readonly query: HudQueries & Pick<SimQuery, 'entityById'> };
  readonly commands: { issue(input: CommandInput): unknown };
  readonly loop: { paused: boolean; speed: GameSpeed };
  readonly input: HudInput;
  onEvents(listener: (events: readonly SimEvent[]) => void): () => void;
  /** WP30's end screen while it is shown, else null (absent: the HUD never sees one). */
  readonly endScreen?: object | null;
  /** Told when the end screen opens (its view-model) or closes (null). */
  onEndScreen?(listener: (vm: object | null) => void): () => void;
}

export interface HudControllerOptions {
  match: HudMatch;
  playerId: PlayerId;
  registry?: DataRegistry;
  /** Client clock (ms). Default `performance.now`. */
  now?: () => number;
  /** Called when a Build button is clicked or its hotkey pressed (WP10 enters placement mode). */
  onStartPlacement?: (buildingType: BuildingId) => void;
  /** Called when Set Rally is clicked or its hotkey pressed (WP10 enters rally mode). */
  onStartRally?: () => void;
  /** Called when Attack-move is clicked or its hotkey pressed (WP28 enters attack-move mode). */
  onStartAttackMove?: () => void;
  /** Called when Repair is clicked or its hotkey pressed (WP28 enters repair mode). */
  onStartRepair?: () => void;
  /** Called for every `UnderAttack` alert of the local player (the app pings the minimap). */
  onAlert?: (x: number, y: number) => void;
}

type Listener = (vm: HudViewModel) => void;

/** Structural equality of plain view-model data (primitives, arrays, plain objects). */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameData(a[i], bb[i])) return false;
    return true;
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = Object.keys(ra);
  if (keys.length !== Object.keys(rb).length) return false;
  for (const k of keys) if (!(k in rb) || !sameData(ra[k], rb[k])) return false;
  return true;
}

/**
 * `next` with every top-level part that equals the one in `prev` replaced by
 * the old object, so components can skip re-rendering parts that did not
 * change. Returns `prev` itself when nothing changed.
 */
export function shareUnchanged(prev: HudViewModel, next: HudViewModel): HudViewModel {
  let changed = false;
  const out = { ...next } as Record<string, unknown>;
  for (const key of Object.keys(next) as (keyof HudViewModel)[]) {
    if (sameData(prev[key], next[key])) out[key] = prev[key];
    else changed = true;
  }
  return changed ? (out as unknown as HudViewModel) : prev;
}

export class HudController {
  /** Replaceable after construction (the integrator wires WP10 in). */
  onStartPlacement: (buildingType: BuildingId) => void;
  onStartRally: () => void;
  onStartAttackMove: () => void;
  onStartRepair: () => void;
  onAlert: (x: number, y: number) => void;

  private readonly match: HudMatch;
  private readonly playerId: PlayerId;
  private readonly registry: DataRegistry;
  private readonly notifications: NotificationCenter;
  private readonly listeners = new Set<Listener>();
  private readonly cleanup: (() => void)[] = [];
  private page: CardPage = 'main';
  private menuOpen = false;
  private pausedByMenu = false;
  private placing: BuildingId | null = null;
  private resignConfirmOpen = false;
  /** Own buildings whose repair was stalled for want of resources at the last check (one toast per stall). */
  private stalledRepairs = new Set<EntityId>();
  /** Buildings being repaired: their hp at the last check and the tick it last changed. */
  private repairProgress = new Map<EntityId, { hp: number; tick: number }>();
  /** Queue cancels issued at `tick` and not yet applied (a command applies on the next tick). */
  private pendingCancels: { buildingId: EntityId; index: number; tick: number }[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private current: HudViewModel;

  constructor(options: HudControllerOptions) {
    this.match = options.match;
    this.playerId = options.playerId;
    this.registry = options.registry ?? defaultRegistry;
    this.onStartPlacement = options.onStartPlacement ?? ((): void => {});
    this.onStartRally = options.onStartRally ?? ((): void => {});
    this.onStartAttackMove = options.onStartAttackMove ?? ((): void => {});
    this.onStartRepair = options.onStartRepair ?? ((): void => {});
    this.onAlert = options.onAlert ?? ((): void => {});
    const now = options.now ?? ((): number => performance.now());
    this.notifications = new NotificationCenter({
      registry: this.registry,
      playerId: this.playerId,
      now,
      onAlert: (x, y) => {
        this.match.input.noteAlert?.(x, y);
        this.onAlert(x, y);
      },
    });
    this.current = this.build();
  }

  /** The latest view-model. */
  get vm(): HudViewModel {
    return this.current;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Start listening to the match and refreshing at HUD_REFRESH_HZ. */
  start(): void {
    if (this.timer !== null) return;
    const { input } = this.match;
    this.cleanup.push(
      input.selection.subscribe(() => {
        this.page = 'main';
        this.refresh();
      }),
      input.onCardSlot((slot) => this.activateSlot(slot)),
      input.onUiAction((action) => {
        if (action === 'menu') this.setMenuOpen(!this.menuOpen);
        else if (action === 'togglePause') this.togglePause();
        else if (action === 'confirmDemolish') this.toast('info', DEMOLISH_PROMPT_TEXT);
      }),
      this.match.onEvents((events) => {
        // Behind the end screen nothing is announced: it says who won, and the defeat banner, the conquest objective
        // and a burst of "destroyed" toasts would only queue up and show after "View map".
        if ((this.match.endScreen ?? null) !== null) this.notifications.clear();
        else this.notifications.ingest(events, this.match.sim.state);
        this.refresh();
      }),
    );
    // The match ended while the in-match menu was open (or with the Resign question up): the end screen replaces
    // the menu. The end screen holds the pause, so closing the menu here must not resume the game.
    const offEnd = this.match.onEndScreen?.((vm) => {
      if (vm === null) return;
      this.menuOpen = false;
      this.resignConfirmOpen = false;
      this.pausedByMenu = false;
      this.notifications.clear();
      this.refresh();
    });
    if (offEnd !== undefined) this.cleanup.push(offEnd);
    this.timer = setInterval(() => this.sync(), 1000 / HUD_REFRESH_HZ);
    this.refresh();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const c of this.cleanup.splice(0)) c();
    if (this.pausedByMenu) this.match.loop.paused = false;
    this.pausedByMenu = false;
  }

  /** What the refresh timer does, on demand: expire toasts, advance banners, rebuild the view-model. */
  sync(): void {
    this.checkRepairStalls();
    this.notifications.tick();
    this.refresh();
  }

  /**
   * Repair that stands still for want of resources (PLAN-M2 4.12: an unaffordable repair tick changes nothing and
   * the villagers keep hammering) raises one error toast per building and stall, "Not enough wood to repair". The
   * sim emits nothing for a stall, so the HUD looks: an own building with repairers below its maximum hp that has
   * gained no hp for twice the slowest repair step (at least `repairMinHpPerSecond`, so a working repair always
   * gains in that time), while its cost holds a resource the player has none of. Repair is bought a fraction at a
   * time, so with none of a resource it still runs until the next whole unit is due; the toast waits for that.
   */
  private checkRepairStalls(): void {
    const state = this.match.sim.state;
    const player = state.players[this.playerId];
    if (player === undefined) return;
    const stallTicks = 2 * Math.ceil(TICK_RATE / Math.max(0.1, this.registry.combat.repairMinHpPerSecond));
    const progress = new Map<EntityId, { hp: number; tick: number }>();
    const stalled = new Set<EntityId>();
    for (const e of state.entities) {
      if (e.kind !== 'building' || e.owner !== this.playerId || e.repairerIds.length === 0 || e.hp <= 0) continue;
      if (e.hp >= this.match.sim.query.resolvedStat(this.playerId, e.typeId, 'hp')) continue;
      const last = this.repairProgress.get(e.id);
      // Only a rise is progress: hp lost to attackers while the repair stands still does not reset the clock.
      const since = last !== undefined && e.hp <= last.hp ? last.tick : state.tick;
      progress.set(e.id, { hp: e.hp, tick: since });
      if (state.tick - since < stallTicks) continue;
      const cost = this.match.sim.query.availability(this.playerId, e.typeId as ProducibleId).cost;
      const missing = RESOURCE_TYPES.filter((r) => cost[r] > 0 && player.resources[r] < 1);
      if (missing.length === 0) continue;
      stalled.add(e.id);
      if (!this.stalledRepairs.has(e.id)) this.notifications.push('error', repairStalledText(missing));
    }
    this.repairProgress = progress;
    this.stalledRepairs = stalled;
  }

  /** Rebuild the view-model now and notify subscribers. */
  refresh(): void {
    const t0 = perf.start();
    const next = shareUnchanged(this.current, this.build());
    const t1 = perf.start();
    perf.end('hud.build', t0);
    if (next === this.current) return; // nothing the HUD shows changed: no notification, no re-render
    this.current = next;
    for (const l of [...this.listeners]) l(this.current);
    perf.end('hud.notify', t1);
  }

  private build(): HudViewModel {
    const client: HudClientState = {
      speed: this.match.loop.speed,
      paused: this.match.loop.paused,
      page: this.page,
      menuOpen: this.menuOpen,
      placing: this.placing,
      toasts: this.notifications.toasts,
      banner: this.notifications.banner,
      pendingCancels: this.livePendingCancels(),
      resignConfirmOpen: this.resignConfirmOpen,
    };
    return buildHudViewModel({
      state: this.match.sim.state,
      playerId: this.playerId,
      registry: this.registry,
      query: this.match.sim.query,
      selection: this.match.input.selection.ids,
      client,
    });
  }

  // ------------------------------------------------------------ UI state

  /** WP10 calls this when placement mode starts or ends so the card can show it. */
  setPlacing(buildingType: BuildingId | null): void {
    this.placing = buildingType;
    this.refresh();
  }

  setPage(page: CardPage): void {
    this.page = page;
    this.refresh();
  }

  /** Open or close the in-match menu. The game is paused while it is open. */
  setMenuOpen(open: boolean): void {
    if (open === this.menuOpen) return;
    this.menuOpen = open;
    if (!open) this.resignConfirmOpen = false;
    if (open) {
      this.pausedByMenu = !this.match.loop.paused;
      this.match.loop.paused = true;
    } else {
      if (this.pausedByMenu) this.match.loop.paused = false;
      this.pausedByMenu = false;
    }
    this.refresh();
  }

  setSpeed(speed: GameSpeed): void {
    this.match.loop.speed = speed;
    this.refresh();
  }

  togglePause(): void {
    if (this.menuOpen) return;
    this.match.loop.paused = !this.match.loop.paused;
    this.refresh();
  }

  /** Select and centre the next idle villager (same path as the `.` hotkey). */
  cycleIdleVillager(): void {
    this.match.input.perform({ type: 'cycleIdleVillager' });
    this.refresh();
  }

  /** Select and centre the next idle military unit (same path as the `,` hotkey). */
  cycleIdleMilitary(): void {
    this.match.input.perform({ type: 'cycleIdleMilitary' });
    this.refresh();
  }

  /** Resign in the in-match menu: ask first. */
  requestResign(): void {
    if (!this.menuOpen) return;
    this.resignConfirmOpen = true;
    this.refresh();
  }

  /** "No" in the Resign confirmation. */
  cancelResign(): void {
    this.resignConfirmOpen = false;
    this.refresh();
  }

  /**
   * "Yes" in the Resign confirmation: send `resign` and leave the menu. Like every command it applies on the next
   * tick, so a game that was paused before the menu opened says so.
   */
  confirmResign(): void {
    if (!this.resignConfirmOpen) return;
    this.resignConfirmOpen = false;
    this.match.commands.issue({ type: 'resign' });
    this.setMenuOpen(false);
    if (this.match.loop.paused) this.notifications.push('info', RESIGN_PAUSED_TEXT);
    this.refresh();
  }

  /** Narrow the selection to one entity (multi-selection grid click). */
  narrowSelection(id: EntityId): void {
    this.match.input.selection.set([id]);
  }

  /** Pending cancels the sim has not applied yet; those from earlier ticks are dropped. */
  private livePendingCancels(): { buildingId: EntityId; index: number }[] {
    const tick = this.match.sim.state.tick;
    this.pendingCancels = this.pendingCancels.filter((p) => p.tick === tick);
    return this.pendingCancels;
  }

  /**
   * Click a queue item to cancel it (refunded by the sim). Like every command it applies on the next tick,
   * so the item is shown as pending until then; while paused that is until the game resumes, and a toast says so.
   */
  cancelQueueItem(buildingId: EntityId, index: number): void {
    if (this.livePendingCancels().some((p) => p.buildingId === buildingId && p.index === index)) return;
    // The sim applies a tick's cancels one after another, each removing an item and shifting the ones behind
    // it, so the index sent is the clicked index minus the earlier cancels of the same building that sit ahead
    // of it. `pendingCancels` keeps the indexes as shown (they are what the queue display is keyed by).
    const shift = this.livePendingCancels().filter((p) => p.buildingId === buildingId && p.index < index).length;
    this.pendingCancels.push({ buildingId, index, tick: this.match.sim.state.tick });
    this.match.commands.issue({ type: 'cancelQueue', buildingId, index: index - shift });
    if (this.match.loop.paused) this.notifications.push('info', CANCEL_PAUSED_TEXT);
    this.refresh();
  }

  /** Show a message to the player. */
  toast(kind: 'error' | 'info' | 'success', text: string): void {
    this.notifications.push(kind, text);
    this.refresh();
  }

  // --------------------------------------------------------- command card

  /** A click on a card button: goes through the same path as its hotkey. */
  clickSlot(slot: number): void {
    this.match.input.triggerCardSlot(slot);
  }

  /** Run whatever is in `slot` of the current card. */
  activateSlot(slot: number): void {
    const button = this.current.commandCard?.buttons.find((b) => b.slot === slot);
    if (button === undefined) return;
    if (!button.enabled) {
      const why = button.reasons[0];
      this.toast('error', why === undefined ? `${button.label} is not available yet` : describeUnavailable(why, this.registry));
      return;
    }
    this.perform(button);
  }

  private selectedOwn(): ReadonlyEntity[] {
    const out: ReadonlyEntity[] = [];
    for (const id of this.match.input.selection.ids) {
      const e = this.match.sim.query.entityById(id);
      if (e !== undefined && e.owner === this.playerId) out.push(e);
    }
    return out;
  }

  /** Ascending ids of the selected own units. */
  private selectedUnitIds(): EntityId[] {
    return this.selectedOwn()
      .filter((e) => e.kind === 'unit')
      .map((e) => e.id);
  }

  /** The completed building that should receive a train / research order: shortest queue, then lowest id. */
  private producerFor(defId: string, list: 'trains' | 'researches'): EntityId | null {
    let best: Extract<ReadonlyEntity, { kind: 'building' }> | null = null;
    for (const e of this.selectedOwn()) {
      if (e.kind !== 'building' || !e.constructed) continue;
      const def = this.registry.def(e.typeId);
      if (def?.kind !== 'building' || !def[list].includes(defId)) continue;
      if (best === null || e.queue.length < best.queue.length) best = e;
    }
    return best?.id ?? null;
  }

  private perform(button: CardButtonVM): void {
    const { action } = button;
    const issue = (c: CommandInput): void => {
      this.match.commands.issue(c);
    };
    switch (action.type) {
      case 'train': {
        const buildingId = this.producerFor(action.unitType, 'trains');
        if (buildingId !== null) issue({ type: 'train', buildingId, unitType: action.unitType });
        return;
      }
      case 'research': {
        const buildingId = this.producerFor(action.techId, 'researches');
        if (buildingId !== null) issue({ type: 'research', buildingId, techId: action.techId });
        return;
      }
      case 'place':
        this.onStartPlacement(action.buildingType);
        return;
      case 'page':
        this.setPage(action.page);
        return;
      case 'stop': {
        const unitIds = this.selectedUnitIds();
        if (unitIds.length > 0) issue({ type: 'stop', unitIds });
        return;
      }
      case 'setRally':
        this.onStartRally();
        return;
      case 'cancelConstruction':
        for (const e of this.selectedOwn()) {
          if (e.kind === 'building' && !e.constructed) issue({ type: 'cancelConstruction', buildingId: e.id });
        }
        return;
      case 'delete':
        // Same path (and confirmation) as the Delete key.
        this.match.input.perform({ type: 'deleteSelection' });
        return;
      case 'attackMove':
        this.onStartAttackMove();
        return;
      case 'repair':
        this.onStartRepair();
        return;
      case 'hold': {
        const unitIds = this.selectedUnitIds();
        if (unitIds.length > 0) issue({ type: 'hold', unitIds });
        return;
      }
      case 'stance': {
        const unitIds = this.selectedUnitIds();
        if (unitIds.length > 0) issue({ type: 'setStance', unitIds, stance: action.stance });
        return;
      }
    }
  }
}
