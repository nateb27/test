import { useState } from 'preact/hooks';
import type { Sim } from '../../../sim/types';
import type { SaveStorage } from '../../platform';
import { SaveLoadPanel } from './SaveLoadPanel';

export interface GameMenuProps {
  storage: SaveStorage;
  sim: Sim;
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
  /** A saved game was loaded: the app replaces the match with it. */
  onLoaded(sim: Sim): void;
}

type View = 'main' | 'save' | 'load';

/** The in-match menu (Esc): Resume, Save, Load, Restart, Quit to Menu. */
export function GameMenu({ storage, sim, onResume, onRestart, onQuit, onLoaded }: GameMenuProps) {
  const [view, setView] = useState<View>('main');
  return (
    <div class="modal-backdrop" data-testid="game-menu">
      <div class="modal panel">
        {view === 'main' && (
          <div class="menu-list">
            <h2>Paused</h2>
            <button type="button" class="primary" data-testid="menu-resume" onClick={onResume}>
              Resume
            </button>
            <button type="button" data-testid="menu-save" onClick={() => setView('save')}>
              Save
            </button>
            <button type="button" data-testid="menu-load" onClick={() => setView('load')}>
              Load
            </button>
            <button type="button" data-testid="menu-restart" onClick={onRestart}>
              Restart
            </button>
            <button type="button" data-testid="menu-quit" onClick={onQuit}>
              Quit to Menu
            </button>
          </div>
        )}
        {view !== 'main' && (
          <SaveLoadPanel storage={storage} mode={view} sim={sim} onLoaded={onLoaded} onBack={() => setView('main')} />
        )}
      </div>
    </div>
  );
}
