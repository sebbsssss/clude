/**
 * LangChain memory adapter for PMP.
 *
 * Designed to be **dependency-free of LangChain itself** — uses duck-typing so
 * it slots into any LangChain version (or any framework that follows
 * conventional method names like `getRelevantDocuments` / `addDocuments`).
 *
 * Usage:
 *
 *   import { PmpClient } from '@pmp/sdk';
 *   import { PmpMemoryStore } from '@pmp/sdk/langchain';
 *
 *   const client = new PmpClient({ baseUrl: 'https://api.pmp.dev', auth: {...} });
 *   const memory = new PmpMemoryStore(client, { defaultType: 'episodic' });
 *
 *   // Retrieval-augmented prompt construction
 *   const docs = await memory.getRelevantDocuments('what did we decide about pricing?');
 *
 *   // Persist a new memory mid-conversation
 *   await memory.addDocuments([{
 *     pageContent: 'We landed on per-token pricing for Q3.',
 *     metadata: { tags: ['pricing', 'q3'], importance: 0.8 }
 *   }]);
 *
 * The shape `{ pageContent, metadata }` matches LangChain's `Document` interface
 * by convention. No import or instanceof check is performed.
 */

import type { PmpClient } from '../client';
import type { Memory, MemoryType } from '../types';

/** LangChain-compatible Document shape. */
export interface LangChainDocument {
  pageContent: string;
  metadata: Record<string, unknown>;
}

export interface PmpMemoryStoreOptions {
  /** Memory type used when adding documents without an explicit type. */
  defaultType?: MemoryType;
  /** Default source label for contributed memories. */
  defaultSource?: string;
  /** Cap on how many docs `getRelevantDocuments` fetches per call. */
  k?: number;
}

export class PmpMemoryStore {
  private readonly defaultType: MemoryType;
  private readonly defaultSource: string;
  private readonly k: number;

  constructor(
    private readonly client: PmpClient,
    opts: PmpMemoryStoreOptions = {},
  ) {
    this.defaultType = opts.defaultType ?? 'episodic';
    this.defaultSource = opts.defaultSource ?? 'langchain';
    this.k = opts.k ?? 8;
  }

  /**
   * LangChain BaseRetriever-shaped: given a query string, return the top-k
   * relevant memories as LangChain Documents.
   */
  async getRelevantDocuments(query: string): Promise<LangChainDocument[]> {
    const res = await this.client.discover({ query, limit: this.k });
    return res.memories.map(memoryToDocument);
  }

  /**
   * LangChain VectorStore-shaped: persist documents. Each document's
   * `metadata.tags`, `metadata.type`, `metadata.importance`, `metadata.source`
   * are honoured if present.
   */
  async addDocuments(docs: LangChainDocument[]): Promise<string[]> {
    const ids: string[] = [];
    for (const doc of docs) {
      const meta = doc.metadata ?? {};
      const tags = Array.isArray(meta.tags) ? (meta.tags as string[]) : undefined;
      const type = isMemoryType(meta.type) ? (meta.type as MemoryType) : this.defaultType;
      const importance = typeof meta.importance === 'number' ? (meta.importance as number) : undefined;
      const source = typeof meta.source === 'string' ? (meta.source as string) : this.defaultSource;

      const result = await this.client.contribute({
        content: doc.pageContent,
        type,
        tags,
        importance,
        source,
      });
      ids.push(result.id);
    }
    return ids;
  }

  /** Convenience for non-LangChain consumers. */
  async addMemory(content: string, opts: { type?: MemoryType; tags?: string[]; importance?: number; source?: string } = {}): Promise<string> {
    const result = await this.client.contribute({
      content,
      type: opts.type ?? this.defaultType,
      tags: opts.tags,
      importance: opts.importance,
      source: opts.source ?? this.defaultSource,
    });
    return result.id;
  }

  /** Convenience for non-LangChain consumers. */
  async getMemory(id: string): Promise<Memory> {
    return this.client.retrieve(id);
  }
}

function memoryToDocument(m: Memory): LangChainDocument {
  return {
    pageContent: m.content,
    metadata: {
      id: m.id,
      type: m.type,
      owner: m.owner,
      created_at: m.created_at,
      tags: m.tags,
      // Surface the attestation in metadata so downstream tools can render
      // "verified" badges or click through to the verifier URL.
      attestation: m.attestation,
    },
  };
}

const MEMORY_TYPES = new Set<MemoryType>([
  'episodic',
  'semantic',
  'procedural',
  'self_model',
  'introspective',
]);

function isMemoryType(v: unknown): v is MemoryType {
  return typeof v === 'string' && MEMORY_TYPES.has(v as MemoryType);
}
