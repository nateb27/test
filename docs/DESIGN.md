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

### WP2: pathfinding and movement

- **A\***: 8-connected, integer costs 10 straight / 14 diagonal, octile heuristic to the goal rectangle. A diagonal step needs both orthogonal tiles walkable (no corner cutting). Open-list ties: lowest f, then lowest h, then lowest tile index. Walkable = in bounds and `runtime.occupancy` is 0 (terrain walkability is not consulted; M1 is all grass).
- **Goals**: a `point` goal is the tile containing the (clamped) point; a `footprint` goal is any tile in the 8-connected ring around the footprint, corners included.
- **Unreachable goal**: the path leads to the expanded tile with the lowest octile distance to the goal, ties by lowest path cost, then lowest tile index.
- **Blocked start** (unit standing on a fresh foundation): the search starts from the nearest walkable tile (squared distance, ties by tile index) and the unit walks there first.
- **Smoothing**: greedy string pulling over the A* tiles; a segment is kept only if an integer supercover walk between tile centres touches only walkable tiles, and a segment passing exactly through a tile corner also needs both side tiles walkable. Waypoints are tile centres without the start tile; a reached `point` goal ends at the exact point.
- **Request queue**: FIFO, budget `PATH_BUDGET_PER_TICK` expanded nodes per tick. Each search is capped at the remaining budget; if it would exceed it, its result is discarded and the request stays at the head of the queue for the next tick (a discarded search's expansions still count, so a tick never exceeds the budget). The first search of a tick runs with the full budget and is always used (if it is still capped, its best partial path is used; impossible on 120x120). The search starts from the unit's current tile (it stood still while waiting).
- **Following**: walking orders call `followPath(ctx, unit, goal)` every tick (`path/follow.ts`). When `occupancyVersion` changed since the path was computed, all remaining segments are re-checked; if any is blocked a new path is requested, otherwise the path's version is refreshed. Movement also stops a unit whose next segment became blocked.
- **Approach tile**: walkable ring tile in the same connected component as the origin's tile (any walkable ring tile if the origin's tile is blocked, e.g. a building centre), nearest by squared distance from the origin to the tile centre, ties by tile index; `null` if none.
- **Group move slots**: walkable tiles ordered by squared tile distance from the clicked tile, ties by tile index, restricted to the clicked tile's component when that tile is walkable. Slot 0 is the exact clicked point when its tile is walkable, others are tile centres. Units sorted by squared distance to the clicked point (ties by id) take slots in order, so the nearest unit gets the clicked point. Slots repeat only if the component is smaller than the group.
- **Commands**: `move` and `stop` are all-or-nothing: any unknown id rejects with `unknownEntity`, a foreign id with `notOwner`, a non-unit with `cannotPerform` (first failing id in ascending order); `move` with non-finite coordinates rejects with `invalidCommand`. Duplicate ids are ignored.
- **Movement**: speed = resolved `speed` stat from the runtime cache, else the unit def, else 1 tile/s; a unit may pass several waypoints in one tick. Facing comes from the tick's displacement: a component counts when it exceeds 0.4x the other (octant boundary ~22 degrees).
- **Separation**: only idle units (no order, empty queue, no path, no pending request). Pairs closer than `SEPARATION_RADIUS` each move half the overlap apart (coincident units split along one of 8 directions picked by `higherId % 8`); pushes are summed then applied, and a push ending on a blocked tile is skipped. Pairs are found with a per-tick tile hash (scratch, not state).
