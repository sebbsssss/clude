/**
 * decrypt-pmp — browser-side zero-knowledge owner decrypt of an encrypted `.pmp`.
 *
 * These tests run under vitest/Node, so they CAN import the SERVER crypto primitives
 * (`@clude/shared/core/memory-envelope`) to PROVE byte-for-byte parity between the
 * server's Node-`crypto` HKDF and the browser's Web-Crypto HKDF. The production module
 * (decrypt-pmp.ts) must NEVER import memory-envelope — only the ASCII string constants
 * from owner-key-constants — so it stays browser-bundle-safe (no Node `crypto`).
 *
 * The single load-bearing assertion is the PARITY FIXTURE: for a fixed 64-byte signature,
 * deriveOwnerKeypairBrowser(sig) must produce the SAME publicKey AND secretKey bytes as the
 * server's deriveOwnerEncryptionKeypair(sig). A subtle salt/info byte-encoding mismatch would
 * make every real decrypt silently fail, so we pin it here.
 */
import { describe, it, expect } from 'vitest';

// SERVER primitives — imported HERE ONLY (the test), to construct an authentic encrypted
// pack and to prove HKDF parity. decrypt-pmp.ts must not reach for any of these.
import {
  deriveOwnerEncryptionKeypair,
  generateDek,
  encryptField,
  wrapDek,
  makeVerifierCiphertext,
} from '@clude/shared/core/memory-envelope';

import { deriveOwnerKeypairBrowser, decryptPmp } from '../decrypt-pmp';

// ── Helpers ───────────────────────────────────────────────────────────────────────────────

/** A FIXED, deterministic 64-byte ed25519-shaped signature. The parity fixture pins to this. */
function fixedSignature(seed = 7): Uint8Array {
  const sig = new Uint8Array(64);
  for (let i = 0; i < 64; i++) sig[i] = (i * seed + 3) & 0xff;
  return sig;
}

/** A DIFFERENT 64-byte signature (wrong wallet). */
function otherSignature(): Uint8Array {
  const sig = new Uint8Array(64);
  for (let i = 0; i < 64; i++) sig[i] = (i * 31 + 11) & 0xff;
  return sig;
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** sha256 hex over a UTF-8 string (test-side, independent of the production impl). */
async function sha256Hex(message: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8(message) as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
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
 * Compute the plaintext leaf hash for a memory the EXACT way the server's memoryContentHash does
 * (algorithm-bound, NFC + trim, tags dedup+sort, alphabetical keys). Used to build authentic
 * metadata.leaf_hash values + the merkle root in the fixture.
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

/** sha256(hexDecode(left) || hexDecode(right)) → hex, the pack-merkle inner node. */
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

/** Build the pack merkle root (duplicate-last on odd) over ordered leaves. */
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

const HOLDER = 'FRok11111111111111111111111111111111uhza7';

const PLAINTEXT_MEMORIES: PlainMemory[] = [
  {
    id: 'clude-aaaaaaaa',
    content: 'Maya prefers concise weekly summaries on Mondays.',
    kind: 'semantic',
    created_at: '2026-01-02T10:00:00.000Z',
    tags: ['preference', 'cadence'],
    importance: 0.8,
    source: 'chat',
    owner_wallet: HOLDER,
    related_user: 'maya',
    related_wallet: null,
  },
  {
    id: 'clude-bbbbbbbb',
    content: 'Shipped the encrypted .pmp export on 2026-06-27.',
    kind: 'episodic',
    created_at: '2026-06-27T18:30:00.000Z',
    tags: [], // empty tags must stay []
    importance: 0.6,
    source: 'pack',
    owner_wallet: HOLDER,
    related_user: null,
    related_wallet: null,
  },
];

/**
 * Build an authentic encrypted `.pmp` (manifest + records) sealed to the holder whose key
 * derives from `holderSig`, using ONLY the server crypto primitives — exactly mirroring
 * encryptRecordsForHolder's per-record encoding + the writeRegisterRespond merkle binding.
 */
async function buildEncryptedPack(holderSig: Uint8Array) {
  const holderKp = await deriveOwnerEncryptionKeypair(holderSig);
  const dek = generateDek();
  const { wrapped, wrapPubkey } = wrapDek(dek, holderKp.publicKey);
  const verifierCt = makeVerifierCiphertext(holderKp.secretKey);

  const leaves: string[] = [];
  const records = [];
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
    const hasTags = m.tags.length > 0;
    records.push({
      id: m.id,
      created_at: m.created_at,
      kind: m.kind,
      content: encryptField(m.content, dek), // base64(nonce ‖ ct)
      tags: hasTags ? [encryptField(JSON.stringify(m.tags), dek)] : [],
      importance: m.importance,
      source: m.source,
      encrypted: true,
      metadata: {
        leaf_hash: leaf,
        owner_wallet: m.owner_wallet,
        related_user: m.related_user,
        related_wallet: m.related_wallet,
      },
    });
  }

  const root = await merkleRoot(leaves);

  const manifest = {
    memorypack_version: '0.2',
    producer: { name: 'clude-server', version: '0.2', public_key: HOLDER },
    created_at: '2026-06-27T18:30:00.000Z',
    record_count: records.length,
    record_schema: 'clude-memory-v1',
    encryption: {
      algorithm: 'xsalsa20-poly1305' as const,
      nonce_strategy: 'per-record-random' as const,
      key_derivation: 'owner-sealed' as const,
      scope: 'records' as const,
      owner: {
        recipient_wallet: HOLDER,
        recipient_pubkey: b64(holderKp.publicKey),
        verifier_ct: verifierCt,
        dek_wrap: wrapped,
        wrap_pubkey: wrapPubkey,
      },
    },
    pmp: {
      pmp_version: '0.8',
      title: 'Maya pack',
      license_type: 'title',
      record_count: records.length,
      leaf_hash_algorithm: 'memory-hash-v1',
      merkle_algorithm: 'sha256-merkle-v1',
      merkle_root: root,
      creator_pubkey: HOLDER,
    },
  };

  return { manifest, records };
}

// ── 1. PARITY FIXTURE (load-bearing) ────────────────────────────────────────────────────────

describe('deriveOwnerKeypairBrowser — HKDF parity with the server', () => {
  it('derives byte-identical publicKey AND secretKey to the server for a fixed signature', async () => {
    const sig = fixedSignature();
    const browserKp = await deriveOwnerKeypairBrowser(sig);
    const serverKp = await deriveOwnerEncryptionKeypair(sig);

    expect(Array.from(browserKp.publicKey)).toEqual(Array.from(serverKp.publicKey));
    expect(Array.from(browserKp.secretKey)).toEqual(Array.from(serverKp.secretKey));
  });

  it('is deterministic — same signature in, same keypair out', async () => {
    const a = await deriveOwnerKeypairBrowser(fixedSignature());
    const b = await deriveOwnerKeypairBrowser(fixedSignature());
    expect(Array.from(a.secretKey)).toEqual(Array.from(b.secretKey));
  });

  it('a different signature derives a different keypair', async () => {
    const a = await deriveOwnerKeypairBrowser(fixedSignature());
    const b = await deriveOwnerKeypairBrowser(otherSignature());
    expect(Array.from(a.secretKey)).not.toEqual(Array.from(b.secretKey));
  });
});

// ── 2. ROUND-TRIP ─────────────────────────────────────────────────────────────────────────

describe('decryptPmp — round-trip', () => {
  it('recovers the ORIGINAL plaintext records and verified === true', async () => {
    const sig = fixedSignature();
    const { manifest, records } = await buildEncryptedPack(sig);

    const out = await decryptPmp(manifest, records, sig);

    expect(out.verified).toBe(true);
    expect(out.records).toHaveLength(PLAINTEXT_MEMORIES.length);
    expect(out.records[0]!.content).toBe(PLAINTEXT_MEMORIES[0]!.content);
    expect(out.records[0]!.tags).toEqual(PLAINTEXT_MEMORIES[0]!.tags);
    // empty-tags record stays []
    expect(out.records[1]!.content).toBe(PLAINTEXT_MEMORIES[1]!.content);
    expect(out.records[1]!.tags).toEqual([]);
    // ciphertext marker cleared; structural fields preserved
    expect(out.records[0]!.encrypted).toBeFalsy();
    expect(out.records[0]!.id).toBe(PLAINTEXT_MEMORIES[0]!.id);
  });
});

// ── 3. WRONG KEY — never returns partial plaintext ──────────────────────────────────────────

describe('decryptPmp — wrong wallet', () => {
  it('throws (never returns partial plaintext) when the signature is wrong', async () => {
    const { manifest, records } = await buildEncryptedPack(fixedSignature());
    await expect(decryptPmp(manifest, records, otherSignature())).rejects.toThrow();
  });
});

// ── 4. VERIFIER GATE FIRES FIRST ────────────────────────────────────────────────────────────

describe('decryptPmp — verifier gate runs before any record', () => {
  it('rejects on the verifier check before decrypting records (wrong sig, intact records)', async () => {
    const { manifest, records } = await buildEncryptedPack(fixedSignature());
    // Wrong signature → verifier_ct.open returns null → must throw at the GATE, before touching
    // record ciphertext. We assert a throw; the message should reference the verifier/wallet, not
    // a per-record failure.
    await expect(decryptPmp(manifest, records, otherSignature())).rejects.toThrow(/wallet|verifier/i);
  });
});

// ── 5. TAMPER — each independent mutation fails closed ──────────────────────────────────────

describe('decryptPmp — tamper detection (fail closed)', () => {
  it('tampered record content → secretbox.open fails → throws', async () => {
    const sig = fixedSignature();
    const { manifest, records } = await buildEncryptedPack(sig);
    // flip a byte inside the content ciphertext (after the nonce)
    const raw = Uint8Array.from(atob(records[0]!.content), (c) => c.charCodeAt(0));
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 0xff;
    records[0]!.content = b64(raw);
    await expect(decryptPmp(manifest, records, sig)).rejects.toThrow();
  });

  it('tampered dek_wrap → box.open fails → throws', async () => {
    const sig = fixedSignature();
    const { manifest, records } = await buildEncryptedPack(sig);
    const raw = Uint8Array.from(atob(manifest.encryption.owner.dek_wrap), (c) => c.charCodeAt(0));
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 0xff;
    manifest.encryption.owner.dek_wrap = b64(raw);
    await expect(decryptPmp(manifest, records, sig)).rejects.toThrow();
  });

  it('tampered metadata.leaf_hash → integrity check fails → verified === false (or throws)', async () => {
    const sig = fixedSignature();
    const { manifest, records } = await buildEncryptedPack(sig);
    // Corrupt the declared leaf hash; decryption still succeeds, but integrity must fail.
    (records[0]!.metadata as Record<string, unknown>).leaf_hash =
      '0000000000000000000000000000000000000000000000000000000000000000';
    let verified: boolean | undefined;
    try {
      const out = await decryptPmp(manifest, records, sig);
      verified = out.verified;
    } catch {
      verified = false; // a throw is also an acceptable fail-closed outcome
    }
    expect(verified).toBe(false);
  });
});
