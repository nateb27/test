# RTS Game — Milestone 1 Plan

Status: plan only, no code written. Audience: the coding agents who will build this, and the orchestrator who assigns their work.

## 1. What Milestone 1 is

A browser-based, 2D isometric, historical real-time strategy game in the 4-age, gather-build-train genre. Milestone 1 (M1) delivers:

- The game loads from a URL: main menu → civilization select (Byzantines only) → match.
- One fixed-size all-grass map with resource nodes placed on it, and a working minimap.
- One playable civilization, the Byzantines, with the **complete economy loop**: gather four resources, construct buildings, train units, hit and raise the population cap, research technologies, advance through all four ages.
- Military units can be trained, selected and moved. They cannot fight.

### Explicitly out of scope for M1

Combat, damage, death, enemy players, AI, fog of war, terrain types other than grass, elevation, water, walls/towers/defences, healing/repair, trade, animals/hunting, audio, multiplayer networking, real art, a second civilization, map editor, campaign.

The architecture must not block any of these. Section 12 lists where each one plugs in.

### Decisions already made by the project owner

| Topic | Decision |
|---|---|
| Platform | Browser now; must stay wrappable as a desktop app (Tauri/Electron) later |
| View | 2D isometric, 2:1 diamond tiles |
| Multiplayer | Single-player now, but the simulation is deterministic, fixed-tick and command-driven so lockstep multiplayer, replays and saves are possible later |
| M1 scope | Full economy loop, no combat |
| Art | Code-drawn placeholder art behind an asset pipeline that allows real art to be swapped in without code changes |
| Civ depth | A shared base roster plus a small set of Byzantine uniques |
| Resources | Food, wood, gold, stone |
| Map | Fixed-size grass map, seeded resource placement, minimap, no fog |

### Defaults chosen by the planner (owner may override before work starts)

1. Stack: TypeScript (strict), Vite, PixiJS v8 for the world, Preact for the HUD, Vitest, Playwright, ESLint, npm.
2. Simulation runs at 20 ticks/second on the main thread; rendering interpolates.
3. Map is 120×120 tiles.
4. Age names are placeholders: **Founding Age, Township Age, Citadel Age, Empire Age**.
5. Save/load is included (it is nearly free given the architecture and the tests need it).
6. No audio in M1; the sim emits events an audio layer can subscribe to later.
7. All content is an original design drawn from history. Do not copy unit rosters, stat tables, technology names, icons, UI layout or art from any existing game.
8. All balance numbers in section 5 are starting values and live only in data files.
9. The game has no title yet. Use `rts` as the package name and "Untitled RTS" in the menu.

## 2. Architecture

### 2.1 The one rule that matters

The codebase is split into a **simulation** that knows nothing about the screen, and a **client** that draws it and feeds it commands.

```
            commands                    read-only state + events
 input ───────────────▶  SIMULATION  ───────────────────────────▶ renderer, HUD, minimap
 (client)                (pure, deterministic)                     (client)
```

- The simulation is advanced only by `step(state, commands)`. Nothing else mutates game state.
- The client never writes to game state. Clicking a button creates a `Command`; the sim validates and applies it on the next tick.
- Client-only state (camera, selection, control groups, placement ghost, open menus) lives outside the sim and is never serialized into saves or hashes.

This split is what gives save/load, replays, headless tests, a headless balance bot and a later path to multiplayer. It is enforced by lint rules (section 9.2), not by convention.

### 2.2 Determinism rules for everything under `src/sim/`

Same initial state + same command list must produce a bit-identical state on any machine.

1. No `Math.random`, `Date`, `performance`, timers, DOM, or I/O. Randomness comes from the seeded PRNG stored in game state.
2. Arithmetic is limited to `+ - * /`, `Math.sqrt`, `Math.floor`, `Math.ceil`, `Math.round`, `Math.trunc`, `Math.abs`, `Math.min`, `Math.max`. Every other `Math` function (`sin`, `cos`, `atan2`, `pow`, `exp`, `log`, `hypot`, …) is banned, because their results may differ between JavaScript engines. Facing directions are derived by comparing `dx` and `dy`, not by `atan2`.
3. Entities are always iterated in ascending id order. Ids are allocated from a monotonically increasing counter in game state and never reused.
4. Any tie (nearest resource, nearest drop-off, equal path cost) is broken by lowest entity id, then lowest tile index.
5. No dependence on object key order, on `Set`/`Map` insertion order surviving a save/load, or on wall-clock time budgets. Work budgets are counted in operations per tick, never in milliseconds.
6. No `NaN`, no `Infinity`, no `-0` stored in state. Guard divisions.

### 2.3 Time

- `TICK_RATE = 20`. One tick = 50 ms of game time.
- Data files express durations in seconds and rates per second; the sim converts using `TICK_RATE`. No tick counts in data files.
- The client loop accumulates real time and runs zero or more ticks per frame (capped at 5 to avoid a spiral after a tab stall). Game speed (1×, 1.5×, 2×) and pause change how fast the accumulator fills; they are client settings, not sim state.
- Commands issued during tick `T` are applied at the start of tick `T+1`. (A multiplayer build will increase this delay; nothing else changes.)
- Rendering interpolates unit positions between the previous and current tick.

### 2.4 Coordinates

- World space is measured in tiles, with fractional positions. Tile `(i, j)` covers `[i, i+1) × [j, j+1)`. Unit positions are `{x, y}` floats; a unit standing in the middle of tile (3,5) is at (3.5, 5.5).
- Projection, with `TILE_W = 64`, `TILE_H = 32`:
  `screenX = (x − y) × 32`, `screenY = (x + y) × 16`.
  The inverse is used for mouse picking. +x runs down-right on screen, +y runs down-left.
- Draw order key is `x + y` of the entity's anchor (footprint centre for buildings and nodes), ties broken by id.
- All projection maths lives in one module (`src/client/render/iso.ts`). The sim never uses screen coordinates.

### 2.5 Game state shape

Plain JSON-serializable data only: no classes, no functions, no `Map`/`Set`, no typed arrays inside state (the occupancy grid is a derived cache rebuilt on load).

```ts
interface GameState {
  tick: number;
  seed: number;
  rng: RngState;
  nextEntityId: number;
  map: { width: number; height: number; tiles: TerrainId[] }; // 'grass' only in M1
  players: PlayerState[];        // index 0 is the neutral owner of resource nodes
  entities: Entity[];            // kept sorted by id
  objectives: ObjectiveState;
}

interface PlayerState {
  id: number; civ: CivId; color: number;
  resources: { food: number; wood: number; gold: number; stone: number };
  age: 1 | 2 | 3 | 4;
  popUsed: number; popCap: number;
  researched: TechId[];
  // derived stat cache is rebuilt on load, not stored
}

type Entity = UnitEntity | BuildingEntity | ResourceNodeEntity;
```

- `UnitEntity`: id, typeId, owner, pos, prevPos, facing (0–7), order queue, current order state, path, carried resource `{type, amount}`.
- `BuildingEntity`: id, typeId, owner, tile origin, construction progress (0–1) and assigned builders, production/research queue, rally point, passive-income accumulator.
- `ResourceNodeEntity`: id, typeId, tile origin, amount remaining, current gatherer ids.

Derived caches (occupancy grid, spatial hash, per-player resolved stats) live in a `SimRuntime` object beside the state, are rebuilt by `rebuildRuntime(state)`, and are excluded from hashes and saves.

### 2.6 Commands and events

Commands are the only input to the sim. Every command is validated inside the sim; an invalid command is dropped and produces a `CommandRejected` event with a reason code the HUD turns into a toast.

```ts
type Command =
  | { type: 'move';      unitIds: Id[]; x: number; y: number; queue: boolean }
  | { type: 'gather';    unitIds: Id[]; nodeId: Id; queue: boolean }
  | { type: 'build';     unitIds: Id[]; buildingType: BuildingId; tx: number; ty: number; queue: boolean }
  | { type: 'assist';    unitIds: Id[]; buildingId: Id; queue: boolean }   // help construct, or work a farm
  | { type: 'dropOff';   unitIds: Id[]; buildingId: Id }
  | { type: 'stop';      unitIds: Id[] }
  | { type: 'train';     buildingId: Id; unitType: UnitId }
  | { type: 'research';  buildingId: Id; techId: TechId }                  // age advances are techs
  | { type: 'cancelQueue'; buildingId: Id; index: number }
  | { type: 'cancelConstruction'; buildingId: Id }
  | { type: 'setRally';  buildingIds: Id[]; x: number; y: number; targetId?: Id }
  | { type: 'delete';    entityIds: Id[] };
// every command also carries { playerId, seq }
```

Events emitted per tick for the client (notifications, future audio): `UnitTrained`, `BuildingPlaced`, `BuildingCompleted`, `ResearchCompleted`, `AgeAdvanced`, `ResourceNodeDepleted`, `VillagerIdle`, `PopulationCapped`, `CommandRejected`, `ObjectiveCompleted`.

### 2.7 Tick order

Fixed; do not reorder without updating the determinism tests.

1. Apply commands, sorted by `(playerId, seq)`.
2. Production and research queues.
3. Passive income.
4. Unit order state machines, ascending id (may enqueue path requests).
5. Pathfinding queue, up to the per-tick budget, in request order.
6. Movement integration and idle-unit separation.
7. Construction progress.
8. Cleanup: remove depleted nodes and deleted entities, update occupancy, recompute population.
9. Objectives check, flush events, `tick++`.

### 2.8 Public sim API

```ts
createGame(config: { seed: number; mapSize: number; players: { civ: CivId }[] }): Sim
sim.step(commands: Command[]): SimEvent[]
sim.state: Readonly<GameState>
sim.query: { entityById, entitiesInRect, entityAtPoint, availability(playerId, defId),
             canPlace(playerId, buildingType, tx, ty), resolvedStat(playerId, defId, stat) }
serialize(sim): string         // canonical JSON
deserialize(json: string): Sim
hashState(state): string       // canonical JSON → 32-bit FNV-1a, hex
```

`availability` and `canPlace` are the same functions the sim uses for validation, so the HUD's greyed-out buttons and red placement ghost can never disagree with the rules.

## 3. Repository layout

```
/
  CLAUDE.md                  conventions for agents (written in Phase 0)
  docs/PLAN.md               this file
  docs/DESIGN.md             game rules as implemented; updated when rules change
  index.html
  package.json, tsconfig.json, vite.config.ts, eslint.config.js, playwright.config.ts
  .github/workflows/ci.yml
  src/
    sim/                     deterministic simulation. No imports from client/.
      types.ts               GameState, Entity, Command, SimEvent (the contract)
      sim.ts                 createGame, step, tick order
      rng.ts  hash.ts  serialize.ts
      map/                   grid, occupancy, mapgen
      path/                  A*, heap, smoothing, request queue
      systems/               commands, orders, movement, gather, construct, production,
                             research, income, population, objectives
      rules/                 availability, placement, stat resolution (modifiers)
    data/                    content definitions. Imports types only.
      schema.ts              UnitDef, BuildingDef, TechDef, AgeDef, CivDef, NodeDef, Modifier
      units.ts buildings.ts techs.ts ages.ts nodes.ts
      civs/byzantines.ts
      index.ts               registry + lookups
    client/
      app/                   boot, screen router (menu / civ select / loading / game), game loop
      render/                iso.ts, camera, terrain chunks, entity layer, overlays, interpolation
      art/                   asset manifest + procedural placeholder generator
      input/                 pointer + keyboard, selection, placement mode, hotkey map
      ui/                    Preact HUD: resource bar, selection panel, command card,
                             minimap, tooltips, toasts, menus
      platform/              storage and windowing behind interfaces (browser impl now)
      debug/                 dev overlay, cheats, window.__game test hooks
    bot/                     headless scripted economy bot (uses only the public sim API)
  tests/
    unit/                    Vitest, mirrors src/
    sim/                     determinism, replay, save/load, bot runs
    e2e/                     Playwright
```

Dependency directions: `data → sim/types`; `sim → data`; `client → sim, data`; `bot → sim, data`. Nothing imports `client` except the entry point.

## 4. Simulation systems

### 4.1 Map and occupancy

- 120×120 tiles, every tile `grass`. The `tiles` array and a `TerrainDef` table (walkable, buildable, minimap colour) exist now so new terrain types are data, not a refactor.
- Occupancy grid: one byte per tile. Blocking: buildings (from the moment the foundation is placed), trees, gold and stone deposits, berry bushes. Not blocking: farms, units.
- A monotonically increasing `occupancyVersion` lets units detect that their path may be stale.

### 4.2 Map generation (seeded)

Inputs: seed, map size, start positions. Output: resource node entities and the starting base.

- Start position at least 25 tiles from any edge. A clear, buildable radius of 8 tiles around the Town Center.
- Guaranteed near the start: 2 berry patches (6 bushes each) at 6–10 tiles; 1 gold cluster (4 deposits) at 10–14 tiles; 1 stone cluster (3 deposits) at 12–16 tiles; 3 small tree stands at 8–14 tiles.
- Rest of map: forests grown as seeded blobs covering roughly 12% of tiles; additional gold, stone and berry clusters scattered with a minimum spacing.
- Validation after generation: flood-fill from the Town Center must reach at least 95% of walkable tiles and every guaranteed resource must have a reachable adjacent tile. If not, regenerate with `seed + 1`.
- Starting units: 1 Town Center, 6 villagers. Starting stockpile: 200 food, 200 wood, 100 gold, 0 stone.

### 4.3 Pathfinding and movement

- A* on the 8-connected tile grid with a binary heap, octile heuristic, no cutting corners past blocked tiles.
- Path smoothing by line-of-sight string pulling (grid ray-walk using integer steps; no trigonometry).
- Requests are queued and processed in order with a fixed per-tick budget counted in expanded nodes (start at 20,000 per tick). A unit waiting for a path stands still.
- Unreachable goal: path to the reachable tile nearest the goal.
- "Approach tiles": a shared helper returns the nearest reachable walkable tile adjacent to a footprint. Used for gathering, building, dropping off and rallying.
- Stale paths: before stepping toward the next waypoint, a unit checks that the segment is still walkable; if not, it requests a new path.
- Group move: the destination is expanded into deterministic slots in a spiral around the clicked point so units do not stack.
- Unit-to-unit collision in M1 is deliberately minimal: moving units pass through each other; idle units closer than 0.3 tiles push apart (spatial hash lookup). Hard collision and formations are a combat-milestone concern.
- Facing is one of 8 directions chosen from the sign and relative magnitude of `dx`, `dy`.

### 4.4 Orders

Each unit has a queue of orders (shift-click appends) and a state machine for the current one.

- **Move**: follow path, then idle.
- **Gather**: walk to node → harvest at the resolved gather rate until carrying capacity is reached → walk to the nearest valid drop-off for that resource (path distance approximated by straight-line distance, ties by id) → deposit → return. If the node is depleted, retarget the nearest node of the same resource within 8 tiles of the depleted one; otherwise go idle and emit `VillagerIdle`. Switching to a different resource type discards what is carried.
- **Build**: walk to the foundation → contribute build progress. On completion, auto-continue: builders of a Lumber Camp, Mining Camp or Mill start gathering the nearest matching resource; the builder of a Farm starts working it; otherwise take the next queued order or go idle.
- **Drop off**: walk to the building, deposit, idle.
- Node limits: 1 gatherer per tree and per berry bush, 1 per farm, 6 per gold or stone deposit. A villager finding its node full retargets as if it were depleted.

### 4.5 Construction

- Placement validity: footprint in bounds, every tile buildable and unoccupied, building available to the player (age, prerequisites, civ, build limit), cost affordable.
- Cost is deducted when the foundation is placed. Cancelling an unfinished building refunds 100%.
- The foundation blocks pathing immediately; any unit inside the footprint is moved to the nearest free tile.
- Build speed with `n` builders is `1 + 0.5 × (n − 1)` times the single-builder speed.
- Unfinished buildings provide nothing (no population, no drop-off, no production).

### 4.6 Production, population and rally points

- Each producing building has a queue of up to 10 items (units and techs share it). Cost is deducted on enqueue and refunded in full on cancel.
- A unit finishing while the player is at the population cap holds at 100% and emits `PopulationCapped` once; it spawns as soon as room exists.
- Spawn at the free tile adjacent to the building nearest the rally point. Rally on ground → move there. Rally on a resource node or farm → villagers gather it.
- Population cap = sum of completed buildings' `popProvided`, hard-capped at 200. Population used = sum of `popCost` of living units plus units in production.

### 4.7 Technologies, ages and modifiers

- A tech is researched once per player in a specific building, then disappears from that building's command card.
- Age advancement is a tech researched at the Town Center with an extra prerequisite: at least 2 distinct completed buildings whose `age` equals the player's current age. Completing it increments `player.age` and emits `AgeAdvanced`.
- Every unit, building and tech definition declares `age`, optional `requiresBuildings`, optional `requiresTechs`, optional `civs` (restricts to listed civs) and optional `replaces`.
- Modifiers are data: `{ select: {ids?, tags?}, stat, op: 'add' | 'mul', value }`. A stat is resolved as: base value → civ modifiers → researched tech modifiers, all `add` before all `mul`. Resolved stats are cached per player and the cache is rebuilt when a tech completes or a game is loaded.

### 4.8 Passive income and objectives

- Buildings may declare `income: { resource, perSecond }`. The fractional remainder is kept on the building so no income is lost to rounding.
- M1 objective: "Reach the Empire Age". Completion shows a banner with elapsed game time and the game continues as a sandbox. The objectives system is a small interface so "destroy all enemy Town Centers" can be added later.

## 5. Game content (original design; all numbers are starting values)

### 5.1 Ages

| # | Name | Advance cost | Research time | Requires |
|---|---|---|---|---|
| 1 | Founding Age | — | — | — |
| 2 | Township Age | 400 food | 60 s | 2 distinct Age 1 buildings |
| 3 | Citadel Age | 700 food, 300 gold | 90 s | 2 distinct Age 2 buildings |
| 4 | Empire Age | 1000 food, 600 gold, 300 stone | 120 s | 2 distinct Age 3 buildings |

The Town Center and House do not count toward the requirement.

### 5.2 Resource nodes

| Node | Resource | Amount | Footprint | Blocks | Gatherers |
|---|---|---|---|---|---|
| Tree | wood | 100 | 1×1 | yes | 1 |
| Berry bush | food | 150 | 1×1 | yes | 1 |
| Gold deposit | gold | 800 | 2×2 | yes | 6 |
| Stone deposit | stone | 600 | 2×2 | yes | 6 |
| Farm (a building) | food | infinite | 2×2 | no | 1 |

### 5.3 Shared buildings

| Building | Age | Footprint | Cost | Build time | Function |
|---|---|---|---|---|---|
| Town Center | 1 | 4×4 | not buildable in M1 | — | Trains Villager; age advances; drop-off for all; +10 pop |
| House | 1 | 2×2 | 50 wood | 20 s | +10 pop |
| Mill | 1 | 2×2 | 60 wood | 25 s | Food drop-off; farming techs |
| Lumber Camp | 1 | 2×2 | 60 wood | 25 s | Wood drop-off; wood techs |
| Mining Camp | 1 | 2×2 | 60 wood | 25 s | Gold and stone drop-off; mining techs |
| Farm | 1 | 2×2 | 50 wood | 12 s | Infinite food, one villager |
| Barracks | 1 | 3×3 | 120 wood | 40 s | Trains Spearman, Swordsman |
| Archery Range | 2 | 3×3 | 150 wood | 45 s | Trains Archer |
| Stable | 2 | 3×3 | 150 wood | 45 s | Trains Horseman, heavy cavalry |
| Siege Workshop | 3 | 3×3 | 200 wood, 100 stone | 55 s | Trains Battering Ram, Trebuchet |

### 5.4 Shared units

Combat stats (hit points, attack, armour, range) are present in the data with provisional values and are not used by any M1 system.

| Unit | Age | Trained at | Cost | Train time | Speed (tiles/s) | Pop |
|---|---|---|---|---|---|---|
| Villager | 1 | Town Center | 50 food | 20 s | 1.0 | 1 |
| Spearman | 1 | Barracks | 35 food, 25 wood | 22 s | 1.0 | 1 |
| Swordsman | 2 | Barracks | 60 food, 30 gold | 24 s | 0.95 | 1 |
| Archer | 2 | Archery Range | 30 wood, 45 gold | 26 s | 1.0 | 1 |
| Horseman | 2 | Stable | 80 food | 30 s | 1.5 | 1 |
| Lancer | 3 | Stable | 80 food, 70 gold | 32 s | 1.4 | 1 |
| Battering Ram | 3 | Siege Workshop | 160 wood, 80 gold | 40 s | 0.6 | 3 |
| Trebuchet | 4 | Siege Workshop | 200 wood, 200 gold | 50 s | 0.5 | 3 |

Villager base rates: wood 0.40/s, berries 0.33/s, farm 0.35/s, gold 0.38/s, stone 0.36/s, carrying capacity 10.

### 5.5 Shared technologies

| Tech | Age | Researched at | Cost | Time | Effect |
|---|---|---|---|---|---|
| Hand Carts | 2 | Town Center | 150 food, 100 wood | 45 s | Villager carry +5, speed +10% |
| Iron Axes | 2 | Lumber Camp | 100 food, 50 wood | 30 s | Wood rate +15% |
| Frame Saws | 3 | Lumber Camp | 200 food, 100 wood | 45 s | Wood rate +15% |
| Irrigation | 2 | Mill | 100 food, 75 wood | 30 s | Farm rate +15% |
| Three-Field System | 3 | Mill | 200 food, 150 wood | 45 s | Farm rate +15% |
| Iron Picks | 2 | Mining Camp | 100 food, 75 wood | 30 s | Gold and stone rate +15% |
| Timbered Shafts | 3 | Mining Camp | 200 food, 150 wood | 45 s | Gold and stone rate +15% |
| Guild Charters | 4 | Town Center | 400 food, 300 gold | 60 s | All gather rates +10% |

### 5.6 The Byzantines

Palette: imperial purple with gold trim. Building placeholders use domes and red tile roofs.

| Unique | Type | Details |
|---|---|---|
| Themata | Civ bonus | Farms cost 20% less and are worked 10% faster (soldier-farmer land grants) |
| Cataphract | Unit, Age 3, Stable | Replaces the Lancer. 90 food, 80 gold, 34 s, speed 1.3, pop 1. Heavier and slower |
| Siphonarios | Unit, Age 4, Siege Workshop | Greek-fire hand-siphon infantry. 50 food, 90 gold, 30 s, speed 0.9, pop 1 |
| Silk Workshop | Building, Age 3, 3×3 | 150 wood, 100 stone, 50 s. Generates 0.25 gold/s with no workers. Build limit 3 |

The Lancer stays in the shared data so the `replaces` mechanism is exercised: the Byzantine tree must show the Cataphract and never the Lancer. For the Age 4 requirement the Byzantines' Age 3 buildings are the Siege Workshop and the Silk Workshop.

### 5.7 Pacing targets

With the reference build order run by the headless bot at 1× speed: Township Age by 6:30, Citadel Age by 14:00, Empire Age by 24:00. These are test thresholds; if the numbers above miss them, tune the data, not the thresholds, unless the owner agrees.

## 6. Rendering

- PixiJS v8 `Application` on a full-window canvas, resized on window resize, device-pixel-ratio aware. Layers, back to front: terrain, ground overlays (selection rings, rally lines, placement footprint), entities (depth sorted), world overlays (progress bars, carried-resource icons, click markers), then the DOM HUD above the canvas.
- **Terrain**: all grass, but 4 seeded tile variants so it does not read as a flat fill. Tiles are baked into 16×16-tile chunk textures; off-screen chunks are culled.
- **Entities**: one sprite per entity from the asset manifest, culled to the viewport, sorted by the depth key each frame. Unit positions are interpolated between `prevPos` and `pos`.
- **Camera**: pan with WASD/arrow keys, screen-edge scroll, middle-mouse drag; zoom with the wheel between 0.5× and 2×, centred on the cursor; clamped to the map bounds; "jump to" API used by the minimap and hotkeys.
- **Picking**: screen point → world point via the inverse projection, then the sim's `entityAtPoint`; units take priority over buildings, buildings over nodes. Sprite-bounds hit testing for tall sprites.
- **Feedback**: selection rings; green/red placement ghost with per-tile footprint; construction stages (foundation, scaffold, complete); progress bars for construction and production; a carried-resource marker on villagers; rally flag and line for selected buildings; a brief marker where a move or gather order was issued.

### 6.1 Placeholder art pipeline

- `AssetManifest` maps a `SpriteId` to `{ texture(s), anchor, frame timing }`. Game code refers only to `SpriteId`s.
- M1 implements the manifest with a procedural generator that draws to canvases at boot and uploads them as textures. Replacing art later means providing a manifest backed by sprite sheets; no game code changes.
- Readability requirements: every unit type has a distinct silhouette and prop (villager tool, spear, sword and shield, bow, horse, armoured horse, siphon, ram, trebuchet); every building is an isometric volume with a distinct roof shape and an icon glyph; team colour appears on every unit and building; resource nodes are recognisable at 0.5× zoom.
- Units: 8 facings (4 drawn, 4 mirrored), states idle / walk / work / carry, two frames each.
- The generator also produces HUD icons for every unit, building, tech and resource from the same drawings.

## 7. Input and HUD

### 7.1 Input

- Left click selects; drag box selects own units (units preferred over buildings); shift adds/removes; double-click selects all visible units of that type; Ctrl+1–9 assigns control groups and 1–9 recalls them (double-tap centres the camera).
- Right click is contextual for the current selection: ground → move; resource node → gather (villagers) or move (others); own unfinished building → build; own farm → work it; own drop-off building while carrying → drop off; with a building selected → set rally point.
- Shift + right click queues orders. Shift while placing a building keeps placement mode active.
- Hotkeys: command card is a 3×5 grid mapped to `QWERT / ASDFG / ZXCVB`; `.` cycles idle villagers; `H` selects and centres the Town Center; `Esc` cancels placement or opens the menu; `Delete` removes selected own entities; `F3` toggles the debug overlay; `F10` or `Pause` pauses.
- The hotkey map is one data table so rebinding can be added later.

### 7.2 Screens

Main menu (New Game, Load Game, title) → civilization select (Byzantines, with a panel listing bonuses and uniques generated from the data) → loading (art generation and map generation with a progress bar) → match. In-match menu: Resume, Save, Load, Restart, Quit to Menu.

### 7.3 HUD

- **Top bar**: food, wood, gold, stone with icons; population `used/cap` (highlighted when capped); current age name; idle-villager button with count; game clock; speed control.
- **Selection panel**: single selection shows icon, name, owner colour, hit points, what it is carrying, and for buildings the queue with progress and click-to-cancel. Multi-selection shows a grid of icons; clicking one narrows the selection.
- **Command card**: villagers get Build → Economy page and Military page, plus Stop. Buildings get their trainable units, researchable techs, age advance and Set Rally. Unavailable items are shown greyed with the reason; unaffordable costs are shown in red.
- **Tooltips**: name, cost, time, description, hotkey and unmet requirements, all generated from data.
- **Minimap**: rotated-diamond view of the whole map; resources, buildings and units as coloured marks; the camera's visible area outlined; left click or drag moves the camera; right click issues the contextual order at that point. Redrawn at 5 Hz from sim state.
- **Notifications**: toasts for rejected commands ("Not enough wood", "Build more houses", "Cannot build there"), completions and age advances; a banner on age advance and on objective completion.

The HUD reads sim state through a view-model built at 10 Hz (not every frame) so Preact re-renders stay cheap.

## 8. Desktop-wrap constraints

To keep a later Tauri or Electron wrapper trivial:

- Fully static build with relative asset paths (`base: './'`); no runtime network requests; no CDN fonts or scripts.
- Saves go through a `SaveStorage` interface. M1 implements it with `localStorage` plus "export to file" and "import from file".
- Fullscreen, window title and quit go through a `PlatformWindow` interface with a browser implementation.
- No reliance on browser-only behaviours: the context menu is suppressed in-game; browser shortcuts that cannot be intercepted (Ctrl+W, Ctrl+T, F5) are never bound.

## 9. Verification

Agents do not judge their own work as done. Each work package has acceptance tests, and an independent verifier agent checks each phase against the phase gate.

### 9.1 Test layers

| Layer | Tool | What it proves |
|---|---|---|
| Unit | Vitest | Each sim system and rule in isolation, on small hand-built states |
| Data validation | Vitest | Every definition references existing ids; no orphan techs or buildings; every item is reachable in the Byzantine tree; costs non-negative; `replaces` is honoured; every def has a sprite and an icon |
| Determinism | Vitest | Same seed and command script run twice gives identical hashes every 100 ticks over 30,000 ticks |
| Save/load | Vitest | Run N ticks, serialize, deserialize, continue: final hash equals the uninterrupted run |
| Economy bot | Vitest | The headless bot reaches the Empire Age within the pacing targets on 5 different seeds, with no unit stuck for more than 30 s of game time |
| End-to-end | Playwright | The real game in a real browser, driven through the UI |
| Performance | Playwright + headless | Budgets in 9.4 |

### 9.2 Lint-enforced boundaries

- `src/sim/**` and `src/data/**` may not import from `src/client/**`, from `pixi.js`, or from `preact`.
- In `src/sim/**`: `Math.random`, `Date`, `performance`, `setTimeout`, `window`, `document` and the banned `Math` functions are errors.
- `src/client/**` may not assign to anything typed as game state (state is exposed as deep `Readonly`).

### 9.3 End-to-end hooks and scenarios

In dev and test builds only, `window.__game` exposes: the sim state, `worldToScreen(x, y)`, `step(n)` to fast-forward, `cheat.addResources(...)`, `cheat.instantBuild(bool)`, and the current selection. Playwright uses `worldToScreen` to click real canvas coordinates, so tests exercise real input handling.

Required scenarios:

1. Boot → menu → civ select → match renders within 5 s; no console errors; a screenshot shows grass, a Town Center and 6 villagers.
2. Box-select villagers, right-click ground: they arrive.
3. Right-click a tree: wood increases after a round trip.
4. Place a House through the command card: it completes and the population cap rises by 10.
5. Queue a Villager: it spawns and follows a rally point set on a berry bush.
6. Reach the population cap: the queue holds and the toast appears; building a House releases it.
7. Research a tech: the gather rate change is measurable.
8. With cheats, advance through all four ages: the age label updates, new buildings unlock, Cataphract and Siphonarios become trainable, the Lancer never appears, the objective banner shows.
9. Silk Workshop: gold rises with no gold gatherers; a fourth one cannot be placed.
10. Save, reload the page, load: state hash matches.
11. Minimap click moves the camera; camera pan, zoom and bounds clamping work.

Each scenario saves a screenshot to a gallery the verifier and the owner can review.

### 9.4 Performance budgets

Measured with 200 units, 150 buildings and about 1,700 resource nodes on a mid-range laptop:

- Average sim tick under 4 ms; worst tick under 12 ms.
- 60 frames per second at 1080p at 1× zoom, and no worse than 45 at 0.5× zoom.
- Initial load to main menu under 2 s on localhost; match start (art and map generation) under 3 s.

### 9.5 Continuous integration

GitHub Actions on every push: install, type-check, lint, unit and sim tests, production build, Playwright end-to-end against the built output. A red pipeline blocks merging a work package.

### 9.6 Debug tooling (part of M1, not optional)

`F3` overlay: frame rate, tick time, entity counts, pathfinding queue length; toggles for occupancy grid, unit paths, approach tiles and tile coordinates under the cursor. Cheats: add resources, instant build and research, spawn any unit at the cursor, reveal state hash.

## 10. Work breakdown

### 10.1 How the agent team operates

- One orchestrator owns integration. Each work package (WP) is built by one agent in its own worktree and merged only when its acceptance tests and the full pipeline are green.
- Each WP owns specific directories. An agent that needs a change outside its directories, especially to `src/sim/types.ts` or `src/data/schema.ts`, requests it from the orchestrator instead of editing it, because those files are the contract every other agent builds against.
- A separate verifier agent, which wrote none of the code, runs each phase gate: it runs the tests, plays the scenarios in a real browser, reads the screenshots, and reports defects. Builders do not grade their own phase.
- Rules that change during implementation are recorded in `docs/DESIGN.md` in the same merge.

### 10.2 Phase 0 — Foundation (one agent, serial; everything else depends on it)

**WP0 Scaffold and contracts**
- Vite + TypeScript strict + ESLint (with the boundary rules in 9.2) + Vitest + Playwright + CI workflow.
- `CLAUDE.md` with: the determinism rules, coordinate conventions, directory ownership, commands to run, definition of done.
- The contracts, fully typed, with stub implementations: `src/sim/types.ts`, `src/data/schema.ts`, the public sim API from 2.8, `AssetManifest`, `SaveStorage`, `PlatformWindow`, the HUD view-model type.
- App shell: boots to a placeholder menu, starts a match, runs the fixed-tick loop against a stub sim, shows an empty Pixi canvas.
- Gate: pipeline green; `npm run dev` shows the menu and an empty match; a deliberate `Math.random` in `src/sim` fails lint.

### 10.3 Phase 1 — Walking skeleton (four agents in parallel)

| WP | Owns | Delivers | Acceptance |
|---|---|---|---|
| **WP1 Sim core** | `src/sim/sim.ts`, `rng`, `hash`, `serialize`, `systems/commands`, `map/` | Entity store, tick loop, PRNG, command intake and validation skeleton, occupancy grid, map generator, serialization, hashing | Determinism and save/load tests pass on a sim with no orders; map validation holds on 100 seeds |
| **WP2 Pathfinding and movement** | `src/sim/path/`, `systems/orders` (move only), `systems/movement` | A*, smoothing, request queue, approach tiles, group slots, move order, separation | Unit tests on mazes and unreachable goals; 200 units cross the map within budget; determinism test with move commands |
| **WP3 Renderer and placeholder art** | `src/client/render/`, `src/client/art/` | Projection, camera, terrain chunks, entity layer with interpolation, picking, asset manifest, procedural sprites and icons for every definition | Screenshot review at 0.5×, 1×, 2×; projection round-trip tests; depth-order tests around buildings |
| **WP4 Content data** | `src/data/` | Every definition in section 5, the Byzantine civ, registry and lookups | Data validation tests pass |

Then, serial, one agent: **WP5 Input and selection** (`src/client/input/`): pointer and keyboard handling, selection, box select, control groups, contextual right-click issuing `move`.

**Phase 1 gate (verifier):** scenarios 1, 2 and the camera half of 11 pass. The game loads, shows the grass map with resources, a Town Center and villagers, and villagers can be selected and moved.

### 10.4 Phase 2 — Economy (five agents in parallel)

| WP | Owns | Delivers | Acceptance |
|---|---|---|---|
| **WP6 Gathering** | `systems/gather`, gather and drop-off orders | Gather loop, drop-off selection, retargeting, node limits, depletion, farms as nodes | Unit tests for each branch of the loop; a villager left alone on a tree stand clears it and goes idle |
| **WP7 Construction** | `systems/construct`, `rules/placement`, build and assist orders | Placement rules, foundations, multi-builder progress, cancel and refund, post-build auto-continue, build limits | Unit tests; units are displaced from new foundations; stale paths recover |
| **WP8 Production, research, ages** | `systems/production`, `research`, `population`, `income`, `objectives`, `rules/availability`, `rules/stats` | Queues, population, rally, tech effects through modifiers, age advance, civ bonus, `replaces`, passive income, objective | Unit tests for every rule in 4.6–4.8; Themata and Silk Workshop verified numerically |
| **WP9 HUD** | `src/client/ui/` | Top bar, selection panel, command card, tooltips, toasts, menus, civ select, save/load UI | Component tests against fixture view-models; command card content matches `availability` for every building at every age |
| **WP10 Minimap, overlays and placement UI** | `src/client/ui/minimap`, `render/overlays`, `input/placement` | Minimap, placement ghost, progress bars, rally flags, order markers, construction stages | Scenario 11; visual review |

WP9 and WP10 build against the contracts and fixture states, so they do not wait for WP6–8. Order-related files are split by order type so WP2, WP6 and WP7 do not edit the same file.

**Phase 2 gate (verifier):** all scenarios in 9.3 pass with cheats off where feasible. A person can start a match and reach the Empire Age using only the mouse and hotkeys.

### 10.5 Phase 3 — Hardening (three agents in parallel, then verifier)

| WP | Delivers | Acceptance |
|---|---|---|
| **WP11 Economy bot and balance** | Headless bot in `src/bot/` with a reference build order; data tuning to meet 5.7; a short balance report | Bot test passes on 5 seeds |
| **WP12 Determinism, saves, performance** | Long-run determinism and replay tests with the bot's command log; save versioning (a `version` field and a refusal message for unknown versions); profiling and fixes to meet 9.4 | Tests and budgets pass |
| **WP13 UX pass and debug tools** | Debug overlay and cheats completed; hotkeys, idle-villager cycling, shift-queue polish, edge cases (deleting a building with a queue, cancelling while builders are en route, rally onto a depleted node) | Edge-case tests; scenario suite stable across 10 consecutive runs |

**Milestone gate (verifier, then owner):** section 11.

## 11. Definition of done for Milestone 1

1. Opening the built site shows the menu; choosing Byzantines starts a match in under 5 s with no console errors.
2. The map is an all-grass isometric map with trees, berries, gold and stone, and a working minimap.
3. Starting from a Town Center and 6 villagers, a player can gather all four resources, build every building in section 5, train every Byzantine-available unit, research every tech, and reach the Empire Age, using the HUD and hotkeys alone.
4. Military units can be trained, selected, grouped and moved.
5. Byzantine uniques work: Themata, Cataphract in place of the Lancer, Siphonarios, Silk Workshop with its limit.
6. Save, reload, load restores the exact state.
7. All tests in section 9 pass in CI, including determinism, the economy bot on 5 seeds, and the end-to-end scenarios; performance budgets are met.
8. `docs/DESIGN.md` describes the rules as implemented.
9. The verifier's report lists no open defect that blocks any of the above.

## 12. How later milestones attach

| Later feature | Where it plugs in |
|---|---|
| Combat | New order types and a combat system in the tick order between movement and construction; the provisional combat stats in data become live; hard unit collision and formations in movement |
| Enemy players and AI | `players[]` already supports N players; an AI is a module that reads state and emits `Command`s, exactly like the bot |
| Fog of war | A per-player visibility grid in `SimRuntime`; the renderer and minimap mask by it |
| More terrain, water, elevation | New `TerrainDef` rows and tile variants; map generators per map type |
| Second civilization | A new file in `src/data/civs/` plus sprites; shared roster and modifier system already exist |
| Multiplayer | Lockstep: exchange `Command`s with an input delay; periodic `hashState` comparison for desync detection |
| Replays | Store seed plus command log; already used by the tests |
| Real art and audio | A sprite-sheet `AssetManifest`; an audio layer subscribed to `SimEvent`s |
| Desktop app | Wrap the static build; implement `SaveStorage` and `PlatformWindow` for the wrapper |

## 13. Risks

| Risk | Mitigation |
|---|---|
| Parallel agents drift from the contracts | Contracts written first by one agent; contract files have a single owner; changes go through the orchestrator |
| Determinism erodes silently | Lint bans plus hash-based tests in CI from Phase 1 onward |
| Pathfinding and unit clumping feel bad | Dedicated work package, debug overlays, the bot's "no unit stuck" assertion; hard collision deferred deliberately |
| Isometric depth-sorting glitches around large buildings | Single depth rule, square footprints only, explicit ordering tests and screenshot review |
| Placeholder art is unreadable | Readability requirements in 6.1 judged by the verifier from screenshots at three zoom levels |
| Balance numbers are wrong | They are data; the bot measures pacing on every run |
| Scope creep into combat | Section 1 non-goals; combat stats exist only as inert data |
| Agents declare their own work finished | Independent verifier at every phase gate |
