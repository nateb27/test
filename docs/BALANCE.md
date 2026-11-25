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
