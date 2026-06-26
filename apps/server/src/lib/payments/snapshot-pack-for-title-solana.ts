/**
 * snapshot-pack-for-title-solana — freeze a pack into a title-governed SNAPSHOT, NON-CUSTODIAL.
 *
 * The Solana-native analog of snapshot-pack-for-title.ts (Base, custodial). Listing/selling a pack TITLE
 * must NOT re-key the creator's LIVE memories, so a title governs a frozen SNAPSHOT: a clone of the
 * pack's members in a recall-isolated namespace, bound to the SAME committed Merkle root (the clones
 * carry the exact source leaves — no re-hash), with the snapshot's DEK sealed so the title HOLDER can
 * decrypt. The creator's originals are untouched.
 *
 * WHAT DIFFERS FROM BASE (the non-custodial pivot):
 *   - No custodial identity. Base derives a custodial Base address (ensureCustodialTitleIdentity) and
 *     seals the title_holder wrap to a server-held key. Here the title is held in the user's OWN Solana
 *     wallet, so the title_holder wrap seals to the user's OWN published x25519 key (encryption_keys for
 *     their Solana app wallet) with holder_wallet = that wallet. On a sale this rotates to the buyer's
 *     own key — the same provider-recover→reseal move as Base (title-saga.ts), just with real user
 *     wallets as holders.
 *   - Clone owner_wallet = the snapshot pack id (a recall-isolated DB scope, the role creatorBase plays
 *     on Base). Recall is scoped per owner_wallet, so the clones never surface in the creator's recall —
 *     the same isolation guarantee the Base snapshot relies on.
 *
 * THE BINDING: the clones reuse the source members' committed content_hash leaves, so buildPackTree over
 * them yields the SAME merkle_root the source anchored on Solana. We assert equality before any writes.
 *
 * MONEY / ACCESS / DATA CODE. The DEK move mirrors snapshot-pack-for-title.ts + grant-copy.ts (unwrap
 * provider → wrap recipient). Idempotent: an existing snapshot for (source, creator) is returned
 * untouched, and per-member cloning is idempotent (re-entry after a partial crash never duplicates).
 * Injected db → unit-tested with a mock, no live chain.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createChildLogger } from '@clude/shared/core/logger';
import { wrapDek, unwrapDek } from '@clude/shared/core/memory-envelope';
import { loadProviderKeypair, providerPublicKeyBase64 } from '@clude/shared/core/encryption-keys';
import { computeArtifactBinding, PMP_FORMAT_VERSION } from '../pmp/artifact-core.js';

const log = createChildLogger('snapshot-pack-for-title-solana');

/** A minimal Supabase-shaped handle (same structural type the Base snapshot uses). */
export interface DbLike {
  from(table: string): any;
}

export interface SolanaSnapshotResult {
  /** The new frozen snapshot pack id (what the Solana title is minted against). */
  snapshotPackId: string;
  /** The on-chain binding inputs the mint reads from pmp_artifacts (bare hex). */
  merkleRoot: string;
  manifestHash: string;
  memberCount: number;
  /** True when an existing snapshot was returned (idempotent no-op). */
  reused: boolean;
}

/** Deterministic snapshot pack id for (source pack, creator wallet) so a retry collapses to one snapshot. */
export function solanaSnapshotPackId(sourcePackId: string, creatorWallet: string): string {
  const h = createHash('sha256').update(`solana-title-snap ${sourcePackId} ${creatorWallet}`).digest('hex').slice(0, 12);
  return `tsnap-sol-${h}`;
}

/** The member columns carried into a clone (mirrors the Base snapshot's set). */
const MEMBER_COLUMNS =
  'id, memory_type, content, summary, tags, concepts, emotional_valence, importance, source, ' +
  'related_user, related_wallet, metadata, decay_factor, encrypted, encryption_pubkey, ' +
  'event_date, event_date_precision, created_at, content_hash';

interface MemberMemory {
  id: number;
  memory_type: string;
  content: string;
  summary: string | null;
  tags: string[] | null;
  concepts: string[] | null;
  emotional_valence: number | null;
  importance: number | null;
  source: string | null;
  related_user: string | null;
  related_wallet: string | null;
  metadata: Record<string, unknown> | null;
  decay_factor: number | null;
  encrypted: boolean | null;
  encryption_pubkey: string | null;
  event_date: string | null;
  event_date_precision: string | null;
  created_at: string;
  content_hash: string | null;
}

/**
 * Freeze `sourcePackId` into a non-custodial title snapshot governed by `creatorWallet`'s OWN Solana
 * wallet. Returns the snapshot pack id + the on-chain binding for the Solana title mint.
 *
 * @param db             Supabase client (threaded by the export route).
 * @param sourcePackId   the live, tokenised pack being titled.
 * @param creatorWallet  the creator's Solana app wallet (the authenticated exporter + the title holder).
 */
export async function snapshotPackForTitleSolana(
  db: DbLike,
  sourcePackId: string,
  creatorWallet: string,
): Promise<SolanaSnapshotResult> {
  const snapId = solanaSnapshotPackId(sourcePackId, creatorWallet);

  // 1) IDEMPOTENCY: a snapshot pack already registered for (source, creator) → return it untouched.
  const { data: existing } = await db
    .from('memory_packs')
    .select('pack_id, merkle_root, memory_count')
    .eq('pack_id', snapId)
    .maybeSingle();
  if (existing) {
    const e = existing as { merkle_root: string; memory_count: number };
    const { data: artRow } = await db
      .from('pmp_artifacts')
      .select('manifest_hash')
      .eq('pack_id', snapId)
      .maybeSingle();
    log.info({ snapId, sourcePackId }, 'snapshotPackForTitleSolana: snapshot already exists — idempotent no-op');
    return {
      snapshotPackId: snapId,
      merkleRoot: e.merkle_root,
      manifestHash: (artRow as { manifest_hash?: string } | null)?.manifest_hash ?? '',
      memberCount: e.memory_count,
      reused: true,
    };
  }

  // 2) Load the source pack (trusted author + the on-chain binding + descriptor). A title MUST bind a
  //    tokenised pack (a committed merkle_root) — refuse otherwise.
  const { data: packRaw, error: pErr } = await db
    .from('memory_packs')
    .select('pack_id, author_wallet, name, description, version, merkle_root, content_category')
    .eq('pack_id', sourcePackId)
    .maybeSingle();
  if (pErr) throw new Error('snapshotPackForTitleSolana: failed to load source pack');
  const pack = packRaw as {
    author_wallet: string;
    name: string;
    description: string | null;
    version: string | null;
    merkle_root: string | null;
    content_category: 'personal' | 'knowledge' | 'agent' | null;
  } | null;
  if (!pack) throw new Error(`snapshotPackForTitleSolana: source pack ${sourcePackId} not found`);
  // SELF-PROTECTING INVARIANT (do not rely on the route's 403): only the pack's AUTHOR may title it. A
  // caller passing another tenant's pack id must not be able to snapshot + re-key their memories.
  if (pack.author_wallet !== creatorWallet) {
    throw new Error('snapshotPackForTitleSolana: caller is not the source pack author — refusing to title');
  }
  if (!pack.merkle_root) {
    throw new Error(`snapshotPackForTitleSolana: source pack ${sourcePackId} is not tokenised (no merkle_root) — cannot title it`);
  }

  const { data: contentsRaw, error: cErr } = await db
    .from('memory_pack_contents')
    .select('memory_id, leaf_index, content_hash')
    .eq('pack_id', sourcePackId)
    .order('leaf_index', { ascending: true });
  if (cErr) throw new Error('snapshotPackForTitleSolana: failed to load source pack contents');
  const contents = (contentsRaw ?? []) as Array<{ memory_id: number; leaf_index: number; content_hash: string }>;
  if (contents.length === 0) throw new Error(`snapshotPackForTitleSolana: source pack ${sourcePackId} has no members`);
  const memberIds = contents.map((c) => c.memory_id);

  // 3) Hydrate the members, scoped to the source pack AUTHOR (defence in depth — a tampered contents
  //    row pointing at another tenant's memory simply won't load).
  const { data: memsRaw, error: mErr } = await db
    .from('memories')
    .select(MEMBER_COLUMNS)
    .in('id', memberIds)
    .eq('owner_wallet', pack.author_wallet);
  if (mErr) throw new Error('snapshotPackForTitleSolana: failed to load source member memories');
  const memberById = new Map<number, MemberMemory>();
  for (const m of (memsRaw ?? []) as MemberMemory[]) memberById.set(m.id, m);
  const members: Array<{ leafIndex: number; leaf: string; mem: MemberMemory }> = [];
  for (const c of contents) {
    const mem = memberById.get(c.memory_id);
    if (mem) members.push({ leafIndex: c.leaf_index, leaf: c.content_hash, mem });
  }
  if (members.length === 0) {
    throw new Error('snapshotPackForTitleSolana: source members not owned by author — refusing to snapshot');
  }

  // 4) Compute the binding from the source's COMMITTED leaves and assert it equals the stored root
  //    BEFORE any writes — the snapshot reuses the EXACT root the source anchored on Solana; only the
  //    access layer (the DEK wrap) is isolated.
  const orderedLeaves = members.map((m) => m.leaf);
  const binding = computeArtifactBinding(orderedLeaves, {
    title: pack.name,
    description: pack.description,
    licenseType: 'title',
    contentSource: pack.content_category,
    owner: creatorWallet,
  });
  if (binding.merkleRoot !== pack.merkle_root) {
    throw new Error(
      `snapshotPackForTitleSolana: recomputed root ${binding.merkleRoot.slice(0, 12)} != source root ${pack.merkle_root.slice(0, 12)} — source pack commitment is inconsistent`,
    );
  }

  // 5) Encryption material: provider DEK wraps for the members (their presence = the pack is encrypted).
  const { data: provRaw, error: wErr } = await db
    .from('memory_dek_wraps')
    .select('memory_id, wrapped_dek, wrap_pubkey, recipient')
    .in('memory_id', memberIds)
    .eq('recipient', 'provider');
  if (wErr) throw new Error('snapshotPackForTitleSolana: failed to load source provider DEK wraps');
  const providerWrap = new Map<number, { wrapped_dek: string; wrap_pubkey: string }>();
  for (const w of (provRaw ?? []) as Array<{ memory_id: number; wrapped_dek: string; wrap_pubkey: string }>) {
    providerWrap.set(w.memory_id, { wrapped_dek: w.wrapped_dek, wrap_pubkey: w.wrap_pubkey });
  }
  const encrypted = providerWrap.size > 0;

  // For an ENCRYPTED pack the title_holder wrap seals to the creator's OWN published Solana key (the
  // non-custodial recipient). Fail closed if they have no published key — we must never strand an
  // encrypted snapshot the holder cannot decrypt.
  let providerSecret: Uint8Array | null = null;
  let providerPubBytes: Uint8Array | null = null;
  let creatorPubkey: Uint8Array | null = null;
  if (encrypted) {
    const { data: keyRow, error: kErr } = await db
      .from('encryption_keys')
      .select('x25519_pubkey')
      .eq('owner_wallet', creatorWallet)
      .maybeSingle();
    if (kErr) throw new Error('snapshotPackForTitleSolana: failed to load creator encryption key');
    const pub = (keyRow as { x25519_pubkey?: string } | null)?.x25519_pubkey;
    if (!pub) {
      throw new Error(
        `snapshotPackForTitleSolana: creator ${creatorWallet.slice(0, 10)} has no published encryption key — cannot title an encrypted pack non-custodially`,
      );
    }
    creatorPubkey = new Uint8Array(Buffer.from(pub, 'base64'));
    try {
      providerSecret = loadProviderKeypair().secretKey;
      providerPubBytes = new Uint8Array(Buffer.from(providerPublicKeyBase64(), 'base64'));
    } catch (err) {
      log.error({ err, sourcePackId }, 'snapshotPackForTitleSolana: provider keypair unavailable');
      throw new Error('snapshotPackForTitleSolana: provider encryption key unavailable');
    }
  }

  // 6) Per-member idempotency: which source members already have a clone for THIS snapshot.
  const snapTag = `title_snapshot:${snapId}`;
  const { data: priorClonesRaw } = await db
    .from('memories')
    .select('id, metadata')
    .eq('owner_wallet', snapId)
    .contains('metadata', { title_snapshot_pack: snapId });
  const cloneBySourceId = new Map<number, number>();
  for (const r of (priorClonesRaw ?? []) as Array<{ id: number; metadata: Record<string, unknown> | null }>) {
    const srcId = r.metadata?.title_snapshot_of_member;
    if (typeof srcId === 'number') cloneBySourceId.set(srcId, r.id);
  }

  // 7) Clone each member into the snapshot namespace (owner_wallet = snapId → recall-isolated), sealing
  //    its DEK wraps. The clone's content_hash is the SAME committed leaf, so the root matches.
  const nowIso = new Date().toISOString();
  const snapLeaves: Array<{ memory_id: number; leaf_index: number; content_hash: string }> = [];
  for (const { leafIndex, leaf, mem } of members) {
    let cloneId = cloneBySourceId.get(mem.id);
    if (cloneId === undefined) {
      const baseTags = Array.isArray(mem.tags) ? mem.tags.filter((t) => t !== snapTag) : [];
      const { data: cloneRow, error: insErr } = await db
        .from('memories')
        .insert({
          // memories.hash_id is NOT NULL with no DB default — every clone needs a fresh unique id.
          hash_id: `clude-${randomBytes(4).toString('hex')}`,
          memory_type: mem.memory_type,
          content: mem.content,
          summary: mem.summary,
          tags: [...baseTags, snapTag],
          concepts: mem.concepts ?? [],
          emotional_valence: mem.emotional_valence ?? 0,
          importance: mem.importance ?? 0.5,
          access_count: 0,
          source: mem.source ?? snapTag,
          related_user: mem.related_user ?? null,
          related_wallet: mem.related_wallet ?? null,
          metadata: {
            ...(mem.metadata ?? {}),
            title_snapshot_pack: snapId,
            title_snapshot_of: sourcePackId,
            title_snapshot_of_member: mem.id,
          },
          decay_factor: mem.decay_factor ?? 1.0,
          owner_wallet: snapId, // recall-isolated snapshot namespace
          content_hash: leaf, // the committed leaf — identical to the source member's
          // 'skipped': the clone INHERITS the source's committed leaf, so it must never be re-tokenised.
          // pmp-backfill.ts recomputes content_hash for NULL/'failed' rows, and memoryContentHash mixes in
          // owner_wallet (= snapId here) — a backfill would corrupt the clone's leaf. This excludes it.
          tokenization_status: 'skipped',
          encrypted: encrypted ? true : mem.encrypted ?? false,
          provider_delegated: encrypted,
          event_date: mem.event_date ?? null,
          event_date_precision: mem.event_date_precision ?? null,
          created_at: mem.created_at ?? nowIso,
          last_accessed: nowIso,
        })
        .select('id')
        .single();
      if (insErr || !cloneRow) throw new Error('snapshotPackForTitleSolana: failed to clone a member memory');
      cloneId = (cloneRow as { id: number }).id;

      if (encrypted) {
        const pw = providerWrap.get(mem.id);
        if (!pw) throw new Error(`snapshotPackForTitleSolana: encrypted member ${mem.id} missing provider wrap`);
        const dek = unwrapDek(pw.wrapped_dek, pw.wrap_pubkey, providerSecret!);
        if (!dek) throw new Error(`snapshotPackForTitleSolana: failed to recover DEK for member ${mem.id}`);
        // provider wrap on the clone (so a future sale can re-key the DEK to the buyer) + a title_holder
        // wrap to the CREATOR'S OWN Solana wallet (non-custodial: the holder decrypts via their key).
        const provSealed = wrapDek(dek, providerPubBytes!);
        const holderSealed = wrapDek(dek, creatorPubkey!);
        const { error: dErr } = await db.from('memory_dek_wraps').insert([
          { memory_id: cloneId, recipient: 'provider', wrapped_dek: provSealed.wrapped, wrap_pubkey: provSealed.wrapPubkey, holder_wallet: null, created_at: nowIso },
          { memory_id: cloneId, recipient: 'title_holder', wrapped_dek: holderSealed.wrapped, wrap_pubkey: holderSealed.wrapPubkey, holder_wallet: creatorWallet, created_at: nowIso },
        ]);
        if (dErr && (dErr as { code?: string }).code !== '23505') {
          throw new Error('snapshotPackForTitleSolana: failed to seal snapshot DEK wraps');
        }
      }
    }
    snapLeaves.push({ memory_id: cloneId, leaf_index: leafIndex, content_hash: leaf });
  }

  // 8) Register the snapshot pack (owned by the snapshot namespace).
  const { error: packInsErr } = await db.from('memory_packs').insert({
    pack_id: snapId,
    author_wallet: snapId,
    name: `${pack.name} — title snapshot`,
    description: pack.description,
    version: pack.version ?? '1.0.0',
    memory_count: members.length,
    merkle_root: binding.merkleRoot,
    sale_mode: 'title',
    content_category: pack.content_category,
    created_at: nowIso,
    published_at: nowIso,
  });
  if (packInsErr && (packInsErr as { code?: string }).code !== '23505') {
    throw new Error('snapshotPackForTitleSolana: failed to insert snapshot pack');
  }

  const contentRows = snapLeaves.map((l) => ({
    pack_id: snapId,
    memory_id: l.memory_id,
    leaf_index: l.leaf_index,
    content_hash: l.content_hash,
  }));
  const { error: contentsInsErr } = await db.from('memory_pack_contents').insert(contentRows);
  if (contentsInsErr && (contentsInsErr as { code?: string }).code !== '23505') {
    throw new Error('snapshotPackForTitleSolana: failed to insert snapshot pack contents');
  }

  // 9) Register the pmp_artifacts binding the Solana title mint reads (license 'title').
  const { error: artErr } = await db.from('pmp_artifacts').insert({
    artifact_id: `pmpa-${randomBytes(4).toString('hex')}`,
    pack_id: snapId,
    owner_wallet: snapId,
    pmp_version: PMP_FORMAT_VERSION,
    title: pack.name,
    description: pack.description,
    license_type: 'title',
    record_count: members.length,
    merkle_root: binding.merkleRoot,
    manifest_hash: binding.manifestHash,
    creator_pubkey: creatorWallet,
    manifest_sig: '',
    encryption_scope: encrypted ? 'pack' : 'none',
    storage_url: null,
    byte_size: null,
    source_kind: 'web',
    signing_device_id: null,
    anchor_chain: null,
    anchor_tx_sig: null,
    created_at: nowIso,
  });
  if (artErr) {
    if ((artErr as { code?: string }).code === '23505') {
      // pmp_artifacts UNIQUE is (owner_wallet, manifest_hash). owner_wallet here is the unique snapId,
      // so a 23505 means a retry of THIS snapshot — benign only if the existing row is this snapId's.
      const { data: own } = await db.from('pmp_artifacts').select('pack_id').eq('pack_id', snapId).maybeSingle();
      if (!own) throw new Error('snapshotPackForTitleSolana: artifact manifest collision — cannot register snapshot binding');
    } else {
      throw new Error('snapshotPackForTitleSolana: failed to register snapshot artifact');
    }
  }

  log.info(
    { snapId, sourcePackId, creator: creatorWallet.slice(0, 10), members: members.length, encrypted },
    'snapshotPackForTitleSolana: froze a non-custodial title snapshot (creator originals untouched)',
  );
  return { snapshotPackId: snapId, merkleRoot: binding.merkleRoot, manifestHash: binding.manifestHash, memberCount: members.length, reused: false };
}
