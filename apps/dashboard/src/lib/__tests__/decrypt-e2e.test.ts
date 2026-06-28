/**
 * decrypt-e2e — the WHOLE encrypted-`.pmp` pipeline, end to end, under vitest/Node:
 *
 *   plaintext records
 *     → SERVER `encryptRecordsForHolder` (real per-record secretbox + sealed pack DEK)
 *     → SERVER `writeMemoryPack(..., format:'tarball', ownerEncryption)` → a REAL `.tar.zst`
 *       (zstd frame produced by the system `tar --zstd`, exactly the production export bytes)
 *     → base64 of those file bytes
 *     → BROWSER `parsePmpBase64` (fzstd inflates the `.tar.zst` → USTAR tar → manifest + records)
 *     → BROWSER `decryptPmp(manifest, records, signature)` (tweetnacl-only)
 *     → the ORIGINAL plaintext, with `verified === true`.
 *
 * This is the real proof that the "Decrypt locally" path works against ACTUAL server output: a
 * zstd-compressed tarball, inflated in-browser by `fzstd` (no Node `zlib`, no `tar-stream`). The
 * earlier decrypt-pmp.test.ts hand-built an in-memory manifest; this one writes and re-reads a
 * genuine `.tar.zst` on disk so the fzstd inflate + USTAR walk are exercised on production bytes.
 *
 * Why the crypto is built the server way HERE: `encryptRecordsForHolder` reads the holder's key
 * row from a `db`, so we mock that row using the SAME server `memory-envelope` primitives the
 * registration path uses (deriveOwnerEncryptionKeypair + makeVerifierCiphertext) — the verifier_ct
 * is therefore a genuine, `checkVerifier`-valid ciphertext. The merkle leaves / root are computed
 * the way the server's `memoryContentHash` + `buildPackTree` do (mirrored here, byte-for-byte with
 * the production browser verifier in decrypt-pmp.ts), so `decryptPmp`'s integrity check passes.
 *
 * Never logs the signature, derived key, DEK, ciphertext, or plaintext.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decompress } from 'fzstd';

import { writeMemoryPack, type MemoryPackRecord } from '@clude/memorypack';
import {
  deriveOwnerEncryptionKeypair,
  makeVerifierCiphertext,
} from '@clude/shared/core/memory-envelope';

// The SERVER encrypt helper (Task 2). Imported across the workspace ONLY in this test — it is a
// server module (reads a db, pulls Node deps) and must never enter the dashboard bundle. Here it
// runs under Node/vitest with a mocked db, so we exercise the real production encrypt code path.
import { encryptRecordsForHolder } from '../../../../server/src/lib/pmp/encrypt-records-for-holder';

// The BROWSER read + decrypt under test (production modules — now shared from @clude/ui; fzstd
// inflate lives in parse-pmp).
import { parsePmpBase64, decryptPmp } from '@clude/ui';

// ── Signatures ──────────────────────────────────────────────────────────────────────────────

/** A FIXED, deterministic 64-byte signature for the holder. */
function holderSignature(seed = 9): Uint8Array {
  const sig = new Uint8Array(64);
  for (let i = 0; i < 64; i++) sig[i] = (i * seed + 17) & 0xff;
  return sig;
}

/** A DIFFERENT 64-byte signature (wrong wallet). */
function wrongSignature(): Uint8Array {
  const sig = new Uint8Array(64);
  for (let i = 0; i < 64; i++) sig[i] = (i * 23 + 5) & 0xff;
  return sig;
}

// ── base64 / hashing helpers (test-side; mirror the server canonicalisers byte-for-byte) ──────

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

async function sha256Hex(message: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8(message) as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

/** Recursive stable stringify (alphabetical keys) — mirrors the server's canonicaliser. */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
  }
  throw new Error('unsupported');
}

/**
 * Plaintext leaf hash, the EXACT way the server's memoryContentHash does it (algorithm-bound, NFC
 * + trim, tags dedup+sort, alphabetical keys). This is what decrypt-pmp.ts recomputes and compares
 * against metadata.leaf_hash, so building the fixture with it makes `verified === true` real.
 */
async function leafHash(input: {
  content: string;
  memory_type: string;
  owner_wallet: string | null;
  created_at: string;
  tags: string[];
  source: string | null;
  related_user: string | null;
  related_wallet: string | null;
}): Promise<string> {
  const norm = (s: string) => s.normalize('NFC').trim();
  const normN = (s: string | null) => (s === null ? null : norm(s));
  const tags = Array.from(new Set(input.tags.map(norm).filter((t) => t.length > 0))).sort();
  const canonical = {
    algorithm: 'memory-hash-v1',
    content: norm(input.content),
    created_at: input.created_at,
    memory_type: input.memory_type,
    owner_wallet: normN(input.owner_wallet),
    related_user: normN(input.related_user),
    related_wallet: normN(input.related_wallet),
    source: normN(input.source),
    tags,
  };
  return sha256Hex(stableStringify(canonical));
}

/** sha256(hexDecode(left) ‖ hexDecode(right)) → hex — the sha256-merkle-v1 inner node. */
async function hashPair(left: string, right: string): Promise<string> {
  const hexToBytes = (hex: string) => {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  };
  const a = hexToBytes(left);
  const b = hexToBytes(right);
  const buf = new Uint8Array(a.length + b.length);
  buf.set(a, 0);
  buf.set(b, a.length);
  const digest = await crypto.subtle.digest('SHA-256', buf as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

/** Build the pack merkle root (duplicate-last on odd) over ordered leaves — mirrors buildPackTree. */
async function merkleRoot(leaves: string[]): Promise<string> {
  let current = [...leaves];
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!;
      const right = i + 1 < current.length ? current[i + 1]! : left;
      next.push(await hashPair(left, right));
    }
    current = next;
  }
  return current[0]!;
}

// ── Fixture: plaintext memories + a mock encryption_keys db row ───────────────────────────────

const HOLDER = 'FRok22222222222222222222222222222222uhza7';

interface PlainMemory {
  id: string;
  content: string;
  kind: string;
  created_at: string;
  tags: string[];
  importance: number;
  source: string;
  owner_wallet: string;
  related_user: string | null;
  related_wallet: string | null;
}

// A third party's user id + wallet that the F1 leak shipped in cleartext inside metadata. The
// merkle leaf binds them, so they must round-trip — but they must NOT appear as plaintext in the
// shipped tar bytes (only inside metadata.related_ct under the pack DEK).
const RELATED_USER = 'maya-counterparty-7c1f';
const RELATED_WALLET = 'CounterPartyWaLLet4444444444444444444third9';

const PLAINTEXT_MEMORIES: PlainMemory[] = [
  {
    id: 'clude-e2e00001',
    content: 'Maya ships the encrypted .pmp export and verifies it end-to-end in the browser.',
    kind: 'episodic',
    created_at: '2026-06-27T12:00:00.000Z',
    tags: ['pmp', 'export', 'milestone'],
    importance: 0.9,
    source: 'chat',
    owner_wallet: HOLDER,
    // NON-NULL related_* — exercises the F1 encrypt-and-restore path end-to-end.
    related_user: RELATED_USER,
    related_wallet: RELATED_WALLET,
  },
  {
    id: 'clude-e2e00002',
    content: 'The browser decodes a real .tar.zst with fzstd before tweetnacl decrypt.',
    kind: 'semantic',
    created_at: '2026-06-27T12:05:00.000Z',
    tags: [], // empty tags must round-trip as []
    importance: 0.7,
    source: 'pack',
    owner_wallet: HOLDER,
    related_user: null,
    related_wallet: null,
  },
];

/**
 * Build plaintext `MemoryPackRecord[]` carrying the PLAINTEXT merkle leaf in metadata.leaf_hash —
 * exactly what mapMemoryToRecord produces upstream of encryptRecordsForHolder — plus the leaves so
 * the route's merkle root can be recomputed.
 */
async function buildPlaintextRecords(): Promise<{ records: MemoryPackRecord[]; leaves: string[] }> {
  const leaves: string[] = [];
  const records: MemoryPackRecord[] = [];
  for (const m of PLAINTEXT_MEMORIES) {
    const leaf = await leafHash({
      content: m.content,
      memory_type: m.kind,
      owner_wallet: m.owner_wallet,
      created_at: m.created_at,
      tags: m.tags,
      source: m.source,
      related_user: m.related_user,
      related_wallet: m.related_wallet,
    });
    leaves.push(leaf);
    records.push({
      id: m.id,
      created_at: m.created_at,
      kind: m.kind,
      content: m.content,
      tags: m.tags,
      importance: m.importance,
      source: m.source,
      metadata: {
        leaf_hash: leaf,
        owner_wallet: m.owner_wallet,
        related_user: m.related_user,
        related_wallet: m.related_wallet,
      },
    });
  }
  return { records, leaves };
}

/**
 * A minimal mock of the Supabase client `encryptRecordsForHolder` uses: it only calls
 * `.from('encryption_keys').select(...).eq('owner_wallet', wallet).maybeSingle()`. We return a row
 * whose x25519_pubkey + verifier_ct are derived from the holder signature via the real server
 * primitives, so the sealed DEK opens and the verifier gate passes in decryptPmp.
 */
function mockDbForHolder(pubkeyB64: string, verifierCt: string): Parameters<typeof encryptRecordsForHolder>[0] {
  const row = { x25519_pubkey: pubkeyB64, verifier_ct: verifierCt };
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  const db = { from: () => builder };
  // The helper only touches the narrow surface above; cast through unknown to its param type.
  return db as unknown as Parameters<typeof encryptRecordsForHolder>[0];
}

/**
 * Produce a REAL `.tar.zst` on disk for the holder, mirroring the server export route: encrypt to
 * the holder, compute the pack merkle root, then write the tarball with the owner-sealed header and
 * a `pmp.merkle_root`. Returns the file's base64 (what the dashboard hands to parsePmpBase64).
 */
async function writeRealTarZstBase64(): Promise<{
  base64: string;
  recordCount: number;
  tarBytes: Uint8Array;
}> {
  const holderKp = await deriveOwnerEncryptionKeypair(holderSignature());
  const pubkeyB64 = b64(holderKp.publicKey);
  const verifierCt = makeVerifierCiphertext(holderKp.secretKey);

  const { records, leaves } = await buildPlaintextRecords();

  // Real server encrypt: fresh pack DEK, per-record secretbox, DEK sealed once to the holder.
  const db = mockDbForHolder(pubkeyB64, verifierCt);
  const { records: encRecords, header } = await encryptRecordsForHolder(db, records, HOLDER);

  const root = await merkleRoot(leaves);

  const dir = mkdtempSync(join(tmpdir(), 'pmp-e2e-'));
  try {
    const file = join(dir, 'maya-pack.tar.zst');
    writeMemoryPack(file, encRecords, {
      producer: { name: 'clude-server', version: '0.2', public_key: HOLDER },
      record_schema: 'clude-memory-v1',
      format: 'tarball',
      ownerEncryption: header,
      pmp: {
        pmp_version: '0.8',
        title: 'Maya pack',
        license_type: 'title',
        record_count: encRecords.length,
        leaf_hash_algorithm: 'memory-hash-v1',
        merkle_algorithm: 'sha256-merkle-v1',
        merkle_root: root,
        creator_pubkey: HOLDER,
      },
    });

    const bytes = new Uint8Array(readFileSync(file));
    // Sanity: it really is a zstd frame (so the fzstd path — not the plain-tar path — is exercised).
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x28, 0xb5, 0x2f, 0xfd]);
    // Inflate to the underlying USTAR tar so callers can byte-grep the ACTUAL shipped bytes for
    // any plaintext PII leak (F1). zstd is reversible, so a leak in the tar = a leak on the wire.
    const tarBytes = decompress(bytes);
    return { base64: b64(bytes), recordCount: encRecords.length, tarBytes };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 1. FULL PIPELINE — content round-trips AND integrity verifies ─────────────────────────────

describe('decrypt e2e — server .tar.zst → fzstd inflate → USTAR → tweetnacl decrypt', () => {
  it('recovers the ORIGINAL plaintext from a real .tar.zst and verified === true', async () => {
    const { base64, recordCount, tarBytes } = await writeRealTarZstBase64();

    // ── F1 byte-grep: the third-party related_user / related_wallet must NOT appear as plaintext
    //    anywhere in the ACTUAL shipped (decompressed) tar bytes. They live only in related_ct. ──
    const tarText = new TextDecoder('latin1').decode(tarBytes);
    expect(tarText).not.toContain(RELATED_USER);
    expect(tarText).not.toContain(RELATED_WALLET);

    // BROWSER read: fzstd inflates the zstd frame → USTAR tar → manifest + ciphertext records.
    const { manifest, records } = parsePmpBase64(base64);
    expect(records).toHaveLength(recordCount);
    expect(manifest.encryption?.owner).toBeTruthy();
    expect(manifest.pmp?.merkle_root).toBeTruthy();
    // Records are still ciphertext at this stage (no plaintext leaked by the parse step).
    expect(records[0]!.content).not.toBe(PLAINTEXT_MEMORIES[0]!.content);
    // The wire record carries related_ct, NOT plaintext related_*.
    const wireMeta = records[0]!.metadata as Record<string, unknown>;
    expect(typeof wireMeta.related_ct).toBe('string');
    expect(wireMeta.related_user).toBeUndefined();
    expect(wireMeta.related_wallet).toBeUndefined();

    // BROWSER decrypt with the holder's signature.
    const out = await decryptPmp(manifest, records, holderSignature());

    // Content + tags round-trip to the originals.
    expect(out.records).toHaveLength(PLAINTEXT_MEMORIES.length);
    expect(out.records[0]!.content).toBe(PLAINTEXT_MEMORIES[0]!.content);
    expect(out.records[0]!.tags).toEqual(PLAINTEXT_MEMORIES[0]!.tags);
    expect(out.records[1]!.content).toBe(PLAINTEXT_MEMORIES[1]!.content);
    expect(out.records[1]!.tags).toEqual([]); // empty tags stay []
    expect(out.records[0]!.encrypted).toBeFalsy(); // ciphertext marker cleared
    expect(out.records[0]!.id).toBe(PLAINTEXT_MEMORIES[0]!.id); // structural fields preserved

    // F1: related_user / related_wallet are RESTORED onto metadata, matching the originals, and
    // related_ct is removed (the decrypted record matches the original plaintext shape).
    const outMeta = out.records[0]!.metadata as Record<string, unknown>;
    expect(outMeta.related_user).toBe(RELATED_USER);
    expect(outMeta.related_wallet).toBe(RELATED_WALLET);
    expect(outMeta.related_ct).toBeUndefined();
    // The null-related record restores cleanly too (no related_ct, related_* absent or null).
    const outMeta1 = out.records[1]!.metadata as Record<string, unknown>;
    expect(outMeta1.related_ct).toBeUndefined();

    // Integrity: recomputed leaves match metadata.leaf_hash AND rebuild to manifest.pmp.merkle_root.
    // This is the load-bearing parity check — the leaf binds related_*, so verified===true proves
    // the restored values are byte-identical to what the server hashed.
    expect(out.verified).toBe(true);
  });
});

// ── 2. WRONG SIGNATURE — fails closed, no plaintext ───────────────────────────────────────────

describe('decrypt e2e — wrong wallet', () => {
  it('throws (never returns plaintext) when the signature is wrong', async () => {
    const { base64 } = await writeRealTarZstBase64();
    const { manifest, records } = parsePmpBase64(base64);
    await expect(decryptPmp(manifest, records, wrongSignature())).rejects.toThrow();
  });
});
