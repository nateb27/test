import { expect, test, type Page } from '@playwright/test';
import {
  advanceClock,
  clickUnit,
  collectErrors,
  frames,
  openGround,
  overlayStats,
  selectAllVillagers,
  selection,
  SEPARATE_MS,
  shot,
  startMatch,
  step,
  toScreen,
  townCenter,
  villagers,
} from './helpers';

/**
 * WP28: health bars (e2e 6, own side), and the attack-move and repair target modes (halves of e2e 3 and 10).
 * Sim combat is not merged yet, so the issued commands are checked through the order markers they raise, not
 * through their effect. The modes are entered through `__game.wp28` (the command card buttons come with WP29).
 */

type Wp28 = { startMode(kind: 'attackMove' | 'repair'): void; cursor(): string; modeKind(): string | null };
const wp28 = <T>(page: Page, fn: (api: Wp28) => T): Promise<T> =>
  page.evaluate(
    ([code]) => (new Function('api', `return (${code})(api);`) as (a: Wp28) => unknown)((window.__game as unknown as { wp28: Wp28 }).wp28),
    [fn.toString()],
  ) as Promise<T>;

const mode = (page: Page): Promise<string | null> => wp28(page, (a) => a.modeKind());
const cursor = (page: Page): Promise<string> => wp28(page, (a) => a.cursor());
const enter = (page: Page, kind: 'attackMove' | 'repair'): Promise<void> =>
  page.evaluate((k) => (window.__game as unknown as { wp28: Wp28 }).wp28.startMode(k), kind);
const markersAdded = async (page: Page): Promise<number> => (await overlayStats(page)).markersAdded!;
const setHp = (page: Page, id: number, hp: number): Promise<void> => page.evaluate(([i, h]) => window.__game!.cheat.setHp(i!, h!), [id, hp] as const);
const hpOf = (page: Page, id: number): Promise<number> => page.evaluate((i) => (window.__game!.state!.entities.find((e) => e.id === i) as { hp: number }).hp, id);
const toastTexts = (page: Page): Promise<string[]> => page.getByTestId('toast').allInnerTexts();

test.describe('WP28 health bars', () => {
  test('a damaged own building and unit show bars; full health shows none until selected', async ({ page }) => {
    const errors = collectErrors(page);
    await startMatch(page);
    const tc = await townCenter(page);
    const [v] = await villagers(page);
    await frames(page, 2);
    expect((await overlayStats(page)).healthBars).toBe(0);

    const tcHp = await hpOf(page, tc.id);
    await setHp(page, tc.id, Math.floor(tcHp / 2));
    await step(page, 1);
    await frames(page, 2);
    expect((await overlayStats(page)).healthBars).toBe(1);

    await setHp(page, v!.id, 1);
    await step(page, 1);
    await frames(page, 2);
    expect((await overlayStats(page)).healthBars).toBe(2);

    // Healed again: gone.
    await setHp(page, v!.id, 1000);
    await setHp(page, tc.id, 100000);
    await step(page, 1);
    await frames(page, 2);
    expect((await overlayStats(page)).healthBars).toBe(0);

    // Selected full-hp entities show one too.
    await clickUnit(page, v!);
    await frames(page, 2);
    expect(await selection(page)).toEqual([v!.id]);
    expect((await overlayStats(page)).healthBars).toBe(1);
    expect(errors).toEqual([]);
  });

  for (const zoom of [0.5, 1, 2]) {
    test(`bars stay the same size on screen at ${zoom}x (screenshot for review)`, async ({ page }) => {
      await startMatch(page);
      const tc = await townCenter(page);
      const vs = await villagers(page);
      await page.evaluate((z) => window.__game!.setZoom(z), zoom);
      await frames(page, 2);
      await setHp(page, tc.id, 400);
      await setHp(page, vs[0]!.id, 10);
      await setHp(page, vs[1]!.id, 18);
      await step(page, 1);
      await frames(page, 2);
      const s = await overlayStats(page);
      expect(s.healthBars).toBeGreaterThanOrEqual(1);
      await shot(page, `wp28-healthbars-${zoom}x`);
    });
  }

  test('a damaged building that is also producing shows both bars', async ({ page }) => {
    await startMatch(page);
    const tc = await townCenter(page);
    await page.evaluate(() => window.__game!.cheat.addResources({ food: 500 }));
    await step(page, 1);
    const p = await toScreen(page, tc.x, tc.y);
    await advanceClock(page, SEPARATE_MS);
    await page.mouse.click(p.x, p.y);
    expect(await selection(page)).toEqual([tc.id]);
    await page.getByTestId('slot-0').click(); // train a villager
    await step(page, 5);
    await setHp(page, tc.id, 300);
    await step(page, 1);
    await frames(page, 2);
    const s = await overlayStats(page);
    expect(s.bars).toBe(1);
    expect(s.healthBars).toBe(1);
    await shot(page, 'wp28-production-and-health');
  });
});

test.describe('WP28 attack-move mode', () => {
  test('cursor is the crosshair, left click issues once and ends the mode; right click and Esc cancel', async ({ page }) => {
    const errors = collectErrors(page);
    await startMatch(page);
    await selectAllVillagers(page);
    expect(await cursor(page)).toBe('default');

    await enter(page, 'attackMove');
    expect(await mode(page)).toBe('attackMove');
    expect(await cursor(page)).toBe('attackMove');
    await shot(page, 'wp28-attackmove-mode');

    const tc = await townCenter(page);
    const g = await openGround(page, tc.x, tc.y + 6);
    const before = await markersAdded(page);
    await page.mouse.click(g.sx, g.sy);
    expect(await markersAdded(page)).toBe(before + 1);
    expect(await mode(page)).toBeNull();
    expect(await cursor(page)).toBe('default');

    await enter(page, 'attackMove');
    await page.mouse.click(g.sx, g.sy, { button: 'right' });
    expect(await mode(page)).toBeNull();
    expect(await markersAdded(page)).toBe(before + 1);

    await enter(page, 'attackMove');
    await page.keyboard.press('Escape');
    expect(await mode(page)).toBeNull();
    expect(await markersAdded(page)).toBe(before + 1);
    expect(errors).toEqual([]);
  });

  test('shift keeps the mode active for more clicks', async ({ page }) => {
    await startMatch(page);
    await selectAllVillagers(page);
    const tc = await townCenter(page);
    const g = await openGround(page, tc.x, tc.y + 6);
    await enter(page, 'attackMove');
    const before = await markersAdded(page);
    await page.keyboard.down('Shift');
    await page.mouse.click(g.sx, g.sy);
    await page.mouse.click(g.sx + 20, g.sy + 6);
    await page.keyboard.up('Shift');
    expect(await markersAdded(page)).toBe(before + 2);
    expect(await mode(page)).toBe('attackMove');
    await page.keyboard.press('Escape');
    expect(await mode(page)).toBeNull();
  });
});

test.describe('WP28 repair mode', () => {
  test('cursor is the hammer; a wrong click toasts and keeps the mode; a damaged own building is repaired', async ({ page }) => {
    const errors = collectErrors(page);
    await startMatch(page);
    const tc = await townCenter(page);
    await selectAllVillagers(page);
    const hp = await hpOf(page, tc.id);
    await setHp(page, tc.id, Math.floor(hp / 2));
    await step(page, 1);

    await enter(page, 'repair');
    expect(await mode(page)).toBe('repair');
    expect(await cursor(page)).toBe('repair');

    // Open ground: the hint, mode stays, nothing issued.
    const g = await openGround(page, tc.x, tc.y + 6);
    const before = await markersAdded(page);
    await page.mouse.click(g.sx, g.sy);
    await expect.poll(() => toastTexts(page)).toContain('Choose a damaged building of yours');
    expect(await mode(page)).toBe('repair');
    expect(await markersAdded(page)).toBe(before);

    // The damaged Town Center: pick verified before clicking.
    const p = await toScreen(page, tc.x, tc.y);
    expect(await page.evaluate(([x, y]) => window.__game!.pickAt(x!, y!), [p.x, p.y] as const)).toBe(tc.id);
    await page.mouse.click(p.x, p.y);
    expect(await markersAdded(page)).toBe(before + 1);
    expect(await mode(page)).toBeNull();
    expect(await cursor(page)).toBe('default');
    expect(errors).toEqual([]);
  });

  test('clicking an undamaged own building is refused', async ({ page }) => {
    await startMatch(page);
    const tc = await townCenter(page);
    await selectAllVillagers(page);
    await enter(page, 'repair');
    const p = await toScreen(page, tc.x, tc.y);
    const before = await markersAdded(page);
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => toastTexts(page)).toContain('Choose a damaged building of yours');
    expect(await markersAdded(page)).toBe(before);
    expect(await mode(page)).toBe('repair');
  });
});
