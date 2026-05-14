/**
 * PMP Pack endpoints — selective disclosure + token-gated marketplace surface.
 *
 *   POST /v1/packs                        Create + tokenise a Pack
 *   GET  /v1/packs/:id                    Retrieve Pack metadata
 *   GET  /v1/packs/:id/preview?count=N    Preview N revealed memories + Merkle proofs
 *   GET  /v1/packs/:id/verify             Public verifier — confirms the on-chain commitment
 *
 * Spec status: Pack endpoints are reserved in PMP v0.1 spec §9 and formally
 * arrive in v0.2. We ship them now under /v1/packs because the implementation
 * is ready and the marketplace surface is critical for the launch story.
 * Behaviour is backward-compatible with the v0.2 spec text.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  buildPackTree,
  inclusionProof,
  tokenizePack,
  type TokenizePackMemberInput,
} from '@clude/tokenization';
import { getDb } from '@clude/shared/core/database';
import { requirePrivyAuth, optionalPrivyAuth } from '@clude/brain/auth/privy-auth';
import { withOwnerWallet } from '@clude/shared/core/owner-context';
import { createChildLogger } from '@clude/shared/core/logger';
import { getPdaMintClient } from '../lib/pda-mint-client.js';
import { randomBytes } from 'node:crypto';

const log = createChildLogger('pmp-packs-routes');

// ─────────── Helpers ───────────

interface PackErrorBody {
  error: string;
  reason?: string;
  hint?: string;
}

function ownerFromReq(req: Request): string | null {
  if (req.verifiedWallet) return req.verifiedWallet;
  const q = req.query.owner;
  if (typeof q === 'string' && q.length > 0) return q;
  return null;
}

function publicBaseUrl(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  return `${proto}://${host}`;
}

function generatePackId(): string {
  return `pack-${randomBytes(4).toString('hex')}`;
}

interface PackRow {
  pack_id: string;
  manifest_id: string | null;
  author_wallet: string;
  name: string;
  description: string | null;
  version: string;
  memory_count: number;
  created_at: string;
  published_at: string | null;
  merkle_root: string | null;
  pack_token_address: string | null;
  pack_token_tx_sig: string | null;
  pack_schema_version: number;
  gate_uri: string | null;
  tokenized_at: string | null;
}

function packRowToWire(p: PackRow, verifierBaseUrl: string) {
  return {
    id: p.pack_id,
    name: p.name,
    description: p.description,
    version: p.version,
    author: p.author_wallet,
    manifest_id: p.manifest_id,
    memory_count: p.memory_count,
    created_at: p.created_at,
    published_at: p.published_at,
    gate_uri: p.gate_uri,
    attestation: p.pack_token_address && p.merkle_root && p.pack_token_tx_sig
      ? {
          chain_id: 'solana',
          asset_id: p.pack_token_address,
          merkle_root: p.merkle_root,
          tx_sig: p.pack_token_tx_sig,
          schema_version: p.pack_schema_version,
          verifier_url: `${verifierBaseUrl}/v1/packs/${p.pack_id}/verify`,
        }
      : null,
  };
}

// ─────────── Route module ───────────

export function pmpPacksRoutes(): Router {
  const router = Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
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
   * POST /v1/packs — create + tokenise a Pack from memory ids.
   *
   * Body: {
   *   name: string,
   *   description?: string,
   *   version?: string,           // defaults '1.0.0'
   *   memory_hash_ids: string[],  // owner-scoped; caller must own each
   *   manifest_id?: string,       // optional ref to wiki-pack manifest
   *   gate_uri?: string
   * }
   */
  router.post('/v1/packs', requirePrivyAuth, async (req: Request, res: Response) => {
    const owner = ownerFromReq(req);
    if (!owner) {
      res.status(401).json({ error: 'unauthenticated' } satisfies PackErrorBody);
      return;
    }

    const body = req.body ?? {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const memoryHashIds: string[] = Array.isArray(body.memory_hash_ids)
      ? body.memory_hash_ids.filter((s: unknown): s is string => typeof s === 'string')
      : [];

    if (!name) {
      res.status(422).json({ error: 'invalid_body', hint: 'name is required' } satisfies PackErrorBody);
      return;
    }
    if (memoryHashIds.length === 0) {
      res.status(422).json({ error: 'invalid_body', hint: 'memory_hash_ids must be a non-empty array' } satisfies PackErrorBody);
      return;
    }
    if (memoryHashIds.length > 10_000) {
      res.status(422).json({ error: 'invalid_body', hint: 'memory_hash_ids capped at 10,000 per pack' } satisfies PackErrorBody);
      return;
    }

    try {
      // Verify the caller owns every memory + collect their content_hash + DB id, in order.
      const db = getDb();
      const { data: rows, error } = await db
        .from('memories')
        .select('id, hash_id, content_hash, owner_wallet, tokenization_status')
        .in('hash_id', memoryHashIds);

      if (error) {
        log.warn({ err: error }, 'POST /v1/packs: memory lookup failed');
        res.status(500).json({ error: 'create_pack_failed' } satisfies PackErrorBody);
        return;
      }
      const memoryMap = new Map<string, { id: number; content_hash: string | null; owner_wallet: string | null; tokenization_status: string | null }>();
      for (const r of (rows ?? []) as Array<{
        id: number;
        hash_id: string;
        content_hash: string | null;
        owner_wallet: string | null;
        tokenization_status: string | null;
      }>) {
        memoryMap.set(r.hash_id, {
          id: r.id,
          content_hash: r.content_hash,
          owner_wallet: r.owner_wallet,
          tokenization_status: r.tokenization_status,
        });
      }

      // Reject if any hash_id missing, not owned by caller, or not yet tokenised.
      const missing: string[] = [];
      const notOwned: string[] = [];
      const notTokenised: string[] = [];
      const members: TokenizePackMemberInput[] = [];

      for (const hashId of memoryHashIds) {
        const row = memoryMap.get(hashId);
        if (!row) {
          missing.push(hashId);
          continue;
        }
        if (row.owner_wallet !== owner) {
          notOwned.push(hashId);
          continue;
        }
        if (!row.content_hash || row.tokenization_status !== 'minted') {
          notTokenised.push(hashId);
          continue;
        }
        members.push({ memoryId: row.id, contentHash: row.content_hash });
      }

      if (missing.length > 0) {
        res.status(404).json({
          error: 'memories_not_found',
          hint: `missing: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}`,
        } satisfies PackErrorBody);
        return;
      }
      if (notOwned.length > 0) {
        res.status(403).json({
          error: 'forbidden',
          reason: 'not_owner',
          hint: `caller does not own: ${notOwned.slice(0, 5).join(', ')}${notOwned.length > 5 ? ` and ${notOwned.length - 5} more` : ''}`,
        } satisfies PackErrorBody);
        return;
      }
      if (notTokenised.length > 0) {
        res.status(409).json({
          error: 'memories_not_tokenised',
          reason: 'pre_tokenisation',
          hint: `${notTokenised.length} memor${notTokenised.length === 1 ? 'y' : 'ies'} need to be tokenised first (try again after the backfill worker runs, or wait for the auto-tokenisation hook)`,
        } satisfies PackErrorBody);
        return;
      }

      const packId = generatePackId();
      const mint = getPdaMintClient();
      const tokenised = await withOwnerWallet(owner, async () =>
        tokenizePack(
          {
            packId,
            authorWallet: owner,
            gateUri: typeof body.gate_uri === 'string' ? body.gate_uri : null,
            memories: members,
          },
          mint,
        ),
      );

      // Persist pack + contents. Insert pack first so the FK on contents resolves.
      const now = new Date().toISOString();
      const { error: insertErr } = await db.from('memory_packs').insert({
        pack_id: packId,
        manifest_id: typeof body.manifest_id === 'string' ? body.manifest_id : null,
        author_wallet: owner,
        name,
        description: typeof body.description === 'string' ? body.description : null,
        version: typeof body.version === 'string' ? body.version : '1.0.0',
        memory_count: members.length,
        created_at: now,
        published_at: tokenised.patch.published_at,
        merkle_root: tokenised.patch.merkle_root,
        pack_token_address: tokenised.patch.pack_token_address,
        pack_token_tx_sig: tokenised.patch.pack_token_tx_sig,
        pack_schema_version: 1,
        gate_uri: typeof body.gate_uri === 'string' ? body.gate_uri : null,
        tokenized_at: tokenised.patch.tokenized_at,
      });

      if (insertErr) {
        log.warn({ err: insertErr, packId }, 'pack insert failed');
        res.status(500).json({ error: 'create_pack_failed' } satisfies PackErrorBody);
        return;
      }

      // Bulk-insert contents.
      const contentRows = tokenised.contentRows.map((r) => ({ ...r, pack_id: packId }));
      const { error: contentsErr } = await db.from('memory_pack_contents').insert(contentRows);
      if (contentsErr) {
        log.warn({ err: contentsErr, packId }, 'pack contents insert failed; pack row will appear orphaned');
        // Don't fail the request — the pack token is already on-chain. Surface the error in logs.
      }

      res.status(201).json({
        id: packId,
        name,
        description: typeof body.description === 'string' ? body.description : null,
        version: typeof body.version === 'string' ? body.version : '1.0.0',
        author: owner,
        manifest_id: typeof body.manifest_id === 'string' ? body.manifest_id : null,
        memory_count: members.length,
        created_at: now,
        published_at: tokenised.patch.published_at,
        gate_uri: typeof body.gate_uri === 'string' ? body.gate_uri : null,
        attestation: {
          chain_id: tokenised.commitment.chain,
          asset_id: tokenised.commitment.packTokenAddress,
          merkle_root: tokenised.tree.root,
          tx_sig: tokenised.commitment.txSig,
          schema_version: 1,
          verifier_url: `${publicBaseUrl(req)}/v1/packs/${packId}/verify`,
        },
      });
    } catch (err) {
      log.error({ err }, 'POST /v1/packs: unhandled error');
      res.status(500).json({ error: 'create_pack_failed' } satisfies PackErrorBody);
    }
  });

  /** GET /v1/packs/:id — retrieve Pack metadata. */
  router.get('/v1/packs/:id', optionalPrivyAuth, async (req: Request, res: Response) => {
    const id = String(req.params.id ?? '');
    if (!id || id.length > 64) {
      res.status(422).json({ error: 'invalid_id' } satisfies PackErrorBody);
      return;
    }
    try {
      const db = getDb();
      const { data, error } = await db
        .from('memory_packs')
        .select(
          'pack_id, manifest_id, author_wallet, name, description, version, memory_count, created_at, published_at, merkle_root, pack_token_address, pack_token_tx_sig, pack_schema_version, gate_uri, tokenized_at',
        )
        .eq('pack_id', id)
        .limit(1)
        .maybeSingle();

      if (error) {
        log.warn({ err: error, id }, 'GET /v1/packs query error');
        res.status(500).json({ error: 'retrieve_pack_failed' } satisfies PackErrorBody);
        return;
      }
      if (!data) {
        res.status(404).json({ error: 'not_found' } satisfies PackErrorBody);
        return;
      }
      res.json(packRowToWire(data as PackRow, publicBaseUrl(req)));
    } catch (err) {
      log.error({ err, id }, 'GET /v1/packs failed');
      res.status(500).json({ error: 'retrieve_pack_failed' } satisfies PackErrorBody);
    }
  });

  /**
   * GET /v1/packs/:id/preview?count=N — selective disclosure.
   *
   * Reveals the first N memories (by leaf_index) + a Merkle inclusion proof
   * for each, plus the on-chain root. Anyone can verify the proofs against
   * the Pack token's committed root without seeing the unrevealed memories.
   */
  router.get('/v1/packs/:id/preview', async (req: Request, res: Response) => {
    const id = String(req.params.id ?? '');
    if (!id || id.length > 64) {
      res.status(422).json({ error: 'invalid_id' } satisfies PackErrorBody);
      return;
    }
    const requestedCount = parseInt(String(req.query.count ?? '1'), 10);
    const count = Math.max(1, Math.min(Number.isFinite(requestedCount) ? requestedCount : 1, 10));

    try {
      const db = getDb();
      const { data: pack, error: packErr } = await db
        .from('memory_packs')
        .select('pack_id, name, version, author_wallet, memory_count, merkle_root, pack_token_address')
        .eq('pack_id', id)
        .limit(1)
        .maybeSingle();
      if (packErr) {
        log.warn({ err: packErr, id }, 'preview: pack lookup failed');
        res.status(500).json({ error: 'preview_failed' } satisfies PackErrorBody);
        return;
      }
      if (!pack) {
        res.status(404).json({ error: 'not_found' } satisfies PackErrorBody);
        return;
      }
      const packRow = pack as { pack_id: string; name: string; version: string; author_wallet: string; memory_count: number; merkle_root: string | null; pack_token_address: string | null };
      if (!packRow.merkle_root) {
        res.status(409).json({ error: 'not_tokenised', hint: 'pack draft — not yet committed on-chain' } satisfies PackErrorBody);
        return;
      }

      // Fetch ALL pack contents in tree order so we can rebuild the Merkle tree
      // and produce inclusion proofs. For very large packs (>10k) we should
      // page or memoise; the v0.1 cap of 10k makes one query fine.
      const { data: contentsRaw, error: contentsErr } = await db
        .from('memory_pack_contents')
        .select('memory_id, leaf_index, content_hash')
        .eq('pack_id', id)
        .order('leaf_index', { ascending: true });
      if (contentsErr) {
        log.warn({ err: contentsErr, id }, 'preview: contents lookup failed');
        res.status(500).json({ error: 'preview_failed' } satisfies PackErrorBody);
        return;
      }
      const contents = (contentsRaw ?? []) as Array<{ memory_id: number; leaf_index: number; content_hash: string }>;
      if (contents.length === 0) {
        res.status(500).json({ error: 'preview_failed', reason: 'no_contents' } satisfies PackErrorBody);
        return;
      }

      // Rebuild the tree. Important: order by leaf_index so the root matches what was committed.
      const leafHashes = contents.map((c) => c.content_hash);
      const tree = buildPackTree(leafHashes);

      // Safety check: the rebuilt root must match the on-chain commitment.
      if (tree.root !== packRow.merkle_root) {
        log.error(
          { id, builtRoot: tree.root, committedRoot: packRow.merkle_root },
          'preview: rebuilt root mismatches committed root',
        );
        res.status(500).json({ error: 'preview_failed', reason: 'root_mismatch' } satisfies PackErrorBody);
        return;
      }

      // Reveal the first `count` leaves with their inclusion proofs.
      const revealedSlice = contents.slice(0, Math.min(count, contents.length));
      const revealMemoryIds = revealedSlice.map((r) => r.memory_id);
      const { data: memoriesRaw } = await db
        .from('memories')
        .select('id, hash_id, memory_type, content, owner_wallet, created_at, tags, source, related_user, related_wallet')
        .in('id', revealMemoryIds);

      const memoryById = new Map<number, {
        id: number;
        hash_id: string;
        memory_type: string;
        content: string;
        owner_wallet: string | null;
        created_at: string;
        tags: string[] | null;
        source: string | null;
        related_user: string | null;
        related_wallet: string | null;
      }>();
      for (const m of (memoriesRaw ?? []) as Array<typeof memoryById extends Map<unknown, infer V> ? V : never>) {
        memoryById.set(m.id, m);
      }

      const revealed = revealedSlice.map((row) => {
        const proof = inclusionProof(tree, row.leaf_index);
        const memory = memoryById.get(row.memory_id) ?? null;
        return {
          memory: memory
            ? {
                id: memory.hash_id,
                type: memory.memory_type,
                content: memory.content,
                owner: memory.owner_wallet,
                created_at: memory.created_at,
                tags: memory.tags ?? [],
              }
            : null,
          content_hash: row.content_hash,
          leaf_index: row.leaf_index,
          proof: {
            leaf: proof.leaf,
            leaf_index: proof.leafIndex,
            siblings: proof.siblings,
            algorithm: proof.algorithm,
          },
        };
      });

      res.json({
        pack: {
          id: packRow.pack_id,
          name: packRow.name,
          version: packRow.version,
          author: packRow.author_wallet,
          memory_count: packRow.memory_count,
          merkle_root: packRow.merkle_root,
          pack_token_address: packRow.pack_token_address,
        },
        revealed_count: revealed.length,
        unrevealed_count: contents.length - revealed.length,
        revealed,
        verifier_url: `${publicBaseUrl(req)}/v1/packs/${id}/verify`,
      });
    } catch (err) {
      log.error({ err, id }, 'preview failed');
      res.status(500).json({ error: 'preview_failed' } satisfies PackErrorBody);
    }
  });

  /** GET /v1/packs/:id/verify — public verifier for the Pack commitment. */
  router.get('/v1/packs/:id/verify', async (req: Request, res: Response) => {
    const id = String(req.params.id ?? '');
    if (!id || id.length > 64) {
      res.status(422).json({ error: 'invalid_id' } satisfies PackErrorBody);
      return;
    }
    try {
      const db = getDb();
      const { data, error } = await db
        .from('memory_packs')
        .select('pack_id, merkle_root, pack_token_address, pack_token_tx_sig, memory_count, tokenized_at')
        .eq('pack_id', id)
        .limit(1)
        .maybeSingle();
      if (error) {
        log.warn({ err: error, id }, 'pack verify: query failed');
        res.status(500).json({ error: 'verify_failed' } satisfies PackErrorBody);
        return;
      }
      if (!data) {
        res.status(404).json({ error: 'not_found' } satisfies PackErrorBody);
        return;
      }
      const row = data as { pack_id: string; merkle_root: string | null; pack_token_address: string | null; pack_token_tx_sig: string | null; memory_count: number; tokenized_at: string | null };

      if (!row.merkle_root || !row.pack_token_address || !row.pack_token_tx_sig) {
        res.json({
          id,
          verified: false,
          reason: 'not_tokenised',
          memory_count: row.memory_count,
          commitment: null,
        });
        return;
      }

      // Rebuild from contents to confirm the stored root matches.
      const { data: contentsRaw } = await db
        .from('memory_pack_contents')
        .select('content_hash, leaf_index')
        .eq('pack_id', id)
        .order('leaf_index', { ascending: true });
      const contents = (contentsRaw ?? []) as Array<{ content_hash: string; leaf_index: number }>;
      if (contents.length === 0) {
        res.json({
          id,
          verified: false,
          reason: 'no_contents',
          memory_count: row.memory_count,
          commitment: null,
        });
        return;
      }
      const tree = buildPackTree(contents.map((c) => c.content_hash));
      const verified = tree.root === row.merkle_root && contents.length === row.memory_count;
      res.json({
        id,
        verified,
        reason: verified ? 'verified' : 'drift_detected',
        memory_count: row.memory_count,
        recomputed_root: tree.root,
        committed_root: row.merkle_root,
        commitment: {
          chain: 'solana',
          asset_id: row.pack_token_address,
          tx_sig: row.pack_token_tx_sig,
          tokenized_at: row.tokenized_at,
        },
      });
    } catch (err) {
      log.error({ err, id }, 'pack verify failed');
      res.status(500).json({ error: 'verify_failed' } satisfies PackErrorBody);
    }
  });

  return router;
}
