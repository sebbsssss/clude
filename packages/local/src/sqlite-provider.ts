/**
 * SQLite StorageProvider — implements @clude/brain's StorageProvider interface.
 * Backed by better-sqlite3 with in-memory vector index.
 */

import Database from 'better-sqlite3';
import { resolve } from 'path';
import { mkdirSync } from 'fs';
import { cosineSim } from './embeddings.js';
import { ConnectionStore } from './connections.js';
import {
  generateMemoryUUID, computeContentHash, signPack, verifyPackIntegrity,
  type AgentIdentity, type MemoryPack, type PortableMemory, type Connection, type ConnectionType,
} from './identity.js';

// ── Types matching @clude/brain ──────────────────────────────

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'self_model';

export interface BrainMemory {
  id: string;
  uuid?: string;
  memory_type: MemoryType;
  content: string;
  summary: string;
  tags: string[];
  concepts: string[];
  emotional_valence: number;
  importance: number;
  access_count: number;
  source: string;
  source_id?: string;
  related_user?: string;
  related_entity?: string;
  metadata: Record<string, unknown>;
  created_at: string;
  last_accessed: string;
  decay_factor: number;
  owner_wallet?: string;
  compacted?: boolean;
  compacted_into?: string;
  solana_signature?: string;
  _score?: number;
  _vector_sim?: number;
}

export interface Scope {
  user_id?: string;
  agent_id?: string;
  session_id?: string;
  run_id?: string;
  owner_wallet?: string;
}

export interface MemoryLink {
  source_id: string;
  target_id: string;
  link_type: string;
  strength: number;
}

// ── Vector index entry ───────────────────────────────────────

interface VectorEntry {
  id: string;         // hash ID
  numericId: number;  // SQLite rowid
  embedding: number[];
  summaryEmbedding: number[] | null;
  type: MemoryType;
  importance: number;
  decay_factor: number;
  created_at: number;
  keywords: string[];
  contentLower: string;
}

// ── Provider ─────────────────────────────────────────────────

export interface SQLiteProviderConfig {
  dbPath?: string;
  wallet?: string;
  name?: string;
}

export class SQLiteProvider {
  readonly name = 'sqlite';
  readonly db: Database.Database;
  readonly connections: ConnectionStore;
  private vectors: VectorEntry[] = [];
  private loaded = false;
  private _wallet: string;
  private _name: string;
  private nextHashId = 0;

  constructor(config?: SQLiteProviderConfig) {
    const opts = config || {};
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

  get wallet(): string { return this._wallet; }

  // ── StorageProvider interface ────────────────────────────

  async insert(memory: Omit<BrainMemory, '_score' | '_vector_sim'>): Promise<BrainMemory> {
    const now = memory.created_at || new Date().toISOString();
    const uuid = memory.uuid || generateMemoryUUID(this._wallet, memory.content, now);

    const stmt = this.db.prepare(`
      INSERT INTO memories (hash_id, uuid, content, summary, type, importance, tags, concepts,
        emotional_valence, source, source_id, related_user, metadata, wallet,
        created_at, last_accessed, access_count, decay_factor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      memory.id, uuid, memory.content, memory.summary, memory.memory_type,
      memory.importance, JSON.stringify(memory.tags), JSON.stringify(memory.concepts),
      memory.emotional_valence, memory.source, memory.source_id || null,
      memory.related_user || null, JSON.stringify(memory.metadata),
      this._wallet, now, now, 0, memory.decay_factor,
    );

    return { ...memory, uuid, created_at: now, last_accessed: now, access_count: 0 };
  }

  async getById(id: string, scope?: Scope): Promise<BrainMemory | null> {
    let query = 'SELECT * FROM memories WHERE hash_id = ?';
    const params: any[] = [id];
    if (scope?.owner_wallet) { query += ' AND wallet = ?'; params.push(scope.owner_wallet); }
    const row = this.db.prepare(query).get(...params) as any;
    return row ? this.rowToBrain(row) : null;
  }

  async getByIds(ids: string[], scope?: Scope): Promise<BrainMemory[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    let query = `SELECT * FROM memories WHERE hash_id IN (${placeholders})`;
    const params: any[] = [...ids];
    if (scope?.owner_wallet) { query += ' AND wallet = ?'; params.push(scope.owner_wallet); }
    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(r => this.rowToBrain(r));
  }

  async update(id: string, patch: Partial<BrainMemory>): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];
    if (patch.importance !== undefined) { sets.push('importance = ?'); params.push(patch.importance); }
    if (patch.decay_factor !== undefined) { sets.push('decay_factor = ?'); params.push(patch.decay_factor); }
    if (patch.access_count !== undefined) { sets.push('access_count = ?'); params.push(patch.access_count); }
    if (patch.last_accessed !== undefined) { sets.push('last_accessed = ?'); params.push(patch.last_accessed); }
    if (sets.length === 0) return;
    params.push(id);
    this.db.prepare(`UPDATE memories SET ${sets.join(', ')} WHERE hash_id = ?`).run(...params);
  }

  async delete(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM memories WHERE hash_id = ?').run(id);
    this.vectors = this.vectors.filter(v => v.id !== id);
    return result.changes > 0;
  }

  async clear(): Promise<void> {
    this.db.exec('DELETE FROM memories');
    this.vectors = [];
  }

  async queryByImportance(opts: {
    limit: number; min_decay?: number; types?: MemoryType[]; tags?: string[];
    related_user?: string; related_entity?: string; scope?: Scope;
  }): Promise<BrainMemory[]> {
    let query = 'SELECT * FROM memories WHERE 1=1';
    const params: any[] = [];
    if (opts.min_decay) { query += ' AND decay_factor >= ?'; params.push(opts.min_decay); }
    if (opts.types?.length) { query += ` AND type IN (${opts.types.map(() => '?').join(',')})`; params.push(...opts.types); }
    if (opts.related_user) { query += ' AND related_user = ?'; params.push(opts.related_user); }
    if (opts.scope?.owner_wallet) { query += ' AND wallet = ?'; params.push(opts.scope.owner_wallet); }
    query += ' ORDER BY importance DESC, created_at DESC LIMIT ?';
    params.push(opts.limit);
    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(r => this.rowToBrain(r));
  }

  async queryByText(opts: {
    keywords: string[]; limit: number; min_decay?: number; types?: MemoryType[]; scope?: Scope;
  }): Promise<BrainMemory[]> {
    if (opts.keywords.length === 0) return [];
    const orClauses = opts.keywords.map(() => '(summary LIKE ? OR content LIKE ?)').join(' OR ');
    let query = `SELECT * FROM memories WHERE (${orClauses})`;
    const params: any[] = opts.keywords.flatMap(k => [`%${k}%`, `%${k}%`]);
    if (opts.min_decay) { query += ' AND decay_factor >= ?'; params.push(opts.min_decay); }
    if (opts.types?.length) { query += ` AND type IN (${opts.types.map(() => '?').join(',')})`; params.push(...opts.types); }
    if (opts.scope?.owner_wallet) { query += ' AND wallet = ?'; params.push(opts.scope.owner_wallet); }
    query += ' ORDER BY importance DESC LIMIT ?';
    params.push(opts.limit);
    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(r => this.rowToBrain(r));
  }

  async queryBySource(opts: {
    source: string; limit?: number; min_decay?: number; types?: MemoryType[]; scope?: Scope;
  }): Promise<BrainMemory[]> {
    let query = 'SELECT * FROM memories WHERE source = ?';
    const params: any[] = [opts.source];
    if (opts.min_decay) { query += ' AND decay_factor >= ?'; params.push(opts.min_decay); }
    if (opts.types?.length) { query += ` AND type IN (${opts.types.map(() => '?').join(',')})`; params.push(...opts.types); }
    if (opts.scope?.owner_wallet) { query += ' AND wallet = ?'; params.push(opts.scope.owner_wallet); }
    query += ' LIMIT ?';
    params.push(opts.limit ?? 100);
    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(r => this.rowToBrain(r));
  }

  async vectorSearch(opts: {
    embedding: number[]; threshold: number; limit: number; types?: MemoryType[]; scope?: Scope;
  }): Promise<Array<{ id: string; similarity: number }>> {
    this.loadVectors();
    const results: Array<{ id: string; similarity: number }> = [];

    for (const v of this.vectors) {
      if (opts.types?.length && !opts.types.includes(v.type)) continue;
      if (opts.scope?.owner_wallet) {
        // We'd need to join with DB; for now trust the in-memory index
      }
      const cs = cosineSim(opts.embedding, v.embedding);
      const ss = v.summaryEmbedding ? cosineSim(opts.embedding, v.summaryEmbedding) : 0;
      const sim = Math.max(cs, ss);
      if (sim >= opts.threshold) {
        results.push({ id: v.id, similarity: sim });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, opts.limit);
  }

  async storeEmbedding(memory_id: string, embedding: number[]): Promise<void> {
    const buf = Buffer.from(new Float32Array(embedding).buffer);
    this.db.prepare('UPDATE memories SET embedding = ? WHERE hash_id = ?').run(buf, memory_id);

    // Update in-memory vector index
    const existing = this.vectors.find(v => v.id === memory_id);
    if (existing) {
      existing.embedding = embedding;
    } else {
      const row = this.db.prepare('SELECT * FROM memories WHERE hash_id = ?').get(memory_id) as any;
      if (row) {
        this.vectors.push({
          id: memory_id,
          numericId: row.id,
          embedding,
          summaryEmbedding: null,
          type: row.type,
          importance: row.importance,
          decay_factor: row.decay_factor,
          created_at: new Date(row.created_at).getTime(),
          keywords: extractKeywords(row.summary + ' ' + row.content),
          contentLower: (row.content + ' ' + row.summary).toLowerCase(),
        });
      }
    }
  }

  async batchTrackAccess(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`
      UPDATE memories SET access_count = access_count + 1, last_accessed = datetime('now')
      WHERE hash_id IN (${placeholders})
    `).run(...ids);
  }

  async batchDecay(opts: { type: MemoryType; rate: number; min_decay: number }): Promise<number> {
    const result = this.db.prepare(`
      UPDATE memories SET decay_factor = MAX(?, decay_factor * ?)
      WHERE type = ? AND decay_factor > ?
    `).run(opts.min_decay, opts.rate, opts.type, opts.min_decay);

    // Update in-memory
    for (const v of this.vectors) {
      if (v.type === opts.type && v.decay_factor > opts.min_decay) {
        v.decay_factor = Math.max(opts.min_decay, v.decay_factor * opts.rate);
      }
    }

    return result.changes;
  }

  async boostImportance(id: string, amount: number, max: number): Promise<void> {
    this.db.prepare(`
      UPDATE memories SET importance = MIN(?, importance + ?) WHERE hash_id = ?
    `).run(max, amount, id);

    const v = this.vectors.find(v => v.id === id);
    if (v) v.importance = Math.min(max, v.importance + amount);
  }

  async upsertLink(link: MemoryLink): Promise<void> {
    // Map hash IDs to numeric IDs for connection store
    const fromRow = this.db.prepare('SELECT id, uuid FROM memories WHERE hash_id = ?').get(link.source_id) as any;
    const toRow = this.db.prepare('SELECT id, uuid FROM memories WHERE hash_id = ?').get(link.target_id) as any;
    if (fromRow && toRow) {
      this.connections.connect(
        fromRow.id, toRow.id,
        link.link_type as ConnectionType,
        link.strength,
        fromRow.uuid, toRow.uuid,
      );
    }
  }

  async getLinkedMemories(seed_ids: string[], min_strength: number, limit: number): Promise<Array<{ memory_id: string; link_type: string; strength: number }>> {
    // Map hash IDs to numeric IDs
    if (seed_ids.length === 0) return [];
    const placeholders = seed_ids.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT id, hash_id FROM memories WHERE hash_id IN (${placeholders})`).all(...seed_ids) as any[];
    const hashToNumeric = new Map(rows.map((r: any) => [r.hash_id, r.id]));
    const numericToHash = new Map(rows.map((r: any) => [r.id, r.hash_id]));

    const numericIds = seed_ids.map(id => hashToNumeric.get(id)).filter((id): id is number => id !== undefined);
    const connected = this.connections.getConnectedIds(numericIds);

    const results: Array<{ memory_id: string; link_type: string; strength: number }> = [];
    for (const [numId, info] of connected) {
      const hashId = numericToHash.get(numId);
      if (!hashId || seed_ids.includes(hashId)) continue;
      // Look up hash_id for connected memory
      const connRow = this.db.prepare('SELECT hash_id FROM memories WHERE id = ?').get(numId) as any;
      if (connRow && info.totalWeight >= min_strength) {
        results.push({
          memory_id: connRow.hash_id,
          link_type: 'relates', // simplified
          strength: info.totalWeight,
        });
      }
    }
    return results.slice(0, limit);
  }

  async boostLinkStrength(ids: string[], amount: number): Promise<number> {
    // Simplified: no-op for local (Hebbian handled by connection store)
    return 0;
  }

  async count(scope?: Scope): Promise<number> {
    let query = 'SELECT COUNT(*) as n FROM memories';
    const params: any[] = [];
    if (scope?.owner_wallet) { query += ' WHERE wallet = ?'; params.push(scope.owner_wallet); }
    const row = this.db.prepare(query).get(...params) as any;
    return row.n;
  }

  // ── Identity & Portability ──────────────────────────────

  getIdentity(): AgentIdentity {
    const row = this.db.prepare('SELECT * FROM agent_identity WHERE wallet = ?').get(this._wallet) as any;
    if (row) return { wallet: row.wallet, name: row.name, created_at: row.created_at, metadata: row.metadata ? JSON.parse(row.metadata) : undefined };
    const now = new Date().toISOString();
    this.db.prepare('INSERT OR IGNORE INTO agent_identity (wallet, name, created_at) VALUES (?, ?, ?)').run(this._wallet, this._name, now);
    return { wallet: this._wallet, name: this._name, created_at: now };
  }

  exportPack(options?: { types?: MemoryType[]; minImportance?: number; secret?: string }): MemoryPack {
    const identity = this.getIdentity();
    let query = 'SELECT * FROM memories WHERE wallet = ?';
    const params: any[] = [this._wallet];
    if (options?.types) { query += ` AND type IN (${options.types.map(() => '?').join(',')})`; params.push(...options.types); }
    if (options?.minImportance) { query += ' AND importance >= ?'; params.push(options.minImportance); }
    query += ' ORDER BY created_at ASC';

    const rows = this.db.prepare(query).all(...params) as any[];
    const memories: PortableMemory[] = rows.map(r => ({
      uuid: r.uuid || generateMemoryUUID(this._wallet, r.content, r.created_at),
      content: r.content, summary: r.summary, type: r.type, importance: r.importance,
      tags: JSON.parse(r.tags || '[]'), created_at: r.created_at,
      access_count: r.access_count, decay_factor: r.decay_factor,
      source_wallet: this._wallet, _local_id: r.id,
    }));

    const connections = this.connections.exportConnections();
    const contentHash = computeContentHash(memories);
    const signature = options?.secret ? signPack(contentHash, options.secret) : undefined;

    return {
      version: 1, wallet: this._wallet, identity, memories, connections,
      meta: { exported_at: new Date().toISOString(), memory_count: memories.length, connection_count: connections.length, content_hash: contentHash, signature },
    };
  }

  async importPack(pack: MemoryPack, embedFn: (text: string) => Promise<number[]>, options?: { skipVerify?: boolean; merge?: boolean; assignWallet?: string }): Promise<{ memories: number; connections: number; skipped: number }> {
    if (!options?.skipVerify && !verifyPackIntegrity(pack)) throw new Error('MemoryPack integrity check failed');

    const merge = options?.merge !== false;
    const wallet = options?.assignWallet || pack.wallet;
    let imported = 0, skipped = 0;
    const uuidToId = new Map<string, number>();

    for (const mem of pack.memories) {
      if (merge) {
        const existing = this.db.prepare('SELECT id FROM memories WHERE uuid = ?').get(mem.uuid) as any;
        if (existing) { uuidToId.set(mem.uuid, existing.id); skipped++; continue; }
      }

      const contentVec = await embedFn(mem.content.slice(0, 500));
      const summaryVec = mem.summary !== mem.content.slice(0, 200) ? await embedFn(mem.summary) : null;
      const contentBuf = Buffer.from(new Float32Array(contentVec).buffer);
      const summaryBuf = summaryVec ? Buffer.from(new Float32Array(summaryVec).buffer) : null;
      const hashId = `clude-${Math.random().toString(16).slice(2, 10)}`;

      const result = this.db.prepare(`
        INSERT INTO memories (hash_id, uuid, content, summary, type, importance, tags, concepts, emotional_valence,
          source, wallet, embedding, summary_embedding, created_at, access_count, decay_factor)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(hashId, mem.uuid, mem.content, mem.summary, mem.type, mem.importance,
        JSON.stringify(mem.tags), '[]', 0, 'import', wallet, contentBuf, summaryBuf,
        mem.created_at, mem.access_count, mem.decay_factor);

      const id = result.lastInsertRowid as number;
      uuidToId.set(mem.uuid, id);

      this.vectors.push({
        id: hashId, numericId: id, embedding: contentVec, summaryEmbedding: summaryVec,
        type: mem.type as MemoryType, importance: mem.importance, decay_factor: mem.decay_factor,
        created_at: new Date(mem.created_at).getTime(),
        keywords: extractKeywords(mem.summary + ' ' + mem.content),
        contentLower: (mem.content + ' ' + mem.summary).toLowerCase(),
      });
      imported++;
    }

    const connImported = this.connections.importConnections(pack.connections, uuidToId);
    return { memories: imported, connections: connImported, skipped };
  }

  exportMarkdown(): string {
    const identity = this.getIdentity();
    const rows = this.db.prepare('SELECT * FROM memories ORDER BY created_at ASC').all() as any[];
    const connections = this.connections.exportConnections();

    let md = `# Memory Pack: ${identity.name || identity.wallet}\n`;
    md += `> Wallet: \`${identity.wallet}\`\n`;
    md += `> Exported: ${new Date().toISOString()}\n`;
    md += `> Memories: ${rows.length} | Connections: ${connections.length}\n\n`;

    const byType: Record<string, any[]> = {};
    for (const r of rows) (byType[r.type] = byType[r.type] || []).push(r);

    for (const [type, mems] of Object.entries(byType)) {
      md += `## ${type} (${mems.length})\n\n`;
      for (const m of mems) {
        md += `- **[${(m.uuid || m.hash_id || m.id).toString().slice(0, 8)}]** (imp=${m.importance.toFixed(1)}) ${m.summary}\n`;
        if (m.content !== m.summary) md += `  > ${m.content.slice(0, 200)}\n`;
      }
      md += '\n';
    }

    if (connections.length > 0) {
      md += `## Connections (${connections.length})\n\n`;
      for (const c of connections) md += `- ${c.from_uuid?.slice(0, 8)} --[${c.type} ${c.strength.toFixed(1)}]--> ${c.to_uuid?.slice(0, 8)}\n`;
    }
    return md;
  }

  close(): void { this.db.close(); }

  // ── Internal ───────────────────────────────────────────

  private loadVectors(): void {
    if (this.loaded) return;
    const rows = this.db.prepare(
      'SELECT id, hash_id, embedding, summary_embedding, type, importance, decay_factor, created_at, summary, content FROM memories WHERE embedding IS NOT NULL'
    ).all() as any[];

    this.vectors = rows.map(r => {
      const embBuf = r.embedding;
      const sumBuf = r.summary_embedding;
      return {
        id: r.hash_id || `legacy-${r.id}`,
        numericId: r.id,
        embedding: Array.from(new Float32Array(embBuf.buffer, embBuf.byteOffset, embBuf.byteLength / 4)),
        summaryEmbedding: sumBuf ? Array.from(new Float32Array(sumBuf.buffer, sumBuf.byteOffset, sumBuf.byteLength / 4)) : null,
        type: r.type, importance: r.importance, decay_factor: r.decay_factor,
        created_at: new Date(r.created_at).getTime(),
        keywords: extractKeywords(r.summary + ' ' + r.content),
        contentLower: (r.content + ' ' + r.summary).toLowerCase(),
      };
    });
    this.loaded = true;
  }

  private rowToBrain(row: any): BrainMemory {
    return {
      id: row.hash_id || `legacy-${row.id}`,
      uuid: row.uuid || '',
      memory_type: row.type,
      content: row.content,
      summary: row.summary,
      tags: JSON.parse(row.tags || '[]'),
      concepts: JSON.parse(row.concepts || '[]'),
      emotional_valence: row.emotional_valence || 0,
      importance: row.importance,
      access_count: row.access_count,
      source: row.source || 'user',
      source_id: row.source_id,
      related_user: row.related_user,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      created_at: row.created_at,
      last_accessed: row.last_accessed,
      decay_factor: row.decay_factor,
      owner_wallet: row.wallet,
    };
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash_id TEXT UNIQUE,
        uuid TEXT UNIQUE,
        content TEXT NOT NULL,
        summary TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'episodic',
        importance REAL NOT NULL DEFAULT 0.5,
        tags TEXT NOT NULL DEFAULT '[]',
        concepts TEXT NOT NULL DEFAULT '[]',
        emotional_valence REAL NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'user',
        source_id TEXT,
        related_user TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
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
      CREATE INDEX IF NOT EXISTS idx_memories_hash_id ON memories(hash_id);
      CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source);

      CREATE TABLE IF NOT EXISTS agent_identity (
        wallet TEXT PRIMARY KEY,
        name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        metadata TEXT
      );
    `);
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
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    .filter((w, i, arr) => arr.indexOf(w) === i)
    .slice(0, 20);
}
