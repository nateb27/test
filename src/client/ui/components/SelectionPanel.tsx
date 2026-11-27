import { STANCE_TEXT } from '../text';
import type { CombatStatsVM, SelectionVM, SingleSelectionVM } from '../viewModel';
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

/** Attack (with its type), range, armour and bonuses of a fighting unit or building (plan 7.3). */
function CombatLine({ combat }: { combat: CombatStatsVM }) {
  return (
    <div class="combat" data-testid="sel-combat">
      <div class="stat combat-row">
        <span class="combat-item" data-testid="sel-attack" title={`Attack: ${combat.attack} (${combat.attackType})`}>
          <Icon id="icon.stat.attack" size={14} />
          <span class="stat-value">{combat.attack}</span>
          <span class="combat-type">{combat.attackType}</span>
        </span>
        {combat.range > 0 && (
          <span class="combat-item" data-testid="sel-range" title={`Range: ${combat.range} tiles`}>
            <Icon id="icon.stat.range" size={14} />
            <span class="stat-value">{combat.range}</span>
          </span>
        )}
        <span class="combat-item" data-testid="sel-armor" title={`Armour: ${combat.meleeArmor} against melee, ${combat.pierceArmor} against arrows`}>
          <span class="stat-value">M {combat.meleeArmor}</span>
          <span class="combat-sep">/</span>
          <span class="stat-value">P {combat.pierceArmor}</span>
        </span>
      </div>
      {combat.bonuses.map((b) => (
        <div class="stat combat-bonus" key={b} data-testid="sel-bonus">
          <span class="stat-value">{b}</span>
        </div>
      ))}
      {combat.note !== null && (
        <div class="stat combat-note" data-testid="sel-combat-note">
          <span class="stat-value">{combat.note}</span>
        </div>
      )}
    </div>
  );
}

function Single({ vm, actions }: { vm: SingleSelectionVM; actions: Pick<HudActions, 'cancelQueueItem'> }) {
  const first = vm.queue[0];
  return (
    <div class="single" data-testid="selection-single">
      <div class="single-head">
        <div class="portrait" style={{ borderColor: hex(vm.ownerColor) }} data-testid="owner-color" data-color={hex(vm.ownerColor)}>
          <Icon id={vm.icon} size={56} />
        </div>
        <div class="single-info">
          <div class="single-name">
            <span class="swatch" style={{ background: hex(vm.ownerColor) }} />
            <span data-testid="sel-name">{vm.name}</span>
            {!vm.own && vm.entityKind !== 'node' && (
              <span class="tag owner-tag" data-testid="sel-owner" title="Enemy" style={{ color: hex(vm.ownerColor), borderColor: hex(vm.ownerColor) }}>
                {vm.ownerName === '' ? 'Enemy' : vm.ownerName}
              </span>
            )}
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
          {vm.combat !== null && <CombatLine combat={vm.combat} />}
          {vm.stance !== null && (
            <div class="stat" data-testid="sel-stance" title="Change the stance with Z and X">
              <span class="stat-label">Stance</span>
              <span class="stat-value">{STANCE_TEXT[vm.stance]}</span>
            </div>
          )}
          {vm.repairing && (
            <div class="stat" data-testid="sel-repairing">
              <span class="stat-value">Repairing</span>
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
          {vm.facts.length > 0 && (
            <div class="facts" data-testid="sel-facts">
              {vm.facts.map((f) => (
                <div class="stat fact" key={f.id} data-testid={`sel-fact-${f.id}`} title={f.title}>
                  {f.resources.map((r) => (
                    <Icon key={r} id={resourceIconId(r)} size={14} />
                  ))}
                  <span class="stat-value">{f.text}</span>
                </div>
              ))}
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
                class={`queue-item ${q.popBlocked ? 'blocked' : ''} ${q.cancelPending ? 'pending' : ''}`}
                data-testid={`queue-item-${q.index}`}
                title={q.cancelPending ? `${q.name}: cancelling` : `${q.name}: click to cancel`}
                data-pending={q.cancelPending ? 'true' : 'false'}
                onClick={() => actions.cancelQueueItem(vm.entityId, q.index)}
              >
                <Icon id={q.icon} size={32} />
                <Bar value={q.progress} class="queue-bar" label={`${q.name} progress`} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Above this many selected entities the portraits shrink from 40 to 28 px (three rows fit where two did). */
export const MULTI_DENSE_FROM = 16;

export function SelectionPanel({ vm, actions }: { vm: SelectionVM; actions: Pick<HudActions, 'cancelQueueItem' | 'narrowSelection'> }) {
  return (
    <div class="selection panel" data-testid="selection-panel">
      {vm.kind === 'none' && <div class="empty-hint">Nothing selected</div>}
      {vm.kind === 'single' && <Single vm={vm} actions={actions} />}
      {vm.kind === 'multi' && (
        <div class="multi" data-testid="selection-multi">
          <div class="multi-title">{vm.entries.length} selected</div>
          {/* Large selections use smaller portraits; the grid scrolls by whole rows, so no portrait is ever cut in half. */}
          <div class={vm.entries.length > MULTI_DENSE_FROM ? 'multi-grid dense' : 'multi-grid'} data-testid="multi-grid">
            {vm.entries.map((e) => (
              <button
                type="button"
                key={e.entityId}
                class="multi-item"
                data-testid={`multi-${e.entityId}`}
                title={`${e.name}: click to select only this`}
                onClick={() => actions.narrowSelection(e.entityId)}
              >
                <Icon id={e.icon} size={vm.entries.length > MULTI_DENSE_FROM ? 28 : 40} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
