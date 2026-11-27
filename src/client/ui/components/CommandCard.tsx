import { useState } from 'preact/hooks';
import { registry as defaultRegistry } from '../../../data';
import type { DataRegistry } from '../../../data/schema';
import { CARD_HOTKEYS, type CardButtonVM, type CommandCardVM } from '../viewModel';
import { nonZeroCosts } from '../text';
import { buildTooltip } from '../tooltip';
import type { HudActions } from './actions';
import { Icon, resourceIconId } from './Icon';

/** 1000 -> 1k so three costs fit on a button. */
function compact(n: number): string {
  return n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n);
}

function CostRow({ button }: { button: CardButtonVM }) {
  const costs = nonZeroCosts(button.cost);
  if (costs.length === 0) return null;
  return (
    <span class="cost-row" data-costs={costs.length}>
      {costs.map((c) => (
        <span key={c.resource} class={`cost cost-${c.resource} ${(button.shortfall?.[c.resource] ?? 0) > 0 ? 'short' : ''}`}>
          <Icon id={resourceIconId(c.resource)} size={9} />
          {compact(c.amount)}
        </span>
      ))}
    </span>
  );
}

export function Tooltip({ button, registry = defaultRegistry }: { button: CardButtonVM; registry?: DataRegistry }) {
  const t = buildTooltip(button, registry);
  return (
    <div class="tooltip" role="tooltip" data-testid="tooltip">
      <div class="tooltip-head">
        <span class="tooltip-title">{t.title}</span>
        <span class="tooltip-key">{t.hotkey}</span>
      </div>
      {(t.costs.length > 0 || t.time !== null) && (
        <div class="tooltip-meta">
          {t.costs.map((c) => (
            <span key={c.resource} class={`tooltip-cost ${c.short ? 'short' : ''}`} data-short={c.short ? 'true' : 'false'}>
              <Icon id={resourceIconId(c.resource)} size={16} /> {c.amount}
            </span>
          ))}
          {t.time !== null && <span class="tooltip-time">{t.time}</span>}
        </div>
      )}
      <div class="tooltip-desc">{t.description}</div>
      {t.requirements.length > 0 && (
        <ul class="tooltip-reqs">
          {t.requirements.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CommandCard({
  vm,
  actions,
  registry,
}: {
  vm: CommandCardVM | null;
  actions: Pick<HudActions, 'clickSlot'>;
  registry?: DataRegistry;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const bySlot = new Map<number, CardButtonVM>();
  for (const b of vm?.buttons ?? []) bySlot.set(b.slot, b);
  const hovered = hover === null ? undefined : bySlot.get(hover);
  return (
    <div class="card panel" data-testid="command-card">
      <div class="card-title">{vm?.title ?? 'Commands'}</div>
      <div class="card-grid">
        {CARD_HOTKEYS.map((hotkey, slot) => {
          const b = bySlot.get(slot);
          if (b === undefined) {
            return (
              <div class="card-slot empty" key={slot} data-testid={`slot-${slot}`}>
                <span class="hotkey">{hotkey}</span>
              </div>
            );
          }
          const short = b.shortfall !== null && Object.values(b.shortfall).some((v) => v > 0);
          return (
            <button
              type="button"
              key={slot}
              class={`card-slot ${b.enabled ? '' : 'disabled'} ${short ? 'unaffordable' : ''} ${b.active === true ? 'active' : ''}`}
              data-testid={`slot-${slot}`}
              data-action={b.action.type}
              aria-disabled={!b.enabled}
              {...(b.active !== undefined ? { 'aria-pressed': b.active } : {})}
              aria-label={`${b.label} (${hotkey})`}
              onClick={() => actions.clickSlot(slot)}
              onMouseEnter={() => setHover(slot)}
              onMouseLeave={() => setHover((h) => (h === slot ? null : h))}
              onFocus={() => setHover(slot)}
              onBlur={() => setHover((h) => (h === slot ? null : h))}
            >
              <Icon id={b.icon} size={nonZeroCosts(b.cost).length > 0 ? 24 : 36} />
              <span class="hotkey">{hotkey}</span>
              <CostRow button={b} />
            </button>
          );
        })}
      </div>
      {hovered !== undefined && <Tooltip button={hovered} registry={registry} />}
    </div>
  );
}
