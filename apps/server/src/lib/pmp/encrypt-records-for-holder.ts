/**
 * encryptRecordsForHolder — encrypt plaintext export records to a holder, self-encrypting style.
 *
 * Task 2 of the encrypted `.pmp` export build. At-rest memory encryption is OFF by default, so there
 * is NO provider DEK to recover at export time. This helper instead:
 *
 *   1. generates a FRESH per-pack DEK (generateDek);
 *   2. secretboxes each record's SENSITIVE fields (`content`, and `tags` when non-empty) under that
 *      DEK (encryptField — the nonce is embedded in the returned base64, so no separate nonce field);
 *   3. seals the DEK exactly ONCE to the holder's registered X25519 public key (wrapDek), producing
 *      the `'owner'` encryption header the `.pmp` file carries.
 *
 * The merkle leaf (`record.metadata.leaf_hash`) is computed over PLAINTEXT upstream (mapMemoryToRecord)
 * and MUST stay byte-identical here, or the on-chain commitment no longer matches the artifact. So we
 * copy records into new objects and re-encrypt only `content`/`tags`. `summary` is not present on
 * export records.
 *
 * `metadata` is REBUILT (not carried through verbatim): the upstream metadata holds `related_user` and
 * `related_wallet` — a THIRD PARTY's user id + Solana wallet — which must NOT ship in cleartext in an
 * "owner-sealed, zero-knowledge" pack (opsec F1). The merkle leaf binds them, so they cannot be
 * dropped; instead we seal them under the pack DEK into a single `related_ct`, and the browser
 * decrypts + RESTORES them before re-hashing the leaf. `leaf_hash` (plaintext, needed for verify) and
 * `owner_wallet` (the recipient's OWN wallet) stay in cleartext.
 *
 * DATA-CRYPTO / CROSS-TENANT CODE. Owner-scoped (the holder's key row is read by owner_wallet). Never
 * logs the DEK, plaintext, ciphertext, or any pubkey. Tasks 3 (file write) and 5 (browser decrypt)
 * mirror this exact per-record encoding — keep them in lockstep.
 */
import type { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';
import { generateDek, encryptField, wrapDek } from '@clude/shared/core/memory-envelope';
import type { MemoryPackRecord } from '@clude/memorypack';

const log = createChildLogger('encrypt-records-for-holder');

/** The Supabase client shape, as returned by getDb(). */
type Db = ReturnType<typeof getDb>;

/**
 * The `'owner'` encryption header written into the `.pmp` artifact. Carries everything a holder needs
 * to recover the pack DEK (and prove key ownership) WITHOUT any server round-trip on import.
 */
export interface OwnerEncHeader {
  /** The wallet this pack was sealed for (the holder). */
  recipient_wallet: string;
  /** base64 X25519 public key the DEK was sealed to (the holder's registered key). */
  recipient_pubkey: string;
  /** Copied verbatim from the holder's encryption_keys row (lets the browser verify its derived key). */
  verifier_ct: string;
  /** base64(nonce ‖ box(DEK)) — the sealed pack DEK. = wrapDek(...).wrapped */
  dek_wrap: string;
  /** base64 ephemeral sender X25519 pubkey for the sealed box. = wrapDek(...).wrapPubkey */
  wrap_pubkey: string;
}

/** Decode a base64 string to bytes (server is Node). */
function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** The single encryption_keys row shape this helper needs. */
interface HolderKeyRow {
  x25519_pubkey: string;
  verifier_ct: string;
}

/**
 * Encrypt `records` (plaintext, from mapMemoryToRecord) to `holderWallet` under a fresh per-pack DEK,
 * and return the new ciphertext records plus the `'owner'` encryption header.
 *
 * Throws `holder_key_unregistered` when the holder has no registered X25519 key — the route maps this
 * to a 4xx and emits no file. Throws on a genuine DB error (recoverable). Input records are NOT mutated.
 *
 * @param db           Supabase client (owner-scoped queries only).
 * @param records      plaintext export records; `metadata.leaf_hash` is the plaintext merkle leaf.
 * @param holderWallet the wallet to seal the pack for; its registered key is read by owner_wallet.
 */
export async function encryptRecordsForHolder(
  db: Db,
  records: MemoryPackRecord[],
  holderWallet: string,
): Promise<{ records: MemoryPackRecord[]; header: OwnerEncHeader }> {
  if (!holderWallet) throw new Error('encryptRecordsForHolder: holderWallet is required');

  // ── Load the holder's registered X25519 key (owner-scoped). Fail closed if unregistered. ──
  const { data, error } = await db
    .from('encryption_keys')
    .select('x25519_pubkey, verifier_ct')
    .eq('owner_wallet', holderWallet)
    .maybeSingle();
  if (error) {
    log.error({ err: error }, 'encryptRecordsForHolder: encryption_keys lookup failed');
    throw new Error('encryptRecordsForHolder: failed to load holder encryption key');
  }
  const row = data as HolderKeyRow | null;
  if (!row || !row.x25519_pubkey) {
    // No registered key → the holder can never decrypt this pack. Refuse rather than emit a file
    // sealed to nothing. The export route turns this into a 4xx (no bytes written).
    throw new Error('holder_key_unregistered');
  }

  // ── Fresh per-pack DEK, sealed ONCE to the holder (one wrap for the whole pack). ──
  const dek = generateDek();
  const { wrapped, wrapPubkey } = wrapDek(dek, base64ToBytes(row.x25519_pubkey));

  // ── Re-encrypt each record's sensitive fields under the pack DEK into NEW objects. ──
  const encryptedRecords = records.map((rec) => {
    // content: secretbox → base64(nonce ‖ ct). The nonce is embedded; `encrypted=true` is the marker.
    const content = encryptField(rec.content, dek);

    // tags: encrypt the WHOLE array as one JSON string into a single-element array, but only when
    // there is something to protect. Empty/absent tags stay [] (no ciphertext, nothing to leak).
    const hasTags = Array.isArray(rec.tags) && rec.tags.length > 0;
    const tags = hasTags ? [encryptField(JSON.stringify(rec.tags), dek)] : [];

    // metadata: REBUILD it (do not spread the source metadata) so `related_user`/`related_wallet` —
    // a THIRD PARTY's social-graph PII — never ship as plaintext (opsec F1). The merkle leaf BINDS
    // these fields, so they cannot be dropped: instead we seal them under the pack DEK into a single
    // `related_ct`, and the browser decrypts + RESTORES them before re-hashing the leaf. We keep
    // `leaf_hash` (the plaintext hash the browser compares against) and `owner_wallet` (the
    // recipient's OWN wallet — already plaintext in the header, not a third-party leak) in cleartext.
    const srcMeta = (rec.metadata ?? {}) as Record<string, unknown>;
    const relatedUser = srcMeta.related_user;
    const relatedWallet = srcMeta.related_wallet;
    const metadata: Record<string, unknown> = {
      leaf_hash: srcMeta.leaf_hash,
      owner_wallet: srcMeta.owner_wallet,
    };
    // Only emit related_ct when there is something to protect; a record with no relations ships
    // nothing extra. `null` and `undefined` both count as absent.
    if (
      (relatedUser !== null && relatedUser !== undefined) ||
      (relatedWallet !== null && relatedWallet !== undefined)
    ) {
      metadata.related_ct = encryptField(
        JSON.stringify({ related_user: relatedUser ?? null, related_wallet: relatedWallet ?? null }),
        dek,
      );
    }

    // Spread carries every OTHER structural field (id, kind, created_at, importance, source, …)
    // through untouched. We then override the sensitive fields + the rebuilt metadata and stamp the
    // ciphertext marker. No separate `nonce` field is set (the nonce lives inside each ciphertext).
    return {
      ...rec,
      content,
      tags,
      metadata,
      encrypted: true,
    };
  });

  const header: OwnerEncHeader = {
    recipient_wallet: holderWallet,
    recipient_pubkey: row.x25519_pubkey,
    verifier_ct: row.verifier_ct,
    dek_wrap: wrapped,
    wrap_pubkey: wrapPubkey,
  };

  log.info(
    { recordCount: encryptedRecords.length, recipient: holderWallet.slice(0, 10) },
    'encryptRecordsForHolder: sealed fresh pack DEK to holder + encrypted record fields',
  );

  return { records: encryptedRecords, header };
}
