// packages/brain/src/storage/__tests__/integration.test.ts

import { describe, it, expect, vi } from 'vitest';
import { SqliteStore } from '../sqlite-store';
import type { Embedder } from '../types';

// ---------------------------------------------------------------------------
// Cluster embedder: similar vectors for semantically related words
// ---------------------------------------------------------------------------

function createClusterEmbedder(): Embedder {
  return {
    dimensions: 384,
    model: 'cluster-mock',
    embed: vi.fn(async (text: string) => {
      const vec = new Float32Array(384);
      const lower = text.toLowerCase();
      if (lower.includes('dark') || lower.includes('theme') || lower.includes('mode')) {
        for (let i = 0; i < 384; i++) vec[i] = Math.sin(i * 0.1);
      } else if (lower.includes('pizza') || lower.includes('food') || lower.includes('lunch')) {
        for (let i = 0; i < 384; i++) vec[i] = Math.cos(i * 0.1);
      } else if (lower.includes('code') || lower.includes('typescript') || lower.includes('react')) {
        for (let i = 0; i < 384; i++) vec[i] = Math.sin(i * 0.2);
      } else {
        const seed = Array.from(lower).reduce((a, c) => a + c.charCodeAt(0), 0);
        for (let i = 0; i < 384; i++) vec[i] = Math.sin(seed * (i + 1) * 0.01);
      }
      const norm = Math.sqrt(vec.reduce((a, v) => a + v * v, 0));
      for (let i = 0; i < 384; i++) vec[i] /= norm;
      return vec;
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Storage integration', () => {
  // -------------------------------------------------------------------------
  // 1. Recalls most relevant by topic
  // -------------------------------------------------------------------------
  describe('recalls most relevant by topic', () => {
    it('returns dark-mode memory first when querying about themes', async () => {
      const store = new SqliteStore({ dbPath: ':memory:', embedder: createClusterEmbedder() });

      // Dark mode has highest importance — wins in keyword-fallback mode (importance-ranked)
      // and vector mode (cluster embedder returns similar vectors for dark/theme/mode).
      await store.store({
        type: 'episodic',
        content: 'The user prefers dark mode in their editor.',
        summary: 'user prefers dark theme mode',
        importance: 0.9,
      });
      await store.store({
        type: 'episodic',
        content: 'Had pizza and salad for lunch today.',
        summary: 'pizza food lunch',
        importance: 0.5,
      });
      await store.store({
        type: 'semantic',
        content: 'TypeScript is a typed superset of JavaScript.',
        summary: 'typescript code language',
        importance: 0.6,
      });

      const result = await store.recall({ query: 'dark mode theme settings', limit: 3 });

      expect(result.count).toBeGreaterThan(0);
      expect(result.memories[0].summary).toContain('dark');

      store.close();
    });

    it('returns pizza memory first when querying about food', async () => {
      const store = new SqliteStore({ dbPath: ':memory:', embedder: createClusterEmbedder() });

      // Pizza has highest importance — wins in both fallback and vector mode.
      await store.store({
        type: 'episodic',
        content: 'The user prefers dark mode in their editor.',
        summary: 'user prefers dark theme mode',
        importance: 0.5,
      });
      await store.store({
        type: 'episodic',
        content: 'Had pizza and salad for lunch today.',
        summary: 'pizza food lunch today',
        importance: 0.9,
      });
      await store.store({
        type: 'semantic',
        content: 'TypeScript is a typed superset of JavaScript.',
        summary: 'typescript code language',
        importance: 0.6,
      });

      const result = await store.recall({ query: 'pizza food lunch', limit: 3 });

      expect(result.count).toBeGreaterThan(0);
      expect(result.memories[0].summary).toContain('pizza');

      store.close();
    });

    it('returns typescript memory first when querying about code', async () => {
      const store = new SqliteStore({ dbPath: ':memory:', embedder: createClusterEmbedder() });

      // TypeScript has highest importance — wins in both fallback and vector mode.
      await store.store({
        type: 'episodic',
        content: 'The user prefers dark mode in their editor.',
        summary: 'user prefers dark theme mode',
        importance: 0.5,
      });
      await store.store({
        type: 'episodic',
        content: 'Had pizza and salad for lunch today.',
        summary: 'pizza food lunch today',
        importance: 0.6,
      });
      await store.store({
        type: 'semantic',
        content: 'TypeScript is a typed superset of JavaScript.',
        summary: 'typescript code react language',
        importance: 0.9,
      });

      const result = await store.recall({ query: 'typescript react code', limit: 3 });

      expect(result.count).toBeGreaterThan(0);
      expect(result.memories[0].summary).toContain('typescript');

      store.close();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Filters by memory type
  // -------------------------------------------------------------------------
  describe('filters by memory type', () => {
    it('returns only episodic memories when filtered', async () => {
      const store = new SqliteStore({ dbPath: ':memory:', embedder: createClusterEmbedder() });

      await store.store({
        type: 'episodic',
        content: 'Attended the team standup at 9am.',
        summary: 'team standup meeting',
        importance: 0.6,
      });
      await store.store({
        type: 'semantic',
        content: 'Standups are daily sync meetings in agile.',
        summary: 'standup meeting agile knowledge',
        importance: 0.7,
      });
      await store.store({
        type: 'episodic',
        content: 'Reviewed pull requests after lunch.',
        summary: 'code review pull requests',
        importance: 0.5,
      });

      const result = await store.recall({
        query: 'standup meeting',
        memory_types: ['episodic'],
      });

      expect(result.count).toBeGreaterThan(0);
      for (const m of result.memories) {
        expect(m.memory_type).toBe('episodic');
      }

      store.close();
    });

    it('returns only semantic memories when filtered', async () => {
      const store = new SqliteStore({ dbPath: ':memory:', embedder: createClusterEmbedder() });

      await store.store({
        type: 'episodic',
        content: 'Attended the team standup at 9am.',
        summary: 'team standup meeting',
        importance: 0.6,
      });
      await store.store({
        type: 'semantic',
        content: 'Standups are daily sync meetings in agile.',
        summary: 'standup meeting agile knowledge',
        importance: 0.7,
      });

      const result = await store.recall({
        query: 'standup meeting knowledge',
        memory_types: ['semantic'],
      });

      expect(result.count).toBeGreaterThan(0);
      for (const m of result.memories) {
        expect(m.memory_type).toBe('semantic');
      }

      store.close();
    });
  });

  // -------------------------------------------------------------------------
  // 3. End-to-end lifecycle: store → recall → update → stats → delete → verify gone
  // -------------------------------------------------------------------------
  describe('end-to-end lifecycle', () => {
    it('completes full store → recall → update → stats → delete cycle', async () => {
      const store = new SqliteStore({ dbPath: ':memory:', embedder: createClusterEmbedder() });

      // Store
      const id = await store.store({
        type: 'semantic',
        content: 'Dark mode reduces eye strain during night coding sessions.',
        summary: 'dark mode eye strain night coding',
        importance: 0.7,
        tags: ['ui', 'preferences'],
        concepts: ['dark-mode', 'accessibility'],
        owner: 'alice',
      });
      expect(id).toMatch(/^clude-[0-9a-f]{8}$/);

      // Recall
      const recallResult = await store.recall({ query: 'dark mode theme', limit: 5 });
      expect(recallResult.count).toBeGreaterThan(0);
      const found = recallResult.memories.find((m) => m.id === id);
      expect(found).toBeDefined();
      expect(found!.relevance_score).toBeGreaterThanOrEqual(0);

      // access_count should have incremented
      const { memories: afterRecall } = store.list();
      const mem = afterRecall.find((m) => m.id === id);
      expect(mem!.access_count).toBe(1);

      // Update
      const updated = store.update(id, { importance: 0.95, tags: ['ui', 'preferences', 'updated'] });
      expect(updated).toBe(true);

      const { memories: afterUpdate } = store.list();
      const updatedMem = afterUpdate.find((m) => m.id === id);
      expect(updatedMem!.importance).toBe(0.95);
      expect(updatedMem!.tags).toContain('updated');

      // Stats
      const stats = store.stats();
      expect(stats.total).toBe(1);
      expect(stats.by_type.semantic).toBe(1);
      expect(stats.avg_importance).toBeCloseTo(0.95, 5);
      expect(stats.oldest).not.toBeNull();
      expect(stats.newest).not.toBeNull();

      // Delete
      const deleted = store.delete(id);
      expect(deleted).toBe(true);

      // Verify gone from list
      const { memories: afterDelete, total } = store.list();
      expect(total).toBe(0);
      expect(afterDelete.find((m) => m.id === id)).toBeUndefined();

      // Verify gone from recall
      const recallAfterDelete = await store.recall({ query: 'dark mode theme', limit: 5 });
      expect(recallAfterDelete.memories.find((m) => m.id === id)).toBeUndefined();

      // Stats after delete
      const statsAfter = store.stats();
      expect(statsAfter.total).toBe(0);

      store.close();
    });
  });
});
