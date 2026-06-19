/**
 * Sealed-safe pack preview — pure selective-disclosure + commitment helpers.
 *
 * Tradeable Memory Packs — Slice 1, Part A, Task 5.
 *
 * Extracted verbatim from the inline preview/verify logic in
 * `pmp-packs.routes.ts` so the same code backs BOTH the legacy
 * `GET /v1/packs/:id/preview` + `/verify` routes AND the new marketplace
 * `GET /v1/listings/:id/preview`. Keeping it pure (no DB, no `req`, no I/O)
 * means callers fetch the rows and we only do the cryptography: rebuild the
 * Merkle tree from the member leaf hashes, assert it reproduces the committed
 * on-chain root, and emit inclusion proofs for the revealed slice.
 *
 * The two crucial invariants preserved from the route bodies:
 *   1. Members MUST be passed in `leaf_index` order so the rebuilt root matches
 *      what was committed (the route orders by `leaf_index ASC` before calling).
 *   2. The rebuilt root is checked against `merkle_root`; a mismatch fails closed
 *      (`{ ok: false, reason: 'root_mismatch' }`) — we never serve proofs whose
 *      tree disagrees with the chain commitment.
 *
 * §00 MAJOR-5 hardening (the only behavioural addition over the extracted code):
 * for `content_category === 'personal'` we OMIT every per-leaf plaintext
 * `leaf_hash` / `content_hash` and the inclusion proof. A plaintext leaf hash
 * over a low-entropy personal memory ("home address = X") is a
 * guess-confirmation oracle for a stalker. The Merkle ROOT still anchors
 * provenance; only the per-leaf plaintext disclosure is suppressed. Omission is
 * the safe v1 — salting leaves so they still chain to the root is Part D, and we
 * deliberately do not half-build it here. (Personal packs cannot be listed in
 * Part A anyway; this is defence in depth on the shared helper.)
 */

import { buildPackTree, inclusionProof } from '@clude/tokenization';

// ─────────── Types ───────────

export type PackContentCategory = 'personal' | 'knowledge' | 'agent' | null;

/** The pack-metadata subset the preview header needs (already owner-resolved by the caller). */
export interface PreviewPack {
  pack_id: string;
  name: string;
  version: string;
  author_wallet: string;
  memory_count: number;
  merkle_root: string | null;
  pack_token_address: string | null;
  /** Server-derived category. `personal` suppresses per-leaf plaintext hashes. */
  content_category?: PackContentCategory;
}

/** One pack member, in `leaf_index` order. `content_hash` is the Merkle leaf. */
export interface PreviewMember {
  memory_id: number;
  leaf_index: number;
  content_hash: string;
}

/** Hydrated memory body for a revealed leaf (the route fetches these from `memories`). */
export interface PreviewMemoryBody {
  id: number;
  hash_id: string;
  memory_type: string;
  content: string;
  owner_wallet: string | null;
  created_at: string;
  tags: string[] | null;
}

export interface PreviewOptions {
  /** How many leaves to reveal (already clamped by the caller is fine; we clamp again). */
  count: number;
  /**
   * Hard ceiling on the revealed slice, mirroring the legacy route's cap of 10.
   * Defaults to 10. The caller may pass a tighter `preview_sample_count`.
   */
  maxReveal?: number;
}

/** A single entry in the full per-leaf disclosure surface (mirrors `pack_proof.json` leaves). */
export interface PreviewLeaf {
  leaf_index: number;
  /** Plaintext Merkle leaf hash. OMITTED for `personal` packs (oracle suppression). */
  leaf_hash?: string;
}

/** A revealed memory with its inclusion proof (legacy wire shape, category-aware). */
export interface RevealedMemory {
  memory: {
    id: string;
    type: string;
    content: string;
    owner: string | null;
    created_at: string;
    tags: string[];
  } | null;
  /** Plaintext leaf hash of this revealed leaf. OMITTED for `personal` packs. */
  content_hash?: string;
  leaf_index: number;
  /** Merkle inclusion proof. `null` for `personal` packs (no per-leaf disclosure). */
  proof: {
    leaf: string;
    leaf_index: number;
    siblings: string[];
    algorithm: string;
  } | null;
}

export type PackPreviewResult =
  | {
      ok: true;
      pack: {
        id: string;
        name: string;
        version: string;
        author: string;
        memory_count: number;
        merkle_root: string;
        pack_token_address: string | null;
      };
      merkleRoot: string;
      /** All members, in order. `leaf_hash` suppressed for personal packs. */
      leaves: PreviewLeaf[];
      revealed: RevealedMemory[];
      revealed_count: number;
      unrevealed_count: number;
    }
  | { ok: false; reason: 'no_contents' }
  | { ok: false; reason: 'root_mismatch'; builtRoot: string };

export interface CommitmentInput {
  merkle_root: string | null;
  memory_count: number;
}

export interface CommitmentResult {
  verified: boolean;
  reason: 'verified' | 'drift_detected' | 'no_contents';
  recomputedRoot: string | null;
  committedRoot: string | null;
}

// ─────────── Helpers ───────────

const DEFAULT_MAX_REVEAL = 10;

/**
 * Build a sealed-safe preview: rebuild the Merkle tree from the ordered members,
 * assert it matches the committed root, and reveal the first N leaves with
 * inclusion proofs. Pure — the caller owns all DB access and HTTP mapping.
 *
 * Precondition: `members` is sorted by `leaf_index` ascending (the route does this
 * via `.order('leaf_index', { ascending: true })`). `pack.merkle_root` must be set
 * (the route already 409s on a draft pack before calling).
 */
export function buildPackPreview(
  pack: PreviewPack,
  members: PreviewMember[],
  memoriesById: Map<number, PreviewMemoryBody>,
  opts: PreviewOptions,
): PackPreviewResult {
  if (members.length === 0) {
    return { ok: false, reason: 'no_contents' };
  }

  const isPersonal = pack.content_category === 'personal';

  // Rebuild the tree from the leaf hashes, in committed order.
  const tree = buildPackTree(members.map((m) => m.content_hash));

  // Safety: the rebuilt root MUST equal the on-chain commitment.
  if (tree.root !== pack.merkle_root) {
    return { ok: false, reason: 'root_mismatch', builtRoot: tree.root };
  }

  // Full per-leaf disclosure surface. For personal packs the plaintext leaf hash
  // is suppressed (the guess-confirmation oracle); index-only remains.
  const leaves: PreviewLeaf[] = members.map((m) =>
    isPersonal ? { leaf_index: m.leaf_index } : { leaf_index: m.leaf_index, leaf_hash: m.content_hash },
  );

  // Reveal the first `count` leaves (clamped to [1, maxReveal] then to member count).
  const maxReveal = opts.maxReveal ?? DEFAULT_MAX_REVEAL;
  const wanted = Math.max(1, Math.min(Number.isFinite(opts.count) ? opts.count : 1, maxReveal));
  const revealedSlice = members.slice(0, Math.min(wanted, members.length));

  const revealed: RevealedMemory[] = revealedSlice.map((row) => {
    const memory = memoriesById.get(row.memory_id) ?? null;
    const wireMemory = memory
      ? {
          id: memory.hash_id,
          type: memory.memory_type,
          content: memory.content,
          owner: memory.owner_wallet,
          created_at: memory.created_at,
          tags: memory.tags ?? [],
        }
      : null;

    // Personal packs: omit the plaintext leaf hash + inclusion proof entirely.
    if (isPersonal) {
      return { memory: wireMemory, leaf_index: row.leaf_index, proof: null };
    }

    const proof = inclusionProof(tree, row.leaf_index);
    return {
      memory: wireMemory,
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

  return {
    ok: true,
    pack: {
      id: pack.pack_id,
      name: pack.name,
      version: pack.version,
      author: pack.author_wallet,
      memory_count: pack.memory_count,
      merkle_root: tree.root,
      pack_token_address: pack.pack_token_address,
    },
    merkleRoot: tree.root,
    leaves,
    revealed,
    revealed_count: revealed.length,
    unrevealed_count: members.length - revealed.length,
  };
}

/**
 * Verify a pack's on-chain commitment by rebuilding the Merkle tree from its
 * members and comparing the recomputed root + member count against what was
 * committed. Pure — the caller owns DB access. Mirrors the legacy
 * `GET /v1/packs/:id/verify` body's "drift" semantics: the commitment is
 * `verified` iff the rebuilt root matches AND the member count agrees.
 */
export function verifyPackCommitment(
  pack: CommitmentInput,
  members: Array<{ content_hash: string }>,
): CommitmentResult {
  if (members.length === 0) {
    return { verified: false, reason: 'no_contents', recomputedRoot: null, committedRoot: pack.merkle_root };
  }

  const tree = buildPackTree(members.map((m) => m.content_hash));
  const verified = tree.root === pack.merkle_root && members.length === pack.memory_count;

  return {
    verified,
    reason: verified ? 'verified' : 'drift_detected',
    recomputedRoot: tree.root,
    committedRoot: pack.merkle_root,
  };
}
