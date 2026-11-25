/**
 * Turns `SimEvent`s into toasts and banners (plan 7.3). Pure bookkeeping over
 * an injected clock, so tests drive it without timers.
 *
 * - Toasts: rejected commands (plain language), population cap, completed
 *   buildings / research / non-villager units, idle villagers. An identical
 *   live toast is merged into one with a count and its lifetime restarts;
 *   routine ones (units trained) cannot crowd out errors.
 * - Banners: age advances and the objective (with elapsed game time). Banners
 *   are shown one at a time, in order.
 */

import type { DataRegistry } from '../../data/schema';
import { TICK_RATE, type PlayerId, type ReadonlyGameState, type SimEvent } from '../../sim/types';
import { POP_CAPPED_TEXT, defName, formatClock, rejectionText } from './text';
import type { BannerVM, ToastKind, ToastVM } from './viewModel';

export interface NotificationOptions {
  registry: DataRegistry;
  playerId: PlayerId;
  /** Client clock in milliseconds. */
  now: () => number;
  toastMs?: number;
  bannerMs?: number;
  maxToasts?: number;
}

export class NotificationCenter {
  private readonly registry: DataRegistry;
  private readonly playerId: PlayerId;
  private readonly now: () => number;
  private readonly toastMs: number;
  private readonly bannerMs: number;
  private readonly maxToasts: number;
  private nextId = 1;
  private nextBannerId = 1;
  private toastList: ToastVM[] = [];
  private bannerQueue: Omit<BannerVM, 'id'>[] = [];
  private current: BannerVM | null = null;
  private currentExpires = 0;

  constructor(options: NotificationOptions) {
    this.registry = options.registry;
    this.playerId = options.playerId;
    this.now = options.now;
    this.toastMs = options.toastMs ?? 4000;
    this.bannerMs = options.bannerMs ?? 5000;
    this.maxToasts = options.maxToasts ?? 4;
  }

  get toasts(): readonly ToastVM[] {
    return this.toastList;
  }

  get banner(): BannerVM | null {
    return this.current;
  }

  /**
   * Show a toast now (also used by the HUD for greyed-out clicks). A toast identical to one still showing is merged
   * into it: its count goes up ("Spearman trained x3") and its lifetime restarts. `routine` toasts (units trained)
   * may hold at most half the slots, the oldest routine toast making room for a new one, and never push out anything
   * else; when the slots are full, a routine toast is the first to go, then non-errors, then the oldest.
   */
  push(kind: ToastKind, text: string, routine = false): void {
    const t = this.now();
    const existing = this.toastList.find((x) => (x.baseText ?? x.text) === text && x.kind === kind);
    if (existing !== undefined) {
      const count = (existing.count ?? 1) + 1;
      const merged: ToastVM = { ...existing, count, baseText: text, text: `${text} \u00d7${count}`, expiresAt: t + this.toastMs };
      this.toastList = this.toastList.map((x) => (x === existing ? merged : x));
      return;
    }
    const toast: ToastVM = { id: this.nextId++, kind, text, expiresAt: t + this.toastMs, ...(routine ? { routine: true } : {}) };
    const list = [...this.toastList];
    if (routine) {
      const limit = Math.max(1, Math.floor(this.maxToasts / 2));
      while (list.filter((x) => x.routine === true).length >= limit) list.splice(list.findIndex((x) => x.routine === true), 1);
    }
    list.push(toast);
    while (list.length > this.maxToasts) {
      const rank = (x: ToastVM): number => (x.routine === true ? 0 : x.kind === 'error' ? 2 : 1);
      let victim = 0;
      const last = routine ? list.length : list.length - 1; // only a routine toast may be the one dropped
      for (let i = 1; i < last; i++) if (rank(list[i]!) < rank(list[victim]!)) victim = i;
      list.splice(victim, 1);
    }
    this.toastList = list;
  }

  /** Queue a banner. */
  pushBanner(banner: Omit<BannerVM, 'id'>): void {
    this.bannerQueue.push(banner);
    this.advanceBanner();
  }

  /** Handle the events of one or more ticks. */
  ingest(events: readonly SimEvent[], state: ReadonlyGameState): void {
    let idle = 0;
    for (const ev of events) {
      switch (ev.type) {
        case 'CommandRejected':
          if (ev.playerId !== this.playerId) break;
          this.push('error', rejectionText(ev.reason, { unavailable: ev.unavailable, shortfall: ev.shortfall, commandType: ev.commandType }, this.registry));
          break;
        case 'PopulationCapped':
          if (ev.playerId === this.playerId) this.push('error', POP_CAPPED_TEXT);
          break;
        case 'BuildingCompleted':
          if (ev.playerId === this.playerId) this.push('success', `${defName(this.registry, ev.buildingType)} completed`);
          break;
        case 'ResearchCompleted':
          if (ev.playerId === this.playerId) this.push('success', `${defName(this.registry, ev.techId)} researched`);
          break;
        case 'UnitTrained':
          // Villagers are too frequent to announce; they show up at the rally point.
          if (ev.playerId === this.playerId && ev.unitType !== 'villager') {
            this.push('success', `${defName(this.registry, ev.unitType)} trained`, true);
          }
          break;
        case 'VillagerIdle':
          if (ev.playerId === this.playerId) idle++;
          break;
        case 'AgeAdvanced':
          if (ev.playerId !== this.playerId) break;
          this.pushBanner({
            kind: 'ageAdvanced',
            title: this.registry.age(ev.age).name,
            subtitle: `Your people have reached the ${this.registry.age(ev.age).name}`,
          });
          break;
        case 'ObjectiveCompleted': {
          if (ev.playerId !== this.playerId) break;
          const entry = state.objectives.entries.find((o) => o.id === ev.objectiveId);
          const elapsed = formatClock(ev.tick / TICK_RATE);
          const subtitle =
            entry !== undefined && entry.kind === 'reachAge'
              ? `${this.registry.age(entry.targetAge).name} reached after ${elapsed}`
              : `Completed after ${elapsed}`;
          this.pushBanner({ kind: 'objective', title: 'Objective complete', subtitle });
          break;
        }
        default:
          break;
      }
    }
    if (idle === 1) this.push('info', 'A villager is idle');
    else if (idle > 1) this.push('info', `${idle} villagers are idle`);
  }

  /** Drop expired toasts and advance banners. Returns true when anything changed. */
  tick(): boolean {
    const t = this.now();
    const before = this.toastList.length;
    this.toastList = this.toastList.filter((x) => x.expiresAt > t);
    let changed = this.toastList.length !== before;
    if (this.current !== null && t >= this.currentExpires) {
      this.current = null;
      changed = true;
    }
    if (this.advanceBanner()) changed = true;
    return changed;
  }

  private advanceBanner(): boolean {
    if (this.current !== null) return false;
    const next = this.bannerQueue.shift();
    if (next === undefined) return false;
    this.current = { ...next, id: this.nextBannerId++ };
    this.currentExpires = this.now() + this.bannerMs;
    return true;
  }
}
