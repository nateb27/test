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
