import { useEffect, useRef } from 'preact/hooks';
import { createStubManifest } from '../../art/manifest';
import { createWorldRenderer } from '../../render/renderer';
import type { Sim } from '../../../sim/types';
import { Match } from '../match';
import type { AppHost } from '../host';

/** The match: full-window Pixi canvas; the HUD (WP9) will mount above it. */
export function GameScreen({ sim, host }: { sim: Sim; host: AppHost }) {
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = parentRef.current;
    if (parent === null) return;
    let match: Match | null = null;
    let disposed = false;
    const manifest = createStubManifest();
    void (async () => {
      await manifest.load();
      const renderer = await createWorldRenderer({
        parent,
        manifest,
        mapWidth: sim.state.map.width,
        mapHeight: sim.state.map.height,
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
