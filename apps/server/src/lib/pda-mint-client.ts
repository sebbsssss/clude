/**
 * PdaMintClient — production v0.1 MintClient implementation.
 *
 * Memory commitments use the existing on-chain memory registry program
 * (registerMemoryOnChain in @clude/shared/core/solana-client). All memories
 * for the bot wallet land in a single PDA's entries vec.
 *
 * Pack commitments use SPL Memo writes for v0.1 (no Pack registry program
 * exists yet). The memo payload encodes the pack id, Merkle root, and
 * memory count. Verifiers cross-reference the memo tx with our `memory_packs`
 * row to confirm the on-chain commitment matches the off-chain record.
 *
 * Reads (fetchMemoryCommitment, fetchPackCommitment) query Supabase, which
 * is the canonical index. The chain is the audit trail — anyone can
 * independently verify the receipt by fetching the tx.
 *
 * Future:
 *   - v0.2 LightMintClient: replaces memory PDA writes with Light Protocol
 *     compressed NFTs; replaces Pack memo writes with proper NFT mints.
 *   - v0.3 EvmMintClient: ERC-721 / ERC-1155 on Base, same interface.
 */

import type {
  ChainId,
  MintClient,
  CommitMemoryInput,
  CommitPackInput,
  MemoryCommitment,
  PackCommitment,
} from '@clude/tokenization';
import {
  registerMemoryOnChain,
  writeMemo,
  getBotWallet,
} from '@clude/shared/core/solana-client';
import { getDb } from '@clude/shared/core/database';
import { MEMO_MAX_LENGTH } from '@clude/shared/utils/constants';
import { createChildLogger } from '@clude/shared/core/logger';
import { PublicKey } from '@solana/web3.js';

const log = createChildLogger('pda-mint-client');

/**
 * Derive the registry PDA for the bot wallet.
 * Mirrors the seed used in @clude/shared/core/solana-client (deriveRegistryPDA).
 * We can't import that helper because it's not exported — re-deriving here is fine.
 */
function deriveBotRegistryPda(): string | null {
  const wallet = getBotWallet();
  if (!wallet) return null;
  // Match the seed used by solana-client.deriveRegistryPDA — but we don't have
  // access to its registryProgramId. For v0.1 we just record the bot wallet
  // pubkey as the assetId; verifiers can re-derive the PDA from the program id
  // configured in their own env.
  return wallet.publicKey.toBase58();
}

interface PdaMintClientOpts {
  /** Optional override for the memory id passed to the registry program. */
  resolveMemoryDbId?: (memoryHashId: string) => Promise<number | null>;
}

export class PdaMintClient implements MintClient {
  readonly chain: ChainId = 'solana';
  private readonly opts: PdaMintClientOpts;

  constructor(opts: PdaMintClientOpts = {}) {
    this.opts = opts;
  }

  async commitMemoryHash(input: CommitMemoryInput): Promise<MemoryCommitment> {
    const contentHashBuf = Buffer.from(input.contentHash, 'hex');
    if (contentHashBuf.length !== 32) {
      throw new Error(
        `PdaMintClient: contentHash must be 32 bytes (got ${contentHashBuf.length})`,
      );
    }

    // Resolve the integer memory id the registry program expects. Caller can
    // supply a resolver (e.g. one that looks up by hash_id); otherwise we
    // best-effort default to 0 (the registry program treats this as an opaque
    // u64 tag; for hash-based lookups it's not load-bearing).
    let memoryDbId = 0;
    if (this.opts.resolveMemoryDbId) {
      const resolved = await this.opts.resolveMemoryDbId(input.memoryHashId);
      if (resolved !== null) memoryDbId = resolved;
    }

    const txSig = await registerMemoryOnChain(
      contentHashBuf,
      'episodic', // TODO: thread real memory_type through; not load-bearing for hash verification
      0.5, // importance — registry stores as tier 0/1/2; not load-bearing for verify
      memoryDbId,
      false, // encrypted flag; v0.2 will thread real value
    );

    if (!txSig) {
      throw new Error('PdaMintClient: on-chain registration failed (see solana-client logs)');
    }

    const assetId = deriveBotRegistryPda() ?? 'unknown-registry';

    return {
      chain: 'solana',
      assetId,
      txSig,
      treeAddress: null,
      leafIndex: null,
    };
  }

  async commitPackRoot(input: CommitPackInput): Promise<PackCommitment> {
    // Encode the pack commitment as a compact memo string.
    // Format: clude-pack | v1 | <pack_id> | <root_hex> | <count>
    // Stays under MEMO_MAX_LENGTH for reasonable pack_id lengths.
    const memo = `clude-pack | v1 | ${input.packId} | ${input.merkleRoot} | ${input.memoryCount}`;
    if (memo.length > MEMO_MAX_LENGTH) {
      throw new Error(
        `PdaMintClient: pack commitment memo length ${memo.length} exceeds MEMO_MAX_LENGTH ${MEMO_MAX_LENGTH}`,
      );
    }

    const txSig = await writeMemo(memo);
    if (!txSig) {
      throw new Error('PdaMintClient: pack memo write failed');
    }

    return {
      chain: 'solana',
      // v0.1 placeholder: tx sig as the on-chain handle. v0.2 will replace
      // this with a real NFT mint address.
      packTokenAddress: `memo:${txSig}`,
      txSig,
      merkleRoot: input.merkleRoot,
    };
  }

  async fetchMemoryCommitment(contentHash: string): Promise<MemoryCommitment | null> {
    try {
      const db = getDb();
      const { data, error } = await db
        .from('memories')
        .select('cnft_address, cnft_tree, cnft_leaf_index, cnft_tx_sig')
        .eq('content_hash', contentHash)
        .eq('tokenization_status', 'minted')
        .limit(1)
        .maybeSingle();

      if (error) {
        log.warn({ err: error, contentHash: contentHash.slice(0, 16) }, 'fetchMemoryCommitment query failed');
        return null;
      }
      if (!data?.cnft_address || !data?.cnft_tx_sig) return null;

      return {
        chain: 'solana',
        assetId: data.cnft_address,
        txSig: data.cnft_tx_sig,
        treeAddress: (data.cnft_tree as string | null) ?? null,
        leafIndex: (data.cnft_leaf_index as number | null) ?? null,
      };
    } catch (err) {
      log.warn({ err }, 'fetchMemoryCommitment threw');
      return null;
    }
  }

  async fetchPackCommitment(merkleRoot: string): Promise<PackCommitment | null> {
    try {
      const db = getDb();
      const { data, error } = await db
        .from('memory_packs')
        .select('pack_token_address, pack_token_tx_sig, merkle_root')
        .eq('merkle_root', merkleRoot)
        .not('tokenized_at', 'is', null)
        .limit(1)
        .maybeSingle();

      if (error) {
        log.warn({ err: error, merkleRoot: merkleRoot.slice(0, 16) }, 'fetchPackCommitment query failed');
        return null;
      }
      if (!data?.pack_token_address || !data?.pack_token_tx_sig) return null;

      return {
        chain: 'solana',
        packTokenAddress: data.pack_token_address as string,
        txSig: data.pack_token_tx_sig as string,
        merkleRoot: data.merkle_root as string,
      };
    } catch (err) {
      log.warn({ err }, 'fetchPackCommitment threw');
      return null;
    }
  }
}

/**
 * Module-level singleton. Cheap to instantiate but the singleton makes it
 * easy for routes to share a single client without DI plumbing.
 */
let _instance: PdaMintClient | null = null;

export function getPdaMintClient(): PdaMintClient {
  if (!_instance) {
    _instance = new PdaMintClient({
      resolveMemoryDbId: async (hashId: string) => {
        try {
          const db = getDb();
          const { data } = await db
            .from('memories')
            .select('id')
            .eq('hash_id', hashId)
            .limit(1)
            .maybeSingle();
          return (data?.id as number | undefined) ?? null;
        } catch {
          return null;
        }
      },
    });
  }
  return _instance;
}

// Touch the import so unused-warning stays away if we move callsites around.
export { PublicKey };
