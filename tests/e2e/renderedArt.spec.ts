import { expect, test, type Page } from '@playwright/test';
import { SEPARATE_MS, advanceClock, collectErrors, entities, frames, selection, shot, startMatch, step, toScreen, townCenter, villagers } from './helpers';

/**
 * The voxel-rendered art (`?art=rendered`; the e2e build defaults to the fast procedural art). Time moves only
 * through `__game.step`; the art itself renders in workers at load (first age) and in the background (the rest),
 * which the tests wait for as a condition, never a delay.
 */

const BG_MS = 120_000;

async function waitForAllArt(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__art?.report()?.complete ?? false), { timeout: BG_MS }).toBe(true);
}

async function drawn(page: Page, id: number): Promise<string | null> {
  await frames(page, 2);
  return page.evaluate((i) => window.__art!.drawnTexture(i), id);
}

test('rendered art: the match loads without console errors and every sprite resolves to a non-empty texture', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await startMatch(page, { art: 'rendered' });
  expect(await page.evaluate(() => window.__art!.mode())).toBe('rendered');
  await shot(page, 'art-01-rendered-start');
  await waitForAllArt(page);
  const rows = await page.evaluate(() => window.__art!.audit());
  // 25 entity sprites and the 12 effect sprites of PLAN-M2 3.8 (WP27).
  expect(rows.length).toBe(37);
  const isEffect = (id: string): boolean => /^(projectile|fx|rubble)\./.test(id);
  for (const r of rows.filter((x) => !isEffect(x.id))) {
    expect(r.textures, r.id).toBeGreaterThan(0);
    expect(r.minW, r.id).toBeGreaterThan(4);
    expect(r.minH, r.id).toBeGreaterThan(4);
    expect(r.minOpaque, r.id).toBeGreaterThan(20);
  }
  // Effects: every id resolves to real textures (projectiles are small; rubble is voxel-rendered, two variants).
  for (const r of rows.filter((x) => isEffect(x.id))) {
    expect(r.textures, r.id).toBeGreaterThan(0);
    expect(r.minW, r.id).toBeGreaterThan(3);
    expect(r.minH, r.id).toBeGreaterThan(3);
  }
  for (const size of [2, 3, 4]) {
    const r = rows.find((x) => x.id === `rubble.${size}`)!;
    expect(r.textures, r.id).toBe(2);
    expect(r.minOpaque, r.id).toBeGreaterThan(200);
  }
  // Every unit has an attack (with its hit frame) and a death that plays once, in all 8 facings.
  for (const r of rows.filter((x) => x.id.startsWith('unit.'))) {
    expect(r.states, r.id).toEqual(expect.arrayContaining(['attack', 'death', 'corpse']));
    expect(r.hitFrame, r.id).toBeGreaterThan(0);
    expect(r.deathOnce, r.id).toBe(true);
  }
  // Units: 8 facings x 4 states; trees come in several variants.
  expect(rows.find((r) => r.id === 'unit.villager')!.textures).toBeGreaterThanOrEqual(56);
  expect(rows.find((r) => r.id === 'node.tree')!.textures).toBeGreaterThanOrEqual(4);
  expect(rows.find((r) => r.id === 'building.townCenter')!.textures).toBe(12);
  expect(errors).toEqual([]);
});

test('rendered art: buildings show the look of the current age; clicks pick buildings and units', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await startMatch(page, { art: 'rendered' });
  const tc = await townCenter(page);
  expect(await drawn(page, tc.id)).toBe('building.townCenter.a1|complete');

  // Picking: a click on the Town Center's walls selects it, a click on a villager selects the villager.
  await advanceClock(page, SEPARATE_MS);
  const p = await toScreen(page, tc.x, tc.y);
  await page.mouse.click(p.x, p.y - 30);
  expect(await selection(page)).toEqual([tc.id]);
  const v = [...(await villagers(page))].sort((a, b) => b.x + b.y - (a.x + a.y))[0]!;
  await advanceClock(page, SEPARATE_MS);
  const vp = await toScreen(page, v.x, v.y);
  await page.mouse.click(vp.x, vp.y - 10);
  expect(await selection(page)).toEqual([v.id]);

  // Place a House, a Lumber Camp and a Mill with instant construction: Founding Age looks.
  await page.evaluate(() => {
    const g = window.__game!;
    g.cheat.addResources({ food: 5000, wood: 5000, gold: 5000, stone: 5000 });
    g.cheat.instantBuild(true);
    g.cheat.instantResearch(true);
  });
  await step(page, 1);
  const vills = (await villagers(page)).map((e) => e.id);
  // The first free spot of a fixed list around the Town Center (pinned map, so always the same one).
  const spots: [number, number][] = [[-6, 3], [4, -6], [-6, -4], [5, 4], [0, 6], [6, 0], [-3, -7], [7, -3], [-8, 0]];
  const placeAt = async (type: string): Promise<number> => {
    for (const [dx, dy] of spots) {
      await page.evaluate(
        ([t, x, y, ids]) => window.__art!.issue({ type: 'build', unitIds: ids as number[], buildingType: t as string, tx: x as number, ty: y as number, queue: false }),
        [type, Math.round(tc.x + dx), Math.round(tc.y + dy), vills] as const,
      );
      await step(page, 1);
      const b = (await entities(page, { type, own: true }))[0];
      if (b === undefined) continue;
      for (let i = 0; i < 100 && !(await entities(page, { type, own: true }))[0]!.constructed; i++) await step(page, 5);
      return b.id;
    }
    throw new Error(`no spot for ${type}`);
  };
  const house = await placeAt('house');
  expect(await drawn(page, house)).toBe('building.house.early|complete');
  await placeAt('lumberCamp');
  await placeAt('mill');

  // Township: the Town Center changes to its age II look, the House keeps its early look (ages I-II).
  // The age II looks render in the background after load: wait for them (a condition), or the look falls back to age I.
  await waitForAllArt(page);
  await page.evaluate((id) => window.__art!.issue({ type: 'research', buildingId: id, techId: 'townshipAge' }), tc.id);
  await step(page, 3);
  expect(await page.evaluate(() => window.__game!.state!.players[1]!.age)).toBe(2);
  expect(await drawn(page, tc.id)).toBe('building.townCenter.a2|complete');
  expect(await drawn(page, house)).toBe('building.house.early|complete');
  await shot(page, 'art-02-township');
  expect(errors).toEqual([]);
});
