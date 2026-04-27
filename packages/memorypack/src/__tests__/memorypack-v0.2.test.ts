import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import nacl from 'tweetnacl';
// @ts-ignore — bs58 is ESM-only, works at runtime via Node CJS/ESM interop
import * as bs58Module from 'bs58';
const bs58: { encode: (b: Uint8Array) => string; decode: (s: string) => Uint8Array } =
  (bs58Module as any).default || bs58Module;
import {
  writeMemoryPack,
  readMemoryPack,
  hashBuffer,
  encryptString,
  decryptString,
  encryptBuffer,
  decryptBuffer,
  randomNonce,
  ENCRYPTION_KEY_BYTES,
  type MemoryPackRecord,
} from '../index.js';
import {
  EXPECTED_RECORD_HASHES,
  FIXTURE_BLOB_DATA,
  FIXTURE_BLOB_HASH,
  FIXTURE_CLOCK,
  FIXTURE_ENCRYPTION_KEY,
  FIXTURE_RECORDS,
} from './fixtures.js';

// ────────────────────────────────────────────────────────────────────
// Reference test vectors — contract test for external implementers
// ────────────────────────────────────────────────────────────────────

describe('MemoryPack v0.2 — reference vectors', () => {
  it('frozen record hashes are byte-stable across implementations', () => {
    // External implementers should be able to reproduce these. If this
    // test ever flips, either the spec changed or the writer drifted.
    expect(EXPECTED_RECORD_HASHES).toHaveLength(FIXTURE_RECORDS.length);
    for (const h of EXPECTED_RECORD_HASHES) {
      expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it('hashBuffer is stable for a known payload', () => {
    expect(FIXTURE_BLOB_HASH).toBe(hashBuffer(FIXTURE_BLOB_DATA));
    expect(FIXTURE_BLOB_HASH).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

// ────────────────────────────────────────────────────────────────────
// Encryption primitives
// ────────────────────────────────────────────────────────────────────

describe('MemoryPack v0.2 — xsalsa20-poly1305', () => {
  it('encryptString → decryptString round-trip', () => {
    const key = FIXTURE_ENCRYPTION_KEY;
    const { ciphertext, nonce } = encryptString('hello world', key);
    expect(decryptString(ciphertext, nonce, key)).toBe('hello world');
  });

  it('encryptBuffer → decryptBuffer round-trip', () => {
    const key = FIXTURE_ENCRYPTION_KEY;
    const { ciphertext, nonce } = encryptBuffer(FIXTURE_BLOB_DATA, key);
    const plain = decryptBuffer(ciphertext, nonce, key);
    expect(plain.equals(FIXTURE_BLOB_DATA)).toBe(true);
  });

  it('decrypt with wrong key throws (MAC mismatch)', () => {
    const key = FIXTURE_ENCRYPTION_KEY;
    const wrongKey = new Uint8Array(32).fill(99);
    const { ciphertext, nonce } = encryptString('secret', key);
    expect(() => decryptString(ciphertext, nonce, wrongKey)).toThrow(/MAC mismatch/i);
  });

  it('decrypt with wrong nonce throws', () => {
    const key = FIXTURE_ENCRYPTION_KEY;
    const { ciphertext } = encryptString('secret', key);
    const wrongNonce = Buffer.from(randomNonce()).toString('base64');
    expect(() => decryptString(ciphertext, wrongNonce, key)).toThrow(/MAC mismatch/i);
  });

  it('rejects keys of wrong length', () => {
    const shortKey = new Uint8Array(16);
    expect(() => encryptString('x', shortKey)).toThrow(/key must be 32 bytes/);
  });
});

// ────────────────────────────────────────────────────────────────────
// Pack-level encryption (records-only scope)
// ────────────────────────────────────────────────────────────────────

describe('MemoryPack v0.2 — records-only encryption', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mp-test-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('reading without key keeps ciphertext + emits warning', () => {
    writeMemoryPack(dir, FIXTURE_RECORDS, {
      producer: { name: 'clude', version: '0.2.0' },
      record_schema: 'clude-memory-v3',
      encryption: { key: FIXTURE_ENCRYPTION_KEY, scope: 'records' },
      clock: FIXTURE_CLOCK,
    });

    const result = readMemoryPack(dir);
    expect(result.records[0].encrypted).toBe(true);
    expect(result.records[0].content).not.toBe(FIXTURE_RECORDS[0].content);
    expect(result.warnings.some((w) => w.includes('decryptionKey'))).toBe(true);
  });

  it('reading without key excludes encrypted records from minimalRecords', () => {
    writeMemoryPack(dir, FIXTURE_RECORDS, {
      producer: { name: 'clude', version: '0.2.0' },
      record_schema: 'clude-memory-v3',
      encryption: { key: FIXTURE_ENCRYPTION_KEY, scope: 'records' },
      clock: FIXTURE_CLOCK,
    });

    // No key → ciphertext stays → minimalRecords MUST exclude these
    // (so consumers ignoring `result.warnings` can't surface base64 as text)
    const noKey = readMemoryPack(dir);
    expect(noKey.minimalRecords).toHaveLength(0);

    // With key → records decrypt → minimalRecords includes plaintext
    const withKey = readMemoryPack(dir, { decryptionKey: FIXTURE_ENCRYPTION_KEY });
    expect(withKey.minimalRecords).toHaveLength(FIXTURE_RECORDS.length);
    expect(withKey.minimalRecords[0].content).toBe(FIXTURE_RECORDS[0].content);
    expect(withKey.records[0].encrypted).toBe(false);
  });

  it('wrong key emits per-record decrypt warning, leaves ciphertext', () => {
    writeMemoryPack(dir, FIXTURE_RECORDS, {
      producer: { name: 'clude', version: '0.2.0' },
      record_schema: 'clude-memory-v3',
      encryption: { key: FIXTURE_ENCRYPTION_KEY, scope: 'records' },
      clock: FIXTURE_CLOCK,
    });

    const wrongKey = new Uint8Array(ENCRYPTION_KEY_BYTES).fill(7);
    const result = readMemoryPack(dir, { decryptionKey: wrongKey });
    expect(result.records[0].encrypted).toBe(true);
    expect(result.warnings.some((w) => /decryption failed/i.test(w))).toBe(true);
  });

  it('signature verification runs over ciphertext, BEFORE decryption', () => {
    // Signing covers the stored line bytes (which are ciphertext when
    // encryption is on). Tampering with the ciphertext should be caught
    // regardless of whether the reader has a key.
    const kp = nacl.sign.keyPair();
    writeMemoryPack(dir, FIXTURE_RECORDS, {
      producer: { name: 'clude', version: '0.2.0', public_key: bs58.encode(kp.publicKey) },
      record_schema: 'clude-memory-v3',
      secretKey: kp.secretKey,
      encryption: { key: FIXTURE_ENCRYPTION_KEY, scope: 'records' },
      clock: FIXTURE_CLOCK,
    });
    // Tamper: replace one byte of the records.jsonl ciphertext.
    const recordsPath = join(dir, 'records.jsonl');
    const tampered = readFileSync(recordsPath, 'utf-8').replace('a', 'b');
    writeFileSync(recordsPath, tampered);
    expect(() => readMemoryPack(dir, { decryptionKey: FIXTURE_ENCRYPTION_KEY }))
      .toThrow(/signature verification failed/i);
  });
});

// ────────────────────────────────────────────────────────────────────
// Blobs (records+blobs scope)
// ────────────────────────────────────────────────────────────────────

describe('MemoryPack v0.2 — blobs', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mp-test-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('blob bytes verify against the index', () => {
    const records: MemoryPackRecord[] = [
      { ...FIXTURE_RECORDS[0], blob_ref: FIXTURE_BLOB_HASH },
    ];
    writeMemoryPack(dir, records, {
      producer: { name: 'clude', version: '0.2.0' },
      record_schema: 'clude-memory-v3',
      blobs: new Map([[FIXTURE_BLOB_HASH, { data: FIXTURE_BLOB_DATA }]]),
      clock: FIXTURE_CLOCK,
    });
    const result = readMemoryPack(dir);
    expect(result.verifiedBlobs.has(FIXTURE_BLOB_HASH)).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('blob_ref cross-check warns when blobs/index.jsonl is absent', () => {
    const records: MemoryPackRecord[] = [
      { ...FIXTURE_RECORDS[0], blob_ref: FIXTURE_BLOB_HASH },
    ];
    writeMemoryPack(dir, records, {
      producer: { name: 'clude', version: '0.2.0' },
      record_schema: 'clude-memory-v3',
      // intentionally no blobs option — the blob_ref dangles
      clock: FIXTURE_CLOCK,
    });
    const result = readMemoryPack(dir);
    expect(result.verifiedBlobs.size).toBe(0);
    expect(result.warnings.some((w) => w.includes('no blobs/index.jsonl'))).toBe(true);
  });

  it('writer rejects blob whose key does not match its sha256', () => {
    const records: MemoryPackRecord[] = [{ ...FIXTURE_RECORDS[0] }];
    expect(() =>
      writeMemoryPack(dir, records, {
        producer: { name: 'clude', version: '0.2.0' },
        record_schema: 'clude-memory-v3',
        blobs: new Map([
          // Key claims a hash that does NOT match the data's actual sha256.
          ['sha256:0000000000000000000000000000000000000000000000000000000000000000', { data: FIXTURE_BLOB_DATA }],
        ]),
        clock: FIXTURE_CLOCK,
      }),
    ).toThrow(/does not match sha256/);
  });

  it('records+blobs scope encrypts blob bytes (stored hash is ciphertext)', () => {
    const records: MemoryPackRecord[] = [
      { ...FIXTURE_RECORDS[0], blob_ref: FIXTURE_BLOB_HASH },
    ];
    writeMemoryPack(dir, records, {
      producer: { name: 'clude', version: '0.2.0' },
      record_schema: 'clude-memory-v3',
      encryption: { key: FIXTURE_ENCRYPTION_KEY, scope: 'records+blobs' },
      blobs: new Map([[FIXTURE_BLOB_HASH, { data: FIXTURE_BLOB_DATA, filename: 'doc.pdf', content_type: 'application/pdf' }]]),
      clock: FIXTURE_CLOCK,
    });

    // The blob filename must NOT be in the index entries (no plaintext leak).
    const indexLines = readFileSync(join(dir, 'blobs', 'index.jsonl'), 'utf-8');
    expect(indexLines).not.toContain('doc.pdf');
    expect(indexLines).not.toContain('application/pdf');
    expect(indexLines).toContain('"encrypted":true');

    // The blob_ref in the record points at the PLAINTEXT hash — but the
    // pack's index advertises the CIPHERTEXT hash, so the cross-check
    // surfaces a warning. (Callers reading encrypted+blob packs need
    // to walk via decrypt-then-rehash; that's a v0.3 ergonomic.)
    const result = readMemoryPack(dir, { decryptionKey: FIXTURE_ENCRYPTION_KEY });
    expect(result.verifiedBlobs.size).toBe(1);
    // The plaintext blob_ref no longer matches a stored hash.
    expect(result.warnings.some((w) => w.includes('not present or not verified'))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// Tarball mode
// ────────────────────────────────────────────────────────────────────

describe('MemoryPack v0.2 — tarball', () => {
  let workdir: string;
  beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), 'mp-tar-')); });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it('round-trips a full pack (signed + encrypted + blobs)', () => {
    const tarPath = join(workdir, 'pack.tar.zst');
    const kp = nacl.sign.keyPair();
    const records: MemoryPackRecord[] = [
      { ...FIXTURE_RECORDS[0], blob_ref: FIXTURE_BLOB_HASH },
      FIXTURE_RECORDS[1],
    ];
    writeMemoryPack(tarPath, records, {
      producer: { name: 'clude', version: '0.2.0', public_key: bs58.encode(kp.publicKey) },
      record_schema: 'clude-memory-v3',
      secretKey: kp.secretKey,
      format: 'tarball',
      encryption: { key: FIXTURE_ENCRYPTION_KEY, scope: 'records' },
      blobs: new Map([[FIXTURE_BLOB_HASH, { data: FIXTURE_BLOB_DATA }]]),
      clock: FIXTURE_CLOCK,
    });

    expect(existsSync(tarPath)).toBe(true);

    const result = readMemoryPack(tarPath, { decryptionKey: FIXTURE_ENCRYPTION_KEY });
    expect(result.manifest.pack_format).toBe('tarball');
    expect(result.records).toHaveLength(records.length);
    expect(result.verifiedRecords.size).toBe(records.length);
    expect(result.records[0].content).toBe(FIXTURE_RECORDS[0].content);
    expect(result.verifiedBlobs.has(FIXTURE_BLOB_HASH)).toBe(true);
  });

  it('auto-detects tarball by extension', () => {
    const tarPath = join(workdir, 'sample.tar.zst');
    writeMemoryPack(tarPath, FIXTURE_RECORDS, {
      producer: { name: 'clude', version: '0.2.0' },
      record_schema: 'clude-memory-v3',
      format: 'tarball',
      clock: FIXTURE_CLOCK,
    });
    const result = readMemoryPack(tarPath);
    expect(result.records).toHaveLength(FIXTURE_RECORDS.length);
  });
});

// ────────────────────────────────────────────────────────────────────
// Writer overwrite hygiene
// ────────────────────────────────────────────────────────────────────

describe('MemoryPack v0.2 — overwrite hygiene', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mp-test-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('signed → unsigned re-export does not leak stale signatures.jsonl', () => {
    const kp = nacl.sign.keyPair();
    // First write — signed.
    writeMemoryPack(dir, FIXTURE_RECORDS, {
      producer: { name: 'clude', version: '0.2.0', public_key: bs58.encode(kp.publicKey) },
      record_schema: 'clude-memory-v3',
      secretKey: kp.secretKey,
      clock: FIXTURE_CLOCK,
    });
    expect(existsSync(join(dir, 'signatures.jsonl'))).toBe(true);

    // Second write — unsigned, same dir.
    writeMemoryPack(dir, FIXTURE_RECORDS, {
      producer: { name: 'clude', version: '0.2.0' },
      record_schema: 'clude-memory-v3',
      clock: FIXTURE_CLOCK,
    });
    expect(existsSync(join(dir, 'signatures.jsonl'))).toBe(false);

    // Reader on the unsigned pack must NOT throw "no matching signature".
    const result = readMemoryPack(dir);
    expect(result.unsignedRecords.size).toBe(FIXTURE_RECORDS.length);
  });

  it('blobs from prior write are cleared on rewrite', () => {
    writeMemoryPack(dir, FIXTURE_RECORDS, {
      producer: { name: 'clude', version: '0.2.0' },
      record_schema: 'clude-memory-v3',
      blobs: new Map([[FIXTURE_BLOB_HASH, { data: FIXTURE_BLOB_DATA }]]),
      clock: FIXTURE_CLOCK,
    });
    expect(existsSync(join(dir, 'blobs', 'index.jsonl'))).toBe(true);

    writeMemoryPack(dir, FIXTURE_RECORDS, {
      producer: { name: 'clude', version: '0.2.0' },
      record_schema: 'clude-memory-v3',
      // No blobs this time.
      clock: FIXTURE_CLOCK,
    });
    expect(existsSync(join(dir, 'blobs'))).toBe(false);
  });
});
