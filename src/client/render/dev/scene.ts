/**
 * Dev-only scene page: renders the fixture state through the real renderer.
 * Open `/src/client/render/dev/scene.html?zoom=1&fx=50&fy=50` under `npm run dev`.
 * Not part of the production build (it is not referenced from index.html).
 */

import { registry } from '../../../data';
import { createProceduralManifest } from '../../art/procedural';
import { createWorldRenderer, type WorldRendererApi } from '../renderer';
import { buildFixture } from './fixtureState';

declare global {
  interface Window {
    __scene?: {
      renderer: WorldRendererApi;
      fixture: ReturnType<typeof buildFixture>;
      frames: number;
    };
  }
}

async function main(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const num = (k: string, d: number): number => {
    const v = Number(q.get(k));
    return q.has(k) && Number.isFinite(v) ? v : d;
  };
  const root = document.getElementById('root')!;
  const manifest = createProceduralManifest({ registry });
  await manifest.load();
  const fixture = buildFixture();
  const renderer = await createWorldRenderer({
    parent: root,
    manifest,
    registry,
    mapWidth: fixture.state.map.width,
    mapHeight: fixture.state.map.height,
    focus: { x: num('fx', 50), y: num('fy', 52) },
    zoom: num('zoom', 1),
    ...(q.has('w') ? { size: { width: num('w', 1280), height: num('h', 720) } } : {}),
  });
  const hook = { renderer, fixture, frames: 0 };
  window.__scene = hook;
  const frame = (): void => {
    renderer.render(fixture.state, 1);
    hook.frames++;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void main();
