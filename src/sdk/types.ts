import type { MemoryType, Memory, MemorySummary, StoreMemoryOptions, RecallOptions, MemoryStats } from '../core/memory';
import type { MemoryLinkType, MemoryConcept } from '../utils/constants';

export interface CortexConfig {
  /** Supabase connection. Required. */
  supabase: {
    url: string;
    serviceKey: string;
  };

  /** Anthropic API config. Required for dream cycles and LLM importance scoring. */
  anthropic?: {
    apiKey: string;
    model?: string;
  };

  /** Embedding provider config. Optional — falls back to keyword-only retrieval. */
  embedding?: {
    provider: 'voyage' | 'openai';
    apiKey: string;
    model?: string;
    dimensions?: number;
  };

  /** Owner wallet address (Solana public key). Tags all memories with ownership. */
  ownerWallet?: string;

  /** Solana on-chain commit config. Optional — memories won't be committed on-chain. */
  solana?: {
    rpcUrl?: string;
    botWalletPrivateKey?: string;
    /** Program ID for the on-chain memory registry (Anchor program). Optional — falls back to memo writes. */
    memoryRegistryProgramId?: string;
  };

  /** Client-side encryption config. Optional — memories stored plaintext if not provided. */
  encryption?: {
    /** User's 64-byte Ed25519 secret key (Solana keypair). Used to derive encryption key via HKDF. */
    solanaSecretKey: Uint8Array;
  };
}

export interface DreamOptions {
  /** Custom handler for emergence output (replaces posting to X). */
  onEmergence?: (text: string) => Promise<void>;
}

// Re-export all public types
export type {
  MemoryType,
  Memory,
  MemorySummary,
  StoreMemoryOptions,
  RecallOptions,
  MemoryStats,
  MemoryLinkType,
  MemoryConcept,
};
