import { describe, it, expect } from 'vitest';
import { stableStringify, memoryContentHash, type CanonicalMemoryInput } from '../content-hash';

/**
 * Memory 3.0 B1: the server/browser canonicalization split.
 *
 * stableStringify is the shared primitive that the browser twin (packages/ui
 * decrypt-pmp.ts) and the dashboard parity fixture mirror. The browser version
 * filters undefined-valued keys; the server version THREW on them — the same
 * object could hash in the browser and crash on the server. After the fix both
 * sides share JSON.stringify semantics: undefined-valued keys are skipped.
 *
 * Back-compat: filtering only changes behavior for inputs that previously
 * threw — no previously-computable serialization changes.
 */

describe('stableStringify undefined handling (browser parity)', () => {
  it('no longer throws on an undefined-valued key', () => {
    expect(() => stableStringify({ keep: 1, drop: undefined })).not.toThrow();
  });

  it('skips undefined-valued keys exactly like JSON.stringify (and the browser twin)', () => {
    expect(stableStringify({ keep: 1, drop: undefined })).toBe(stableStringify({ keep: 1 }));
    expect(stableStringify({ keep: 1, drop: undefined })).toBe('{"keep":1}');
  });

  it('still distinguishes null from absent (null is a real value)', () => {
    expect(stableStringify({ a: null })).toBe('{"a":null}');
    expect(stableStringify({ a: null })).not.toBe(stableStringify({}));
  });

  it('handles nested objects and arrays with sorted keys, unchanged for defined values', () => {
    expect(stableStringify({ b: [1, { z: 2, a: 3 }], a: 'x' })).toBe('{"a":"x","b":[1,{"a":3,"z":2}]}');
  });

  it('memoryContentHash stays byte-stable for fully-defined memories', () => {
    const base: CanonicalMemoryInput = {
      content: 'the fact',
      memory_type: 'semantic',
      created_at: '2026-07-01T00:00:00.000Z',
      tags: ['a'],
      source: 'chat',
      owner_wallet: null,
      related_user: null,
      related_wallet: null,
    };
    expect(memoryContentHash(base)).toBe(memoryContentHash({ ...base }));
  });
});
