// packages/brain/src/storage/__tests__/dream-engine.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SqliteStore } from '../sqlite-store';
import { DreamEngine } from '../dream-engine';
import type { Embedder } from '../types';

// ---------------------------------------------------------------------------
// Mock embedder
// ---------------------------------------------------------------------------

function createMockEmbedder(): Embedder {
  return {
    dimensions: 384,
    model: 'mock',
    embed: vi.fn(async (text: string) => {
      const seed = Array.from(text).reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const vec = new Float32Array(384);
      for (let i = 0; i < 384; i++) vec[i] = Math.sin(seed * (i + 1) * 0.01);
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

/** Back-date `last_accessed` for a memory row so decay has real time to work on */
function backdateLastAccessed(store: SqliteStore, id: string, daysAgo: number): void {
  const db = store.getDb();
  const past = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE memories SET last_accessed = ? WHERE id = ?').run(past, id);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DreamEngine', () => {
  let store: SqliteStore;
  let engine: DreamEngine;

  beforeEach(() => {
    store = makeStore();
    engine = new DreamEngine(store);
  });

  afterEach(() => {
    engine.stopSchedule();
    store.close();
  });

  // -------------------------------------------------------------------------
  // applyDecay()
  // -------------------------------------------------------------------------
  describe('applyDecay()', () => {
    it('reduces decay_factor for episodic memories after 10 days', async () => {
      const id = await store.store({
        type: 'episodic',
        content: 'Went for a walk in the park.',
        summary: 'walk in the park',
      });

      // Simulate 10 days passing since last access
      backdateLastAccessed(store, id, 10);

      // Capture initial decay_factor (should be 1.0 from store())
      const db = store.getDb();
      const before = db.prepare('SELECT decay_factor FROM memories WHERE id = ?').get(id) as {
        decay_factor: number;
      };
      expect(before.decay_factor).toBe(1.0);

      engine.applyDecay();

      const after = db.prepare('SELECT decay_factor FROM memories WHERE id = ?').get(id) as {
        decay_factor: number;
      };

      // After 10 days at 7%/day: 1.0 * (0.93)^10 ≈ 0.484
      expect(after.decay_factor).toBeLessThan(before.decay_factor);
      expect(after.decay_factor).toBeGreaterThan(0.01);
    });

    it('decays episodic faster than semantic over the same period', async () => {
      const episodicId = await store.store({
        type: 'episodic',
        content: 'Episodic memory content.',
        summary: 'episodic memory',
      });
      const semanticId = await store.store({
        type: 'semantic',
        content: 'Semantic memory content.',
        summary: 'semantic memory',
      });

      // Back-date both memories by 10 days
      backdateLastAccessed(store, episodicId, 10);
      backdateLastAccessed(store, semanticId, 10);

      engine.applyDecay();

      const db = store.getDb();
      const episodic = db
        .prepare('SELECT decay_factor FROM memories WHERE id = ?')
        .get(episodicId) as { decay_factor: number };
      const semantic = db
        .prepare('SELECT decay_factor FROM memories WHERE id = ?')
        .get(semanticId) as { decay_factor: number };

      // Episodic (7%/day) should have lower decay_factor than semantic (2%/day)
      expect(episodic.decay_factor).toBeLessThan(semantic.decay_factor);
    });

    it('does not update memories accessed very recently (change < 0.001)', async () => {
      const id = await store.store({
        type: 'episodic',
        content: 'Just stored this.',
        summary: 'just stored',
      });

      const db = store.getDb();
      const before = db
        .prepare('SELECT decay_factor, updated_at FROM memories WHERE id = ?')
        .get(id) as { decay_factor: number; updated_at: string };

      // last_accessed is "now" — change will be extremely tiny, below threshold
      engine.applyDecay();

      const after = db
        .prepare('SELECT decay_factor, updated_at FROM memories WHERE id = ?')
        .get(id) as { decay_factor: number; updated_at: string };

      // updated_at should not change since the delta is < 0.001
      expect(after.updated_at).toBe(before.updated_at);
    });
  });

  // -------------------------------------------------------------------------
  // queueDream (via store.queueDream)
  // -------------------------------------------------------------------------
  describe('queueDream', () => {
    it('adds entries to the dream queue', async () => {
      const id1 = await store.store({
        type: 'episodic',
        content: 'Memory one.',
        summary: 'memory one',
      });
      const id2 = await store.store({
        type: 'semantic',
        content: 'Memory two.',
        summary: 'memory two',
      });

      store.queueDream('consolidate', [id1, id2], 0.8);

      const pending = store.getPendingDreams(10);
      expect(pending).toHaveLength(1);
      expect(pending[0].operation).toBe('consolidate');
      expect(pending[0].status).toBe('pending');

      const parsedIds = JSON.parse(pending[0].memory_ids);
      expect(parsedIds).toContain(id1);
      expect(parsedIds).toContain(id2);
    });

    it('queues multiple entries independently', async () => {
      const id = await store.store({ type: 'episodic', content: 'x', summary: 'x' });

      store.queueDream('consolidate', [id], 0.9);
      store.queueDream('reflect', [id], 0.5);
      store.queueDream('emergence', [id], 0.3);

      const pending = store.getPendingDreams(10);
      expect(pending).toHaveLength(3);

      const operations = pending.map((p: { operation: string }) => p.operation);
      expect(operations).toContain('consolidate');
      expect(operations).toContain('reflect');
      expect(operations).toContain('emergence');
    });
  });

  // -------------------------------------------------------------------------
  // detectLLM()
  // -------------------------------------------------------------------------
  describe('detectLLM()', () => {
    it('returns null when Ollama is not running (fetch rejects)', async () => {
      // Mock fetch to simulate Ollama not being available
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
      vi.stubGlobal('fetch', mockFetch);

      const result = await engine.detectLLM();

      expect(result).toBeNull();

      vi.unstubAllGlobals();
    });

    it('returns null when Ollama returns a non-OK status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await engine.detectLLM();

      expect(result).toBeNull();

      vi.unstubAllGlobals();
    });

    it('returns LLMHandle when Ollama is running', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [{ name: 'llama3:8b' }],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await engine.detectLLM();

      expect(result).not.toBeNull();
      expect(result?.type).toBe('ollama');
      expect(result?.model).toBe('llama3:8b');

      vi.unstubAllGlobals();
    });

    it('falls back to "llama3" model when models list is empty', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await engine.detectLLM();

      expect(result?.model).toBe('llama3');

      vi.unstubAllGlobals();
    });
  });

  // -------------------------------------------------------------------------
  // onStore()
  // -------------------------------------------------------------------------
  describe('onStore()', () => {
    it('triggers applyDecay on every 10th call', () => {
      const spy = vi.spyOn(engine, 'applyDecay');

      for (let i = 0; i < 9; i++) engine.onStore();
      expect(spy).not.toHaveBeenCalled();

      engine.onStore(); // 10th call
      expect(spy).toHaveBeenCalledTimes(1);

      for (let i = 0; i < 9; i++) engine.onStore();
      engine.onStore(); // 20th call
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });
});
