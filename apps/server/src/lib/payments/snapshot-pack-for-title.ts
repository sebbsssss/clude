/**
 * snapshot-pack-for-title — freeze a pack into a title-governed SNAPSHOT (the sole-key model).
 *
 * Listing a pack as a Base TITLE must NOT re-key the creator's LIVE memories (selling a title would
 * otherwise disturb the creator's own brain access). Founder decision: a title governs a frozen
 * SNAPSHOT. This clones the source pack's members into a new, frozen memory set owned (DEK-wise) by
 * the creator's custodial Base identity, seals the snapshot's DEK to that identity as a `title_holder`
 * wrap, and registers a snapshot `memory_packs` + `pmp_artifacts` row the Base mint binds to. The
 * creator's ORIGINALS are untouched and stay in normal recall.
 *
 * THE BINDING (why the title commits to the SAME root the source anchored on Solana): a pack's
 * Merkle leaves are its members' `content_hash`es, snapshotted immutably in `memory_pack_contents`
 * at pack creation (migration 019) — and the pack `merkle_root` is `buildPackTree` over them. The
 * clones carry the SAME content, so the snapshot REUSES those exact leaves: its merkle_root equals
 * the source pack's, the one already committed on Solana. The clones exist purely for ACCESS
 * ISOLATION (a re-keyed DEK), never to re-derive a new commitment. This is why we never re-hash
 * content here — sidestepping the decrypt-then-hash subtlety for encrypted packs entirely.
 *
 * MONEY / ACCESS / DATA CODE. The DEK move mirrors grant-copy.ts (unwrap provider → wrap recipient);
 * the wrap layout (`provider` + `title_holder` keyed by holder_wallet=Base addr) is exactly what
 * title-saga.ts reads on a sale (recover DEK from the clone's provider wrap → reseal to the buyer).
 * Idempotent: a snapshot already registered for (source pack, creator) is returned untouched, and
 * member cloning is idempotent per source member (re-entry after a partial crash never duplicates).
 */

import { createHash, randomBytes } from 'node:crypto';
import { createChildLogger } from '@clude/shared/core/logger';
import { wrapDek, unwrapDek } from '@clude/shared/core/memory-envelope';
import { loadProviderKeypair, providerPublicKeyBase64 } from '@clude/shared/core/encryption-keys';
import type { BaseIdentityResolver } from './base-identity.js';
import { ensureCustodialTitleIdentity } from './base-title-identity.js';
import { computeArtifactBinding, PMP_FORMAT_VERSION } from '../pmp/artifact-core.js';

const log = createChildLogger('snapshot-pack-for-title');

/** A minimal Supabase-shaped handle (same structural type the title saga uses). */
export interface DbLike {
  from(table: string): any;
}

export interface SnapshotResult {
  /** The new frozen snapshot pack id (what the title is minted against). */
  snapshotPackId: string;
  /** The on-chain binding inputs the mint reads from pmp_artifacts (bare hex). */
  merkleRoot: string;
  manifestHash: string;
  memberCount: number;
  /** The creator's Base address the title is minted to + the snapshot DEKs are sealed to. */
  creatorBase: string;
  /** True when an existing snapshot was returned (idempotent no-op). */
  reused: boolean;
}

/** Deterministic snapshot pack id for (source pack, creator) so a retry collapses to one snapshot. */
function snapshotPackId(sourcePackId: string, creatorBase: string): string {
  const h = createHash('sha256').update(`${sourcePackId} ${creatorBase}`).digest('hex').slice(0, 12);
  return `tsnap-${h}`;
}

/** The member columns carried into a clone (mirrors grant-copy.ts SOURCE_MEMORY_COLUMNS + created_at). */
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
 * Freeze `sourcePackId` into a title-governed snapshot owned (DEK-wise) by `creatorAppWallet`'s
 * custodial Base identity. Returns the snapshot pack id + the on-chain binding for the title mint.
 *
 * @param db                Supabase client (threaded by the list-as-title route).
 * @param resolver          the custodial Base-identity resolver.
 * @param sourcePackId      the live, tokenised pack being listed as a title.
 * @param creatorAppWallet  the creator's Solana app wallet (the authenticated lister).
 */
export async function snapshotPackForTitle(
  db: DbLike,
  resolver: BaseIdentityResolver,
  sourcePackId: string,
  creatorAppWallet: string,
): Promise<SnapshotResult> {
  // 1) Resolve + publish the creator's custodial Base title identity (the DEK recipient).
  const { baseAddress: creatorBase, x25519PublicKeyB64 } = await ensureCustodialTitleIdentity(
    db,
    resolver,
    creatorAppWallet,
  );
  const snapId = snapshotPackId(sourcePackId, creatorBase);

  // 2) IDEMPOTENCY: a snapshot pack already registered for (source, creator) → return it untouched.
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
    log.info({ snapId, sourcePackId }, 'snapshotPackForTitle: snapshot already exists — idempotent no-op');
    return {
      snapshotPackId: snapId,
      merkleRoot: e.merkle_root,
      manifestHash: (artRow as { manifest_hash?: string } | null)?.manifest_hash ?? '',
      memberCount: e.memory_count,
      creatorBase,
      reused: true,
    };
  }

  // 3) Load the source pack (trusted author + the on-chain binding + descriptor) and its members in
  //    tree order. A title MUST bind a tokenised pack (a committed merkle_root) — refuse otherwise.
  const { data: packRaw, error: pErr } = await db
    .from('memory_packs')
    .select('pack_id, author_wallet, name, description, version, merkle_root, content_category')
    .eq('pack_id', sourcePackId)
    .maybeSingle();
  if (pErr) throw new Error('snapshotPackForTitle: failed to load source pack');
  const pack = packRaw as {
    author_wallet: string;
    name: string;
    description: string | null;
    version: string | null;
    merkle_root: string | null;
    content_category: 'personal' | 'knowledge' | 'agent' | null;
  } | null;
  if (!pack) throw new Error(`snapshotPackForTitle: source pack ${sourcePackId} not found`);
  // SELF-PROTECTING INVARIANT (do not rely on the route's 403): only the pack's AUTHOR may title it.
  // A future caller (a list route, a reconciliation poller) passing another tenant's pack id must not
  // be able to snapshot + re-key someone else's memories into an attacker-owned title.
  if (pack.author_wallet !== creatorAppWallet) {
    throw new Error('snapshotPackForTitle: caller is not the source pack author — refusing to title');
  }
  if (!pack.merkle_root) {
    throw new Error(`snapshotPackForTitle: source pack ${sourcePackId} is not tokenised (no merkle_root) — cannot title it`);
  }

  const { data: contentsRaw, error: cErr } = await db
    .from('memory_pack_contents')
    .select('memory_id, leaf_index, content_hash')
    .eq('pack_id', sourcePackId)
    .order('leaf_index', { ascending: true });
  if (cErr) throw new Error('snapshotPackForTitle: failed to load source pack contents');
  const contents = (contentsRaw ?? []) as Array<{ memory_id: number; leaf_index: number; content_hash: string }>;
  if (contents.length === 0) throw new Error(`snapshotPackForTitle: source pack ${sourcePackId} has no members`);
  const memberIds = contents.map((c) => c.memory_id);

  // 4) Hydrate the member memories, scoped to the source pack AUTHOR (defence in depth — a tampered
  //    contents row pointing at another tenant's memory simply won't load).
  const { data: memsRaw, error: mErr } = await db
    .from('memories')
    .select(MEMBER_COLUMNS)
    .in('id', memberIds)
    .eq('owner_wallet', pack.author_wallet);
  if (mErr) throw new Error('snapshotPackForTitle: failed to load source member memories');
  const memberById = new Map<number, MemberMemory>();
  for (const m of (memsRaw ?? []) as MemberMemory[]) memberById.set(m.id, m);
  // Ordered, owner-verified member list (drops any id that failed the owner scope). Each leaf is the
  // source pack's snapshotted content_hash — the SAME committed value the source root was built from.
  const members: Array<{ leafIndex: number; leaf: string; mem: MemberMemory }> = [];
  for (const c of contents) {
    const mem = memberById.get(c.memory_id);
    if (mem) members.push({ leafIndex: c.leaf_index, leaf: c.content_hash, mem });
  }
  if (members.length === 0) {
    throw new Error('snapshotPackForTitle: source members not owned by author — refusing to snapshot');
  }

  // 5) Compute the binding from the source's COMMITTED leaves (members are already in leaf_index
  //    order) and assert it equals the source's stored root BEFORE any writes — fail fast on an
  //    inconsistent source rather than leaving orphan clones. The snapshot reuses the EXACT root the
  //    source anchored on Solana; only the access layer (the DEK wrap) is isolated.
  const orderedLeaves = members.map((m) => m.leaf);
  const binding = computeArtifactBinding(orderedLeaves, {
    title: pack.name,
    description: pack.description,
    licenseType: 'title',
    contentSource: pack.content_category,
    owner: creatorBase,
  });
  if (binding.merkleRoot !== pack.merkle_root) {
    throw new Error(
      `snapshotPackForTitle: recomputed root ${binding.merkleRoot.slice(0, 12)} != source root ${pack.merkle_root.slice(0, 12)} — source pack commitment is inconsistent`,
    );
  }

  // 6) Encryption material: provider DEK wraps for the members (their presence = the pack is encrypted).
  const { data: provRaw, error: wErr } = await db
    .from('memory_dek_wraps')
    .select('memory_id, wrapped_dek, wrap_pubkey, recipient')
    .in('memory_id', memberIds)
    .eq('recipient', 'provider');
  if (wErr) throw new Error('snapshotPackForTitle: failed to load source provider DEK wraps');
  const providerWrap = new Map<number, { wrapped_dek: string; wrap_pubkey: string }>();
  for (const w of (provRaw ?? []) as Array<{ memory_id: number; wrapped_dek: string; wrap_pubkey: string }>) {
    providerWrap.set(w.memory_id, { wrapped_dek: w.wrapped_dek, wrap_pubkey: w.wrap_pubkey });
  }
  const encrypted = providerWrap.size > 0;

  let providerSecret: Uint8Array | null = null;
  let providerPubBytes: Uint8Array | null = null;
  const creatorPubkey = new Uint8Array(Buffer.from(x25519PublicKeyB64, 'base64'));
  if (encrypted) {
    try {
      providerSecret = loadProviderKeypair().secretKey;
      providerPubBytes = new Uint8Array(Buffer.from(providerPublicKeyBase64(), 'base64'));
    } catch (err) {
      log.error({ err, sourcePackId }, 'snapshotPackForTitle: provider keypair unavailable');
      throw new Error('snapshotPackForTitle: provider encryption key unavailable');
    }
  }

  // 6) Per-member idempotency: which source members already have a clone for THIS snapshot (re-entry
  //    after a partial crash must reuse, never duplicate). Keyed by metadata.title_snapshot_of_member.
  const snapTag = `title_snapshot:${snapId}`;
  const { data: priorClonesRaw } = await db
    .from('memories')
    .select('id, metadata')
    .eq('owner_wallet', creatorBase)
    .contains('metadata', { title_snapshot_pack: snapId });
  const cloneBySourceId = new Map<number, number>();
  for (const r of (priorClonesRaw ?? []) as Array<{ id: number; metadata: Record<string, unknown> | null }>) {
    const srcId = r.metadata?.title_snapshot_of_member;
    if (typeof srcId === 'number') cloneBySourceId.set(srcId, r.id);
  }

  // 7) Clone each member into the creator's Base namespace (frozen), sealing its DEK wraps. The clone's
  //    content_hash is the SAME committed leaf — so the snapshot's contents + root match the source's.
  const nowIso = new Date().toISOString();
  const snapLeaves: Array<{ memory_id: number; leaf_index: number; content_hash: string }> = [];
  for (const { leafIndex, leaf, mem } of members) {
    let cloneId = cloneBySourceId.get(mem.id);
    if (cloneId === undefined) {
      const baseTags = Array.isArray(mem.tags) ? mem.tags.filter((t) => t !== snapTag) : [];
      const { data: cloneRow, error: insErr } = await db
        .from('memories')
        .insert({
          // memories.hash_id is NOT NULL (migration 003) with no DB default — every clone needs a
          // fresh unique external id (idx_memories_hash_id is global-unique, so never reuse the
          // source's). Same `clude-<8hex>` shape as generateHashId() in the brain.
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
          owner_wallet: creatorBase,
          content_hash: leaf, // the committed leaf — identical to the source member's
          encrypted: encrypted ? true : mem.encrypted ?? false,
          provider_delegated: encrypted,
          event_date: mem.event_date ?? null,
          event_date_precision: mem.event_date_precision ?? null,
          created_at: mem.created_at ?? nowIso, // preserve the source timestamp (frozen copy)
          last_accessed: nowIso,
        })
        .select('id')
        .single();
      if (insErr || !cloneRow) throw new Error('snapshotPackForTitle: failed to clone a member memory');
      cloneId = (cloneRow as { id: number }).id;

      if (encrypted) {
        const pw = providerWrap.get(mem.id);
        if (!pw) throw new Error(`snapshotPackForTitle: encrypted member ${mem.id} missing provider wrap`);
        const dek = unwrapDek(pw.wrapped_dek, pw.wrap_pubkey, providerSecret!);
        if (!dek) throw new Error(`snapshotPackForTitle: failed to recover DEK for member ${mem.id}`);
        // Provider wrap on the clone (so a future title sale can re-key the DEK to the buyer) + a
        // title_holder wrap to the creator (so the creator decrypts the snapshot via the title held).
        const provSealed = wrapDek(dek, providerPubBytes!);
        const holderSealed = wrapDek(dek, creatorPubkey);
        const { error: dErr } = await db.from('memory_dek_wraps').insert([
          { memory_id: cloneId, recipient: 'provider', wrapped_dek: provSealed.wrapped, wrap_pubkey: provSealed.wrapPubkey, holder_wallet: null, created_at: nowIso },
          { memory_id: cloneId, recipient: 'title_holder', wrapped_dek: holderSealed.wrapped, wrap_pubkey: holderSealed.wrapPubkey, holder_wallet: creatorBase, created_at: nowIso },
        ]);
        // A racing re-entry may have sealed them first; a unique collision is the idempotent no-op.
        if (dErr && (dErr as { code?: string }).code !== '23505') {
          throw new Error('snapshotPackForTitle: failed to seal snapshot DEK wraps');
        }
      }
    }
    snapLeaves.push({ memory_id: cloneId, leaf_index: leafIndex, content_hash: leaf });
  }

  // 9) Register the snapshot pack (real memory_packs columns only — NO manifest_hash column here).
  const { error: packInsErr } = await db.from('memory_packs').insert({
    pack_id: snapId,
    author_wallet: creatorBase,
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
    throw new Error('snapshotPackForTitle: failed to insert snapshot pack');
  }

  const contentRows = snapLeaves.map((l) => ({
    pack_id: snapId,
    memory_id: l.memory_id,
    leaf_index: l.leaf_index,
    content_hash: l.content_hash,
  }));
  const { error: contentsInsErr } = await db.from('memory_pack_contents').insert(contentRows);
  if (contentsInsErr && (contentsInsErr as { code?: string }).code !== '23505') {
    throw new Error('snapshotPackForTitle: failed to insert snapshot pack contents');
  }

  // 10) Register the pmp_artifacts binding the Base mint reads (full real column shape, license 'title').
  const { error: artErr } = await db.from('pmp_artifacts').insert({
    artifact_id: `pmpa-${randomBytes(4).toString('hex')}`,
    pack_id: snapId,
    owner_wallet: creatorBase,
    pmp_version: PMP_FORMAT_VERSION,
    title: pack.name,
    description: pack.description,
    license_type: 'title',
    record_count: members.length,
    merkle_root: binding.merkleRoot,
    manifest_hash: binding.manifestHash,
    creator_pubkey: creatorBase,
    manifest_sig: '',
    encryption_scope: 'none',
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
      // pmp_artifacts UNIQUE is (owner_wallet, manifest_hash) — NOT pack_id. A 23505 is benign ONLY
      // if the existing row is THIS snapshot's (a retry). If it belongs to a DIFFERENT pack — two
      // distinct source packs with byte-identical content + name by the same creator hash to the same
      // manifest — the mint would later find no binding for this snapId. Fail LOUD, never silently
      // strand a snapshot with no artifact.
      const { data: own } = await db
        .from('pmp_artifacts')
        .select('pack_id')
        .eq('pack_id', snapId)
        .maybeSingle();
      if (!own) {
        throw new Error(
          'snapshotPackForTitle: artifact manifest collided with another identical-content pack — cannot title duplicate-content packs',
        );
      }
    } else {
      throw new Error('snapshotPackForTitle: failed to register snapshot artifact');
    }
  }

  log.info(
    { snapId, sourcePackId, creatorBase: creatorBase.slice(0, 10), members: members.length, encrypted },
    'snapshotPackForTitle: froze a title snapshot (creator originals untouched)',
  );
  return { snapshotPackId: snapId, merkleRoot: binding.merkleRoot, manifestHash: binding.manifestHash, memberCount: members.length, creatorBase, reused: false };
}
