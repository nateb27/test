import { registry } from '../../../data/index';
import { MAP_SIZE } from '../../../sim/types';
import type { Navigate } from './types';

/** Placeholder civilization select. WP9 builds the panel of bonuses and uniques from data. */
export function CivSelect({ navigate }: { navigate: Navigate }) {
  return (
    <div class="screen menu" data-testid="civ-select">
      <h2>Choose your civilization</h2>
      {registry.civs.map((civ) => (
        <button
          type="button"
          key={civ.id}
          onClick={() =>
            navigate({
              name: 'loading',
              config: { seed: (Math.random() * 0x7fffffff) >>> 0, mapSize: MAP_SIZE, players: [{ civ: civ.id }] },
            })
          }
        >
          {civ.name}
        </button>
      ))}
      <button type="button" onClick={() => navigate({ name: 'menu' })}>
        Back
      </button>
    </div>
  );
}
