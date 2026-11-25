import { expect, test } from '@playwright/test';
import {
  advanceClock,
  centreCamera,
  clickUnit,
  collectErrors,
  groupVillagers,
  pickableTree,
  placeViaCard,
  player,
  recallVillagers,
  resources,
  selection,
  startMatch,
  step,
  stepUntil,
  toScreen,
  townCenter,
  villagers,
} from './helpers';

/**
 * Every other scenario plays on one pinned map (seed 1) so nothing depends on luck. These run on purpose on several
 * different maps: the match must start sanely, villagers must gather from a tree and a House must be placeable,
 * whatever the generator produced. A failure names its seed, which reproduces it exactly (`/?seed=N`).
 */
const SEEDS = [2, 3, 7, 42, 1234, 99991];

for (const seed of SEEDS) {
  test(`seed ${seed}: match start, gathering and placement work on this map`, async ({ page }) => {
    const errors = collectErrors(page);
    await startMatch(page, { seed });

    // Match start: this map seed, one Town Center, six villagers, resources to play with, plenty of nodes.
    const start = await page.evaluate(() => {
      const s = window.__game!.state!;
      const mine = s.entities.filter((e) => e.owner === 1);
      return {
        seed: s.seed,
        tcs: mine.filter((e) => e.typeId === 'townCenter').length,
        villagers: mine.filter((e) => e.typeId === 'villager').length,
        trees: s.entities.filter((e) => e.kind === 'node' && e.typeId === 'tree').length,
        gold: s.entities.filter((e) => e.kind === 'node' && e.typeId === 'goldDeposit').length,
        food: s.entities.filter((e) => e.kind === 'node' && e.typeId === 'berryBush').length,
      };
    });
    expect(start).toMatchObject({ seed, tcs: 1, villagers: 6 });
    expect(start.trees).toBeGreaterThan(20);
    expect(start.gold).toBeGreaterThan(0);
    expect(start.food).toBeGreaterThan(0);
    expect(await player(page)).toMatchObject({ popUsed: 6, popCap: 10, age: 1 });

    // Gathering: all villagers chop a tree that a click verifiably picks and a round trip raises the wood stockpile.
    const tc = await townCenter(page);
    await groupVillagers(page);
    const tree = await pickableTree(page, tc.x, tc.y);
    await recallVillagers(page);
    expect((await selection(page)).length).toBe(6);
    const wood0 = (await resources(page)).wood;
    const tp = await toScreen(page, tree.x, tree.y);
    await page.mouse.click(tp.x, tp.y, { button: 'right' });
    await step(page, 2);
    // The click picked a tree and every villager was sent to gather wood (neighbouring trees when it is full).
    const targets = await page.evaluate(() => {
      const es = window.__game!.state!.entities;
      return es.filter((e) => e.kind === 'unit' && e.owner === 1).map((e) => (e.kind === 'unit' && e.currentOrder?.type === 'gather' ? (es.find((t) => t.id === (e.currentOrder as { targetId: number }).targetId)?.typeId ?? null) : null));
    });
    expect(targets).toEqual(Array(6).fill('tree'));
    await stepUntil(page, `g.state.players[1].resources.wood > ${wood0}`, 6000);

    // Placement: a House near the Town Center is accepted, completes, and raises the population cap.
    await page.keyboard.press('KeyH');
    await centreCamera(page, tc.x, tc.y);
    const vs = await villagers(page);
    await clickUnit(page, [...vs].sort((a, b) => b.x + b.y - (a.x + a.y))[0]!);
    expect((await selection(page)).length).toBe(1);
    await placeViaCard(page, { menu: 'Economy', label: 'House', size: 2, near: tc, minRing: 4 });
    expect((await player(page)).popCap).toBe(20);
    expect(errors).toEqual([]);
  });
}

test('double-click windows follow the client clock, not the machine speed', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page);
  const vs = await villagers(page);
  const front = [...vs].sort((a, b) => b.x + b.y - (a.x + a.y))[0]!;
  const p = await toScreen(page, front.x, front.y);

  // Two clicks on the same villager inside the window are a double click: everyone is selected, however slowly the
  // test machine delivers them (the clock is frozen between them).
  await page.mouse.click(p.x, p.y - 14);
  expect(await selection(page)).toEqual([front.id]);
  await page.mouse.click(p.x, p.y - 14);
  expect(await selection(page)).toHaveLength(vs.length);

  // Two clicks further apart than the window are two single clicks.
  await advanceClock(page, 1000);
  await page.mouse.click(p.x, p.y - 14);
  await advanceClock(page, 500); // longer than the 400 ms window
  await page.mouse.click(p.x, p.y - 14);
  expect(await selection(page)).toEqual([front.id]);
  expect(errors).toEqual([]);
});
