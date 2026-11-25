import { useCallback, useEffect, useState } from 'preact/hooks';
import { TICK_RATE, type Sim } from '../../../sim/types';
import type { SaveMeta, SaveStorage } from '../../platform';
import { exportSim, importSim, loadFromSlot, newSlotKey, saveToSlot, type LoadResult } from '../saveLoad';
import { formatClock } from '../text';

interface Message {
  kind: 'error' | 'info';
  text: string;
}

export interface SaveLoadPanelProps {
  storage: SaveStorage;
  mode: 'save' | 'load';
  /** The running game; required to save or export. */
  sim?: Sim;
  /** A save was loaded successfully. */
  onLoaded(sim: Sim): void;
  onBack(): void;
  /** Wall clock in ms (injected for tests). */
  now?: () => number;
}

/** Slot list with save, overwrite, load, delete, export and import. */
export function SaveLoadPanel({ storage, mode, sim, onLoaded, onBack, now = () => Date.now() }: SaveLoadPanelProps) {
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [message, setMessage] = useState<Message | null>(null);
  const defaultName = sim === undefined ? '' : `Game ${formatClock(sim.state.tick / TICK_RATE)}`;
  const [name, setName] = useState(defaultName);

  const reload = useCallback(() => {
    storage.list().then(setSaves, () => setMessage({ kind: 'error', text: 'Could not read the save list.' }));
  }, [storage]);
  useEffect(reload, [reload]);

  const finishLoad = (result: LoadResult): void => {
    if (result.ok) onLoaded(result.sim);
    else setMessage({ kind: 'error', text: result.message });
  };

  const save = async (slot: string, saveName: string): Promise<void> => {
    if (sim === undefined) return;
    try {
      await saveToSlot(storage, sim, slot, saveName);
      setMessage({ kind: 'info', text: `Saved "${saveName}".` });
      reload();
    } catch {
      setMessage({ kind: 'error', text: 'Saving failed (the browser storage may be full). Try exporting to a file.' });
    }
  };

  return (
    <div class="saveload" data-testid={`saveload-${mode}`}>
      <h2>{mode === 'save' ? 'Save Game' : 'Load Game'}</h2>
      {mode === 'save' && sim !== undefined && (
        <div class="row">
          <input
            type="text"
            value={name}
            maxLength={40}
            aria-label="Save name"
            data-testid="save-name"
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
          <button
            type="button"
            class="primary"
            data-testid="save-new"
            onClick={() => void save(newSlotKey(now()), name.trim() === '' ? defaultName : name.trim())}
          >
            Save
          </button>
        </div>
      )}
      <ul class="save-list" data-testid="save-list">
        {saves.length === 0 && <li class="muted">No saved games yet.</li>}
        {saves.map((s) => (
          <li key={s.slot} data-testid={`save-${s.slot}`}>
            <span class="save-name">{s.name}</span>
            <span class="muted">
              {formatClock(s.tick / TICK_RATE)} · {new Date(s.savedAt).toLocaleString()}
            </span>
            {mode === 'save' ? (
              <button type="button" data-testid={`overwrite-${s.slot}`} onClick={() => void save(s.slot, s.name)}>
                Overwrite
              </button>
            ) : (
              <button
                type="button"
                class="primary"
                data-testid={`load-${s.slot}`}
                onClick={() => void loadFromSlot(storage, s.slot).then(finishLoad)}
              >
                Load
              </button>
            )}
            <button
              type="button"
              class="danger"
              aria-label={`Delete ${s.name}`}
              data-testid={`delete-${s.slot}`}
              onClick={() => void storage.remove(s.slot).then(reload)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <div class="row">
        {mode === 'save' && sim !== undefined && (
          <button type="button" data-testid="export-file" onClick={() => void exportSim(storage, sim, name || defaultName)}>
            Export to file
          </button>
        )}
        {mode === 'load' && (
          <button
            type="button"
            data-testid="import-file"
            onClick={() =>
              void importSim(storage).then((r) => {
                if (r !== null) finishLoad(r);
              })
            }
          >
            Import from file
          </button>
        )}
        <button type="button" data-testid="saveload-back" onClick={onBack}>
          Back
        </button>
      </div>
      {message !== null && (
        <p class={`message message-${message.kind}`} role="alert" data-testid="saveload-message">
          {message.text}
        </p>
      )}
    </div>
  );
}
