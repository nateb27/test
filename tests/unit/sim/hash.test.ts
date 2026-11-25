import { describe, expect, it } from 'vitest';
import { canonicalJson, fnv1a32 } from '../../../src/sim/hash';

describe('fnv1a32', () => {
  it('matches reference vectors', () => {
    expect(fnv1a32('')).toBe('811c9dc5');
    expect(fnv1a32('a')).toBe('e40c292c');
    expect(fnv1a32('foobar')).toBe('bf9cf968');
  });
});

describe('canonicalJson', () => {
  it('sorts keys recursively and omits undefined keys', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 0, y: 'x' }], c: true }, u: undefined })).toBe(
      '{"a":{"c":true,"d":[1,{"y":"x","z":0}]},"b":1}',
    );
  });

  it('is independent of key insertion order', () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });

  it('rejects values that may not appear in state', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson({ a: Infinity })).toThrow(/non-finite/);
    expect(() => canonicalJson({ a: -0 })).toThrow(/negative zero/);
    expect(() => canonicalJson({ a: new Map() })).toThrow(/non-plain/);
    expect(() => canonicalJson({ a: new Uint8Array(2) })).toThrow(/non-plain/);
    expect(() => canonicalJson([undefined])).toThrow(/undefined/);
    expect(() => canonicalJson({ f: () => 1 })).toThrow(/unsupported/);
  });
});
