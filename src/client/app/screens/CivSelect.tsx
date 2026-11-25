import { useEffect, useState } from 'preact/hooks';
import { registry } from '../../../data/index';
import { MAP_SIZE } from '../../../sim/types';
import { civSummary } from '../../ui/civSummary';
import { Icon, IconContext } from '../../ui/components/Icon';
import { matchSeed } from '../seed';
import type { AppHost } from '../host';
import type { Navigate } from './types';

/** Civilization select: one entry per civ; the panel (bonuses, uniques) is generated from data. */
export function CivSelect({ navigate, host }: { navigate: Navigate; host: AppHost }) {
  const [selected, setSelected] = useState(registry.civs[0]?.id ?? 'byzantines');
  const [, setArtReady] = useState(host.manifest !== null);
  useEffect(() => {
    let live = true;
    host.loadManifest().then(
      () => live && setArtReady(true),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [host]);
  const civ = civSummary(selected, registry);

  const start = (): void =>
    navigate({
      name: 'loading',
      source: {
        kind: 'new',
        config: { seed: matchSeed(), mapSize: MAP_SIZE, players: [{ civ: selected }] },
      },
    });

  return (
    <IconContext.Provider value={host.iconUrl}>
      <div class="screen menu ui-root civ-select" data-testid="civ-select">
        <h2>Choose your civilization</h2>
        <div class="civ-layout">
          <div class="civ-list" role="listbox" aria-label="Civilizations">
            {registry.civs.map((c) => (
              <button
                type="button"
                key={c.id}
                role="option"
                aria-selected={c.id === selected}
                class={`civ-pick ${c.id === selected ? 'active' : ''}`}
                data-testid={`civ-${c.id}`}
                onClick={() => setSelected(c.id)}
              >
                <Icon id={c.icon} size={40} />
                <span>{c.name}</span>
              </button>
            ))}
          </div>
          <div class="civ-panel panel" data-testid="civ-panel">
            <div class="civ-head">
              <Icon id={civ.icon} size={64} />
              <div>
                <h3>{civ.name}</h3>
                <p>{civ.description}</p>
              </div>
            </div>
            <h4>Civilization bonuses</h4>
            <ul class="civ-bonuses" data-testid="civ-bonuses">
              {civ.bonuses.map((b) => (
                <li key={b.name}>
                  <strong>{b.name}.</strong> {b.description}
                </li>
              ))}
            </ul>
            <h4>Unique units and buildings</h4>
            <ul class="civ-uniques" data-testid="civ-uniques">
              {civ.uniques.map((u) => (
                <li key={u.id} data-testid={`unique-${u.id}`}>
                  <Icon id={u.icon} size={44} />
                  <div>
                    <div class="unique-name">
                      {u.name} <span class="muted">{u.kind}</span>
                    </div>
                    <div class="muted">
                      {u.stats}
                      {u.replaces !== null ? `. ${u.replaces}` : ''}
                    </div>
                    <div>{u.description}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div class="menu-row">
          <button type="button" data-testid="civ-back" onClick={() => navigate({ name: 'menu' })}>
            Back
          </button>
          <button type="button" class="primary" data-testid="start-match" onClick={start}>
            Start Game
          </button>
        </div>
      </div>
    </IconContext.Provider>
  );
}
