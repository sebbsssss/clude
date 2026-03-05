/**
 * CLUDE — Persistent memory for AI agents.
 * Local-first, zero config.
 *
 * @example
 * ```typescript
 * import { remember, recall } from 'clude'
 *
 * await remember("User prefers dark mode")
 * const memories = await recall("what theme does the user like?")
 * console.log(memories[0].content) // "User prefers dark mode"
 * ```
 */

import { MemoryStore, type StoreOptions, type RecallOptions, type Memory, type MemoryResult, type MemoryStoreConfig } from './store.js';

export type { Memory, MemoryResult, StoreOptions, RecallOptions, MemoryStoreConfig };
export type { AgentIdentity, MemoryPack, PortableMemory, Connection, ConnectionType } from './identity.js';
export { verifyPackIntegrity, verifyPackSignature } from './identity.js';
export { embed, cosineSim } from './embeddings.js';

// ── Singleton store ──────────────────────────────────────────
let _store: MemoryStore | null = null;
let _defaultConfig: MemoryStoreConfig = {};

/**
 * Initialize the default store with a wallet address.
 * Call this once at startup before using remember/recall.
 * 
 * @example
 * import { init, remember, recall } from 'clude'
 * init({ wallet: '5vK6WRCq...BGv2r', name: 'Clude' })
 */
export function init(config: MemoryStoreConfig): void {
  _defaultConfig = config;
  if (_store) {
    _store.close();
    _store = null;
  }
}

function getStore(): MemoryStore {
  if (!_store) {
    _store = new MemoryStore(_defaultConfig);
  }
  return _store;
}

// ── Simple API ───────────────────────────────────────────────

/**
 * Store a memory. Just pass a string.
 *
 * @example
 * await remember("The API key rotates every 90 days")
 * await remember({ content: "User is a backend engineer", type: "semantic", importance: 0.8 })
 */
export async function remember(input: string | StoreOptions): Promise<Memory> {
  const opts = typeof input === 'string' ? { content: input } : input;
  return getStore().remember(opts);
}

/**
 * Recall relevant memories for a query.
 *
 * @example
 * const memories = await recall("API key rotation")
 * const memories = await recall({ query: "user background", limit: 5, types: ["semantic"] })
 */
export async function recall(input: string | RecallOptions): Promise<MemoryResult[]> {
  const opts = typeof input === 'string' ? { query: input } : input;
  return getStore().recall(opts);
}

/**
 * How many memories are stored.
 */
export function count(): number {
  return getStore().count();
}

/**
 * List recent memories.
 */
export function list(limit = 50): Memory[] {
  return getStore().list(limit);
}

/**
 * Forget a specific memory by ID.
 */
export function forget(id: number): boolean {
  return getStore().forget(id);
}

/**
 * Search memories by keyword (no embeddings, instant).
 */
export function search(keyword: string, limit = 10): Memory[] {
  return getStore().search(keyword, limit);
}

/**
 * Delete all memories.
 */
export function clear(): void {
  getStore().clear();
}

/**
 * Export all memories as JSON.
 */
export function exportAll(): Memory[] {
  return getStore().export();
}

/**
 * Export memories as a portable MemoryPack (JSON, includes connections).
 * The pack is self-contained and can be imported by any Clude agent.
 * 
 * @example
 * const pack = exportPack()
 * fs.writeFileSync('brain.clude.json', JSON.stringify(pack))
 */
export function exportPack(options?: Parameters<MemoryStore['exportPack']>[0]) {
  return getStore().exportPack(options);
}

/**
 * Import a MemoryPack from another agent.
 * Memories are re-embedded locally. Connections are preserved.
 * Duplicates (by UUID) are skipped.
 * 
 * @example
 * const pack = JSON.parse(fs.readFileSync('brain.clude.json', 'utf-8'))
 * const result = await importPack(pack)
 * console.log(`Imported ${result.memories} memories`)
 */
export async function importPack(...args: Parameters<MemoryStore['importPack']>) {
  return getStore().importPack(...args);
}

/**
 * Export as human-readable markdown.
 */
export function exportMarkdown(): string {
  return getStore().exportMarkdown();
}

/**
 * Get the agent's wallet address and identity.
 */
export function identity() {
  return getStore().getIdentity();
}

/**
 * Access the connection graph directly.
 */
export function getConnections() {
  return getStore().connections;
}

/**
 * Pre-warm the model. Optional — call at startup for instant first recall.
 */
export async function warmup(): Promise<void> {
  return getStore().warmup();
}

/**
 * Close the database. Call when done (optional — auto-closes on exit).
 */
export function close(): void {
  if (_store) {
    _store.close();
    _store = null;
  }
}

// ── Advanced: bring your own store ──────────────────────────

/**
 * Create a custom MemoryStore with a specific config.
 *
 * @example
 * const store = createStore({ dbPath: './my-agent/memory.db', wallet: '5vK6...' })
 * await store.remember({ content: "something important" })
 */
export function createStore(config?: string | MemoryStoreConfig): MemoryStore {
  return new MemoryStore(config);
}

export { MemoryStore };
