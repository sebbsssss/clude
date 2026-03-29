import Database from 'better-sqlite3';
import * as path from 'path';
import type { Memory, MemoryLink, MemoryType } from './types';

/**
 * SQLite-based storage for local memories.
 * Uses sqlite-vec extension for vector similarity search when available,
 * falls back to full-table scan with JS-side cosine similarity.
 */
export class SqliteStore {
  private db: Database.Database;
  private vectorExtLoaded = false;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
  }

  async init(): Promise<void> {
    // Try loading sqlite-vec extension
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sqliteVec = require('sqlite-vec');
      sqliteVec.load(this.db);
      this.vectorExtLoaded = true;
      console.log('[SqliteStore] sqlite-vec extension loaded');
    } catch {
      console.warn('[SqliteStore] sqlite-vec not available. Vector search will use JS cosine similarity.');
      console.warn('  Install with: npm install sqlite-vec');
    }

    this.createTables();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN ('episodic','semantic','procedural','self_model')),
        summary TEXT NOT NULL,
        content TEXT NOT NULL,
        importance REAL NOT NULL DEFAULT 0.5,
        tags TEXT NOT NULL DEFAULT '[]',
        decay_factor REAL NOT NULL DEFAULT 1.0,
        access_count INTEGER NOT NULL DEFAULT 0,
        event_date TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC);

      CREATE TABLE IF NOT EXISTS memory_embeddings (
        memory_id INTEGER PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
        embedding BLOB NOT NULL,
        dimensions INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        target_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        link_type TEXT NOT NULL,
        strength REAL NOT NULL DEFAULT 0.5,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(source_id, target_id, link_type)
      );

      CREATE INDEX IF NOT EXISTS idx_links_source ON memory_links(source_id);
      CREATE INDEX IF NOT EXISTS idx_links_target ON memory_links(target_id);
    `);

    // Create sqlite-vec virtual table if extension loaded
    if (this.vectorExtLoaded) {
      try {
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS memory_vectors USING vec0(
            memory_id INTEGER PRIMARY KEY,
            embedding float[768]
          );
        `);
        console.log('[SqliteStore] sqlite-vec virtual table created');
      } catch (err) {
        console.warn('[SqliteStore] Could not create vec0 table:', err);
        this.vectorExtLoaded = false;
      }
    }
  }

  insert(memory: Memory): number {
    const stmt = this.db.prepare(`
      INSERT INTO memories (type, summary, content, importance, tags, event_date)
      VALUES (@type, @summary, @content, @importance, @tags, @eventDate)
    `);
    const result = stmt.run({
      type: memory.type,
      summary: memory.summary,
      content: memory.content,
      importance: memory.importance,
      tags: JSON.stringify(memory.tags ?? []),
      eventDate: memory.eventDate ?? null,
    });
    return result.lastInsertRowid as number;
  }

  storeEmbedding(memoryId: number, embedding: number[]): void {
    // Store as Float32 binary blob
    const buffer = Buffer.alloc(embedding.length * 4);
    for (let i = 0; i < embedding.length; i++) {
      buffer.writeFloatLE(embedding[i], i * 4);
    }

    this.db.prepare(`
      INSERT OR REPLACE INTO memory_embeddings (memory_id, embedding, dimensions)
      VALUES (?, ?, ?)
    `).run(memoryId, buffer, embedding.length);

    // Also insert into vec0 virtual table if available
    if (this.vectorExtLoaded) {
      try {
        this.db.prepare(`
          INSERT OR REPLACE INTO memory_vectors (memory_id, embedding)
          VALUES (?, ?)
        `).run(memoryId, buffer);
      } catch {
        // sqlite-vec format may differ — fall back silently
      }
    }
  }

  getEmbedding(memoryId: number): number[] | null {
    const row = this.db.prepare(`
      SELECT embedding, dimensions FROM memory_embeddings WHERE memory_id = ?
    `).get(memoryId) as { embedding: Buffer; dimensions: number } | undefined;

    if (!row) return null;
    const embedding: number[] = [];
    for (let i = 0; i < row.dimensions; i++) {
      embedding.push(row.embedding.readFloatLE(i * 4));
    }
    return embedding;
  }

  getAll(options?: { types?: MemoryType[]; minImportance?: number; limit?: number }): Memory[] {
    let query = 'SELECT * FROM memories WHERE decay_factor > 0.1';
    const params: (string | number)[] = [];

    if (options?.types?.length) {
      query += ` AND type IN (${options.types.map(() => '?').join(',')})`;
      params.push(...options.types);
    }
    if (options?.minImportance !== undefined) {
      query += ' AND importance >= ?';
      params.push(options.minImportance);
    }

    query += ' ORDER BY importance DESC, created_at DESC';

    if (options?.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.prepare(query).all(...params) as RawMemoryRow[];
    return rows.map(parseRow);
  }

  getById(id: number): Memory | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as
      | RawMemoryRow
      | undefined;
    return row ? parseRow(row) : null;
  }

  updateDecay(): void {
    // Apply type-specific decay rates
    const decayRates: Record<string, number> = {
      episodic: 0.93,
      semantic: 0.98,
      procedural: 0.97,
      self_model: 0.99,
    };

    const stmt = this.db.prepare(`
      UPDATE memories SET decay_factor = decay_factor * ?, updated_at = datetime('now')
      WHERE type = ? AND decay_factor > 0.01
    `);

    const updateAll = this.db.transaction(() => {
      for (const [type, rate] of Object.entries(decayRates)) {
        stmt.run(rate, type);
      }
    });
    updateAll();
  }

  incrementAccess(id: number): void {
    this.db.prepare(`
      UPDATE memories SET access_count = access_count + 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(id);
  }

  addLink(link: MemoryLink): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO memory_links (source_id, target_id, link_type, strength)
      VALUES (?, ?, ?, ?)
    `).run(link.sourceId, link.targetId, link.linkType, link.strength);
  }

  getLinkedMemories(memoryId: number): { memory: Memory; linkType: string; strength: number }[] {
    const links = this.db.prepare(`
      SELECT m.*, ml.link_type, ml.strength
      FROM memory_links ml
      JOIN memories m ON m.id = ml.target_id
      WHERE ml.source_id = ?
      UNION
      SELECT m.*, ml.link_type, ml.strength
      FROM memory_links ml
      JOIN memories m ON m.id = ml.source_id
      WHERE ml.target_id = ?
    `).all(memoryId, memoryId) as Array<RawMemoryRow & { link_type: string; strength: number }>;

    return links.map((row) => ({
      memory: parseRow(row),
      linkType: row.link_type,
      strength: row.strength,
    }));
  }

  close(): void {
    this.db.close();
  }
}

interface RawMemoryRow {
  id: number;
  type: MemoryType;
  summary: string;
  content: string;
  importance: number;
  tags: string;
  decay_factor: number;
  access_count: number;
  event_date: string | null;
  created_at: string;
  updated_at: string;
}

function parseRow(row: RawMemoryRow): Memory {
  return {
    id: row.id,
    type: row.type,
    summary: row.summary,
    content: row.content,
    importance: row.importance,
    tags: JSON.parse(row.tags) as string[],
    decayFactor: row.decay_factor,
    accessCount: row.access_count,
    eventDate: row.event_date ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
