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

WP25 (paper review) changed two numbers; WP32 (real-sim tuning, below) changed six more and one building armour set. Nothing else in `src/data` moved; no economy number changed (costs of economic items, gather rates, age costs), so the economy bot timings are identical.

| # | Change | Was | Now | Why |
|---|---|---|---|---|
| 1 | Archer cooldown (WP25) | 2.0 s | 1.6 s | With the 5.1 numbers an equal-cost group of Archers lost to Spearmen (the plan wants a win with at least 30% left). 1.6 s is +25% damage per second and leaves the Archer losing to Horsemen and Cataphracts. |
| 2 | Cataphract attack (WP25) | 11 | 13 | The plan wants the Cataphract to beat the Swordsman (W) and the Horseman (W); at 11 it lost to equal-cost Swordsmen. |
| 3 | Building melee armour: Barracks, Archery Range, Stable, Siege Workshop, Silk Workshop (WP32, approved by the orchestrator) | 2 | 7 | The siege row "10 Swordsmen need more than 3 times as long as 2 Rams" cannot hold at 2 (10 Swordsmen were as fast as 2 Rams). At 7 a Swordsman does 1 damage a blow, so 10 Swordsmen need 440 s against 48 s for 2 Rams (9x). |
| 4 | Town Center melee armour (WP32) | 3 | 8 | Same reason; Cataphracts, Horsemen and Siphonarioi do 1 to 6 a blow against it, so only siege razes it (Siphonarioi die to its arrows first). |
| 5 | Archer bonus against infantry (WP32) | +4 | +5 | **The thin spot of the matrix.** Archer against Swordsman was a comfortable win at 1200 (75% left) but is a square-law knife edge at other sizes: at a budget of 600 (8 Archers, 600, against 7 Swordsmen, 630) the Swordsmen won with 43% left, and winners kept as little as 22% elsewhere. At +5 an Archer does 9 to a Swordsman or a Spearman (was 8), kills a Spearman in 6 hits instead of 7 and a Swordsman in 8 instead of 9, and the cell keeps at least 50% of the Archers at every budget from 300 to 3000 in both creation orders. Archers against cavalry are unchanged (the bonus is against the `infantry` class). Pinned in `m2contracts.test.ts` (`archer` against `swordsman` 8 to 9) and `balance.test.ts` (`hit(archer, spear)` 8 to 9). |
| 6 | Battering Ram cooldown (WP32) | 4.0 s | 3.5 s | 2 Rams took 52.5 s to destroy a Barracks from 10 tiles (limit 60 s; 15 s of that is the walk), a margin of 12%. The plan's own fallback: 3.5 s gives 48 s (20%). Rams also kill a Town Center sooner (5 Rams, 28 s). |
| 7 | Siphonarios splash radius (WP32) | 1.0 | 1.25 | The clump row (4 Siphonarioi against 4 Swordsmen on 10 packed stand-ground Spearmen, needs 2.5x) passed at 2.52, a knife edge. At 1.25 the whole 0.5-spaced clump is inside the radius: 5.0x. Percent stays 60. Pinned in `m2contracts.test.ts` (`splash` `{ radius: 1.25, percent: 60 }`). |

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
| 10 Swordsmen on the same Barracks | more than 3x the Rams (144 s) | 440.5 s (9.2x; the swordsmen deal 1 a blow) | 3x the required time |
| Trebuchet against a Town Center from outside its range | undamaged | destroyed in 128.9 s, hp never below 100%, closest approach 11.73 tiles (arrows reach 7.75) | 4 tiles |
| 6 Villagers kill a Ram | under 30 s | 20.4 s | 9.6 s |
| 4 Siphonarioi against 4 Swordsmen on a clump of 10 stand-ground Spearmen (0.5 grid) | at least 2.5x the damage per second | 5.0x (100 against 19.8 damage per second; the clump dies in 5 s) | 2x |
| 5 Siphonarioi against 5 Swordsmen on a Barracks | under 40% of the time | 36.8 s against 440.8 s (8%) | 5x |

The clump row only pays off on tight clumps: on a 0.75 grid the same Siphonarioi are 1.6x, on 1.0 1.3x and on 1.5 0.75x (they lose to 4 Swordsmen). Armies in melee are tight (units pass through each other, so the ranks pile up on the 0.45 separation radius), which is where the Siphonarios is meant to shine; against a spread-out line it is a slow demolisher.

### Building armour

Production buildings (Barracks, Archery Range, Stable, Siege Workshop, Silk Workshop) have melee armour 7 and the Town Center 8. A Swordsman does 1 damage a blow to them (Cataphract 6, Siphonarios 21, Ram 61, Trebuchet 151). Houses (melee armour 1), Mills and camps (1) and Farms (0) are unchanged from 5.2: timber and thatch, so a raid works. Five idle soldiers destroy, from 2 tiles away:

| Five of | House (550 hp) | Mill / Camp (600) | Farm (300) | Barracks (1200) | Town Center (2400) |
|---|---|---|---|---|---|
| Villager | 138 s | 150 s | 50 s | 480 s | never (arrows) |
| Spearman | 70 s | 76 s | 30 s | over 480 s | never |
| Swordsman | 36 s | 40 s | 18 s | 432 s | never |
| Archer | 175 s | 191 s | 95 s | 384 s | never |
| Horseman | 50 s | 54 s | 23 s | 432 s | never |
| Cataphract | 24 s | 26 s | 12 s | 80 s | never |
| Siphonarios | 11 s | 11 s | 6 s | 29 s | never (45 hp against 2 arrows) |
| Battering Ram | 7 s | 10 s | 4 s | 14 s | 28 s |
| Trebuchet | 5 s | 5 s | 4 s | 13 s | 29 s |

I kept the non-production armour as it was: infantry and cavalry raze an economy in about half a minute to a minute and a half, which is the intended raid, and an archer-only raid is not meant to be efficient. Production buildings need siege (or a Cataphract or Siphonarios squad): that is what the plan's 5.1 says, and it is what the AI waves must plan for (see "Notes for other packages").

## Feel numbers

All measured on the real sim by `tests/sim/feel.test.ts` (bounds are asserted there). No upgrades, Founding to Citadel stats.

- **Five of one type kill one idle Villager** (starting 6 tiles away, including the walk): Archer 1.9 s, Horseman 4.2, Cataphract 4.7, Siphonarios 4.7, Spearman 6.2, Swordsman 6.5, Villager 8.2 s. A Villager (25 hp) dies in two or three hits.
- **A house** (550 hp) falls to 5 Swordsmen in 36 s, to 5 Spearmen in 70 s, to 5 Rams in 7 s; **a Town Center** only to siege (5 Rams 28 s, 5 Trebuchets 29 s); **a Barracks** to 5 Rams in 14 s and to 5 Cataphracts in 80 s.
- **Town Center arrows against a raid of 5** that is sent at 5 idle Villagers beside it (each raider ordered to attack the Villagers one after the other): Spearmen kill all 5 Villagers in 31 s and lose 1 unit; Swordsmen 26 s, lose 1; Archers 27 s, lose 2; Siphonarioi 24 s, lose 1; Horsemen 20 s, lose none; Cataphracts 19 s, lose none. So an infantry or archer raid hurts (the workers die, a fifth to two fifths of the raid dies) and is not free; a cavalry raid is almost free against workers who stand still. The counter is to move the workers (a Villager walks at 1.0, Horsemen at 1.5; infantry cannot catch a fleeing Villager at equal speed) and answer with Spearmen. I left the Town Center arrows alone: 5 pierce, 2 arrows per 2 s does 4 damage a second to a Spearman, 3 to a Horseman and 2 to a Cataphract, and raising it to 6 changed no cell of the table (Horsemen still lost none).
- **Repair against 3 attackers** (the Villagers start 5 s after the first blow and are re-ordered when an order ends at full hp): 3 Villagers hold a House against 3 Swordsmen (hp never below 466 of 550), 3 Spearmen (506) and 3 Horsemen (490); 1 Villager does not (the Swordsmen win in about 110 s). 3 Cataphracts beat 3 Villagers (38 hp left, 5 Villagers hold at 416). 3 Swordsmen cannot hurt a Barracks. Siege outpaces repair: 3 Rams destroy a Barracks in 34 s with 1 repairer and 41 s with 5, and 3 Siphonarioi destroy a House in 22 s to 35 s because their splash kills the repairers. Repair therefore keeps up with infantry and cavalry raiders and loses to siege, which is why the defender has to kill the Rams (6 Villagers need 20 s).
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
- AI timings are placeholders until WP26 measures them (`tests/sim/ai.test.ts`) and the Phase 3 tuning fills the right-hand columns:

| Difficulty | Township (target) | First wave (target) | Township (measured) | First wave (measured) |
|---|---|---|---|---|
| Easy | 8:30 to 10:30 | not before 15:00 | TBD | TBD |
| Standard | 6:30 to 7:45 | 10:00 to 12:00 | TBD | TBD |
| Hard | 5:00 to 6:00 | 7:00 to 8:30 | TBD | TBD |

## Notes for other packages

- **WP26 (AI), what the real numbers mean for waves.**
  - Infantry cannot raze production buildings or the Town Center (melee armour 7 and 8): a Swordsman does 1 damage a blow (1200 blows for a Barracks), 5 Swordsmen need 432 s for a Barracks and never for a Town Center. Every wave meant to end a game needs siege: 2 Rams take a Barracks in 48 s from 10 tiles, 5 Rams take a Town Center in 28 s; Cataphracts (80 s for 5 on a Barracks) and Siphonarioi (29 s for 5) also work, a Siphonarios squad dies to Town Center arrows before it razes the Town Center. Houses, Mills, Camps and Farms still fall to infantry (5 Swordsmen: house 36 s, Mill 40 s, farm 18 s).
  - Rams and Trebuchets cannot hurt units and units are not chased by them; a wave with siege needs fighters to protect it (6 Villagers kill a Ram in 20 s; 5 Swordsmen need about 8 s).
  - An `attackMove` into Town Center range makes the army retaliate against the Town Center (target priority tier 0 is the last attacker, buildings included) and waste its blows (1 damage each) while the arrows kill it: 5 Spearmen sent at a Town Center with attack-move were wiped in 75 s with the Villagers beside it untouched. A raid on workers needs explicit `attack` orders on the Villagers (`feelHarness.runRaid`); siege escorts should attack the siege's target first.
  - Equal-speed infantry (1.0 for Spearmen, Archers and Villagers) cannot catch a fleeing Villager; only cavalry (1.5, 1.3) does. Archers shoot while the target runs but do not close.
  - Repair under attack: 3 Villagers keep up with 3 infantry or cavalry attackers on a House or Barracks; they cannot outrepair siege or splash. A defence needs to kill the attackers.
  - Equal-cost counter choice for the AI: Spearman against cavalry, Swordsman against Spearmen and Horsemen, Archers against infantry (any), Horsemen against Archers, Cataphracts (Age 3) against almost everything but massed Spearmen.
- **WP22 (defence):** a Town Center volley is 2 arrows of `5 - pierce armour`: 5 a second on a Villager (2.0 s cooldown), 4 on a Spearman, 2 on a Cataphract. It harasses; it cannot stop an army, which is the intended role.
