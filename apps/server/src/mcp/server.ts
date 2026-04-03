import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

/**
 * MCP Server — expose Clude's memory and capabilities as tools.
 *
 * Supports two modes:
 * - Hosted: uses CORTEX_API_KEY to call the Cortex HTTP API (no Supabase needed)
 * - Self-hosted: uses direct imports from core/memory (requires Supabase + full env)
 *
 * Run with: npx clude-bot mcp-serve
 */

// ── Mode Detection ───────────────────────────────────────────────────

const CORTEX_API_KEY = process.env.CORTEX_API_KEY || '';
const CORTEX_HOST_URL = process.env.CORTEX_HOST_URL || 'https://clude.io';
const isLocalMode = process.argv.includes('--local') || process.env.CLUDE_LOCAL === 'true';
const isHostedMode = !isLocalMode && !!CORTEX_API_KEY;

const FETCH_TIMEOUT_MS = 30_000;

// ── Hosted-mode HTTP helpers ─────────────────────────────────────────

async function cortexFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${CORTEX_HOST_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CORTEX_API_KEY}`,
      },
      signal: controller.signal,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Cortex API error ${res.status}: ${text}`);
    }
    return await res.json() as T;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Cortex API timeout after ${FETCH_TIMEOUT_MS / 1000}s: ${method} ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Memory interface (common between modes) ──────────────────────────

interface MemoryResult {
  id: number;
  memory_type: string;
  summary: string;
  content: string;
  tags: string[];
  importance: number;
  decay_factor: number;
  created_at: string;
  access_count: number;
}

// ── Self-hosted lazy imports ─────────────────────────────────────────

let _recallMemories: any;
let _storeMemory: any;
let _getMemoryStats: any;
let _evaluateConfidence: any;
let _deleteMemory: any;
let _updateMemory: any;
let _listMemories: any;
let _extractSkill: any;

function loadSelfHosted() {
  if (!_recallMemories) {
    try {
      const memory = require('../memory');
      _recallMemories = memory.recallMemories;
      _storeMemory = memory.storeMemory;
      _getMemoryStats = memory.getMemoryStats;
      _deleteMemory = memory.deleteMemory;
      _updateMemory = memory.updateMemory;
      _listMemories = memory.listMemories;
      try {
        const skillExtraction = require('../core/skill-extraction');
        _extractSkill = skillExtraction.extractSkill;
      } catch {}
      try {
        const confidenceGate = require('../experimental/confidence-gate');
        _evaluateConfidence = confidenceGate.evaluateConfidence;
      } catch {}
    } catch (err) {
      console.error('[clude-mcp] Failed to load memory module:', err);
      throw new Error('Self-hosted mode requires Supabase configuration. Set SUPABASE_URL and SUPABASE_SERVICE_KEY, or use CORTEX_API_KEY for hosted mode.');
    }
  }
}

// ── Server Setup ─────────────────────────────────────────────────────

const server = new McpServer({
  name: 'clude-memory',
  version: '2.7.0',
});

// ── Shared schemas ───────────────────────────────────────────────────

const MEMORY_TYPES = ['episodic', 'semantic', 'procedural', 'self_model', 'introspective'] as const;

// --- Tool: recall_memories ---
server.tool(
  'recall_memories',
  'Search the memory system. Returns scored memories ranked by relevance, importance, recency, and decay.',
  {
    query: z.string().optional().describe('Text to search against memory summaries and content'),
    tags: z.array(z.string()).optional().describe('Tags to filter by (matches any)'),
    related_user: z.string().optional().describe('Filter by related user/agent ID'),
    related_wallet: z.string().optional().describe('Filter by associated Solana wallet address'),
    memory_types: z.array(z.enum(MEMORY_TYPES)).optional()
      .describe('Filter by memory type'),
    limit: z.number().min(1).max(50).optional().describe('Max results (default 5, max 50)'),
    min_importance: z.number().min(0).max(1).optional().describe('Minimum importance threshold'),
    min_decay: z.number().min(0).max(1).optional().describe('Minimum decay factor (filters out faded memories)'),
    track_access: z.boolean().optional().describe('Whether to update access timestamps (default true)'),
    skip_expansion: z.boolean().optional().describe('Skip LLM query expansion for faster recall (saves ~500-800ms)'),
  },
  async (args) => {
    try {
      let memories: MemoryResult[];

      if (isLocalMode) {
        const { localRecall } = require('./local-store');
        memories = localRecall({
          query: args.query,
          tags: args.tags,
          memory_types: args.memory_types,
          limit: args.limit,
          min_importance: args.min_importance,
          min_decay: args.min_decay,
          related_user: args.related_user,
          related_wallet: args.related_wallet,
        }) as any;
      } else if (isHostedMode) {
        const result = await cortexFetch<{ memories: MemoryResult[] }>('POST', '/api/cortex/recall', {
          query: args.query,
          tags: args.tags,
          related_user: args.related_user,
          related_wallet: args.related_wallet,
          memory_types: args.memory_types,
          limit: args.limit,
          min_importance: args.min_importance,
          min_decay: args.min_decay,
          track_access: args.track_access,
          skip_expansion: args.skip_expansion,
        });
        memories = result.memories;
      } else {
        loadSelfHosted();
        memories = await _recallMemories({
          query: args.query,
          tags: args.tags,
          relatedUser: args.related_user,
          relatedWallet: args.related_wallet,
          memoryTypes: args.memory_types,
          limit: args.limit,
          minImportance: args.min_importance,
          minDecay: args.min_decay,
          trackAccess: args.track_access,
          skipExpansion: args.skip_expansion,
        });
      }

      // Evaluate evidence confidence when scores are available
      let confidence: { score: number; sufficient: boolean } | undefined;
      if (_evaluateConfidence && memories.some((m: any) => typeof m._score === 'number')) {
        try {
          const result = _evaluateConfidence(memories);
          confidence = { score: Math.round(result.score * 1000) / 1000, sufficient: result.sufficient };
        } catch {}
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: memories.length,
            ...(confidence ? { confidence } : {}),
            memories: memories.map((m: any) => ({
              id: m.id,
              type: m.memory_type,
              summary: m.summary,
              content: m.content,
              tags: m.tags,
              importance: m.importance,
              decay_factor: m.decay_factor,
              created_at: m.created_at,
              access_count: m.access_count,
              relevance_score: typeof m._score === 'number' ? Math.round(m._score * 1000) / 1000 : undefined,
            })),
          }, null, 2),
        }],
      };
    } catch (err: any) {
      console.error('[clude-mcp] recall_memories error:', err.message);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }],
        isError: true,
      };
    }
  }
);

// --- Tool: store_memory ---
server.tool(
  'store_memory',
  'Store a new memory. Memories persist across conversations and decay over time if not accessed.',
  {
    type: z.enum(MEMORY_TYPES)
      .describe('Memory type: episodic (events), semantic (knowledge), procedural (behaviors), self_model (self-awareness), introspective (journal entries)'),
    content: z.string().max(5000, 'Content cannot exceed 5000 characters')
      .describe('Full memory content'),
    summary: z.string().max(500, 'Summary cannot exceed 500 characters')
      .describe('Short summary for recall matching'),
    tags: z.array(z.string()).optional().describe('Tags for filtering'),
    concepts: z.array(z.string()).optional().describe('Structured concept labels (auto-inferred if omitted)'),
    importance: z.number().min(0).max(1).optional().describe('Importance score 0-1 (default: LLM-scored or 0.5)'),
    emotional_valence: z.number().min(-1).max(1).optional().describe('Emotional tone: -1 (negative) to 1 (positive)'),
    source: z.string().describe('Where this memory came from (e.g. "mcp:agent-name")'),
    source_id: z.string().optional().describe('External ID (e.g. tweet ID, message ID)'),
    related_user: z.string().optional().describe('Associated user or agent ID'),
    related_wallet: z.string().optional().describe('Associated Solana wallet address'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Arbitrary metadata to attach to the memory'),
  },
  async (args) => {
    try {
      let memoryId: number | null;

      if (isLocalMode) {
        const { localStore } = require('./local-store');
        memoryId = localStore({
          type: args.type,
          content: args.content,
          summary: args.summary,
          tags: args.tags,
          concepts: args.concepts,
          importance: args.importance,
          emotional_valence: args.emotional_valence,
          source: args.source,
          source_id: args.source_id,
          related_user: args.related_user,
          related_wallet: args.related_wallet,
          metadata: args.metadata,
        });
      } else if (isHostedMode) {
        const result = await cortexFetch<{ stored: boolean; memory_id: number | null }>('POST', '/api/cortex/store', {
          type: args.type,
          content: args.content,
          summary: args.summary,
          tags: args.tags,
          concepts: args.concepts,
          importance: args.importance,
          emotional_valence: args.emotional_valence,
          source: args.source,
          source_id: args.source_id,
          related_user: args.related_user,
          related_wallet: args.related_wallet,
          metadata: args.metadata,
        });
        memoryId = result.memory_id;
      } else {
        loadSelfHosted();
        memoryId = await _storeMemory({
          type: args.type,
          content: args.content,
          summary: args.summary,
          tags: args.tags,
          concepts: args.concepts,
          importance: args.importance,
          emotionalValence: args.emotional_valence,
          source: args.source,
          sourceId: args.source_id,
          relatedUser: args.related_user,
          relatedWallet: args.related_wallet,
          metadata: args.metadata,
        });
      }

      // Include memory count so Claude can inform the user
      let totalMemories: number | undefined;
      if (isLocalMode && memoryId !== null) {
        try {
          const { localStats: ls } = require('./local-store');
          totalMemories = (ls() as any).total_memories;
        } catch {}
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            stored: memoryId !== null,
            memory_id: memoryId,
            ...(totalMemories !== undefined ? { total_memories: totalMemories } : {}),
          }),
        }],
      };
    } catch (err: any) {
      console.error('[clude-mcp] store_memory error:', err.message);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }],
        isError: true,
      };
    }
  }
);

// --- Tool: get_memory_stats ---
server.tool(
  'get_memory_stats',
  'Get statistics about the memory system: counts by type, average importance/decay, top tags. Use this to check if the memory system is active and what has been stored.',
  {},
  async () => {
    try {
      let stats: unknown;

      if (isLocalMode) {
        const { localStats } = require('./local-store');
        stats = localStats();
      } else if (isHostedMode) {
        stats = await cortexFetch('GET', '/api/cortex/stats');
      } else {
        loadSelfHosted();
        stats = await _getMemoryStats();
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(stats, null, 2),
        }],
      };
    } catch (err: any) {
      console.error('[clude-mcp] get_memory_stats error:', err.message);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }],
        isError: true,
      };
    }
  }
);

// --- Tool: find_clinamen (anomaly retrieval) ---
server.tool(
  'find_clinamen',
  'Find anomalous memories: high importance but low relevance to the given context. Surfaces unexpected lateral connections for creative insight.',
  {
    context: z.string().describe('Current context/topic to find anomalies relative to'),
    limit: z.number().min(1).max(10).optional().describe('Max results (default 3)'),
    memory_types: z.array(z.enum(MEMORY_TYPES)).optional().describe('Filter by memory type'),
    min_importance: z.number().min(0).max(1).optional().describe('Minimum importance (default 0.6)'),
    max_relevance: z.number().min(0).max(1).optional().describe('Maximum relevance similarity (default 0.35)'),
  },
  async (args) => {
    try {
      let memories: any[];

      if (isLocalMode) {
        const { localClinamen } = require('./local-store');
        memories = localClinamen({
          context: args.context,
          limit: args.limit,
          min_importance: args.min_importance,
          max_relevance: args.max_relevance,
          memory_types: args.memory_types,
        });
      } else if (isHostedMode) {
        const result = await cortexFetch<{ memories: any[] }>('POST', '/api/cortex/clinamen', {
          context: args.context,
          limit: args.limit,
          memory_types: args.memory_types,
          min_importance: args.min_importance,
          max_relevance: args.max_relevance,
        });
        memories = result.memories;
      } else {
        loadSelfHosted();
        const { findClinamen } = require('../memory/clinamen');
        memories = await findClinamen({
          context: args.context,
          limit: args.limit,
          memoryTypes: args.memory_types,
          minImportance: args.min_importance,
          maxRelevance: args.max_relevance,
        });
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: memories.length,
            memories: memories.map((m: any) => ({
              id: m.id,
              type: m.memory_type,
              summary: m.summary,
              content: m.content,
              importance: m.importance,
              divergence: m._divergence,
              relevance_sim: m._relevanceSim,
            })),
          }, null, 2),
        }],
      };
    } catch (err: any) {
      console.error('[clude-mcp] find_clinamen error:', err.message);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }],
        isError: true,
      };
    }
  }
);

// --- Tool: delete_memory ---
server.tool(
  'delete_memory',
  'Permanently delete a memory by its numeric ID. Use with caution — this is irreversible.',
  {
    memory_id: z.number().int().positive().describe('Numeric ID of the memory to delete'),
  },
  async (args) => {
    try {
      let deleted: boolean;

      if (isLocalMode) {
        const { localDelete } = require('./local-store');
        deleted = localDelete(args.memory_id);
      } else if (isHostedMode) {
        const result = await cortexFetch<{ deleted: boolean }>('DELETE', `/api/cortex/memories/${args.memory_id}`);
        deleted = result.deleted;
      } else {
        loadSelfHosted();
        deleted = await _deleteMemory(args.memory_id);
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ deleted, memory_id: args.memory_id }),
        }],
      };
    } catch (err: any) {
      console.error('[clude-mcp] delete_memory error:', err.message);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }],
        isError: true,
      };
    }
  }
);

// --- Tool: update_memory ---
server.tool(
  'update_memory',
  'Update fields of an existing memory by its numeric ID. Only provided fields are changed.',
  {
    memory_id: z.number().int().positive().describe('Numeric ID of the memory to update'),
    summary: z.string().max(500).optional().describe('New summary text'),
    content: z.string().max(5000).optional().describe('New full content'),
    tags: z.array(z.string()).optional().describe('Replacement tag list'),
    importance: z.number().min(0).max(1).optional().describe('New importance score 0-1'),
    memory_type: z.enum(MEMORY_TYPES).optional().describe('New memory type'),
  },
  async (args) => {
    try {
      const patches = {
        summary: args.summary,
        content: args.content,
        tags: args.tags,
        importance: args.importance,
        memory_type: args.memory_type,
      };
      let updated: boolean;

      if (isLocalMode) {
        const { localUpdate } = require('./local-store');
        updated = localUpdate(args.memory_id, patches);
      } else if (isHostedMode) {
        const result = await cortexFetch<{ updated: boolean }>('PATCH', `/api/cortex/memories/${args.memory_id}`, patches);
        updated = result.updated;
      } else {
        loadSelfHosted();
        updated = await _updateMemory(args.memory_id, patches);
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ updated, memory_id: args.memory_id }),
        }],
      };
    } catch (err: any) {
      console.error('[clude-mcp] update_memory error:', err.message);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }],
        isError: true,
      };
    }
  }
);

// --- Tool: list_memories ---
server.tool(
  'list_memories',
  'Browse memories without a search query. Paginated, sorted by recency, importance, or last access.',
  {
    page: z.number().int().min(1).optional().describe('Page number (1-based, default 1)'),
    page_size: z.number().int().min(1).max(100).optional().describe('Items per page (default 20, max 100)'),
    memory_type: z.enum(MEMORY_TYPES).optional().describe('Filter by memory type'),
    min_importance: z.number().min(0).max(1).optional().describe('Minimum importance threshold'),
    order: z.enum(['created_at', 'importance', 'last_accessed']).optional()
      .describe('Sort order (default: created_at descending)'),
  },
  async (args) => {
    try {
      let result: { memories: any[]; total: number };

      if (isLocalMode) {
        const { localList } = require('./local-store');
        result = localList({
          page: args.page,
          page_size: args.page_size,
          memory_type: args.memory_type,
          min_importance: args.min_importance,
          order: args.order,
        });
      } else if (isHostedMode) {
        const params = new URLSearchParams();
        if (args.page) params.set('page', String(args.page));
        if (args.page_size) params.set('page_size', String(args.page_size));
        if (args.memory_type) params.set('memory_type', args.memory_type);
        if (args.min_importance !== undefined) params.set('min_importance', String(args.min_importance));
        if (args.order) params.set('order', args.order);
        result = await cortexFetch<{ memories: any[]; total: number }>('GET', `/api/cortex/memories?${params}`);
      } else {
        loadSelfHosted();
        result = await _listMemories({
          page: args.page,
          page_size: args.page_size,
          memory_type: args.memory_type,
          min_importance: args.min_importance,
          order: args.order,
        });
      }

      const pageSize = args.page_size ?? 20;
      const page = args.page ?? 1;
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            total: result.total,
            page,
            page_size: pageSize,
            pages: Math.ceil(result.total / pageSize),
            memories: result.memories.map((m: any) => ({
              id: m.id,
              type: m.memory_type,
              summary: m.summary,
              tags: m.tags,
              importance: m.importance,
              decay_factor: m.decay_factor,
              created_at: m.created_at,
              last_accessed: m.last_accessed,
              access_count: m.access_count,
            })),
          }, null, 2),
        }],
      };
    } catch (err: any) {
      console.error('[clude-mcp] list_memories error:', err.message);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }],
        isError: true,
      };
    }
  }
);

// --- Tool: batch_store_memories ---
server.tool(
  'batch_store_memories',
  'Store up to 50 memories in a single call. Returns an array of results with memory IDs.',
  {
    memories: z.array(z.object({
      type: z.enum(MEMORY_TYPES).describe('Memory type'),
      content: z.string().max(5000).describe('Full memory content'),
      summary: z.string().max(500).describe('Short summary'),
      tags: z.array(z.string()).optional(),
      concepts: z.array(z.string()).optional(),
      importance: z.number().min(0).max(1).optional(),
      emotional_valence: z.number().min(-1).max(1).optional(),
      source: z.string().describe('Origin of this memory'),
      source_id: z.string().optional(),
      related_user: z.string().optional(),
      related_wallet: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })).min(1).max(50).describe('Array of memories to store (max 50)'),
  },
  async (args) => {
    try {
      const results: Array<{ index: number; stored: boolean; memory_id: number | null; error?: string }> = [];

      for (let i = 0; i < args.memories.length; i++) {
        const m = args.memories[i];
        try {
          let memoryId: number | null;

          if (isLocalMode) {
            const { localStore } = require('./local-store');
            memoryId = localStore(m);
          } else if (isHostedMode) {
            const result = await cortexFetch<{ stored: boolean; memory_id: number | null }>('POST', '/api/cortex/store', {
              type: m.type,
              content: m.content,
              summary: m.summary,
              tags: m.tags,
              concepts: m.concepts,
              importance: m.importance,
              emotional_valence: m.emotional_valence,
              source: m.source,
              source_id: m.source_id,
              related_user: m.related_user,
              related_wallet: m.related_wallet,
              metadata: m.metadata,
            });
            memoryId = result.memory_id;
          } else {
            loadSelfHosted();
            memoryId = await _storeMemory({
              type: m.type,
              content: m.content,
              summary: m.summary,
              tags: m.tags,
              concepts: m.concepts,
              importance: m.importance,
              emotionalValence: m.emotional_valence,
              source: m.source,
              sourceId: m.source_id,
              relatedUser: m.related_user,
              relatedWallet: m.related_wallet,
              metadata: m.metadata,
            });
          }

          results.push({ index: i, stored: memoryId !== null, memory_id: memoryId });
        } catch (err: any) {
          results.push({ index: i, stored: false, memory_id: null, error: err.message });
        }
      }

      const storedCount = results.filter(r => r.stored).length;
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            total: args.memories.length,
            stored: storedCount,
            failed: args.memories.length - storedCount,
            results,
          }, null, 2),
        }],
      };
    } catch (err: any) {
      console.error('[clude-mcp] batch_store_memories error:', err.message);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }],
        isError: true,
      };
    }
  }
);

// --- Prompt: clude-memory-instructions ---
server.prompt(
  'clude-memory-instructions',
  'Usage instructions for the Clude persistent memory system. Auto-injected by MCP clients that support prompts.',
  () => ({
    messages: [{
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: [
          'You have persistent memory via the clude-memory MCP server.',
          '',
          'At the start of every session, call `recall_memories` with relevant context before responding.',
          '',
          'During sessions, call `store_memory` when you learn:',
          '- User name, preferences, working style',
          '- Project decisions and reasoning',
          '- Technical choices and why they were made',
          '- Anything the user asks you to remember',
          '',
          'Use Clude memory INSTEAD of writing to MEMORY.md files.',
        ].join('\n'),
      },
    }],
  })
);

// --- Tool: extract_skill ---
server.tool(
  'extract_skill',
  'Extract domain-specific knowledge from memory into a shareable skills document. Performs multi-pass extraction across the memory bank and entity graph, then synthesizes results into a structured markdown document.',
  {
    domain: z.string().describe('Domain or topic to extract (e.g., "DeFi", "React", "Solana development")'),
    depth: z.enum(['shallow', 'deep']).optional()
      .describe('shallow = seed memories only, deep = graph expansion via entity relations (default: deep)'),
    include_provenance: z.boolean().optional()
      .describe('Include source memory IDs for traceability (default: false)'),
    max_memories: z.number().min(10).max(500).optional()
      .describe('Max memories to include in extraction (default: 200)'),
  },
  async (args) => {
    try {
      if (isLocalMode) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'extract_skill is not available in local mode — requires Supabase for entity graph and embeddings.' }) }],
          isError: true,
        };
      }

      if (isHostedMode) {
        // Hosted mode: call Cortex API
        const result = await cortexFetch<{ markdown: string; stats: any; warning?: string }>('POST', '/api/cortex/extract-skill', {
          domain: args.domain,
          depth: args.depth,
          include_provenance: args.include_provenance,
          max_memories: args.max_memories,
        });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              markdown: result.markdown,
              stats: result.stats,
              warning: result.warning,
            }, null, 2),
          }],
        };
      }

      // Self-hosted mode: direct extraction
      loadSelfHosted();
      if (!_extractSkill) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Skill extraction module not available. Check that src/core/skill-extraction.ts is built.' }) }],
          isError: true,
        };
      }

      const result = await _extractSkill({
        domain: args.domain,
        depth: args.depth || 'deep',
        includeProvenance: args.include_provenance || false,
        maxMemories: args.max_memories || 200,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            markdown: result.markdown,
            stats: result.stats,
            warning: result.warning,
          }, null, 2),
        }],
      };
    } catch (err: any) {
      console.error('[clude-mcp] extract_skill error:', err.message);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }],
        isError: true,
      };
    }
  }
);

// --- Start ---
async function main() {
  // Validate configuration
  if (isLocalMode) {
    console.error('[clude-mcp] Local mode — memories stored in ~/.clude/memories.json');
    console.error('[clude-mcp] No API keys required. Fully offline.');
  } else if (isHostedMode) {
    if (CORTEX_API_KEY.length < 10) {
      console.error('[clude-mcp] Warning: CORTEX_API_KEY looks invalid (too short)');
    }
    console.error(`[clude-mcp] Hosted mode — API: ${CORTEX_HOST_URL}`);
  } else {
    const hasSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
    if (!hasSupabase) {
      console.error('[clude-mcp] Warning: No CORTEX_API_KEY or Supabase config found. Tools will fail.');
      console.error('[clude-mcp] Set CORTEX_API_KEY for hosted mode, or SUPABASE_URL + SUPABASE_SERVICE_KEY for self-hosted.');
    } else {
      // Initialize database schema and set owner wallet scope
      try {
        const { initDatabase } = require('../core/database');
        await initDatabase();
        console.error('[clude-mcp] Database initialized');
      } catch (err: any) {
        console.error('[clude-mcp] Database init warning:', err.message);
      }
      if (process.env.OWNER_WALLET) {
        try {
          const { _setOwnerWallet } = require('../memory');
          _setOwnerWallet(process.env.OWNER_WALLET);
          console.error('[clude-mcp] Owner wallet scoped to:', process.env.OWNER_WALLET.slice(0, 8) + '...');
        } catch (err: any) {
          console.error('[clude-mcp] Owner wallet setup warning:', err.message);
        }
      }
    }
    console.error('[clude-mcp] Self-hosted mode — direct database access');
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[clude-mcp] Server started on stdio`);
}

main().catch((err) => {
  console.error('[clude-mcp] Fatal error:', err);
  process.exit(1);
});
