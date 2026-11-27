import { GAME_SPEEDS } from '../../app/loop';
import { RESOURCE_TYPES } from '../../../sim/types';
import { formatClock } from '../text';
import type { TopBarVM } from '../viewModel';
import type { HudActions } from './actions';
import { Icon, resourceIconId } from './Icon';

const RESOURCE_LABEL = { food: 'Food', wood: 'Wood', gold: 'Gold', stone: 'Stone' } as const;

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export function TopBar({
  vm,
  actions,
}: {
  vm: TopBarVM;
  actions: Pick<HudActions, 'cycleIdleVillager' | 'cycleIdleMilitary' | 'setSpeed' | 'togglePause'>;
}) {
  return (
    <div class="topbar panel" data-testid="top-bar">
      <div class="topbar-group resources">
        <span class="player-swatch" data-testid="player-swatch" data-color={hex(vm.playerColor)} style={{ background: hex(vm.playerColor) }} title="Your colour" />
        {RESOURCE_TYPES.map((r) => (
          <div class={`res res-${r}`} key={r} data-testid={`res-${r}`} title={RESOURCE_LABEL[r]}>
            <Icon id={resourceIconId(r)} size={24} />
            <span class="num">{vm.resources[r]}</span>
          </div>
        ))}
        <div
          class={`pop ${vm.popCapped ? 'capped' : ''}`}
          data-testid="pop"
          title={vm.popCapped ? 'Population cap reached: build more houses' : 'Population'}
        >
          <span class="pop-label">Pop</span>
          <span class="num">
            {vm.popUsed}/{vm.popCap}
          </span>
        </div>
      </div>
      <div class="topbar-group age" data-testid="age" title="Current age">
        <Icon id={vm.ageIcon} size={24} />
        <span class="age-name">{vm.ageName}</span>
      </div>
      <div class="topbar-group controls">
        <button
          type="button"
          class="idle-btn"
          data-testid="idle-villagers"
          disabled={vm.idleVillagers === 0}
          title="Select next idle villager (.)"
          onClick={() => actions.cycleIdleVillager()}
        >
          <Icon id="icon.unit.villager" size={22} />
          <span class="num">{vm.idleVillagers}</span>
        </button>
        <button
          type="button"
          class="idle-btn"
          data-testid="idle-military"
          disabled={vm.idleMilitary === 0}
          title="Select next idle soldier (,)"
          onClick={() => actions.cycleIdleMilitary()}
        >
          <Icon id="icon.unit.spearman" size={22} />
          <span class="num">{vm.idleMilitary}</span>
        </button>
        <span class="clock" data-testid="clock" title="Game time">
          {formatClock(vm.clockSeconds)}
        </span>
        <div class="speed" role="group" aria-label="Game speed">
          {GAME_SPEEDS.map((s) => (
            <button
              type="button"
              key={s}
              class={`speed-btn ${vm.speed === s ? 'active' : ''}`}
              data-testid={`speed-${s}`}
              aria-pressed={vm.speed === s}
              onClick={() => actions.setSpeed(s)}
            >
              {s}x
            </button>
          ))}
        </div>
        <button
          type="button"
          class={`pause-btn ${vm.paused ? 'active' : ''}`}
          data-testid="pause"
          aria-pressed={vm.paused}
          title="Pause (F10)"
          onClick={() => actions.togglePause()}
        >
          {vm.paused ? 'Paused' : 'Pause'}
        </button>
      </div>
    </div>
  );
}
