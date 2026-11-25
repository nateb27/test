/**
 * Canonical JSON and state hashing.
 *
 * Canonical JSON: object keys sorted by UTF-16 code unit order, no whitespace,
 * `undefined`-valued object keys omitted. Throws on NaN, Infinity, -0,
 * functions, class instances (Map, Set, typed arrays, ...) and `undefined`
 * array items, because none of these may appear in game state.
 */

import type { DeepReadonly, GameState } from './types';

function fail(path: string, what: string): never {
  throw new Error(`canonicalJson: ${what} at ${path || '<root>'}`);
}

function write(value: unknown, path: string, out: string[]): void {
  if (value === null) {
    out.push('null');
    return;
  }
  switch (typeof value) {
    case 'number':
      if (!Number.isFinite(value)) fail(path, `non-finite number ${String(value)}`);
      if (Object.is(value, -0)) fail(path, 'negative zero');
      out.push(JSON.stringify(value));
      return;
    case 'string':
      out.push(JSON.stringify(value));
      return;
    case 'boolean':
      out.push(value ? 'true' : 'false');
      return;
    case 'object':
      break;
    default:
      fail(path, `unsupported type ${typeof value}`);
  }
  if (Array.isArray(value)) {
    out.push('[');
    for (let i = 0; i < value.length; i++) {
      if (i > 0) out.push(',');
      const item: unknown = value[i];
      if (item === undefined) fail(`${path}[${i}]`, 'undefined array item');
      write(item, `${path}[${i}]`, out);
    }
    out.push(']');
    return;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail(path, 'non-plain object');
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  out.push('{');
  let first = true;
  for (const key of keys) {
    const v = record[key];
    if (v === undefined) continue;
    if (!first) out.push(',');
    first = false;
    out.push(JSON.stringify(key), ':');
    write(v, path ? `${path}.${key}` : key, out);
  }
  out.push('}');
}

/** Serialize plain data to canonical JSON (see module doc). */
export function canonicalJson(value: unknown): string {
  const out: string[] = [];
  write(value, '', out);
  return out.join('');
}

/** 32-bit FNV-1a over the UTF-8 bytes of `text`, as 8 lowercase hex digits. */
export function fnv1a32(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i] as number;
    // h *= 16777619 (mod 2^32) using shifts and adds only.
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Hash of the canonical JSON of the state. Equal hashes mean equal states. */
export function hashState(state: GameState | DeepReadonly<GameState>): string {
  return fnv1a32(canonicalJson(state));
}
