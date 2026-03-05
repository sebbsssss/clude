// ============================================================
// AGENT IDENTITY — Wallet-based identity for AI agents
//
// Every agent is identified by a wallet address.
// Memories are scoped to a wallet. Your wallet is your brain's address.
//
// Flow:
//   1. Agent generates or imports a keypair
//   2. All memories tagged with wallet address
//   3. Export as signed MemoryPacks
//   4. Any agent with the wallet can import and verify
//   5. On-chain: wallet signs memory hash for proof
// ============================================================

import { randomBytes, createHash, createHmac } from 'crypto';

export interface AgentIdentity {
  wallet: string;
  name?: string;
  description?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface AgentProfile extends AgentIdentity {
  /** Number of memories stored */
  memory_count: number;
  /** Memory types breakdown */
  memory_types: Record<string, number>;
  /** Connected agents (wallets this agent has imported from) */
  connections: string[];
  /** On-chain registration */
  solana_nft?: string;
  /** 8004 Agent Registry ID */
  registry_id?: string;
}

/**
 * Generate a deterministic UUID from wallet + content + timestamp.
 * Same inputs always produce the same UUID (idempotent).
 */
export function generateMemoryUUID(wallet: string, content: string, created_at: string): string {
  const hash = createHash('sha256')
    .update(`${wallet}:${content}:${created_at}`)
    .digest('hex');
  return [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join('-');
}

/**
 * Generate a random agent ID (for agents without a wallet).
 */
export function generateAgentId(): string {
  return `agent-${randomBytes(8).toString('hex')}`;
}
