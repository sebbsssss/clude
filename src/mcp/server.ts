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

// ── Hosted-mode HTTP helpers ─────────────────────────────────────────

async function cortexFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${CORTEX_HOST_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CORTEX_API_KEY}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Cortex API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
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
    const memory = require('../core/memory');
    _recallMemories = memory.recallMemories;
    _storeMemory = memory.storeMemory;
    _getMemoryStats = memory.getMemoryStats;
  }
}

// ── Server Setup ─────────────────────────────────────────────────────

const server = new McpServer({
  name: 'clude-memory',
  version: '2.0.0',
});

// --- Tool: recall_memories ---
server.tool(
  'recall_memories',
  'Search the memory system. Returns scored memories ranked by relevance, importance, recency, and decay.',
  {
    query: z.string().optional().describe('Text to search against memory summaries'),
    tags: z.array(z.string()).optional().describe('Tags to filter by (matches any)'),
    related_user: z.string().optional().describe('Filter by related user/agent ID'),
    memory_types: z.array(z.enum(['episodic', 'semantic', 'procedural', 'self_model'])).optional()
      .describe('Filter by memory type'),
    limit: z.number().min(1).max(20).optional().describe('Max results (default 5)'),
    min_importance: z.number().min(0).max(1).optional().describe('Minimum importance threshold'),
  },
  async (args) => {
    let memories: MemoryResult[];

    if (isHostedMode) {
      const result = await cortexFetch<{ memories: MemoryResult[] }>('POST', '/api/cortex/recall', {
        query: args.query,
        tags: args.tags,
        memory_types: args.memory_types,
        limit: args.limit,
        min_importance: args.min_importance,
      });
      memories = result.memories;
    } else {
      loadSelfHosted();
      memories = await _recallMemories({
        query: args.query,
        tags: args.tags,
        relatedUser: args.related_user,
        memoryTypes: args.memory_types,
        limit: args.limit,
        minImportance: args.min_importance,
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
  }
);

// --- Tool: store_memory ---
server.tool(
  'store_memory',
  'Store a new memory. Memories persist across conversations and decay over time if not accessed.',
  {
    type: z.enum(['episodic', 'semantic', 'procedural', 'self_model'])
      .describe('Memory type: episodic (events), semantic (knowledge), procedural (behaviors), self_model (self-awareness)'),
    content: z.string().describe('Full memory content (max 5000 chars)'),
    summary: z.string().describe('Short summary for recall matching (max 500 chars)'),
    tags: z.array(z.string()).optional().describe('Tags for filtering'),
    importance: z.number().min(0).max(1).optional().describe('Importance score 0-1 (default 0.5)'),
    emotional_valence: z.number().min(-1).max(1).optional().describe('Emotional tone: -1 (negative) to 1 (positive)'),
    source: z.string().describe('Where this memory came from (e.g. "mcp:agent-name")'),
    related_user: z.string().optional().describe('Associated user or agent ID'),
  },
  async (args) => {
    let memoryId: number | null;

    if (isHostedMode) {
      const result = await cortexFetch<{ stored: boolean; memory_id: number | null }>('POST', '/api/cortex/store', {
        type: args.type,
        content: args.content,
        summary: args.summary,
        tags: args.tags,
        importance: args.importance,
        emotional_valence: args.emotional_valence,
        source: args.source,
      });
      memoryId = result.memory_id;
    } else {
      loadSelfHosted();
      memoryId = await _storeMemory({
        type: args.type,
        content: args.content,
        summary: args.summary,
        tags: args.tags,
        importance: args.importance,
        emotionalValence: args.emotional_valence,
        source: args.source,
        relatedUser: args.related_user,
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
  }
);

// --- Tool: get_memory_stats ---
server.tool(
  'get_memory_stats',
  'Get statistics about the memory system: counts by type, average importance/decay, dream sessions, top tags.',
  {},
  async () => {
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
  }
);

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const mode = isHostedMode ? 'hosted' : 'self-hosted';
  console.error(`[clude-mcp] Server started on stdio (${mode} mode)`);
}

main().catch((err) => {
  console.error('[clude-mcp] Fatal error:', err);
  process.exit(1);
});
