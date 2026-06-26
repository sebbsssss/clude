/**
 * grantCopy — COPY-license delivery (the deliver(order) callback the durable
 * delivery-dispatcher injects).
 *
 * Tradeable Memory Packs — Slice 1, Part B (chunk 2), Task 1
 * (spec §1.2 Flow A step 8 · §2 pack_entitlements · §00 B2 + M10).
 *
 * MONEY/DATA CODE. A buyer paid for a copy-license pack; this delivers it. The contract,
 * exactly per the spec:
 *
 *   1. Clone each of the pack's MEMBER memories into the BUYER's namespace
 *      (owner_wallet = order.buyer_wallet, a fresh BIGSERIAL id), tagged
 *      `imported_from_pack:<pack_id>` (in both `tags` and `metadata`). The creator KEEPS
 *      their copy — the source rows are never mutated. The provenance tag is also the hook
 *      the §00 M10 refund clawback keys off to DELETE these rows on a chargeback.
 *
 *   2. If the pack is ENCRYPTED (its member memories carry provider DEK wraps), seal a fresh
 *      buyer DEK wrap PER cloned memory: recover the per-memory DEK from the provider wrap
 *      (loadProviderKeypair + unwrapDek, the same move `revokeMemory` makes), then
 *      `wrapDek(dek, buyerPubkey)` and store it as the clone's `owner` wrap. The buyer can
 *      then decrypt their own copy. A plaintext pack writes no wraps.
 *
 *   3. Insert `pack_entitlements(pack_id, holder_wallet=buyer, grant_kind='copy_license',
 *      status='active', order_id)`. This is the SINGLE off-chain authority the copy unlock
 *      honours — copy mode NEVER touches the chain / a token balance (§00 B2: the balance
 *      path is the title double-spend bug; deleted for copy).
 *
 *   4. IDEMPOTENT. The dispatcher may re-invoke deliver() for the same order after a crash.
 *      An already-active `copy_license` grant for (pack_id, buyer) short-circuits the whole
 *      delivery — no re-clone, no second entitlement. The DB UNIQUE(pack_id, holder_wallet,
 *      grant_kind) is the backstop: even if two sweeps race past the pre-check, the loser's
 *      entitlement insert hits 23505 and we treat it as the idempotent no-op it is.
 *
 * Owner-scoping: member memories are loaded scoped to the pack's `author_wallet` (defence in
 * depth — a tampered `memory_pack_contents` row cannot pull another tenant's memory into a
 * buyer's brain). The entitlement + clones are written to the buyer's namespace only.
 */

import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';
import { wrapDek, unwrapDek } from '@clude/shared/core/memory-envelope';
import { loadProviderKeypair } from '@clude/shared/core/encryption-keys';
import type { OrderRow } from './order-orchestrator.js';

const log = createChildLogger('grant-copy');

/** Memory columns we carry into the buyer's clone. On-chain / identity columns are dropped. */
interface SourceMemory {
  id: number;
  memory_type: string;
  content: string;
  summary: string;
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
}

const SOURCE_MEMORY_COLUMNS =
  'id, memory_type, content, summary, tags, concepts, emotional_valence, importance, ' +
  'source, related_user, related_wallet, metadata, decay_factor, encrypted, ' +
  'encryption_pubkey, event_date, event_date_precision';

/**
 * Deliver a COPY-license pack to its buyer. Safe to call repeatedly for the same order.
 *
 * Matches the dispatcher's `DeliverFn` signature `(order: OrderRow) => Promise<void>`. Throws
 * on a genuine failure (DB error, an encrypted pack whose buyer has not published an
 * encryption key) so the dispatcher leaves the order recoverable for the next sweep — never
 * silently half-delivers.
 */
export async function grantCopy(order: OrderRow): Promise<void> {
  // DEFENCE IN DEPTH (the copy dispatcher already filters titles out): NEVER clone a TITLE order.
  // A title sale moves the 1-of-1 NFT via its own saga; cloning would hand the buyer a plaintext-
  // equivalent copy of a 1-of-1 and defeat the title model. Fail loud rather than silently clone.
  if (order.listing_kind === 'title') {
    throw new Error(`grantCopy: refusing to clone a TITLE order ${order.order_id} — titles transfer via the saga, not a copy`);
  }
  const buyer = order.buyer_wallet;
  if (!buyer) {
    // A copy must land in a named namespace; a keyless (email-only) buyer cannot receive one
    // in this slice. Surface loudly — the dispatcher records the failure, the order is
    // recoverable, and the buyer is made whole by the refund path rather than half-delivered.
    throw new Error(`grantCopy: order ${order.order_id} has no buyer_wallet — cannot deliver a copy`);
  }
  const packId = order.pack_id;
  const db = getDb();

  // 1) IDEMPOTENCY SHORT-CIRCUIT. An already-active copy_license grant for (pack, buyer) means a
  //    prior sweep already delivered. Do nothing — never re-clone (UNIQUE backstops a race).
  const { data: existing, error: existErr } = await db
    .from('pack_entitlements')
    .select('id, status')
    .eq('pack_id', packId)
    .eq('holder_wallet', buyer)
    .eq('grant_kind', 'copy_license')
    .eq('status', 'active')
    .maybeSingle();
  if (existErr) {
    log.error({ err: existErr, orderId: order.order_id, packId }, 'grantCopy: entitlement lookup failed');
    throw new Error('grantCopy: failed to check existing entitlement');
  }
  if (existing) {
    log.info({ orderId: order.order_id, packId, buyer: buyer.slice(0, 8) }, 'grantCopy: active copy entitlement already present — idempotent no-op');
    return;
  }

  // 2) Load the pack to get its trusted author_wallet (the namespace member memories live in).
  const { data: pack, error: packErr } = await db
    .from('memory_packs')
    .select('pack_id, author_wallet')
    .eq('pack_id', packId)
    .maybeSingle();
  if (packErr) {
    log.error({ err: packErr, packId }, 'grantCopy: pack lookup failed');
    throw new Error('grantCopy: failed to load pack');
  }
  if (!pack) {
    throw new Error(`grantCopy: pack ${packId} not found`);
  }
  const authorWallet = (pack as { author_wallet: string }).author_wallet;

  // 3) Resolve the pack's member memory ids (pack-scoped), in tree order.
  const { data: contentsRaw, error: contentsErr } = await db
    .from('memory_pack_contents')
    .select('memory_id, leaf_index')
    .eq('pack_id', packId)
    .order('leaf_index', { ascending: true });
  if (contentsErr) {
    log.error({ err: contentsErr, packId }, 'grantCopy: pack contents lookup failed');
    throw new Error('grantCopy: failed to load pack contents');
  }
  const contents = (contentsRaw ?? []) as Array<{ memory_id: number; leaf_index: number }>;
  if (contents.length === 0) {
    throw new Error(`grantCopy: pack ${packId} has no member memories`);
  }
  const memberIds = contents.map((c) => c.memory_id);

  // 4) Hydrate the member memories, scoped to the pack AUTHOR (defence in depth — a tampered
  //    contents row pointing at another tenant's memory simply won't load).
  const { data: memsRaw, error: memsErr } = await db
    .from('memories')
    .select(SOURCE_MEMORY_COLUMNS)
    .in('id', memberIds)
    .eq('owner_wallet', authorWallet);
  if (memsErr) {
    log.error({ err: memsErr, packId }, 'grantCopy: member memory hydrate failed');
    throw new Error('grantCopy: failed to load member memories');
  }
  const sourceById = new Map<number, SourceMemory>();
  for (const m of (memsRaw ?? []) as unknown as SourceMemory[]) sourceById.set(m.id, m);
  // Re-derive an ordered, owner-verified member list (drops any id that failed the owner scope).
  const members: SourceMemory[] = [];
  for (const id of memberIds) {
    const m = sourceById.get(id);
    if (m) members.push(m);
  }
  if (members.length === 0) {
    throw new Error(`grantCopy: pack ${packId} member memories not owned by author — refusing to deliver`);
  }

  // 5) Determine encryption: a pack is encrypted iff its members carry provider DEK wraps.
  const { data: wrapsRaw, error: wrapsErr } = await db
    .from('memory_dek_wraps')
    .select('memory_id, recipient, wrapped_dek, wrap_pubkey')
    .in('memory_id', members.map((m) => m.id))
    .eq('recipient', 'provider');
  if (wrapsErr) {
    log.error({ err: wrapsErr, packId }, 'grantCopy: dek wrap lookup failed');
    throw new Error('grantCopy: failed to load member DEK wraps');
  }
  const providerWrapByMemory = new Map<number, { wrapped_dek: string; wrap_pubkey: string }>();
  for (const w of (wrapsRaw ?? []) as Array<{ memory_id: number; recipient: string; wrapped_dek: string; wrap_pubkey: string }>) {
    providerWrapByMemory.set(w.memory_id, { wrapped_dek: w.wrapped_dek, wrap_pubkey: w.wrap_pubkey });
  }
  const encrypted = providerWrapByMemory.size > 0;

  // If encrypted, we must seal a buyer wrap per memory → we need the buyer's published key and
  // the provider secret to recover each DEK. Resolve both up front; fail closed (recoverable)
  // if the buyer hasn't published an encryption key yet.
  let buyerPubkey: Uint8Array | null = null;
  let providerSecret: Uint8Array | null = null;
  if (encrypted) {
    const { data: keyRow, error: keyErr } = await db
      .from('encryption_keys')
      .select('x25519_pubkey')
      .eq('owner_wallet', buyer)
      .maybeSingle();
    if (keyErr) {
      log.error({ err: keyErr, packId }, 'grantCopy: buyer key lookup failed');
      throw new Error('grantCopy: failed to load buyer encryption key');
    }
    const pub = (keyRow as { x25519_pubkey?: string } | null)?.x25519_pubkey;
    if (!pub) {
      throw new Error(`grantCopy: encrypted pack ${packId} but buyer has no published encryption key — cannot seal copy`);
    }
    buyerPubkey = new Uint8Array(Buffer.from(pub, 'base64'));
    try {
      providerSecret = loadProviderKeypair().secretKey;
    } catch (err) {
      log.error({ err, packId }, 'grantCopy: provider keypair unavailable for encrypted delivery');
      throw new Error('grantCopy: provider encryption key unavailable');
    }
  }

  // 6) Clone each member memory into the buyer's namespace. One insert per member so we read
  //    back the assigned BIGSERIAL id (needed to key the buyer DEK wrap). Idempotent on
  //    re-entry: a clone already tagged imported_from_pack:<pack> for this buyer is skipped.
  const importTag = `imported_from_pack:${packId}`;
  const nowIso = new Date().toISOString();

  // Re-entry guard: if a prior partial run already created clones (entitlement insert is the
  // LAST step, so a crash between clone + entitlement is possible), don't duplicate them.
  const { data: priorClonesRaw } = await db
    .from('memories')
    .select('id, metadata')
    .eq('owner_wallet', buyer)
    .contains('metadata', { imported_from_pack: packId });
  const alreadyCloned = Array.isArray(priorClonesRaw) && priorClonesRaw.length > 0;

  if (!alreadyCloned) {
    for (const src of members) {
      const baseTags = Array.isArray(src.tags) ? src.tags.filter((t) => t !== importTag) : [];
      const cloneRow: Record<string, unknown> = {
        memory_type: src.memory_type,
        content: src.content,
        summary: src.summary,
        tags: [...baseTags, importTag],
        concepts: src.concepts ?? [],
        emotional_valence: src.emotional_valence ?? 0,
        importance: src.importance ?? 0.5,
        access_count: 0,
        source: importTag,
        related_user: src.related_user ?? null,
        related_wallet: src.related_wallet ?? null,
        metadata: { ...(src.metadata ?? {}), imported_from_pack: packId, source_order_id: order.order_id },
        decay_factor: src.decay_factor ?? 1.0,
        owner_wallet: buyer,
        encrypted: encrypted ? true : src.encrypted ?? false,
        // The clone is the buyer's: it is delegated to the provider for serving, like any stored
        // memory, and re-wrapped to the buyer below. The source's encryption_pubkey is the
        // author's and does not apply to the buyer's copy.
        provider_delegated: true,
        event_date: src.event_date ?? null,
        event_date_precision: src.event_date_precision ?? null,
        created_at: nowIso,
        last_accessed: nowIso,
      };

      const { data: inserted, error: cloneErr } = await db
        .from('memories')
        .insert(cloneRow)
        .select('id')
        .single();
      if (cloneErr || !inserted) {
        log.error({ err: cloneErr, packId, sourceId: src.id }, 'grantCopy: clone insert failed');
        throw new Error('grantCopy: failed to clone member memory');
      }
      const cloneId = (inserted as { id: number }).id;

      // 6a) Encrypted pack → seal a fresh buyer (owner) DEK wrap for this clone.
      if (encrypted && buyerPubkey && providerSecret) {
        const providerWrap = providerWrapByMemory.get(src.id);
        if (!providerWrap) {
          throw new Error(`grantCopy: encrypted member ${src.id} missing provider wrap — cannot seal buyer copy`);
        }
        const dek = unwrapDek(providerWrap.wrapped_dek, providerWrap.wrap_pubkey, providerSecret);
        if (!dek) {
          throw new Error(`grantCopy: failed to recover DEK for member ${src.id} — cannot seal buyer copy`);
        }
        const buyerWrap = wrapDek(dek, buyerPubkey);
        const { error: wrapInsErr } = await db.from('memory_dek_wraps').insert({
          memory_id: cloneId,
          recipient: 'owner',
          wrapped_dek: buyerWrap.wrapped,
          wrap_pubkey: buyerWrap.wrapPubkey,
        });
        if (wrapInsErr) {
          log.error({ err: wrapInsErr, packId, cloneId }, 'grantCopy: buyer DEK wrap insert failed');
          throw new Error('grantCopy: failed to store buyer DEK wrap');
        }
      }
    }
  } else {
    log.info({ orderId: order.order_id, packId }, 'grantCopy: clones already present from a prior partial run — skipping re-clone');
  }

  // 7) Insert the entitlement — the LAST step, so its presence proves delivery completed. The
  //    UNIQUE(pack_id, holder_wallet, grant_kind) makes a racing re-run a no-op (23505).
  const { error: entErr } = await db.from('pack_entitlements').insert({
    pack_id: packId,
    holder_wallet: buyer,
    grant_kind: 'copy_license',
    order_id: order.order_id,
    payment_rail: order.rail === 'stripe' ? 'stripe' : order.rail === 'solana' ? 'clude_solana' : 'clude_base',
    status: 'active',
    delivered_copy: true,
    granted_at: nowIso,
  });
  if (entErr) {
    if ((entErr as { code?: string }).code === '23505') {
      // A row already exists on the UNIQUE(pack_id, holder_wallet, grant_kind) key. Two cases land
      // here and BOTH must end with the buyer holding an ACTIVE grant — never a silent no-op:
      //   (a) a concurrent sweep of the same delivery inserted an 'active' grant first; or
      //   (b) §00 M10 clawback left a lingering 'refunded' grant from a PRIOR refunded order and this
      //       is a genuine RE-BUY (the active-only pre-check at the top stepped right over it, so we
      //       re-cloned and re-paid). Silently returning here would mark the order delivered while the
      //       entitlement stayed 'refunded' → hasActiveCopyEntitlement = false → the re-paying buyer is
      //       permanently locked out.
      // RE-ACTIVATE the existing row to this order: status→'active', clear revoked_at, re-point
      // order_id. Idempotent — for case (a) this re-writes an already-active row to itself. A genuine
      // double-deliver of the SAME active order never reaches here (the active-only pre-check returns
      // first), so the re-activate only ever runs for a real (re)delivery.
      const { error: reactErr } = await db
        .from('pack_entitlements')
        .update({ status: 'active', revoked_at: null, order_id: order.order_id })
        .eq('pack_id', packId)
        .eq('holder_wallet', buyer)
        .eq('grant_kind', 'copy_license');
      if (reactErr) {
        log.error({ err: reactErr, orderId: order.order_id, packId }, 'grantCopy: entitlement re-activation failed');
        throw new Error('grantCopy: failed to re-activate entitlement');
      }
      log.info(
        { orderId: order.order_id, packId, buyer: buyer.slice(0, 8) },
        'grantCopy: entitlement already present (concurrent sweep or refunded re-buy) — re-activated to this order',
      );
      return;
    }
    log.error({ err: entErr, orderId: order.order_id, packId }, 'grantCopy: entitlement insert failed');
    throw new Error('grantCopy: failed to insert entitlement');
  }

  log.info(
    { orderId: order.order_id, packId, buyer: buyer.slice(0, 8), members: members.length, encrypted },
    'grantCopy: copy delivered',
  );
}
