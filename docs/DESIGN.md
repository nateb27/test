# Design: rules as implemented

This file records the game rules as they actually work in code. `docs/PLAN.md` is the intent; when implementation differs or a rule is clarified, update this file in the same change.

## Status

Phase 0 (scaffold and contracts) only. No game rules are implemented yet; the sim creates the initial state and advances the tick.

## Contract decisions made in Phase 0

- **Build command places the foundation immediately.** When a `build` command is applied, the sim validates with `canPlace`, deducts the cost, creates the foundation and gives each unit a `build` order referencing it. `assist` on an unfinished building behaves the same as `build`; `assist` on a completed farm becomes a `gather` order on it.
- **Farms are buildings** with a `farm` ability; `gather` orders target either a resource node or a completed farm building.
- **Path requests are atomic.** A request is started only while budget remains and always completes within the tick, so no partial A* state is saved. The queue (`state.pathQueue`) and `occupancyVersion` are in state so save/load continues identically.
- **Cheats are commands** (`type: 'cheat'`) and cheat flags live in `PlayerState.cheats`, so replays and saves stay exact. The client only exposes them in dev/e2e builds.
- **Production timing**: each queue item stores integer `ticksDone`/`ticksTotal`; `ticksTotal = max(1, round(seconds * TICK_RATE))` fixed at enqueue. Construction progress is a float in [0, 1] (multi-builder speed is fractional), clamped to exactly 1 on completion.
- **Modifier selection**: a modifier matches a def if the def's id is in `select.ids` OR the def has any tag in `select.tags`. Resolution: base, then civ, then tech modifiers; all `add` before all `mul`. Resolved costs are rounded with `Math.round`.
- **Player ids** equal their index in `players`; 0 is the neutral owner of resource nodes (`civ: null`), real players are 1..n.
- **Save format**: canonical JSON of `{ version, state }`; unknown versions are refused.

## Rules

(Filled in by Phase 1+ work packages.)

## WP1 (sim core) rules

- **Command intake.** Commands sort by `(playerId, seq)` (stable). A command is dropped with `CommandRejected('invalidCommand')` before dispatch if its type is unknown, `playerId` is not a real player (1..n), `seq` is not an integer, a number is not finite, an id is not a positive integer, an id list is empty, or a required string/flag is missing. Rule checks (ownership, cost, placement) belong to the handlers.
- **Map generation.** Defs are found through the registry: the Town Center is `start.centerBuilding`; node defs are chosen by `gatherKind` (`wood`, `berries`, `gold`, `stone`), not by id. A kind with no def is skipped. Attempt k uses `rng = createRng(seed + k)`; `state.mapSeed` is the final seed (up to 24 attempts, then the last map is kept).
- **Start positions.** One player: a corner start chosen by the seed; two players: opposite corners. Each start gets 0..8 tiles of inward jitter. Edge distance is `min(25, floor(size / 4))` (25 on the 120 map), measured to the Town Center centre.
- **Clear radius.** Nothing is generated within 8 tiles of a Town Center centre except the two guaranteed berry patches, which the plan places at 6 to 10 tiles. Gold (10 to 14), stone (12 to 16) and the three tree stands (8 to 14) are outside it. Distances are node centre to Town Center centre.
- **Clusters.** Berries: 3x2 or 2x3 block; gold: 2x2 block of deposits; stone: L of three deposits; tree stands and forests: seeded blobs. Different clusters are separated by at least one free tile, and every blob tile keeps an open edge neighbour. Forests keep 15 tiles from starts and cover about 12% of tiles. Extra gold, stone and berry clusters (4, 3, 4 on 120x120, scaled by area) keep 20 tiles from starts and 14 from each other.
- **Validation.** 4-connected flood fill from the first Town Center must reach at least 95% of free walkable tiles; every Town Center, starting unit and guaranteed node must have a reachable edge-adjacent tile.
- **Starting units** stand on the ring of tiles around the Town Center, evenly spaced from a seeded offset, facing 1.
- **Delete.** All-or-nothing per command: unknown id gives `unknownEntity`, a foreign or neutral id gives `notOwner`. Unfinished buildings refund `costPaid` immediately; removal itself happens in cleanup.
- **Cleanup.** Removes depleted nodes (`amount <= 0`) and `pendingRemoval`, emits `ResourceNodeDepleted`, calls `endCurrentOrder` for removed units, clears their gatherer/builder slots and path requests, frees blocking footprints and bumps `occupancyVersion`. Orders of surviving units that point at a removed entity are not touched: order handlers treat a missing target as retarget-or-finish.
- **Queries.** `entitiesInRect` and `entityAtPoint` use half-open footprints `[tx, tx+size)`; units use `UNIT_PICK_RADIUS` (rect test: distance from the unit to the rect).
- **spawnUnit cheat** creates the unit at the exact point; rejects unknown unit types (`unknownDef`) and out-of-map or blocked tiles (`invalidTarget`).
