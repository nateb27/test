# Conventions for agents

Browser 2D isometric RTS. Spec: `docs/PLAN.md` (Milestone 1, done) and `docs/PLAN-M2.md` (Milestone 2: combat and a computer opponent). Rules as implemented: `docs/DESIGN.md` (M2 contracts: "M2 contract decisions").

## Commands

```
npm run dev        # Vite dev server (window.__game available)
npm run typecheck  # tsc, strict
npm run lint       # ESLint incl. boundary and determinism rules; 0 warnings allowed
npm test           # Vitest: tests/unit/** and tests/sim/** (without *.long.test.ts)
npm run test:long  # the long-running sim tests (tests/sim/**/*.long.test.ts); run by the phase gates and nightly CI
npm run build      # typecheck + production build to dist/ (relative paths, base './')
npm run e2e        # Playwright against `vite build --mode e2e` (dist-e2e/), with window.__game
npm run art:palette  # refit the shared 256-colour palette of the rendered art (after big material/light changes)
npm run art:units    # re-render unit sprite sheets in Blender (incremental; needs scripts/art/.venv, see scripts/art/README.md)
npm run art:trees    # re-render tree and berry-bush sheets
npm run art:sheets   # re-pack sheets from the render cache (after art:palette)
```

Art: `?art=rendered` (default in dev/production: units, trees and bushes from the pre-rendered sheets in `src/client/art/sheets/`, everything else from the in-browser voxel renderer) or `?art=fast` (procedural, default in the e2e build); see "Rendered art" in `docs/DESIGN.md`. Sheets are generated offline (`scripts/art/`, Blender; never in CI) and committed; light, tone map and team constants live in `src/client/art/rendered/artConstants.json`, shared by both renderers.

Run Playwright with `--trace off` (the script already does). E2E tests pin the map with `?seed=N`, start paused and move time only with `__game.step` / `__game.advanceClock` (see "E2E determinism" in `docs/DESIGN.md`); never add sleeps, retries or fixed click positions. Do not run `playwright install` in the dev container; the config uses `/opt/pw-browsers/chromium` when present.

## Architecture in one paragraph

`src/sim` is a pure, deterministic simulation advanced only by `sim.step(commands)`. `src/client` draws read-only state (`DeepReadonly<GameState>`) and turns input into `Command`s via `CommandBuffer`; it never writes state. Client-only state (camera, selection, placement, menus, pause, speed) lives outside the sim and is never saved or hashed. `src/data` holds content definitions; balance numbers live only there.

Dependency directions: `data -> sim/types` (type imports only); `sim -> data`; `client -> sim, data`; `bot -> sim, data`. Nothing imports `client` except `src/main.ts`. Lint enforces this.

## Determinism rules (everything under `src/sim/` and `src/bot/`)

1. No `Math.random`, `Date`, `performance`, timers, DOM, I/O, `Intl`/locale functions. Randomness only from `src/sim/rng.ts` using `state.rng` (the AI uses its own stream from `createRng`, kept in its memory; it never touches `state.rng`).
2. Math: only `+ - * /`, `Math.sqrt/floor/ceil/round/trunc/abs/min/max` (and Math constants). No `**`, no trig, no `atan2` (derive facing from dx/dy signs and magnitudes).
3. Iterate entities in ascending id (`state.entities` is sorted; ids are never reused).
4. Break every tie by lowest entity id, then lowest tile index (`ty * width + tx`).
5. No reliance on object key order or Map/Set order surviving save/load; budgets count operations, never milliseconds.
6. Never store `NaN`, `Infinity`, `-0`, `undefined`, class instances, Map/Set or typed arrays in state. Guard divisions. `canonicalJson` throws on these, so tests catch them.
7. Player resources and carried amounts are integers; fractions live in accumulators (`harvestAccumulator`, `incomeAccumulator`). Production times are integer `ticksTotal` fixed at enqueue.
8. Data durations are seconds; convert with `TICK_RATE` (20). Commands issued during tick T apply at the start of tick T+1.
9. Tick order (`src/sim/sim.ts`, PLAN-M2 2.2) is fixed: 1 commands, 2 production, 3 income, 4 acquisition (rebuilds the spatial index), 5 orders, 6 pathfinding, 7 movement, 8 attacks (8a units, 8b buildings), 9 projectiles, 10 construction (and repair), 11 death then cleanup, 12 outcome then objectives, 13 `tick++`. Damage lowers hp at once (clamped at 0); nothing is removed before step 11.

## Coordinates

- World space is tiles with fractional positions. Tile `(tx, ty)` covers `[tx, tx+1) x [ty, ty+1)`; the middle of tile (3,5) is (3.5, 5.5).
- Buildings and nodes store `tile` = top-left of a square footprint; their anchor is the footprint centre.
- Projection (only in `src/client/render/iso.ts`): `screenX = (x - y) * 32`, `screenY = (x + y) * 16`. +x is down-right, +y is down-left. Draw order: `x + y` of the anchor, ties by id.
- Facing 0..7: 0=+x(SE) 1=+x+y(S) 2=+y(SW) 3=W 4=NW 5=N 6=NE 7=E (clockwise on screen).
- The sim never uses screen coordinates.

## Contract files

`src/sim/types.ts` and `src/data/schema.ts` are the contracts every work package builds against. **Change them only via the orchestrator**: request the change, do not edit them in a WP branch. The same applies to the shared plumbing signatures: `SimContext`, `OrderHandler`, `CommandHandler`, the command and order handler tables (`src/sim/systems/commands.ts`, `src/sim/systems/orders/index.ts`), the M2 shared helpers of PLAN-M2 3.5 (`systems/combat/damage.ts`, `combat/spatial.ts` signatures, `spawnProjectile`, `recordStat`, `directPath`), the bot `Controller` interface (`src/bot/controller.ts`), and the client interfaces `AssetManifest`, `WorldRenderer`/`WorldRendererApi`, `SaveStorage`, `PlatformWindow`, `HudViewModel`, `GameDebugHook`.

## Directory ownership (Milestone 2, PLAN-M2 9.2)

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

Other M1 files keep their M1 owners below; M1 work packages are finished, so the orchestrator holds those files. Configs and CI stay with the orchestrator.

### Milestone 1 ownership (for reference)

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

Stubs are marked `STUB` / `TODO(WPn)` in their doc comments (M2: `TODO(WP21)` ... `TODO(WP30)`). Replace the body; keep the exported signature.

## Definition of done (per work package)

1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e` all pass.
2. The WP's acceptance tests from `docs/PLAN.md` section 10 (M2: `docs/PLAN-M2.md` sections 8 and 9.4) exist and pass.
3. No edits outside owned directories (contract changes requested from the orchestrator).
4. Rules that changed are recorded in `docs/DESIGN.md` in the same change.
5. The phase verifier, not the builder, decides the phase is done.
