import { useEffect, useState } from 'preact/hooks';
import { createGame } from '../../../sim/sim';
import { takeLoadedControllers } from '../../ui/saveLoad';
import { createControllers } from '../controllers';
import type { Sim } from '../../../sim/types';
import type { AppHost } from '../host';
import type { LoadSource, Navigate } from './types';
import { configFromSim } from './types';

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Generates the map (new games) and the art behind a progress bar, then starts the match. */
export function Loading({ source, host, navigate }: { source: LoadSource; host: AppHost; navigate: Navigate }) {
  const [progress, setProgress] = useState(0);
  const [label, setLabel] = useState('Preparing');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLabel(source.kind === 'new' ? 'Generating the map' : 'Restoring the game');
      await nextFrame(); // let the loading screen paint first
      if (cancelled) return;
      performance.mark('rts.mapgen.start');
      const sim: Sim = source.kind === 'new' ? createGame(source.config) : source.sim;
      performance.measure('rts.mapgen', 'rts.mapgen.start');
      // A loaded save brings its controller memory; a new game starts its AIs fresh.
      const controllers = createControllers(sim.state, source.kind === 'sim' ? takeLoadedControllers(sim) : []);
      setProgress(0.3);
      setLabel('Drawing the art');
      await nextFrame();
      if (cancelled) return;
      await host.loadManifest((f) => {
        if (!cancelled) setProgress(0.3 + 0.7 * f);
      });
      if (cancelled) return;
      setProgress(1);
      navigate({
        name: 'game',
        sim,
        civ: sim.state.players[1]?.civ ?? 'byzantines',
        config: source.kind === 'new' ? source.config : configFromSim(sim),
        controllers,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [source, host, navigate]);

  const pct = Math.round(progress * 100);
  return (
    <div class="screen menu ui-root" data-testid="loading">
      <h2>Loading</h2>
      <div class="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} data-testid="loading-bar">
        <div class="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <p class="muted" data-testid="loading-label">
        {label}… {pct}%
      </p>
    </div>
  );
}
