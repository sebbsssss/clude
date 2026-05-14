import { describe, expect, it } from 'vitest';
import {
  HASH_ALGORITHM,
  type CanonicalMemoryInput,
  canonicaliseMemory,
  memoryContentHash,
} from '../content-hash';

const baseMemory: CanonicalMemoryInput = {
  content: 'The pricing meeting concluded with a per-token model.',
  memory_type: 'episodic',
  owner_wallet: 'GsbwXfQGv9pBkj1234567890abcdef1234567890abcdef',
  created_at: '2026-05-13T12:00:00.000Z',
  tags: ['pricing', 'q3-roadmap'],
  source: 'chat',
  related_user: null,
  related_wallet: null,
};

describe('content-hash', () => {
  describe('HASH_ALGORITHM', () => {
    it('exports a stable algorithm version string', () => {
      expect(HASH_ALGORITHM).toBe('memory-hash-v1');
    });
  });

  describe('memoryContentHash', () => {
    it('returns a 64-character lowercase hex string', () => {
      const hash = memoryContentHash(baseMemory);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('is deterministic — same input produces same hash', () => {
      const a = memoryContentHash(baseMemory);
      const b = memoryContentHash({ ...baseMemory });
      expect(a).toBe(b);
    });

    it('is sensitive — changing content changes the hash', () => {
      const a = memoryContentHash(baseMemory);
      const b = memoryContentHash({ ...baseMemory, content: 'Different content.' });
      expect(a).not.toBe(b);
    });

    it('is sensitive — changing memory_type changes the hash', () => {
      const a = memoryContentHash(baseMemory);
      const b = memoryContentHash({ ...baseMemory, memory_type: 'semantic' });
      expect(a).not.toBe(b);
    });

    it('is sensitive — changing owner_wallet changes the hash', () => {
      const a = memoryContentHash(baseMemory);
      const b = memoryContentHash({
        ...baseMemory,
        owner_wallet: 'OtherWallet000000000000000000000000000000000',
      });
      expect(a).not.toBe(b);
    });

    it('treats null owner_wallet as distinct from a string wallet', () => {
      const a = memoryContentHash(baseMemory);
      const b = memoryContentHash({ ...baseMemory, owner_wallet: null });
      expect(a).not.toBe(b);
    });

    it('is insensitive to tag order (tags are sorted before hashing)', () => {
      const a = memoryContentHash({ ...baseMemory, tags: ['pricing', 'q3-roadmap'] });
      const b = memoryContentHash({ ...baseMemory, tags: ['q3-roadmap', 'pricing'] });
      expect(a).toBe(b);
    });

    it('is insensitive to duplicate tags (deduplicated then sorted)', () => {
      const a = memoryContentHash({ ...baseMemory, tags: ['pricing', 'q3-roadmap'] });
      const b = memoryContentHash({
        ...baseMemory,
        tags: ['q3-roadmap', 'pricing', 'pricing'],
      });
      expect(a).toBe(b);
    });

    it('trims surrounding whitespace on content', () => {
      const a = memoryContentHash(baseMemory);
      const b = memoryContentHash({
        ...baseMemory,
        content: '  ' + baseMemory.content + '  \n',
      });
      expect(a).toBe(b);
    });

    it('applies Unicode NFC normalisation', () => {
      // "café" written two ways: precomposed (NFC) vs decomposed (NFD).
      const nfc = 'café';      // é as a single code point U+00E9
      const nfd = 'café';     // e + combining acute accent
      const a = memoryContentHash({ ...baseMemory, content: nfc });
      const b = memoryContentHash({ ...baseMemory, content: nfd });
      expect(a).toBe(b);
    });

    it('treats different created_at as distinct memories', () => {
      const a = memoryContentHash(baseMemory);
      const b = memoryContentHash({
        ...baseMemory,
        created_at: '2026-05-13T12:00:00.001Z',
      });
      expect(a).not.toBe(b);
    });

    it('produces the same hash regardless of property order in the input object', () => {
      const ordered: CanonicalMemoryInput = baseMemory;
      const reordered = {
        related_wallet: baseMemory.related_wallet,
        related_user: baseMemory.related_user,
        source: baseMemory.source,
        tags: baseMemory.tags,
        created_at: baseMemory.created_at,
        owner_wallet: baseMemory.owner_wallet,
        memory_type: baseMemory.memory_type,
        content: baseMemory.content,
      } as CanonicalMemoryInput;
      expect(memoryContentHash(ordered)).toBe(memoryContentHash(reordered));
    });
  });

  describe('canonicaliseMemory', () => {
    it('emits a deterministic JSON string with sorted keys', () => {
      const canonical = canonicaliseMemory(baseMemory);
      // Keys appear in alphabetical order
      const keyOrder = Array.from(canonical.matchAll(/"([a-z_]+)":/g)).map((m) => m[1]);
      const sorted = [...keyOrder].sort();
      expect(keyOrder).toEqual(sorted);
    });

    it('emits tags sorted alphabetically', () => {
      const canonical = canonicaliseMemory({
        ...baseMemory,
        tags: ['zeta', 'alpha', 'mu'],
      });
      // Tags should appear in alphabetical order in the canonical string
      const tagsMatch = canonical.match(/"tags":\[(.*?)\]/);
      expect(tagsMatch).toBeTruthy();
      expect(tagsMatch![1]).toBe('"alpha","mu","zeta"');
    });

    it('preserves the algorithm version in the canonical form', () => {
      const canonical = canonicaliseMemory(baseMemory);
      expect(canonical).toContain('"algorithm":"memory-hash-v1"');
    });
  });
});
