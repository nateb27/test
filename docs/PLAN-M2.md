# RTS Game: Milestone 2 Plan (Combat and a Computer Opponent)

Status: plan only, no code written. Audience: the coding agents who build this and the orchestrator who assigns their work. Milestone 1 (`docs/PLAN.md`, rules as built in `docs/DESIGN.md`) is complete and is the baseline. Section numbers in this file are M2 numbers; "M1 x.y" refers to `docs/PLAN.md`.

Every agent reads sections 2 to 4 and its own work package in section 9. Those sections are written so that nothing else is needed.

## 1. What Milestone 2 is

M2 turns the economy sandbox into a game you can win or lose against the computer:

- **Combat.** Hit points; melee and ranged attacks with wind-up and cooldown; deterministic projectiles (arrow, stone, fire); two damage types and armour classes with bonus damage, so counters are clear; siege that is strong against buildings and helpless in melee; splash for the Siphonarios; unit death; building destruction leaving rubble; villagers repair buildings; Town Center defensive arrows.
- **Commands and behaviour.** Attack, attack-move, stop, hold position; two stances (aggressive, stand ground); automatic target acquisition; retaliation; leashing.
- **One computer opponent** at three difficulties (easy, standard, hard), built on the existing `EconomyBot`. It also plays Byzantines.
- **Win and lose.** A defeat rule (4.13), a Resign button, a match setup screen (difficulty, map seed, player colours) and an end screen with stats.
- **Two fair start positions** on the existing 120×120 grass map, point-symmetric with mirrored resources.
- **Military upgrades.** Two attack and two armour upgrades for each of infantry, archers and cavalry (12 techs).

### 1.1 Explicitly out of scope for M2

Fog of war, a second civilization, walls, gates, towers and any other new defensive building, garrisoning, healing and monks, formations beyond the existing group slots, patrol, naval, multiplayer, audio, new map types, tech-tree expansion beyond the 12 upgrades in 5.4, friendly fire, attack-ground, unit hard collision, villager auto-flee.

**No tower.** A simple defensive building is not essential. The Town Center's arrows (4.10) defend the economy at its centre, and the AI's defence logic (6.6) covers the rest. A tower would need a new voxel model, placement logic in the AI and its own balance pass, all for a mechanic that M3 (walls and towers) will redo anyway.

### 1.2 Decisions taken in this plan (one-line justifications)

| Topic | Decision | Why |
|---|---|---|
| Damage types | Two: `melee`, `pierce`. Each unit and building has `meleeArmor` and `pierceArmor` | Gives "arrows bounce off buildings and rams" with one extra number per def |
| Bonus damage | Added after armour; armour never reduces it | Counters stay legible: "+12 vs cavalry" means exactly that |
| Projectiles | A separate `state.projectiles` list, not entities | They are never selected, picked, pathed or counted. Keeping them out of `entities` keeps entity id allocation and every entity loop unchanged |
| Projectile hit rule | Homing: the projectile always hits if the target still exists on arrival | Misses on moving targets would make archers useless against anything walking towards them and add no decision for the player |
| Corpses and rubble | Client-only decals driven by events; never saved or hashed | Purely cosmetic. Putting them in state would inflate saves and hashes for no rules value |
| Spatial index | Uniform grid in `SimRuntime`, rebuilt from scratch every tick | Rebuilding is deterministic by construction and costs about 0.05 ms for 600 units. An incremental index is a desync risk |
| Simultaneous damage | Units at 0 hp still finish their actions in the tick they reach 0. Deaths are resolved once, in step 11 | Removes the advantage a low id would otherwise give in a duel |
| AI memory | Lives in the `src/bot` controller and is saved beside the state in the save file (`controllers`), never in `GameState` | The sim must never be written to by the AI. Replays do not need it, because the AI's commands are logged like the human's |
| AI randomness | Its own sfc32 stream, seeded from `seed` and `playerId`, stored in AI memory | The AI must not consume `state.rng`; it cannot write state |
| Town Center | Becomes buildable (Age 1, 275 wood, 100 stone, 150 s) | Makes the defeat rule's "can still build a Town Center" literal and allows comebacks. Age advances need a Town Center, so it must be available in Age 1 |
| Match modes | `sandbox` (1 player, M1 behaviour, `reachAge` objective) and `conquest` (2 players, defeat rule, `conquest` objective) | Old saves, the stress scene and every M1 test stay valid as sandbox |
| Setup option "No opponent" | Included (it creates a sandbox match) | Keeps the M1 e2e suite and the economy-learning path working |
| Player colour | Stored in `PlayerState.color`, chosen per slot; defaults blue (human) and red (AI) | Owner decision. The HUD stays in the civ's purple |

### 1.3 Pacing and performance targets (owner decisions, recorded here)

- The M1 bot thresholds (Township 6:30, Citadel 14:00, Empire 24:00 with the headless economy bot) remain as a regression test.
- The **hand-played** Township target is loosened to **7:30**. Record it in `docs/BALANCE.md`.
- Performance: 200 units per side fighting. Sim tick average under 4 ms, **p99 under 12 ms warm**. Cold-start ticks (the first 200 ticks of a run) are excluded. This replaces M1's "worst tick under 12 ms". 60 fps on a mid-range laptop at 1× zoom.

## 2. Architecture changes

### 2.1 What stays the same

Section 2 of M1 and the determinism rules in `CLAUDE.md` all still apply. In particular:

- `src/sim` changes only through `sim.step(commands)`.
- The client and the AI only read state and issue `Command`s.
- Entities are iterated in ascending id order, with ties broken by entity id and then tile index.
- No trig.
- Work budgets are counted in operations.
- Commands issued in tick T apply at the start of tick T+1.

The AI is subject to the same determinism lint as the sim (Phase 0 extends the rule set to `src/bot/**`).

### 2.2 Tick order (new; replaces CLAUDE.md rule 9)

| # | Step | Function (file) | Owner |
|---|---|---|---|
| 1 | Apply commands, sorted by `(playerId, seq)` | `applyCommands` (`systems/commands.ts`) | WP20 then core |
| 2 | Production and research | `runProduction` | M1 WP8 code |
| 3 | Passive income | `runIncome` | M1 |
| 4 | **Acquisition**: rebuild the spatial index; target scans for due units and buildings | `runAcquisition` (`systems/combat/acquire.ts`) | WP21 |
| 5 | Unit order state machines, ascending id (incl. attack, attackMove, hold, repair) | `runOrders` | M1 + WP21/WP24 |
| 6 | Pathfinding queue | `processPathQueue` | M1 |
| 7 | Movement and separation (idle units and stationary attackers) | `runMovement` | WP24 |
| 8 | **Attacks**: 8a unit swings (wind-up, release, melee damage, projectile spawn); 8b building volleys (Town Center) | `runUnitAttacks` (`systems/combat/attack.ts`), `runBuildingAttacks` (`systems/defence.ts`) | WP21, WP22 |
| 9 | **Projectiles**: advance and resolve impacts and splash | `runProjectiles` (`systems/projectiles.ts`) | WP22 |
| 10 | Construction (incl. construction HP) and **repair** | `runConstruction` (`systems/construct.ts`) | WP24 |
| 11 | **Death** (hp ≤ 0 becomes events, stats and `pendingRemoval`), then the existing cleanup | `runDeath` (`systems/death.ts`), `runCleanup` | WP23, M1 |
| 12 | **Outcome** (defeat, winner, destruction of defeated players' entities), then objectives | `runOutcome` (`systems/outcome.ts`), `runObjectives` | WP23 |
| 13 | `tick++` | `sim.ts` | core |

Notes:

- Damage dealt in steps 8 and 9 lowers `hp` immediately, clamped at 0. Every unit and building acts in steps 8 and 9 whatever its hp. Nothing is removed before step 11. Damage is a sum of integers, so the result does not depend on iteration order.
- Acquisition (4) reads end-of-previous-tick positions. Attacks (8) re-check reach against current positions. Spatial queries in steps 8 and 9 pad their radius by `SPATIAL_QUERY_PAD` (0.1 tile, more than the fastest movement per tick).
- `runOutcome` sets `hp = 0` on every entity of a newly defeated player. They die in step 11 of the next tick, so there is exactly one death path.

### 2.3 Spatial index

- Lives in `SimRuntime.spatial`. Never saved or hashed.
- Cells are `SPATIAL_CELL_SIZE` = 4 tiles (30×30 on the 120 map).
- Rebuilt at the start of step 4 each tick. Units are inserted in descending array order so that each cell's linked list runs in ascending id. Building ids are listed for every cell their footprint overlaps, in ascending order.
- Queries visit cells in ring order outward from the query cell (ring 0, then ring 1 in row-major order, and so on). They count one *check* per candidate looked at and stop at the caller's budget.
- Every consumer chooses its result by a total order (tier, squared distance, id), or applies an order-independent effect (splash damage). A different visiting order therefore never changes the result, except when a budget cuts the scan short. The budget is itself deterministic.

### 2.4 Projectiles

- `state.projectiles` is kept sorted by `id`, allocated from `state.nextProjectileId` (separate from entity ids).
- When fired, `flightTicks = max(1, ceil(dist * TICK_RATE / speed))` and `ticksLeft = flightTicks`.
- Each tick in step 9, while the target exists, `to` is set to its current anchor (unit `pos`, building footprint centre). Then `ticksLeft -= 1`. At 0 the projectile impacts and is removed.
- The renderer draws it at `lerp(from, to, 1 − (ticksLeft − alpha)/flightTicks)` plus a client-side arc. No trig in the sim.

### 2.5 Death, corpses, rubble

`runDeath` emits `UnitDied` and `BuildingDestroyed` with everything the client needs: type, owner, position, facing, footprint. The renderer's decal layer turns these into a one-shot death animation that is then held as a corpse, and into rubble. None of this is in state; after loading a save there are no corpses. Cleanup (M1) removes the entity, frees the footprint, bumps `occupancyVersion`, releases slots and recomputes population.

### 2.6 Players and matches

- `players[]` already supports N players. Player 0 is neutral. Enemies: `isEnemy(a, b) = a !== b && a !== 0 && b !== 0`. There are no teams in M2.
- `GameConfig.players[i]` gains `color`, `controller`, `difficulty` and `name`. These are copied into `PlayerState` at creation and never changed by the sim. They exist for the HUD, the end screen and Restart.
- `GameState.match` holds `mode`, `winner` and `endedTick`. The sim keeps running after the match ends: the winner may keep playing and the defeated may watch. Commands from a defeated player are rejected with `playerDefeated`.

### 2.7 The AI as a command source

- `src/bot` exports a `Controller` interface; `AiPlayer` implements it.
- `Match.tick()` runs `commands = human.drain()`, then `commands.push(...controller.update(sim))` for each AI, then `sim.step(commands)`. The sim cannot tell AI commands from human ones. `CommandRecorder` logs both, so replays need no AI.
- The AI stamps its own `playerId` and `seq`, as `EconomyBot` does. It never imports `src/client`. It reads only `sim.state` and `sim.query`, holds plain-JSON memory, and is saved through `controller.save()` into the save file's `controllers` block.
- Headless tests drive AIs the same way as `tests/sim/botHarness.ts` does.

### 2.8 Save format v2

The save file becomes canonical JSON of `{ version: 2, state, controllers }`. `MIGRATIONS[1]` upgrades v1 states (3.6). `hashState(state)` is unchanged and ignores `controllers`.

## 3. Contract changes (Phase 0 writes all of this; parallel packages build against it)

### 3.1 `src/sim/types.ts`: constants and small types

```ts
export const SAVE_VERSION = 2;

/** Units and buildings scan for targets at most once per this many ticks (staggered by id). */
export const ACQUIRE_INTERVAL_TICKS = 10;
/** Candidate checks one scan may spend. */
export const ACQUIRE_MAX_CHECKS_PER_SCAN = 128;
/** Candidate checks all scans of one tick may spend; a due unit over budget scans next tick. */
export const ACQUIRE_BUDGET_PER_TICK = 8000;
/** Spatial index cell side in tiles. */
export const SPATIAL_CELL_SIZE = 4;
/** Radius padding for spatial queries made after movement (steps 8-9). */
export const SPATIAL_QUERY_PAD = 0.1;
/** A chasing unit re-requests a path at most this often... */
export const CHASE_REPATH_TICKS = 10;
/** ...and only when the target has moved this far from the path's goal. */
export const CHASE_REPATH_DISTANCE = 1.5;
/** Within this distance and with a walkable straight segment, chase without A*. */
export const CHASE_DIRECT_DISTANCE = 3;
/** Stationary attackers push apart to this distance (idle units keep SEPARATION_RADIUS). */
export const COMBAT_SEPARATION_RADIUS = 0.45;
/** UnderAttack is emitted for a player at most once per this many ticks... */
export const ALERT_MIN_TICKS = 100;
/** ...unless the new damage is at least this far from the last alert. */
export const ALERT_MIN_DISTANCE = 12;

/** Selectable player colours, in setup-screen order. Human defaults to [0], AI to [1]. */
export const PLAYER_COLORS: readonly { id: string; name: string; value: number }[] = [
  { id: 'blue', name: 'Blue', value: 0x2f6bd8 },
  { id: 'red', name: 'Red', value: 0xc62f2f },
  { id: 'green', name: 'Green', value: 0x3a9a3a },
  { id: 'yellow', name: 'Yellow', value: 0xd8b42a },
  { id: 'teal', name: 'Teal', value: 0x22a3a3 },
  { id: 'orange', name: 'Orange', value: 0xe0781f },
];

export type Stance = 'aggressive' | 'standGround';
export type AiDifficulty = 'easy' | 'standard' | 'hard';
export type PlayerController = 'neutral' | 'human' | 'ai';
export type PlayerOutcome = 'playing' | 'won' | 'defeated';
export type MatchMode = 'sandbox' | 'conquest';
export type ProjectileKind = 'arrow' | 'stone' | 'fire';
export type AttackType = 'melee' | 'pierce';
/** Bonus-damage classes. A def lists the classes it belongs to. */
export type ArmorClass = 'villager' | 'infantry' | 'spear' | 'archer' | 'cavalry' | 'siege' | 'building';

/** Plain JSON, for opaque blobs such as AI memory. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
```

### 3.2 State

```ts
export interface GameState {
  // ...all M1 fields unchanged...
  /** In-flight projectiles, sorted by id. */
  projectiles: Projectile[];
  /** Next projectile id (separate from entity ids). Starts at 1. */
  nextProjectileId: number;
  match: MatchState;
}

export interface MatchState {
  mode: MatchMode;
  /** Set when the match ends with a winner; null otherwise (also on a draw). */
  winner: PlayerId | null;
  /** Tick (state.tick + 1 of the deciding tick) the match ended, or null while running / in sandbox. */
  endedTick: number | null;
}

export interface PlayerStats {
  unitsTrained: number;
  unitsLost: number;
  unitsKilled: number;
  buildingsBuilt: number;     // completed constructions (not the starting Town Center)
  buildingsLost: number;
  buildingsDestroyed: number;
  /** Deposited at drop-offs plus passive income. Integers. */
  resourcesGathered: ResourceAmounts;
  techsResearched: number;    // age advances included
  peakPopulation: number;
  /** Tick each age was reached; index = age - 1; [0] is 0, unreached ages are null. */
  ageReachedTick: (number | null)[];
}

export interface PlayerState {
  // ...M1 fields unchanged (color now comes from the slot, not the civ)...
  name: string;
  controller: PlayerController;
  difficulty: AiDifficulty | null;
  outcome: PlayerOutcome;
  defeatedTick: number | null;
  stats: PlayerStats;
  /** Last UnderAttack alert emitted for this player, for throttling. */
  alert: { tick: number; x: number; y: number } | null;
}

export interface UnitCombatState {
  /** Ticks until the unit may start another attack (0 = ready). */
  cooldown: number;
  /** > 0 while winding up: ticks left until release. */
  windup: number;
  /** Target fixed when the wind-up started, or null. */
  swingTargetId: EntityId | null;
  /** First tick on which the acquisition step may scan for this unit. */
  nextScanTick: number;
  /** Tick of the last release (renderer hit effects and attack animation), or null. */
  lastAttackTick: number | null;
}

export interface UnitEntity {
  // ...M1 fields...
  /** Integer, 0..max resolved hp. 0 means dead this tick (removed in step 11). */
  hp: number;
  stance: Stance;
  combat: UnitCombatState;
  /** Last enemy entity that damaged this unit (retaliation, kill credit), or null. */
  lastAttackerId: EntityId | null;
  lastDamagedTick: number | null;
}

export interface BuildingAttackState {
  cooldown: number;
  targetId: EntityId | null;
  nextScanTick: number;
  lastAttackTick: number | null;
}

export interface BuildingEntity {
  // ...M1 fields...
  hp: number;
  /** HP granted by construction so far (see 4.11); equals max hp once constructed. */
  builtHp: number;
  /** Non-null exactly when the def has `combat.attack` (Town Center). */
  attack: BuildingAttackState | null;
  lastAttackerId: EntityId | null;
  lastDamagedTick: number | null;
  /** Villagers in the `repairing` phase on it (ascending), pruned each tick like builderIds. */
  repairerIds: EntityId[];
  /** Fraction of the next whole hp of repair, [0, 1). */
  repairAccumulator: number;
  /** Fraction of the next whole resource owed for repair, each in [0, 1). */
  repairCostAccumulator: ResourceAmounts;
}

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  owner: PlayerId;
  /** Shooter id (may have died since) and def (stats for splash are resolved from it at impact). */
  sourceId: EntityId;
  sourceType: UnitId | BuildingId;
  targetId: EntityId;
  from: Vec2;
  /** Target anchor, updated every tick while the target exists, frozen after. */
  to: Vec2;
  flightTicks: number;
  ticksLeft: number;
  /** Damage to the primary target, computed at fire time (integer >= 1). */
  damage: number;
}
```

`ObjectiveKind` becomes `'reachAge' | 'conquest'`, and `ObjectiveEntry.targetAge` becomes `AgeNumber | null` (null for `conquest`).

### 3.3 Orders

```ts
/** Attack one entity. `auto` = created by acquisition (leashed, stance-dependent), not by a command. */
export interface AttackOrder { type: 'attack'; targetId: EntityId; auto: boolean }
export interface AttackOrderState extends AttackOrder {
  phase: 'start' | 'chasing' | 'attacking';
  /** Where an auto engagement began (leash centre); null for commanded attacks. */
  anchor: Vec2 | null;
  /** Earliest tick for the next chase re-path. */
  repathTick: number;
}

/** Walk to a point, engaging enemies met on the way, then continue. */
export interface AttackMoveOrder { type: 'attackMove'; x: number; y: number }
export interface AttackMoveOrderState extends AttackMoveOrder {
  phase: 'start' | 'walking' | 'engaging';
  targetId: EntityId | null;
  anchor: Vec2 | null;
  repathTick: number;
}

/** Never move; attack whatever is in reach. Lasts until replaced. */
export interface HoldOrder { type: 'hold' }
export interface HoldOrderState extends HoldOrder { phase: 'holding'; targetId: EntityId | null }

/** Repair an own completed, damaged building. */
export interface RepairOrder { type: 'repair'; buildingId: EntityId }
export interface RepairOrderState extends RepairOrder { phase: 'start' | 'toSite' | 'repairing' }

export type Order = MoveOrder | GatherOrder | BuildOrder | AssistOrder | DropOffOrder
  | AttackOrder | AttackMoveOrder | HoldOrder | RepairOrder;
export type OrderState = MoveOrderState | GatherOrderState | BuildOrderState | AssistOrderState
  | DropOffOrderState | AttackOrderState | AttackMoveOrderState | HoldOrderState | RepairOrderState;
```

### 3.4 Commands, rejections, events

```ts
export interface AttackCommand extends CommandBase { type: 'attack'; unitIds: EntityId[]; targetId: EntityId; queue: boolean }
export interface AttackMoveCommand extends CommandBase { type: 'attackMove'; unitIds: EntityId[]; x: number; y: number; queue: boolean }
export interface HoldCommand extends CommandBase { type: 'hold'; unitIds: EntityId[] }
export interface SetStanceCommand extends CommandBase { type: 'setStance'; unitIds: EntityId[]; stance: Stance }
export interface RepairCommand extends CommandBase { type: 'repair'; unitIds: EntityId[]; buildingId: EntityId; queue: boolean }
export interface ResignCommand extends CommandBase { type: 'resign' }

export type CheatAction =
  | { kind: 'addResources'; amounts: Partial<ResourceAmounts> }
  | { kind: 'instantBuild'; enabled: boolean }
  | { kind: 'instantResearch'; enabled: boolean }
  /** `owner` defaults to the issuing player (lets e2e tests spawn enemies). */
  | { kind: 'spawnUnit'; unitType: UnitId; x: number; y: number; owner?: PlayerId }
  /** Set an entity's hp (clamped to 0..max); 0 kills it in step 11. */
  | { kind: 'setHp'; entityId: EntityId; hp: number }
  /** Mark a player defeated as if conquered. */
  | { kind: 'defeat'; playerId: PlayerId };

export type Command = /* M1 members */ | AttackCommand | AttackMoveCommand | HoldCommand
  | SetStanceCommand | RepairCommand | ResignCommand;

export type RejectReason = /* M1 members */ | 'playerDefeated';

export interface UnitDiedEvent {
  type: 'UnitDied'; playerId: PlayerId; unitId: EntityId; unitType: UnitId;
  x: number; y: number; facing: Facing; killerPlayerId: PlayerId | null;
}
export interface BuildingDestroyedEvent {
  type: 'BuildingDestroyed'; playerId: PlayerId; buildingId: EntityId; buildingType: BuildingId;
  tx: number; ty: number; size: number; constructed: boolean; killerPlayerId: PlayerId | null;
}
export interface UnderAttackEvent {
  type: 'UnderAttack'; playerId: PlayerId; entityId: EntityId; entityKind: 'unit' | 'building';
  /** Town Center hit (HUD wording). */ townCenter: boolean; x: number; y: number; attackerPlayerId: PlayerId;
}
export interface PlayerDefeatedEvent { type: 'PlayerDefeated'; playerId: PlayerId; reason: 'conquered' | 'resigned' }
export interface MatchEndedEvent { type: 'MatchEnded'; winner: PlayerId | null; tick: number }

export type SimEvent = /* M1 members */ | UnitDiedEvent | BuildingDestroyedEvent | UnderAttackEvent
  | PlayerDefeatedEvent | MatchEndedEvent;
```

Shape validation (`isCommandShapeValid`, Phase 0):

- `attack` needs an id list, `targetId` an id, and `queue` a boolean.
- `attackMove` is like `move`.
- `hold` needs an id list.
- `setStance` needs an id list and a stance in the union.
- `repair` is like `assist`.
- `resign` has no fields.
- Cheat `setHp` needs an id and a finite `hp`. Cheat `defeat` needs an integer `playerId` in 1..n. If `owner` is present on `spawnUnit`, it must be an integer in 1..n.

Command handler table (Phase 0 adds the entries with `STUB` bodies that reject `invalidCommand`, matching the M1 pattern):

```ts
attack: applyAttackCommand,         // orders/attack.ts (WP21)
attackMove: applyAttackMoveCommand, // orders/attackMove.ts (WP21)
hold: applyHoldCommand,             // orders/hold.ts (WP21)
setStance: applySetStanceCommand,   // combat/stance.ts (WP21)
repair: applyRepairCommand,         // orders/repair.ts (WP24)
resign: applyResignCommand,         // outcome.ts (WP23)
```

`applyCommands` (Phase 0, real): before dispatch, any command from a player whose `outcome === 'defeated'` is rejected with `playerDefeated`, except `cheat`. (Corrected in Phase 0: the winner, `outcome: 'won'`, keeps playing per 2.6.)

### 3.5 Config, runtime, public API, shared signatures

```ts
export interface PlayerConfig {
  civ: CivId;
  /** Default PLAYER_COLORS[slotIndex].value (slot 0 blue, slot 1 red, ...). */
  color?: number;
  /** Default 'human' for slot 0, 'ai' for others if difficulty is set, else 'human'. */
  controller?: 'human' | 'ai';
  /** An AI slot without one plays 'standard'; ignored (null in PlayerState) for human slots. */
  difficulty?: AiDifficulty;
  /** Default 'Player' (slot 0), 'Player N' (other human slots), 'Computer (Standard)' etc. (AI slots). */
  name?: string;
}
export interface GameConfig {
  seed: number;
  mapSize: number;
  players: PlayerConfig[];
  /** Default: 'conquest' with exactly 2 players, else 'sandbox'. */
  mode?: MatchMode;
}

export interface SimRuntime {
  occupancy: Uint8Array;
  resolvedStats: Record<DefId, Partial<Record<StatKey, number>>>[];
  pendingRemoval: EntityId[];
  /** Resolved combat profiles per player and def, rebuilt with resolvedStats. */
  combat: Record<DefId, ResolvedUnitCombat | ResolvedBuildingCombat>[];
  /** Rebuilt every tick in step 4. */
  spatial: SpatialIndex;
  /** Check budget left this tick (reset in step 4). */
  acquireBudget: number;
}

export interface ResolvedUnitCombat {
  kind: 'unit';
  maxHp: number; attack: number; attackType: AttackType;
  meleeArmor: number; pierceArmor: number;
  range: number; minRange: number;
  /** range + CombatRules.reach: centre-to-target-edge distance at which attacks connect. */
  reach: number;
  windupTicks: number;   // max(1, round(windup * TICK_RATE))
  cooldownTicks: number; // max(windupTicks + 1, round(cooldown * TICK_RATE))
  sight: number;
  classes: readonly ArmorClass[];
  bonus: Readonly<Partial<Record<ArmorClass, number>>>;
  bonusResist: number;
  projectile: ProjectileKind | null;
  splash: { radius: number; percent: number } | null;
  targets: 'any' | 'buildings';
  autoAcquire: boolean;
}
export interface ResolvedBuildingCombat {
  kind: 'building';
  maxHp: number; meleeArmor: number; pierceArmor: number;
  bonusResist: number;              // always 0 (added in Phase 0 so a building profile can be passed to computeDamage)
  classes: readonly ArmorClass[];   // always ['building']
  attack: { attack: number; attackType: AttackType; range: number; reach: number;
            cooldownTicks: number; arrows: number; projectile: ProjectileKind } | null;
}

export interface SpatialIndex {
  cellSize: number; cols: number; rows: number;
  /** Per cell: index into `units` of the first unit, -1 if none; linked via `unitNext` in ascending id. */
  unitHead: Int32Array; unitNext: Int32Array; units: UnitEntity[];
  /** Per cell: ids of buildings whose footprint overlaps the cell, ascending. */
  buildingCells: EntityId[][];
}

// StatKey: remove 'armor', add 'meleeArmor' | 'pierceArmor'. Units resolve hp, attack, meleeArmor,
// pierceArmor, range; buildings hp, meleeArmor, pierceArmor (+ attack, range with an attack).
// Combat stats are rounded with Math.round after resolution, like costs.
```

Shared plumbing. Phase 0 implements these for real in `src/sim/systems/combat/damage.ts`; WP21 owns the file afterwards.

```ts
export function isEnemy(a: PlayerId, b: PlayerId): boolean;
export function unitCombat(ctx: SimContext, owner: PlayerId, typeId: UnitId): ResolvedUnitCombat;
export function buildingCombat(ctx: SimContext, owner: PlayerId, typeId: BuildingId): ResolvedBuildingCombat;
/** Formula of 4.1. Pure; integers in, integer >= minDamage (+bonus) out. */
export function computeDamage(att: { attack: number; attackType: AttackType;
  bonus: Readonly<Partial<Record<ArmorClass, number>>> },
  def: { meleeArmor: number; pierceArmor: number; classes: readonly ArmorClass[]; bonusResist: number },
  minDamage: number): number;
/** hp -= amount (clamped at 0); sets lastAttackerId only if hp was > 0; lastDamagedTick; UnderAttack throttle;
 *  retaliation wake-up (attacked idle aggressive military: combat.nextScanTick = tick + 1). */
export function applyDamage(ctx: SimContext, target: UnitEntity | BuildingEntity, amount: number,
  attacker: { id: EntityId; owner: PlayerId }): void;
/** Squared distance from a point to a target: unit centre, or nearest point of a building footprint. */
export function distSqToTarget(ctx: SimContext, x: number, y: number, target: Entity): number;
```

Other stubs Phase 0 creates (signature fixed, body `STUB`):

- `spawnProjectile(ctx, spec: Omit<Projectile, 'id' | 'ticksLeft'>): void` in `systems/projectiles.ts`. Phase 0 implements it for real: allocate an id and push.
- `rebuildSpatialIndex(ctx)`, `visitUnitsNear(ctx, x, y, r, budget, visit)`, `visitBuildingsNear(...)` in `combat/spatial.ts`. These return checks used; `visit` returns `true` to stop.
- `directPath(ctx, unit, x, y): boolean` in `path/follow.ts`. It sets a one-waypoint path if the straight segment is walkable.
- `recordStat(ctx, playerId, mutate)` in `systems/matchStats.ts`. Phase 0 implements it for real and calls it from the existing systems: production spawn (unitsTrained), construction complete (buildingsBuilt), drop-off deposit and income (resourcesGathered), research complete (techsResearched, ageReachedTick), population recompute (peakPopulation).

Entity creation (`entities.ts`, Phase 0). `createUnit(state, typeId, owner, x, y, facing?, maxHp?)` and `createBuilding(state, typeId, owner, tx, ty, constructed, costPaid?, data?, maxHp?)` keep their M1 leading parameters; `maxHp` defaults to the def's base hp and `data` to the game registry, and systems pass the resolved max (`unitCombat(ctx, ...).maxHp`):

- **New unit:** `hp` = resolved max. `stance: 'aggressive'`. `combat = { cooldown: 0, windup: 0, swingTargetId: null, nextScanTick: tick + id % ACQUIRE_INTERVAL_TICKS, lastAttackTick: null }`. Attacker fields are null.
- **New foundation:** `hp = builtHp = max(1, floor(maxHp * constructionStartPercent / 100))`.
- **Pre-placed completed building** (starting Town Center): `hp = builtHp = maxHp`.
- **Buildings in general:** `attack` is non-null exactly for defs with an attack. Repair fields start at zero.

Public API additions:

```ts
// src/sim/index.ts additionally exports:
export { createRng, rngInt, rngRange } from './rng';   // pure functions on a caller-owned RngState (AI)
export { deserializeSave } from './serialize';
export type { ControllerSave, LoadedSave } from './serialize';

export interface ControllerSave { playerId: PlayerId; kind: 'ai'; difficulty: AiDifficulty; memory: JsonValue }
export interface LoadedSave { sim: Sim; controllers: ControllerSave[] }
export function serialize(sim: Sim, controllers?: readonly ControllerSave[]): string;  // v2 file
export function deserialize(json: string): Sim;            // unchanged; ignores controllers
export function deserializeSave(json: string): LoadedSave;  // v1 files give controllers: []
```

### 3.6 Save v2 and the v1 → v2 migration

The file is `{ version: 2, state: GameState, controllers: ControllerSave[] }`. `MIGRATIONS[1](state)` (Phase 0) does the following.

On the state:

- Add `projectiles: []` and `nextProjectileId: 1`.
- Add `match: { mode: 'sandbox', winner: null, endedTick: null }`.

On each player:

- `name`: `'Neutral'` for player 0, `'Player'` for 1, `'Player N'` for others.
- `controller`: `'neutral'` for player 0, `'human'` for the rest.
- `difficulty: null`, `outcome: 'playing'`, `defeatedTick: null`, `alert: null`.
- `stats`: all counters 0, `ageReachedTick = [0, null, null, null]` with reached ages filled with the save's `tick` (unknown, so approximated), and `peakPopulation = popUsed`.

On each unit:

- `hp` = the def's `combat.hp`. No hp modifiers exist.
- `stance: 'aggressive'`.
- `combat` as for a new unit, with `nextScanTick = tick + id % 10`.
- Attacker fields null.

On each building:

- `hp = builtHp` (v1 buildings have no hp field). For completed buildings this is max hp. For unfinished ones it is `max(1, floor(maxHp * (s + (100 − s) * progress) / 100))` with `s = constructionStartPercent`.
- `attack`: `{ cooldown: 0, targetId: null, nextScanTick: tick + id % 10, lastAttackTick: null }` for Town Centers, null otherwise.
- `repairerIds: []`, accumulators 0.

Objectives: entries are unchanged (`targetAge` stays).

Controllers: `[]`.

The structural check (`serialize.ts`) is extended to cover:

- hp integer in 0..max;
- stance and enum values;
- projectile ids ascending, below `nextProjectileId`, with integer ticks and finite vectors;
- `repairerIds` referencing existing units;
- `match.winner` either null or a real player.

Fixtures:

- `tests/sim/fixtures/save-v1.json` is kept and must load through the migration.
- `save-v1-as-v2.json` is the committed byte-exact result of re-serialising it.
- `save-v2.json` is a 48×48 conquest mid-battle save (projectiles in flight, a damaged building under repair, a dead-this-tick unit, AI controller memory). It must round-trip byte for byte, and 200 continued ticks must equal the uninterrupted run.

### 3.7 `src/data/schema.ts`

```ts
export type { ArmorClass, AttackType, ProjectileKind, Stance } from '../sim/types';

export interface UnitCombatStats {
  hp: number;
  attack: number;
  attackType: AttackType;
  meleeArmor: number;
  pierceArmor: number;
  /** Tiles; 0 = melee. */
  range: number;
  /** Tiles; 0 = none. */
  minRange: number;
  /** Seconds from starting an attack to its release. */
  windup: number;
  /** Seconds between the starts of two attacks; > windup. */
  cooldown: number;
  /** Acquisition radius in tiles. */
  sight: number;
  classes: ArmorClass[];
  bonus: Partial<Record<ArmorClass, number>>;
  /** Percent (0-100) of incoming bonus damage ignored. */
  bonusResist: number;
  projectile: ProjectileKind | null;
  splash: { radius: number; percent: number } | null;
  targets: 'any' | 'buildings';
  /** Acquires targets on its own (military). Villagers: false. */
  autoAcquire: boolean;
}

export interface BuildingAttackStats {
  attack: number; attackType: AttackType; range: number; cooldown: number; arrows: number; projectile: ProjectileKind;
}
export interface BuildingCombatStats { hp: number; meleeArmor: number; pierceArmor: number; attack?: BuildingAttackStats }

/** Engine-wide combat tunables (balance numbers live in data). */
export interface CombatRules {
  reach: number;                       // 0.75
  meleeReleaseSlack: number;           // 0.5
  minDamage: number;                   // 1
  leashRadius: number;                 // 10
  retaliateRadius: number;             // 10
  projectileSpeed: Record<ProjectileKind, number>; // tiles/s
  constructionStartPercent: number;    // 10
  repairRateFactor: number;            // 0.25
  repairMinHpPerSecond: number;        // 2
  repairCostPercent: number;           // 50
}

// Tag gains 'militaryTech'. UnitDef.combat: UnitCombatStats. BuildingDef.combat: BuildingCombatStats.
// DataRegistry and RegistryTables gain `readonly combat: CombatRules` (file src/data/combat.ts).
```

### 3.8 Client contracts

`AssetManifest` (`src/client/art/manifest.ts`):

```ts
export type UnitAnimState = 'idle' | 'walk' | 'work' | 'carry' | 'attack' | 'death';
export type BuildingStage = 'foundation' | 'scaffold' | 'complete';
export type SpriteState = UnitAnimState | BuildingStage | 'default';

/** Fallback when an asset lacks a state (applied by the renderer, not the asset). */
export const UNIT_STATE_FALLBACK: Readonly<Record<UnitAnimState, UnitAnimState | null>> =
  { idle: null, walk: 'idle', work: 'idle', carry: 'walk', attack: 'idle', death: null };

export interface SpriteAnimation {
  // ...M1 fields...
  /** false = play once and hold the last frame (death). Default true. */
  readonly loop?: boolean;
  /** For `attack`: index of the frame on which the blow lands (synchronised with the release tick). */
  readonly hitFrame?: number;
}

export interface AssetManifest {
  // ...M1 members...
  /** Promoted from TeamAssetManifest: world sprite recoloured through the player-colour ramp. Never throws. */
  teamSprite(id: SpriteId, primary: number, secondary: number): SpriteAsset;
}
```

Required sprite ids in M2. A missing one falls back to the procedural art, so nothing throws.

| Id | States | Notes |
|---|---|---|
| `unit.<id>` (10 units) | idle, walk, work (villager), carry (villager, optional), attack (with `hitFrame`), death (`loop: false`) | 8 facings; team cloth as ramp levels; provided by the Blender sprite-sheet manifest when present, procedural fallback otherwise |
| `node.tree` | default, variants | Blender sheets when present |
| `projectile.arrow`, `projectile.stone`, `projectile.fire` | default | The client rotates the arrow |
| `fx.hit`, `fx.dust`, `fx.splash` | default, `loop: false` | Melee hit and arrow impact; stone impact and collapse; fire splash |
| `fx.fireSmall`, `fx.fireLarge`, `fx.smoke` | default, looping | Damage overlays |
| `rubble.2`, `rubble.3`, `rubble.4` | default, 2 variants | Destroyed buildings by footprint |
| `icon.command.attackMove`, `.hold`, `.aggressive`, `.standGround`, `.repair`; `icon.stat.attack`, `.meleeArmor`, `.pierceArmor`, `.range`; `icon.alert`; `icon.tech.<id>` for the 12 upgrades | icons | |

`WorldRendererApi` gains:

- `pushEvents(events: readonly SimEvent[]): void`, which feeds the decal and effect layer;
- `effectStats(): { projectiles: number; corpses: number; rubble: number; fires: number; effects: number }`.

`HudViewModel` (`src/client/ui/viewModel.ts`):

```ts
export interface TopBarVM { /* ... */ idleMilitary: number; playerColor: number }
export interface CombatStatsVM {
  attack: number; attackType: AttackType; range: number;
  meleeArmor: number; pierceArmor: number;
  /** e.g. ['+12 vs cavalry']. */ bonuses: string[];
  /** Town Center: 'Fires 2 arrows'. */ note: string | null;
}
export interface SingleSelectionVM {
  /* ... hp now real: { current: entity.hp, max: resolved } ... */
  ownerName: string;
  combat: CombatStatsVM | null;
  stance: Stance | null;          // own units with autoAcquire
  repairing: boolean;             // building has repairers
}
export type CardAction = /* M1 */ | { type: 'attackMove' } | { type: 'hold' }
  | { type: 'stance'; stance: Stance } | { type: 'repair' };
export interface CardButtonVM { /* ... */ active?: boolean }   // current stance highlighted
export interface EndScreenVM {
  result: 'victory' | 'defeat' | 'draw';
  reason: 'conquest' | 'resigned' | 'opponentResigned';
  clockSeconds: number;
  players: { playerId: PlayerId; name: string; color: number; you: boolean; outcome: PlayerOutcome; stats: PlayerStats }[];
}
export interface HudViewModel { /* ... */ endScreen: EndScreenVM | null; resignConfirmOpen: boolean }
export type BannerVM['kind'] = 'ageAdvanced' | 'objective' | 'defeated';
```

`GameDebugHook` additions (dev and e2e builds):

```ts
readonly localPlayerId: PlayerId;
match(): { mode: MatchMode; winner: PlayerId | null; endedTick: number | null } | null;
readonly ai: { setEnabled(on: boolean): void; enabled(): boolean; memory(playerId: PlayerId): JsonValue | null };
cheat: { /* M1 */ spawnUnit(unitType: UnitId, x: number, y: number, owner?: PlayerId): void;
         setHp(entityId: EntityId, hp: number): void; defeat(playerId: PlayerId): void };
startBattle(seed?: number, perSide?: number): void;   // 8.4 scenario through the loading screen
endScreen(): EndScreenVM | null;
alerts(): { x: number; y: number; tick: number }[];   // live minimap pings
effects(): ReturnType<WorldRendererApi['effectStats']>;
cursor(): 'default' | 'attack' | 'attackMove' | 'repair';
```

URL parameters (dev and e2e only, read in `app/seed.ts`):

- `?opponent=none|easy|standard|hard` sets the setup default; e2e default is `none`.
- `?ai=off` means the AI slot exists but issues nothing.
- `?color=<id>` sets the human colour.

## 4. Rules

### 4.1 Damage

All inputs are resolved integers (combat stats are `Math.round`ed when resolved).

```
armor    = attackType === 'melee' ? target.meleeArmor : target.pierceArmor
bonusRaw = Σ over c in target.classes of attacker.bonus[c] ?? 0
bonus    = floor(bonusRaw * (100 - target.bonusResist) / 100)          // buildings: bonusResist 0
damage   = max(rules.minDamage, attack - armor) + bonus
```

- Splash damage to each secondary target is `max(1, floor(damageVs(thatTarget) * percent / 100))`.
- Projectile primary damage is computed at fire time.
- hp is an integer and is clamped at 0.

### 4.2 Reach and range; no line of sight

- `d² = distSqToTarget(attacker.pos, target)`. For a unit target this is the distance to its centre. For a building it is the distance to the nearest point of the footprint rectangle `[tx, tx+size] × [ty, ty+size]`.
- The target is in reach iff `d² ≤ reach²` (`reach = range + rules.reach`, 0.75 base) and, if `minRange > 0`, `d² ≥ minRange²`.
- There is no line-of-sight blocking. The map is open; trees and buildings do not block shots.
- A unit can never target itself, allies, neutral nodes, or entities with `hp = 0`. Units with `targets: 'buildings'` cannot target units.

### 4.3 Attack timing

Step 8a runs per unit in ascending id order:

1. If `cooldown > 0`, then `cooldown -= 1`.
2. If `windup > 0`:
   - `windup -= 1`.
   - At 0, **release**:
     - Melee: if `swingTargetId` exists and is within `reach + meleeReleaseSlack`, call `applyDamage`. Otherwise the blow is wasted.
     - Ranged: if the target exists, call `spawnProjectile`.
   - Then `cooldown = cooldownTicks − windupTicks` and `lastAttackTick = state.tick`.
3. Otherwise, if `cooldown === 0` and the unit's current order is an engagement in phase `attacking` whose target is in reach: `windup = windupTicks`, `swingTargetId = target`, and facing is set towards the target with `facingFromDelta`.

Attacks therefore land `windupTicks` after the swing starts and repeat exactly every `cooldownTicks`. A started wind-up always completes, even if the unit is given a new order. A unit does not move while `windup > 0`.

### 4.4 Projectiles

- Speeds: arrow 9, stone 6, fire 8 tiles/s.
- The source point is the shooter's position (unit) or the footprint centre (Town Center).
- Homing as in 2.4. On impact:
  - if the target exists, it takes `damage` through `applyDamage` (credited to `sourceId`/`owner`, even if the shooter has died);
  - splash (fire only) then hits every enemy unit and building of the owner within `splash.radius` of `to` (unit centre or footprint distance), excluding the primary target, using the source def's resolved stats at impact. This happens even if the primary target is gone.
- There is no friendly fire.

### 4.5 Stances, orders and acquisition

| Situation | Aggressive | Stand ground |
|---|---|---|
| Idle, `autoAcquire` units | Scans within `sight`; on a target gets `attack{auto:true}`, chases up to the leash | Scans within `reach` only; attacks without moving; never chases |
| Hit by an enemy while idle | Retaliates if the attacker is within `retaliateRadius` (10), even beyond sight | Retaliates only if the attacker is in reach |
| `move` order | Does not scan (a pure move ignores enemies) | Same |
| `attackMove` | Scans within `sight` while walking; engages (leash 10 from where it engaged); resumes the walk when the target dies or the leash breaks | Same as aggressive (the explicit order wins) |
| `hold` | Never moves; attacks the best target in reach; re-scans each interval | Same |
| `attack` (commanded) | Chases the target anywhere until it dies; no leash, no retarget | Same |

- Villagers (`autoAcquire: false`) never scan or retaliate; they only attack on command.
- Siege units (`targets: 'buildings'`) scan for buildings only.

**Scans.** A unit is due when `state.tick >= combat.nextScanTick` and it is in a scanning situation from the table. After a scan, `nextScanTick = tick + ACQUIRE_INTERVAL_TICKS`. A due unit that finds `runtime.acquireBudget` exhausted keeps its `nextScanTick` and scans the next tick. Each scan spends at most `ACQUIRE_MAX_CHECKS_PER_SCAN`.

**Target priority**, lowest first; then `d²`, then id:

| Tier | Candidates |
|---|---|
| 0 | `lastAttackerId`, if valid and within the retaliation rule |
| 1 | Enemy units with `autoAcquire` and `targets: 'any'` (fighting units) |
| 2 | Other enemy units (villagers, siege) |
| 3 | Enemy buildings (foundations included) that are not hardened |
| 4 | Hardened enemy buildings (below) |

Siege uses only tiers 3 and 4 (it is never hardened against, so in practice tier 3).

**Hardened targets** (WP33). A building is *hardened* against a unit when the unit's damage per blow against it (4.1) is at most `rules.minDamage`: its armour of the unit's attack type is at least the unit's attack and the unit has no bonus against it (with the M2 data: infantry, cavalry and archers against production buildings and the Town Center; never siege, Cataphracts or Siphonarioi). Automatic target choice (acquisition, retaliation, retargeting, hold; not commanded `attack` orders) treats it as follows:

- it is tier 4, below every unit and every other building, so it is chosen only when nothing else is in the scan radius;
- it is never the tier-0 last attacker (a unit hit by Town Center arrows does not retaliate against the Town Center);
- it is no candidate at all for an `attackMove` that is still walking (the army walks on past a Town Center and fights the units it meets; once it has arrived and is idle, tier 4 applies);
- a unit whose auto, attack-move or hold engagement targets a hardened building rescans every interval (within sight; reach for stand ground and hold), whether or not the building is in reach, and switches to any candidate of tier 3 or lower.

**Retargeting** (auto engagements and attack-move engagements only): on each scan, if the current target is not in reach and a candidate of equal or lower tier is in reach, switch to it.

### 4.6 Chasing and leash

The engagement helper is shared by `attack`, `attackMove` and `hold`, in `combat/engage.ts`.

- **In reach:** the phase is `attacking`; the path is cleared and the unit stands.
- **Out of reach:** the phase is `chasing`. Stand-ground auto engagements and holds instead end or keep scanning.
  - For a building target: `followPath` to the footprint.
  - For a unit target within `CHASE_DIRECT_DISTANCE` (3) and with a walkable straight segment: `directPath` towards it.
  - Otherwise: a point-goal path to the target's position. It is re-requested only when the target is more than `CHASE_REPATH_DISTANCE` (1.5) from the path goal and `tick ≥ repathTick` (then `repathTick = tick + 10`).
- **Leash:** an auto or attack-move engagement whose target is more than `leashRadius` (10) from `anchor` ends. An auto engagement is replaced by `move` back to the anchor; attack-move returns to `walking`.
- **Target dead or gone:** the order is `done` (attack-move returns to `walking`) and `nextScanTick = tick + 1`.

### 4.7 Separation in combat

Units that are stationary and engaged (phase `attacking`, no path, no pending request) are included in the existing separation pass with radius `COMBAT_SEPARATION_RADIUS` (0.45) against each other and against idle units. Moving units still pass through each other. Hard collision is deferred to M3. Pushes never end on blocked tiles; this is the M1 rule.

### 4.8 Commands

All are all-or-nothing, using `validateOwnUnits`; the first failing id in ascending order decides the reject reason.

| Command | Accepted when | Otherwise |
|---|---|---|
| `attack` | Target exists, `isEnemy`, hp > 0; every unit can target it (siege: buildings only) | `unknownEntity`; `invalidTarget` (own, neutral, node); `cannotPerform` (a unit cannot target it) |
| `attackMove` | Finite point inside the map. The point is expanded into group slots exactly like `move` | `invalidCommand` |
| `hold` | Units exist | — |
| `setStance` | Units exist. Changing stance does not change the current order | — |
| `repair` | Own completed building with hp < max; every unit can build that building type (`builds` contains it) | `invalidTarget` (full hp, unfinished, foreign, not a building); `cannotPerform` |
| `resign` | Player is `playing` | `playerDefeated` |

The client splits mixed selections (8.1), so these strict rules never bite in normal play.

### 4.9 Death and destruction

In step 11, each unit with `hp = 0`:

- emits `UnitDied` (`killerPlayerId` = owner of `lastAttackerId` if that entity exists, else from a still-flying projectile's owner, else null);
- updates stats: owner `unitsLost`, killer `unitsKilled`;
- is added to `pendingRemoval`. Carried resources are lost.

Each building with `hp = 0`:

- emits `BuildingDestroyed`;
- updates stats: `buildingsLost` and `buildingsDestroyed`;
- has its queue discarded **without refund** (unlike `delete`) and is added to `pendingRemoval`.

Cleanup frees the footprint and handles orders, rally points and slots as in M1. Gather orders whose drop-off or farm vanished re-choose or retarget (existing M1 behaviour; WP23 adds tests). A destroyed foundation refunds nothing.

**Population:** `popUsed` is recomputed from living units in cleanup (M1). Destroyed Houses lower `popCap`. If `popUsed > popCap`, nothing dies; production holds until there is room.

### 4.10 Town Center arrows

- Only completed buildings with `combat.attack` fire. In M2 that is the Town Center: 7 pierce (WP33; was 5), range 7 (reach 7.75), cooldown 2.0 s (40 ticks), 2 arrows per volley at the same target, no wind-up.
- Step 8b per building in ascending id order: `cooldown -= 1` if > 0. If 0 and the target is valid and in reach, fire the arrows and set `cooldown = cooldownTicks`.
- Scans follow the unit scheduling and budget. Targets are tier 1 (fighting units), then tier 2 (other enemy units), then `d²`, then id. A building cannot target buildings.
- The building keeps its target while it is in reach.

### 4.11 Construction HP

- `s = constructionStartPercent` (10).
- After each progress update in step 10: `g = constructed ? maxHp : max(1, floor(maxHp * (s + (100 − s) * progress) / 100))`. If `hp > 0`, `hp += g − builtHp`, clamped to `maxHp`; then `builtHp = g`.
- Damage taken during construction is therefore kept, and finishing does not heal it.

### 4.12 Repair

- **Order:** walk to the footprint like `assist`. In phase `repairing` the unit is adjacent; leaving adjacency returns it to walking. The order is `done` when the building is at max hp (emit `VillagerIdle` if nothing is queued) or when the building is gone.
- **Rate, per building per tick** (step 10, after construction), with `n` = units in `repairing` on it (`repairerIds` pruned each tick):
  - `hpPerSecond = max(repairMinHpPerSecond, repairRateFactor * maxHp / buildTime) * (1 + 0.5 * (n − 1))`;
  - `repairAccumulator += hpPerSecond / TICK_RATE`, snapped to a 1e-9 grid as for income;
  - `whole = min(floor(repairAccumulator), maxHp − hp)`.
- **Cost:** for each resource `r` with a resolved def cost `c[r] > 0`, `repairCostAccumulator[r] += whole * c[r] * repairCostPercent / 100 / maxHp` and `need[r] = floor(...)`.
  - If the player has every `need[r]`: deduct them, subtract them from the accumulators, `hp += whole`, `repairAccumulator −= whole`.
  - Otherwise roll back this tick's cost accumulation; repair stalls with no hp gain and resumes when affordable.
- A full repair costs 50% of the building's cost.
- Repair works under fire. Siege and units cannot be repaired in M2. On reaching max hp both accumulators reset to 0.

### 4.13 Defeat, victory, resign

**Defeat rule** (conquest mode, evaluated in step 12 for each `playing` player): the player is defeated when they own

1. no **completed** building whose def has a non-empty `trains`, **and**
2. no living unit whose def's `builds` contains `start.centerBuilding` (the Town Center).

*Justification:* such a player can never train another unit, so the match is decided. Leftover soldiers would only make the winner hunt them down. Counting only completed producers stops an unbuildable foundation from keeping a player alive. Counting Town-Center builders (villagers) keeps the comeback path open now that the Town Center is buildable.

**On defeat:**

- `outcome = 'defeated'`, `defeatedTick = tick + 1`;
- `PlayerDefeated{reason:'conquered'}` is emitted;
- every remaining entity of the player gets `hp = 0` and dies next tick, with events.

**Resign:** the command sets the same fields with reason `'resigned'` at once. The destruction happens in step 12.

**Victory:**

- When exactly one real player is `playing` in conquest mode: that player's `outcome = 'won'`, `match.winner` and `endedTick` are set, `MatchEnded` and `ObjectiveCompleted('conquest:<id>')` are emitted.
- If all remaining players are defeated in the same tick: `MatchEnded{winner:null}` (a draw).
- Sandbox mode never runs defeat checks; the `reachAge` objective works as in M1.

### 4.14 UnderAttack alerts

`applyDamage` on an entity of player P (from an enemy) emits `UnderAttack` and sets `P.alert` if any of these holds:

- `P.alert` is null;
- `tick − alert.tick ≥ ALERT_MIN_TICKS` (100);
- the hit is at least `ALERT_MIN_DISTANCE` (12) tiles from `alert`.

The client throttles further (7.3).

### 4.15 Map: two fair starts

Applies when `config.players.length === 2`. One-player maps are unchanged, so M1 seeds stay identical.

- Player 1's start is chosen and jittered as in M1, and the M1 horizontal-mirror flag is kept.
- Player 2's start, guaranteed resources and starting units are the **point mirror** of player 1's through the map centre: a footprint `(tx, ty, s)` maps to `(W − tx − s, H − ty − s)` and a point `(x, y)` to `(W − x, H − y)`.
- Scatter clusters and forests are generated only on tiles with `tx + ty ≤ W − 3`, then mirrored. The three anti-diagonals in between stay empty. Scatter counts are halved, rounded up. The forest coverage target is unchanged.
- Validation adds a check that each Town Center is reachable from the other.
- Mirrored entities are created after the originals, so player 1's nodes have lower ids. The only effect is on exact distance ties between the two players' units, which is negligible and accepted.

## 5. Content (original numbers; all live in `src/data`)

### 5.1 Unit combat stats

Times are in seconds (ticks in brackets). `MA` and `PA` are melee and pierce armour; `Res` is `bonusResist` in percent.

| Unit | HP | Atk | Type | MA | PA | Range | Min | Wind-up | Cooldown | Sight | Classes | Bonus | Res | Projectile / splash | Targets |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Villager | 25 | 3 | melee | 0 | 0 | 0 | 0 | 0.5 (10) | 2.0 (40) | 4 | villager | — | 0 | — | any, autoAcquire false |
| Spearman | 50 | 5 | melee | 0 | 1 | 0 | 0 | 0.5 (10) | 2.0 (40) | 6 | infantry, spear | cavalry +12 | 0 | — | any |
| Swordsman | 65 | 8 | melee | 2 | 1 | 0 | 0 | 0.5 (10) | 1.8 (36) | 6 | infantry | spear +4 | 0 | — | any |
| Archer | 32 | 5 | pierce | 0 | 0 | 5 | 0 | 0.6 (12) | 2.0 (40) | 7 | archer | infantry +4 | 0 | arrow | any |
| Horseman | 70 | 6 | melee | 1 | 2 | 0 | 0 | 0.4 (8) | 1.8 (36) | 7 | cavalry | archer +5, siege +8 | 0 | — | any |
| Lancer (not Byzantine) | 100 | 10 | melee | 2 | 2 | 0 | 0 | 0.5 (10) | 1.9 (38) | 7 | cavalry | archer +5, siege +10 | 0 | — | any |
| Cataphract | 120 | 11 | melee | 3 | 3 | 0 | 0 | 0.5 (10) | 2.0 (40) | 7 | cavalry | archer +5, siege +10 | 50 | — | any |
| Battering Ram | 140 | 4 | melee | 0 | 40 | 0 | 0 | 1.0 (20) | 4.0 (80) | 4 | siege | building +60 | 0 | — | buildings |
| Trebuchet | 110 | 8 | pierce | 0 | 10 | 11 | 3 | 2.0 (40) | 8.0 (160) | 12 | siege | building +150 | 0 | stone | buildings |
| Siphonarios | 45 | 10 | melee | 0 | 0 | 2 | 0 | 0.6 (12) | 2.5 (50) | 5 | infantry | building +18, siege +12 | 0 | fire, splash r 1.0 at 60% | any |

Cost, train time, speed and population are unchanged from M1 5.4 and 5.6. All `autoAcquire` values are true except the villager's.

Rationale:

- The spear's +12 against cavalry makes it a cheap wall. The Cataphract's 50% resist halves that bonus and its 3 melee armour soaks the base hit, so about three Spearmen per Cataphract are needed. That is "partially resists".
- The swordsman's +4 against spear plus 2 melee armour makes spears near useless against it, and its stats beat a Horseman one on one, so it is the generalist.
- The archer's +4 against infantry comes through at range, and archers lose to anything with pierce armour (cavalry, rams, buildings).
- Cavalry has +5 against archers, +8 or +10 against siege, and the speed to close.
- Siege has huge bonuses against buildings, no attack against units and 0 melee armour.
- The Siphonarios' 60% splash punishes clumps and its building and siege bonuses make it a demolisher, but at 45 hp and 0 armour it dies to anything that reaches it.

### 5.2 Building combat stats

| Building | HP (M1 provisional) | MA | PA | Attack |
|---|---|---|---|---|
| Town Center | 2400 (600) | 3 | 8 | 7 pierce (WP33; was 5), range 7, cooldown 2.0 s, 2 arrows |
| House | 550 (150) | 1 | 6 | — |
| Mill, Lumber Camp, Mining Camp | 600 (200) | 1 | 6 | — |
| Farm | 300 (100) | 0 | 8 | — |
| Barracks, Archery Range, Stable | 1200 (350) | 2 | 7 | — |
| Siege Workshop | 1400 (400) | 2 | 7 | — |
| Silk Workshop | 1000 (300) | 2 | 7 | — |

Other existing numbers that change:

- **Town Center:** `buildable: true`, cost 275 wood and 100 stone, build time 150 s, `buildMenu: 'economy'`, age 1. Villagers' `builds` gains `townCenter`.
- **Combat stats:** all unit combat numbers in 5.1 replace M1's provisional ones; `armor` is split into `meleeArmor` and `pierceArmor`.
- **Research lists:** the Barracks, Archery Range and Stable `researches` lists gain the upgrades in 5.4.
- **Economy:** no economy number changes.

`CombatRules` values are given in 3.7.

### 5.3 Counter matrix (equal-cost duels, the WP25 tests)

Attacker in the row against defender in the column. "W" means the row wins with at least 30% of its cost surviving; "w" means it wins narrowly (above 0%); "L" means it loses; "—" means not tested.

| | Spear | Sword | Archer | Horseman | Cataphract | Ram | Trebuchet |
|---|---|---|---|---|---|---|---|
| **Spearman** | — | L | L | W | w | W | W |
| **Swordsman** | W | — | L | W | — | W | W |
| **Archer** | W | w | — | L | L | — (cannot hurt) | — |
| **Horseman** | — | L | W | — | L | W | W |
| **Cataphract** | L (3:1 spears) | W | W | W | — | W | W |

Siege rows:

- 2 Battering Rams destroy a Barracks in under 60 s; 10 Swordsmen need more than 3× as long.
- A Trebuchet destroys a Town Center from outside its range without taking damage.
- 6 Villagers kill a Battering Ram in under 30 s.
- 4 Siphonarioi deal at least 2.5× the damage per second of 4 Swordsmen to a clump of 10 stand-ground Spearmen.
- 5 Siphonarioi destroy a Barracks in under 40% of the time 5 Swordsmen need.

### 5.4 Military upgrades (12 techs, tag `militaryTech`)

Level II requires level I (`requiresTechs`). Attack upgrades on infantry select `ids: ['spearman','swordsman']`; the Siphonarios does not gain them. Armour upgrades select by tag (`infantry`, `archer`, `cavalry`).

| Id | Name | Age | At | Cost | Time | Effect |
|---|---|---|---|---|---|---|
| `spathionForging` | Spathion Forging | 2 | Barracks | 100 food, 50 gold | 35 s | Spearman, Swordsman attack +1 |
| `strategikonDrill` | Strategikon Drill | 3 | Barracks | 200 food, 125 gold | 50 s | Spearman, Swordsman attack +1 |
| `paddedKavadion` | Padded Kavadion | 2 | Barracks | 75 food, 75 gold | 35 s | Infantry MA +1, PA +1 |
| `lamellarKlibanion` | Lamellar Klibanion | 3 | Barracks | 175 food, 150 gold | 50 s | Infantry MA +1, PA +1 |
| `hornSinewBows` | Horn-and-Sinew Bows | 2 | Archery Range | 75 wood, 75 gold | 35 s | Archer attack +1 |
| `solenarionGuides` | Solenarion Guides | 3 | Archery Range | 150 wood, 175 gold | 50 s | Archer attack +1, range +1 |
| `bambakionCoats` | Bambakion Coats | 2 | Archery Range | 100 food, 50 gold | 35 s | Archer MA +1, PA +1 |
| `mailLorikion` | Mail Lorikion | 3 | Archery Range | 200 food, 125 gold | 50 s | Archer MA +1, PA +1 |
| `kontarionDrill` | Kontarion Drill | 2 | Stable | 125 food, 50 gold | 35 s | Cavalry attack +1 |
| `taktikaWedge` | Taktika Wedge | 3 | Stable | 250 food, 125 gold | 50 s | Cavalry attack +2 |
| `feltHorseBards` | Felt Horse Bards | 2 | Stable | 125 food, 50 gold | 35 s | Cavalry MA +1, PA +1 |
| `ironHorseBards` | Iron Horse Bards | 3 | Stable | 250 food, 150 gold | 50 s | Cavalry MA +1, PA +2 |

### 5.5 Pacing

- The M1 bot thresholds are unchanged.
- The hand-played Township target is 7:30.
- Target AI timings (measured by the tests in 8.1):

| Difficulty | Township | First wave launch |
|---|---|---|
| Easy | 8:30 to 10:30 | Not before 15:00 |
| Standard | 6:30 to 7:45 | 10:00 to 12:00 |
| Hard | 5:00 to 6:00 | 7:00 to 8:30 |

## 6. Computer opponent (`src/bot/ai/`)

### 6.1 Structure

```
src/bot/ai/
  aiPlayer.ts     Controller: cadence, memory, stamping, save/restore
  difficulty.ts   the table in 6.3 (habits, not game balance)
  memory.ts       AiMemory type (plain JSON), (de)serialisation, validation
  economy.ts      adapter over economyBot `decide` with a per-difficulty plan and resource reserve
  military.ts     production buildings, unit choice (6.4), upgrades
  army.ts         squads, wave state machine, targeting (6.5)
  defence.ts      threat detection and response (6.6)
  upkeep.ts       repair and rebuild
  power.ts        unit power estimate: hp * attack * TICK_RATE / cooldownTicks (from resolved stats)
```

```ts
export interface Controller {
  readonly playerId: PlayerId;
  /** Called before every sim.step; returns stamped commands (empty except on decision ticks). */
  update(sim: Sim): Command[];
  save(): ControllerSave | null;
}
export class AiPlayer implements Controller {
  static create(playerId: PlayerId, difficulty: AiDifficulty, seed: number): AiPlayer;
  static restore(save: ControllerSave): AiPlayer;   // throws SaveError('corrupt') on bad memory
}
export class EconomyBot implements Controller { /* unchanged behaviour; save() returns null */ }
```

`economyBot.decide` gains an optional `plan` parameter and an optional `reserve: ResourceAmounts`. The defaults reproduce M1 exactly, so `tests/sim/economyBot.test.ts` stays green.

### 6.2 Determinism and memory

- The AI decides on ticks where `(tick + playerId * 7) % interval === 0`; the interval comes from the difficulty table.
- The AI uses only `readView`-style copies of public state, `sim.query`, and its own sfc32 stream `rng`, created with `createRng((seed ^ (playerId * 0x9e3779b9)) >>> 0)` and stored in memory.
- **No `Map`/`Set` survives a decision.** Persistent collections are arrays sorted by id. Every choice is broken by id, then tile index.
- `AiMemory` holds: `rng`, `seq`, `phase`, `waveNumber`, `nextWaveEarliestTick`, `nextWaveForcedTick`, `wave` (unit ids, target, launch tick, start power), `defence` (active, centroid, since tick), `desiredBuildings` (type and count, for rebuilding), `firstWaveTick` (exposed for tests and debug), and `allInTick`.
- Save and load restore it exactly; test in 8.1.

### 6.3 Difficulty table (no difficulty gets resource or vision bonuses)

| Parameter | Easy | Standard | Hard |
|---|---|---|---|
| Decision interval (ticks) | 60 | 20 | 10 |
| Villager target | 28 | 50 | 70 |
| First Barracks | 6:30 (or 16 villagers) | 14 villagers (≈4:00) | 10 villagers (≈2:45) |
| Military buildings by end of Age 2 | 1 (Barracks) + Archery Range | Barracks, Archery Range, Stable | Barracks, Archery Range, Stable, 2nd Barracks |
| Share of income reserved for the army after the first Barracks | 20% | 35% | 45% |
| First wave earliest / forced | 15:00 + rng(0–60 s) / +3:00 | 10:00 + rng(0–30 s) / +90 s | 7:00 + rng(0–20 s) / +70 s |
| Wave size (launch threshold) | 4, 6, then 8 (cap 10) | 10, 14, then +4 (cap 30) | 8, 16, then continuous reinforcement |
| Wave interval after one ends | 4:00 | 3:00 | 1:30 |
| Composition | Fixed table | 50% fixed, 50% counter | 100% counter |
| Upgrades | None | Level I of its two most-built lines from Age 3 | All, as affordable, from Age 2 |
| Siege | Never | Rams from Age 3 against buildings | Rams in Age 3; Trebuchets and Siphonarioi in Age 4 |
| Highest age | 3 | 4 | 4 |
| Target choice | Nearest enemy building | Production > economy > Houses > Town Center; Town Center first only with rams | Army-aware (see 6.5) |
| Retreat | Never | Below 30% of wave start power | Below 40%; regroups with reinforcements |
| Defence reaction delay | 10 s | 3 s | 1 s |
| Villager response to raids | None | Evacuate to Town Center range | Small raids (≤ 2 units): 4 nearest villagers fight; larger: evacuate |
| Repair | No | Yes | Yes |
| Rebuild | Houses and Town Center only | Everything in `desiredBuildings` | Everything |
| All-in (anti-stall) | — | At 45:00, every unit attacks continuously | At 40:00 |

### 6.4 Economy and army production

**Economy.** Each decision runs the economy layer first (the `decide` adapter with the difficulty's villager target, shares and `reserve`). `reserve` is the army share of the current stockpile, so the economy cannot spend it. Then the military layer spends from the reserve plus any surplus above 400 of a resource.

Ages:

- Easy and standard advance like the M1 bot, but the Age 2 buildings are the military buildings.
- Hard advances with about 18 villagers and the Barracks as an Age 1 building.

**Unit choice.** For each idle production building (queue under 2), pick the affordable, available unit with the highest `score − currentShare`.

- `score = (1 − c) * fixed[u] + c * counter[u]`, where `c` is the composition weight from 6.3.
- Fixed tables: easy spear 0.6, archer 0.4; standard and hard sword 0.35, archer 0.3, horse 0.2, spear 0.15. The Cataphract replaces the horse at Age 3 and above.
- `counter[u] = Σ over enemy fighting units e: COUNTER[u][classOf(e)] * power(e)`, normalised. `COUNTER` is the 5.3 matrix as numbers in `difficulty.ts`: W = 1.0, w = 0.5, L = −0.5.
- Siege comes on top by rule: 2 rams per wave at standard from Age 3; at hard, 2 rams plus 1 trebuchet from Age 4, plus 3 Siphonarioi.

Rally: new units gather 10 tiles from the AI's Town Center, towards the enemy Town Center.

### 6.5 Waves (state machine)

`massing` → `attacking` → `retreating` → `massing`. Defence (6.6) overrides all of these.

**Massing.**

- Units not in a wave and not defending idle at the rally point with stance aggressive.
- Launch when `tick ≥ nextWaveEarliestTick` and army size ≥ the wave threshold, or when `tick ≥ nextWaveForcedTick` with at least half the threshold (at least 3).
- Easy never launches before its earliest tick, whatever happens.
- Record `firstWaveTick` on the first launch.

**Attacking.**

- Every decision (and immediately when the target dies), choose the target and issue `attackMove` to its approach point for every wave unit not engaged.
- Siege gets `attack` on the target building directly; the rest of the wave escorts it.
- Target scoring:
  - Easy: nearest enemy building to the wave centroid.
  - Standard: the building with the highest type priority (production 3, economy and drop-off 2, House 1, Town Center 0, or 4 when the wave has rams), then distance.
  - Hard: if enemy fighting power within 15 tiles of the planned target exceeds 1.2× the wave, it picks the largest cluster of enemy villagers more than 8 tiles from any Town Center instead; it focuses an `attack` on the lowest-hp enemy siege or archer in reach each decision.
  - Endgame, all difficulties: when the enemy has no production building, target the nearest enemy villager, then any unit.

**Retreating.**

- Triggered when wave power falls below the retreat threshold.
- `move` back to the rally point; the remaining units are merged into the next wave, and `nextWaveEarliestTick = tick + interval`.

### 6.6 Defence, repair, rebuild

**Threat.** Enemy units within 20 tiles of any own building, grouped by proximity (single-link clustering, 6-tile radius, ascending id).

**Response** (after the reaction delay):

- All own fighting units not in a wave that is more than 30 tiles away get `attackMove` to the threat centroid.
- Standard and hard recall the wave when threat power exceeds 2× defender power.
- Villager handling per 6.3. Evacuated villagers `move` to the Town Center ring; the economy layer reassigns them once the threat has been gone for 10 s.
- Easy defends with military only.

**Repair** (standard and hard): a building below 70% hp with no enemy within 8 tiles gets 2 villagers (Town Center: 4).

**Rebuild:** `desiredBuildings` is updated whenever the AI completes a building. A missing one is re-placed through the existing site search, Town Center first. If the Town Center is lost and the AI has at least 1 villager and 100 stone, rebuilding it is top priority, ahead of everything else.

### 6.7 AI performance

Decision cost with a 200-unit army must average under 3 ms and stay under 8 ms worst case. The amortised cost per tick must be under 0.5 ms at standard. The AI uses its own per-decision bucket grid (8-tile cells) for threat and cluster queries.

## 7. Client

### 7.1 Input (`src/client/input`, WP29; modes in `input/placement`, WP28)

**Right click with units selected:**

| Target | Result |
|---|---|
| Enemy unit or building | `attack` for the units that can target it; the rest `move` to the target's position |
| Own completed building with hp < max | `repair` for the units that can build that type |
| Own unfinished building | `assist` (M1) |
| Anything else | M1 rules |

Shift queues, as in M1. With only buildings selected the M1 rally rules apply.

**Military command card.** Slots are fixed:

| Slot | Key | Action |
|---|---|---|
| 2 | E | Stop (as M1) |
| 5 | A | Attack-move: enters target mode |
| 6 | S | Hold position |
| 10 | Z | Aggressive |
| 11 | X | Stand ground |

The active stance is highlighted.

**Villager card.** Slot 3 (R) is Repair, which enters target mode.

**Mixed selections** use the M1 intersection rule.

**Attack-move mode:**

- Left click on ground issues `attackMove` with group slots. On an enemy it issues `attack`.
- Shift issues with `queue: true` and keeps the mode active.
- Right click or Esc cancels.

**Repair mode:** left click on an own damaged building issues `repair`; anything else toasts "Choose a damaged building of yours".

**Cursors** are set on the canvas from data-URI SVGs drawn in code:

- sword (`attack`) when hovering an enemy that a selected own unit can target;
- crosshair in attack-move mode;
- hammer in repair mode.

**Hotkeys** (added to the one table):

- `,` (Comma) cycles idle military units (no order, no queue, no path; units on hold do not count).
- `Space` centres the camera on the latest alert.

### 7.2 Rendering (`src/client/render`, `src/client/art`, WP27; bars and minimap WP28)

**Unit animation state** (`unitAnimState`):

- `attack` while `combat.windup > 0`, or within `ATTACK_ANIM_TAIL_TICKS` (8) after `lastAttackTick`;
- else `walk`/`carry` when moving;
- else `work`;
- else `idle`.

During a wind-up, frames 0..`hitFrame` are spread over `windupTicks`, using `windupTicks − windup + alpha`, so the blow frame coincides with the release tick. After release the remaining frames play within the tail.

**Decal layer** (`render/effects/`):

- `UnitDied` plays `death` once (`loop: false`) at the event position and facing in the owner's colour. The corpse is held for 20 s of game time and fades over the last 3 s. At most 300 corpses; the oldest are dropped.
- `BuildingDestroyed` shows `fx.dust` plus `rubble.<size>` for 60 s of game time. At most 60.
- Time is based on `state.tick + alpha`, so pausing freezes it.
- Decals are cleared on load.

**Projectiles** are drawn from `state.projectiles` and culled.

- Arc heights: arrow 0.4 tiles; stone 1.5 tiles (`4·H·p·(1−p)`); fire flat, as a short stretched stream sprite from source to `to`.
- Arrows are rotated to their screen velocity (client trig is allowed).
- A projectile present last frame and gone now spawns `fx.hit` (arrow), `fx.dust` (stone) or `fx.splash` (fire) at its last `to`.

**Hits.** A unit whose `lastAttackTick === state.tick − 1` and which is melee spawns `fx.hit` at its swing target. Units with `lastDamagedTick === state.tick − 1` flash, with a 2-frame white tint at 40% alpha.

**Building damage overlays** (completed buildings only), with positions chosen by a hash of the building id within the footprint:

| HP | Overlays |
|---|---|
| < 66% | One `fx.fireSmall` and `fx.smoke` |
| < 33% | `fx.fireLarge` at 2 points (3 for footprint 4) plus smoke |

**Health bars** (WP28, pooled in `render/overlays`):

- Shown for selected entities of any owner, and for any drawn entity with hp < max.
- Units: 30 × 4 px, 6 px above `modelTop`. Buildings: `16 × footprint + 16` px wide, 5 px tall, above the measured art top (as the M1 progress bars). Constant screen size.
- Fill: own entities green ≥ 50%, yellow 25–50%, red < 25%; enemy entities always red. 1 px dark frame.
- Construction and production bars move above the health bar when both show.

**Team colour.** Every entity sprite is fetched with `teamSprite(id, players[owner].color, civ.palette.secondary)`. The rendered art's 16-entry ramp (`quantize.ts` `teamRamp`) recolours atlas pages per colour, and the sprite-sheet manifest must store team cloth as ramp levels in the same way. HUD CSS stays purple.

**Sprite-sheet manifest.** The Blender pipeline (a separate agent) plugs in through `art/composite.ts` as the first provider for `unit.*` and `node.tree`. It must provide the states and fields of 3.8. Until it lands, the procedural art supplies `attack` (two lean-forward frames, `hitFrame` 1) and `death` (three frames: kneel, fall, lie; `loop: false`) for all 10 units. The rendered voxel art supplies the building effects, rubble and projectiles (WP27).

**Minimap** (WP28):

- Units are 3 px in owner colour for every player.
- `UnderAttack` adds a red expanding ring ping at the location (1.5 s, repeated 2 times), at most 4 live.
- `minimap.ping(x, y, color)` is the API.

### 7.3 HUD (`src/client/ui`, WP29)

- **Top bar:** player colour swatch; idle-military button with count (click cycles, like the `,` key).
- **Selection panel:**
  - real hp;
  - combat line: attack icon and value (melee or pierce icon), range if > 0, armour `M x / P y`, bonus lines ("+12 vs cavalry");
  - Town Center note "Fires 2 arrows";
  - stance for own military;
  - "Repairing" fact on buildings.
  - Enemy entities show the same, read-only, with the owner name in the owner colour.
- **Alerts:** `UnderAttack` raises a toast:

  | Situation | Toast | Kind |
  |---|---|---|
  | Town Center hit | "Your Town Center is under attack!" | error |
  | Other buildings | "Your buildings are under attack!" | error |
  | Units | "Your units are under attack!" | info |

  At most one toast per kind per 15 s of client clock. Each alert also pings the minimap and becomes the `Space` target. Own `BuildingDestroyed` toasts "<Building> destroyed" (error). `PlayerDefeated` of the opponent shows a banner "<name> has been defeated".
- **Rejections:** `REJECT_TEXT.playerDefeated` = "You have been defeated".
- **In-match menu:** gains Resign, which needs confirmation ("Resign this match?" Yes/No). Yes sends `resign`.
- **End screen** (`app/screens/EndScreen.tsx`, WP30):
  - Shown when `MatchEnded` arrives or the local player is defeated; the loop pauses.
  - Contents: Victory, Defeat or Draw; match time; a table per player of units trained, lost and killed; buildings built, lost and destroyed; resources gathered per type; techs; age reached times.
  - Buttons: "View map" (closes the screen and resumes; sandbox afterwards), "Play again" (same setup, new seed unless one was pinned), "Main menu".

### 7.4 Screens and match plumbing (`src/client/app`, WP30)

**Setup screen** (`screens/Setup.tsx`) replaces civilization select:

- Civ panel: Byzantines, generated from data as now; the `civ-panel` testid is kept.
- Opponent: Easy, Standard (default), Hard, or "No opponent (sandbox)".
- Your colour and opponent colour from `PLAYER_COLORS`, defaults blue and red; the two must differ (the conflicting swatch is disabled).
- Map seed: a number input with a "Random" button.
- Start (`start-match`).

**Testids:** `setup-screen`, `setup-opponent-<none|easy|standard|hard>`, `setup-color-<1|2>-<colorId>`, `setup-seed`, `setup-seed-random`, `start-match`.

**Match:**

- `Match` takes `controllers: Controller[]` and merges their commands in `tick()` (2.7).
- `__game.ai.setEnabled(false)` and `?ai=off` skip their `update`.
- `LOCAL_PLAYER_ID` stays 1; the human is always slot 1.

**Saves:**

- Save calls `serialize(sim, controllers.map(c => c.save()).filter(nonNull))`.
- Load uses `deserializeSave` and rebuilds controllers with `AiPlayer.restore`.
- v1 saves load as sandbox matches.
- `configFromSim` (Restart) copies colour, controller, difficulty and name from `PlayerState`.

## 8. Verification

### 8.1 Sim and unit tests (Vitest)

| Area | Tests |
|---|---|
| Damage (WP20/21) | Table-driven `computeDamage`: armour floor at `minDamage`; bonus after armour; resist 50% floors; splash percentage; integer outputs only |
| Timing (WP21) | First hit lands exactly `windupTicks` after reaching reach; period exactly `cooldownTicks`; a wind-up completes after a `stop`; a melee release on a target that left reach + slack is wasted |
| Simultaneity (WP21) | Two identical units duelling, created in either id order, die on the same tick |
| Acquisition (WP21) | Tier order; ties by d² then id; stand ground uses reach only; budget exhaustion defers deterministically (same result with ids permuted where tiers and distances differ); retaliation beyond sight; retarget rule; leash returns to anchor; attack-move resumes after a kill; hold never moves |
| Chasing (WP21/24) | Chase re-path throttle; `directPath` under 3 tiles; chasing a fleeing horseman does not saturate the path queue (fewer than 1 request per unit per 10 ticks) |
| Projectiles (WP22) | Flight ticks formula; homing hits a moving target; target death mid-flight wastes an arrow; fire splash hits enemies only, excludes the primary, is order-independent; kill credit to a dead shooter |
| Town Center (WP22) | Fires 2 arrows every 40 ticks at the nearest fighting unit; ignores buildings; unfinished Town Center does not fire |
| Death (WP23) | Events with correct killer; no refund on destroyed queues; popCap drop holds production; gather and build orders recover when their building dies; stats counters |
| Outcome (WP23) | Defeat rule truth table (completed producer and Town-Center builder combinations; foundation-only player is defeated); resign; draw; sandbox never ends; commands after defeat rejected; defeated entities destroyed next tick |
| Repair (WP24) | Rate formula with 1 to 4 repairers; cost totals 50% of cost over a full repair (±1 per resource); stalls when unaffordable and resumes; ends at max hp with `VillagerIdle` |
| Construction HP (WP24) | 10% at placement; reaches max on completion; damage during construction persists |
| Separation (WP24) | Stationary attackers end at least 0.45 apart; never pushed into blocked tiles |
| Map (WP24) | 50 seeds × 2 players: every node of player 1's half has a mirror of the same type and amount; per-player multisets of (resource, amount, distance to own Town Center) are identical; Town Centers mutually reachable; one-player maps byte-identical to M1 for 20 seeds |
| Data (WP25) | Every unit and building has valid combat stats (cooldown > wind-up; minRange < range; classes non-empty; bonus keys are classes); every upgrade is reachable, researched at its line's building, II requires I; upgrades resolve to the 5.4 values; Lancer still hidden for Byzantines |
| Counter matrix (WP25) | `tests/sim/duels.test.ts`: every cell of 5.3 and the siege rows, run headless on an empty 48×48 map with both groups given `attackMove` at each other from 10 tiles; each duel deterministic (two runs, same hash) |
| Saves (WP20) | v1 fixture migrates and matches `save-v1-as-v2.json` byte for byte; v2 fixture round-trips; continued run equals uninterrupted; damaged files give `corrupt` with a message |
| Determinism (WP33) | M1 30,000-tick replay tests unchanged; a new conquest replay (two AIs, 30,000 ticks): two replays identical; save/load (state and controllers) at 10 seeded ticks equals uninterrupted |
| AI (WP26/32) | See below |
| Performance (WP33) | 8.4 |

AI tests, in `tests/sim/ai.test.ts` with the harness `tests/sim/aiHarness.ts`:

1. First-wave windows per difficulty (5.5) on 3 seeds, from `memory.firstWaveTick`.
2. Township windows per difficulty on 3 seeds.
3. Full matches (in `npm test`):
   - Hard vs Easy, seed 1: Hard wins before 35:00.
   - Standard vs Easy, seed 1: Standard wins before 45:00.
4. Full matches (in `npm run test:long`, which Phase 0 adds, run by the phase gates and nightly CI):
   - Hard vs Easy and Standard vs Easy on 3 seeds each, with the same limits as item 3.
   - Hard vs Standard on 3 seeds: Hard wins at least 2 of 3.
   - Standard vs Standard on 2 seeds: a winner before 75:00 (90,000 ticks).
5. Command hygiene: AI command rejections are at most 1% of AI commands, and none are `invalidCommand`.
6. No AI unit with a moving order keeps its position for 30 s (M1 bot rule).
7. AI save/load: memory restore gives identical commands and hashes for 2,000 ticks.
8. AI decision cost budget (6.7), with generous thresholds.

### 8.2 End-to-end scenarios (Playwright)

M1 rules apply throughout:

- pinned `?seed`, start `?paused=1`, frozen client clock;
- time moves only by `__game.step` and `advanceClock`;
- no sleeps, `retries: 0`;
- clicks through `worldToScreen`, with targets verified by `pickAt`.

Combat specs use `?opponent=standard&ai=off` unless stated. Enemies are spawned with `cheat.spawnUnit(..., 2)`. Every spec saves a screenshot to the gallery.

1. **Setup:** pick Hard, colour red for the human, seed 7. The match has two Town Centers, `players[1].color` is red and `players[2].color` is blue, the HUD stays purple. Screenshot.
2. **Right-click attack:** spearmen attack a spawned enemy horseman; its hp falls; `UnitDied`; `effects().corpses` ≥ 1.
3. **Attack-move:** card A then click. Units engage an enemy spawned midway, kill it, and continue to the point. Cursor reads `attackMove` in the mode.
4. **Stances:** stand-ground spearmen do not chase an enemy archer shooting from 5 tiles; after switching to aggressive (Z) they chase and kill it.
5. **Hold position (S):** units do not move when an enemy passes 3 tiles away out of reach, and attack it in reach.
6. **Health bars and inspection:** a damaged own house shows a bar (`overlayStats().healthBars`); selecting an enemy swordsman shows hp and the combat line in the panel.
7. **Projectiles:** archers fire; `effects().projectiles` > 0 during flight; the target loses hp.
8. **Town Center defence:** an enemy horseman next to the human Town Center dies within 15 s of game time without player input.
9. **Destruction:** spawned rams destroy an enemy House: rubble count ≥ 1, the enemy popCap drops, fire overlays appear below 66% (`effects().fires`).
10. **Repair:** card R then click a damaged own Barracks. hp rises, wood falls, and the villager idles at full hp.
11. **Alerts:** an enemy attacks a villager. Toast, minimap ping (`alerts()`), and Space centres the camera on it.
12. **Upgrade:** research Spathion Forging; the panel attack of a Swordsman goes from 8 to 9.
13. **Resign:** menu, Resign, Yes. The defeat end screen with stats; "Main menu" returns.
14. **Victory:** `cheat.defeat(2)`. The victory screen; "View map" resumes.
15. **Save mid-battle with the AI on** (`?opponent=standard`): step 3,000, save, step 400, hash A; load, step 400, hash B; A equals B.
16. **Idle military:** `,` selects and centres idle soldiers in turn.
17. **Rendered art battle gallery** (`renderedArt.spec.ts`): death poses, corpses, fires, rubble, projectiles, both colours, at 0.5×, 1× and 2×.

The existing M1 specs keep passing, driven through the setup screen with the opponent set to none.

### 8.3 Manual verifier playthrough (Phase 4)

1. Win a full match against Standard with no cheats, at 1× or 1.5× speed. Record the time and the stats screen.
2. Lose a match against Hard on purpose (or by resigning after its first wave). Check the AI's first wave arrives at 7:00 to 8:30.
3. Save during a large fight, reload the page, load; the fight continues sensibly and the AI keeps attacking.
4. Play Easy for 15 minutes; it must not attack before 15:00.
5. Review the screenshot gallery for readability of colours, health bars, projectiles and damage states.

### 8.4 Performance

**Battle scenario.** `createBattleScenario(seed, perSide = 200)` in `src/sim/stress.ts` (WP33) builds a 2-player map with both bases plus 30 buildings each. Per side it adds 60 Spearmen, 40 Swordsmen, 40 Archers, 40 Horsemen, 10 Cataphracts and 10 Siphonarioi, in two lines 14 tiles apart at the map centre, given `attackMove` towards each other. `__game.startBattle()` loads it in the browser.

| Budget | Measurement | Target |
|---|---|---|
| Sim tick | Node, ticks 200 to 2,200 of the battle | average < 4 ms, p99 < 12 ms (first 200 ticks excluded) |
| Sim, economy stress (M1) | Unchanged scenario | average < 2 ms, p99 < 12 ms (still asserted) |
| AI | 6.7 | Asserted in the AI tests |
| Frame rate | `scripts/perf-browser.mjs` battle mode, 1080p, health bars and projectiles on | 60 fps at 1×, ≥ 45 at 0.5× (by hand, recorded in DESIGN.md) |
| Battle determinism | Two runs; save/load every 250 ticks | Identical hashes every 100 ticks |

## 9. Work breakdown

### 9.1 How the team operates (unchanged from M1 10.1)

- One orchestrator integrates.
- Each work package is built by one agent in its own worktree, against the contracts.
- Contract files (`src/sim/types.ts`, `src/data/schema.ts`, the shared signatures in 3.5 and 3.8, and the command and order handler tables) change only through the orchestrator after Phase 0.
- An independent verifier runs every gate.
- Rule changes go into `docs/DESIGN.md` in the same merge.
- The per-package definition of done is the one in `CLAUDE.md`.

### 9.2 Directory ownership for M2 (Phase 0 appends this to CLAUDE.md)

| Path | Owner |
|---|---|
| `src/sim/types.ts`, `src/data/schema.ts`, `sim.ts`, `serialize.ts`, `entities.ts`, `runtime.ts`, `systems/commands.ts`, `systems/common.ts`, `systems/cheats.ts`, `systems/cleanup.ts`, `rules/stats.ts` | WP20, then orchestrator |
| `systems/combat/` (incl. `damage.ts`, `spatial.ts`, `acquire.ts`, `attack.ts`, `engage.ts`, `stance.ts`), `systems/orders/attack.ts`, `attackMove.ts`, `hold.ts` | WP21 Combat core |
| `systems/projectiles.ts`, `systems/defence.ts` | WP22 Projectiles and defence |
| `systems/death.ts`, `systems/outcome.ts`, `systems/objectives.ts`, `systems/matchStats.ts` | WP23 Death and outcome |
| `systems/construct.ts`, `systems/orders/repair.ts`, `systems/orders/build.ts`, `systems/movement.ts`, `path/follow.ts`, `map/mapgen.ts` | WP24 Repair, movement and map |
| `src/data/` (except `schema.ts`), `tests/unit/data/`, `tests/sim/duels.test.ts`, `tests/sim/duelHarness.ts`, `docs/BALANCE.md` | WP25 Content and balance |
| `src/bot/`, `tests/sim/ai*.ts`, `tests/sim/botHarness.ts` | WP26 AI |
| `src/client/render/` (except `overlays`), `src/client/art/` | WP27 Renderer and effects |
| `src/client/render/overlays`, `src/client/ui/minimap`, `src/client/input/placement` | WP28 Overlays, modes, minimap |
| `src/client/input/` (except `placement`), `src/client/ui/` (except `minimap`, `saveLoad.ts`) | WP29 Input and HUD |
| `src/client/app/`, `src/client/platform/`, `src/client/debug/`, `src/client/ui/saveLoad.ts` | WP30 Screens and match |
| `src/sim/stress.ts`, `tests/sim/performance.test.ts`, `tests/sim/determinism*.ts`, `scripts/perf-browser.mjs` | WP33 (Phase 3) |
| `tests/e2e/` | WP34 (Phase 3); WP28 to WP30 add their own specs in Phase 1 |

Other M1 files keep their M1 owners. M1 work packages are finished, so the orchestrator holds those files.

### 9.3 Phase 0: contracts (one agent, serial). WP20

Deliverables:

1. Every type, constant, command, order, event, field and API in section 3, in the contract files.
2. Data migrated to the new schema shape, **with the section 5 numbers** (including the Town Center changes, `combat.ts` and the 12 upgrades). WP25 owns tuning afterwards.
3. Shape validation and the defeated-player rejection in `applyCommands`; handler table entries with `STUB` bodies.
4. The tick order of 2.2 in `sim.ts`, with `STUB` no-op systems (`runAcquisition`, `runUnitAttacks`, `runBuildingAttacks`, `runProjectiles` (decrement and drop only), `runDeath`, `runOutcome`).
5. Real implementations of: `computeDamage`, `applyDamage`, `isEnemy`, `distSqToTarget`, `unitCombat`/`buildingCombat` with the runtime cache, `spawnProjectile`, `recordStat` and its calls in existing systems, entity creation defaults, `GameConfig` defaults (colours, controllers, names, mode, objectives). (Phase 0 also implemented the 4.11 construction-hp update, `updateConstructionHp` in `construct.ts`, so completed buildings reach max hp; WP24 owns it and its tests. It also added the `Controller` interface, `src/bot/controller.ts`, and an `AiPlayer` stub for WP30 to build against.)
6. Save v2: `serialize`/`deserialize`/`deserializeSave`, `MIGRATIONS[1]`, the extended structural check, the three fixtures (3.6).
7. Client contract additions (3.8) with stub implementations so everything compiles and runs:
   - `teamSprite` promoted into the contract (the procedural, rendered and composite manifests already implement it);
   - `pushEvents`/`effectStats` no-ops;
   - view-model fields filled with neutral values;
   - debug-hook members that throw "not implemented".
8. Lint: determinism rules extended to `src/bot/**`. CLAUDE.md: new tick order, ownership table, M2 commands (`npm run test:long`). DESIGN.md: "M2 contract decisions".

Gate (verifier):

- the full M1 pipeline is green, including the economy bot test and the M1 e2e suite (the setup screen is still M1 civ select at this point; WP30 replaces it);
- the v1 fixture migrates;
- a 2-player `createGame` runs 1,000 ticks with no change in behaviour (combat stubs);
- the new contract tests compile against the stubs.

### 9.4 Phase 1: ten packages in parallel

All start the moment Phase 0 merges. Each builds against the Phase 0 stubs. The column "Waits for" lists only what is needed for its *integration* acceptance (run in Phase 2), never to start.

| WP | Owns (9.2) | Delivers | Builds against | Acceptance (in-package) | Waits for (integration acceptance) |
|---|---|---|---|---|---|
| **WP21 Combat core** | combat/, attack/attackMove/hold orders | Spatial index; acquisition (4.5) with budgets; engagement and chase (4.6); unit attacks (4.3); stance command; attack, attackMove and hold commands and orders | Real `computeDamage`/`applyDamage`; `spawnProjectile`; `directPath` stub (falls back to `followPath`) | Timing, simultaneity, acquisition, chasing and stance tests in 8.1, on hand-built states (melee and ranged; projectiles verified only as spawned) | WP22 for ranged kills |
| **WP22 Projectiles and defence** | projectiles.ts, defence.ts | Projectile flight, homing, impact, splash; Town Center scans and volleys | `spawnProjectile`, `computeDamage`, the spatial query signatures (own simple loop until WP21 merges) | Projectile and Town Center tests in 8.1 | WP21 spatial index |
| **WP23 Death and outcome** | death.ts, outcome.ts, objectives.ts, matchStats.ts | Death step and events, kill credit, stats, defeat rule, resign, victory and draw, conquest objective | hp set directly in tests | Death and outcome tests in 8.1 | — |
| **WP24 Repair, movement, map** | construct.ts, orders/repair.ts, build.ts, movement.ts, path/follow.ts, mapgen.ts | Construction HP (4.11), repair order, command and progress (4.12), combat separation (4.7), `directPath`, symmetric 2-player map (4.15) | Real `applyDamage`; order-state types | Repair, construction-HP, separation and map tests in 8.1; M1 construction and pathfinding tests stay green | — |
| **WP25 Content and balance** | src/data, duels | Review and tune section 5 numbers; data validation; upgrade resolution; duel harness and the 5.3 tests (marked `todo` until Phase 2); BALANCE.md M2 section | Data schema | Data tests in 8.1 | WP21 to WP24 for the duels |
| **WP26 AI** | src/bot | `Controller`, `AiPlayer`, the 6.1 modules, difficulty table, memory save and restore; economyBot `plan`/`reserve` parameters | Public sim API; combat commands are rejected by the stubs, so army behaviour is tested on move orders; wave timing and composition are measurable now | economyBot test unchanged; Township and first-wave windows (8.1 AI items 1 and 2, measured by launch, not by fighting); memory restore determinism; decision cost | WP21 to WP24 for full matches |
| **WP27 Renderer and effects** | render (except overlays), art | Unit attack and death states and timing; decal layer (corpses, rubble); projectiles; hit effects; building fire and smoke; procedural fallback frames; rendered-art sprites for projectiles, fx and rubble; `teamSprite` by slot colour; composite slot for the sprite-sheet manifest | Fixture states with hand-made projectiles, hp and events (`render/dev/fixtureState.ts`) | Art coverage test extended to the new ids and states; screenshot review at 3 zooms; the decal layer obeys its caps; a draw-cost micro-benchmark with 400 units and 100 projectiles under 2 ms of JS | — |
| **WP28 Overlays, modes, minimap** | overlays, minimap, input/placement | Health bars; attack-move and repair target modes and their cursors; order markers for attack; minimap colours and pings | Fixture states; the `CommandBuffer` spy | Overlay and mode unit tests; `wp28.spec.ts` covering e2e 6 (bars) and the mode halves of 3 and 10 with fixture-driven states | — |
| **WP29 Input and HUD** | input (except placement), ui (except minimap, saveLoad) | Contextual right-click (7.1); military and villager card actions; stance highlight; hotkeys `,` and Space; combat line; alerts toasts; idle military; Resign confirmation; `REJECT_TEXT` | Fixture view-models; fake queries | Component tests; command card intersection tests; contextual table tests | — |
| **WP30 Screens and match** | app, platform, debug, ui/saveLoad.ts | Setup screen; end screen; AI controllers in `Match`; save and load with controllers; URL parameters; all debug hook members | `AiPlayer` stub (`update` returns `[]`) until WP26 merges | Screen component tests; e2e 1, 13 and 14 against stubs; M1 e2e suite through the setup screen | WP26 for e2e 15 |

Order-related files are already split by order type, so WP21 and WP24 never edit the same file. WP21 and WP22 meet only through the Phase 0 signatures.

### 9.5 Phase 2: integration (orchestrator, then verifier)

The orchestrator merges in this order: WP23 and WP24 first, then WP21 and WP22, then WP25, then WP27 to WP30, then WP26. After each merge it runs the full pipeline. It enables the integration acceptances listed in 9.4 ("Waits for"):

- the duels (WP25);
- the AI full matches in `npm test` (WP26);
- e2e 2 to 12, 15 and 16.

Defects go back to the owning package.

**Phase 2 gate (verifier):**

- everything in 8.1 that runs in `npm test` passes;
- e2e 1 to 16 pass;
- a person can play a full match against Standard to victory or defeat through the UI.

### 9.6 Phase 3: hardening (three packages in parallel, then verifier)

| WP | Owns | Delivers | Acceptance |
|---|---|---|---|
| **WP32 Balance and AI tuning** (WP25 and WP26 agents) | data, bot | Run the AI ladder and duels; tune numbers (data) and habits (bot) until 5.3, 5.5 and the AI match limits hold; update BALANCE.md (duel table, AI timings across 5 seeds, the 7:30 hand-played note) | `npm run test:long` green; BALANCE.md complete |
| **WP33 Performance and determinism** | stress.ts, perf and determinism tests, perf-browser | Battle scenario; profiling and fixes (changes in other owners' files are reviewed by the orchestrator, behaviour-preserving, proven by equal hashes before and after); conquest replay and save/load stress | 8.4 budgets; determinism tests |
| **WP34 UX pass and e2e** | tests/e2e (+ small client fixes via the owners) | Edge cases: attacking with a mixed selection including siege; repairing while unaffordable; resigning while paused; ending with the menu open; selection pruning on death; control groups with dead units; toasts during mass death. Scenario 17; suite stable over 10 consecutive runs | Edge-case tests; 10 green runs |

### 9.7 Phase 4: milestone verification (independent verifier, then owner)

The verifier runs the pipeline, `npm run test:long`, the e2e suite three times, the 8.3 manual playthrough and the 8.4 browser measurement. It reviews the gallery and reports against section 11.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Acquisition cost explodes in big fights | Staggered scans (every 10 ticks); per-scan and per-tick check budgets in operations; grid index; budgets asserted by the battle performance test |
| The path queue saturates while chasing | Re-path throttle and distance gate; direct steering under 3 tiles; test that chase requests stay under 1 per unit per 10 ticks |
| Melee units stack into one blob | Combat separation (4.7); reviewed in the screenshot gallery; hard collision deferred to M3 explicitly |
| Order-dependent combat results (low id wins) | Damage applied as a commutative sum; deaths resolved once in step 11; units at 0 hp still act; test of the same duel in both id orders |
| AI nondeterminism (Map order, shared RNG, wall-clock) | Determinism lint on `src/bot`; own RNG in memory; arrays sorted by id; save/load-restore test; two-run command-log equality |
| AI too strong or too weak for "beatable standard" | Difficulty is data in `difficulty.ts`; the ladder tests bound it; the verifier's real playthrough is the final judge; WP32 is budgeted for it |
| AI-vs-AI matches never end | Endgame targeting of villagers; all-in timers; tick-limit assertions |
| Save migration breaks old saves | Committed v1 fixture and byte-exact migrated output; structural check; refusal message unchanged for unknown versions |
| The sprite-sheet pipeline lands late or differs | It plugs in only through `AssetManifest` and the composite provider with the states in 3.8; the procedural fallback covers every state, so M2 never blocks on it; art coverage test |
| Event volume in big fights | No per-hit events; per-hit visuals derive from `lastAttackTick`, `lastDamagedTick` and projectile disappearance; `UnderAttack` throttled in the sim |
| E2E flakiness with a live AI | `?ai=off` for every combat spec except the save/load one, which is deterministic because the AI is |
| Contract drift between ten parallel packages | Phase 0 implements the shared helpers for real (damage, stats, projectiles spawn, recordStat), not just signatures; tables have one owner; changes go through the orchestrator |
| Balance tests are slow | Duels on 48×48 maps; the full AI ladder in `test:long`, which the gates still require |

## 11. Definition of done for Milestone 2

1. From the menu, the setup screen starts a match against Easy, Standard or Hard (or no opponent) with a chosen seed and player colours. Both players are Byzantine, in their slot colours, with the HUD in purple.
2. The two starts are point-symmetric with mirrored resources (map tests on 50 seeds pass).
3. Units fight with melee and ranged attacks, wind-up and cooldown, homing projectiles, damage types, armour and bonus damage. Every cell of the 5.3 counter matrix and the siege rows passes as a scripted duel.
4. Attack, attack-move, stop and hold position work from right-click, the command card and hotkeys. Aggressive and stand-ground stances behave per 4.5. Units auto-acquire and retaliate.
5. Units die with a death animation and leave corpses. Buildings show fire and smoke when damaged and leave rubble when destroyed. Health bars show for selected and damaged entities.
6. Villagers repair buildings at the 4.12 rate and cost. Town Centers shoot arrows. The 12 military upgrades are researchable and change stats.
7. The defeat rule in 4.13 ends the match; Resign works; the end screen shows victory, defeat or draw and the stats.
8. The AI meets its first-wave windows: Easy not before 15:00, Standard 10:00 to 12:00, Hard 7:00 to 8:30. It wins and loses AI-vs-AI matches within the tick limits in 8.1, defends, repairs, rebuilds, and never cheats.
9. The verifier wins a match against Standard without cheats and loses one on purpose through the UI.
10. Save and load mid-battle (state plus AI memory) continue identically. v1 saves load as sandbox matches. Replays of conquest matches reproduce exactly.
11. Performance: 200 units a side fighting averages under 4 ms per tick with p99 under 12 ms warm (first 200 ticks excluded). 60 fps at 1× (≥ 45 at 0.5×) on the battle scene.
12. Every test in section 8 passes in CI, including `npm run test:long` at the gate. The e2e suite is green three runs in a row with retries 0.
13. `docs/DESIGN.md` describes the M2 rules as implemented. `docs/BALANCE.md` records the duel results, AI timings and the 7:30 hand-played Township target.
14. The verifier's report lists no open defect that blocks any of the above.

## 12. How later milestones attach

| Later feature | Where it plugs in |
|---|---|
| Fog of war | A per-player visibility grid in `SimRuntime`, from unit `sight` (already in data). The AI would then need scouting, a new module in `src/bot/ai/` |
| Walls, gates, towers | Buildings with `combat.attack` already fire (Town Center path in `defence.ts`); walls are blocking buildings with hp |
| Garrisoning | A `garrisonedIn` field on units and capacity on buildings; Town Center arrows scale with garrison through `arrows` |
| Healing and monks | A heal order symmetric to repair; hp is already in state |
| Formations and hard collision | `movement.ts` and group slots; combat separation is the placeholder |
| Second civilization | A new civ file plus a recolourable sprite set; the AI composition tables are keyed by unit id |
| Multiplayer | Unchanged path: lockstep on `Command`s. AI controllers would run on the host only, and their commands are already ordinary commands |

### Critical Files for Implementation
- /home/user/test/src/sim/types.ts
- /home/user/test/src/data/schema.ts
- /home/user/test/src/sim/sim.ts
- /home/user/test/src/sim/serialize.ts
- /home/user/test/src/bot/economyBot.ts
