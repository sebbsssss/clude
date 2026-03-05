/**
 * SQLite-backed memory store with in-memory vector index.
 * Zero config — creates DB file automatically.
 * 
 * Portability: Every memory is tagged with a wallet address.
 * Export/import as signed MemoryPacks that any agent can verify.
 */

import Database from 'better-sqlite3';
import { embed, cosineSim, getEmbeddingDims } from './embeddings.js';
import { ConnectionStore } from './connections.js';
import {
  generateMemoryUUID, computeContentHash, signPack, verifyPackIntegrity,
  type AgentIdentity, type MemoryPack, type PortableMemory, type Connection, type ConnectionType,
} from './identity.js';
import { resolve } from 'path';
import { mkdirSync } from 'fs';

export interface Memory {
  id: number;
  /** Stable UUID that survives export/import */
  uuid: string;
  content: string;
  summary: string;
  type: 'episodic' | 'semantic' | 'procedural' | 'self_model';
  importance: number;
  tags: string[];
  created_at: string;
  last_accessed: string;
  access_count: number;
  decay_factor: number;
  /** Wallet address of the owning agent */
  wallet: string;
}

export interface MemoryResult extends Memory {
  similarity: number;
  score: number;
}

export interface StoreOptions {
  content: string;
  summary?: string;
  type?: Memory['type'];
  importance?: number;
  tags?: string[];
  /** Connect to these memory IDs */
  connectTo?: Array<{ id: number; type: ConnectionType; strength?: number }>;
}

export interface MemoryStoreConfig {
  /** Path to SQLite database file */
  dbPath?: string;
  /** Wallet address (Solana pubkey or any unique ID). Required for portability. */
  wallet?: string;
  /** Agent display name */
  name?: string;
}

export interface RecallOptions {
  query: string;
  limit?: number;
  types?: Memory['type'][];
  minImportance?: number;
  threshold?: number;
  /** If true, rank purely by semantic similarity (ignore importance/recency) */
  exact?: boolean;
}

interface VectorEntry {
  id: number;
  embedding: number[];       // primary (content) vector
  summaryEmbedding: number[] | null; // secondary (summary) vector for broader match
  type: Memory['type'];
  importance: number;
  decay_factor: number;
  created_at: number;
  keywords: string[];
  _contentLower: string;     // cached lowercase content for direct text matching
}

export class MemoryStore {
  private db: Database.Database;
  private vectors: VectorEntry[] = [];
  private loaded = false;
  private _ready: Promise<void> | null = null;
  private _wallet: string;
  private _name: string;
  public readonly connections: ConnectionStore;

  constructor(config?: string | MemoryStoreConfig) {
    const opts = typeof config === 'string' ? { dbPath: config } : (config || {});
    const finalPath = opts.dbPath || resolve(process.cwd(), '.clude', 'memory.db');
    this._wallet = opts.wallet || 'local';
    this._name = opts.name || 'agent';

    mkdirSync(resolve(finalPath, '..'), { recursive: true });
    this.db = new Database(finalPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.initSchema();
    this.connections = new ConnectionStore(this.db);
  }

  /** The wallet address identifying this agent's memories */
  get wallet(): string { return this._wallet; }

  /** Get or create the agent identity record */
  getIdentity(): AgentIdentity {
    const row = this.db.prepare('SELECT * FROM agent_identity WHERE wallet = ?').get(this._wallet) as any;
    if (row) {
      return {
        wallet: row.wallet,
        name: row.name,
        created_at: row.created_at,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      };
    }
    // Create identity on first use
    const now = new Date().toISOString();
    this.db.prepare(
      'INSERT OR IGNORE INTO agent_identity (wallet, name, created_at) VALUES (?, ?, ?)'
    ).run(this._wallet, this._name, now);
    return { wallet: this._wallet, name: this._name, created_at: now };
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE,
        content TEXT NOT NULL,
        summary TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'episodic',
        importance REAL NOT NULL DEFAULT 0.5,
        tags TEXT NOT NULL DEFAULT '[]',
        wallet TEXT NOT NULL DEFAULT 'local',
        embedding BLOB,
        summary_embedding BLOB,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_accessed TEXT NOT NULL DEFAULT (datetime('now')),
        access_count INTEGER NOT NULL DEFAULT 0,
        decay_factor REAL NOT NULL DEFAULT 1.0
      );
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance);
      CREATE INDEX IF NOT EXISTS idx_memories_wallet ON memories(wallet);
      CREATE INDEX IF NOT EXISTS idx_memories_uuid ON memories(uuid);

      CREATE TABLE IF NOT EXISTS agent_identity (
        wallet TEXT PRIMARY KEY,
        name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        metadata TEXT
      );
    `);
    // Migrations for existing DBs
    try { this.db.exec('ALTER TABLE memories ADD COLUMN summary_embedding BLOB'); } catch { /* exists */ }
    try { this.db.exec('ALTER TABLE memories ADD COLUMN uuid TEXT'); } catch { /* exists */ }
    try { this.db.exec('ALTER TABLE memories ADD COLUMN wallet TEXT NOT NULL DEFAULT \'local\''); } catch { /* exists */ }
  }

  /**
   * Pre-warm the embedding model. Optional — happens automatically on first use.
   * Call this at startup if you want instant first recall.
   */
  async warmup(): Promise<void> {
    await embed('warmup');
    this.loadVectors();
  }

  private loadVectors(): void {
    if (this.loaded) return;
    const dims = getEmbeddingDims();
    const rows = this.db.prepare(
      'SELECT id, embedding, summary_embedding, type, importance, decay_factor, created_at, summary, content FROM memories WHERE embedding IS NOT NULL'
    ).all() as any[];

    this.vectors = rows.map(r => {
      const embBuf = r.embedding;
      const sumBuf = r.summary_embedding;
      return {
        id: r.id,
        embedding: Array.from(new Float32Array(embBuf.buffer, embBuf.byteOffset, embBuf.byteLength / 4)),
        summaryEmbedding: sumBuf ? Array.from(new Float32Array(sumBuf.buffer, sumBuf.byteOffset, sumBuf.byteLength / 4)) : null,
        type: r.type,
        importance: r.importance,
        decay_factor: r.decay_factor,
        created_at: new Date(r.created_at).getTime(),
        keywords: extractKeywords(r.summary + ' ' + r.content),
        _contentLower: (r.content + ' ' + r.summary).toLowerCase(),
      };
    });
    this.loaded = true;
  }

  async remember(opts: StoreOptions): Promise<Memory> {
    const content = opts.content.trim();
    const summary = opts.summary || autoSummarize(content);
    const type = opts.type || 'episodic';
    const importance = opts.importance ?? 0.5;
    const tags = opts.tags || [];
    const now = new Date().toISOString();
    const uuid = generateMemoryUUID(this._wallet, content, now);

    // Dual embedding: content for detail matching, summary for broad matching
    const contentVec = await embed(content.slice(0, 500));
    const summaryVec = summary !== content.slice(0, 200) ? await embed(summary) : null;
    const contentBuf = Buffer.from(new Float32Array(contentVec).buffer);
    const summaryBuf = summaryVec ? Buffer.from(new Float32Array(summaryVec).buffer) : null;

    const stmt = this.db.prepare(`
      INSERT INTO memories (uuid, content, summary, type, importance, tags, wallet, embedding, summary_embedding, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(uuid, content, summary, type, importance, JSON.stringify(tags), this._wallet, contentBuf, summaryBuf, now);
    const id = result.lastInsertRowid as number;

    // Add to in-memory index
    this.vectors.push({
      id,
      embedding: contentVec,
      summaryEmbedding: summaryVec,
      type,
      importance,
      decay_factor: 1.0,
      created_at: Date.now(),
      keywords: extractKeywords(summary + ' ' + content),
      _contentLower: (content + ' ' + summary).toLowerCase(),
    });

    // Create explicit connections if requested
    if (opts.connectTo) {
      for (const conn of opts.connectTo) {
        const targetUuid = this.db.prepare('SELECT uuid FROM memories WHERE id = ?').get(conn.id) as any;
        this.connections.connect(id, conn.id, conn.type, conn.strength ?? 0.5, uuid, targetUuid?.uuid);
      }
    }

    const memory = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as any;
    return this.rowToMemory(memory);
  }

  async recall(opts: RecallOptions): Promise<MemoryResult[]> {
    this.loadVectors();

    if (this.vectors.length === 0) return [];

    const limit = opts.limit || 10;
    const threshold = opts.threshold ?? 0.2;
    const queryVec = await embed(opts.query);
    const queryKeywords = extractKeywords(opts.query);
    const now = Date.now();

    // Score all vectors
    // First pass: compute raw similarities for normalization
    const filtered = this.vectors.filter(v => {
      if (opts.types && !opts.types.includes(v.type)) return false;
      if (opts.minImportance && v.importance < opts.minImportance) return false;
      return true;
    });

    const rawSims = filtered.map(v => {
      const cs = cosineSim(queryVec, v.embedding);
      const ss = v.summaryEmbedding ? cosineSim(queryVec, v.summaryEmbedding) : 0;
      return Math.max(cs, ss);
    });
    const simMin = Math.min(...rawSims);
    const simMax = Math.max(...rawSims);
    const simRange = simMax - simMin || 1;

    const scored = filtered
      .map((v, idx) => {
        // Best-of-two: content embedding OR summary embedding
        const similarity = rawSims[idx];
        // Normalized similarity: spreads compressed [0.75-0.92] range to [0-1]
        const normSim = (similarity - simMin) / simRange;

        // Keyword overlap boost (helps with exact term matches the embedding might miss)
        const matchedKeywords = queryKeywords.filter(k => 
          v.keywords.some(vk => vk === k || vk.includes(k) || k.includes(vk) || 
            // Prefix match for stemming: "consolidation" ↔ "consolidate"
            (k.length >= 4 && vk.length >= 4 && (vk.startsWith(k.slice(0, Math.min(k.length, 6))) || k.startsWith(vk.slice(0, Math.min(vk.length, 6))))))
        );
        const keywordOverlap = queryKeywords.length > 0
          ? matchedKeywords.length / queryKeywords.length
          : 0;

        // Keyword boost scales with overlap: 1 match = small, 2+ = meaningful
        const keywordBoost = keywordOverlap > 0
          ? 0.03 + keywordOverlap * 0.07  // 0.03-0.10 range
          : 0;

        // Direct text match: if query terms appear literally in content (case-insensitive)
        const contentLower = v._contentLower;
        const directHits = queryKeywords.filter(k => contentLower.includes(k)).length;
        const directRatio = queryKeywords.length > 0 ? directHits / queryKeywords.length : 0;
        // Strong boost when multiple query terms match directly
        const directBoost = directRatio > 0.5 ? 0.03 + directRatio * 0.08 
                          : directRatio > 0 ? 0.02 + directRatio * 0.04
                          : 0;

        if (similarity < threshold) return null;

        // Age in hours
        const ageHours = (now - v.created_at) / (1000 * 60 * 60);
        const recency = Math.exp(-ageHours / (24 * 30)); // 30-day half-life

        // Combined score — similarity is king
        // Importance only matters as a tiebreaker, not a primary signal.
        // A high-similarity low-importance memory should always beat
        // a mediocre-similarity high-importance one.
        const score = opts.exact
          ? similarity + keywordBoost + directBoost
          : 0.60 * similarity +
            0.20 * normSim +     // normalized sim amplifies relative differences
            0.03 * recency +
            0.05 * v.importance +
            0.02 * v.decay_factor +
            keywordBoost +
            directBoost;

        return { id: v.id, similarity, score };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (scored.length === 0) return [];

    // Phase 2: Connection graph boost
    // Top results pull in connected memories
    const topIds = scored.slice(0, 5).map(s => s.id);
    const connected = this.connections.getConnectedIds(topIds);
    for (const s of scored) {
      const boost = connected.get(s.id);
      if (boost) {
        s.score += boost.totalWeight * 0.05; // mild graph boost
      }
    }
    // Re-sort after graph boost
    scored.sort((a, b) => b.score - a.score);

    // Fetch full memories and update access
    const ids = scored.slice(0, limit).map(s => s.id);
    const placeholders = ids.map(() => '?').join(',');

    this.db.prepare(`
      UPDATE memories SET access_count = access_count + 1, last_accessed = datetime('now')
      WHERE id IN (${placeholders})
    `).run(...ids);

    const rows = this.db.prepare(
      `SELECT * FROM memories WHERE id IN (${placeholders})`
    ).all(...ids) as any[];

    const rowMap = new Map(rows.map(r => [r.id, r]));

    return scored.map(s => {
      const row = rowMap.get(s.id)!;
      return {
        ...this.rowToMemory(row),
        similarity: s.similarity,
        score: s.score,
      };
    });
  }

  /** Get memory count */
  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as n FROM memories').get() as any;
    return row.n;
  }

  /** Get all memories (no vectors) */
  list(limit = 50, offset = 0): Memory[] {
    const rows = this.db.prepare(
      'SELECT * FROM memories ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(limit, offset) as any[];
    return rows.map(r => this.rowToMemory(r));
  }

  /** Search memories by keyword (no embeddings needed) */
  search(keyword: string, limit = 10): Memory[] {
    const rows = this.db.prepare(
      `SELECT * FROM memories WHERE summary LIKE ? OR content LIKE ? ORDER BY importance DESC LIMIT ?`
    ).all(`%${keyword}%`, `%${keyword}%`, limit) as any[];
    return rows.map(r => this.rowToMemory(r));
  }

  /** Delete a memory */
  forget(id: number): boolean {
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    this.vectors = this.vectors.filter(v => v.id !== id);
    return result.changes > 0;
  }

  /** Forget all memories */
  clear(): void {
    this.db.exec('DELETE FROM memories');
    this.vectors = [];
  }

  /** Close the database */
  close(): void {
    this.db.close();
  }

  /** Export all memories as JSON */
  export(): Memory[] {
    const rows = this.db.prepare('SELECT * FROM memories ORDER BY created_at ASC').all() as any[];
    return rows.map(r => this.rowToMemory(r));
  }

  // ── Portability: Export/Import ──────────────────────────

  /**
   * Export memories as a portable MemoryPack.
   * Includes all connections. Optionally sign with a secret.
   */
  exportPack(options?: { 
    types?: Memory['type'][];
    minImportance?: number;
    secret?: string;
  }): MemoryPack {
    const identity = this.getIdentity();
    
    let query = 'SELECT * FROM memories WHERE wallet = ?';
    const params: any[] = [this._wallet];
    
    if (options?.types) {
      const placeholders = options.types.map(() => '?').join(',');
      query += ` AND type IN (${placeholders})`;
      params.push(...options.types);
    }
    if (options?.minImportance) {
      query += ' AND importance >= ?';
      params.push(options.minImportance);
    }
    query += ' ORDER BY created_at ASC';

    const rows = this.db.prepare(query).all(...params) as any[];
    
    const memories: PortableMemory[] = rows.map(r => ({
      uuid: r.uuid || generateMemoryUUID(this._wallet, r.content, r.created_at),
      content: r.content,
      summary: r.summary,
      type: r.type,
      importance: r.importance,
      tags: JSON.parse(r.tags || '[]'),
      created_at: r.created_at,
      access_count: r.access_count,
      decay_factor: r.decay_factor,
      source_wallet: this._wallet,
      _local_id: r.id,
    }));

    const connections = this.connections.exportConnections();
    const contentHash = computeContentHash(memories);
    const signature = options?.secret ? signPack(contentHash, options.secret) : undefined;

    return {
      version: 1,
      wallet: this._wallet,
      identity,
      memories,
      connections,
      meta: {
        exported_at: new Date().toISOString(),
        memory_count: memories.length,
        connection_count: connections.length,
        content_hash: contentHash,
        signature,
      },
    };
  }

  /**
   * Import a MemoryPack into this store.
   * Memories are re-embedded locally. Connections are preserved.
   * Returns count of imported memories and connections.
   */
  async importPack(pack: MemoryPack, options?: {
    /** If true, skip integrity check */
    skipVerify?: boolean;
    /** If true, merge with existing (skip duplicates by UUID). Default: true */
    merge?: boolean;
    /** Override wallet assignment (default: keep source wallet) */
    assignWallet?: string;
  }): Promise<{ memories: number; connections: number; skipped: number }> {
    // Verify integrity
    if (!options?.skipVerify && !verifyPackIntegrity(pack)) {
      throw new Error('MemoryPack integrity check failed: content hash mismatch');
    }

    const merge = options?.merge !== false;
    const wallet = options?.assignWallet || pack.wallet;
    let imported = 0;
    let skipped = 0;
    const uuidToId = new Map<string, number>();

    for (const mem of pack.memories) {
      // Check for existing UUID
      if (merge) {
        const existing = this.db.prepare('SELECT id FROM memories WHERE uuid = ?').get(mem.uuid) as any;
        if (existing) {
          uuidToId.set(mem.uuid, existing.id);
          skipped++;
          continue;
        }
      }

      // Re-embed locally
      const contentVec = await embed(mem.content.slice(0, 500));
      const summaryVec = mem.summary !== mem.content.slice(0, 200) ? await embed(mem.summary) : null;
      const contentBuf = Buffer.from(new Float32Array(contentVec).buffer);
      const summaryBuf = summaryVec ? Buffer.from(new Float32Array(summaryVec).buffer) : null;

      const result = this.db.prepare(`
        INSERT INTO memories (uuid, content, summary, type, importance, tags, wallet, embedding, summary_embedding, created_at, access_count, decay_factor)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mem.uuid, mem.content, mem.summary, mem.type, mem.importance,
        JSON.stringify(mem.tags), wallet, contentBuf, summaryBuf,
        mem.created_at, mem.access_count, mem.decay_factor,
      );

      const id = result.lastInsertRowid as number;
      uuidToId.set(mem.uuid, id);

      // Add to vector index
      this.vectors.push({
        id,
        embedding: contentVec,
        summaryEmbedding: summaryVec,
        type: mem.type,
        importance: mem.importance,
        decay_factor: mem.decay_factor,
        created_at: new Date(mem.created_at).getTime(),
        keywords: extractKeywords(mem.summary + ' ' + mem.content),
        _contentLower: (mem.content + ' ' + mem.summary).toLowerCase(),
      });

      imported++;
    }

    // Import connections
    const connImported = this.connections.importConnections(pack.connections, uuidToId);

    return { memories: imported, connections: connImported, skipped };
  }

  /**
   * Export as human-readable markdown (for sharing/viewing).
   */
  exportMarkdown(): string {
    const identity = this.getIdentity();
    const memories = this.export();
    const connections = this.connections.exportConnections();

    let md = `# Memory Pack: ${identity.name || identity.wallet}\n`;
    md += `> Wallet: \`${identity.wallet}\`\n`;
    md += `> Exported: ${new Date().toISOString()}\n`;
    md += `> Memories: ${memories.length} | Connections: ${connections.length}\n\n`;

    const byType: Record<string, Memory[]> = {};
    for (const m of memories) {
      (byType[m.type] = byType[m.type] || []).push(m);
    }

    for (const [type, mems] of Object.entries(byType)) {
      md += `## ${type} (${mems.length})\n\n`;
      for (const m of mems) {
        md += `- **[${m.uuid?.slice(0, 8) || m.id}]** (imp=${m.importance.toFixed(1)}) ${m.summary}\n`;
        if (m.content !== m.summary) {
          md += `  > ${m.content.slice(0, 200)}\n`;
        }
      }
      md += '\n';
    }

    if (connections.length > 0) {
      md += `## Connections (${connections.length})\n\n`;
      for (const c of connections) {
        md += `- ${c.from_uuid?.slice(0, 8)} --[${c.type} ${c.strength.toFixed(1)}]--> ${c.to_uuid?.slice(0, 8)}\n`;
      }
    }

    return md;
  }

  private rowToMemory(row: any): Memory {
    return {
      id: row.id,
      uuid: row.uuid || '',
      content: row.content,
      summary: row.summary,
      type: row.type,
      importance: row.importance,
      tags: JSON.parse(row.tags || '[]'),
      created_at: row.created_at,
      last_accessed: row.last_accessed,
      access_count: row.access_count,
      decay_factor: row.decay_factor,
      wallet: row.wallet || 'local',
    };
  }
}

// ── Helpers ──────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','am',
  'and','or','but','in','on','at','to','for','of','with',
  'by','from','how','what','who','why','when','where','does',
  'do','did','can','will','about','that','this','it','my',
  'your','his','her','its','our','their','i','you','he','she',
  'we','they','me','him','us','them','not','no','so','if',
  'just','like','has','have','had','which','would','could',
  'should','there','here','then','than','also','very','much',
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    .filter((w, i, arr) => arr.indexOf(w) === i) // dedupe
    .slice(0, 20);
}

function autoSummarize(content: string): string {
  // Take first sentence or first 200 chars
  const firstSentence = content.match(/^[^.!?\n]+[.!?]?/)?.[0] || '';
  if (firstSentence.length >= 20 && firstSentence.length <= 200) {
    return firstSentence.trim();
  }
  return content.slice(0, 200).trim();
}
