#!/usr/bin/env node
/**
 * @clude/mcp — Persistent memory for any AI agent via MCP.
 *
 * Modes:
 *   Local (default): SQLite + gte-small, zero config
 *   Cloud: Supabase + Voyage AI (set CLUDE_MODE=cloud)
 *
 * Usage:
 *   npx @clude/mcp                          # local mode
 *   CLUDE_MODE=cloud npx @clude/mcp         # cloud mode
 *
 * Claude Desktop config:
 *   {
 *     "mcpServers": {
 *       "clude": {
 *         "command": "npx",
 *         "args": ["@clude/mcp"]
 *       }
 *     }
 *   }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { resolve } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';

// ── Types ────────────────────────────────────────────────────

type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'self_model';

interface Memory {
  id: string;
  memory_type: MemoryType;
  content: string;
  summary: string;
  tags: string[];
  importance: number;
  decay_factor: number;
  created_at: string;
  last_accessed: string;
  access_count: number;
  source: string;
  owner_wallet?: string;
  metadata: Record<string, unknown>;
}

// ── Storage interface ────────────────────────────────────────

interface MemoryStore {
  name: string;
  store(opts: {
    content: string;
    summary: string;
    type: MemoryType;
    tags?: string[];
    importance?: number;
    source?: string;
  }): Promise<{ id: string }>;
  recall(opts: {
    query?: string;
    types?: MemoryType[];
    tags?: string[];
    limit?: number;
  }): Promise<Memory[]>;
  forget(id: string): Promise<boolean>;
  stats(): Promise<{ total: number; by_type: Record<string, number> }>;
}

// ── Supabase Cloud Store ─────────────────────────────────────

class SupabaseStore implements MemoryStore {
  readonly name = 'cloud (Supabase + Voyage)';
  private db;
  private voyageKey: string;
  private ownerWallet?: string;

  constructor() {
    const url = env('CLUDE_SUPABASE_URL') || env('SUPABASE_URL');
    const key = env('CLUDE_SUPABASE_KEY') || env('SUPABASE_KEY');
    this.voyageKey = env('CLUDE_VOYAGE_KEY') || env('VOYAGE_API_KEY') || '';
    this.ownerWallet = env('CLUDE_OWNER_WALLET') || env('OWNER_WALLET');

    if (!url || !key) throw new Error('Cloud mode requires CLUDE_SUPABASE_URL + CLUDE_SUPABASE_KEY');
    this.db = createClient(url, key);
  }

  async store(opts: {
    content: string; summary: string; type: MemoryType;
    tags?: string[]; importance?: number; source?: string;
  }): Promise<{ id: string }> {
    const { data, error } = await this.db
      .from('memories')
      .insert({
        memory_type: opts.type,
        content: opts.content,
        summary: opts.summary,
        tags: opts.tags || [],
        concepts: [],
        emotional_valence: 0,
        importance: opts.importance ?? 0.5,
        access_count: 0,
        source: opts.source || 'mcp',
        metadata: {},
        decay_factor: 1.0,
        owner_wallet: this.ownerWallet,
      })
      .select('id')
      .single();

    if (error) throw new Error(`Store failed: ${error.message}`);

    // Embed async (don't block the response)
    if (this.voyageKey) {
      this.embed(String(data.id), opts.summary).catch(() => {});
    }

    return { id: String(data.id) };
  }

  async recall(opts: {
    query?: string; types?: MemoryType[]; tags?: string[]; limit?: number;
  }): Promise<Memory[]> {
    const limit = opts.limit || 5;

    // If we have a query and Voyage key, do vector search
    if (opts.query && this.voyageKey) {
      try {
        const embedding = await this.getEmbedding(opts.query);
        const rpcParams: Record<string, any> = {
          query_embedding: JSON.stringify(embedding),
          match_threshold: 0.25,
          match_count: limit,
          filter_types: opts.types || null,
          filter_user: null,
          min_decay: 0.1,
        };

        const { data, error } = await this.db.rpc('match_memories', rpcParams);
        if (!error && data?.length > 0) {
          const ids = data.map((r: any) => r.id);
          const { data: memories } = await this.db
            .from('memories')
            .select('*')
            .in('id', ids);
          return (memories || []).map(rowToMemory);
        }
      } catch {
        // Fall through to text search
      }
    }

    // Fallback: importance-ranked with optional filters
    let q = this.db.from('memories').select('*')
      .gte('decay_factor', 0.1)
      .order('importance', { ascending: false })
      .limit(limit);

    if (this.ownerWallet) q = q.eq('owner_wallet', this.ownerWallet);
    if (opts.types?.length) q = q.in('memory_type', opts.types);
    if (opts.tags?.length) q = q.overlaps('tags', opts.tags);

    const { data } = await q;
    return (data || []).map(rowToMemory);
  }

  async forget(id: string): Promise<boolean> {
    const { error } = await this.db.from('memories').delete().eq('id', id);
    return !error;
  }

  async stats(): Promise<{ total: number; by_type: Record<string, number> }> {
    const { count } = await this.db.from('memories')
      .select('id', { count: 'exact', head: true });

    const by_type: Record<string, number> = {};
    for (const t of ['episodic', 'semantic', 'procedural', 'self_model'] as const) {
      const { count: c } = await this.db.from('memories')
        .select('id', { count: 'exact', head: true })
        .eq('memory_type', t);
      by_type[t] = c || 0;
    }

    return { total: count || 0, by_type };
  }

  private async getEmbedding(text: string): Promise<number[]> {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.voyageKey}`,
      },
      body: JSON.stringify({
        model: 'voyage-4-large',
        input: [text],
        input_type: 'query',
      }),
    });
    if (!res.ok) throw new Error(`Voyage error: ${res.status}`);
    const json = await res.json() as any;
    return json.data[0].embedding;
  }

  private async embed(memoryId: string, text: string): Promise<void> {
    const embedding = await this.getEmbedding(text);
    // Try RPC first, fall back to direct update
    const { error } = await this.db.rpc('store_memory_embedding', {
      p_memory_id: parseInt(memoryId, 10),
      p_embedding: JSON.stringify(embedding),
    });
    if (error) {
      await this.db.from('memories')
        .update({ embedding: JSON.stringify(embedding) } as any)
        .eq('id', memoryId);
    }
  }
}

// ── SQLite Local Store ───────────────────────────────────────

class LocalStore implements MemoryStore {
  readonly name = 'local (SQLite)';
  private db: any;
  private embedFn: ((text: string) => Promise<number[]>) | null = null;

  constructor() {
    const dir = env('CLUDE_DATA_DIR') || resolve(homedir(), '.clude');
    mkdirSync(dir, { recursive: true });
    const dbPath = resolve(dir, 'memories.db');

    // Dynamic import better-sqlite3
    try {
      const Database = require('better-sqlite3');
      this.db = new Database(dbPath);
      this.initSchema();
      log(`Local DB: ${dbPath}`);
    } catch (e: any) {
      throw new Error(
        `Local mode requires better-sqlite3. Install it:\n` +
        `  npm install better-sqlite3\n\n` +
        `Or use cloud mode: CLUDE_MODE=cloud npx @clude/mcp`
      );
    }
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_type TEXT NOT NULL,
        content TEXT NOT NULL,
        summary TEXT NOT NULL,
        tags TEXT DEFAULT '[]',
        importance REAL DEFAULT 0.5,
        decay_factor REAL DEFAULT 1.0,
        access_count INTEGER DEFAULT 0,
        source TEXT DEFAULT 'mcp',
        created_at TEXT DEFAULT (datetime('now')),
        last_accessed TEXT DEFAULT (datetime('now')),
        embedding BLOB
      );
    `);
  }

  async store(opts: {
    content: string; summary: string; type: MemoryType;
    tags?: string[]; importance?: number; source?: string;
  }): Promise<{ id: string }> {
    const stmt = this.db.prepare(`
      INSERT INTO memories (memory_type, content, summary, tags, importance, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      opts.type, opts.content, opts.summary,
      JSON.stringify(opts.tags || []),
      opts.importance ?? 0.5,
      opts.source || 'mcp',
    );
    return { id: String(result.lastInsertRowid) };
  }

  async recall(opts: {
    query?: string; types?: MemoryType[]; tags?: string[]; limit?: number;
  }): Promise<Memory[]> {
    const limit = opts.limit || 5;
    let sql = 'SELECT * FROM memories WHERE decay_factor > 0.1';
    const params: any[] = [];

    if (opts.types?.length) {
      sql += ` AND memory_type IN (${opts.types.map(() => '?').join(',')})`;
      params.push(...opts.types);
    }

    if (opts.query) {
      // Simple keyword match on summary + content
      const keywords = opts.query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      if (keywords.length > 0) {
        const conditions = keywords.map(() => '(LOWER(summary) LIKE ? OR LOWER(content) LIKE ?)');
        sql += ` AND (${conditions.join(' OR ')})`;
        for (const kw of keywords) {
          params.push(`%${kw}%`, `%${kw}%`);
        }
      }
    }

    sql += ' ORDER BY importance DESC, datetime(created_at) DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params);
    return rows.map((r: any) => ({
      id: String(r.id),
      memory_type: r.memory_type,
      content: r.content,
      summary: r.summary,
      tags: JSON.parse(r.tags || '[]'),
      importance: r.importance,
      decay_factor: r.decay_factor,
      created_at: r.created_at,
      last_accessed: r.last_accessed,
      access_count: r.access_count,
      source: r.source,
      metadata: {},
    }));
  }

  async forget(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(parseInt(id, 10));
    return result.changes > 0;
  }

  async stats(): Promise<{ total: number; by_type: Record<string, number> }> {
    const total = this.db.prepare('SELECT COUNT(*) as c FROM memories').get().c;
    const by_type: Record<string, number> = {};
    for (const t of ['episodic', 'semantic', 'procedural', 'self_model']) {
      const row = this.db.prepare('SELECT COUNT(*) as c FROM memories WHERE memory_type = ?').get(t);
      by_type[t] = row.c;
    }
    return { total, by_type };
  }
}

// ── Helpers ──────────────────────────────────────────────────

function env(key: string): string | undefined {
  return process.env[key];
}

function log(msg: string) {
  console.error(`[clude-mcp] ${msg}`);
}

function rowToMemory(row: any): Memory {
  return {
    id: String(row.id),
    memory_type: row.memory_type,
    content: row.content,
    summary: row.summary,
    tags: row.tags || [],
    importance: row.importance ?? 0.5,
    decay_factor: row.decay_factor ?? 1.0,
    created_at: row.created_at,
    last_accessed: row.last_accessed || row.created_at,
    access_count: row.access_count ?? 0,
    source: row.source || '',
    owner_wallet: row.owner_wallet,
    metadata: row.metadata || {},
  };
}

// ── MCP Server ───────────────────────────────────────────────

async function main() {
  const mode = env('CLUDE_MODE') || 'local';

  let store: MemoryStore;
  if (mode === 'cloud') {
    store = new SupabaseStore();
  } else {
    store = new LocalStore();
  }

  log(`Mode: ${store.name}`);

  const server = new McpServer({
    name: 'clude',
    version: '0.1.0',
  });

  // ── Tool: remember ──

  server.tool(
    'remember',
    'Store a memory that persists across conversations. Use for facts, decisions, preferences, procedures, or anything worth remembering.',
    {
      content: z.string().describe('Full memory content'),
      summary: z.string().describe('Short summary for search matching (1-2 sentences)'),
      type: z.enum(['episodic', 'semantic', 'procedural', 'self_model']).default('semantic')
        .describe('episodic=events, semantic=facts/knowledge, procedural=how-to, self_model=about the agent'),
      tags: z.array(z.string()).optional().describe('Tags for filtering'),
      importance: z.number().min(0).max(1).optional().describe('0-1, default 0.5'),
      source: z.string().optional().describe('Where this came from (default: "mcp")'),
    },
    async (args) => {
      const result = await store.store({
        content: args.content,
        summary: args.summary,
        type: args.type as MemoryType,
        tags: args.tags,
        importance: args.importance,
        source: args.source,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ stored: true, id: result.id }),
        }],
      };
    }
  );

  // ── Tool: recall ──

  server.tool(
    'recall',
    'Search memories. Returns the most relevant memories ranked by similarity, importance, and recency.',
    {
      query: z.string().optional().describe('Search query'),
      types: z.array(z.enum(['episodic', 'semantic', 'procedural', 'self_model'])).optional()
        .describe('Filter by memory type'),
      tags: z.array(z.string()).optional().describe('Filter by tags'),
      limit: z.number().min(1).max(20).default(5).describe('Max results'),
    },
    async (args) => {
      const memories = await store.recall({
        query: args.query,
        types: args.types as MemoryType[],
        tags: args.tags,
        limit: args.limit,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: memories.length,
            memories: memories.map(m => ({
              id: m.id,
              type: m.memory_type,
              summary: m.summary,
              content: m.content,
              tags: m.tags,
              importance: m.importance,
              created_at: m.created_at,
            })),
          }, null, 2),
        }],
      };
    }
  );

  // ── Tool: forget ──

  server.tool(
    'forget',
    'Delete a specific memory by ID.',
    {
      id: z.string().describe('Memory ID to delete'),
    },
    async (args) => {
      const deleted = await store.forget(args.id);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ deleted, id: args.id }),
        }],
      };
    }
  );

  // ── Tool: memory_stats ──

  server.tool(
    'memory_stats',
    'Get memory system statistics: total count and breakdown by type.',
    {},
    async () => {
      const s = await store.stats();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(s, null, 2),
        }],
      };
    }
  );

  // ── Start ──

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('Server running on stdio');
}

main().catch((err) => {
  console.error('[clude-mcp] Fatal:', err.message || err);
  process.exit(1);
});
