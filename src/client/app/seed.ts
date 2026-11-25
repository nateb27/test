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
