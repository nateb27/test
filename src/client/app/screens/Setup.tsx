import { useEffect, useState } from 'preact/hooks';
import { registry } from '../../../data/index';
import { PLAYER_COLORS } from '../../../sim/types';
import { civSummary } from '../../ui/civSummary';
import { Icon, IconContext } from '../../ui/components/Icon';
import { matchSeed, seedIsPinned, setupDefaults, type OpponentChoice } from '../seed';
import { configFromChoice, defaultColors, randomSeed } from '../setup';
import type { AppHost } from '../host';
import type { Navigate } from './types';

const OPPONENTS: readonly { id: OpponentChoice; label: string }[] = [
  { id: 'easy', label: 'Easy' },
  { id: 'standard', label: 'Standard' },
  { id: 'hard', label: 'Hard' },
  { id: 'none', label: 'No opponent (sandbox)' },
];

const SEED_RE = /^\d{1,10}$/;
const parseSeed = (text: string): number | null => (SEED_RE.test(text) && Number(text) <= 0xffffffff ? Number(text) : null);

/**
 * Match setup: civilization (the panel is generated from data), opponent difficulty or none, both player colours and
 * the map seed. "No opponent" starts a one-player sandbox match, exactly like Milestone 1.
 */
export function Setup({ navigate, host }: { navigate: Navigate; host: AppHost }) {
  const [initial] = useState(() => {
    const d = setupDefaults();
    return { opponent: d.opponent, colors: defaultColors(d.color), seed: matchSeed(), pinned: seedIsPinned() };
  });
  const [civId] = useState(registry.civs[0]?.id ?? 'byzantines');
  const [opponent, setOpponent] = useState<OpponentChoice>(initial.opponent);
  const [humanColor, setHumanColor] = useState(initial.colors.human);
  const [opponentColor, setOpponentColor] = useState(initial.colors.opponent);
  const [seedText, setSeedText] = useState(String(initial.seed));
  // A seed that came from the URL or was typed is "pinned": Play again keeps it. A random one is not.
  const [pinned, setPinned] = useState(initial.pinned);
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
  const civ = civSummary(civId, registry);
  const seed = parseSeed(seedText);
  const hasOpponent = opponent !== 'none';

  const start = (): void => {
    if (seed === null) return;
    host.seedPinned = pinned;
    navigate({
      name: 'loading',
      source: { kind: 'new', config: configFromChoice({ civ: civId, opponent, humanColor, opponentColor, seed }) },
    });
  };

  return (
    <IconContext.Provider value={host.iconUrl}>
      <div class="screen menu ui-root setup" data-testid="setup-screen">
        <h2>New game</h2>
        <div class="setup-main">
          <div class="civ-layout">
            <div class="civ-list" role="listbox" aria-label="Civilizations">
              {registry.civs.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  role="option"
                  aria-selected={c.id === civId}
                  class={`civ-pick ${c.id === civId ? 'active' : ''}`}
                  data-testid={`civ-${c.id}`}
                >
                  <Icon id={c.icon} size={40} />
                  <span>{c.name}</span>
                </button>
              ))}
            </div>
            <div class="civ-panel panel" data-testid="civ-panel">
              <div class="civ-head">
                <Icon id={civ.icon} size={56} />
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
                    <Icon id={u.icon} size={40} />
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

          <div class="setup-options panel">
            <fieldset class="setup-group">
              <legend>Opponent</legend>
              <div class="seg" role="radiogroup" aria-label="Opponent">
                {OPPONENTS.map((o) => (
                  <button
                    type="button"
                    key={o.id}
                    role="radio"
                    aria-checked={o.id === opponent}
                    class={o.id === opponent ? 'active' : ''}
                    data-testid={`setup-opponent-${o.id}`}
                    onClick={() => setOpponent(o.id)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset class="setup-group">
              <legend>Your colour</legend>
              <Swatches slot={1} value={humanColor} other={hasOpponent ? opponentColor : null} onPick={setHumanColor} />
            </fieldset>
            {hasOpponent && (
              <fieldset class="setup-group">
                <legend>Opponent colour</legend>
                <Swatches slot={2} value={opponentColor} other={humanColor} onPick={setOpponentColor} />
              </fieldset>
            )}

            <fieldset class="setup-group">
              <legend>Map seed</legend>
              <div class="seed-row">
                <input
                  type="text"
                  inputMode="numeric"
                  value={seedText}
                  maxLength={10}
                  aria-label="Map seed"
                  aria-invalid={seed === null}
                  data-testid="setup-seed"
                  onInput={(e) => {
                    setSeedText((e.target as HTMLInputElement).value.trim());
                    setPinned(true);
                  }}
                />
                <button
                  type="button"
                  data-testid="setup-seed-random"
                  onClick={() => {
                    setSeedText(String(randomSeed()));
                    setPinned(false);
                  }}
                >
                  Random
                </button>
              </div>
              {seed === null && <div class="setup-error">Enter a whole number from 0 to 4294967295.</div>}
            </fieldset>
          </div>
        </div>
        <div class="menu-row">
          <button type="button" data-testid="setup-back" onClick={() => navigate({ name: 'menu' })}>
            Back
          </button>
          <button type="button" class="primary" data-testid="start-match" disabled={seed === null} onClick={start}>
            Start Game
          </button>
        </div>
      </div>
    </IconContext.Provider>
  );
}

/** One row of colour swatches; the colour the other player has is disabled. */
function Swatches({ slot, value, other, onPick }: { slot: 1 | 2; value: string; other: string | null; onPick(id: string): void }) {
  return (
    <div class="swatches" role="radiogroup" aria-label={slot === 1 ? 'Your colour' : 'Opponent colour'}>
      {PLAYER_COLORS.map((c) => (
        <button
          type="button"
          key={c.id}
          role="radio"
          title={c.name}
          aria-label={c.name}
          aria-checked={c.id === value}
          disabled={c.id === other}
          class={`swatch ${c.id === value ? 'active' : ''}`}
          style={{ background: `#${c.value.toString(16).padStart(6, '0')}` }}
          data-testid={`setup-color-${slot}-${c.id}`}
          onClick={() => onPick(c.id)}
        />
      ))}
    </div>
  );
}
