/**
 * One AI decision's working state, shared by the layers (economy, military, army, defence, upkeep): the views, the
 * stockpile left after what this decision already spent, the commands so far, the villagers already claimed, and
 * the operation counter. Nothing here outlives the decision except what is written into `mem`.
 */

import type { DataRegistry } from '../../data';
import {
  RESOURCE_TYPES,
  type BuildingId,
  type CommandInput,
  type EntityId,
  type PlayerId,
  type ResourceAmounts,
  type Sim,
} from '../../sim';
import { CachedQuery } from '../cachedQuery';
import { blockedFromView, findSpot, type Blocked } from '../placement';
import type { BotView, VillagerView } from '../view';
import { BANK_CAP, RALLY_DISTANCE, type DifficultyProfile } from './difficulty';
import type { AiMemory } from './memory';
import type { PowerTable } from './power';
import type { AiWorld, Ops } from './world';

export interface AiOptions {
  /**
   * `combat` (default): waves use `attackMove`, siege `attack`, repairs `repair`. `move`: everything that would be a
   * combat command is a plain `move` and no repair is ordered. For tests run before combat exists (the stubs reject
   * combat commands), so wave timing and composition can be measured by launch.
   */
  orders?: 'combat' | 'move';
}

const dist = (ax: number, ay: number, bx: number, by: number): number => Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));

export class AiDecision {
  readonly cmds: CommandInput[] = [];
  /** Stockpile minus what this decision has committed. */
  readonly stock: ResourceAmounts;
  /** Villagers given an order this decision (the economy layer must not reassign them). */
  readonly claimed = new Set<EntityId>();
  readonly tick: number;
  /** `sim.query` with availability remembered for this decision and every call counted into `ops`. */
  readonly query: CachedQuery;
  readonly combatOrders: boolean;
  popUsed: number;
  readonly popCap: number;
  /** Army reserve (6.4): the army's part of the stockpile (the bank, capped by the stockpile). Set by `creditBank`. */
  readonly reserve: ResourceAmounts = { food: 0, wood: 0, gold: 0, stone: 0 };
  /** Held back from the economy for a military building the AI is saving for (this decision only). */
  readonly saving: ResourceAmounts = { food: 0, wood: 0, gold: 0, stone: 0 };
  /** Booming to the next age (`ageUpVillagers`): the advance's cost, which the military may not touch. */
  ageCost: ResourceAmounts | null = null;
  /** A threat is being answered this decision and the difficulty spends everything on the army then. */
  allOutDefence = false;
  /**
   * Finishing (every difficulty): a wave has gone out and the enemy's fighting power is under a quarter of this AI's
   * army. Waves then reinforce continuously, the composition drops archers (useless against buildings), Siege
   * Workshops come first in Age 3, and `finishAllOut` difficulties spend their whole stock on the army.
   */
  finishing = false;
  private blockedGrid: Blocked | null = null;

  constructor(
    readonly sim: Sim,
    readonly playerId: PlayerId,
    readonly profile: DifficultyProfile,
    readonly mem: AiMemory,
    readonly data: DataRegistry,
    readonly world: AiWorld,
    readonly view: BotView,
    readonly powers: PowerTable,
    readonly ops: Ops,
    options: AiOptions,
  ) {
    this.tick = sim.state.tick;
    this.query = new CachedQuery(sim.query, sim.state.entities.length, ops);
    this.stock = { ...view.resources };
    this.popUsed = view.popUsed;
    this.popCap = view.popCap;
    this.combatOrders = (options.orders ?? 'combat') === 'combat';
  }

  emit(cmd: CommandInput): void {
    this.cmds.push(cmd);
  }

  cost(id: string): ResourceAmounts {
    return this.query.availability(this.playerId, id).cost;
  }

  available(id: string): boolean {
    return this.query.availability(this.playerId, id).available;
  }

  /** Reserve still available now (capped by what is left in the stockpile). */
  reserveAvailable(r: (typeof RESOURCE_TYPES)[number]): number {
    return Math.max(0, Math.min(this.reserve[r], this.stock[r]));
  }

  /**
   * Credit the army share of the income gathered since the last decision to the bank (integers; remainders carried
   * in hundredths), cap it at BANK_CAP per resource, and set the reserve to the bank capped by the stockpile.
   */
  creditBank(gathered: ResourceAmounts, active: boolean): void {
    const pct = Math.round(this.profile.armyShare * 100);
    const mem = this.mem;
    for (const r of RESOURCE_TYPES) {
      const delta = Math.max(0, gathered[r] - mem.gatheredSeen[r]);
      mem.gatheredSeen[r] = gathered[r];
      // Boom, then age: the advance's resources are not banked while it is saved for.
      if (active && (this.ageCost === null || this.ageCost[r] === 0)) {
        const scaled = delta * pct + mem.bankRemainder[r];
        const whole = Math.floor(scaled / 100);
        mem.bankRemainder[r] = scaled - whole * 100;
        mem.bank[r] = Math.min(BANK_CAP, mem.bank[r] + whole);
      }
      mem.bank[r] = Math.min(mem.bank[r], this.stock[r]);
      if (this.ageCost !== null && this.ageCost[r] > 0) mem.bank[r] = Math.min(mem.bank[r], Math.max(0, this.stock[r] - this.ageCost[r]));
      this.reserve[r] = mem.bank[r];
    }
  }

  /** What the military may spend now: the reserve plus any surplus above `surplusAbove` (and the advance being saved for). */
  militaryBudget(): ResourceAmounts {
    const out = { food: 0, wood: 0, gold: 0, stone: 0 };
    if (this.allOutDefence || (this.finishing && this.profile.finishAllOut)) {
      // Everything except the advance being saved for (boom, then age).
      for (const r of RESOURCE_TYPES) out[r] = Math.max(0, this.stock[r] - (this.ageCost?.[r] ?? 0));
      return out;
    }
    for (const r of RESOURCE_TYPES) {
      const res = this.reserveAvailable(r);
      out[r] = res + Math.max(0, this.stock[r] - res - this.profile.surplusAbove - (this.ageCost?.[r] ?? 0));
    }
    return out;
  }

  /** The stockpile minus the army reserve (what the economy may spend). */
  freeStock(): ResourceAmounts {
    const out = { food: 0, wood: 0, gold: 0, stone: 0 };
    for (const r of RESOURCE_TYPES) out[r] = this.stock[r] - this.reserveAvailable(r);
    return out;
  }

  canAfford(cost: ResourceAmounts, budget: ResourceAmounts = this.stock): boolean {
    return RESOURCE_TYPES.every((r) => budget[r] >= cost[r] && this.stock[r] >= cost[r]);
  }

  /** Commit `cost`. Military spending (`fromReserve`) is taken out of the reserve first. */
  pay(cost: ResourceAmounts, fromReserve: boolean): void {
    for (const r of RESOURCE_TYPES) {
      this.stock[r] -= cost[r];
      if (fromReserve) {
        this.reserve[r] = Math.max(0, this.reserve[r] - cost[r]);
        this.mem.bank[r] = Math.max(0, this.mem.bank[r] - cost[r]);
      }
    }
  }

  claim(v: VillagerView | EntityId): void {
    const id = typeof v === 'number' ? v : v.id;
    this.claimed.add(id);
    const view = typeof v === 'number' ? this.view.villagers.find((x) => x.id === id) : v;
    if (view !== undefined) view.claimed = true;
  }

  /** Home point: the Town Center centre, else the remembered home, else the map centre. */
  home(): { x: number; y: number } {
    const tc = this.world.tc;
    if (tc !== null) return { x: tc.cx, y: tc.cy };
    if (this.mem.homeX >= 0) return { x: this.mem.homeX, y: this.mem.homeY };
    return { x: this.world.mapWidth / 2, y: this.world.mapHeight / 2 };
  }

  /** The point the AI's enemy lives at: nearest enemy Town Center, else the centroid of enemy buildings, else the map centre. */
  enemyHome(): { x: number; y: number } {
    const e = this.world.enemyTc;
    if (e !== null) return { x: e.cx, y: e.cy };
    const bs = this.world.enemyBuildings;
    if (bs.length > 0) {
      let x = 0;
      let y = 0;
      for (const b of bs) {
        x += b.cx;
        y += b.cy;
      }
      return { x: x / bs.length, y: y / bs.length };
    }
    return { x: this.world.mapWidth - this.home().x, y: this.world.mapHeight - this.home().y };
  }

  /** Rally point (6.4): RALLY_DISTANCE tiles from home towards the enemy, moved onto a free tile. */
  rally(): { x: number; y: number } {
    const h = this.home();
    const e = this.enemyHome();
    const d = dist(h.x, h.y, e.x, e.y);
    let x = h.x;
    let y = h.y;
    if (d > 1e-6) {
      const k = Math.min(RALLY_DISTANCE, d / 2) / d;
      x = h.x + (e.x - h.x) * k;
      y = h.y + (e.y - h.y) * k;
    }
    return this.freePoint(x, y);
  }

  /** Nearest tile centre to (x, y) not covered by a building, farm or node (spiral search, ties by tile index). */
  freePoint(x: number, y: number): { x: number; y: number } {
    const blocked = this.blocked();
    const w = this.world.mapWidth;
    const h = this.world.mapHeight;
    const cx = Math.min(w - 2, Math.max(1, Math.floor(x)));
    const cy = Math.min(h - 2, Math.max(1, Math.floor(y)));
    for (let r = 0; r < 8; r++) {
      for (let ty = cy - r; ty <= cy + r; ty++) {
        for (let tx = cx - r; tx <= cx + r; tx++) {
          this.ops.n++;
          if (Math.max(Math.abs(tx - cx), Math.abs(ty - cy)) !== r) continue;
          if (tx < 1 || ty < 1 || tx >= w - 1 || ty >= h - 1) continue;
          if (blocked.isFree(tx, ty, 1, 0)) return { x: tx + 0.5, y: ty + 0.5 };
        }
      }
    }
    return { x: cx + 0.5, y: cy + 0.5 };
  }

  blocked(): Blocked {
    if (this.blockedGrid === null) {
      this.blockedGrid = blockedFromView(this.view);
      this.ops.n += this.view.nodes.length + this.view.buildings.length;
    }
    return this.blockedGrid;
  }

  /** A building site near `near` (default home), outside the farm ring, with a free lane around it. */
  baseSpot(type: BuildingId, minDist: number, near?: { x: number; y: number }, maxDist = 22): { tx: number; ty: number } | null {
    const h = near ?? this.home();
    const r = this.rally();
    return findSpot(
      { view: this.view, query: this.query, data: this.data, playerId: this.playerId, blocked: this.blocked(), ops: this.ops },
      {
        type,
        near: h,
        maxDist,
        gap: 1,
        score: (cx, cy) => {
          const d = dist(cx, cy, h.x, h.y);
          return d < minDist ? Infinity : d + 0.2 * dist(cx, cy, r.x, r.y);
        },
      },
    );
  }

  /** Villagers best placed to build at (cx, cy): idle first, then wood cutters, nearest. Skips claimed and builders. */
  pickBuilders(cx: number, cy: number, count: number): VillagerView[] {
    const scored: { v: VillagerView; score: number }[] = [];
    for (const v of this.view.villagers) {
      this.ops.n++;
      if (v.claimed || this.claimed.has(v.id) || v.task.kind === 'build' || v.task.kind === 'busy') continue;
      if (this.mem.defence.villagerIds.includes(v.id)) continue;
      let score = dist(v.x, v.y, cx, cy);
      if (v.task.kind === 'idle') score -= 4;
      else {
        if (v.carried > 0) score += 5;
        if (v.task.slot === 'gold' || v.task.slot === 'stone') score += 8;
        if (v.task.slot === 'berries' || v.task.slot === 'farm') score += 4;
      }
      scored.push({ v, score });
    }
    scored.sort((a, b) => a.score - b.score || a.v.id - b.v.id);
    return scored.slice(0, count).map((s) => s.v);
  }

  /** Order a building (pays from the stockpile, or from the military budget with `fromReserve`). Returns success. */
  construct(type: BuildingId, spot: { tx: number; ty: number } | null, builders: VillagerView[], fromReserve: boolean): boolean {
    if (spot === null || builders.length === 0) return false;
    const cost = this.cost(type);
    if (!this.canAfford(cost)) return false;
    this.pay(cost, fromReserve);
    this.emit({ type: 'build', unitIds: builders.map((b) => b.id).sort((a, b) => a - b), buildingType: type, tx: spot.tx, ty: spot.ty, queue: false });
    const size = this.data.building(type).footprint;
    this.blocked().mark(spot.tx, spot.ty, size);
    // Later layers (the economy's own placement) must see this site.
    this.view.buildings.push({
      id: -1,
      typeId: type,
      tx: spot.tx,
      ty: spot.ty,
      size,
      cx: spot.tx + size / 2,
      cy: spot.ty + size / 2,
      constructed: false,
      builders: builders.length,
      queueLength: 0,
      queuedTechs: [],
      dropOff: this.data.building(type).dropOff,
    });
    for (const b of builders) this.claim(b);
    return true;
  }

  /** Own buildings of a type (completed and foundations), plus sites ordered this decision. */
  countOf(type: string): number {
    let n = 0;
    for (const b of this.view.buildings) if (b.typeId === type) n++;
    return n;
  }
}
