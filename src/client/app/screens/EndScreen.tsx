import { registry } from '../../../data';
import { RESOURCE_TYPES, TICK_RATE } from '../../../sim/types';
import { formatClock } from '../../ui/text';
import type { EndScreenVM } from '../../ui/viewModel';

type Row = { key: string; label: string; cell(p: EndScreenVM['players'][number]): string };

const num = (n: number): string => String(Math.round(n));

const ROWS: readonly Row[] = [
  { key: 'unitsTrained', label: 'Units trained', cell: (p) => num(p.stats.unitsTrained) },
  { key: 'unitsLost', label: 'Units lost', cell: (p) => num(p.stats.unitsLost) },
  { key: 'unitsKilled', label: 'Units killed', cell: (p) => num(p.stats.unitsKilled) },
  { key: 'buildingsBuilt', label: 'Buildings built', cell: (p) => num(p.stats.buildingsBuilt) },
  { key: 'buildingsLost', label: 'Buildings lost', cell: (p) => num(p.stats.buildingsLost) },
  { key: 'buildingsDestroyed', label: 'Buildings destroyed', cell: (p) => num(p.stats.buildingsDestroyed) },
  ...RESOURCE_TYPES.map((r) => ({
    key: `gathered-${r}`,
    label: `${r[0]!.toUpperCase()}${r.slice(1)} gathered`,
    cell: (p: EndScreenVM['players'][number]) => num(p.stats.resourcesGathered[r]),
  })),
  { key: 'techsResearched', label: 'Technologies researched', cell: (p) => num(p.stats.techsResearched) },
  { key: 'peakPopulation', label: 'Peak population', cell: (p) => num(p.stats.peakPopulation) },
  ...registry.ages.slice(1).map((a) => ({
    key: `age-${a.age}`,
    label: `${a.name} reached`,
    cell: (p: EndScreenVM['players'][number]) => {
      const t = p.stats.ageReachedTick[a.age - 1];
      return t === null || t === undefined ? '-' : formatClock(t / TICK_RATE);
    },
  })),
];

const TITLE: Record<EndScreenVM['result'], string> = { victory: 'Victory', defeat: 'Defeat', draw: 'Draw' };

function subtitle(vm: EndScreenVM): string {
  if (vm.result === 'draw') return 'Every player was defeated at the same moment.';
  if (vm.result === 'victory') return vm.reason === 'opponentResigned' ? 'Your opponent resigned.' : 'All opposing forces have been defeated.';
  return vm.reason === 'resigned' ? 'You resigned the match.' : 'You have no way left to continue the fight.';
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/**
 * Victory, defeat or draw with the match statistics. "View map" closes it and play resumes; "Play again" restarts the
 * same setup; "Main menu" leaves the match. Rendered over the game screen while `Match.endScreen` is set.
 */
export function EndScreen({
  vm,
  onViewMap,
  onPlayAgain,
  onMainMenu,
}: {
  vm: EndScreenVM;
  onViewMap(): void;
  onPlayAgain(): void;
  onMainMenu(): void;
}) {
  return (
    <div class="modal-backdrop end-backdrop ui-root" data-testid="end-screen" role="dialog" aria-modal="true" aria-label={TITLE[vm.result]}>
      <div class="modal panel end-modal">
        <h2 class={`end-title end-${vm.result}`} data-testid="end-title">
          {TITLE[vm.result]}
        </h2>
        <p class="end-sub" data-testid="end-subtitle">
          {subtitle(vm)} <span class="muted">Match time {formatClock(vm.clockSeconds)}</span>
        </p>
        <div class="end-table-wrap">
          <table class="end-table" data-testid="end-stats">
            <thead>
              <tr>
                <th scope="col" />
                {vm.players.map((p) => (
                  <th scope="col" key={p.playerId} data-testid={`end-player-${p.playerId}`}>
                    <span class="end-swatch" style={{ background: hex(p.color) }} />
                    {p.name}
                    {p.you ? ' (you)' : ''}
                    <div class="muted end-outcome">{p.outcome === 'won' ? 'Won' : p.outcome === 'defeated' ? 'Defeated' : 'Still playing'}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.key}>
                  <th scope="row">{r.label}</th>
                  {vm.players.map((p) => (
                    <td key={p.playerId} data-testid={`end-${r.key}-${p.playerId}`}>
                      {r.cell(p)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div class="end-buttons">
          <button type="button" data-testid="end-view-map" onClick={onViewMap}>
            View map
          </button>
          <button type="button" class="primary" data-testid="end-play-again" onClick={onPlayAgain}>
            Play again
          </button>
          <button type="button" data-testid="end-main-menu" onClick={onMainMenu}>
            Main menu
          </button>
        </div>
      </div>
    </div>
  );
}
