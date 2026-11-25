# Conventions for agents

Browser 2D isometric RTS. Spec: `docs/PLAN.md`. Rules as implemented: `docs/DESIGN.md`.

## Commands

```
npm run dev        # Vite dev server (window.__game available)
npm run typecheck  # tsc, strict
npm run lint       # ESLint incl. boundary and determinism rules; 0 warnings allowed
npm test           # Vitest: tests/unit/** and tests/sim/**
npm run build      # typecheck + production build to dist/ (relative paths, base './')
npm run e2e        # Playwright against `vite build --mode e2e` (dist-e2e/), with window.__game
```

Run Playwright with `--trace off` (the script already does). E2E tests pin the map with `?seed=N`, start paused and move time only with `__game.step` / `__game.advanceClock` (see "E2E determinism" in `docs/DESIGN.md`); never add sleeps, retries or fixed click positions. Do not run `playwright install` in the dev container; the config uses `/opt/pw-browsers/chromium` when present.

## Architecture in one paragraph

`src/sim` is a pure, deterministic simulation advanced only by `sim.step(commands)`. `src/client` draws read-only state (`DeepReadonly<GameState>`) and turns input into `Command`s via `CommandBuffer`; it never writes state. Client-only state (camera, selection, placement, menus, pause, speed) lives outside the sim and is never saved or hashed. `src/data` holds content definitions; balance numbers live only there.

Dependency directions: `data -> sim/types` (type imports only); `sim -> data`; `client -> sim, data`; `bot -> sim, data`. Nothing imports `client` except `src/main.ts`. Lint enforces this.

## Determinism rules (everything under `src/sim/`)

1. No `Math.random`, `Date`, `performance`, timers, DOM, I/O, `Intl`/locale functions. Randomness only from `src/sim/rng.ts` using `state.rng`.
2. Math: only `+ - * /`, `Math.sqrt/floor/ceil/round/trunc/abs/min/max` (and Math constants). No `**`, no trig, no `atan2` (derive facing from dx/dy signs and magnitudes).
3. Iterate entities in ascending id (`state.entities` is sorted; ids are never reused).
4. Break every tie by lowest entity id, then lowest tile index (`ty * width + tx`).
5. No reliance on object key order or Map/Set order surviving save/load; budgets count operations, never milliseconds.
6. Never store `NaN`, `Infinity`, `-0`, `undefined`, class instances, Map/Set or typed arrays in state. Guard divisions. `canonicalJson` throws on these, so tests catch them.
7. Player resources and carried amounts are integers; fractions live in accumulators (`harvestAccumulator`, `incomeAccumulator`). Production times are integer `ticksTotal` fixed at enqueue.
8. Data durations are seconds; convert with `TICK_RATE` (20). Commands issued during tick T apply at the start of tick T+1.
9. Tick order (`src/sim/sim.ts`) is fixed: commands, production, income, orders, pathfinding, movement, construction, cleanup, objectives, `tick++`.

## Coordinates

- World space is tiles with fractional positions. Tile `(tx, ty)` covers `[tx, tx+1) x [ty, ty+1)`; the middle of tile (3,5) is (3.5, 5.5).
- Buildings and nodes store `tile` = top-left of a square footprint; their anchor is the footprint centre.
- Projection (only in `src/client/render/iso.ts`): `screenX = (x - y) * 32`, `screenY = (x + y) * 16`. +x is down-right, +y is down-left. Draw order: `x + y` of the anchor, ties by id.
- Facing 0..7: 0=+x(SE) 1=+x+y(S) 2=+y(SW) 3=W 4=NW 5=N 6=NE 7=E (clockwise on screen).
- The sim never uses screen coordinates.

## Contract files

`src/sim/types.ts` and `src/data/schema.ts` are the contracts every work package builds against. **Change them only via the orchestrator**: request the change, do not edit them in a WP branch. The same applies to the shared plumbing signatures: `SimContext`, `OrderHandler`, `CommandHandler`, the command handler table in `src/sim/systems/commands.ts`, and the client interfaces `AssetManifest`, `WorldRenderer`, `SaveStorage`, `PlatformWindow`, `HudViewModel`, `GameDebugHook`.

## Directory ownership

| Path | Owner |
|---|---|
| `src/sim/sim.ts`, `rng.ts`, `hash.ts`, `serialize.ts`, `entities.ts`, `runtime.ts`, `query.ts`, `map/`, `systems/commands.ts`, `systems/cleanup.ts`, `systems/cheats.ts`, `systems/common.ts` | WP1 Sim core |
| `src/sim/path/`, `systems/orders/index.ts`, `systems/orders/move.ts`, `systems/movement.ts` | WP2 Pathfinding |
| `src/client/render/`, `src/client/art/` | WP3 Renderer and art |
| `src/data/` (except `schema.ts`) | WP4 Content |
| `src/client/input/` (except `input/placement`) | WP5 Input |
| `systems/orders/gather.ts`, `systems/orders/dropOff.ts` (+ any `systems/gather*`) | WP6 Gathering |
| `systems/construct.ts`, `systems/orders/build.ts`, `rules/placement.ts` | WP7 Construction |
| `systems/production.ts`, `research.ts`, `population.ts`, `income.ts`, `objectives.ts`, `rules/availability.ts`, `rules/stats.ts` | WP8 Production |
| `src/client/ui/` (except `ui/minimap`) | WP9 HUD |
| `src/client/ui/minimap`, `render/overlays`, `input/placement` | WP10 |
| `src/bot/` | WP11 |
| `src/client/app/`, `src/client/platform/`, `src/client/debug/`, configs, CI | orchestrator |

Stubs are marked `STUB` / `TODO(WPn)` in their doc comments. Replace the body; keep the exported signature.

## Definition of done (per work package)

1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e` all pass.
2. The WP's acceptance tests from `docs/PLAN.md` section 10 exist and pass.
3. No edits outside owned directories (contract changes requested from the orchestrator).
4. Rules that changed are recorded in `docs/DESIGN.md` in the same change.
5. The phase verifier, not the builder, decides the phase is done.
