import { DEBUG_HOOKS_ENABLED } from '../debug/hook';

/**
 * The map seed of a new match: random, except that dev and e2e builds honour `?seed=N` (a non-negative integer below
 * 2^32) so tests can pin the map. Production builds ignore the parameter.
 */
export function matchSeed(search: string = window.location.search, enabled: boolean = DEBUG_HOOKS_ENABLED): number {
  if (enabled) {
    const raw = new URLSearchParams(search).get('seed');
    if (raw !== null && /^\d{1,10}$/.test(raw) && Number(raw) <= 0xffffffff) return Number(raw) >>> 0;
  }
  return (Math.random() * 0x7fffffff) >>> 0;
}

/** True when the URL pins the map seed (dev and e2e builds only). */
export function seedIsPinned(search: string = window.location.search, enabled: boolean = DEBUG_HOOKS_ENABLED): boolean {
  if (!enabled) return false;
  const raw = new URLSearchParams(search).get('seed');
  return raw !== null && /^\d{1,10}$/.test(raw) && Number(raw) <= 0xffffffff;
}

export type OpponentChoice = 'none' | 'easy' | 'standard' | 'hard';
export const OPPONENT_CHOICES: readonly OpponentChoice[] = ['none', 'easy', 'standard', 'hard'];

/** Setup screen defaults taken from the URL (dev and e2e builds only). */
export interface SetupDefaults {
  opponent: OpponentChoice;
  /** `PLAYER_COLORS` id for the human, or null for the default. */
  color: string | null;
}

/**
 * `?opponent=none|easy|standard|hard` sets the setup default (production: Standard; the e2e build: None, so the M1
 * suite runs as sandbox matches unless a test asks for an opponent); `?color=<id>` sets the human colour. Both are
 * ignored unless `enabled`.
 */
export function setupDefaults(
  search: string = window.location.search,
  enabled: boolean = DEBUG_HOOKS_ENABLED,
  e2e: boolean = import.meta.env.MODE === 'e2e',
): SetupDefaults {
  if (!enabled) return { opponent: 'standard', color: null };
  const params = new URLSearchParams(search);
  const raw = params.get('opponent');
  const opponent = OPPONENT_CHOICES.find((o) => o === raw) ?? (e2e ? 'none' : 'standard');
  const color = params.get('color');
  return { opponent, color: color !== null && color !== '' ? color : null };
}

/** `?ai=off` (dev and e2e builds only): the AI slot exists but its controller issues nothing. */
export function aiStartsEnabled(search: string = window.location.search, enabled: boolean = DEBUG_HOOKS_ENABLED): boolean {
  return !(enabled && new URLSearchParams(search).get('ai') === 'off');
}
