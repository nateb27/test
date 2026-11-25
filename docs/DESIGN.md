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

## WP3: renderer and placeholder art

- **Layers** (all in world-pixel space, moving with the camera, back to front): `terrain` (16x16-tile baked chunks, at most 30 live, off-screen ones hidden), `groundOverlays` (empty, for WP10 rings/placement/rally), `entities` (depth sorted), `worldOverlays` (empty, for WP10 bars/markers). Exposed as `renderer.layers`.
- **Depth**: sprites sort by `x + y` of the anchor (unit interpolated position, footprint centre for buildings and nodes), ties by id. Footprints and sprite ids come from `registry.def(typeId)` and fall back to `DEFAULT_FOOTPRINT` / `'<kind>.<typeId>'` when a def is missing.
- **Animation state** is derived from the unit: moving (pos differs from prevPos, or a path is being followed) is `walk`, or `carry` when carrying; gather `harvesting` and build/assist `building` phases are `work`; otherwise `idle`. Buildings under construction show `foundation` below 30% progress, `scaffold` after.
- **Team colour**: sprites are generated per team colour on demand (`teamSprite(id, primary, secondary)`); the default purple/gold set is generated at load. `sprite(id)` returns the default team.
- **Facings**: 5 views are drawn (S, SE, E, NE, N); SW, W and NW are mirrors. S and N are their own mirror images, so this is the minimum for 8 facings.
- **Picking**: hit boxes are tighter than the textures; units win over buildings over nodes, then front-most. `pickEntity` uses the entities drawn on the last frame.
- **Camera**: wheel zoom 0.5x-2x about the cursor, middle-drag, arrows and WASD, 6 px edge scroll, clamped to the map's screen bounds plus 96 px. WASD collides with the QWERT/ASDFG command-card hotkeys; `cameraInput.setWasd(false)` turns it off.
- **Unknown ids** never throw: sprites fall back to a magenta "?" tile, icons to a magenta "?" icon; unknown `icon.tech.*` ids get a generic scroll glyph with initials.
- Dev pages (not in the production build): `src/client/render/dev/scene.html` and `sheet.html` under `npm run dev`.
