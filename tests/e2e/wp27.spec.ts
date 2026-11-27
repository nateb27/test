import { expect, test, type Page } from '@playwright/test';
import { centreCamera, collectErrors, frames, shot, startMatch, step, stepUntil, townCenter } from './helpers';

/**
 * WP27 renderer and effects (PLAN-M2 7.2 and 9.4): the attack animation synchronised with the sim's release, death
 * animations and corpses, projectiles, building fire and rubble, all on game time, in both art modes. Two-player
 * matches with the opponent's AI off; units are spawned with cheats and fight on their own (aggressive stance), time
 * moves only through `__game.step`.
 */

const OPPONENT = { opponent: 'standard', ai: 'off' } as const;

type Spawn = readonly [type: string, x: number, y: number, owner: number];

async function spawn(page: Page, list: readonly Spawn[]): Promise<number[]> {
  return page.evaluate((items) => {
    const g = window.__game!;
    const before = new Set(g.state!.entities.map((e) => e.id));
    for (const [t, x, y, o] of items) g.cheat.spawnUnit(t as never, x, y, o);
    g.step(1);
    return g.state!.entities.filter((e) => !before.has(e.id) && e.kind === 'unit').map((e) => e.id);
  }, list as Spawn[]);
}

const effects = (page: Page): Promise<{ projectiles: number; corpses: number; rubble: number; fires: number; effects: number }> =>
  page.evaluate(() => window.__game!.effects());

/** A fighting ground 12 to 30 tiles from the own Town Center (out of its arrow range), 4 tiles clear; camera on it. */
async function ground(page: Page): Promise<{ x: number; y: number }> {
  const tc = await townCenter(page);
  const p = await page.evaluate(
    ([cx, cy]) => {
      const s = window.__game!.state!;
      const sizes: Record<string, number> = { townCenter: 4, goldDeposit: 2, stoneDeposit: 2 };
      for (let r = 12; r <= 30; r++) {
        for (let a = 0; a < 32; a++) {
          const x = Math.floor(cx! + Math.cos((a * Math.PI) / 16) * r) + 0.5;
          const y = Math.floor(cy! + Math.sin((a * Math.PI) / 16) * r) + 0.5;
          if (x < 8 || y < 8 || x > s.map.width - 8 || y > s.map.height - 8) continue;
          const clear = s.entities.every((e) => {
            const size = e.kind === 'unit' ? 0 : (sizes[e.typeId] ?? 1);
            const ex = e.kind === 'unit' ? e.pos.x : e.tile.tx + size / 2;
            const ey = e.kind === 'unit' ? e.pos.y : e.tile.ty + size / 2;
            return Math.max(Math.abs(ex - x), Math.abs(ey - y)) > 4 + size / 2;
          });
          if (clear) return { x, y };
        }
      }
      throw new Error('no clear ground');
    },
    [tc.x, tc.y] as const,
  );
  await centreCamera(page, p.x + 1, p.y);
  return p;
}

test('fast art: every unit has an attack (blow on frame 1) and a death that plays once; every effect sprite resolves', async ({ page }) => {
  const errors = collectErrors(page);
  await startMatch(page, { art: 'fast' });
  const rows = await page.evaluate(() => window.__art!.audit());
  expect(rows).toHaveLength(37);
  for (const r of rows.filter((x) => x.id.startsWith('unit.'))) {
    expect(r.states, r.id).toEqual(expect.arrayContaining(['idle', 'walk', 'work', 'carry', 'attack', 'death']));
    expect(r.hitFrame, r.id).toBe(1);
    expect(r.deathOnce, r.id).toBe(true);
  }
  for (const r of rows.filter((x) => /^(projectile|fx|rubble)\./.test(x.id))) {
    expect(r.textures, r.id).toBeGreaterThan(0);
    expect(r.minW, r.id).toBeGreaterThan(3);
  }
  expect(rows.find((r) => r.id === 'rubble.3')!.textures).toBe(2);
  expect(rows.find((r) => r.id === 'fx.smoke')!.textures).toBe(6);
  expect(errors).toEqual([]);
});

test('rendered art: the attack animation reaches its blow frame on the release tick', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await startMatch(page, { ...OPPONENT, art: 'rendered' });
  const g = await ground(page);
  const [sword] = await spawn(page, [['swordsman', g.x, g.y, 1]]);
  await spawn(page, [['spearman', g.x + 1.2, g.y, 2]]);
  const label = async (): Promise<string> => {
    await frames(page, 2);
    return (await page.evaluate((id) => window.__art!.drawnTexture(id), sword!)) ?? '';
  };
  // Winding up: the attack frames before the blow (the sheet's swordsman lands it on frame 5).
  await stepUntil(page, `g.state.entities.some((e) => e.id === ${sword} && e.combat.windup > 0)`, 400, 1);
  const windup = await label();
  expect(windup).toMatch(/^sheet\.swordsman\|attack\|\d\|[0-4]$/);
  // The step that released: lastAttackTick is that tick, the state shown is the next one.
  await stepUntil(page, `g.state.entities.some((e) => e.id === ${sword} && e.combat.lastAttackTick === g.state.tick - 1)`, 400, 1);
  expect(await label()).toMatch(/^sheet\.swordsman\|attack\|\d\|5$/);
  // Then the recovery frames, then the stance it had (idle in place) until the next swing.
  await step(page, 4);
  expect(await label()).toMatch(/^sheet\.swordsman\|attack\|\d\|[6-7]$/);
  // Paused, the picture holds whatever the frame rate.
  const held = await label();
  await frames(page, 10);
  expect(await label()).toBe(held);
  expect(errors).toEqual([]);
});

test('death animation then corpse, on game time: frozen while paused, gone after 20 s; fires by hp; rubble for 60 s', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await startMatch(page, { ...OPPONENT, art: 'fast' });
  const g = await ground(page);
  const [victim] = await spawn(page, [['villager', g.x + 1, g.y, 2]]);
  await spawn(page, [['swordsman', g.x, g.y, 1], ['swordsman', g.x, g.y + 1, 1]]);
  await stepUntil(page, `!g.state.entities.some((e) => e.id === ${victim})`, 1200, 1);
  const deathTick = await page.evaluate(() => window.__game!.state!.tick);
  expect((await effects(page)).corpses).toBe(1);
  await shot(page, 'wp27-01-fast-death');
  // Paused: many frames later the corpse is still there, nothing moved on.
  await frames(page, 20);
  expect((await effects(page)).corpses).toBe(1);
  await step(page, 30);
  await shot(page, 'wp27-02-fast-corpse');
  // 20 s of game time after the death the corpse is gone (it fades over the last 3 s).
  await stepUntil(page, `g.state.tick >= ${deathTick + 20 * 20}`, 500, 10);
  expect((await effects(page)).corpses).toBe(0);

  // Our Town Center at half hp burns with one fire, below a third with three; destroyed it leaves rubble for 60 s.
  // (The villagers can still build one, so this is no defeat.)
  const house = (await townCenter(page)).id;
  await page.evaluate((id) => {
    const game = window.__game!;
    const e = game.state!.entities.find((x) => x.id === id)!;
    if (e.kind === 'building') game.cheat.setHp(id, Math.floor(e.builtHp * 0.5));
  }, house);
  await step(page, 1);
  expect((await effects(page)).fires).toBe(1);
  await page.evaluate((id) => window.__game!.cheat.setHp(id, 100), house);
  await step(page, 1);
  expect((await effects(page)).fires).toBe(3); // a footprint of 4 below a third: three large fires
  await page.evaluate((id) => window.__game!.cheat.setHp(id, 0), house);
  await step(page, 2);
  const fx = await effects(page);
  expect(fx.rubble).toBe(1);
  expect(fx.fires).toBe(0);
  const tc = await page.evaluate(() => window.__game!.state!.tick);
  await stepUntil(page, `g.state.tick >= ${tc + 59 * 20}`, 1300, 20);
  expect((await effects(page)).rubble).toBe(1);
  await stepUntil(page, `g.state.tick >= ${tc + 61 * 20}`, 100, 5);
  expect((await effects(page)).rubble).toBe(0);
  expect(errors).toEqual([]);
});

test('projectiles fly while archers shoot, freeze while paused, and leave hits; fast art screenshot of a fight', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await startMatch(page, { ...OPPONENT, art: 'fast' });
  const g = await ground(page);
  await spawn(page, [['archer', g.x, g.y, 1], ['archer', g.x, g.y + 1.2, 1], ['siphonarios', g.x + 2, g.y + 2, 1], ['spearman', g.x + 1, g.y - 1, 1]]);
  await spawn(page, [['swordsman', g.x + 4, g.y, 2], ['spearman', g.x + 4, g.y + 1.2, 2], ['archer', g.x + 5.5, g.y + 0.6, 2]]);
  await stepUntil(page, 'g.state.projectiles.length >= 2', 400, 1);
  const a = await effects(page);
  expect(a.projectiles).toBeGreaterThanOrEqual(2);
  await frames(page, 10);
  expect(await effects(page)).toEqual(a);
  await shot(page, 'wp27-03-fast-arrows');
  // Hits, splashes and impacts are seen by the renderer as projectiles land and blows fall: step with a frame each.
  const seen = await page.evaluate(() => {
    const game = window.__game!;
    for (let i = 0; i < 400; i++) {
      game.step(1);
      if (game.effects().effects > 0) return true;
    }
    return false;
  });
  expect(seen, 'a hit or impact effect appeared').toBe(true);
  await shot(page, 'wp27-04-fast-hits');
  await stepUntil(page, 'g.effects().corpses >= 1', 3000, 5);
  await shot(page, 'wp27-05-fast-fight');
  expect(errors).toEqual([]);
});
