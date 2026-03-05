/**
 * Wallet-based identity for portable memory.
 * 
 * Every agent is identified by a wallet address (Solana public key).
 * Memories are scoped to a wallet — your wallet is your brain's address.
 * 
 * Flow:
 *   1. Agent generates or imports a keypair
 *   2. All memories are tagged with the wallet address
 *   3. Memories can be exported as signed MemoryPacks
 *   4. Any new agent with the same wallet can import and verify
 *   5. On-chain: wallet signs a hash of the memory pack for proof
 */

import { randomBytes, createHash, createHmac } from 'crypto';

export interface AgentIdentity {
  /** Wallet address (Solana base58 public key or any unique identifier) */
  wallet: string;
  /** Display name (optional) */
  name?: string;
  /** When this identity was created */
  created_at: string;
  /** Agent metadata */
  metadata?: Record<string, string>;
}

export interface MemoryPack {
  /** Format version */
  version: 1;
  /** The wallet that owns these memories */
  wallet: string;
  /** Agent identity snapshot */
  identity: AgentIdentity;
  /** Memories in this pack */
  memories: PortableMemory[];
  /** Entity connections */
  connections: Connection[];
  /** Pack metadata */
  meta: {
    exported_at: string;
    memory_count: number;
    connection_count: number;
    /** SHA-256 hash of sorted memories JSON (for integrity verification) */
    content_hash: string;
    /** Optional: HMAC signature using wallet's secret (proves ownership) */
    signature?: string;
  };
}

export interface PortableMemory {
  /** Stable UUID (survives export/import) */
  uuid: string;
  content: string;
  summary: string;
  type: 'episodic' | 'semantic' | 'procedural' | 'self_model';
  importance: number;
  tags: string[];
  created_at: string;
  access_count: number;
  decay_factor: number;
  /** Source agent wallet */
  source_wallet: string;
  /** Original local ID (not portable, for reference only) */
  _local_id?: number;
}

export interface Connection {
  /** UUID of source memory */
  from_uuid: string;
  /** UUID of target memory */
  to_uuid: string;
  /** Relationship type */
  type: ConnectionType;
  /** Strength 0.0-1.0 */
  strength: number;
  /** When this connection was created */
  created_at: string;
}

export type ConnectionType = 
  | 'supports'      // memory A supports/reinforces memory B
  | 'contradicts'   // memory A conflicts with memory B
  | 'elaborates'    // memory A adds detail to memory B
  | 'causes'        // memory A led to memory B
  | 'follows'       // memory A happened after memory B (temporal)
  | 'co_mentioned'  // entities in A also appear in B
  | 'derived'       // memory B was consolidated from memory A
  | 'similar';      // semantically close

/**
 * Generate a stable UUID for a memory (deterministic from content + wallet + timestamp).
 */
export function generateMemoryUUID(wallet: string, content: string, created_at: string): string {
  const hash = createHash('sha256')
    .update(`${wallet}:${content}:${created_at}`)
    .digest('hex');
  // Format as UUID v5-style
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join('-');
}

/**
 * Compute content hash for a memory pack (integrity check).
 */
export function computeContentHash(memories: PortableMemory[]): string {
  const sorted = [...memories].sort((a, b) => a.uuid.localeCompare(b.uuid));
  const json = JSON.stringify(sorted.map(m => ({
    uuid: m.uuid,
    content: m.content,
    type: m.type,
    source_wallet: m.source_wallet,
  })));
  return createHash('sha256').update(json).digest('hex');
}

/**
 * Sign a memory pack with a secret (proves the wallet owner created it).
 * In production this would use Solana keypair signing.
 * For local-first, we use HMAC-SHA256 with a user-provided secret.
 */
export function signPack(contentHash: string, secret: string): string {
  return createHmac('sha256', secret).update(contentHash).digest('hex');
}

/**
 * Verify a memory pack signature.
 */
export function verifyPackSignature(pack: MemoryPack, secret: string): boolean {
  if (!pack.meta.signature) return false;
  const expected = signPack(pack.meta.content_hash, secret);
  return expected === pack.meta.signature;
}

/**
 * Verify content integrity of a memory pack (no tampering).
 */
export function verifyPackIntegrity(pack: MemoryPack): boolean {
  const computed = computeContentHash(pack.memories);
  return computed === pack.meta.content_hash;
}
