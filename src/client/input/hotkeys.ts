/**
 * The hotkey map as one data table (plan 7.1), so rebinding can be added
 * later without touching the handlers. Keys are matched on `KeyboardEvent.code`
 * (physical position), which keeps the QWERT/ASDFG/ZXCVB command-card grid in
 * the same place on every keyboard layout.
 */

import { CARD_HOTKEYS } from '../ui/viewModel';

export type HotkeyAction =
  | { type: 'selectTownCenter' }
  | { type: 'cycleIdleVillager' }
  /** M2: select and centre the next idle military unit. */
  | { type: 'cycleIdleMilitary' }
  /** M2: centre the camera on the latest alert. */
  | { type: 'jumpToAlert' }
  | { type: 'deleteSelection' }
  /** Cancel placement / the current input mode; otherwise open the menu. */
  | { type: 'cancel' }
  | { type: 'togglePause' }
  | { type: 'toggleDebug' }
  /** Command card slot 0..14, row-major. */
  | { type: 'cardSlot'; slot: number }
  | { type: 'assignGroup'; group: number }
  | { type: 'recallGroup'; group: number };

export interface HotkeyBinding {
  /** `KeyboardEvent.code`, e.g. `KeyH`, `Digit1`, `Escape`. */
  code: string;
  /** Ctrl (or Cmd) must be held. Default: must not be held. */
  ctrl?: boolean;
  /** `true`: shift required; `false`: shift forbidden; absent: shift ignored. */
  shift?: boolean;
  action: HotkeyAction;
  /** Shown by a future key-binding help screen. */
  description: string;
}

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export const HOTKEYS: readonly HotkeyBinding[] = [
  ...CARD_HOTKEYS.map(
    (letter, slot): HotkeyBinding => ({
      code: `Key${letter}`,
      action: { type: 'cardSlot', slot },
      description: `Command card slot ${slot + 1}`,
    }),
  ),
  ...DIGITS.map((n): HotkeyBinding => ({ code: `Digit${n}`, ctrl: true, action: { type: 'assignGroup', group: n }, description: `Assign control group ${n}` })),
  ...DIGITS.map((n): HotkeyBinding => ({ code: `Digit${n}`, action: { type: 'recallGroup', group: n }, description: `Select control group ${n} (twice: centre camera)` })),
  { code: 'KeyH', action: { type: 'selectTownCenter' }, description: 'Select and centre the Town Center' },
  { code: 'Period', action: { type: 'cycleIdleVillager' }, description: 'Cycle idle villagers' },
  { code: 'Comma', action: { type: 'cycleIdleMilitary' }, description: 'Cycle idle military units' },
  { code: 'Space', action: { type: 'jumpToAlert' }, description: 'Centre the camera on the latest alert' },
  { code: 'Delete', action: { type: 'deleteSelection' }, description: 'Delete selected own entities' },
  { code: 'Escape', action: { type: 'cancel' }, description: 'Cancel placement, or open the menu' },
  { code: 'F3', action: { type: 'toggleDebug' }, description: 'Toggle the debug overlay' },
  { code: 'F10', action: { type: 'togglePause' }, description: 'Pause' },
  { code: 'Pause', action: { type: 'togglePause' }, description: 'Pause' },
];

export interface KeyInput {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** The action bound to a key press, or null. Alt combinations are never bound. */
export function resolveHotkey(table: readonly HotkeyBinding[], key: KeyInput): HotkeyAction | null {
  if (key.altKey) return null;
  const ctrl = key.ctrlKey || key.metaKey;
  for (const b of table) {
    if (b.code !== key.code) continue;
    if ((b.ctrl ?? false) !== ctrl) continue;
    if (b.shift !== undefined && b.shift !== key.shiftKey) continue;
    return b.action;
  }
  return null;
}
