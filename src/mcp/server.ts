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
const CORTEX_HOST_URL = process.env.CORTEX_HOST_URL || 'https://cluude.ai';
const isHostedMode = !!CORTEX_API_KEY;

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

function loadSelfHosted() {
  if (!_recallMemories) {
    try {
      const memory = require('../core/memory');
      _recallMemories = memory.recallMemories;
      _storeMemory = memory.storeMemory;
      _getMemoryStats = memory.getMemoryStats;
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

      if (isHostedMode) {
        const result = await cortexFetch<{ memories: MemoryResult[] }>('POST', '/api/cortex/recall', {
          query: args.query,
          tags: args.tags,
          related_user: args.related_user,
          related_wallet: args.related_wallet,
          memory_types: args.memory_types,
          limit: args.limit,
          min_importance: args.min_importance,
          min_decay: args.min_decay,
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
              decay_factor: m.decay_factor,
              created_at: m.created_at,
              access_count: m.access_count,
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

      if (isHostedMode) {
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

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            stored: memoryId !== null,
            memory_id: memoryId,
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
  'Get statistics about the memory system: counts by type, average importance/decay, dream sessions, top tags.',
  {},
  async () => {
    try {
      let stats: unknown;

      if (isHostedMode) {
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

      if (isHostedMode) {
        const result = await cortexFetch<{ memories: any[] }>('POST', '/api/cortex/clinamen', {
          context: args.context,
          limit: args.limit,
          memory_types: args.memory_types,
          min_importance: args.min_importance,
          max_relevance: args.max_relevance,
        });
        memories = result.memories;
      } else {
        const { findClinamen } = require('../features/clinamen');
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

// --- Start ---
async function main() {
  // Validate configuration
  if (isHostedMode) {
    if (CORTEX_API_KEY.length < 10) {
      console.error('[clude-mcp] Warning: CORTEX_API_KEY looks invalid (too short)');
    }
    console.error(`[clude-mcp] Hosted mode — API: ${CORTEX_HOST_URL}`);
  } else {
    const hasSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
    if (!hasSupabase) {
      console.error('[clude-mcp] Warning: No CORTEX_API_KEY or Supabase config found. Tools will fail.');
      console.error('[clude-mcp] Set CORTEX_API_KEY for hosted mode, or SUPABASE_URL + SUPABASE_SERVICE_KEY for self-hosted.');
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
