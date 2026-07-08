import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  writeMemoryPack,
  readMemoryPack,
  isOwnerSealed,
  type MemoryPackRecord,
  type OwnerEncryptionHeader,
} from '../index.js';
import { FIXTURE_CLOCK, FIXTURE_RECORDS } from './fixtures.js';

// ────────────────────────────────────────────────────────────────────
// Owner-sealed encryption header (manifest.encryption.owner) — Task 3
//
// The encrypted `.pmp` export (Task 2) produces ciphertext records plus a
// once-per-pack owner header. The format library must write that header into
// `manifest.encryption` (key_derivation:'owner-sealed') and round-trip it on
// parse so the browser (Task 5) can recover the DEK from the file alone —
// WITHOUT breaking any existing plaintext pack (backward compat is mandatory).
//
// Records carry NO new fields: `encrypted:true` + base64 ciphertext `content`
// (the v0.2 `encrypted?` field already models this). The DEK is pack-level in
// the header, NOT per-record — so owner-sealed records have NO top-level nonce
// (Task 2 embeds the nonce inside the content ciphertext).
// ────────────────────────────────────────────────────────────────────

/** A frozen Task-2-shaped owner header (all 5 fields). Opaque base64 stand-ins. */
const OWNER_HEADER: OwnerEncryptionHeader = {
  recipient_wallet: 'FRok11111111111111111111111111111111uhza7',
  recipient_pubkey: 'cmVjaXBpZW50LXB1YmtleS1iYXNlNjQ=',
  verifier_ct: 'dmVyaWZpZXItY2lwaGVydGV4dC1iYXNlNjQ=',
  dek_wrap: 'ZGVrLXdyYXAtbm9uY2UtcGx1cy1ib3gtYmFzZTY0',
  wrap_pubkey: 'd3JhcC1lcGhlbWVyYWwtcHVia2V5LWJhc2U2NA==',
};

/**
 * Task-2-shaped ciphertext records: `encrypted:true`, base64-ish ciphertext in
 * `content`, NO separate `nonce` (the nonce is embedded in the ciphertext). The
 * writer must persist these AS-IS — it must NOT re-encrypt or stamp a nonce.
 */
function sealedRecords(): MemoryPackRecord[] {
  return [
    {
      ...FIXTURE_RECORDS[0],
      content: 'Y2lwaGVydGV4dC1mb3ItcmVjb3JkLW9uZQ==',
      tags: ['ZW5jcnlwdGVkLXRhZ3MtYmxvYg=='],
      encrypted: true,
    },
    {
      ...FIXTURE_RECORDS[1],
      content: 'Y2lwaGVydGV4dC1mb3ItcmVjb3JkLXR3bw==',
      tags: [],
      encrypted: true,
    },
  ];
}

const baseOpts = {
  producer: { name: 'clude', version: '0.7.1' },
  record_schema: 'clude-memory-v3',
  clock: FIXTURE_CLOCK,
};

describe('MemoryPack — owner-sealed encryption header round-trip', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mp-owner-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes manifest.encryption (owner-sealed) and reads owner header back intact (directory)', () => {
    const out = join(dir, 'pack');
    const records = sealedRecords();
    writeMemoryPack(out, records, { ...baseOpts, ownerEncryption: OWNER_HEADER });

    const read = readMemoryPack(out);

    // Envelope shape is the hard contract Tasks 4 + 5 depend on.
    expect(read.manifest.encryption).toBeDefined();
    expect(read.manifest.encryption!.algorithm).toBe('xsalsa20-poly1305');
    expect(read.manifest.encryption!.nonce_strategy).toBe('per-record-random');
    expect(read.manifest.encryption!.key_derivation).toBe('owner-sealed');
    expect(read.manifest.encryption!.scope).toBe('records');

    // All 5 header fields must deep-equal what the caller supplied.
    expect(read.manifest.encryption!.owner).toEqual(OWNER_HEADER);

    // isOwnerSealed helper recognises it.
    expect(isOwnerSealed(read.manifest)).toBe(true);
  });

  it('preserves encrypted:true + ciphertext content on records (no key supplied)', () => {
    const out = join(dir, 'pack');
    const records = sealedRecords();
    writeMemoryPack(out, records, { ...baseOpts, ownerEncryption: OWNER_HEADER });

    const read = readMemoryPack(out);
    expect(read.records).toHaveLength(records.length);
    for (let i = 0; i < records.length; i++) {
      expect(read.records[i].encrypted).toBe(true);
      expect(read.records[i].content).toBe(records[i].content);
      // Owner-sealed records carry no separate top-level nonce.
      expect(read.records[i].nonce).toBeUndefined();
    }
  });

  it('does NOT re-encrypt or mutate ciphertext content the caller already produced', () => {
    // The writer must treat owner-sealed records as opaque ciphertext: the
    // bytes on disk must equal the bytes passed in (Task 2 already encrypted).
    const out = join(dir, 'pack');
    const records = sealedRecords();
    writeMemoryPack(out, records, { ...baseOpts, ownerEncryption: OWNER_HEADER });

    const jsonl = readFileSync(join(out, 'records.jsonl'), 'utf-8');
    expect(jsonl).toContain(records[0].content);
    expect(jsonl).toContain(records[1].content);
  });

  it('a reader without a key keeps ciphertext + warns (browser decrypts, not the Node reader)', () => {
    const out = join(dir, 'pack');
    writeMemoryPack(out, sealedRecords(), { ...baseOpts, ownerEncryption: OWNER_HEADER });

    const read = readMemoryPack(out);
    // No decryptionKey → ciphertext stays, encrypted records excluded from minimal projection.
    expect(read.minimalRecords).toHaveLength(0);
    expect(read.warnings.some((w) => w.includes('decryptionKey'))).toBe(true);
  });

  it('round-trips the owner header through the tarball path too', () => {
    const out = join(dir, 'pack.tar.zst');
    writeMemoryPack(out, sealedRecords(), {
      ...baseOpts,
      format: 'tarball',
      ownerEncryption: OWNER_HEADER,
    });
    expect(existsSync(out)).toBe(true);

    const read = readMemoryPack(out);
    expect(read.manifest.pack_format).toBe('tarball');
    expect(read.manifest.encryption!.key_derivation).toBe('owner-sealed');
    expect(read.manifest.encryption!.owner).toEqual(OWNER_HEADER);
    expect(isOwnerSealed(read.manifest)).toBe(true);
  });

  it('coexists with a pmp identity block in the same manifest (both survive)', () => {
    const pmp = { pmp_version: '0.8', merkle_root: 'sha256:deadbeef', license_type: 'copy' };
    const out = join(dir, 'pack');
    writeMemoryPack(out, sealedRecords(), { ...baseOpts, pmp, ownerEncryption: OWNER_HEADER });

    const read = readMemoryPack(out);
    expect(read.manifest.pmp).toEqual(pmp);
    expect(read.manifest.encryption!.owner).toEqual(OWNER_HEADER);
  });
});

// ────────────────────────────────────────────────────────────────────
// Backward compatibility (critical) — a plaintext pack written WITHOUT an
// owner header must be byte/shape-identical to today: no `encryption` block,
// no `owner`, isOwnerSealed() === false.
// ────────────────────────────────────────────────────────────────────

describe('MemoryPack — owner-sealed: backward compat with plaintext packs', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mp-owner-bc-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('omits the encryption block entirely when no ownerEncryption is supplied', () => {
    const out = join(dir, 'plain');
    writeMemoryPack(out, FIXTURE_RECORDS, baseOpts);

    // The on-disk manifest must NOT contain an encryption key at all.
    const manifestRaw = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf-8'));
    expect('encryption' in manifestRaw).toBe(false);

    const read = readMemoryPack(out);
    expect(read.manifest.encryption).toBeUndefined();
    expect(isOwnerSealed(read.manifest)).toBe(false);
    // Plaintext records stay plaintext, fully readable.
    expect(read.minimalRecords).toHaveLength(FIXTURE_RECORDS.length);
    expect(read.minimalRecords[0].content).toBe(FIXTURE_RECORDS[0].content);
  });

  it('plaintext manifest bytes are identical with and without the (absent) ownerEncryption option', () => {
    // Passing `ownerEncryption: undefined` must produce a byte-identical manifest
    // to not passing it at all — the writer's plaintext output stays stable.
    const a = join(dir, 'a');
    const b = join(dir, 'b');
    writeMemoryPack(a, FIXTURE_RECORDS, baseOpts);
    writeMemoryPack(b, FIXTURE_RECORDS, { ...baseOpts, ownerEncryption: undefined });

    const manA = readFileSync(join(a, 'manifest.json'), 'utf-8');
    const manB = readFileSync(join(b, 'manifest.json'), 'utf-8');
    expect(manA).toBe(manB);
  });
});
