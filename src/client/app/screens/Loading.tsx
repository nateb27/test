import { useEffect } from 'preact/hooks';
import { createGame } from '../../../sim/sim';
import type { GameConfig } from '../../../sim/types';
import type { Navigate } from './types';

/** Generates the match (and, from WP3 on, art) behind a progress bar. */
export function Loading({ config, navigate }: { config: GameConfig; navigate: Navigate }) {
  useEffect(() => {
    // Defer one frame so the loading screen paints first.
    const id = requestAnimationFrame(() => {
      const sim = createGame(config);
      navigate({ name: 'game', sim, civ: config.players[0]?.civ ?? 'byzantines' });
    });
    return () => cancelAnimationFrame(id);
  }, [config, navigate]);
  return (
    <div class="screen menu" data-testid="loading">
      <p>Loading…</p>
    </div>
  );
}
