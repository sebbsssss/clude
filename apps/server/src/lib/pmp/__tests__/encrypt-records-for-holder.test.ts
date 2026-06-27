/**
 * encryptRecordsForHolder — fresh per-pack DEK, secretbox the sensitive record fields under it,
 * and seal the DEK ONCE to the holder's registered X25519 public key (Task 2 of encrypted .pmp export).
 *
 * DATA-CRYPTO CODE. This suite pins the cross-tenant export-encryption contract:
 *
 *   1. CIPHERTEXT FIELDS. Each returned record's `content` is base64 ciphertext (NOT the plaintext),
 *      `encrypted === true`, and `metadata.leaf_hash` (the PLAINTEXT merkle leaf computed upstream)
 *      is carried through UNCHANGED so the on-chain commitment still holds.
 *   2. ROUND-TRIP. unwrapDek(header) with the holder's secret recovers the pack DEK; decryptField
 *      recovers content; tags round-trip via JSON.parse(decryptField(tags[0], dek)).
 *   3. NO LEAK. A DIFFERENT holder secret can NOT unwrap the DEK (returns null).
 *   4. UNREGISTERED HOLDER. Throws `holder_key_unregistered` when encryption_keys has no row.
 *   5. HEADER FIDELITY. header.verifier_ct / header.recipient_pubkey mirror the registered row.
 *   6. NO PLAINTEXT ANYWHERE. No plaintext content/tags string survives in JSON.stringify({records, header}).
 *
 * Only `db` is mocked. Real X25519/secretbox runs (via @clude/shared/core/memory-envelope) so the
 * round-trip and leak assertions are meaningful — the holder keypair is a real nacl.box keypair.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import nacl from 'tweetnacl';
import { unwrapDek, decryptField } from '@clude/shared/core/memory-envelope';
import type { MemoryPackRecord } from '@clude/memorypack';

// ── Logger (no real Pino in unit tests) ──
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { encryptRecordsForHolder, type OwnerEncHeader } from '../encrypt-records-for-holder.js';

const HOLDER = 'HoLdErWaLLeT1111111111111111111111111111111';

// Real holder keypair so we hold the secret to decrypt in the round-trip test.
const holderKeypair = nacl.box.keyPair();
const holderPubB64 = Buffer.from(holderKeypair.publicKey).toString('base64');
const VERIFIER_CT = 'verifier-ct-marker-for-holder';

/**
 * Minimal table-routed Supabase mock for the one query the helper makes:
 *   db.from('encryption_keys').select(cols).eq('owner_wallet', wallet).maybeSingle()
 * `keyRow` controls what maybeSingle resolves to; `keyError` injects a DB error.
 */
let keyRow: Record<string, unknown> | null = null;
let keyError: { message: string } | null = null;
const eqArgs: Array<[string, unknown]> = [];

function makeDb() {
  return {
    from(table: string) {
      expect(table).toBe('encryption_keys');
      const chain = {
        select: (_cols: string) => chain,
        eq: (col: string, val: unknown) => {
          eqArgs.push([col, val]);
          return chain;
        },
        maybeSingle: async () => ({ data: keyRow, error: keyError }),
      };
      return chain;
    },
  } as unknown as Parameters<typeof encryptRecordsForHolder>[0];
}

function plaintextRecords(): MemoryPackRecord[] {
  return [
    {
      id: 'clude-aaaa1111',
      created_at: '2026-01-01T00:00:00.000Z',
      kind: 'semantic',
      content: 'SECRET-ALPHA the user prefers dark mode',
      tags: ['preference', 'ui'],
      importance: 0.7,
      source: 'pack',
      metadata: { leaf_hash: 'sha256:leafALPHA', owner_wallet: HOLDER, related_user: null, related_wallet: null },
    },
    {
      id: 'clude-bbbb2222',
      created_at: '2026-01-02T00:00:00.000Z',
      kind: 'episodic',
      content: 'SECRET-BETA met with the founder on Tuesday',
      tags: [], // empty tags → stays []
      importance: 0.5,
      source: 'pack',
      metadata: { leaf_hash: 'sha256:leafBETA', owner_wallet: HOLDER, related_user: null, related_wallet: null },
    },
  ];
}

beforeEach(() => {
  keyRow = { x25519_pubkey: holderPubB64, verifier_ct: VERIFIER_CT };
  keyError = null;
  eqArgs.length = 0;
  vi.clearAllMocks();
});

describe('encryptRecordsForHolder', () => {
  it('encrypts content (base64 ciphertext, not plaintext), sets encrypted=true, preserves leaf_hash', async () => {
    const input = plaintextRecords();
    const { records } = await encryptRecordsForHolder(makeDb(), input, HOLDER);

    expect(records).toHaveLength(2);
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      const orig = input[i];
      expect(rec.encrypted).toBe(true);
      // content is NOT the original plaintext, and the plaintext substring is gone.
      expect(rec.content).not.toBe(orig.content);
      expect(rec.content).not.toContain(orig.content);
      // content is base64 (decodes to >= nonce length + 1 byte).
      const raw = Buffer.from(rec.content, 'base64');
      expect(raw.length).toBeGreaterThan(24);
      // leaf_hash carried through UNCHANGED.
      expect((rec.metadata as Record<string, unknown>).leaf_hash).toBe(
        (orig.metadata as Record<string, unknown>).leaf_hash,
      );
      // No separate top-level nonce field is set (nonce lives inside the ciphertext).
      expect(rec.nonce).toBeUndefined();
    }
    // Owner-scoped query was made on owner_wallet = HOLDER.
    expect(eqArgs).toContainEqual(['owner_wallet', HOLDER]);
  });

  it('round-trips: holder unwraps DEK, decrypts content + tags', async () => {
    const input = plaintextRecords();
    const { records, header } = await encryptRecordsForHolder(makeDb(), input, HOLDER);

    const dek = unwrapDek(header.dek_wrap, header.wrap_pubkey, holderKeypair.secretKey);
    expect(dek).not.toBeNull();

    // content round-trip
    expect(decryptField(records[0].content, dek as Uint8Array)).toBe(input[0].content);
    expect(decryptField(records[1].content, dek as Uint8Array)).toBe(input[1].content);

    // tags round-trip: non-empty tags become a single-element ciphertext array.
    expect(records[0].tags).toHaveLength(1);
    const decTags = JSON.parse(decryptField(records[0].tags[0], dek as Uint8Array) as string);
    expect(decTags).toEqual(input[0].tags);

    // empty tags stay [] (no encryption).
    expect(records[1].tags).toEqual([]);
  });

  it('does NOT leak to a different holder secret (unwrap returns null)', async () => {
    const { header } = await encryptRecordsForHolder(makeDb(), plaintextRecords(), HOLDER);
    const attacker = nacl.box.keyPair();
    expect(unwrapDek(header.dek_wrap, header.wrap_pubkey, attacker.secretKey)).toBeNull();
  });

  it('throws holder_key_unregistered when no encryption_keys row exists', async () => {
    keyRow = null;
    await expect(encryptRecordsForHolder(makeDb(), plaintextRecords(), HOLDER)).rejects.toThrow(
      'holder_key_unregistered',
    );
  });

  it('header mirrors the registered pubkey + verifier_ct and recipient_wallet', async () => {
    const { header } = await encryptRecordsForHolder(makeDb(), plaintextRecords(), HOLDER);
    const h: OwnerEncHeader = header;
    expect(h.recipient_wallet).toBe(HOLDER);
    expect(h.recipient_pubkey).toBe(holderPubB64);
    expect(h.verifier_ct).toBe(VERIFIER_CT);
    expect(typeof h.dek_wrap).toBe('string');
    expect(typeof h.wrap_pubkey).toBe('string');
  });

  it('leaks no plaintext content or tag string into the serialized output', async () => {
    const input = plaintextRecords();
    const { records, header } = await encryptRecordsForHolder(makeDb(), input, HOLDER);
    const blob = JSON.stringify({ records, header });
    expect(blob).not.toContain('SECRET-ALPHA');
    expect(blob).not.toContain('SECRET-BETA');
    expect(blob).not.toContain('preference'); // plaintext tag value must be gone
    expect(blob).not.toContain('"ui"');
  });

  it('does not mutate the input records in place', async () => {
    const input = plaintextRecords();
    const snapshotContent = input[0].content;
    const snapshotTags = [...input[0].tags];
    await encryptRecordsForHolder(makeDb(), input, HOLDER);
    expect(input[0].content).toBe(snapshotContent);
    expect(input[0].tags).toEqual(snapshotTags);
    expect(input[0].encrypted).toBeUndefined();
  });
});
