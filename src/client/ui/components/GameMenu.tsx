import { useState } from 'preact/hooks';
import type { Sim } from '../../../sim/types';
import type { SaveStorage } from '../../platform';
import { RESIGN_PROMPT_TEXT } from '../text';
import { SaveLoadPanel } from './SaveLoadPanel';

export interface GameMenuProps {
  storage: SaveStorage;
  sim: Sim;
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
  /** M2: the "Resign this match?" confirmation is showing. */
  resignConfirmOpen?: boolean;
  /** M2: Resign was clicked (asks for confirmation). */
  onResign?(): void;
  /** M2: Yes / No in the confirmation. */
  onResignYes?(): void;
  onResignNo?(): void;
  /** A saved game was loaded: the app replaces the match with it. */
  onLoaded(sim: Sim): void;
}

type View = 'main' | 'save' | 'load';

/** The in-match menu (Esc): Resume, Save, Load, Restart, Quit to Menu. */
export function GameMenu({
  storage,
  sim,
  onResume,
  onRestart,
  onQuit,
  onLoaded,
  resignConfirmOpen = false,
  onResign,
  onResignYes,
  onResignNo,
}: GameMenuProps) {
  const [view, setView] = useState<View>('main');
  return (
    <div class="modal-backdrop" data-testid="game-menu">
      <div class="modal panel">
        {view === 'main' && resignConfirmOpen && (
          <div class="menu-list" data-testid="resign-confirm" role="alertdialog" aria-label={RESIGN_PROMPT_TEXT}>
            <h2>{RESIGN_PROMPT_TEXT}</h2>
            <button type="button" class="primary" data-testid="resign-yes" onClick={onResignYes}>
              Yes
            </button>
            <button type="button" data-testid="resign-no" onClick={onResignNo}>
              No
            </button>
          </div>
        )}
        {view === 'main' && !resignConfirmOpen && (
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
            {onResign !== undefined && (
              <button type="button" data-testid="menu-resign" onClick={onResign}>
                Resign
              </button>
            )}
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
