// packages/brain/src/storage/dream-engine.ts

import type { SqliteStore } from './sqlite-store';
import type { MemoryType, SqliteMemory } from './types';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type DreamOperation =
  | 'consolidate'
  | 'compact'
  | 'reflect'
  | 'resolve_contradiction'
  | 'emergence';

export interface LLMHandle {
  type: 'ollama';
  model: string;
}

interface DreamQueueRow {
  id: number;
  operation: DreamOperation;
  memory_ids: string;
  priority: number;
  status: string;
  result: string | null;
  created_at: string;
  completed_at: string | null;
}

// --------------------------------------------------------------------------
// Decay rates per memory type  (fraction per day)
// --------------------------------------------------------------------------

const DECAY_RATES: Record<MemoryType, number> = {
  episodic: 0.07,
  semantic: 0.02,
  procedural: 0.03,
  self_model: 0.01,
  introspective: 0.02,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// --------------------------------------------------------------------------
// DreamEngine
// --------------------------------------------------------------------------

export class DreamEngine {
  private store: SqliteStore;
  private storeCallCount = 0;
  private scheduleHandle: ReturnType<typeof setInterval> | null = null;

  constructor(store: SqliteStore) {
    this.store = store;
  }

  // ---------- decay ----------

  /**
   * Apply type-specific exponential decay to all memories based on time since
   * last access.  Uses a single transaction for batch writes.
   */
  applyDecay(): void {
    const db = this.store.getDb();
    const now = Date.now();

    interface DecayRow {
      rowid: number;
      id: string;
      memory_type: MemoryType;
      decay_factor: number;
      last_accessed: string;
    }

    const rows = db
      .prepare('SELECT rowid, id, memory_type, decay_factor, last_accessed FROM memories')
      .all() as DecayRow[];

    if (rows.length === 0) return;

    const updateStmt = db.prepare(
      'UPDATE memories SET decay_factor = @decay_factor, updated_at = @updated_at WHERE id = @id'
    );

    const batchUpdate = db.transaction((items: Array<{ id: string; decay_factor: number; updated_at: string }>) => {
      for (const item of items) {
        updateStmt.run(item);
      }
    });

    const updatedAt = new Date().toISOString();
    const updates: Array<{ id: string; decay_factor: number; updated_at: string }> = [];

    for (const row of rows) {
      const rate = DECAY_RATES[row.memory_type] ?? 0.02;
      const lastAccessed = new Date(row.last_accessed).getTime();
      const daysSinceAccess = (now - lastAccessed) / MS_PER_DAY;

      const newDecay = Math.max(0.01, row.decay_factor * Math.pow(1 - rate, daysSinceAccess));

      if (Math.abs(newDecay - row.decay_factor) > 0.001) {
        updates.push({ id: row.id, decay_factor: newDecay, updated_at: updatedAt });
      }
    }

    if (updates.length > 0) {
      batchUpdate(updates);
    }
  }

  // ---------- store hook ----------

  /**
   * Call after each memory store operation. Every 10th call triggers applyDecay.
   */
  onStore(): void {
    this.storeCallCount++;
    if (this.storeCallCount % 10 === 0) {
      this.applyDecay();
    }
  }

  // ---------- LLM detection ----------

  /**
   * Check if Ollama is running locally. Returns handle or null.
   */
  async detectLLM(): Promise<LLMHandle | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      let response: Response;
      try {
        response = await fetch('http://localhost:11434/api/tags', {
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) return null;

      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const models = data.models ?? [];
      const model = models[0]?.name ?? 'llama3';

      return { type: 'ollama', model };
    } catch {
      return null;
    }
  }

  // ---------- scheduling ----------

  /**
   * Start a 60-second interval that runs decay + dream queue processing.
   */
  startSchedule(): void {
    if (this.scheduleHandle !== null) return;
    this.scheduleHandle = setInterval(() => {
      this.applyDecay();
      this.processDreamQueue().catch(() => {
        // non-fatal: silently skip if queue processing fails
      });
    }, 60_000);
  }

  /**
   * Stop the scheduled interval.
   */
  stopSchedule(): void {
    if (this.scheduleHandle !== null) {
      clearInterval(this.scheduleHandle);
      this.scheduleHandle = null;
    }
  }

  // ---------- dream queue ----------

  /**
   * Process pending dream queue entries when ≥5 are pending and an LLM is available.
   */
  async processDreamQueue(): Promise<void> {
    const pending = this.store.getPendingDreams(50) as DreamQueueRow[];

    if (pending.length < 5) return;

    const llm = await this.detectLLM();
    if (!llm) return;

    for (const entry of pending) {
      await this.executeDream(entry, llm);
    }
  }

  /**
   * Execute a single dream entry via the LLM.
   */
  async executeDream(entry: DreamQueueRow, llm: LLMHandle): Promise<void> {
    try {
      const memoryIds: string[] = JSON.parse(entry.memory_ids || '[]');
      const memories = this.fetchMemoriesByIds(memoryIds);

      const result = await this.dreamWithOllama(entry.operation, memories, llm.model);
      this.store.completeDream(entry.id, { success: true, result });
    } catch (err) {
      const db = this.store.getDb();
      const now = new Date().toISOString();
      db.prepare(
        "UPDATE dream_queue SET status = 'failed', result = ?, completed_at = ? WHERE id = ?"
      ).run(JSON.stringify({ error: String(err) }), now, entry.id);
    }
  }

  /**
   * Build a prompt for the given operation type and call Ollama's generate endpoint.
   */
  async dreamWithOllama(
    operation: DreamOperation,
    memories: SqliteMemory[],
    model: string
  ): Promise<string> {
    const prompt = this.buildPrompt(operation, memories);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    let response: Response;
    try {
      response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream: false }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(`Ollama generate failed: ${response.status}`);
    }

    const data = (await response.json()) as { response?: string };
    return data.response ?? '';
  }

  // ---------- private helpers ----------

  private fetchMemoriesByIds(ids: string[]): SqliteMemory[] {
    if (ids.length === 0) return [];

    const db = this.store.getDb();
    const placeholders = ids.map((_, i) => `@id${i}`).join(', ');
    const params: Record<string, string> = {};
    ids.forEach((id, i) => { params[`id${i}`] = id; });

    interface MemoryRow {
      id: string;
      memory_type: MemoryType;
      content: string;
      summary: string;
      importance: number;
      decay_factor: number;
      emotional_valence: number;
      tags: string;
      concepts: string;
      source: string;
      source_id: string | null;
      related_user: string | null;
      related_wallet: string | null;
      owner: string | null;
      metadata: string;
      access_count: number;
      created_at: string;
      updated_at: string;
      last_accessed: string;
    }

    const rows = db
      .prepare(`SELECT * FROM memories WHERE id IN (${placeholders})`)
      .all(params) as MemoryRow[];

    return rows.map((row) => ({
      id: row.id,
      memory_type: row.memory_type,
      content: row.content,
      summary: row.summary,
      importance: row.importance,
      decay_factor: row.decay_factor,
      emotional_valence: row.emotional_valence,
      tags: JSON.parse(row.tags || '[]'),
      concepts: JSON.parse(row.concepts || '[]'),
      source: row.source,
      source_id: row.source_id,
      related_user: row.related_user,
      related_wallet: row.related_wallet,
      owner: row.owner,
      metadata: JSON.parse(row.metadata || '{}'),
      access_count: row.access_count,
      created_at: row.created_at,
      updated_at: row.updated_at,
      last_accessed: row.last_accessed,
    }));
  }

  private buildPrompt(operation: DreamOperation, memories: SqliteMemory[]): string {
    const memorySummaries = memories
      .map((m, i) => `[${i + 1}] (${m.memory_type}) ${m.summary}`)
      .join('\n');

    switch (operation) {
      case 'consolidate':
        return [
          'You are a memory consolidation system. Review the following memories and produce',
          'a single consolidated summary that captures the key information, removing redundancy.',
          '',
          'Memories:',
          memorySummaries,
          '',
          'Consolidated summary:',
        ].join('\n');

      case 'compact':
        return [
          'You are a memory compaction system. Compress the following memories into a concise',
          'representation that preserves the most important details while reducing storage.',
          '',
          'Memories:',
          memorySummaries,
          '',
          'Compacted representation:',
        ].join('\n');

      case 'reflect':
        return [
          'You are a reflective reasoning system. Analyze the following memories and surface',
          'insights, patterns, or lessons that can be learned from them.',
          '',
          'Memories:',
          memorySummaries,
          '',
          'Reflection and insights:',
        ].join('\n');

      case 'resolve_contradiction':
        return [
          'You are a contradiction resolution system. The following memories appear to conflict.',
          'Analyze them and propose a resolution that reconciles the contradictions.',
          '',
          'Conflicting memories:',
          memorySummaries,
          '',
          'Resolution:',
        ].join('\n');

      case 'emergence':
        return [
          'You are an emergent pattern discovery system. Review the following memories and',
          'identify emergent themes, concepts, or higher-order patterns not obvious in any',
          'single memory.',
          '',
          'Memories:',
          memorySummaries,
          '',
          'Emergent patterns:',
        ].join('\n');
    }
  }
}
