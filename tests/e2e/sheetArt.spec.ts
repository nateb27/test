import { expect, test, type Page } from '@playwright/test';
import { collectErrors, entities, frames, shot, startMatch, step, stepUntil, townCenter, villagers } from './helpers';

/**
 * The pre-rendered sprite sheets (units, trees, berry bushes; `?art=rendered`). Time moves only through
 * `__game.step`. Walk and carry frames advance with the distance walked, so after a given number of steps the frame
 * shown is deterministic.
 */

const UNITS = ['villager', 'spearman', 'swordsman', 'archer', 'siphonarios', 'horseman', 'lancer', 'cataphract', 'batteringRam', 'trebuchet'];

async function drawn(page: Page, id: number): Promise<string | null> {
  await frames(page, 2);
  return page.evaluate((i) => window.__art!.drawnTexture(i), id);
}

async function spawn(page: Page, items: [string, number, number][]): Promise<number[]> {
  return page.evaluate((list) => {
    const g = window.__game!;
    const before = new Set(g.state!.entities.map((e) => e.id));
    for (const [u, x, y] of list) window.__art!.issue({ type: 'cheat', cheat: { kind: 'spawnUnit', unitType: u, x, y } });
    g.step(1);
    return g.state!.entities.filter((e) => !before.has(e.id) && e.kind === 'unit').map((e) => e.id);
  }, items);
}

test('sheets: the match loads with sheet sprites for every unit, tree and bush, without console errors', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await startMatch(page, { art: 'rendered' });
  const rep = await page.evaluate(() => window.__art!.sheets());
  expect(rep).not.toBeNull();
  expect(rep!.failed).toEqual([]);
  expect(rep!.sheets).toEqual([...UNITS, 'berryBush', 'tree'].sort());
  const v = (await villagers(page))[0]!;
  expect(await drawn(page, v.id)).toMatch(/^sheet\.villager\|idle\|\d\|\d$/);
  const tc = await townCenter(page);
  const ids = await spawn(page, UNITS.map((u, i): [string, number, number] => [u, tc.x - 6 + (i % 5) * 1.5, tc.y + 5 + Math.floor(i / 5) * 2]));
  for (const [k, id] of ids.entries()) {
    const unit = (await page.evaluate((i) => window.__game!.state!.entities.find((e) => e.id === i)!.typeId, id))!;
    expect(await drawn(page, id), UNITS[k]).toMatch(new RegExp(`^sheet\\.${unit}\\|idle\\|`));
  }
  await shot(page, 'sheets-01-start');
  // Every unit has all its states in all facings (audit walks them).
  const rows = await page.evaluate(() => window.__art!.audit());
  for (const r of rows.filter((x) => x.id.startsWith('unit.'))) {
    expect(r.minOpaque, r.id).toBeGreaterThan(20);
    expect(r.textures, r.id).toBeGreaterThanOrEqual(8 * (2 + 8 + 8 + 7 + 1));
  }
  expect(rows.find((r) => r.id === 'unit.villager')!.textures).toBeGreaterThanOrEqual(8 * (2 + 8 + 8 * 9 + 8 + 7 + 1));
  expect(rows.find((r) => r.id === 'node.tree')!.textures).toBeGreaterThanOrEqual(4);
  expect(errors).toEqual([]);
});

test('sheets: a walking villager advances its frames with the distance walked; carrying shows each resource', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await startMatch(page, { art: 'rendered' });
  const vs = await villagers(page);
  const v = vs[0]!;
  await page.evaluate((id) => {
    const e = window.__game!.state!.entities.find((x) => x.id === id)!;
    if (e.kind !== 'unit') return;
    window.__art!.issue({ type: 'move', unitIds: [id], x: e.pos.x + 6, y: e.pos.y + 0.5, queue: false });
  }, v.id);
  await step(page, 3);
  const seen = new Set<string>();
  for (let i = 0; i < 8; i++) {
    const label = await drawn(page, v.id);
    expect(label).toMatch(/^sheet\.villager\|walk\|\d\|\d$/);
    seen.add(label!);
    await step(page, 2);
  }
  expect(seen.size).toBeGreaterThanOrEqual(4);

  // Gather each resource with one villager; when it walks back loaded it shows that load.
  const kinds: [string, string][] = [['tree', 'Wood'], ['berryBush', 'Food'], ['goldDeposit', 'Gold'], ['stoneDeposit', 'Stone']];
  const tc = await townCenter(page);
  for (const [k, [type]] of kinds.entries()) {
    const nodes = (await entities(page, { type, kind: 'node' })).sort((a, b) => Math.hypot(a.x - tc.x, a.y - tc.y) - Math.hypot(b.x - tc.x, b.y - tc.y));
    await page.evaluate(([id, node]) => window.__art!.issue({ type: 'gather', unitIds: [id as number], nodeId: node as number, queue: false }), [vs[k + 1]!.id, nodes[0]!.id]);
  }
  for (const [k, [, res]] of kinds.entries()) {
    const id = vs[k + 1]!.id;
    await stepUntil(
      page,
      `(() => { const e = g.state.entities.find((x) => x.id === ${id}); return e.carried !== null && e.currentOrder !== null && e.currentOrder.phase === 'toDropOff' && e.path !== null && e.path.nextIndex < e.path.waypoints.length - 1; })()`,
      8000,
      10,
    );
    await step(page, 2);
    expect(await drawn(page, id), res).toMatch(new RegExp(`^sheet\\.villager\\|carry${res}\\|`));
  }
  await shot(page, 'sheets-02-carry');
  expect(errors).toEqual([]);
});

test('sheets: attack, death and corpse previews resolve for every unit; red and blue differ only on ramp pixels', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await startMatch(page, { art: 'rendered' });
  const tc = await townCenter(page);
  const ids = await spawn(page, UNITS.map((u, i): [string, number, number] => [u, tc.x - 7 + (i % 5) * 1.6, tc.y + 5 + Math.floor(i / 5) * 2.2]));
  expect(ids.length).toBe(UNITS.length);
  for (const st of ['attack', 'death', 'corpse']) {
    await page.evaluate(([list, s]) => (list as number[]).forEach((id) => window.__art!.preview(id, s as string)), [ids, st] as const);
    await frames(page, 2);
    for (const [k, id] of ids.entries()) expect(await drawn(page, id), `${UNITS[k]} ${st}`).toMatch(new RegExp(`^sheet\\.${UNITS[k]}\\|${st}\\|`));
  }
  await page.evaluate((list) => list.forEach((id) => window.__art!.preview(id, null)), ids);
  expect(await drawn(page, ids[0]!)).toMatch(/\|idle\|/);
  for (const u of UNITS) {
    const states = await page.evaluate((n) => window.__art!.sheetStates(n), u);
    expect(states!.death!.loop).toBe(false);
    for (const st of ['idle', 'walk', 'attack']) {
      const d = await page.evaluate(([n, s]) => window.__art!.recolourDiff(n, s, 1, 0, 0x2f5fbf, 0xc0392b), [u, st] as const);
      expect(d, `${u} ${st}`).not.toBeNull();
      expect(d!.team, `${u} ${st}`).toBeGreaterThan(4);
      expect(d!.differing).toBe(d!.team);
      expect(d!.differingOutsideTeam).toBe(0);
    }
  }
  // One unit drawn in red next to a blue one.
  await page.evaluate((list) => window.__art!.colour(list[1]!, 0xc0392b), ids);
  await frames(page, 2);
  await shot(page, 'sheets-03-previews');
  expect(errors).toEqual([]);
});
