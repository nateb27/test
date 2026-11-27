import { useState } from 'preact/hooks';
import { SaveLoadPanel } from '../../ui/components/SaveLoadPanel';
import type { AppHost } from '../host';
import type { Navigate } from './types';

/** Title screen: New Game (-> match setup) and Load Game. */
export function MainMenu({ navigate, host }: { navigate: Navigate; host: AppHost }) {
  const [loading, setLoading] = useState(false);
  return (
    <div class="screen menu ui-root" data-testid="main-menu">
      <h1>Untitled RTS</h1>
      <p class="tagline">Build. Gather. Advance through the ages.</p>
      <button type="button" class="primary" data-testid="new-game" onClick={() => navigate({ name: 'setup' })}>
        New Game
      </button>
      <button type="button" data-testid="load-game" onClick={() => setLoading(true)}>
        Load Game
      </button>
      {loading && (
        <div class="modal-backdrop">
          <div class="modal panel">
            <SaveLoadPanel
              storage={host.platform.storage}
              mode="load"
              onLoaded={(sim) => navigate({ name: 'loading', source: { kind: 'sim', sim } })}
              onBack={() => setLoading(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
