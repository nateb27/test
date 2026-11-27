import { expect, test, type Page } from '@playwright/test';
import {
  advanceClock,
  card,
  centreCamera,
  collectErrors,
  overHud,
  overlayStats,
  placeViaCard,
  SEPARATE_MS,
  selection,
  selectVillager,
  shot,
  startMatch,
  step,
  stepUntil,
  toScreen,
  townCenter,
  villagers,
  type Pt,
} from './helpers';

/**
 * PLAN-M2 8.2 combat scenarios against real combat, driven through the UI: a two-player match (`?opponent=standard&ai=off`,
 * so player 2 has a Town Center and villagers but its AI issues nothing), enemy units spawned with
 * `cheat.spawnUnit(..., 2)`, own units spawned and then selected and ordered with real clicks (every target verified
 * with `pickAt` first), card buttons and hotkeys. Time only moves through `__game.step`.
 *
 * The WP27 effect layer is checked through `__game.effects()` (corpses, projectiles, fires, rubble).
 */

const OPPONENT = { opponent: 'standard', ai: 'off' } as const;
const ENEMY = 2;

type Spawn = readonly [type: string, x: number, y: number];

/** Spawn units for `owner` (cheat), run the tick that applies it, and return the new ids in spawn order. */
async function spawn(page: Page, list: readonly Spawn[], owner = 1): Promise<number[]> {
  const before = await page.evaluate(() => window.__game!.state!.entities.reduce((m, e) => Math.max(m, e.id), 0));
  await page.evaluate(
    ([l, o]) => {
      for (const [t, x, y] of l as Spawn[]) window.__game!.cheat.spawnUnit(t as never, x, y, o as number);
    },
    [list, owner] as const,
  );
  await step(page, 1);
  const ids = await page.evaluate(
    ([b, o]) => window.__game!.state!.entities.filter((e) => e.id > (b as number) && e.kind === 'unit' && e.owner === o).map((e) => e.id),
    [before, owner] as const,
  );
  expect(ids, 'every spawn landed on a free tile').toHaveLength(list.length);
  return ids;
}

interface Unit {
  id: number;
  x: number;
  y: number;
  hp: number;
  owner: number;
  order: string | null;
  target: number | null;
  stance: string;
}

/** A unit's live facts, or null once it is gone. */
const unit = (page: Page, id: number): Promise<Unit | null> =>
  page.evaluate((i) => {
    const e = window.__game!.state!.entities.find((x) => x.id === i);
    if (e === undefined || e.kind !== 'unit') return null;
    const o = e.currentOrder as { type: string; targetId?: number } | null;
    return { id: e.id, x: e.pos.x, y: e.pos.y, hp: e.hp, owner: e.owner, order: o?.type ?? null, target: o?.targetId ?? null, stance: e.stance };
  }, id);

const units = async (page: Page, ids: readonly number[]): Promise<Unit[]> => (await Promise.all(ids.map((i) => unit(page, i)))).filter((u): u is Unit => u !== null);

const hpOf = (page: Page, id: number): Promise<number | null> =>
  page.evaluate((i) => {
    const e = window.__game!.state!.entities.find((x) => x.id === i);
    return e === undefined || e.kind === 'node' ? null : e.hp;
  }, id);

const gone = (id: number): string => `!g.state.entities.some((e) => e.id === ${id})`;
const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Where a click verifiably picks entity `id` (its body a little above the feet, or its footprint), else throws. */
async function pointOn(page: Page, id: number): Promise<Pt> {
  const c = await page.evaluate((i) => {
    const e = window.__game!.state!.entities.find((x) => x.id === i)!;
    const sizes: Record<string, number> = { townCenter: 4, house: 2, barracks: 3 };
    return e.kind === 'unit' ? { x: e.pos.x, y: e.pos.y, unit: true } : { x: e.tile.tx + (sizes[e.typeId] ?? 1) / 2, y: e.tile.ty + (sizes[e.typeId] ?? 1) / 2, unit: false };
  }, id);
  const base = await toScreen(page, c.x, c.y);
  const offsets = c.unit ? [-14, -10, -18, -6, -22, -2] : [0, -10, 10, -20];
  for (const dy of offsets) {
    const p = { x: base.x, y: base.y + dy };
    if (await overHud(page, p.x, p.y)) continue;
    if ((await page.evaluate(([x, y]) => window.__game!.pickAt(x!, y!), [p.x, p.y] as const)) === id) return p;
  }
  throw new Error(`no point on screen picks entity ${id}`);
}

/** Left-click (optionally with Shift) or right-click an entity at a verified point. */
async function clickEntity(page: Page, id: number, opts: { button?: 'left' | 'right'; shift?: boolean } = {}): Promise<void> {
  const p = await pointOn(page, id);
  await advanceClock(page, SEPARATE_MS);
  if (opts.shift === true) await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y, { button: opts.button ?? 'left' });
  if (opts.shift === true) await page.keyboard.up('Shift');
}

/** Select exactly these own units: a click on the first, Shift-clicks on the rest. */
async function selectUnits(page: Page, ids: readonly number[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) await clickEntity(page, ids[i]!, { shift: i > 0 });
  expect(await selection(page)).toEqual([...ids].sort((a, b) => a - b));
}

/**
 * A clear world point near (cx, cy), at least `rMin` tiles away, with `margin` tiles clear of everything, whose screen
 * point is on the canvas, off the HUD and picks nothing (a click there is a ground click).
 */
function clearSpot(page: Page, cx: number, cy: number, rMin: number, margin = 2): Promise<Pt> {
  return page.evaluate(
    ([px, py, r0, m]) => {
      const g = window.__game!;
      const s = g.state!;
      const sizes: Record<string, number> = { townCenter: 4, goldDeposit: 2, stoneDeposit: 2, house: 2, farm: 2, lumberCamp: 2, mill: 2, miningCamp: 2, barracks: 3 };
      for (let r = r0!; r <= r0! + 14; r++) {
        for (let a = 0; a < 32; a++) {
          const x = Math.floor(px! + Math.cos((a * Math.PI) / 16) * r) + 0.5;
          const y = Math.floor(py! + Math.sin((a * Math.PI) / 16) * r) + 0.5;
          if (x < 3 || y < 3 || x > s.map.width - 3 || y > s.map.height - 3) continue;
          const sc = g.worldToScreen(x, y);
          if (sc.x < 80 || sc.x > window.innerWidth - 80 || sc.y < 100 || sc.y > window.innerHeight - 280) continue;
          // A click there is a ground click: no sprite drawn over it, no HUD panel above it.
          if (g.pickAt(sc.x, sc.y) !== null) continue;
          const el = document.elementFromPoint(sc.x, sc.y);
          if (el !== null && el.closest('.panel, .toast, .banner, .modal-backdrop') !== null) continue;
          const clear = s.entities.every((e) => {
            const size = e.kind === 'unit' ? 0 : (sizes[e.typeId] ?? 1);
            const ex = e.kind === 'unit' ? e.pos.x : e.tile.tx + size / 2;
            const ey = e.kind === 'unit' ? e.pos.y : e.tile.ty + size / 2;
            return Math.max(Math.abs(ex - x), Math.abs(ey - y)) > m! + size / 2;
          });
          if (clear) return { x, y };
        }
      }
      throw new Error('no clear spot on screen');
    },
    [cx, cy, rMin, margin] as const,
  );
}

/**
 * A two-player match, paused, camera on a clear spot out of the own Town Center's arrow range (7 tiles from its
 * centre plus reach) but near it; returns that spot.
 */
async function fightGround(page: Page): Promise<Pt> {
  await startMatch(page, OPPONENT);
  const tc = await townCenter(page);
  await centreCamera(page, tc.x + 8, tc.y + 8);
  const spot = await clearSpot(page, tc.x, tc.y, 13, 3);
  await centreCamera(page, spot.x, spot.y);
  return clearSpot(page, spot.x, spot.y, 0, 3);
}

const effects = (page: Page): Promise<{ projectiles: number; corpses: number; rubble: number; fires: number; effects: number }> =>
  page.evaluate(() => window.__game!.effects());

test('scenario 2: right-click an enemy horseman: the selected spearmen attack it with the sword cursor, it loses hp and dies', async ({ page }) => {
  const errors = collectErrors(page);
  const g = await fightGround(page);
  const spears = await spawn(page, [['spearman', g.x, g.y], ['spearman', g.x + 1, g.y], ['spearman', g.x, g.y + 1.2]]);
  const [horse] = await spawn(page, [['horseman', g.x + 4.5, g.y + 0.5]], ENEMY);
  await selectUnits(page, spears);

  // The sword over an enemy the selection can attack; the default cursor over open ground.
  const hp0 = (await hpOf(page, horse!))!;
  const p = await pointOn(page, horse!);
  await page.mouse.move(p.x, p.y);
  expect(await page.evaluate(() => window.__game!.cursor())).toBe('attack');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await step(page, 1);
  for (const u of await units(page, spears)) expect([u.order, u.target]).toEqual(['attack', horse]);
  await shot(page, 'm2-02-attack');

  await stepUntil(page, `(g.state.entities.find((e) => e.id === ${horse}) ?? { hp: 0 }).hp < ${hp0}`, 400);
  await stepUntil(page, gone(horse!), 3000);
  expect(await page.evaluate(() => window.__game!.state!.players[1]!.stats.unitsKilled)).toBeGreaterThanOrEqual(1);
  // The horseman's death plays where it fell and the body stays (WP27 decal layer).
  expect((await effects(page)).corpses).toBeGreaterThanOrEqual(1);
  // The pointer never moved: the sword went with the enemy (the cursor follows the world, not only pointer moves).
  expect(await page.evaluate(() => window.__game!.cursor())).toBe('default');
  await shot(page, 'm2-02-killed');
  expect(errors).toEqual([]);
});

test('scenario 3: attack-move through the card: the units kill an enemy met midway and walk on to the point', async ({ page }) => {
  const errors = collectErrors(page);
  const g = await fightGround(page);
  const spears = await spawn(page, [['spearman', g.x, g.y], ['spearman', g.x + 1, g.y], ['spearman', g.x, g.y + 1.2]]);
  const dest = await clearSpot(page, g.x + 9, g.y + 2, 0, 1);
  const mid = { x: Math.floor((g.x + dest.x) / 2) + 0.5, y: Math.floor((g.y + dest.y) / 2) + 0.5 };
  const [foe] = await spawn(page, [['villager', mid.x, mid.y]], ENEMY);
  await selectUnits(page, spears);

  await card(page, 'Attack-move').click();
  expect(await page.evaluate(() => window.__game!.inputMode())).toBe('attackMove');
  expect(await page.evaluate(() => window.__game!.cursor())).toBe('attackMove');
  const target = await toScreen(page, dest.x, dest.y);
  expect(await overHud(page, target.x, target.y)).toBe(false);
  expect(await page.evaluate(([x, y]) => window.__game!.pickAt(x!, y!), [target.x, target.y] as const)).toBeNull();
  await page.mouse.click(target.x, target.y);
  expect(await page.evaluate(() => window.__game!.inputMode())).toBeNull();
  await step(page, 1);
  for (const u of await units(page, spears)) expect(u.order).toBe('attackMove');
  await shot(page, 'm2-03-attack-move');

  await stepUntil(page, gone(foe!), 3000);
  await stepUntil(page, `[${spears.join(',')}].every((id) => { const e = g.state.entities.find((x) => x.id === id); return e && e.currentOrder === null && e.path === null; })`, 3000);
  for (const u of await units(page, spears)) expect(dist(u, dest)).toBeLessThan(3);
  expect(errors).toEqual([]);
});

test('scenario 4: stand-ground spearmen do not chase an archer shooting them; switched to aggressive (Z) they chase and kill it', async ({ page }) => {
  const errors = collectErrors(page);
  const g = await fightGround(page);
  const spears = await spawn(page, [['spearman', g.x, g.y], ['spearman', g.x, g.y + 1.2], ['spearman', g.x - 1, g.y + 0.6]]);
  await selectUnits(page, spears);
  await page.keyboard.press('KeyX');
  await step(page, 1);
  for (const u of await units(page, spears)) expect(u.stance).toBe('standGround');
  await expect(card(page, 'Stand ground')).toHaveClass(/active/);
  const start = await units(page, spears);

  const [archer] = await spawn(page, [['archer', g.x + 4.5, g.y + 0.5]], ENEMY);
  // Archers counter spearmen (PLAN-M2 5.3), so the test switches stance soon after the first arrows land.
  await stepUntil(page, `[${spears.join(',')}].some((id) => (g.state.entities.find((e) => e.id === id) ?? { hp: 0 }).hp < 50)`, 400);
  await step(page, 40);
  for (const u of await units(page, spears)) expect(dist(u, start.find((s) => s.id === u.id)!)).toBeLessThan(0.6);
  expect(await unit(page, archer!)).not.toBeNull();
  await shot(page, 'm2-04-stand-ground');

  await page.keyboard.press('KeyZ');
  await step(page, 1);
  for (const u of await units(page, spears)) expect(u.stance).toBe('aggressive');
  await expect(card(page, 'Aggressive')).toHaveClass(/active/);
  await stepUntil(page, gone(archer!), 3000);
  expect(errors).toEqual([]);
});

test('scenario 5: hold position (S): the units ignore an enemy out of reach and attack one that comes into reach, never moving', async ({ page }) => {
  const errors = collectErrors(page);
  const g = await fightGround(page);
  const spears = await spawn(page, [['spearman', g.x, g.y], ['spearman', g.x, g.y + 1.2]]);
  await selectUnits(page, spears);
  await page.keyboard.press('KeyS');
  await step(page, 1);
  for (const u of await units(page, spears)) expect(u.order).toBe('hold');
  const start = await units(page, spears);
  const moved = async (): Promise<number> => Math.max(...(await units(page, spears)).map((u) => dist(u, start.find((s) => s.id === u.id)!)));

  // An enemy villager 3 tiles away (it never attacks): out of reach, so nobody moves and it is not hurt.
  const [passer] = await spawn(page, [['villager', g.x + 3.5, g.y + 0.5]], ENEMY);
  await step(page, 200);
  expect(await moved()).toBeLessThan(0.05);
  expect(await hpOf(page, passer!)).toBe(25);

  // An enemy spearman walks up to fight: in reach, the held units hit it, and still do not move.
  const [attacker] = await spawn(page, [['spearman', g.x - 3.5, g.y + 0.5]], ENEMY);
  await stepUntil(page, `(g.state.entities.find((e) => e.id === ${attacker}) ?? { hp: 0 }).hp < 50`, 600);
  await stepUntil(page, gone(attacker!), 2000);
  expect(await moved()).toBeLessThan(0.6);
  for (const u of await units(page, spears)) expect(u.order).toBe('hold');
  await shot(page, 'm2-05-hold');
  expect(errors).toEqual([]);
});

test('scenario 6: health bars and inspection: a damaged own building shows a bar; an enemy swordsman shows hp and the combat line', async ({ page }) => {
  const errors = collectErrors(page);
  const g = await fightGround(page);
  const tc = await townCenter(page);
  await page.evaluate((id) => window.__game!.cheat.setHp(id, 1200), tc.id);
  const [sword] = await spawn(page, [['swordsman', g.x, g.y]], ENEMY);
  await step(page, 1);
  expect((await overlayStats(page)).healthBars).toBeGreaterThanOrEqual(1);

  await clickEntity(page, sword!);
  expect(await selection(page)).toEqual([sword]);
  await step(page, 1);
  await expect(page.getByTestId('sel-name')).toHaveText('Swordsman');
  await expect(page.getByTestId('sel-hp')).toContainText('65');
  await expect(page.getByTestId('sel-attack')).toContainText('8');
  await expect(page.getByTestId('sel-armor')).toHaveText(/M 2\s*\/\s*P 1/);
  await expect(page.getByTestId('sel-owner')).toContainText('Computer');
  // Read-only: no command card for an enemy.
  await expect(page.locator('[data-testid="command-card"] button[aria-label^="Stop ("]')).toHaveCount(0);
  expect((await overlayStats(page)).healthBars).toBeGreaterThanOrEqual(2); // selected enemy + damaged Town Center
  await shot(page, 'm2-06-inspect-enemy');
  expect(errors).toEqual([]);
});

test('scenario 7: archers fire projectiles that fly and hurt the target', async ({ page }) => {
  const errors = collectErrors(page);
  const g = await fightGround(page);
  await spawn(page, [['archer', g.x, g.y], ['archer', g.x, g.y + 1.2]]);
  const [target] = await spawn(page, [['villager', g.x + 4.5, g.y + 0.5]], ENEMY);
  await stepUntil(page, 'g.state.projectiles.length > 0', 200, 1);
  await shot(page, 'm2-07-projectiles');
  expect((await effects(page)).projectiles).toBeGreaterThan(0);
  await stepUntil(page, `(g.state.entities.find((e) => e.id === ${target}) ?? { hp: 0 }).hp < 25`, 200);
  await stepUntil(page, gone(target!), 2000);
  expect(errors).toEqual([]);
});

test('scenario 8: an enemy horseman next to the Town Center is shot down by its arrows without player input', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, OPPONENT);
  const tc = await townCenter(page);
  const spot = await clearSpot(page, tc.x, tc.y, 3, 0);
  const [horse] = await spawn(page, [['horseman', spot.x, spot.y]], ENEMY);
  // The Town Center shoots (its own projectiles appear) and the horseman dies; nobody gives an order.
  await stepUntil(page, `g.state.projectiles.some((p) => p.sourceId === ${tc.id})`, 100, 1);
  // Plan 8.2 says within 15 s (300 ticks). With 2 arrows of 7 pierce every 2 s (WP33) against pierce armour 2 and 70 hp
  // a lone idle horseman dies in about 250 ticks on the sim (tests/sim/feel.test.ts asserts <= 320); 400 leaves room for
  // the horseman chasing a villager out of reach for a while.
  const ticks = await stepUntil(page, gone(horse!), 400, 10);
  test.info().annotations.push({ type: 'info', description: `horseman died after ${ticks} ticks` });
  expect(errors).toEqual([]);
});

test('scenario 10: Repair (R) on a damaged own Barracks: hp rises, wood falls, the villager idles at full hp', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, OPPONENT);
  const tc = await townCenter(page);
  await page.evaluate(() => {
    window.__game!.cheat.addResources({ wood: 2000, food: 1000, gold: 1000, stone: 1000 });
    window.__game!.cheat.instantBuild(true);
  });
  await step(page, 1);
  const [v] = await villagers(page);
  await selectVillager(page, v!.id);
  const barracks = await placeViaCard(page, { menu: 'Military', label: 'Barracks', size: 3, near: tc, minRing: 6 });
  await page.evaluate(() => window.__game!.cheat.instantBuild(false));
  await step(page, 2);
  const maxHp = (await hpOf(page, barracks.id))!;
  await page.evaluate(([id, hp]) => window.__game!.cheat.setHp(id!, hp!), [barracks.id, Math.floor(maxHp / 2)] as const);
  await step(page, 1);
  expect(await hpOf(page, barracks.id)).toBe(Math.floor(maxHp / 2));
  // Park the villager (it may still be walking from the build) and let it stand.
  await stepUntil(page, `g.state.entities.some((e) => e.id === ${v!.id} && e.currentOrder === null)`, 2000);
  const wood0 = await page.evaluate(() => window.__game!.state!.players[1]!.resources.wood);

  await centreCamera(page, barracks.x, barracks.y);
  await selectVillager(page, v!.id);
  // The card stays on the build page after a placement (M1 rule); Repair is on the main page.
  if ((await card(page, 'Repair').count()) === 0) await card(page, 'Back').click();
  await page.keyboard.press('KeyR');
  expect(await page.evaluate(() => window.__game!.inputMode())).toBe('repair');
  expect(await page.evaluate(() => window.__game!.cursor())).toBe('repair');
  await clickEntity(page, barracks.id);
  expect(await page.evaluate(() => window.__game!.inputMode())).toBeNull();
  await step(page, 1);
  expect((await unit(page, v!.id))!.order).toBe('repair');
  await stepUntil(page, `g.state.entities.some((e) => e.id === ${barracks.id} && e.repairerIds.length > 0)`, 1000);
  await shot(page, 'm2-10-repair');
  await stepUntil(page, `g.state.entities.some((e) => e.id === ${barracks.id} && e.hp >= ${maxHp})`, 6000);
  await step(page, 2);
  expect(await page.evaluate(() => window.__game!.state!.players[1]!.resources.wood)).toBeLessThan(wood0);
  expect((await unit(page, v!.id))!.order).toBeNull();
  expect(errors).toEqual([]);
});

test('scenario 11: an enemy attacks a villager: toast, minimap ping, and Space centres the camera on it', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, OPPONENT);
  const tc = await townCenter(page);
  const vs = await villagers(page);
  const v = vs[0]!;
  const spot = await clearSpot(page, v.x, v.y, 1, 0);
  await spawn(page, [['spearman', spot.x, spot.y]], ENEMY);
  // Look elsewhere first, so Space visibly moves the camera.
  const far = { x: tc.x < 60 ? tc.x + 30 : tc.x - 30, y: tc.y < 60 ? tc.y + 30 : tc.y - 30 };
  await centreCamera(page, far.x, far.y);
  await stepUntil(page, 'g.alerts().length > 0', 600, 1);
  await step(page, 1);
  await expect(page.getByTestId('toast').filter({ hasText: 'Your units are under attack!' })).toBeVisible();
  const [alert] = await page.evaluate(() => window.__game!.alerts());
  expect(alert).toBeDefined();
  await shot(page, 'm2-11-alert');

  await page.keyboard.press('Space');
  await step(page, 1);
  const p = await toScreen(page, alert!.x, alert!.y);
  const box = (await page.locator('canvas.world-canvas').boundingBox())!;
  expect(dist(p, { x: box.x + box.width / 2, y: box.y + box.height / 2 })).toBeLessThan(40);
  expect(errors).toEqual([]);
});

test('scenario 12: Spathion Forging raises the Swordsman attack in the panel from 8 to 9', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await startMatch(page, OPPONENT);
  const tc = await townCenter(page);
  await page.evaluate(() => {
    window.__game!.cheat.addResources({ food: 5000, wood: 5000, gold: 5000, stone: 5000 });
    window.__game!.cheat.instantBuild(true);
    window.__game!.cheat.instantResearch(true);
  });
  await step(page, 1);
  const g = await clearSpot(page, tc.x, tc.y, 6, 2);
  const [sword] = await spawn(page, [['swordsman', g.x, g.y]]);
  await centreCamera(page, g.x, g.y);
  await clickEntity(page, sword!);
  await expect(page.getByTestId('sel-attack')).toContainText('8');

  const [v] = await villagers(page);
  await centreCamera(page, tc.x, tc.y);
  await selectVillager(page, v!.id);
  await placeViaCard(page, { menu: 'Economy', label: 'Lumber Camp', size: 2, near: tc, minRing: 5 });
  await selectVillager(page, v!.id);
  await placeViaCard(page, { menu: 'Economy', label: 'Mill', size: 2, near: tc, minRing: 5 });
  await page.keyboard.press('KeyH');
  await card(page, 'Township Age').click();
  await stepUntil(page, 'g.state.players[1].age === 2', 200);
  await selectVillager(page, v!.id);
  const barracks = await placeViaCard(page, { menu: 'Military', label: 'Barracks', size: 3, near: tc, minRing: 6 });
  await centreCamera(page, barracks.x, barracks.y);
  await clickEntity(page, barracks.id);
  await card(page, 'Spathion Forging').click();
  await stepUntil(page, `g.state.players[1].researched.includes('spathionForging')`, 200);

  await centreCamera(page, g.x, g.y);
  await clickEntity(page, sword!);
  await step(page, 1);
  await expect(page.getByTestId('sel-attack')).toContainText('9');
  await shot(page, 'm2-12-upgrade');
  expect(errors).toEqual([]);
});

test('scenario 16: comma selects and centres idle soldiers in turn', async ({ page }) => {
  const errors = collectErrors(page);
  const g = await fightGround(page);
  const ids = await spawn(page, [['spearman', g.x, g.y], ['archer', g.x + 6, g.y + 3]]);
  const box = (await page.locator('canvas.world-canvas').boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  for (const id of [...ids, ids[0]!]) {
    await page.keyboard.press('Comma');
    await step(page, 1);
    expect(await selection(page)).toEqual([id]);
    const u = (await unit(page, id))!;
    expect(dist(await toScreen(page, u.x, u.y), centre)).toBeLessThan(40);
  }
  expect(errors).toEqual([]);
});

test('scenarios 9 and 14: rams right-clicked onto the enemy Town Center destroy it, cavalry attack-moves through the villagers: victory', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await startMatch(page, OPPONENT);
  const [etc] = await page.evaluate(() =>
    window.__game!.state!.entities.flatMap((e) => (e.kind === 'building' && e.owner === 2 && e.typeId === 'townCenter' ? [{ id: e.id, x: e.tile.tx + 2, y: e.tile.ty + 2 }] : [])),
  );
  expect(etc).toBeDefined();
  const size = await page.evaluate(() => window.__game!.state!.map.width);
  // Stage just outside the Town Center's arrow range, on the side facing the map centre.
  const len = Math.hypot(size / 2 - etc!.x, size / 2 - etc!.y);
  const stage = { x: etc!.x + ((size / 2 - etc!.x) / len) * 10, y: etc!.y + ((size / 2 - etc!.y) / len) * 10 };
  await centreCamera(page, stage.x, stage.y);
  const base = await clearSpot(page, stage.x, stage.y, 0, 3);
  const rams = await spawn(page, [0, 1, 2, 3].map((i) => ['batteringRam', base.x - 1.5 + i * 1.2, base.y - 1] as const));
  const riders = await spawn(page, [0, 1, 2, 3, 4].map((i) => ['cataphract', base.x - 2 + i * 1.1, base.y + 1.2] as const));
  const enemyPop0 = await page.evaluate(() => window.__game!.state!.players[2]!.popCap);

  // Rams: right click on the enemy Town Center (an enemy building).
  await selectUnits(page, rams);
  await centreCamera(page, etc!.x, etc!.y);
  await clickEntity(page, etc!.id, { button: 'right' });
  await step(page, 1);
  for (const u of await units(page, rams)) expect([u.order, u.target]).toEqual(['attack', etc!.id]);

  // Cavalry: attack-move (A) to open ground beside the Town Center, among the villagers.
  await centreCamera(page, base.x, base.y);
  await selectUnits(page, riders);
  await page.keyboard.press('KeyA');
  await centreCamera(page, etc!.x, etc!.y);
  const near = await clearSpot(page, etc!.x, etc!.y, 4, 0);
  const p = await toScreen(page, near.x, near.y);
  expect(await page.evaluate(([x, y]) => window.__game!.pickAt(x!, y!), [p.x, p.y] as const)).toBeNull();
  await page.mouse.click(p.x, p.y);
  await step(page, 1);
  for (const u of await units(page, riders)) expect(u.order).toBe('attackMove');
  await stepUntil(page, `g.state.entities.some((e) => e.id === ${etc!.id} && e.hp < 2400)`, 2000);
  await shot(page, 'm2-09-siege');
  // Below 66% hp the Town Center burns (three large fires below 33%, for its footprint of 4).
  await stepUntil(page, `g.state.entities.some((e) => e.id === ${etc!.id} && e.kind === 'building' && e.hp < e.builtHp * 0.6)`, 6000, 25);
  expect((await effects(page)).fires).toBeGreaterThanOrEqual(1);
  await shot(page, 'm2-09-burning');

  await stepUntil(page, gone(etc!.id), 12000, 50);
  expect(await page.evaluate(() => window.__game!.state!.players[2]!.popCap)).toBeLessThan(enemyPop0);
  expect((await effects(page)).rubble).toBeGreaterThanOrEqual(1);
  // The villagers are hunted down by the attack-moving cavalry (or found by idle units in sight): the match ends.
  const leftovers = await page.evaluate(() => window.__game!.state!.entities.filter((e) => e.owner === 2).map((e) => e.id));
  if (leftovers.length > 0 && (await page.evaluate(() => window.__game!.match()!.winner)) === null) {
    await selectUnits(page, (await units(page, riders)).map((u) => u.id));
    await page.keyboard.press('KeyA');
    const last = (await units(page, leftovers))[0];
    if (last !== undefined) {
      await centreCamera(page, last.x, last.y);
      await clickEntity(page, last.id);
    }
  }
  await stepUntil(page, 'g.match().winner === 1', 6000, 50);
  await expect(page.getByTestId('end-screen')).toBeVisible();
  await expect(page.getByTestId('end-title')).toHaveText('Victory');
  expect(Number(await page.getByTestId('end-buildingsDestroyed-1').textContent())).toBeGreaterThanOrEqual(1);
  await shot(page, 'm2-14-victory');
  await page.getByTestId('end-view-map').click();
  await expect(page.getByTestId('end-screen')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('save mid-fight, load: the state hash continues identically', async ({ page }) => {
  const errors = collectErrors(page);
  const g = await fightGround(page);
  await spawn(page, [['spearman', g.x, g.y], ['archer', g.x, g.y + 1.2], ['horseman', g.x + 1, g.y]]);
  await spawn(page, [['spearman', g.x + 5, g.y], ['archer', g.x + 5, g.y + 1.2], ['swordsman', g.x + 6, g.y]], ENEMY);
  await stepUntil(page, 'g.state.projectiles.length > 0', 400, 1);
  await step(page, 20);
  const tickAtSave = await page.evaluate(() => window.__game!.state!.tick);

  await page.keyboard.press('Escape');
  await page.getByTestId('menu-save').click();
  await page.getByTestId('save-new').click();
  await expect(page.getByTestId('saveload-message')).toContainText('Saved');
  await page.getByTestId('saveload-back').click();
  await page.getByTestId('menu-resume').click();
  await step(page, 200);
  const a = await page.evaluate(() => ({ hash: window.__game!.hash(), tick: window.__game!.state!.tick }));

  await page.keyboard.press('Escape');
  await page.getByTestId('menu-load').click();
  await page.locator('[data-testid^="load-save-"]').first().click();
  await expect.poll(() => page.evaluate(() => (window.__game!.screen === 'game' ? window.__game!.state?.tick : null)), { timeout: 60_000 }).toBe(tickAtSave);
  await expect(page.getByTestId('hud')).toBeVisible();
  await page.evaluate(() => window.__game!.freezeClock());
  await step(page, 200);
  const b = await page.evaluate(() => ({ hash: window.__game!.hash(), tick: window.__game!.state!.tick }));
  expect(b).toEqual(a);
  expect(errors).toEqual([]);
});

test('scenario 17: rendered-art battle gallery: death poses, corpses, fires, rubble, projectiles, both colours, at 0.5x, 1x and 2x', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await startMatch(page, { ...OPPONENT, art: 'rendered' });
  const tc = await townCenter(page);
  const g = await clearSpot(page, tc.x, tc.y, 13, 3);
  await centreCamera(page, g.x, g.y);
  // A House of our own beside the Town Center (instant build), destroyed below: rubble.
  await page.evaluate(() => {
    const game = window.__game!;
    game.cheat.addResources({ wood: 1000 });
    game.cheat.instantBuild(true);
  });
  await step(page, 1);
  const vills = (await villagers(page)).map((v) => v.id);
  await centreCamera(page, tc.x, tc.y);
  const site = await clearSpot(page, tc.x, tc.y, 5, 2);
  await centreCamera(page, g.x, g.y);
  await page.evaluate(
    ([ids, x, y]) => window.__art!.issue({ type: 'build', unitIds: ids as number[], buildingType: 'house', tx: Math.floor((x as number) - 1), ty: Math.floor((y as number) - 1), queue: false }),
    [vills, site.x, site.y] as const,
  );
  await step(page, 1);
  const house = await page.evaluate(() => window.__game!.state!.entities.find((e) => e.kind === 'building' && e.owner === 1 && e.typeId === 'house')?.id ?? null);
  expect(house, 'the House was placed').not.toBeNull();
  await stepUntil(page, `g.state.entities.some((e) => e.id === ${house} && e.kind === 'building' && e.constructed)`, 1200, 5);
  // Blue (ours) against red, close enough to clash at once: archers shoot, spearmen and swordsmen trade blows.
  await spawn(page, [['archer', g.x - 1, g.y], ['archer', g.x - 1, g.y + 1.2], ['spearman', g.x + 1, g.y], ['spearman', g.x + 1, g.y + 1.2], ['batteringRam', g.x - 2, g.y + 2.5]]);
  await spawn(page, [['archer', g.x + 5, g.y], ['swordsman', g.x + 3, g.y + 0.6], ['spearman', g.x + 3, g.y - 0.6], ['archer', g.x + 5, g.y + 1.4]], ENEMY);
  // Our Town Center below a third of its hp: large fires and smoke; the House destroyed: rubble and dust.
  await page.evaluate(
    ([t, h]) => {
      const game = window.__game!;
      const e = game.state!.entities.find((x) => x.id === t)!;
      if (e.kind === 'building') game.cheat.setHp(t as number, Math.floor(e.builtHp * 0.3));
      game.cheat.setHp(h as number, 0);
    },
    [tc.id, house] as const,
  );
  await step(page, 1);
  // Into the fight until a body lies on the field while arrows are in the air.
  await stepUntil(page, 'g.effects().corpses >= 1 && g.state.projectiles.length > 0', 1500, 1);
  const owners = await page.evaluate(() => [...new Set(window.__game!.state!.entities.filter((e) => e.kind === 'unit' && e.typeId !== 'villager').map((e) => e.owner))].sort());
  expect(owners, 'both colours still fight').toEqual([1, 2]);
  for (const zoom of [0.5, 1, 2]) {
    await page.evaluate((z) => window.__game!.setZoom(z), zoom);
    await centreCamera(page, g.x + 1, g.y + 0.5);
    await step(page, 0);
    const fx = await effects(page);
    expect(fx.corpses, `corpses at ${zoom}x`).toBeGreaterThanOrEqual(1);
    expect(fx.projectiles, `projectiles at ${zoom}x`).toBeGreaterThan(0);
    expect(fx.rubble, `rubble at ${zoom}x`).toBe(1);
    expect(fx.fires, `fires at ${zoom}x`).toBe(3);
    await shot(page, `m2-17-gallery-${zoom}x`);
  }
  // The burning Town Center and the rubble of the House.
  await page.evaluate(() => window.__game!.setZoom(1));
  await centreCamera(page, tc.x, tc.y);
  await step(page, 0);
  await shot(page, 'm2-17-town');
  expect(errors).toEqual([]);
});
