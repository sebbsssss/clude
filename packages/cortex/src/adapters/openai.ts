// ============================================================
// OpenAI Function Calling Adapter
//
// Wraps @clude/brain as OpenAI-compatible tools.
// Drop into any OpenAI function-calling agent in 3 lines:
//
//   import { cludeTools, handleCludeTool } from '@clude/cortex/adapters/openai'
//
//   const response = await openai.chat.completions.create({
//     model: 'gpt-4',
//     messages,
//     tools: cludeTools,
//   })
//
//   // In your tool handler:
//   const result = await handleCludeTool(toolCall, engine)
// ============================================================

/** OpenAI function definitions for Clude memory operations. */
export const cludeTools = [
  {
    type: 'function' as const,
    function: {
      name: 'clude_remember',
      description: 'Store a memory for later recall. Use when you learn something important about the user, a fact, a preference, or a behavioral pattern.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The memory content to store' },
          type: {
            type: 'string',
            enum: ['episodic', 'semantic', 'procedural', 'self_model'],
            description: 'Memory type: episodic (events), semantic (facts), procedural (how-to), self_model (self-awareness)',
          },
          importance: { type: 'number', description: 'Importance 0.0-1.0 (default 0.5)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for categorization' },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'clude_recall',
      description: 'Recall relevant memories for a query. Use to remember past conversations, user preferences, learned facts, or behavioral patterns.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to recall' },
          limit: { type: 'number', description: 'Max memories to return (default 5)' },
          types: {
            type: 'array',
            items: { type: 'string', enum: ['episodic', 'semantic', 'procedural', 'self_model'] },
            description: 'Filter by memory type',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'clude_forget',
      description: 'Forget a specific memory by ID. Use when asked to delete information.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Memory ID to forget' },
        },
        required: ['id'],
      },
    },
  },
];

/** Tool call argument types */
interface RememberArgs { content: string; type?: string; importance?: number; tags?: string[] }
interface RecallArgs { query: string; limit?: number; types?: string[] }
interface ForgetArgs { id: string }

/**
 * Handle a Clude tool call from OpenAI's function calling.
 * Pass the engine from @clude/brain or @clude/local.
 */
export async function handleCludeTool(
  toolCall: { function: { name: string; arguments: string } },
  engine: {
    store: (opts: any) => Promise<any>;
    recall: (opts: any) => Promise<any[]>;
    forget: (id: string) => Promise<boolean>;
  },
): Promise<string> {
  const { name, arguments: argsStr } = toolCall.function;
  const args = JSON.parse(argsStr);

  switch (name) {
    case 'clude_remember': {
      const { content, type, importance, tags } = args as RememberArgs;
      const mem = await engine.store({
        content,
        type: type ?? 'episodic',
        importance: importance ?? 0.5,
        tags,
        source: 'openai-tool',
      });
      return JSON.stringify({ stored: true, id: mem.id, type: mem.memory_type });
    }

    case 'clude_recall': {
      const { query, limit, types } = args as RecallArgs;
      const memories = await engine.recall({ query, limit: limit ?? 5, types });
      return JSON.stringify(memories.map((m: any) => ({
        id: m.id,
        type: m.memory_type ?? m.type,
        summary: m.summary,
        content: m.content?.slice(0, 500),
        importance: m.importance,
        created_at: m.created_at,
        score: m._score,
      })));
    }

    case 'clude_forget': {
      const { id } = args as ForgetArgs;
      const deleted = await engine.forget(id);
      return JSON.stringify({ deleted, id });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
