/**
 * Tooltip content for a command card button, generated from the button's data
 * (name, resolved cost, time, description, hotkey, unmet requirements).
 */

import type { DataRegistry } from '../../data/schema';
import type { ResourceType } from '../../sim/types';
import { describeUnavailable, formatSeconds, nonZeroCosts } from './text';
import type { CardButtonVM } from './viewModel';

export interface TooltipVM {
  title: string;
  hotkey: string;
  costs: { resource: ResourceType; amount: number; short: boolean }[];
  time: string | null;
  description: string;
  /** Unmet requirements, most important first. Empty when available. */
  requirements: string[];
}

export function buildTooltip(button: CardButtonVM, registry: DataRegistry): TooltipVM {
  const shortfall = button.shortfall;
  return {
    title: button.label,
    hotkey: button.hotkey,
    costs: nonZeroCosts(button.cost).map((c) => ({ ...c, short: (shortfall?.[c.resource] ?? 0) > 0 })),
    time: button.timeSeconds === null ? null : formatSeconds(button.timeSeconds),
    description: button.description,
    requirements: button.reasons.map((r) => describeUnavailable(r, registry)),
  };
}
