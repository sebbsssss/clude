/**
 * PMP — Portable Memory Protocol HTTP routes.
 *
 * Implements the four v0.1 verbs:
 *   GET  /v1/memories            DISCOVER  — query memories across providers
 *   GET  /v1/memories/:id        RETRIEVE  — fetch one memory by id
 *   GET  /v1/memories/:id/verify VERIFY    — prove a memory is real, on-chain
 *   POST /v1/memories            CONTRIBUTE — write a new memory + receipt
 *
 * Wire format follows docs/pmp/spec-v0.1.md (pending).
 *
 * v0.1 behaviour:
 *   - DISCOVER: returns bot-own memories by default; authed callers see their own.
 *   - RETRIEVE: returns content + attestation if tokenised; 410 if revoked.
 *   - VERIFY:   public, no auth. Recomputes content hash, looks up on-chain commitment.
 *   - CONTRIBUTE: requires auth. Stores memory, mints commitment synchronously,
 *                  returns receipt.
 *
 * v0.2 will add: 402 gated retrieves (composes with x402), SUBSCRIBE (SSE), ATTEST.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  storeMemory,
  recallMemories,
  type Memory,
  type MemoryType,
} from '@clude/brain/memory';
import { getDb } from '@clude/shared/core/database';
import {
  optionalPrivyAuth,
  requirePrivyAuth,
} from '@clude/brain/auth/privy-auth';
import { withOwnerWallet } from '@clude/shared/core/owner-context';
import { createChildLogger } from '@clude/shared/core/logger';
import {
  memoryContentHash,
  tokenizeMemory,
  verifyMemory as verifyMemoryProtocol,
  type CanonicalMemoryInput,
  type TokenizeMemoryInput,
} from '@clude/tokenization';
import { getPdaMintClient } from '../lib/pda-mint-client.js';

const log = createChildLogger('pmp-routes');

// ─────────── Wire-format helpers ───────────

interface PmpAttestation {
  chain_id: 'solana' | 'base' | 'fake';
  asset_id: string;
  content_hash: string;
  tx_sig: string;
  tree_address: string | null;
  leaf_index: number | null;
  verifier_url: string;
}

interface PmpMemory {
  id: string;
  type: MemoryType;
  content: string;
  owner: string | null;
  created_at: string;
  tags: string[];
  attestation: PmpAttestation | null;
}

interface PmpError {
  error: string;
  reason?: string;
  hint?: string;
}

/** Build the canonical input shape required by content-hash + tokenization. */
function memoryToCanonical(m: Memory): CanonicalMemoryInput {
  return {
    content: m.content,
    memory_type: m.memory_type,
    owner_wallet: m.owner_wallet ?? null,
    created_at: m.created_at,
    tags: m.tags ?? [],
    source: m.source ?? null,
    related_user: m.related_user ?? null,
    related_wallet: m.related_wallet ?? null,
  };
}

function memoryToPmp(m: Memory, verifierBaseUrl: string): PmpMemory {
  const mWithChain = m as Memory & {
    content_hash?: string | null;
    cnft_address?: string | null;
    cnft_tree?: string | null;
    cnft_leaf_index?: number | null;
    cnft_tx_sig?: string | null;
    tokenization_status?: string | null;
  };

  const attestation: PmpAttestation | null =
    mWithChain.tokenization_status === 'minted' &&
    mWithChain.cnft_address &&
    mWithChain.cnft_tx_sig &&
    mWithChain.content_hash
      ? {
          chain_id: 'solana',
          asset_id: mWithChain.cnft_address,
          content_hash: mWithChain.content_hash,
          tx_sig: mWithChain.cnft_tx_sig,
          tree_address: mWithChain.cnft_tree ?? null,
          leaf_index: mWithChain.cnft_leaf_index ?? null,
          verifier_url: `${verifierBaseUrl}/v1/memories/${m.hash_id}/verify`,
        }
      : null;

  return {
    id: m.hash_id,
    type: m.memory_type,
    content: m.content,
    owner: m.owner_wallet ?? null,
    created_at: m.created_at,
    tags: m.tags ?? [],
    attestation,
  };
}

function publicBaseUrl(req: Request): string {
  // Behind a proxy, X-Forwarded-Proto + Host gives the public URL.
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  return `${proto}://${host}`;
}

function ownerFromReq(req: Request): string | null {
  if (req.verifiedWallet) return req.verifiedWallet;
  const q = req.query.owner;
  if (typeof q === 'string' && q.length > 0) return q;
  return null;
}

async function withOptionalOwner<T>(req: Request, fn: () => Promise<T>): Promise<T> {
  const owner = ownerFromReq(req);
  if (!owner) return fn();
  return withOwnerWallet(owner, fn);
}

// ─────────── Route handlers ───────────

export function pmpRoutes(): Router {
  const router = Router();

  // CORS: PMP is a public protocol. Permissive for read endpoints.
  router.use((req, res, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  /**
   * DISCOVER — GET /v1/memories
   * Query params: query, tags[], owner, limit (default 25), memory_types
   */
  router.get('/v1/memories', optionalPrivyAuth, async (req: Request, res: Response) => {
    try {
      const query = typeof req.query.query === 'string' ? req.query.query : undefined;
      const limit = Math.min(parseInt(String(req.query.limit ?? '25'), 10) || 25, 100);
      const tags = Array.isArray(req.query.tags)
        ? (req.query.tags as string[])
        : typeof req.query.tags === 'string'
        ? [req.query.tags]
        : undefined;
      const memoryTypes = Array.isArray(req.query.memory_types)
        ? (req.query.memory_types as MemoryType[])
        : typeof req.query.memory_types === 'string'
        ? [req.query.memory_types as MemoryType]
        : undefined;

      const memories = await withOptionalOwner(req, async () =>
        recallMemories({ query, tags, memoryTypes, limit, trackAccess: false }),
      );

      const baseUrl = publicBaseUrl(req);
      res.json({
        count: memories.length,
        memories: memories.map((m) => memoryToPmp(m, baseUrl)),
      });
    } catch (err) {
      log.error({ err }, 'DISCOVER failed');
      res.status(500).json({ error: 'discover_failed' } satisfies PmpError);
    }
  });

  /**
   * RETRIEVE — GET /v1/memories/:id
   */
  router.get('/v1/memories/:id', optionalPrivyAuth, async (req: Request, res: Response) => {
    const id = String(req.params.id ?? '');
    if (!id || id.length > 64) {
      res.status(422).json({ error: 'invalid_id' } satisfies PmpError);
      return;
    }

    try {
      const db = getDb();
      const { data, error } = await db
        .from('memories')
        .select(
          'id, hash_id, memory_type, content, owner_wallet, created_at, tags, source, related_user, related_wallet, content_hash, cnft_address, cnft_tree, cnft_leaf_index, cnft_tx_sig, tokenization_status, summary, concepts, emotional_valence, importance, access_count, last_accessed, decay_factor, evidence_ids, solana_signature, compacted, compacted_into, encrypted, encryption_pubkey, metadata, source_id',
        )
        .eq('hash_id', id)
        .limit(1)
        .maybeSingle();

      if (error) {
        log.warn({ err: error, id }, 'RETRIEVE query error');
        res.status(500).json({ error: 'retrieve_failed' } satisfies PmpError);
        return;
      }
      if (!data) {
        res.status(404).json({ error: 'not_found' } satisfies PmpError);
        return;
      }
      // 410: compacted memories return their successor's id as a hint.
      if ((data.compacted as boolean) && data.compacted_into) {
        res.status(410).json({
          error: 'revoked',
          reason: 'compacted',
          hint: `superseded_by:${data.compacted_into}`,
        } satisfies PmpError);
        return;
      }

      res.json(memoryToPmp(data as unknown as Memory, publicBaseUrl(req)));
    } catch (err) {
      log.error({ err, id }, 'RETRIEVE failed');
      res.status(500).json({ error: 'retrieve_failed' } satisfies PmpError);
    }
  });

  /**
   * VERIFY — GET /v1/memories/:id/verify
   * Public. Recomputes the content hash from current state, looks up the
   * on-chain commitment via MintClient, returns the attestation.
   */
  router.get('/v1/memories/:id/verify', async (req: Request, res: Response) => {
    const id = String(req.params.id ?? '');
    if (!id || id.length > 64) {
      res.status(422).json({ error: 'invalid_id' } satisfies PmpError);
      return;
    }

    try {
      const db = getDb();
      const { data, error } = await db
        .from('memories')
        .select(
          'content, memory_type, owner_wallet, created_at, tags, source, related_user, related_wallet, content_hash, cnft_address, cnft_tree, cnft_leaf_index, cnft_tx_sig, tokenization_status, compacted, compacted_into, hash_id',
        )
        .eq('hash_id', id)
        .limit(1)
        .maybeSingle();

      if (error) {
        log.warn({ err: error, id }, 'VERIFY query error');
        res.status(500).json({ error: 'verify_failed' } satisfies PmpError);
        return;
      }
      if (!data) {
        res.status(404).json({ error: 'not_found' } satisfies PmpError);
        return;
      }
      if ((data.compacted as boolean) && data.compacted_into) {
        res.status(410).json({
          error: 'revoked',
          reason: 'compacted',
          hint: `superseded_by:${data.compacted_into}`,
        } satisfies PmpError);
        return;
      }

      // Recompute the content hash from current state. Compare against the
      // stored value to detect drift; either way report on-chain lookup result.
      const canonical: CanonicalMemoryInput = {
        content: String(data.content ?? ''),
        memory_type: data.memory_type as MemoryType,
        owner_wallet: (data.owner_wallet as string | null) ?? null,
        created_at: String(data.created_at ?? ''),
        tags: (data.tags as string[] | null) ?? [],
        source: (data.source as string | null) ?? null,
        related_user: (data.related_user as string | null) ?? null,
        related_wallet: (data.related_wallet as string | null) ?? null,
      };
      const recomputed = memoryContentHash(canonical);
      const stored = (data.content_hash as string | null) ?? null;
      const drift = stored !== null && stored !== recomputed;

      const mint = getPdaMintClient();
      const verifyResult = await verifyMemoryProtocol(recomputed, mint);

      res.json({
        id,
        verified: verifyResult.verified && !drift,
        reason: drift ? 'drift_detected' : verifyResult.reason,
        recomputed_hash: recomputed,
        stored_hash: stored,
        commitment: verifyResult.commitment,
      });
    } catch (err) {
      log.error({ err, id }, 'VERIFY failed');
      res.status(500).json({ error: 'verify_failed' } satisfies PmpError);
    }
  });

  /**
   * CONTRIBUTE — POST /v1/memories
   * Body: { content, type, tags?, summary?, importance?, source? }
   * Auth required.
   */
  router.post('/v1/memories', requirePrivyAuth, async (req: Request, res: Response) => {
    const owner = ownerFromReq(req);
    if (!owner) {
      res.status(401).json({ error: 'unauthenticated' } satisfies PmpError);
      return;
    }

    const body = req.body ?? {};
    const content = typeof body.content === 'string' ? body.content : '';
    const type = body.type as MemoryType | undefined;
    if (!content || !type) {
      res.status(422).json({ error: 'invalid_body', hint: 'content and type required' } satisfies PmpError);
      return;
    }

    const tags = Array.isArray(body.tags) ? (body.tags as string[]) : [];
    const summary = typeof body.summary === 'string' ? body.summary : content.slice(0, 200);
    const importance = typeof body.importance === 'number' ? body.importance : 0.5;
    const source = typeof body.source === 'string' ? body.source : 'pmp-contribute';

    try {
      const memoryId = await withOwnerWallet(owner, async () =>
        storeMemory({ type, content, summary, tags, importance, source }),
      );

      if (memoryId === null) {
        res.status(500).json({ error: 'store_failed' } satisfies PmpError);
        return;
      }

      // Fetch the freshly-stored row to get hash_id + created_at.
      const db = getDb();
      const { data: stored } = await db
        .from('memories')
        .select('hash_id, memory_type, content, owner_wallet, created_at, tags, source, related_user, related_wallet')
        .eq('id', memoryId)
        .limit(1)
        .single();

      if (!stored) {
        res.status(500).json({ error: 'store_then_fetch_failed' } satisfies PmpError);
        return;
      }

      // Synchronously tokenise — for v0.1 we trade latency for a clean receipt.
      const mint = getPdaMintClient();
      const tokeniseInput: TokenizeMemoryInput = {
        hashId: stored.hash_id as string,
        content: stored.content as string,
        memory_type: stored.memory_type as MemoryType,
        owner_wallet: (stored.owner_wallet as string | null) ?? null,
        created_at: stored.created_at as string,
        tags: (stored.tags as string[] | null) ?? [],
        source: (stored.source as string | null) ?? null,
        related_user: (stored.related_user as string | null) ?? null,
        related_wallet: (stored.related_wallet as string | null) ?? null,
      };

      let attestation: PmpAttestation | null = null;
      try {
        const tokenised = await tokenizeMemory(tokeniseInput, mint);
        // Persist the patch back to the row.
        await db
          .from('memories')
          .update({
            content_hash: tokenised.patch.content_hash,
            cnft_address: tokenised.patch.cnft_address,
            cnft_tree: tokenised.patch.cnft_tree,
            cnft_leaf_index: tokenised.patch.cnft_leaf_index,
            cnft_tx_sig: tokenised.patch.cnft_tx_sig,
            tokenization_status: tokenised.patch.tokenization_status,
            tokenized_at: tokenised.patch.tokenized_at,
          })
          .eq('id', memoryId);

        attestation = {
          chain_id: tokenised.commitment.chain,
          asset_id: tokenised.commitment.assetId,
          content_hash: tokenised.contentHash,
          tx_sig: tokenised.commitment.txSig,
          tree_address: tokenised.commitment.treeAddress,
          leaf_index: tokenised.commitment.leafIndex,
          verifier_url: `${publicBaseUrl(req)}/v1/memories/${stored.hash_id}/verify`,
        };
      } catch (mintErr) {
        // Don't fail the request if mint fails — memory is stored, attestation
        // will be re-attempted by the backfill worker. Mark as failed in DB.
        log.warn({ err: mintErr, memoryId, hashId: stored.hash_id }, 'tokenizeMemory failed; row stays pending');
        await db
          .from('memories')
          .update({ tokenization_status: 'failed' })
          .eq('id', memoryId);
      }

      res.status(201).json({
        id: stored.hash_id,
        type: stored.memory_type,
        owner: stored.owner_wallet,
        created_at: stored.created_at,
        tags: stored.tags ?? [],
        attestation,
      });
    } catch (err) {
      log.error({ err }, 'CONTRIBUTE failed');
      res.status(500).json({ error: 'contribute_failed' } satisfies PmpError);
    }
  });

  return router;
}
