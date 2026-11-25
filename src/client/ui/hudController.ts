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
import type {
  BuildingId,
  CommandInput,
  EntityId,
  PlayerId,
  ReadonlyEntity,
  ReadonlyGameState,
  SimEvent,
  SimQuery,
} from '../../sim/types';
import type { GameSpeed } from '../app/loop';
import type { UiAction } from '../input/gameInput';
import type { HotkeyAction } from '../input/hotkeys';
import { perf } from '../debug/perf';
import { buildHudViewModel, type HudClientState } from './buildViewModel';
import type { HudQueries } from './commandCard';
import { NotificationCenter } from './notifications';
import { CANCEL_PAUSED_TEXT, DEMOLISH_PROMPT_TEXT, describeUnavailable } from './text';
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
}

/** The slice of `Match` the HUD uses. */
export interface HudMatch {
  readonly sim: { readonly state: ReadonlyGameState; readonly query: HudQueries & Pick<SimQuery, 'entityById'> };
  readonly commands: { issue(input: CommandInput): unknown };
  readonly loop: { paused: boolean; speed: GameSpeed };
  readonly input: HudInput;
  onEvents(listener: (events: readonly SimEvent[]) => void): () => void;
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
    const now = options.now ?? ((): number => performance.now());
    this.notifications = new NotificationCenter({ registry: this.registry, playerId: this.playerId, now });
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
        this.notifications.ingest(events, this.match.sim.state);
        this.refresh();
      }),
    );
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
    this.notifications.tick();
    this.refresh();
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
    this.pendingCancels.push({ buildingId, index, tick: this.match.sim.state.tick });
    this.match.commands.issue({ type: 'cancelQueue', buildingId, index });
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
        const unitIds = this.selectedOwn()
          .filter((e) => e.kind === 'unit')
          .map((e) => e.id);
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
    }
  }
}
