/**
 * Agent tools — Anthropic tool_use definitions + executors.
 *
 * Each tool wraps existing infrastructure (X client, memory, price oracle).
 * Tools are defined in Anthropic SDK format and executed within the
 * TaskExecutor's tool_use loop.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { postTweet, postThread } from '../core/x-client';
import { recallMemorySummaries, storeMemory } from '../core/memory';
import { getPriceState, getCurrentMood } from '../core/price-oracle';
import { getDb } from '../core/database';
import { createChildLogger } from '../core/logger';

const log = createChildLogger('agent-tools');

// ── Context passed to every tool execution ──

export interface ToolContext {
  taskId: string;
  agentId: string;
  agentName: string;
}

export interface ToolResult {
  success: boolean;
  output: string;
  /** If true, the tool_use loop should stop (complete_task was called). */
  terminate?: boolean;
  /** Optional data to store in task metadata (e.g., tweet IDs). */
  data?: Record<string, unknown>;
}

// ── Tool definitions (Anthropic SDK format) ──

interface ToolDef {
  schema: Anthropic.Tool;
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

const TOOL_REGISTRY: Record<string, ToolDef> = {
  post_tweet: {
    schema: {
      name: 'post_tweet',
      description: 'Post a single tweet to X/Twitter. Returns the tweet ID on success. Max 4000 characters (X Premium).',
      input_schema: {
        type: 'object' as const,
        properties: {
          text: { type: 'string', description: 'The tweet text to post (max 4000 chars).' },
        },
        required: ['text'],
      },
    },
    execute: async (input, ctx) => {
      const text = String(input.text).slice(0, 4000);
      try {
        const tweetId = await postTweet(text);
        log.info({ taskId: ctx.taskId, tweetId }, 'Agent posted tweet');
        return { success: true, output: `Tweet posted. ID: ${tweetId}`, data: { tweet_id: tweetId } };
      } catch (err: any) {
        return { success: false, output: `Failed to post tweet: ${err.message}` };
      }
    },
  },

  post_thread: {
    schema: {
      name: 'post_thread',
      description: 'Post a multi-tweet thread to X/Twitter. Returns an array of tweet IDs. Min 2, max 10 tweets.',
      input_schema: {
        type: 'object' as const,
        properties: {
          tweets: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of tweet texts for the thread (2-10 tweets).',
          },
        },
        required: ['tweets'],
      },
    },
    execute: async (input, ctx) => {
      const tweets = (input.tweets as string[]).slice(0, 10).map(t => String(t).slice(0, 4000));
      if (tweets.length < 2) return { success: false, output: 'Thread needs at least 2 tweets.' };
      try {
        const ids = await postThread(tweets);
        log.info({ taskId: ctx.taskId, threadLength: ids.length }, 'Agent posted thread');
        return { success: true, output: `Thread posted (${ids.length} tweets). IDs: ${ids.join(', ')}`, data: { tweet_ids: ids } };
      } catch (err: any) {
        return { success: false, output: `Failed to post thread: ${err.message}` };
      }
    },
  },

  recall_memories: {
    schema: {
      name: 'recall_memories',
      description: 'Search Clude\'s memory system for relevant information. Returns memory summaries (id, type, summary, importance, created_at). Use specific, descriptive queries for best results.',
      input_schema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search query — be specific and descriptive.' },
          types: {
            type: 'array',
            items: { type: 'string', enum: ['episodic', 'semantic', 'procedural', 'self_model'] },
            description: 'Optional: filter by memory type(s).',
          },
          limit: { type: 'number', description: 'Max results (1-10, default 5).' },
        },
        required: ['query'],
      },
    },
    execute: async (input, _ctx) => {
      try {
        const summaries = await recallMemorySummaries({
          query: String(input.query),
          memoryTypes: input.types as any,
          limit: Math.min(Number(input.limit) || 5, 10),
        });
        if (!summaries.length) return { success: true, output: 'No memories found for that query.' };
        const formatted = summaries.map(m =>
          `[#${m.id}] (${m.memory_type}) ${m.summary} | importance: ${m.importance?.toFixed(2)} | ${new Date(m.created_at).toISOString().slice(0, 10)}`
        ).join('\n');
        return { success: true, output: `Found ${summaries.length} memories:\n${formatted}` };
      } catch (err: any) {
        return { success: false, output: `Memory recall failed: ${err.message}` };
      }
    },
  },

  store_finding: {
    schema: {
      name: 'store_finding',
      description: 'Store a finding or insight as a memory in Clude\'s memory system. Use this to persist important discoveries, decisions, or analysis results.',
      input_schema: {
        type: 'object' as const,
        properties: {
          content: { type: 'string', description: 'Full content of the finding (max 2000 chars).' },
          summary: { type: 'string', description: 'One-line summary (max 200 chars).' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tags for categorization.',
          },
          memory_type: {
            type: 'string',
            enum: ['semantic', 'procedural'],
            description: 'Type: semantic (facts/knowledge) or procedural (strategies/how-to). Default: semantic.',
          },
        },
        required: ['content', 'summary'],
      },
    },
    execute: async (input, ctx) => {
      try {
        const memoryId = await storeMemory({
          type: (input.memory_type as 'semantic' | 'procedural') || 'semantic',
          content: String(input.content).slice(0, 2000),
          summary: String(input.summary).slice(0, 200),
          tags: Array.isArray(input.tags) ? (input.tags as string[]).slice(0, 10) : [],
          source: `agent-task:${ctx.taskId}`,
          sourceId: ctx.taskId,
          importance: 0.6,
          metadata: { agent_id: ctx.agentId, agent_name: ctx.agentName },
        });
        if (memoryId) {
          return { success: true, output: `Finding stored as memory #${memoryId}.`, data: { memory_id: memoryId } };
        }
        return { success: false, output: 'Failed to store finding (returned null).' };
      } catch (err: any) {
        return { success: false, output: `Store finding failed: ${err.message}` };
      }
    },
  },

  get_market_data: {
    schema: {
      name: 'get_market_data',
      description: 'Get current $CLUDE market data: price, 24h change, mood. No parameters needed.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    execute: async () => {
      try {
        const state = getPriceState();
        const mood = getCurrentMood();
        if (!state || !state.currentPrice) {
          return { success: true, output: 'Market data not available (price oracle may not have data yet).' };
        }
        const lines = [
          `Price: $${state.currentPrice.toFixed(6)}`,
          `1h change: ${(state.change1h * 100).toFixed(2)}%`,
          `24h change: ${(state.change24h * 100).toFixed(2)}%`,
          `Mood: ${mood}`,
          `Last update: ${state.lastUpdate?.toISOString() || 'unknown'}`,
        ];
        return { success: true, output: lines.join('\n') };
      } catch (err: any) {
        return { success: true, output: 'Market data unavailable.' };
      }
    },
  },

  log_progress: {
    schema: {
      name: 'log_progress',
      description: 'Log a progress update visible in the dashboard activity feed. Use this to report status during longer tasks.',
      input_schema: {
        type: 'object' as const,
        properties: {
          message: { type: 'string', description: 'Status message (max 500 chars).' },
        },
        required: ['message'],
      },
    },
    execute: async (input, ctx) => {
      try {
        const db = getDb();
        await db.from('dashboard_activity').insert({
          agent_id: ctx.agentId,
          action: 'task_progress',
          details: { task_id: ctx.taskId, message: String(input.message).slice(0, 500) },
        });
        return { success: true, output: 'Progress logged.' };
      } catch (err: any) {
        return { success: false, output: `Log failed: ${err.message}` };
      }
    },
  },

  complete_task: {
    schema: {
      name: 'complete_task',
      description: 'Mark the task as completed with a result. You MUST call this when you are done. Provide a clear result and a short summary.',
      input_schema: {
        type: 'object' as const,
        properties: {
          result: { type: 'string', description: 'The full result/output of the task.' },
          summary: { type: 'string', description: 'One-line summary of what was accomplished (max 500 chars).' },
        },
        required: ['result', 'summary'],
      },
    },
    execute: async (input) => {
      return {
        success: true,
        output: 'Task completed.',
        terminate: true,
        data: {
          result: String(input.result),
          summary: String(input.summary).slice(0, 500),
        },
      };
    },
  },
};

// ── Public API ──

/**
 * Get Anthropic tool schemas for a given set of tool names.
 */
export function getToolSchemas(allowedTools: string[]): Anthropic.Tool[] {
  return allowedTools
    .filter(name => TOOL_REGISTRY[name])
    .map(name => TOOL_REGISTRY[name].schema);
}

/**
 * Execute a tool by name with the given input and context.
 * Returns a ToolResult. Never throws — errors are wrapped in the result.
 */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = TOOL_REGISTRY[toolName];
  if (!tool) {
    return { success: false, output: `Unknown tool: ${toolName}` };
  }
  try {
    return await tool.execute(input, ctx);
  } catch (err: any) {
    log.error({ err, toolName, taskId: ctx.taskId }, 'Tool execution error');
    return { success: false, output: `Tool ${toolName} crashed: ${err.message}` };
  }
}
