/**
 * Canonical JSON and state hashing.
 *
 * Canonical JSON: object keys sorted by UTF-16 code unit order, no whitespace,
 * `undefined`-valued object keys omitted. Throws on NaN, Infinity, -0,
 * functions, class instances (Map, Set, typed arrays, ...) and `undefined`
 * array items, because none of these may appear in game state.
 */

import type { DeepReadonly, GameState } from './types';

/** Path of the value being written, kept as a stack and only turned into text when something is wrong. */
const pathStack: (string | number)[] = [];
/** Output being built; string concatenation (ropes) beats an array of pieces here. */
let buf = '';

function fail(what: string): never {
  let path = '';
  for (const part of pathStack) path += typeof part === 'number' ? `[${part}]` : path === '' ? part : `.${part}`;
  throw new Error(`canonicalJson: ${what} at ${path || '<root>'}`);
}

/** `JSON.stringify(key)` memoised: the same few hundred key names repeat across thousands of objects. */
const keyText = new Map<string, string>();

function quotedKey(key: string): string {
  let text = keyText.get(key);
  if (text === undefined) {
    text = JSON.stringify(key);
    if (keyText.size < 4096) keyText.set(key, text);
  }
  return text;
}

function write(value: unknown): void {
  if (value === null) {
    buf += 'null';
    return;
  }
  switch (typeof value) {
    case 'number':
      if (!Number.isFinite(value)) fail(`non-finite number ${String(value)}`);
      if (Object.is(value, -0)) fail('negative zero');
      buf += JSON.stringify(value);
      return;
    case 'string':
      buf += JSON.stringify(value);
      return;
    case 'boolean':
      buf += value ? 'true' : 'false';
      return;
    case 'object':
      break;
    default:
      fail(`unsupported type ${typeof value}`);
  }
  if (Array.isArray(value)) {
    buf += '[';
    for (let i = 0; i < value.length; i++) {
      if (i > 0) buf += ',';
      const item: unknown = value[i];
      pathStack.push(i);
      if (item === undefined) fail('undefined array item');
      write(item);
      pathStack.pop();
    }
    buf += ']';
    return;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail('non-plain object');
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  // Insertion order is usually already sorted; sort only when it is not.
  for (let i = 1; i < keys.length; i++) {
    if ((keys[i - 1] as string) > (keys[i] as string)) {
      keys.sort();
      break;
    }
  }
  buf += '{';
  let first = true;
  for (const key of keys) {
    const v = record[key];
    if (v === undefined) continue;
    if (!first) buf += ',';
    first = false;
    buf += quotedKey(key) + ':';
    pathStack.push(key);
    write(v);
    pathStack.pop();
  }
  buf += '}';
}

/** Serialize plain data to canonical JSON (see module doc). */
export function canonicalJson(value: unknown): string {
  pathStack.length = 0;
  buf = '';
  try {
    write(value);
    return buf;
  } finally {
    buf = '';
  }
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
