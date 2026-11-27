# Balance report (WP11)

Measured with the headless economy bot (`src/bot/`, test `tests/sim/economyBot.test.ts`) on the real data, 1x, Byzantines, 120x120 maps. Game time is `tick / 20`. All numbers below are reproducible: the bot and the sim are deterministic.

**Result: the plan 5.7 targets are met by the bot alone; no value in `src/data/` was changed.** Section 5 of `docs/PLAN.md` is unchanged and still the single source of truth.

## Age timings (research completed)

| Seed | Township (target 6:30) | Citadel (target 14:00) | Empire (target 24:00) |
|---|---|---|---|
| 1 | 6:23 | 12:34 | 18:58 |
| 2 | 6:16 | 13:08 | 18:49 |
| 3 | 6:24 | 13:35 | 19:55 |
| 4 | 6:16 | 12:38 | 18:23 |
| 5 | 6:22 | 13:28 | 19:33 |

Thirteen further seeds (6 to 15, 101, 202, 303), run while tuning the bot, gave Township 6:09 to 6:25, Citadel 12:23 to 13:27 and Empire 19:15 to 20:27, so the five test seeds are representative. In all 18 runs no unit was stuck for 30 s, no resource went negative and no command was rejected; on the five test seeds the harness also checks that no node exceeds its gatherer limit, no villager harvests without holding the slot, and no foundation goes 40 s without a builder.

The margins are very different per age. Township has 5 to 20 s of slack and is the tight one (see below). Citadel has 30 to 100 s. Empire has 4 to 5.5 minutes: the target is beaten but not "by a wide margin" (the plan's alarm line is Empire before 16:00), so there is no recommendation to slow the game.

## Build order the bot plays

Decisions are made once per game second from the public state. The rules, in priority order each second: houses ahead of the cap, age advance, Town Center villagers, the age's two required buildings, assign idle villagers by the age's shares, move far-from-drop-off gatherers, rebalance, economy techs, extra Silk Workshops. Typical timeline (seed 1):

| Time | Action |
|---|---|
| 0:00 | Queue villagers; Mill next to the nearer berry patch, Lumber Camp next to a tree stand, a House with two builders |
| 0:00 to 5:00 | Every new villager goes to the resource furthest below the Age 1 share (80% food, 20% wood); House at about 3:45 |
| about 3:40 | Berries (12 bushes) run out of free slots, farms are built beside the Mill and Town Center (40 wood each) |
| about 4:30 | Stop adding villagers once the 400 food is within about 70 s of income (the research then goes in the moment it is affordable) |
| 5:23 | Township Age (60 s) |
| 6:23 | Archery Range (three builders), Irrigation; Iron Axes 7:06; Mining Camp at the gold 7:29 |
| 10:01 | Stable (second Age 2 building); Hand Carts when 26 villagers exist |
| 11:04 | Citadel Age (90 s) |
| 14:04 | Siege Workshop and a second Mining Camp (stone), Iron Picks |
| 14:55 | Silk Workshop (the second Age 3 building) |
| 16:44 | Empire Age (120 s), Frame Saws, Timbered Shafts alongside |

Shares of villagers by age (`PLAN.shares`): Founding food 80, wood 20; Township food 60, wood 28, gold 12; Citadel food 38, wood 17, gold 25, stone 20. Stockpile feedback then adjusts them: a starved wood pile pulls villagers in, piles above what the next age costs push them off gold, stone and wood.

## Income curves (average of seeds 1 to 5)

Income is resources deposited per minute in the minute before the timestamp (rounded; spending in the same tick as a deposit hides a few units).

| Minute | Villagers | Food/min | Wood/min | Gold/min | Stone/min | On food / wood / gold / stone |
|---|---|---|---|---|---|---|
| 2 | 12 | 110 | 72 | 0 | 0 | 8 / 3 / 0 / 0 |
| 4 | 17 | 206 | 76 | 0 | 0 | 12 / 3 / 0 / 0 |
| 6 | 19 | 292 | 86 | 0 | 0 | 15 / 4 / 0 / 0 |
| 8 | 23 | 234 | 148 | 22 | 0 | 13 / 8 / 2 / 0 |
| 10 | 29 | 304 | 181 | 62 | 0 | 14 / 9 / 3 / 0 |
| 12 | 33 | 342 | 252 | 101 | 0 | 17 / 10 / 4 / 0 |
| 14 | 35 | 409 | 216 | 137 | 40 | 14 / 6 / 8 / 7 |
| 16 | 41 | 320 | 153 | 219 | 158 | 15 / 7 / 10 / 8 |
| 18 | 44 | 472 | 215 | 285 | 200 | 17 / 8 / 11 / 9 |

A gatherer delivers about 15 to 20 per minute on berries and farms and 15 on wood, against nominal 20, 23 and 24: roughly 70 to 85% of the rate on the page, the rest being walking.

## Observations

- **Founding Age: food is the bottleneck, and the Town Center is the hard cap.** One Town Center trains 3 villagers a minute and a villager costs 150 food a minute of continuous training, so the 400 food for Township competes directly with growth. The 6:30 target is reachable, but only by a boom-then-click opening: training pauses roughly 70 s before the click. With a 30 s pause the same bot reaches Township at 6:35 to 6:47 (over the target), with none at about 7:00 to 7:20. Township is the one target with little slack (6:09 to 6:25 over 18 seeds); a small increase of the 400 food cost or the 60 s research time would break it. Wood only has to cover Mill, Lumber Camp, two Houses and the first farms (about 3 to 4 gatherers).
- **Township Age: wood and food.** Wood goes to Houses, a farm for nearly every new villager once the 12 berry bushes are taken (about 3:40), the Archery Range and Stable (300), and techs. Gold is needed only for the 300 of the Citadel advance, stone not at all, so the bot keeps gold at 12% and stone at 0 until Age 3.
- **Citadel Age: gold and stone.** Empire needs 600 gold and 300 stone, plus 100 stone each for the Siege and Silk Workshops. Food piles up (800 to 1700 banked at 16 to 20 minutes with the earlier 50% food share) while gold and stone arrive at 150 to 285 per minute. Moving villagers from food to gold and stone, as the shares now do, saved about a minute.
- **Berries are finite.** Two patches of six bushes at 150 food each last about eight minutes at one gatherer per bush. Past that every food gatherer is a farmer, which costs 40 wood each and makes wood a real second bottleneck in Age 2. This is a healthy transition, not a cliff, because the bot builds farms next to the Mill and Town Center on demand.
- **Town Center time.** Township, Hand Carts, Citadel and Empire block the single production queue for about 4.5 minutes of game, roughly 14 villagers. That is the price of researching at the Town Center and is the main reason the villager count is only 41 to 48 at Empire.
- **Silk Workshops** pay 0.25 gold/s for 150 wood and 100 stone (about the delivered rate of one gold miner, with no worker). They are not degenerate at three, but the bot builds only the one the age requires, so their effect on the Empire time is small; players who stack the maximum of three would save a few minutes of gold gathering.
- **Nothing is degenerate.** No resource is unbounded, farms need wood, houses must be built ahead of production, and the Town Center queue is a real constraint.

## Findings about the sim

No sim defect was found: 18 full games ran with no stuck unit, and the five test seeds also passed the slot and abandoned-foundation checks. One behaviour the bot has to respect: a camp or house placed next to a tree stand can wall in an interior tree (all eight neighbours blocked). A gather order on such a node ends in `VillagerIdle` after the path is used up, by design (plan 4.3). The bot therefore checks that a node has a reachable neighbour tile before sending anyone, and the camp site search prefers spots touching several nodes.

---

# Milestone 2: combat balance (WP25)

Reviewed against PLAN-M2 sections 4.1 to 4.3 (damage, range, timing) and 5 (content). Everything below is reproducible: `tests/unit/data/balanceModel.ts` is the model, `tests/unit/data/balance.test.ts` pins its results to the data, and `tests/sim/duels.test.ts` runs the same cells on the real sim (WP32 switched them on permanently: `COMBAT_INTEGRATED` is true; the real sim is the ground truth, the paper model is kept in step with the data and its differences are listed under "Actual duel table"). `tests/sim/feel.test.ts` holds the feel numbers.

## Method

- **Damage** is the 4.1 formula applied to the real data: `max(1, attack - armour) + floor(bonus * (100 - resist) / 100)`. Hits to kill and time to kill use the 4.3 timing (first blow after the wind-up, then one per cooldown).
- **Equal-cost duels** use a one-dimensional fight model. Both groups start 10 tiles apart and walk at their speed until in reach; ranged units then stand and shoot (arrows fly at 9 tiles/s); units die at the end of the tick, so simultaneous kills are possible; every attacker hits the nearest enemy it may target, and a group works on its front four victims at a time (so shooters neither overkill one unit nor spread damage evenly). There is no crowding limit and no kiting. It is exact for 1 against 1 and a fair guide for groups; the real-sim duels are the ground truth.
- **Group sizes** come from a budget of 1200 resources: 20 Spearmen, 13 Swordsmen, 16 Archers, 15 Horsemen, 7 Cataphracts, 5 Rams, 3 Trebuchets. The paper test also holds at budgets of 900, 1000, 1500 and 1800 (counts round differently there and survivors move by 10 to 20 points, results do not change).
- **Cell semantics.** "W": the row wins with at least 30% of its cost alive. "w": the row wins. The plan says "narrowly (above 0%)", but a narrow win is a knife edge under the square law (a 5% change in strength moves survivors by 20 points), so the tests require a win and the table below shows how far from narrow each cell is expected to be.

## Number changes

WP25 (paper review) changed two numbers; WP32 (real-sim tuning, below) changed six more and one building armour set; WP33 changed the Town Center arrow attack (row 8); the verification fix pass lowered the production buildings' melee armour and made the Battering Ram a Township unit (rows 9 and 10). Nothing else in `src/data` moved; no economy number changed (costs of economic items, gather rates, age costs), so the economy bot timings are identical.

| # | Change | Was | Now | Why |
|---|---|---|---|---|
| 1 | Archer cooldown (WP25) | 2.0 s | 1.6 s | With the 5.1 numbers an equal-cost group of Archers lost to Spearmen (the plan wants a win with at least 30% left). 1.6 s is +25% damage per second and leaves the Archer losing to Horsemen and Cataphracts. |
| 2 | Cataphract attack (WP25) | 11 | 13 | The plan wants the Cataphract to beat the Swordsman (W) and the Horseman (W); at 11 it lost to equal-cost Swordsmen. |
| 3 | Building melee armour: Barracks, Archery Range, Stable, Siege Workshop, Silk Workshop (WP32, approved by the orchestrator) | 2 | 7 | The siege row "10 Swordsmen need more than 3 times as long as 2 Rams" cannot hold at 2 (10 Swordsmen were as fast as 2 Rams). At 7 a Swordsman does 1 damage a blow, so 10 Swordsmen need 440 s against 48 s for 2 Rams (9x). |
| 4 | Town Center melee armour (WP32) | 3 | 8 | Same reason; Cataphracts, Horsemen and Siphonarioi do 1 to 6 a blow against it, so only siege razes it (Siphonarioi die to its arrows first). |
| 5 | Archer bonus against infantry (WP32) | +4 | +5 | **The thin spot of the matrix.** Archer against Swordsman was a comfortable win at 1200 (75% left) but is a square-law knife edge at other sizes: at a budget of 600 (8 Archers, 600, against 7 Swordsmen, 630) the Swordsmen won with 43% left, and winners kept as little as 22% elsewhere. At +5 an Archer does 9 to a Swordsman or a Spearman (was 8), kills a Spearman in 6 hits instead of 7 and a Swordsman in 8 instead of 9, and the cell keeps at least 50% of the Archers at every budget from 300 to 3000 in both creation orders. Archers against cavalry are unchanged (the bonus is against the `infantry` class). Pinned in `m2contracts.test.ts` (`archer` against `swordsman` 8 to 9) and `balance.test.ts` (`hit(archer, spear)` 8 to 9). |
| 6 | Battering Ram cooldown (WP32) | 4.0 s | 3.5 s | 2 Rams took 52.5 s to destroy a Barracks from 10 tiles (limit 60 s; 15 s of that is the walk), a margin of 12%. The plan's own fallback: 3.5 s gives 48 s (20%). Rams also kill a Town Center sooner (5 Rams, 28 s). |
| 7 | Siphonarios splash radius (WP32) | 1.0 | 1.25 | The clump row (4 Siphonarioi against 4 Swordsmen on 10 packed stand-ground Spearmen, needs 2.5x) passed at 2.52, a knife edge. At 1.25 the whole 0.5-spaced clump is inside the radius: 5.0x. Percent stays 60. Pinned in `m2contracts.test.ts` (`splash` `{ radius: 1.25, percent: 60 }`). |
| 8 | Town Center arrow attack (WP33) | 5 | 7 | The plan's e2e scenario 8 expects a Town Center to kill a lone Horseman in about 300 ticks; at 5 it took 448 (2 arrows of 3 every 40 ticks against 70 hp). At 7 it takes 248, and a 5-Horseman raid on the workers loses one unit instead of none; infantry and archer raids still keep at least 2 of 5 (table under "Feel numbers"). Tried: 3 arrows of 5 (288 ticks, Siphonarioi raid down to 2 alive), 3 arrows of 6 (208, wipes the archer raid), 2 arrows of 6 every 1.6 s (264, wipes the archer raid), 2 arrows of 7 every 1.8 s (224, archer raid down to 1). |
| 9 | Production building melee armour: Barracks, Archery Range, Stable, Siege Workshop, Silk Workshop (verification fix pass) | 7 | 6 | At 7 every infantry, cavalry and archer unit did 1 damage a blow, so a game without siege dragged (a hand-played win took 1:06 after the Town Center fell). At 6 a Swordsman does 2 a blow (Spearman and Horseman still 1, Cataphract 7): 20 Township infantry and cavalry raze a Barracks in 91 s (was 120), 20 Citadel units with Cataphracts in 50 s (was 60), a House in 18 s. The Town Center stays at 8: 20 Township units lose to its arrows, 40 raze it in 139 s. The siege row "10 Swordsmen more than 3x as long as 2 Rams" becomes 2x (118 s against 48 s, 2.5x); 5 would have made it 1.7x and a Township army 74 s. Pinned in `balance.test.ts` (2 a blow for the Swordsman, 1 for the Spearman and Horseman) and `feel.test.ts` ("an army without siege"). |
| 10 | Battering Ram age and producer (verification fix pass) | Age 3, Siege Workshop | Age 2, Barracks (and the Siege Workshop) | So an AI (or a player) finishing a beaten opponent in the Township Age can bring rams: without them a Town Center needs about 40 units. Cost (160 wood, 80 gold), speed (0.6) and stats are unchanged: the ram is slow, does nothing to units, and 6 Villagers kill it in 20 s, so an early ram needs an escort and is answered by any defence. Moving the Siege Workshop to the Township instead would have taken it out of the Citadel's two age buildings (the Empire needs two) and changed the economy timings. |

No military cost or train time changed, so the AI package can keep tuning against the current ones. Alternatives tried and rejected: Siphonarios splash 70% at radius 1.0 gives 3.3x (works, but only on exactly the harness clump), 50% at 1.25 gives 4.75x (no better); Ram cooldown 3.0 s (too good against the Town Center); Archer cooldown 1.5 s instead of +5 (helps every target, including cavalry, where the Archer should stay hopeless); Archer hp 32 to 36 (pins the save fixture).

## Actual duel table (real sim, budget 1200)

Run by `tests/sim/duels.test.ts` (`COMBAT_INTEGRATED` is now permanently true). Row against column, equal cost, 10 tiles apart, both sides `attackMove`. Each cell: letter (plan 5.3 in brackets), survivors as row/column percent of starting cost, game seconds to the end of the fight. The "Swapped" column is the same duel (survivors row/column) with the two sides created in the opposite order (and the player sides swapped); it differs only by id tie-breaks. The last column is the smallest share of its cost the winning side kept over budgets 300 to 3000 in steps of 100 with both creation orders (every cell keeps its letter in all 56 runs).

| Row against column | Plan | Letter | Survivors row/col | Seconds | Swapped | Winner keeps, budgets 300 to 3000 |
|---|---|---|---|---|---|---|
| Spearman vs Swordsman | L | L | 0/92 | 20 | 0/100 | at least 83% |
| Spearman vs Archer | L | L | 0/75 | 19 | 0/75 | at least 59% |
| Spearman vs Horseman | W | W | 85/0 | 14 | 95/0 | at least 74% |
| Spearman vs Cataphract | w | W | 70/0 | 18 | 75/0 | at least 40% |
| Swordsman vs Spearman | W | W | 100/0 | 21 | 92/0 | at least 83% |
| Swordsman vs Archer | L | L | 0/75 | 16 | 0/81 | at least 50% |
| Swordsman vs Horseman | W | W | 85/0 | 28 | 54/0 | at least 40% |
| Archer vs Spearman | W | W | 75/0 | 19 | 75/0 | at least 59% |
| Archer vs Swordsman | w | W | 81/0 | 16 | 75/0 | at least 50% |
| Archer vs Horseman | L | L | 0/100 | 12 | 0/100 | at least 86% |
| Archer vs Cataphract | L | L | 0/100 | 16 | 0/100 | at least 94% |
| Horseman vs Swordsman | L | L | 0/54 | 31 | 0/85 | at least 40% |
| Horseman vs Archer | W | W | 100/0 | 12 | 100/0 | at least 86% |
| Horseman vs Cataphract | L | L | 0/100 | 30 | 0/100 | at least 78% |
| Cataphract vs Spearman | L | L | 0/75 | 17 | 0/70 | at least 40% |
| Cataphract vs Swordsman | W | W | 71/0 | 31 | 71/0 | at least 50% |
| Cataphract vs Archer | W | W | 100/0 | 14 | 100/0 | at least 94% |
| Cataphract vs Horseman | W | W | 100/0 | 30 | 100/0 | at least 78% |
| any row vs Ram / Trebuchet | W | W | 100/100 | 0 | same | trivial: siege cannot hurt units |

Reading it:

- **Every cell is a clear result, none is knife-edge.** The tightest winner is 40% of its cost left (Spearman against Cataphract, Swordsman against Horseman and Horseman against Swordsman at one budget each), most are above 75%.
- **Spearman against Cataphract is a win, not the plan's narrow win.** 3 Spearmen (180) beat 1 Cataphract (170) and the larger Spearman army wins by 40 to 75%. Narrowing it would need a Cataphract that also crushes the Swordsman and breaks the triangle; the test requires the win. The reverse cell (Cataphract against Spearman) is therefore "L (3:1 spears)" exactly as the plan says. Same for Archer against Swordsman: plan "w", real result a clear win; see change 5.
- **Real fights against the paper model.** The letters agree in all 18 cells and cavalry cells agree within 5 points. Infantry mirror cells are 25 to 30 points more lopsided in the real sim (Swordsman against Spearman: 100% real, 69% in the model; Spearman against Swordsman 92 against 69): the real sim has no hard collision (4.7), so every melee unit of a deep group reaches the enemy at once, while the model lets only the front four of a group fight. That is a linear-to-square-law effect (the bigger or better army loses fewer units); it makes the counters crisper, not different. Archer against Swordsman is 81 in the sim against 88 in the model: Swordsmen close faster than the model's walk. There is no kiting in the sim (no unit retreats on its own), so the paper model's "no kiting" assumption holds; archers can still be kited by a player, which the duels do not test.
- **Swapped creation order** changes survivors by up to 30 points in melee mirrors (54 against 85 for Swordsman against Horseman) because lower ids win ties: the side created first gets its blows in first. No letter changes.

## Siege rows (real sim)

Attackers start 10 tiles from the building's edge.

| Row | Plan | Actual | Margin |
|---|---|---|---|
| 2 Rams destroy a Barracks | under 60 s | 48.0 s (15 s of it walking) | 12 s (20%) |
| 10 Swordsmen on the same Barracks | more than 2x the Rams (96 s; the plan's 3x until the fix pass) | 118.3 s (2.5x; a Swordsman deals 2 a blow at melee armour 6) | 22 s |
| Trebuchet against a Town Center from outside its range | undamaged | destroyed in 128.9 s, hp never below 100%, closest approach 11.73 tiles (arrows reach 7.75) | 4 tiles |
| 6 Villagers kill a Ram | under 30 s | 20.4 s | 9.6 s |
| 4 Siphonarioi against 4 Swordsmen on a clump of 10 stand-ground Spearmen (0.5 grid) | at least 2.5x the damage per second | 5.0x (100 against 19.8 damage per second; the clump dies in 5 s) | 2x |
| 5 Siphonarioi against 5 Swordsmen on a Barracks | under 40% of the time | 34.4 s against 224.8 s (15%) | 2.6x |

The clump row only pays off on tight clumps: on a 0.75 grid the same Siphonarioi are 1.6x, on 1.0 1.3x and on 1.5 0.75x (they lose to 4 Swordsmen). Armies in melee are tight (units pass through each other, so the ranks pile up on the 0.45 separation radius), which is where the Siphonarios is meant to shine; against a spread-out line it is a slow demolisher.

### Building armour

Production buildings (Barracks, Archery Range, Stable, Siege Workshop, Silk Workshop) have melee armour 6 (WP32 raised them to 7, the verification fix pass lowered them to 6) and the Town Center 8. A Swordsman does 2 damage a blow to a production building and 1 to the Town Center; Villagers, Spearmen, Horsemen and Archers do 1 to both (Cataphract 7 and 5, Siphonarios 22 and 20, Ram 61, Trebuchet 151). Houses (melee armour 1), Mills and camps (1) and Farms (0) are unchanged from 5.2: timber and thatch, so a raid works. Five idle soldiers destroy, from 2 tiles away (measured after the fix pass; the House, Mill and Farm columns are also faster than WP32's table because of WP33's reach fix):

| Five of | House (550 hp) | Mill / Camp (600) | Farm (300) | Barracks (1200) | Town Center (2400) |
|---|---|---|---|---|---|
| Villager | 110 s | 120 s | 40 s | 480 s | never (arrows) |
| Spearman | 56 s | 60 s | 24 s | 480 s | never |
| Swordsman | 29 s | 33 s | 15 s | 216 s (432 s at armour 7) | never |
| Archer | 175 s | 191 s | 95 s | 384 s | never |
| Horseman | 39 s | 43 s | 18 s | 432 s | never |
| Cataphract | 20 s | 20 s | 10 s | 70 s (80 s at armour 7) | never |
| Siphonarios | 11 s | 11 s | 6 s | 26 s | never (45 hp against 2 arrows) |
| Battering Ram | 7 s | 7 s | 4 s | 14 s | 28 s |
| Trebuchet | 5 s | 5 s | 4 s | 13 s | 29 s |

### An army without siege (verification fix pass)

Twenty units, ordered to attack an undefended building 10 tiles away (`tests/sim/feel.test.ts` asserts the Township Barracks in 45 to 100 s, the Citadel Barracks in 30 to 75 s, a House under a third of the Barracks time, the Town Center beyond 20 units and within 240 s for 40):

| Army | Barracks at armour 7 (before) | Barracks at 6 (now) | House | Farm | Town Center |
|---|---|---|---|---|---|
| Township: 7 Spearmen, 7 Swordsmen, 6 Horsemen | 120 s | 91 s | 18 s | 12 s | never (20 units die to the arrows); 40 of them: 139 s |
| Citadel: 5 each of Spearmen, Swordsmen, Horsemen, Cataphracts | 60 s | 50 s | | | 40 of them: 68 s |
| 20 Swordsmen | 119 s | 65 s | | | |
| 20 Horsemen / 20 Spearmen | 115 s / 130 s | unchanged (1 a blow) | | | |

So a production building falls to a Township army in about a minute and a half and to a Citadel army in under a minute; Houses and farms go in seconds; the Town Center needs siege (5 Rams 28 s) or a large army (40 units, about two and a half minutes, losing about a third of them). Infantry and cavalry still prefer enemy units: the hardened-target rule (PLAN-M2 4.5) still ranks the Town Center below everything for every unit but siege, Cataphracts and Siphonarioi, and a Barracks for every unit but those and the Swordsman; for the Swordsman a production building is now an ordinary building target (tier 3), still below every enemy unit.

## Feel numbers

All measured on the real sim by `tests/sim/feel.test.ts` (bounds are asserted there). No upgrades, Founding to Citadel stats.

- **Five of one type kill one idle Villager** (starting 6 tiles away, including the walk): Archer 1.9 s, Horseman 4.2, Cataphract 4.7, Siphonarios 4.7, Spearman 6.2, Swordsman 6.5, Villager 8.2 s. A Villager (25 hp) dies in two or three hits.
- **A house** (550 hp) falls to 5 Swordsmen in 29 s, to 5 Spearmen in 56 s, to 5 Rams in 7 s; **a Town Center** to siege (5 Rams 28 s, 5 Trebuchets 29 s) or to a large army (40 Township units, 139 s); **a Barracks** to 5 Rams in 14 s, to 5 Cataphracts in 70 s and to 20 Township infantry and cavalry in 91 s (verification fix pass; see "An army without siege").
- **Town Center arrows against a raid of 5** that is sent at 5 idle Villagers beside it (each raider ordered to attack the Villagers one after the other), with the WP33 arrows (2 of 7 pierce every 2 s): Spearmen kill all 5 Villagers in 33 s and lose 2 units; Swordsmen 27 s, lose 1; Archers 28 s, lose 3; Siphonarioi 25 s, lose 2; Horsemen 21 s, lose 1; Cataphracts 19 s, lose none. (WP32's numbers with 5 pierce: Spearmen 31 s / 1, Swordsmen 26 s / 1, Archers 27 s / 2, Siphonarioi 24 s / 1, Horsemen 20 s / 0, Cataphracts 19 s / 0.) So an infantry or archer raid hurts (the workers die, a fifth to three fifths of the raid dies) and is not wiped; a Horseman raid now pays a unit; an armoured Cataphract raid (Age 3) is still almost free against workers who stand still. A lone idle Horseman beside a Town Center dies in 248 ticks (was 448). The counter is to move the workers (a Villager walks at 1.0, Horsemen at 1.5; infantry cannot catch a fleeing Villager at equal speed) and answer with Spearmen. WP32 left the Town Center arrows alone (raising them to 6 changed no cell of the table); WP33 raised them to 7 pierce (change 8 above): 2 arrows per 2 s now do 7 damage a second to a Villager, 6 to a Spearman, 5 to a Horseman and 4 to a Cataphract.
- **Repair against 3 attackers** (the Villagers start 5 s after the first blow and are re-ordered when an order ends at full hp): 3 Villagers hold a House against 3 Swordsmen (hp never below 466 of 550), 3 Spearmen (506) and 3 Horsemen (490); 1 Villager does not (the Swordsmen win in about 110 s). 3 Cataphracts beat 3 Villagers (38 hp left, 5 Villagers hold at 416). 3 Swordsmen now scratch a Barracks (3.3 hp a second at melee armour 6) and 3 repairing Villagers (15 hp a second) hold it. Siege outpaces repair: 3 Rams destroy a Barracks in 34 s with 1 repairer and 41 s with 5, and 3 Siphonarioi destroy a House in 22 s to 35 s because their splash kills the repairers. Repair therefore keeps up with infantry and cavalry raiders and loses to siege, which is why the defender has to kill the Rams (6 Villagers need 20 s).
- **No unit is dominated at equal cost**: each of the five wins at least one equal-cost duel and loses at least one (Spearman wins against Horseman and Cataphract, loses to Swordsman and Archer; Swordsman wins against Spearman and Horseman; Archer against Spearman and Swordsman; Horseman against Archer; Cataphract against Swordsman, Archer and Horseman).
- **Upgrades** (`feel.test.ts` requires at least 5 points of net survivors in some equal-cost duel at budget 1200 with one side upgraded; every one of the twelve does):

| Upgrade (a level II includes its level I) | Largest changes (net survivors, row minus column) |
|---|---|
| Spathion Forging | Swordsman against Cataphract: loses with 71% of the Cataphracts left, now 29% |
| Strategikon Drill | Swordsman against Cataphract becomes a win (46% left); Spearman against Swordsman 92 to 69 |
| Padded Kavadion | Spearman against Horseman 85 to 95; Swordsman against Cataphract 71 to 57 |
| Lamellar Klibanion | Swordsman against Cataphract becomes a win (46%); Swordsman against Archer 75 to 63 |
| Horn-and-Sinew Bows | Archer against Swordsman 81 to 88; Archer against Horseman 100 to 93 lost |
| Solenarion Guides | Archer against Swordsman 81 to 100; against Horseman 100 to 87 lost |
| Bambakion Coats | Archer against Spearman 75 to 88; against Swordsman 81 to 88 |
| Mail Lorikion | Archer against Spearman and Swordsman 75 and 81 to 94 |
| Kontarion Drill | Horseman against Swordsman: loses with 54% left, now 31%; against Spearman 95 to 85 |
| Taktika Wedge | Horseman against Swordsman becomes a win (67%), against Cataphract a win (40%) |
| Felt Horse Bards | Cataphract against Swordsman 71 to 86; against Spearman (a loss) 75 to 60 |
| Iron Horse Bards | Cataphract against Swordsman 71 to 100; Horseman against Swordsman becomes a narrow win (20%) |

## Time to kill, one against one (paper, current data; seconds, damage per hit in brackets)

| Attacker | vs Spearman | vs Swordsman | vs Archer | vs Horseman | vs Cataphract |
|---|---|---|---|---|---|
| Spearman | 18.5 (5) | 42.5 (3) | 12.5 (5) | 8.5 (16) | 28.5 (8) |
| Swordsman | 7.7 (12) | 18.5 (6) | 5.9 (8) | 16.7 (7) | 41.9 (5) |
| Archer | 8.6 (9) | 11.8 (9) | 10.2 (5) | 37.4 (3) | 95.0 (2) |
| Horseman | 14.8 (6) | 29.2 (4) | 4.0 (11) | 23.8 (5) | 70.6 (3) |
| Cataphract | 6.5 (13) | 10.5 (11) | 2.5 (18) | 10.5 (12) | 22.5 (10) |

## Military upgrades (5.4)

The 12 upgrades resolve to exactly the 5.4 effects through the real stat resolution (`combatData.test.ts`). The full tree gives: Spearman and Swordsman +2 attack and +2/+2 armour; Siphonarios +2/+2 armour only; Archer +2 attack, +1 range and +2/+2 armour; Horseman, Lancer and Cataphract +3 attack, +2 melee and +3 pierce armour. Villagers, siege and buildings do not change.

| Upgrade | Example | Effect |
|---|---|---|
| Spathion Forging (+1 attack) | Swordsman against Swordsman 6 to 7; Spearman against Swordsman 3 to 4 | time to kill 18.5 to 16.7 s; 42.5 to 32.5 s |
| Horn-and-Sinew Bows (+1) | Archer against Spearman 9 to 10; against Horseman 3 to 4 | 8.6 to 7.0 s on the Spearman, 11.8 to 10.2 s on the Swordsman; 37 to 28 s on the Horseman |
| Kontarion Drill (+1) | Horseman against Archer 11 to 12 | no change in blows to kill (4): small upgrades bite only at hit-point thresholds, so Taktika Wedge (+2) matters more |
| Padded Kavadion (+1/+1) | Spearman against Swordsman 3 to 2; Swordsman against Swordsman 6 to 5 | 42.5 to 64.5 s; 18.5 to 22.1 s |
| Felt / Iron Horse Bards | Archer against Cataphract 2 to 1; Archer against Horseman 3 to 1 with both | arrows are nearly useless against upgraded cavalry (floor 1) |

Measured on the real sim, the real effect of every upgrade is in "Feel numbers". With one side upgraded and the other not (equal-cost duels, budget 1200, paper model; the real sim agrees on every flip named here): level I of a line (one attack and one armour tech) moves survivors by 5 to 15 points and flips two cells, Swordsman against Cataphract (loss to a win with 54% left) and Horseman against Cataphract (loss to a narrow win with 20%). The full tree also flips Spearman and Swordsman against Archer (wins with 40% and 38% left) and gives the Horseman a clear win over the Cataphract (73%); it never lets the Archer beat cavalry. That is the intended shape: upgrades widen a unit's own matchups and narrow the opponent's, and upgrades are the way to beat a counter you could not beat on equal footing, while at equal upgrade levels the triangle stays.

## Pacing

- The M1 bot thresholds are unchanged and no economy number changed, so the Township timings in the first half of this file stand: the economy bot reaches Township at 6:09 to 6:25.
- The hand-played target is **7:30**, 65 to 80 s behind the bot; that is the pace of a player who keeps the Town Center queue busy and clicks the age in once the 400 food is in hand.
- AI timings, measured by `tests/sim/ai.long.test.ts` (each AI against an idle opponent, seeds 1-5; Township / first wave launch; re-measured after the verification fix pass, within a few seconds of before):

| Difficulty | Township (target) | First wave (target) | Township (measured, seeds 1-5) | First wave (measured, seeds 1-5) |
|---|---|---|---|---|
| Easy | 8:30 to 10:30 | not before 15:00 | 9:17, 9:05, 9:11, 9:11, 9:11 | 15:56, 15:05, 15:02, 15:23, 15:23 |
| Standard | 6:30 to 7:45 | 10:00 to 12:00 | 7:05, 7:04, 7:05, 7:04, 7:06 | 11:20, 10:50, 11:13, 10:49, 11:18 |
| Hard | 5:00 to 6:00 | 7:00 to 8:30 | 5:36, 5:40, 5:26, 5:49, 5:45 | 8:15, 8:05, 8:09, 8:16, 8:16 |

## Computer opponent (Phase 3 tuning)

No difficulty gets a resource, vision, speed or stat bonus; the difficulties differ only in how they decide (`src/bot/ai/difficulty.ts`; behaviour in DESIGN.md "WP26").

### Difficulty table as built

| Habit | Easy | Standard | Hard |
|---|---|---|---|
| Decision interval | 60 ticks (3 s) | 20 ticks (1 s) | 10 ticks (0.5 s) |
| Villagers | to 28 | to 50 | 14 in Founding, then always one in production (paid before the army) to 70; pauses at 36 (Township) and 58 (Citadel) until the next advance is clicked |
| Military buildings | Barracks at 16 villagers or 6:30; Archery Range in Age 2 | Barracks at 14; Range and Stable in Age 2; Siege Workshop in Age 3 | Barracks at 10; Stable in Age 2; Range at 28 villagers; 2nd Barracks / Stable / Range at 40 / 50 / 60 in Age 3; Siege Workshop; more Barracks or Stables (up to 10 producers) whenever every one is busy and 700 food plus wood is spare |
| Army money | 20% of income banked, plus stock above 400 | 35%, plus stock above 400 | 30%, plus stock above 150; the whole stock while defending |
| Waves | 4, 6, 8, +1 to 10; first 15:00 + 0-60 s, forced +3:00 | 10, 14, +4 to 30; first 10:00 + 0-30 s, forced +90 s | first wave a raid (7:00 + 0-20 s, forced +70 s with 2+ units); then 12, 16, +6 to 36, launched only at 1.3x the enemy's whole fighting power (forced: 1.0x), every 90 s at the earliest |
| Retreat | never | below 30% of start power | below 40% of start power, or when the local enemy power (12 tiles, plus Town Center arrows when enemy units are there too) exceeds 1.2x the wave; the raid at 0.7x. An assault on a Town Center that the fight model says wins does not turn |
| Town Center arrows (all) | fight model (verification fix pass): a target under the arrows only if it falls at a cost of at most a quarter of the wave (a raid: one raider per two villagers); the Town Center itself when the gathered units win with a margin of 1.3, otherwise the wave waits 3 tiles out of reach and gathers | same | same |
| Finishing (all) | after a wave has gone out, an enemy with under a quarter of the AI's fighting power: continuous reinforcement (one by one once the enemy has no fighting unit), a wave with its rams launches at once | same, plus no archers in the mix and rams first | same |
| Composition | fixed (spear 0.6, archer 0.4) | 50% fixed, 50% counter | counter (fixed horse 0.35, archer 0.3, sword 0.2, spear 0.15 while the enemy has no army) |
| Siege | never | 2 Rams from Age 3 (Township, from the Barracks, while finishing) | 2 Rams from Age 3 (Township while finishing); Trebuchet and 3 Siphonarioi in Age 4 |
| Upgrades | none | level I of its two most-built lines from Age 3 | all, as affordable, from Age 2 |
| Defence | military only, after 10 s | 3 s; evacuates villagers | 1 s; 4 villagers fight raids of 1-2 units |
| All-in | never | 45:00 | 40:00 |

All difficulties: Horsemen when a Cataphract is unaffordable; the far gold deposits once the near ones are mined out; buildings are wave targets when the wave razes them within 120 s (production buildings were excluded outright at armour 7); defenders chase enemy rams only when they out-power the rams' escort.

### Baseline on the new balance (before this tuning)

Measured with the previous AI on the WP32 balance (building melee armour 7/8), before the sim hardening merge: Hard vs Standard 1 of 5 (Standard won seeds 1, 2, 3, 5 at 28-34 min); Standard vs Easy 5 of 5 (26-32 min); Hard vs Easy 5 of 5 but seed 3 at 42:56 (limit 35:00); Standard vs Standard seed 2 and Hard vs Hard seeds 1 and 2 without a winner at 75:00. The previous Hard advanced with 14 villagers, kept its Town Center idle a third of the time in the Township Age (food went to the army bank), reached 35 villagers at 19 minutes against Standard's 50 and the Citadel at 24-30 minutes, and its waves of 8 walked into Standard's army at the Town Center (first wave: 0 kills, 6 losses). On the hardened sim (Town Center arrows 7) the orchestrator's run of the old head failed three ladder tests (seed 3 Hard beats Easy; Hard beats Standard 2 of 3; Standard vs Standard seed 2).

### Ladder (final, seeds 1-5, after the verification fix pass)

Winner and match length; every match is also checked for command hygiene (no rejection in any of them) and stuck units (none).

| Match | Seed 1 | Seed 2 | Seed 3 | Seed 4 | Seed 5 | Result |
|---|---|---|---|---|---|---|
| Hard vs Standard | Hard 48:17 | Hard 51:53 | Hard 43:48 | Hard 41:11 | Hard 58:06 | 5-0 |
| Standard vs Easy | Standard 25:36 | Standard 24:45 | Standard 24:33 | Standard 22:50 | Standard 25:27 | 5-0 |
| Hard vs Easy | Hard 25:05 | Hard 28:33 | Hard 30:24 | Hard 28:09 | Hard 26:16 | 5-0 |
| Standard vs Standard | P2 35:21 | P1 34:39 | P2 28:28 | | | all end |
| Hard vs Hard | P2 32:35 | P1 58:33 | P1 53:55 | | | all end |

Before the fix pass (Phase 3 tuning): Hard vs Standard 5-0 (37:53-46:23), Standard vs Easy 5-0 (27:51-29:58), Hard vs Easy 5-0 (28:48-32:00), Standard vs Standard 30:27-57:45, Hard vs Hard 46:05-57:56. Standard and Hard now raze production buildings with bigger waves, so games against Easy end 3 to 5 minutes sooner.

`npm run test:long` asserts: Hard beats Easy on every seed before 35:00, Standard beats Easy on every seed before 45:00 (was at least 4 of 5), Hard beats Standard on at least 4 of 5 with a winner in every match before 75:00, the mirrors (3 seeds each) end before 75:00, and every difficulty beats an idle opponent within its limit (below).

Intermediate versions lost Hard vs Standard seeds, which shaped the final rules: Town Center arrows count in the retreat check only beside an enemy army (without that, Hard's waves stayed under Standard's Town Center and lost the even trades they used to avoid); defenders go for rams only when they out-power the escort (Hard's whole army chased Standard's first ram into its 34-unit escort and lost 27 units for 3); Barracks rams only while finishing (at Age 3 Standard otherwise skipped saving for its Siege Workshop and out-built Hard); the raid's retreat ratio stays 0.7 (at 1.0 it lost two Hard vs Standard seeds).

### Finishing a defenceless opponent (verification fix pass)

The opponent in slot 1 gives no input (a Town Center and six idle villagers beside it); the AI is player 2. Before the fix, Hard counted the Town Center's arrows as a nominal army (2,100 power, about nine Horsemen) both when it chose a target and when it decided to pull back: its waves walked in, turned, walked in again, fed 34 units to the arrows on seed 5, and had no siege before the Citadel. Now the AI weighs the arrows with the fight model, waits out of reach until it can win, and brings Barracks rams as soon as the enemy is beaten (`tests/sim/ai.long.test.ts`: Hard and Standard within 18:00, Easy within 32:00, on seeds 1-5; `tests/sim/ai.test.ts`: Hard on seed 5 within 18:00, losing at most 10 units).

| Difficulty | Seed 1 | Seed 2 | Seed 3 | Seed 4 | Seed 5 |
|---|---|---|---|---|---|
| Hard, before | 27:52 | 28:04 | 26:47 | 23:23 | 23:51 |
| Hard, after | 13:23 | 13:05 | 15:34 | 13:33 | 15:27 |
| Standard, before | 23:19 | 20:45 | 21:19 | 21:08 | 25:07 |
| Standard, after | 15:56 | 15:49 | 16:16 | 15:59 | 15:32 |
| Easy, before | 33:43 | 33:57 | 27:17 | 26:56 | 34:18 |
| Easy, after | 27:34 | 25:57 | 25:55 | 26:05 | 27:17 |

Easy has no siege (6.3) and no Stable: it finishes when its spear and archer army is large enough for the fight model to take the Town Center (about 26 to 28 minutes).

Hard's first-wave raid, measured from its launch until it ends (units killed by the raid; Hard's losses), seeds 1-5:

| Opponent | Before | After |
|---|---|---|
| Easy | 2, 0, 2, 3, 7 villagers (Hard lost 1) | 10, 0, 4, 11, 9 villagers (Hard lost 3) |
| Idle | 0, 1, 1, 0, 1 (Hard lost 3) | 0, 1, 0, 0, 0 (Hard lost 0) |
| Standard | nothing | nothing |

The raid now also strikes villagers under the arrows when the model says it trades at least two villagers per raider; against an undefended economy (Easy's) it kills up to a third of the villagers on most seeds. A Standard opponent evacuates its villagers and meets the raid with its army, and the raid turns back without losses (an even fight there cost Hard ladder games); its effect on Standard is lost gathering time.

### AI decision cost (verification fix pass)

`tests/sim/aiCost.test.ts`, Hard vs Standard on seed 2 for 40 minutes and the 8.4 battle scene (200 a side) commanded by Hard and Standard; times are the fastest of three runs per decision after a warm-up match:

| | Before | After |
|---|---|---|
| Hard, 40-minute match | max 27 to 47 ms (verifier, single runs); this test on the old code: best of 3 avg 1.58 ms, max 13.4 ms | operations avg 37,600, max 184,000; best of 3: avg 0.76 ms, max 2.4 to 2.9 ms |
| Standard, 40-minute match | max 17 to 19 ms (verifier, single runs) | operations avg 39,900, max 152,000; best of 3: avg 0.78 ms, max 2.1 to 2.2 ms; 0.04 ms a tick |
| Battle scene, Hard / Standard | best of 3: avg 1.08 / 1.26 ms, max 2.9 / 2.8 ms | operations max 116,000 / 117,000; best of 3: max 2.4 / 1.5 ms |

The first decision of a match, before the JIT has compiled the code, costs 15 to 25 ms; it falls on tick 3 and 6 (behind the loading screen) and is not counted. A garbage collection adds 5 to 12 ms to whichever decision it interrupts; the best-of-3 measure removes it. What moved the worst case: the sim's availability check scans every entity and the AI asked it dozens of times per decision (now remembered per decision); placement tested every footprint tile of up to 2,000 candidates (now a summed-area table); the camp site scorer looped over every node of the map for every candidate; and the late-game economy (gold far away) scored 1,800 nodes against every drop-off for every villager it placed.

### What a player should expect

- **Easy**: Township around 9:10, a first wave of 4 Spearmen and Archers after 15:00, waves of 6 then 8 every 4 minutes, nearest building first, no retreat, no repair, slow reactions (10 s). It never attacks early; a new player has a quarter of an hour of peace.
- **Standard**: Township at 7:00, a first wave of 10 at about 11:00, then 14, 18 every 3 minutes with Rams from the Citadel (about 19 minutes); it goes for production buildings, retreats at 30%, evacuates villagers from raids, repairs and rebuilds. It floats resources late and its army is capped by four production buildings: a player who defends its waves at home under the Town Center and builds more production than it does will out-produce it and win.
- **Hard**: Township at 5:30, a raid at 8:10 that hunts exposed villagers (and villagers under the Town Center when it trades well) and turns back from an army, then it booms: a villager always in production to 70, Citadel by 16-22 minutes, up to 10 production buildings, all upgrades. If you have no army, it brings Barracks rams and an escort and ends the game by about 13 to 16 minutes. It defends with everything it has and spends its whole stock under attack, never attacks while weaker than your whole army (1.3x), pulls back when a fight turns, and comes with Rams and escorts once it outnumbers you, around 25-35 minutes. It is beaten by early pressure that kills villagers before it booms, or by a bigger army at home; it does not feel like a rusher.

### Open points

- The raid kills against an undefended economy (Easy: 4 to 11 villagers on 4 of 5 seeds) but not against an opponent that keeps its army at home and evacuates its villagers (Standard does both): it turns back without losses. Buying Horsemen for it ahead of the villagers was tried and reverted (it lost a Hard vs Standard seed and still killed nothing); raising its retreat ratio to 1.0 lost two seeds. Hard's pressure is economic and late, not early.
- The frame rate on real hardware (8.4: 60 fps at 1x on the battle scene) is still to be measured by the owner, with the in-game readout (F3 or `?fps=1`).
- Easy and Standard were left as they were apart from the two all-difficulty rules above (Horseman fallback, far gold); Standard's late floating is its intended weakness.

## Notes for other packages

- **WP26 (AI), what the real numbers mean for waves.**
  - (Updated by the verification fix pass.) Production buildings have melee armour 6 and the Town Center 8: a Swordsman does 2 a blow to a Barracks (5 Swordsmen 216 s, 20 Township infantry and cavalry 91 s) and 1 to a Town Center (never for 5, about 139 s for 40 losing a third). Every wave meant to end a game needs siege: 2 Rams take a Barracks in 48 s from 10 tiles, 5 Rams take a Town Center in 28 s; Cataphracts (80 s for 5 on a Barracks) and Siphonarioi (29 s for 5) also work, a Siphonarios squad dies to Town Center arrows before it razes the Town Center. Houses, Mills, Camps and Farms still fall to infantry (5 Swordsmen: house 36 s, Mill 40 s, farm 18 s).
  - Rams and Trebuchets cannot hurt units and units are not chased by them; a wave with siege needs fighters to protect it (6 Villagers kill a Ram in 20 s; 5 Swordsmen need about 8 s).
  - (Superseded by WP33, see `docs/DESIGN.md` "WP33" and PLAN-M2 4.5 "Hardened targets".) Before WP33 an `attackMove` into Town Center range made the army retaliate against the Town Center and waste 1-damage blows: 5 Spearmen sent at a Town Center with attack-move were wiped in 75 s with the Villagers beside it untouched. Now a building a unit can only scratch is never a retaliation target, is skipped by a walking attack-move and ranks below every other candidate, so attack-moving infantry, cavalry and archers kill the Villagers beside a Town Center (`tests/sim/combatTargeting.test.ts`). Siege escorts should still attack the siege's target explicitly to keep up with it.
  - Equal-speed infantry (1.0 for Spearmen, Archers and Villagers) cannot catch a fleeing Villager; only cavalry (1.5, 1.3) does. Archers shoot while the target runs but do not close.
  - Repair under attack: 3 Villagers keep up with 3 infantry or cavalry attackers on a House or Barracks; they cannot outrepair siege or splash. A defence needs to kill the attackers.
  - Equal-cost counter choice for the AI: Spearman against cavalry, Swordsman against Spearmen and Horsemen, Archers against infantry (any), Horsemen against Archers, Cataphracts (Age 3) against almost everything but massed Spearmen.
- **Battering Ram** (verification fix pass): Age 2, trained at the Barracks and (from the Citadel) the Siege Workshop.
- **WP22 (defence):** a Town Center volley is 2 arrows of `7 - pierce armour` (WP33; was 5): 7 a second on a Villager (2.0 s cooldown), 6 on a Spearman, 5 on a Horseman, 4 on a Cataphract. It harasses; it cannot stop an army, which is the intended role.
