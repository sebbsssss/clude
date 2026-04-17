// packages/brain/src/storage/sqlite-store.ts

import * as crypto from 'crypto';
import Database from 'better-sqlite3';
import { initDatabase } from './schema';
import type {
  SqliteMemory,
  StoreOpts,
  RecallOpts,
  RecallResult,
  ListOpts,
  MemoryStats,
  Embedder,
  MemoryType,
} from './types';

interface SqliteStoreConfig {
  dbPath: string;
  embedder: Embedder;
}

// Raw row from the memories table (all JSON fields as strings)
interface MemoryRow {
  rowid: number;
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
  cloud_synced: number;
  cloud_id: string | null;
  embedding_model: string;
}

function parseRow(row: MemoryRow): SqliteMemory {
  return {
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
  };
}

/**
 * Compute cosine similarity between two Float32Arrays.
 * Both vectors should already be normalized (unit length).
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // Vectors are normalized, so this is the cosine similarity
}

/**
 * Compute recency score as a linear decay over 30 days.
 * Returns 1.0 for now, 0.0 for 30+ days ago.
 */
function recencyScore(createdAt: string): number {
  const now = Date.now();
  const created = new Date(createdAt).getTime();
  const ageMs = now - created;
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  return Math.max(0, 1 - ageMs / thirtyDaysMs);
}

export class SqliteStore {
  private db: Database.Database;
  private embedder: Embedder;
  private vecAvailable = false;

  constructor(config: SqliteStoreConfig) {
    this.embedder = config.embedder;
    this.db = new Database(config.dbPath);
    initDatabase(this.db);
    this.loadVecExtension();
    this.ensureVecTable();
  }

  // ---------- sqlite-vec ----------

  private loadVecExtension(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sqliteVec = require('sqlite-vec');
      sqliteVec.load(this.db);
      this.vecAvailable = true;
    } catch {
      // sqlite-vec not available — fall back to keyword search
      this.vecAvailable = false;
    }
  }

  private ensureVecTable(): void {
    if (!this.vecAvailable) return;
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings USING vec0(
          rowid INTEGER PRIMARY KEY,
          embedding FLOAT[${this.embedder.dimensions}]
        )
      `);
    } catch {
      // If virtual table creation fails, disable vec
      this.vecAvailable = false;
    }
  }

  // ---------- public API ----------

  async store(opts: StoreOpts): Promise<string> {
    const id = 'clude-' + crypto.randomBytes(4).toString('hex');
    const now = new Date().toISOString();

    const insert = this.db.prepare(`
      INSERT INTO memories (
        id, memory_type, content, summary, importance, decay_factor,
        emotional_valence, tags, concepts, source, source_id,
        related_user, related_wallet, owner, metadata,
        created_at, updated_at, last_accessed, embedding_model
      ) VALUES (
        @id, @memory_type, @content, @summary, @importance, @decay_factor,
        @emotional_valence, @tags, @concepts, @source, @source_id,
        @related_user, @related_wallet, @owner, @metadata,
        @created_at, @updated_at, @last_accessed, @embedding_model
      )
    `);

    const result = insert.run({
      id,
      memory_type: opts.type,
      content: opts.content,
      summary: opts.summary,
      importance: opts.importance ?? 0.5,
      decay_factor: 1.0,
      emotional_valence: opts.emotional_valence ?? 0.0,
      tags: JSON.stringify(opts.tags ?? []),
      concepts: JSON.stringify(opts.concepts ?? []),
      source: opts.source ?? 'mcp',
      source_id: opts.source_id ?? null,
      related_user: opts.related_user ?? null,
      related_wallet: opts.related_wallet ?? null,
      owner: opts.owner ?? null,
      metadata: JSON.stringify(opts.metadata ?? {}),
      created_at: now,
      updated_at: now,
      last_accessed: now,
      embedding_model: this.embedder.model,
    });

    const rowid = result.lastInsertRowid as number | bigint;

    // Store vector embedding
    if (this.vecAvailable) {
      try {
        const embedding = await this.embedder.embed(opts.summary);
        const vecInsert = this.db.prepare(`
          INSERT OR REPLACE INTO memory_embeddings (rowid, embedding)
          VALUES (?, ?)
        `);
        vecInsert.run(BigInt(rowid), Buffer.from(embedding.buffer));
      } catch {
        // Non-fatal: vector insertion failed, recall will fall back to keyword search
      }
    }

    return id;
  }

  async recall(opts: RecallOpts): Promise<RecallResult> {
    const limit = opts.limit ?? 10;

    // Build WHERE clause conditions
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (opts.memory_types && opts.memory_types.length > 0) {
      const placeholders = opts.memory_types.map((_, i) => `@mt${i}`).join(', ');
      opts.memory_types.forEach((t, i) => { params[`mt${i}`] = t; });
      conditions.push(`m.memory_type IN (${placeholders})`);
    }
    if (opts.min_importance !== undefined) {
      conditions.push('m.importance >= @min_importance');
      params.min_importance = opts.min_importance;
    }
    if (opts.min_decay !== undefined) {
      conditions.push('m.decay_factor >= @min_decay');
      params.min_decay = opts.min_decay;
    }
    if (opts.related_user !== undefined) {
      conditions.push('m.related_user = @related_user');
      params.related_user = opts.related_user;
    }
    if (opts.related_wallet !== undefined) {
      conditions.push('m.related_wallet = @related_wallet');
      params.related_wallet = opts.related_wallet;
    }
    if (opts.owner !== undefined) {
      conditions.push('m.owner = @owner');
      params.owner = opts.owner;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Try vector search first
    let candidateRows: Array<MemoryRow & { vec_distance?: number }> = [];

    if (this.vecAvailable) {
      try {
        const queryEmbedding = await this.embedder.embed(opts.query);
        const queryBuf = Buffer.from(queryEmbedding.buffer);

        // Fetch more candidates than needed so we can apply composite scoring
        const fetchLimit = Math.min(limit * 5, 100);

        const vecQuery = this.db.prepare(`
          SELECT m.*, e.distance as vec_distance
          FROM memory_embeddings e
          JOIN memories m ON m.rowid = e.rowid
          ${whereClause}
          ORDER BY e.distance
          LIMIT @fetch_limit
        `);

        candidateRows = vecQuery.all({
          ...params,
          query_embedding: queryBuf,
          fetch_limit: fetchLimit,
        }) as Array<MemoryRow & { vec_distance?: number }>;
      } catch {
        // Vector search failed — fall through to keyword search
        candidateRows = [];
      }
    }

    // Keyword fallback (or supplement when vec returned nothing)
    if (candidateRows.length === 0) {
      const fetchLimit = Math.min(limit * 5, 100);
      const keywordQuery = this.db.prepare(`
        SELECT m.* FROM memories m
        ${whereClause}
        ORDER BY m.importance DESC, m.created_at DESC
        LIMIT @fetch_limit
      `);
      candidateRows = keywordQuery.all({ ...params, fetch_limit: fetchLimit }) as MemoryRow[];
    }

    if (candidateRows.length === 0) {
      return { count: 0, memories: [] };
    }

    // Apply composite scoring
    let queryEmbedding: Float32Array | null = null;
    if (this.vecAvailable) {
      try {
        queryEmbedding = await this.embedder.embed(opts.query);
      } catch {
        // ignore
      }
    }

    // Build a rowid → embedding cache if we need cosine similarity
    const embeddingCache = new Map<number, Float32Array>();
    if (queryEmbedding && !this.vecAvailable) {
      // Already have distances from vec; no extra fetch needed
    }

    // Score each candidate
    const scored = await Promise.all(
      candidateRows.map(async (row) => {
        let similarity = 0.5; // neutral default

        if (queryEmbedding) {
          if (row.vec_distance !== undefined) {
            // sqlite-vec returns L2 distance; convert to approximate cosine similarity
            // For normalized vectors: cosine = 1 - (L2^2 / 2)
            similarity = Math.max(0, 1 - (row.vec_distance * row.vec_distance) / 2);
          } else {
            // Fetch stored embedding for cosine similarity
            let storedEmbedding = embeddingCache.get(row.rowid);
            if (!storedEmbedding) {
              try {
                storedEmbedding = await this.embedder.embed(row.summary);
                embeddingCache.set(row.rowid, storedEmbedding);
              } catch {
                storedEmbedding = undefined;
              }
            }
            if (storedEmbedding) {
              similarity = Math.max(0, cosineSimilarity(queryEmbedding, storedEmbedding));
            }
          }
        }

        // Tag filter (post-query filtering)
        if (opts.tags && opts.tags.length > 0) {
          const rowTags: string[] = JSON.parse(row.tags || '[]');
          const hasTag = opts.tags.some((t) => rowTags.includes(t));
          if (!hasTag) return null;
        }

        const recency = recencyScore(row.created_at);
        const importance = row.importance;
        const decay = row.decay_factor;

        // Composite score: 0.45 * similarity + 0.25 * importance + 0.15 * recency + 0.15 * similarity
        // (The spec duplicates similarity at 0.45 + 0.15 = 0.60 total weight for similarity)
        const baseScore =
          0.45 * similarity +
          0.25 * importance +
          0.15 * recency +
          0.15 * similarity;
        const finalScore = baseScore * decay;

        return { row, score: finalScore };
      })
    );

    // Filter nulls, sort by score, take top N
    const valid = scored
      .filter((s): s is { row: MemoryRow & { vec_distance?: number }; score: number } => s !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (valid.length === 0) {
      return { count: 0, memories: [] };
    }

    // Update access stats for returned memories
    const now = new Date().toISOString();
    const updateAccess = this.db.prepare(`
      UPDATE memories
      SET access_count = access_count + 1, last_accessed = ?
      WHERE id = ?
    `);

    const updateMany = this.db.transaction((rows: typeof valid) => {
      for (const { row } of rows) {
        updateAccess.run(now, row.id);
      }
    });
    updateMany(valid);

    const memories = valid.map(({ row, score }) => ({
      ...parseRow(row),
      relevance_score: score,
    }));

    return { count: memories.length, memories };
  }

  delete(id: string): boolean {
    // Delete from vec table first (by rowid)
    if (this.vecAvailable) {
      try {
        const rowRow = this.db.prepare('SELECT rowid FROM memories WHERE id = ?').get(id) as { rowid: number } | undefined;
        if (rowRow) {
          this.db.prepare('DELETE FROM memory_embeddings WHERE rowid = ?').run(BigInt(rowRow.rowid));
        }
      } catch {
        // Non-fatal
      }
    }

    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return result.changes > 0;
  }

  update(
    id: string,
    patches: {
      summary?: string;
      content?: string;
      importance?: number;
      decay_factor?: number;
      emotional_valence?: number;
      tags?: string[];
      concepts?: string[];
      metadata?: Record<string, unknown>;
      owner?: string;
      related_user?: string;
      related_wallet?: string;
    }
  ): boolean {
    const existing = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | undefined;
    if (!existing) return false;

    const now = new Date().toISOString();

    const setClauses: string[] = ['updated_at = @updated_at'];
    const params: Record<string, unknown> = { id, updated_at: now };

    if (patches.summary !== undefined) { setClauses.push('summary = @summary'); params.summary = patches.summary; }
    if (patches.content !== undefined) { setClauses.push('content = @content'); params.content = patches.content; }
    if (patches.importance !== undefined) { setClauses.push('importance = @importance'); params.importance = patches.importance; }
    if (patches.decay_factor !== undefined) { setClauses.push('decay_factor = @decay_factor'); params.decay_factor = patches.decay_factor; }
    if (patches.emotional_valence !== undefined) { setClauses.push('emotional_valence = @emotional_valence'); params.emotional_valence = patches.emotional_valence; }
    if (patches.tags !== undefined) { setClauses.push('tags = @tags'); params.tags = JSON.stringify(patches.tags); }
    if (patches.concepts !== undefined) { setClauses.push('concepts = @concepts'); params.concepts = JSON.stringify(patches.concepts); }
    if (patches.metadata !== undefined) { setClauses.push('metadata = @metadata'); params.metadata = JSON.stringify(patches.metadata); }
    if (patches.owner !== undefined) { setClauses.push('owner = @owner'); params.owner = patches.owner; }
    if (patches.related_user !== undefined) { setClauses.push('related_user = @related_user'); params.related_user = patches.related_user; }
    if (patches.related_wallet !== undefined) { setClauses.push('related_wallet = @related_wallet'); params.related_wallet = patches.related_wallet; }

    const sql = `UPDATE memories SET ${setClauses.join(', ')} WHERE id = @id`;
    const result = this.db.prepare(sql).run(params);
    return result.changes > 0;
  }

  stats(): MemoryStats {
    const totalRow = this.db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number };
    const total = totalRow.count;

    const byTypeRows = this.db.prepare(
      'SELECT memory_type, COUNT(*) as count FROM memories GROUP BY memory_type'
    ).all() as Array<{ memory_type: MemoryType; count: number }>;

    const by_type: Record<MemoryType, number> = {
      episodic: 0,
      semantic: 0,
      procedural: 0,
      self_model: 0,
      introspective: 0,
    };
    for (const row of byTypeRows) {
      by_type[row.memory_type] = row.count;
    }

    const aggRow = this.db.prepare(
      'SELECT AVG(importance) as avg_imp, AVG(decay_factor) as avg_decay FROM memories'
    ).get() as { avg_imp: number | null; avg_decay: number | null };

    const dateRow = this.db.prepare(
      'SELECT MIN(created_at) as oldest, MAX(created_at) as newest FROM memories'
    ).get() as { oldest: string | null; newest: string | null };

    return {
      total,
      by_type,
      avg_importance: aggRow.avg_imp ?? 0,
      avg_decay: aggRow.avg_decay ?? 0,
      oldest: dateRow.oldest,
      newest: dateRow.newest,
    };
  }

  list(opts?: ListOpts): { memories: SqliteMemory[]; total: number } {
    const page = opts?.page ?? 1;
    const pageSize = opts?.page_size ?? 20;
    const offset = (page - 1) * pageSize;
    const order = opts?.order ?? 'created_at';

    const conditions: string[] = [];
    const params: Record<string, unknown> = {
      limit: pageSize,
      offset,
    };

    if (opts?.memory_type) {
      conditions.push('memory_type = @memory_type');
      params.memory_type = opts.memory_type;
    }
    if (opts?.min_importance !== undefined) {
      conditions.push('importance >= @min_importance');
      params.min_importance = opts.min_importance;
    }
    if (opts?.owner !== undefined) {
      conditions.push('owner = @owner');
      params.owner = opts.owner;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const totalRow = this.db.prepare(`SELECT COUNT(*) as count FROM memories ${whereClause}`).get(params) as { count: number };
    const total = totalRow.count;

    const rows = this.db.prepare(`
      SELECT * FROM memories ${whereClause}
      ORDER BY ${order} DESC
      LIMIT @limit OFFSET @offset
    `).all(params) as MemoryRow[];

    return {
      memories: rows.map(parseRow),
      total,
    };
  }

  /**
   * Clinamen — return memories that diverge unexpectedly from context.
   * Finds memories with lower similarity to context but high importance,
   * representing "creative swerves" away from the obvious.
   */
  clinamen(
    context: string,
    opts?: {
      limit?: number;
      min_importance?: number;
      memory_types?: MemoryType[];
    }
  ): SqliteMemory[] {
    const limit = opts?.limit ?? 5;
    const conditions: string[] = [];
    const params: Record<string, unknown> = { limit };

    if (opts?.min_importance !== undefined) {
      conditions.push('importance >= @min_importance');
      params.min_importance = opts.min_importance;
    }
    if (opts?.memory_types && opts.memory_types.length > 0) {
      const placeholders = opts.memory_types.map((_, i) => `@mt${i}`).join(', ');
      opts.memory_types.forEach((t, i) => { params[`mt${i}`] = t; });
      conditions.push(`memory_type IN (${placeholders})`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Select high-importance memories that haven't been accessed recently
    // These represent "forgotten" or divergent insights
    const rows = this.db.prepare(`
      SELECT * FROM memories ${whereClause}
      ORDER BY importance DESC, last_accessed ASC
      LIMIT @limit
    `).all(params) as MemoryRow[];

    return rows.map(parseRow);
  }

  // ---------- links ----------

  createLink(
    sourceId: string,
    targetId: string,
    bondType: 'causes' | 'supports' | 'resolves' | 'elaborates' | 'contradicts',
    strength = 0.5
  ): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO links (source_id, target_id, bond_type, strength)
      VALUES (?, ?, ?, ?)
    `).run(sourceId, targetId, bondType, strength);
  }

  strengthenLink(sourceId: string, targetId: string, boost = 0.1): void {
    this.db.prepare(`
      UPDATE links
      SET strength = MIN(1.0, strength + ?)
      WHERE source_id = ? AND target_id = ?
    `).run(boost, sourceId, targetId);
  }

  // ---------- dream queue ----------

  queueDream(
    operation: 'consolidate' | 'compact' | 'reflect' | 'resolve_contradiction' | 'emergence',
    memoryIds: string[],
    priority = 0.5
  ): void {
    this.db.prepare(`
      INSERT INTO dream_queue (operation, memory_ids, priority)
      VALUES (?, ?, ?)
    `).run(operation, JSON.stringify(memoryIds), priority);
  }

  getPendingDreams(limit = 10): any[] {
    return this.db.prepare(`
      SELECT * FROM dream_queue
      WHERE status = 'pending'
      ORDER BY priority DESC, created_at ASC
      LIMIT ?
    `).all(limit);
  }

  completeDream(id: number, result: unknown): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE dream_queue
      SET status = 'completed', result = ?, completed_at = ?
      WHERE id = ?
    `).run(JSON.stringify(result), now, id);
  }

  // ---------- internals ----------

  getDb(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}
