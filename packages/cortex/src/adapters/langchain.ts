// ============================================================
// LangChain/LangGraph Memory Adapter
//
// Wraps @clude/brain as a LangChain-compatible memory class.
//
//   import { CludeMemory } from '@clude/cortex/adapters/langchain'
//
//   const memory = new CludeMemory(engine)
//   const chain = new ConversationChain({ llm, memory })
// ============================================================

/**
 * LangChain-compatible memory wrapper for Clude.
 * Implements the BaseMemory interface pattern.
 */
export class CludeMemory {
  private engine: {
    store: (opts: any) => Promise<any>;
    recall: (opts: any) => Promise<any[]>;
  };
  private memoryKey: string;
  private returnMessages: boolean;

  constructor(
    engine: { store: (opts: any) => Promise<any>; recall: (opts: any) => Promise<any[]> },
    opts?: { memoryKey?: string; returnMessages?: boolean },
  ) {
    this.engine = engine;
    this.memoryKey = opts?.memoryKey ?? 'history';
    this.returnMessages = opts?.returnMessages ?? false;
  }

  get memoryKeys(): string[] {
    return [this.memoryKey];
  }

  /**
   * Load relevant memories for the current input.
   * Called automatically by LangChain before each LLM call.
   */
  async loadMemoryVariables(inputs: Record<string, string>): Promise<Record<string, string>> {
    const query = inputs.input || inputs.question || Object.values(inputs)[0] || '';
    if (!query) return { [this.memoryKey]: '' };

    const memories = await this.engine.recall({ query, limit: 5 });

    if (this.returnMessages) {
      // Return as message objects (for chat models)
      const messages = memories.map((m: any) => ({
        role: 'system' as const,
        content: `[Memory: ${m.memory_type ?? m.type}] ${m.summary || m.content}`,
      }));
      return { [this.memoryKey]: JSON.stringify(messages) };
    }

    // Return as formatted string
    const formatted = memories
      .map((m: any) => `- [${m.memory_type ?? m.type}] ${m.summary || m.content}`)
      .join('\n');

    return { [this.memoryKey]: formatted || 'No relevant memories found.' };
  }

  /**
   * Save context from this interaction.
   * Called automatically by LangChain after each LLM response.
   */
  async saveContext(
    inputs: Record<string, string>,
    outputs: Record<string, string>,
  ): Promise<void> {
    const input = inputs.input || inputs.question || Object.values(inputs)[0] || '';
    const output = outputs.output || outputs.response || Object.values(outputs)[0] || '';

    if (input && output) {
      await this.engine.store({
        content: `User: ${input}\nAssistant: ${output}`,
        summary: input.slice(0, 200),
        type: 'episodic',
        importance: 0.5,
        source: 'langchain',
      });
    }
  }

  /**
   * Clear all memories.
   */
  async clear(): Promise<void> {
    // Clude doesn't support mass deletion through the engine
    // Use the storage provider directly if needed
  }
}

/**
 * LangGraph-compatible memory saver.
 * Persists graph state checkpoints as procedural memories.
 */
export class CludeCheckpointer {
  private engine: {
    store: (opts: any) => Promise<any>;
    recall: (opts: any) => Promise<any[]>;
  };

  constructor(engine: { store: (opts: any) => Promise<any>; recall: (opts: any) => Promise<any[]> }) {
    this.engine = engine;
  }

  /**
   * Save a graph checkpoint as a procedural memory.
   */
  async put(threadId: string, checkpoint: Record<string, unknown>): Promise<void> {
    await this.engine.store({
      content: JSON.stringify(checkpoint),
      summary: `Graph checkpoint for thread ${threadId}`,
      type: 'procedural',
      importance: 0.3,
      source: 'langgraph-checkpoint',
      tags: ['checkpoint', `thread:${threadId}`],
    });
  }

  /**
   * Load the latest checkpoint for a thread.
   */
  async get(threadId: string): Promise<Record<string, unknown> | null> {
    const results = await this.engine.recall({
      query: `Graph checkpoint for thread ${threadId}`,
      types: ['procedural'],
      limit: 1,
      tags: [`thread:${threadId}`],
    });

    if (results.length === 0) return null;
    try {
      return JSON.parse((results[0] as any).content);
    } catch {
      return null;
    }
  }
}
