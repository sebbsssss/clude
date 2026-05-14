/**
 * Wire-format types for PMP v0.1. Mirrors the JSON shapes defined in
 * docs/pmp/spec-v0.1.md. Keep changes additive — breaking changes go to v0.2.
 */

export type MemoryType =
  | 'episodic'
  | 'semantic'
  | 'procedural'
  | 'self_model'
  | 'introspective';

export type ChainId = 'solana' | 'base' | 'fake' | (string & {});

export interface Attestation {
  chain_id: ChainId;
  asset_id: string;
  content_hash: string;
  tx_sig: string;
  tree_address: string | null;
  leaf_index: number | null;
  verifier_url: string;
}

export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  owner: string | null;
  created_at: string;
  tags: string[];
  attestation: Attestation | null;
}

export interface DiscoverResponse {
  count: number;
  memories: Memory[];
  next_cursor?: string | null;
}

export interface DiscoverOptions {
  query?: string;
  owner?: string;
  tags?: string[];
  memory_types?: MemoryType[];
  limit?: number;
  cursor?: string;
}

export interface ContributeOptions {
  content: string;
  type: MemoryType;
  summary?: string;
  tags?: string[];
  importance?: number;
  source?: string;
}

export interface ContributeResponse {
  id: string;
  type: MemoryType;
  owner: string | null;
  created_at: string;
  tags: string[];
  attestation: Attestation | null;
}

export interface VerifyResponse {
  id: string;
  verified: boolean;
  reason: VerifyReason;
  recomputed_hash: string;
  stored_hash: string | null;
  commitment: {
    chain: ChainId;
    assetId: string;
    txSig: string;
    treeAddress: string | null;
    leafIndex: number | null;
  } | null;
}

export type VerifyReason =
  | 'verified'
  | 'not_committed'
  | 'drift_detected'
  | 'revoked';

/** Reasons the server may attach to an error response. */
export type ErrorCode =
  | 'bad_request'
  | 'unauthenticated'
  | 'payment_required'
  | 'forbidden'
  | 'not_found'
  | 'revoked'
  | 'invalid_body'
  | 'invalid_id'
  | 'rate_limited'
  | 'discover_failed'
  | 'retrieve_failed'
  | 'verify_failed'
  | 'contribute_failed'
  | 'store_failed'
  | 'store_then_fetch_failed'
  | (string & {});

export interface ErrorBody {
  error: ErrorCode;
  reason?: string;
  hint?: string;
  /** Present on 402 — composes with x402 for payment-required flows. */
  x402?: unknown;
}
