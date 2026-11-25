import type { SelectionVM, SingleSelectionVM } from '../viewModel';
import type { HudActions } from './actions';
import { Icon, resourceIconId } from './Icon';

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function Bar({ value, class: cls, label }: { value: number; class?: string; label?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div class={`bar ${cls ?? ''}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div class="bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Single({ vm, actions }: { vm: SingleSelectionVM; actions: Pick<HudActions, 'cancelQueueItem'> }) {
  const first = vm.queue[0];
  return (
    <div class="single" data-testid="selection-single">
      <div class="single-head">
        <div class="portrait" style={{ borderColor: hex(vm.ownerColor) }} data-testid="owner-color" data-color={hex(vm.ownerColor)}>
          <Icon id={vm.icon} size={64} />
        </div>
        <div class="single-info">
          <div class="single-name">
            <span class="swatch" style={{ background: hex(vm.ownerColor) }} />
            <span data-testid="sel-name">{vm.name}</span>
            {!vm.own && vm.entityKind !== 'node' && <span class="tag">Enemy</span>}
          </div>
          {vm.hp !== null && (
            <div class="stat" data-testid="sel-hp">
              <span class="stat-label">HP</span>
              <Bar value={vm.hp.max > 0 ? vm.hp.current / vm.hp.max : 0} class="hp" label="Hit points" />
              <span class="stat-value">
                {vm.hp.current}/{vm.hp.max}
              </span>
            </div>
          )}
          {vm.carrying !== null && (
            <div class="stat" data-testid="sel-carrying">
              <Icon id={resourceIconId(vm.carrying.resource)} size={18} />
              <span class="stat-value">
                Carrying {vm.carrying.amount} {vm.carrying.resource}
              </span>
            </div>
          )}
          {vm.remaining !== null && (
            <div class="stat" data-testid="sel-remaining">
              <span class="stat-value">{vm.remaining} remaining</span>
            </div>
          )}
          {vm.constructionProgress !== null && (
            <div class="stat" data-testid="sel-construction">
              <span class="stat-label">Building</span>
              <Bar value={vm.constructionProgress} class="build" label="Construction progress" />
              <span class="stat-value">{Math.floor(vm.constructionProgress * 100)}%</span>
            </div>
          )}
        </div>
      </div>
      {vm.queue.length > 0 && (
        <div class="queue" data-testid="queue">
          <div class="queue-title">
            {first !== undefined && (
              <span>
                {first.kind === 'tech' ? 'Researching' : 'Training'} {first.name}
                {first.popBlocked ? ' (population cap)' : ''}
              </span>
            )}
          </div>
          <div class="queue-items">
            {vm.queue.map((q) => (
              <button
                type="button"
                key={`${q.index}-${q.defId}`}
                class={`queue-item ${q.popBlocked ? 'blocked' : ''}`}
                data-testid={`queue-item-${q.index}`}
                title={`${q.name}: click to cancel`}
                onClick={() => actions.cancelQueueItem(vm.entityId, q.index)}
              >
                <Icon id={q.icon} size={36} />
                <Bar value={q.progress} class="queue-bar" label={`${q.name} progress`} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function SelectionPanel({ vm, actions }: { vm: SelectionVM; actions: Pick<HudActions, 'cancelQueueItem' | 'narrowSelection'> }) {
  return (
    <div class="selection panel" data-testid="selection-panel">
      {vm.kind === 'none' && <div class="empty-hint">Nothing selected</div>}
      {vm.kind === 'single' && <Single vm={vm} actions={actions} />}
      {vm.kind === 'multi' && (
        <div class="multi" data-testid="selection-multi">
          <div class="multi-title">{vm.entries.length} selected</div>
          <div class="multi-grid">
            {vm.entries.map((e) => (
              <button
                type="button"
                key={e.entityId}
                class="multi-item"
                data-testid={`multi-${e.entityId}`}
                title={`${e.name}: click to select only this`}
                onClick={() => actions.narrowSelection(e.entityId)}
              >
                <Icon id={e.icon} size={40} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
