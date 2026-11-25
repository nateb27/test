import { useEffect, useRef } from 'preact/hooks';
import { createProceduralManifest } from '../../art/procedural';
import { registry } from '../../../data';
import { createWorldRenderer } from '../../render/renderer';
import type { Sim, Vec2 } from '../../../sim/types';
import { entityCentre, findTownCenter } from '../../input/selection';
import { LOCAL_PLAYER_ID, Match } from '../match';
import type { AppHost } from '../host';

/** The match: full-window Pixi canvas; the HUD (WP9) will mount above it. */
export function GameScreen({ sim, host }: { sim: Sim; host: AppHost }) {
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = parentRef.current;
    if (parent === null) return;
    let match: Match | null = null;
    let disposed = false;
    const manifest = createProceduralManifest({ registry });
    void (async () => {
      await manifest.load();
      const renderer = await createWorldRenderer({
        parent,
        manifest,
        mapWidth: sim.state.map.width,
        mapHeight: sim.state.map.height,
        registry,
        focus: startFocus(sim),
      });
      if (disposed) {
        renderer.destroy();
        return;
      }
      match = new Match(sim, renderer);
      host.setMatch(match);
      match.start();
    })();
    return () => {
      disposed = true;
      host.setMatch(null);
      match?.destroy();
      manifest.destroy();
    };
  }, [sim, host]);

  // Plan 8: the browser context menu is suppressed in-game.
  return (
    <div
      class="screen game"
      data-testid="game-screen"
      ref={parentRef}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

/** Camera start: the centre of the local player's first building (the Town Center). */
function startFocus(sim: Sim): Vec2 {
  const tc = findTownCenter(sim.state.entities, LOCAL_PLAYER_ID, registry);
  if (tc !== null) return entityCentre(tc, registry);
  const half = sim.state.map.width / 2;
  return { x: half, y: sim.state.map.height / 2 };
}
