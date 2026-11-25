import type { Navigate } from './types';
import { MAP_SIZE } from '../../../sim/types';

/** Placeholder main menu. WP9 builds the real one (with Load Game). */
export function MainMenu({ navigate }: { navigate: Navigate }) {
  const newGame = (): void => {
    // WP9: route through civ select. WP0 starts a Byzantine match directly.
    navigate({
      name: 'loading',
      config: { seed: (Math.random() * 0x7fffffff) >>> 0, mapSize: MAP_SIZE, players: [{ civ: 'byzantines' }] },
    });
  };
  return (
    <div class="screen menu" data-testid="main-menu">
      <h1>Untitled RTS</h1>
      <button type="button" data-testid="new-game" onClick={newGame}>
        New Game
      </button>
    </div>
  );
}
