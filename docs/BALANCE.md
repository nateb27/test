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

Reviewed against PLAN-M2 sections 4.1 to 4.3 (damage, range, timing) and 5 (content). Everything below is reproducible: `tests/unit/data/balanceModel.ts` is the model, `tests/unit/data/balance.test.ts` pins its results to the data, and `tests/sim/duels.test.ts` repeats the same cells on the real sim once combat is integrated (enable it with `COMBAT_INTEGRATED` in `tests/sim/duelHarness.ts`, or run `DUELS=1 npx vitest run tests/sim/duels.test.ts`).

## Method

- **Damage** is the 4.1 formula applied to the real data: `max(1, attack - armour) + floor(bonus * (100 - resist) / 100)`. Hits to kill and time to kill use the 4.3 timing (first blow after the wind-up, then one per cooldown).
- **Equal-cost duels** use a one-dimensional fight model. Both groups start 10 tiles apart and walk at their speed until in reach; ranged units then stand and shoot (arrows fly at 9 tiles/s); units die at the end of the tick, so simultaneous kills are possible; every attacker hits the nearest enemy it may target, and a group works on its front four victims at a time (so shooters neither overkill one unit nor spread damage evenly). There is no crowding limit and no kiting. It is exact for 1 against 1 and a fair guide for groups; the real-sim duels are the ground truth.
- **Group sizes** come from a budget of 1200 resources: 20 Spearmen, 13 Swordsmen, 16 Archers, 15 Horsemen, 7 Cataphracts, 5 Rams, 3 Trebuchets. The paper test also holds at budgets of 900, 1000, 1500 and 1800 (counts round differently there and survivors move by 10 to 20 points, results do not change).
- **Cell semantics.** "W": the row wins with at least 30% of its cost alive. "w": the row wins. The plan says "narrowly (above 0%)", but a narrow win is a knife edge under the square law (a 5% change in strength moves survivors by 20 points), so the tests require a win and the table below shows how far from narrow each cell is expected to be.

## Number changes (two)

| Change | Was (5.1) | Now | Why |
|---|---|---|---|
| Archer cooldown | 2.0 s | 1.6 s | With the 5.1 numbers an equal-cost group of Archers lost to Spearmen (the plan wants a win with at least 30% left): 4 damage a second per Archer is not enough against 50 hp Spearmen who close 4 tiles under fire. The Archer was also expected to beat the Swordsman narrowly and lost to it. 1.6 s (32 ticks) is +25% damage per second, which fixes both and leaves the Archer losing to Horsemen and Cataphracts (3 and 2 damage a hit against pierce armour 2 and 3). |
| Cataphract attack | 11 | 13 | The plan wants the Cataphract to beat the Swordsman (W) and the Horseman (W). At 11 it lost to equal-cost Swordsmen (9 damage a hit is 8 blows on 65 hp; 11 damage is 6) and beat Horsemen by too little. Against Spearmen it still loses, as planned. |

Alternatives tried in the model and rejected: Archer hit points 32 to 40 plus infantry bonus 4 to 5 also work, but `m2contracts.test.ts` pins `archer vs swordsman = 8` and the committed v2 save fixture holds an Archer with 32 hp, so those need contract-file changes; Spearman attack 5 to 4 narrows Spearman against Cataphract but moves the pinned Spearman numbers; Cataphract hit points 130 to 140 overshoot Swordsman and Horseman (win with 90 to 100% left) for no gain.

No economy number changed; the economy bot timings (Township 6:09 to 6:25 on 18 seeds) are untouched. One finding needs a change outside WP25 (see "Finding" under the siege rows).

## Expected duel table (model, budget 1200 and 1500)

Row against column. Each model cell shows the letter, then survivors as row%/column% of starting cost (1200, then 1500), and the cost efficiency at 1200 (enemy cost destroyed per cost lost; "inf" means no losses).

| | Spearman | Swordsman | Archer | Horseman | Cataphract |
|---|---|---|---|---|---|
| **Spearman** plan | — | L | L | W | w |
| model | | L 0/69, 0/76 | L 0/75, 0/55 | W 85/0, 84/0 (x6.7) | **W 55/0, 64/0 (x2.2)** |
| **Swordsman** plan | W | — | L | W | — |
| model | W 69/0, 76/0 (x3.3) | | L 0/50, 0/65 | W 46/0, 53/0 (x1.9) | L 0/57, 0/56 |
| **Archer** plan | W | w | — | L | L |
| model | W 50/0, 55/0 (x2.0) | **W 50/0, 65/0 (x1.9)** | | L 0/100, 0/79 | L 0/100 |
| **Horseman** plan | — | L | W | — | L |
| model | L 0/80, 0/84 | L 0/46, 0/53 | W 100/0, 79/0 (inf) | | L 0/100, 0/67 |
| **Cataphract** plan | L (3:1 spears) | W | W | W | — |
| model | L 0/65, 0/68 | W 71/0, 56/0 (x3.4) | W 100/0 | W 100/0, 67/0 (inf) | |

The Ram and Trebuchet columns are trivial wins for every row: siege cannot hurt units, so the row side keeps 100% (Spearmen need 28 blows per Ram, about 13 s for the group plus the walk). An Archer does 1 damage a hit to a Ram (pierce armour 40) and to a Trebuchet (10): 16 Archers kill one Ram in about 13 s, which is a bad trade (1200 spent on a 240 target that could not fight back anyway).

Predicted problem cells:

1. **Spearman against Cataphract** is a clear Spearman win (55 to 64% left), not a narrow one. One Cataphract (170) loses to three Spearmen (180) with two of them alive, and the square law favours the larger Spearman army further. Making it narrow needs a Cataphract that also crushes the Swordsman, which breaks the triangle (Swordsman beats Spearman, Spearman beats Cataphract, Cataphract beats Swordsman). Left as is; the test checks the win.
2. **Archer against Swordsman** is a comfortable Archer win in the model (50 to 65% left), not narrow. The real sim should reduce it (Swordsmen reach Archers faster than the model's walk, and Archers cannot all fire at the front unit). Watch this cell first at integration; if it turns into a loss, raise the Archer's infantry bonus to 5 (that needs the `m2contracts` pin changed) rather than the cooldown.
3. **Archer against Spearman** has the smallest margin of the "W" cells (50 to 55% at 1200 and 1500, 30% or less above that). It depends on the Archers' two free volleys before contact.
4. **Horseman against Archer** (79% at 1500) and **Cataphract against Horseman** (67%) are sensitive to how fast Horsemen (1.5 tiles/s) reach Archers in the real sim.

## Time to kill, one against one (seconds; damage per hit in brackets)

| Attacker | vs Spearman | vs Swordsman | vs Archer | vs Horseman | vs Cataphract |
|---|---|---|---|---|---|
| Spearman | 18.5 (5) | 42.5 (3) | 12.5 (5) | 8.5 (16) | 28.5 (8) |
| Swordsman | 7.7 (12) | 18.5 (6) | 5.9 (8) | 16.7 (7) | 41.9 (5) |
| Archer | 10.2 (8) | 13.4 (8) | 10.2 (5) | 37.4 (3) | 95.0 (2) |
| Horseman | 14.8 (6) | 29.2 (4) | 4.0 (11) | 23.8 (5) | 70.6 (3) |
| Cataphract | 6.5 (13) | 10.5 (11) | 2.5 (18) | 10.5 (12) | 22.5 (10) |

## Siege rows

Attackers start 10 tiles from the building's edge; times include the walk (Ram 0.6 tiles/s, Swordsman 0.95, Siphonarios 0.9).

| Row | Model | Plan | Verdict |
|---|---|---|---|
| 2 Rams destroy a Barracks | 52.4 s (20 blows of 62, 10 each; 15 s of it walking) | under 60 s | holds with 8 s of margin; crowding and approach in the real sim eat into it. If the duel fails by a few seconds, cut the Ram's cooldown from 4.0 to 3.5 s (48 s) rather than raising its bonus |
| 10 Swordsmen on the same Barracks | 44.4 s (6 damage a blow) | more than 3x the Rams (157 s) | **cannot hold: 10 Swordsmen are faster than 2 Rams** |
| Trebuchet against a Town Center | 122 s alone (16 stones of 151, one per 8 s) | from outside its range, undamaged | holds: reach 11.75 against the arrows' 7.75 (4 tiles of margin) |
| 6 Villagers kill a Ram | about 20 s (47 blows of 3, 8 each, plus 5 s walking) | under 30 s | holds |
| 4 Siphonarioi against 4 Swordsmen on a clump of 10 stand-ground Spearmen | 2.0x with 4 neighbours in the splash radius, 2.8x with 6, 3.5x with 8 | at least 2.5x | holds only for a tight clump. The harness packs the Spearmen on a 0.5 grid (6 to 9 neighbours); on a 1.0 grid only 4 are inside the radius and the row fails. If the real sim disagrees, raise the splash radius to 1.25 |
| 5 Siphonarioi against 5 Swordsmen on a Barracks | 31.2 s against 80.4 s (39%) | under 40% | holds, barely; with melee armour 7 it would be 8% |

### Finding: siege row 2 cannot hold with the 5.2 building armour

With Barracks melee armour 2 a Swordsman does 6 damage a blow (a Ram does 62), so 10 Swordsmen deal 33 damage a second against the 2 Rams' 31. Even with the walk removed the ratio is about 1, not 3, and the Ram cannot be made fast enough: its walk alone takes 15 s. Barracks melee armour 6 gives 116 s (2.2x the Rams); 7 gives 224 s against 52 s (4.3x).

**Request to the orchestrator:** set melee armour to 7 on Barracks, Archery Range, Stable, Siege Workshop and Silk Workshop (stone-built production) and to 8 on the Town Center; houses, Mills, Camps and Farms stay as in 5.2 (timber, so cavalry raids still work). Effects: a Swordsman does 1 damage a blow to a production building (Cataphract 6, Siphonarios 21, Ram 61 and Trebuchet 151 barely change), so razing a base needs siege, which is what 5.1 intends. Consequences: the AI waves (WP26) must include Rams or Siphonarioi to finish a conquest, and `m2contracts.test.ts` pins two numbers that change (`computeDamage(ram, barracks) = 4 - 2 + 60` becomes 61, and the Town Center's `meleeArmor: 3`). Until then `balance.test.ts` and `duels.test.ts` carry the row as an expected failure (`it.fails`) that turns into a normal test by itself once the Barracks has melee armour 7 or more, and `balance.test.ts` already checks the "with armour 7" figures.

## Military upgrades (5.4)

The 12 upgrades resolve to exactly the 5.4 effects through the real stat resolution (`combatData.test.ts`). The full tree gives: Spearman and Swordsman +2 attack and +2/+2 armour; Siphonarios +2/+2 armour only; Archer +2 attack, +1 range and +2/+2 armour; Horseman, Lancer and Cataphract +3 attack, +2 melee and +3 pierce armour. Villagers, siege and buildings do not change.

| Upgrade | Example | Effect |
|---|---|---|
| Spathion Forging (+1 attack) | Swordsman against Swordsman 6 to 7; Spearman against Swordsman 3 to 4 | time to kill 18.5 to 16.7 s; 42.5 to 32.5 s |
| Horn-and-Sinew Bows (+1) | Archer against Spearman 8 to 9; against Horseman 3 to 4 | 10.2 to 8.6 s on the Spearman (before the cooldown change: 11.4 to 9.6); 37 to 28 s on the Horseman |
| Kontarion Drill (+1) | Horseman against Archer 11 to 12 | no change in blows to kill (4): small upgrades bite only at hit-point thresholds, so Taktika Wedge (+2) matters more |
| Padded Kavadion (+1/+1) | Spearman against Swordsman 3 to 2; Swordsman against Swordsman 6 to 5 | 42.5 to 64.5 s; 18.5 to 22.1 s |
| Felt / Iron Horse Bards | Archer against Cataphract 2 to 1; Archer against Horseman 3 to 1 with both | arrows are nearly useless against upgraded cavalry (floor 1) |

With one side upgraded and the other not (equal-cost duels, budget 1200): level I of a line (one attack and one armour tech) moves survivors by 5 to 15 points and flips two cells, Swordsman against Cataphract (loss to a win with 54% left) and Horseman against Cataphract (loss to a narrow win with 20%). The full tree also flips Spearman and Swordsman against Archer (wins with 40% and 38% left) and gives the Horseman a clear win over the Cataphract (73%); it never lets the Archer beat cavalry. That is the intended shape: upgrades widen a unit's own matchups and narrow the opponent's, and upgrades are the way to beat a counter you could not beat on equal footing, while at equal upgrade levels the triangle stays.

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

- **WP26 (AI):** infantry cannot raze production buildings in reasonable time (see the finding; today a Swordsman needs 200 blows for a Barracks, after the request 1200). Put Rams or Siphonarioi into every wave that is meant to finish a game.
- **WP22 (defence):** a Town Center volley is 2 arrows of `5 - pierce armour`: 5 a second on a Villager (2.0 s cooldown), 4 on a Spearman, 2 on a Cataphract. It harasses; it cannot stop an army, which is the intended role.
