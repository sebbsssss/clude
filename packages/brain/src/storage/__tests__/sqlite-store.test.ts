// packages/brain/src/storage/__tests__/sqlite-store.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteStore } from '../sqlite-store';
import type { Embedder } from '../types';

// ---------------------------------------------------------------------------
// Mock embedder: deterministic vectors based on text content
// ---------------------------------------------------------------------------

function createMockEmbedder(): Embedder {
  return {
    dimensions: 384,
    model: 'mock-model',
    embed: vi.fn(async (text: string) => {
      const seed = Array.from(text).reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const vec = new Float32Array(384);
      for (let i = 0; i < 384; i++) {
        vec[i] = Math.sin(seed * (i + 1) * 0.01);
      }
      const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
      for (let i = 0; i < 384; i++) vec[i] /= norm;
      return vec;
    }),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(): SqliteStore {
  return new SqliteStore({ dbPath: ':memory:', embedder: createMockEmbedder() });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SqliteStore', () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = makeStore();
  });

  afterEach(() => {
    store.close();
  });

  // -------------------------------------------------------------------------
  // store()
  // -------------------------------------------------------------------------
  describe('store()', () => {
    it('stores a memory and returns a clude-xxxxxxxx id', async () => {
      const id = await store.store({
        type: 'episodic',
        content: 'Went for a walk in the park today.',
        summary: 'walk in the park',
      });

      expect(id).toMatch(/^clude-[0-9a-f]{8}$/);
    });

    it('calls embedder.embed with the summary', async () => {
      const embedder = createMockEmbedder();
      const s = new SqliteStore({ dbPath: ':memory:', embedder });

      await s.store({
        type: 'semantic',
        content: 'The sky is blue because of Rayleigh scattering.',
        summary: 'Rayleigh scattering causes blue sky',
      });

      expect(embedder.embed).toHaveBeenCalledWith('Rayleigh scattering causes blue sky');
      s.close();
    });

    it('persists all optional fields', async () => {
      const id = await store.store({
        type: 'procedural',
        content: 'Step by step guide to deploying on Railway.',
        summary: 'Railway deploy steps',
        tags: ['devops', 'railway'],
        concepts: ['deployment', 'PaaS'],
        importance: 0.8,
        emotional_valence: 0.1,
        source: 'conversation',
        source_id: 'msg-42',
        related_user: 'user-1',
        related_wallet: '0xabc',
        owner: 'seb',
        metadata: { version: 2 },
      });

      const { memories } = store.list({ page: 1, page_size: 10 });
      const mem = memories.find((m) => m.id === id);

      expect(mem).toBeDefined();
      expect(mem!.tags).toEqual(['devops', 'railway']);
      expect(mem!.concepts).toEqual(['deployment', 'PaaS']);
      expect(mem!.importance).toBe(0.8);
      expect(mem!.owner).toBe('seb');
      expect(mem!.metadata).toEqual({ version: 2 });
    });

    it('returns unique ids for multiple stores', async () => {
      const ids = await Promise.all([
        store.store({ type: 'episodic', content: 'a', summary: 'a' }),
        store.store({ type: 'episodic', content: 'b', summary: 'b' }),
        store.store({ type: 'episodic', content: 'c', summary: 'c' }),
      ]);
      expect(new Set(ids).size).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // recall()
  // -------------------------------------------------------------------------
  describe('recall()', () => {
    it('returns empty result when store is empty', async () => {
      const result = await store.recall({ query: 'anything' });
      expect(result.count).toBe(0);
      expect(result.memories).toHaveLength(0);
    });

    it('recalls stored memories by semantic similarity', async () => {
      await store.store({
        type: 'semantic',
        content: 'Cats are carnivorous mammals that purr.',
        summary: 'cats purr carnivore',
        importance: 0.7,
      });
      await store.store({
        type: 'semantic',
        content: 'Dogs are loyal companions and bark.',
        summary: 'dogs bark loyal',
        importance: 0.6,
      });
      await store.store({
        type: 'episodic',
        content: 'The latest GPU release from NVIDIA.',
        summary: 'NVIDIA GPU release',
        importance: 0.5,
      });

      const result = await store.recall({ query: 'cats purr carnivore', limit: 2 });
      expect(result.count).toBeGreaterThan(0);
      expect(result.memories[0]).toHaveProperty('relevance_score');
      // The cat memory should be ranked first because it has identical summary text
      expect(result.memories[0].summary).toBe('cats purr carnivore');
    });

    it('increments access_count on recalled memories', async () => {
      await store.store({
        type: 'episodic',
        content: 'Had coffee this morning.',
        summary: 'morning coffee',
      });

      // Initial access_count should be 0
      const { memories: before } = store.list();
      expect(before[0].access_count).toBe(0);

      await store.recall({ query: 'morning coffee' });

      const { memories: after } = store.list();
      expect(after[0].access_count).toBe(1);
    });

    it('respects limit option', async () => {
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          store.store({ type: 'episodic', content: `Memory ${i}`, summary: `memory ${i}` })
        )
      );

      const result = await store.recall({ query: 'memory', limit: 3 });
      expect(result.memories.length).toBeLessThanOrEqual(3);
    });

    it('filters by memory_types', async () => {
      await store.store({ type: 'episodic', content: 'ep', summary: 'ep' });
      await store.store({ type: 'semantic', content: 'sem', summary: 'sem' });

      const result = await store.recall({ query: 'memory', memory_types: ['semantic'] });
      for (const m of result.memories) {
        expect(m.memory_type).toBe('semantic');
      }
    });

    it('filters by min_importance', async () => {
      await store.store({ type: 'episodic', content: 'low', summary: 'low imp', importance: 0.2 });
      await store.store({ type: 'episodic', content: 'high', summary: 'high imp', importance: 0.9 });

      const result = await store.recall({ query: 'imp', min_importance: 0.8 });
      for (const m of result.memories) {
        expect(m.importance).toBeGreaterThanOrEqual(0.8);
      }
    });

    it('filters by tags', async () => {
      await store.store({
        type: 'semantic',
        content: 'Tagged memory',
        summary: 'tagged mem',
        tags: ['ai', 'ml'],
      });
      await store.store({
        type: 'semantic',
        content: 'Untagged memory',
        summary: 'untagged mem',
        tags: ['cooking'],
      });

      const result = await store.recall({ query: 'memory', tags: ['ai'] });
      for (const m of result.memories) {
        expect(m.tags).toContain('ai');
      }
    });

    it('returns relevance_score on each memory', async () => {
      await store.store({ type: 'episodic', content: 'test', summary: 'test content' });
      const result = await store.recall({ query: 'test content' });
      for (const m of result.memories) {
        expect(typeof m.relevance_score).toBe('number');
        expect(m.relevance_score).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // delete()
  // -------------------------------------------------------------------------
  describe('delete()', () => {
    it('deletes a memory by id and returns true', async () => {
      const id = await store.store({
        type: 'episodic',
        content: 'to be deleted',
        summary: 'delete me',
      });

      const deleted = store.delete(id);
      expect(deleted).toBe(true);

      const { memories } = store.list();
      expect(memories.find((m) => m.id === id)).toBeUndefined();
    });

    it('returns false for non-existent id', () => {
      const result = store.delete('clude-doesnotexist');
      expect(result).toBe(false);
    });

    it('cannot recall a deleted memory', async () => {
      const id = await store.store({
        type: 'semantic',
        content: 'unique phrase xyzzy',
        summary: 'xyzzy unique phrase',
        importance: 1.0,
      });

      store.delete(id);

      const result = await store.recall({ query: 'xyzzy unique phrase', limit: 10 });
      expect(result.memories.find((m) => m.id === id)).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // update()
  // -------------------------------------------------------------------------
  describe('update()', () => {
    it('updates summary and reflects in list()', async () => {
      const id = await store.store({
        type: 'episodic',
        content: 'original content',
        summary: 'original summary',
      });

      const updated = store.update(id, { summary: 'updated summary' });
      expect(updated).toBe(true);

      const { memories } = store.list();
      const mem = memories.find((m) => m.id === id);
      expect(mem!.summary).toBe('updated summary');
    });

    it('updates importance', async () => {
      const id = await store.store({
        type: 'episodic',
        content: 'some memory',
        summary: 'some memory',
        importance: 0.3,
      });

      store.update(id, { importance: 0.95 });

      const { memories } = store.list();
      const mem = memories.find((m) => m.id === id);
      expect(mem!.importance).toBe(0.95);
    });

    it('updates tags (JSON field)', async () => {
      const id = await store.store({
        type: 'semantic',
        content: 'tagged thing',
        summary: 'tagged',
        tags: ['old'],
      });

      store.update(id, { tags: ['new', 'updated'] });

      const { memories } = store.list();
      const mem = memories.find((m) => m.id === id);
      expect(mem!.tags).toEqual(['new', 'updated']);
    });

    it('returns false for non-existent id', () => {
      const result = store.update('clude-nonexistent', { summary: 'nope' });
      expect(result).toBe(false);
    });

    it('reflects updated importance in subsequent recall', async () => {
      const lowId = await store.store({
        type: 'episodic',
        content: 'low importance memory',
        summary: 'low importance',
        importance: 0.1,
      });
      await store.store({
        type: 'episodic',
        content: 'high importance memory',
        summary: 'high importance',
        importance: 0.9,
      });

      // Boost the low-importance one to max
      store.update(lowId, { importance: 1.0 });

      const { memories } = store.list({ order: 'importance' });
      expect(memories[0].id).toBe(lowId);
    });
  });

  // -------------------------------------------------------------------------
  // stats()
  // -------------------------------------------------------------------------
  describe('stats()', () => {
    it('returns zero stats on empty store', () => {
      const s = store.stats();
      expect(s.total).toBe(0);
      expect(s.avg_importance).toBe(0);
      expect(s.oldest).toBeNull();
      expect(s.newest).toBeNull();
    });

    it('returns correct counts by type', async () => {
      await store.store({ type: 'episodic', content: 'e1', summary: 'e1' });
      await store.store({ type: 'episodic', content: 'e2', summary: 'e2' });
      await store.store({ type: 'semantic', content: 's1', summary: 's1' });
      await store.store({ type: 'procedural', content: 'p1', summary: 'p1' });

      const s = store.stats();
      expect(s.total).toBe(4);
      expect(s.by_type.episodic).toBe(2);
      expect(s.by_type.semantic).toBe(1);
      expect(s.by_type.procedural).toBe(1);
      expect(s.by_type.self_model).toBe(0);
      expect(s.by_type.introspective).toBe(0);
    });

    it('computes avg_importance correctly', async () => {
      await store.store({ type: 'episodic', content: 'a', summary: 'a', importance: 0.4 });
      await store.store({ type: 'episodic', content: 'b', summary: 'b', importance: 0.6 });

      const s = store.stats();
      expect(s.avg_importance).toBeCloseTo(0.5, 5);
    });

    it('returns oldest and newest created_at', async () => {
      await store.store({ type: 'episodic', content: 'first', summary: 'first' });
      await store.store({ type: 'episodic', content: 'second', summary: 'second' });

      const s = store.stats();
      expect(s.oldest).not.toBeNull();
      expect(s.newest).not.toBeNull();
      // newest should be >= oldest
      expect(new Date(s.newest!).getTime()).toBeGreaterThanOrEqual(new Date(s.oldest!).getTime());
    });
  });

  // -------------------------------------------------------------------------
  // list()
  // -------------------------------------------------------------------------
  describe('list()', () => {
    it('returns all memories with default options', async () => {
      await store.store({ type: 'episodic', content: 'a', summary: 'a' });
      await store.store({ type: 'semantic', content: 'b', summary: 'b' });

      const { memories, total } = store.list();
      expect(total).toBe(2);
      expect(memories).toHaveLength(2);
    });

    it('paginates correctly', async () => {
      await Promise.all(
        Array.from({ length: 7 }, (_, i) =>
          store.store({ type: 'episodic', content: `m${i}`, summary: `m${i}` })
        )
      );

      const page1 = store.list({ page: 1, page_size: 3 });
      expect(page1.memories).toHaveLength(3);
      expect(page1.total).toBe(7);

      const page2 = store.list({ page: 2, page_size: 3 });
      expect(page2.memories).toHaveLength(3);

      const page3 = store.list({ page: 3, page_size: 3 });
      expect(page3.memories).toHaveLength(1);

      // No duplicate ids across pages
      const allIds = [
        ...page1.memories.map((m) => m.id),
        ...page2.memories.map((m) => m.id),
        ...page3.memories.map((m) => m.id),
      ];
      expect(new Set(allIds).size).toBe(7);
    });

    it('filters by memory_type', async () => {
      await store.store({ type: 'episodic', content: 'ep', summary: 'ep' });
      await store.store({ type: 'semantic', content: 'sem', summary: 'sem' });
      await store.store({ type: 'procedural', content: 'proc', summary: 'proc' });

      const { memories, total } = store.list({ memory_type: 'episodic' });
      expect(total).toBe(1);
      expect(memories[0].memory_type).toBe('episodic');
    });

    it('filters by min_importance', async () => {
      await store.store({ type: 'episodic', content: 'low', summary: 'low', importance: 0.1 });
      await store.store({ type: 'episodic', content: 'high', summary: 'high', importance: 0.9 });

      const { memories, total } = store.list({ min_importance: 0.5 });
      expect(total).toBe(1);
      expect(memories[0].importance).toBeGreaterThanOrEqual(0.5);
    });

    it('filters by owner', async () => {
      await store.store({ type: 'episodic', content: 'mine', summary: 'mine', owner: 'alice' });
      await store.store({ type: 'episodic', content: 'theirs', summary: 'theirs', owner: 'bob' });

      const { memories, total } = store.list({ owner: 'alice' });
      expect(total).toBe(1);
      expect(memories[0].owner).toBe('alice');
    });

    it('orders by importance', async () => {
      await store.store({ type: 'episodic', content: 'mid', summary: 'mid', importance: 0.5 });
      await store.store({ type: 'episodic', content: 'top', summary: 'top', importance: 0.9 });
      await store.store({ type: 'episodic', content: 'bot', summary: 'bot', importance: 0.1 });

      const { memories } = store.list({ order: 'importance' });
      expect(memories[0].importance).toBeGreaterThanOrEqual(memories[1].importance);
      expect(memories[1].importance).toBeGreaterThanOrEqual(memories[2].importance);
    });

    it('returns empty list when no memories match filter', async () => {
      await store.store({ type: 'episodic', content: 'something', summary: 'something' });
      const { memories, total } = store.list({ memory_type: 'self_model' });
      expect(total).toBe(0);
      expect(memories).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // delete + update interaction
  // -------------------------------------------------------------------------
  describe('delete() + update() interaction', () => {
    it('update returns false after delete', async () => {
      const id = await store.store({ type: 'episodic', content: 'x', summary: 'x' });
      store.delete(id);
      expect(store.update(id, { summary: 'new' })).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // links
  // -------------------------------------------------------------------------
  describe('createLink() / strengthenLink()', () => {
    it('creates links without throwing', async () => {
      const id1 = await store.store({ type: 'episodic', content: 'a', summary: 'a' });
      const id2 = await store.store({ type: 'episodic', content: 'b', summary: 'b' });
      expect(() => store.createLink(id1, id2, 'supports', 0.6)).not.toThrow();
    });

    it('strengthens an existing link', async () => {
      const id1 = await store.store({ type: 'episodic', content: 'a', summary: 'a' });
      const id2 = await store.store({ type: 'episodic', content: 'b', summary: 'b' });
      store.createLink(id1, id2, 'causes', 0.5);
      store.strengthenLink(id1, id2, 0.2);

      const link = store.getDb().prepare(
        'SELECT strength FROM links WHERE source_id = ? AND target_id = ?'
      ).get(id1, id2) as { strength: number };
      expect(link.strength).toBeCloseTo(0.7, 5);
    });
  });

  // -------------------------------------------------------------------------
  // dream queue
  // -------------------------------------------------------------------------
  describe('dream queue', () => {
    it('queues and retrieves pending dreams', async () => {
      const id = await store.store({ type: 'episodic', content: 'x', summary: 'x' });
      store.queueDream('consolidate', [id], 0.8);

      const dreams = store.getPendingDreams(10);
      expect(dreams).toHaveLength(1);
      expect(dreams[0].operation).toBe('consolidate');
      expect(dreams[0].status).toBe('pending');
    });

    it('marks dream as completed', async () => {
      const id = await store.store({ type: 'episodic', content: 'x', summary: 'x' });
      store.queueDream('reflect', [id], 0.5);

      const [dream] = store.getPendingDreams(1);
      store.completeDream(dream.id, { summary: 'reflected' });

      const pending = store.getPendingDreams(10);
      expect(pending).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // clinamen()
  // -------------------------------------------------------------------------
  describe('clinamen()', () => {
    it('returns an array of memories', async () => {
      await store.store({ type: 'episodic', content: 'a', summary: 'a', importance: 0.8 });
      await store.store({ type: 'semantic', content: 'b', summary: 'b', importance: 0.9 });

      const results = store.clinamen('some context', { limit: 5 });
      expect(Array.isArray(results)).toBe(true);
    });

    it('respects limit', async () => {
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          store.store({ type: 'episodic', content: `m${i}`, summary: `m${i}`, importance: 0.7 })
        )
      );

      const results = store.clinamen('context', { limit: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('respects min_importance filter', async () => {
      await store.store({ type: 'episodic', content: 'low', summary: 'low', importance: 0.1 });
      await store.store({ type: 'episodic', content: 'high', summary: 'high', importance: 0.9 });

      const results = store.clinamen('context', { min_importance: 0.5 });
      for (const m of results) {
        expect(m.importance).toBeGreaterThanOrEqual(0.5);
      }
    });
  });
});
