/**
 * MintClient — the on-chain commitment abstraction.
 *
 * `tokenizeMemory()` and `tokenizePack()` do their work against this interface
 * rather than calling Solana directly. Three benefits:
 *
 *   1. The protocol logic (canonicalisation, Merkle construction, DB updates)
 *      is testable without an RPC endpoint.
 *   2. We can ship v0.1 against the existing `memory_registry` PDA and swap
 *      to Light Protocol cNFTs in v0.2 by writing a new implementation —
 *      no callsite changes.
 *   3. Other chains (Base ERC-721 / ERC-1155) get their own impls that
 *      conform to the same interface, so the PMP `VERIFY` endpoint can
 *      dispatch by chain_id with one code path.
 *
 * Implementations:
 *   - FakeMintClient (this file)         — in-memory, deterministic, for tests
 *   - PdaMintClient (pending)            — v0.1 production, wraps existing solana-client
 *   - LightMintClient (pending)          — v0.2, Light Protocol compressed NFTs
 *   - EvmMintClient (pending)            — Base ERC-721 / ERC-1155
 */

export type ChainId = 'solana' | 'base' | 'fake';

export interface MemoryCommitment {
  chain: ChainId;
  /** On-chain identifier — PDA address, cNFT mint, or ERC-721 token id. */
  assetId: string;
  /** Transaction signature / hash of the commitment write. */
  txSig: string;
  /** For tree-based assets (cNFTs): which tree. Null for PDA-based. */
  treeAddress: string | null;
  /** For tree-based assets: position in the tree. Null for PDA-based. */
  leafIndex: number | null;
}

export interface PackCommitment {
  chain: ChainId;
  /** Pack token address (cNFT mint, ERC-1155 token id, etc.). */
  packTokenAddress: string;
  txSig: string;
  /** Echoed back from the input — convenience for callers. */
  merkleRoot: string;
}

/**
 * Receipt for a batch commitment — one on-chain write covering many memories.
 * Distinct from PackCommitment: a Pack is a curated, tradeable product; a
 * batch is an internal tokenisation optimisation (the backfill commits
 * memories in batches so a 100k-memory corpus costs ~100 transactions
 * instead of ~100k).
 */
export interface BatchCommitment {
  chain: ChainId;
  /** On-chain identifier for the batch commitment (memo tx, cNFT mint, etc.). */
  assetId: string;
  txSig: string;
  /** Echoed back from the input — the Merkle root the batch committed. */
  merkleRoot: string;
}

export interface CommitMemoryInput {
  /** sha256 hex of the memory's canonical content (from content-hash.ts). */
  contentHash: string;
  /** External-facing memory id (e.g. 'mem-abcd1234'). */
  memoryHashId: string;
  /** Solana pubkey of the owner, or null for bot-owned memories. */
  ownerWallet: string | null;
}

export interface CommitPackInput {
  /** External-facing pack id (e.g. 'pack-XYZ'). */
  packId: string;
  /** sha256 hex Merkle root over the pack's memory content hashes. */
  merkleRoot: string;
  /** Wallet that authored / owns the Pack. */
  authorWallet: string;
  /** Number of memories in the Pack (for verifier sanity-check). */
  memoryCount: number;
  /** Optional off-chain URI for the gating service. */
  gateUri: string | null;
}

export interface CommitMemoryBatchInput {
  /** Stable id for this tokenisation batch (e.g. 'batch-abcd1234'). */
  batchId: string;
  /** sha256 hex Merkle root over the batch's memory content hashes. */
  merkleRoot: string;
  /** Number of memories in the batch (verifier sanity-check). */
  memoryCount: number;
}

export interface MintClient {
  /** Which chain this client commits to. */
  readonly chain: ChainId;

  /** Commit a memory's content hash on-chain. Returns the commitment receipt. */
  commitMemoryHash(input: CommitMemoryInput): Promise<MemoryCommitment>;

  /** Commit a Pack's Merkle root on-chain. Returns the commitment receipt. */
  commitPackRoot(input: CommitPackInput): Promise<PackCommitment>;

  /**
   * Commit a Merkle root over a batch of memory hashes — one on-chain write
   * for many memories. Used by the backfill to tokenise large corpora
   * economically.
   */
  commitMemoryBatch(input: CommitMemoryBatchInput): Promise<BatchCommitment>;

  /** Look up a previously-committed memory by its content hash. */
  fetchMemoryCommitment(contentHash: string): Promise<MemoryCommitment | null>;

  /** Look up a previously-committed Pack by its merkle root. */
  fetchPackCommitment(merkleRoot: string): Promise<PackCommitment | null>;

  /** Look up a previously-committed batch by its merkle root. */
  fetchBatchCommitment(merkleRoot: string): Promise<BatchCommitment | null>;
}

/**
 * In-memory deterministic MintClient. Used in tests, and by the development
 * harness when no chain credentials are configured.
 *
 * Tx sigs and asset ids are derived from inputs so the same input always
 * produces the same "receipt" — makes test assertions tractable.
 */
export class FakeMintClient implements MintClient {
  readonly chain: ChainId = 'fake';
  private readonly memories = new Map<string, MemoryCommitment>();
  private readonly packs = new Map<string, PackCommitment>();
  private readonly batches = new Map<string, BatchCommitment>();
  private mintCounter = 0;

  async commitMemoryHash(input: CommitMemoryInput): Promise<MemoryCommitment> {
    const existing = this.memories.get(input.contentHash);
    if (existing) return existing;
    const seq = ++this.mintCounter;
    const commitment: MemoryCommitment = {
      chain: 'fake',
      assetId: `fake-mem-${input.contentHash.slice(0, 16)}-${seq}`,
      txSig: `faketx-mem-${seq}`,
      treeAddress: null,
      leafIndex: null,
    };
    this.memories.set(input.contentHash, commitment);
    return commitment;
  }

  async commitPackRoot(input: CommitPackInput): Promise<PackCommitment> {
    const existing = this.packs.get(input.merkleRoot);
    if (existing) return existing;
    const seq = ++this.mintCounter;
    const commitment: PackCommitment = {
      chain: 'fake',
      packTokenAddress: `fake-pack-${input.merkleRoot.slice(0, 16)}-${seq}`,
      txSig: `faketx-pack-${seq}`,
      merkleRoot: input.merkleRoot,
    };
    this.packs.set(input.merkleRoot, commitment);
    return commitment;
  }

  async commitMemoryBatch(input: CommitMemoryBatchInput): Promise<BatchCommitment> {
    const existing = this.batches.get(input.merkleRoot);
    if (existing) return existing;
    const seq = ++this.mintCounter;
    const commitment: BatchCommitment = {
      chain: 'fake',
      assetId: `fake-batch-${input.merkleRoot.slice(0, 16)}-${seq}`,
      txSig: `faketx-batch-${seq}`,
      merkleRoot: input.merkleRoot,
    };
    this.batches.set(input.merkleRoot, commitment);
    return commitment;
  }

  async fetchMemoryCommitment(contentHash: string): Promise<MemoryCommitment | null> {
    return this.memories.get(contentHash) ?? null;
  }

  async fetchPackCommitment(merkleRoot: string): Promise<PackCommitment | null> {
    return this.packs.get(merkleRoot) ?? null;
  }

  async fetchBatchCommitment(merkleRoot: string): Promise<BatchCommitment | null> {
    return this.batches.get(merkleRoot) ?? null;
  }

  /** Test helper: clear all in-memory state. */
  reset(): void {
    this.memories.clear();
    this.packs.clear();
    this.batches.clear();
    this.mintCounter = 0;
  }
}
