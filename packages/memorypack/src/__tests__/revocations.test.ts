// Revocations — soft-delete protocol tests.
//
// Coverage:
//   - signRevocation / verifyRevocation primitives
//   - canonical payload format is what spec says it is
//   - appendRevocations writes to revocations.jsonl without touching
//     records.jsonl, signatures.jsonl, manifest.json, or anchors.jsonl
//   - readMemoryPack exposes revokedRecordHashes + revocations
//   - reader rejects revocation signed by non-producer key
//   - reader rejects forged revocation (wrong signature)
//   - streamMemoryPack exposes the same surface
//   - writeMemoryPack does NOT preserve revocations from prior writes

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import nacl from 'tweetnacl';
// @ts-ignore — bs58 is ESM-only, works at runtime via Node CJS/ESM interop
import * as bs58Module from 'bs58';
const bs58: { encode: (b: Uint8Array) => string; decode: (s: string) => Uint8Array } =
  (bs58Module as any).default || bs58Module;
import {
  appendRevocations,
  hashRecordLine,
  readMemoryPack,
  revocationPayload,
  signRevocation,
  streamMemoryPack,
  verifyRevocation,
  writeMemoryPack,
  type MemoryPackRecord,
} from '../index.js';
import { FIXTURE_RECORDS, FIXTURE_CLOCK } from './fixtures.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mp-revoke-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

// ────────────────────────────────────────────────────────────────────
// Primitives
// ────────────────────────────────────────────────────────────────────

describe('revocation primitives', () => {
  it('canonical payload format is `revoke:v1:<hash>:<rfc3339>`', () => {
    const hash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
    const at = '2026-04-28T12:00:00Z';
    expect(revocationPayload(hash, at)).toBe(`revoke:v1:${hash}:${at}`);
  });

  it('signRevocation + verifyRevocation round-trip', () => {
    const kp = nacl.sign.keyPair();
    const pubKey = bs58.encode(kp.publicKey);
    const hash = 'sha256:abc';
    const at = '2026-04-28T00:00:00Z';
    const sig = signRevocation(hash, at, kp.secretKey);
    expect(verifyRevocation(hash, at, sig, pubKey)).toBe(true);
  });

  it('verifyRevocation fails for wrong key', () => {
    const kp = nacl.sign.keyPair();
    const other = nacl.sign.keyPair();
    const sig = signRevocation('sha256:abc', '2026-04-28T00:00:00Z', kp.secretKey);
    expect(verifyRevocation('sha256:abc', '2026-04-28T00:00:00Z', sig, bs58.encode(other.publicKey))).toBe(false);
  });

  it('verifyRevocation fails when payload tampered', () => {
    const kp = nacl.sign.keyPair();
    const sig = signRevocation('sha256:abc', '2026-04-28T00:00:00Z', kp.secretKey);
    expect(verifyRevocation('sha256:def', '2026-04-28T00:00:00Z', sig, bs58.encode(kp.publicKey))).toBe(false);
    expect(verifyRevocation('sha256:abc', '2026-04-28T00:00:01Z', sig, bs58.encode(kp.publicKey))).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// appendRevocations
// ────────────────────────────────────────────────────────────────────

function writeSignedFixturePack(target: string) {
  const kp = nacl.sign.keyPair();
  writeMemoryPack(target, FIXTURE_RECORDS, {
    producer: { name: 'clude', version: '0.3.0', public_key: bs58.encode(kp.publicKey) },
    record_schema: 'clude-memory-v3',
    secretKey: kp.secretKey,
    clock: FIXTURE_CLOCK,
  });
  return kp;
}

function recordHash(record: MemoryPackRecord): string {
  // Pull the actual line from records.jsonl rather than re-serializing —
  // that way we exercise the same hash the writer signed over.
  const lines = readFileSync(join(dir, 'records.jsonl'), 'utf-8')
    .split('\n')
    .filter((l) => l.length > 0);
  const matching = lines.find((l) => JSON.parse(l).id === record.id);
  if (!matching) throw new Error(`fixture record ${record.id} not found in pack`);
  return hashRecordLine(matching);
}

describe('appendRevocations', () => {
  it('writes signed entries to revocations.jsonl', () => {
    const kp = writeSignedFixturePack(dir);
    const hash = recordHash(FIXTURE_RECORDS[0]);
    const written = appendRevocations(
      dir,
      [{ record_hash: hash, reason: 'user-erasure' }],
      {
        secretKey: kp.secretKey,
        publicKey: bs58.encode(kp.publicKey),
        clock: () => '2026-04-28T12:00:00.000Z',
      },
    );

    expect(written).toHaveLength(1);
    expect(written[0].record_hash).toBe(hash);
    expect(written[0].reason).toBe('user-erasure');
    expect(written[0].algorithm).toBe('ed25519');

    const path = join(dir, 'revocations.jsonl');
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, 'utf-8').split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.record_hash).toBe(hash);
    expect(parsed.signature).toMatch(/^base58:/);
  });

  it('appends to existing revocations.jsonl rather than overwriting', () => {
    const kp = writeSignedFixturePack(dir);
    const h1 = recordHash(FIXTURE_RECORDS[0]);
    const h2 = recordHash(FIXTURE_RECORDS[1]);
    const opts = {
      secretKey: kp.secretKey,
      publicKey: bs58.encode(kp.publicKey),
      clock: () => '2026-04-28T12:00:00.000Z',
    };

    appendRevocations(dir, [{ record_hash: h1 }], opts);
    appendRevocations(dir, [{ record_hash: h2 }], opts);

    const lines = readFileSync(join(dir, 'revocations.jsonl'), 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).record_hash).toBe(h1);
    expect(JSON.parse(lines[1]).record_hash).toBe(h2);
  });

  it('does NOT touch records.jsonl, signatures.jsonl, or manifest.json', () => {
    const kp = writeSignedFixturePack(dir);
    const recordsBytes = readFileSync(join(dir, 'records.jsonl'));
    const sigsBytes = readFileSync(join(dir, 'signatures.jsonl'));
    const manifestBytes = readFileSync(join(dir, 'manifest.json'));

    appendRevocations(
      dir,
      [{ record_hash: recordHash(FIXTURE_RECORDS[0]) }],
      { secretKey: kp.secretKey, publicKey: bs58.encode(kp.publicKey) },
    );

    expect(readFileSync(join(dir, 'records.jsonl')).equals(recordsBytes)).toBe(true);
    expect(readFileSync(join(dir, 'signatures.jsonl')).equals(sigsBytes)).toBe(true);
    expect(readFileSync(join(dir, 'manifest.json')).equals(manifestBytes)).toBe(true);
  });

  it('throws when tarball file does not exist', () => {
    expect(() =>
      appendRevocations(
        join(dir, 'nonexistent-pack.tar.zst'),
        [{ record_hash: 'sha256:abc' }],
        { secretKey: new Uint8Array(64), publicKey: 'fake' },
      ),
    ).toThrow(/not found/i);
  });

  it('throws when packDir is missing manifest.json', () => {
    expect(() =>
      appendRevocations(
        dir,
        [{ record_hash: 'sha256:abc' }],
        { secretKey: new Uint8Array(64), publicKey: 'fake' },
      ),
    ).toThrow(/manifest\.json/);
  });

  it('no-op when revocations array is empty', () => {
    writeSignedFixturePack(dir);
    const written = appendRevocations(
      dir,
      [],
      { secretKey: new Uint8Array(64), publicKey: 'fake' },
    );
    expect(written).toHaveLength(0);
    expect(existsSync(join(dir, 'revocations.jsonl'))).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// Reader integration
// ────────────────────────────────────────────────────────────────────

describe('readMemoryPack — revocations', () => {
  it('exposes revokedRecordHashes and revocations', () => {
    const kp = writeSignedFixturePack(dir);
    const hash = recordHash(FIXTURE_RECORDS[0]);
    appendRevocations(
      dir,
      [{ record_hash: hash, reason: 'gdpr' }],
      { secretKey: kp.secretKey, publicKey: bs58.encode(kp.publicKey) },
    );

    const result = readMemoryPack(dir);
    expect(result.revokedRecordHashes.has(hash)).toBe(true);
    expect(result.revocations).toHaveLength(1);
    expect(result.revocations[0].reason).toBe('gdpr');
    // Records still in the result — soft-delete, not hard-delete
    expect(result.records).toHaveLength(FIXTURE_RECORDS.length);
  });

  it('rejects revocation signed by a non-producer key', () => {
    const kp = writeSignedFixturePack(dir);
    const attacker = nacl.sign.keyPair();
    const hash = recordHash(FIXTURE_RECORDS[0]);

    // Append a revocation signed by someone else
    appendRevocations(
      dir,
      [{ record_hash: hash }],
      { secretKey: attacker.secretKey, publicKey: bs58.encode(attacker.publicKey) },
    );

    const result = readMemoryPack(dir);
    expect(result.revokedRecordHashes.has(hash)).toBe(false);
    expect(result.revocations).toHaveLength(0);
    expect(result.warnings.some((w) => /unexpected key/.test(w))).toBe(true);
  });

  it('rejects revocation with forged signature', () => {
    writeSignedFixturePack(dir);
    const path = join(dir, 'revocations.jsonl');
    // Hand-craft a revocation whose stated public_key is the producer's
    // but whose signature is garbage
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
    const producerPub = manifest.producer.public_key;
    writeFileSync(
      path,
      JSON.stringify({
        record_hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
        revoked_at: '2026-04-28T00:00:00Z',
        signature: 'base58:11111111111111111111111111111111111111111111111111111111111111111',
        algorithm: 'ed25519',
        public_key: producerPub,
      }) + '\n',
    );

    const result = readMemoryPack(dir);
    expect(result.revocations).toHaveLength(0);
    expect(result.warnings.some((w) => /signature failed/.test(w))).toBe(true);
  });

  it('skips malformed lines without throwing', () => {
    writeSignedFixturePack(dir);
    writeFileSync(join(dir, 'revocations.jsonl'), 'not json\n{also not json\n');
    const result = readMemoryPack(dir);
    expect(result.revocations).toHaveLength(0);
    expect(result.warnings.filter((w) => /malformed/.test(w))).toHaveLength(2);
  });
});

// ────────────────────────────────────────────────────────────────────
// Stream integration
// ────────────────────────────────────────────────────────────────────

describe('streamMemoryPack — revocations', () => {
  it('exposes revokedRecordHashes alongside the streaming records', async () => {
    const kp = writeSignedFixturePack(dir);
    const hash = recordHash(FIXTURE_RECORDS[1]);
    appendRevocations(
      dir,
      [{ record_hash: hash, reason: 'pii-leak' }],
      { secretKey: kp.secretKey, publicKey: bs58.encode(kp.publicKey) },
    );

    const { revocations, revokedRecordHashes, records } = await streamMemoryPack(dir);
    expect(revokedRecordHashes.has(hash)).toBe(true);
    expect(revocations[0].reason).toBe('pii-leak');

    let count = 0;
    for await (const _ of records) count++;
    expect(count).toBe(FIXTURE_RECORDS.length);
  });
});

// ────────────────────────────────────────────────────────────────────
// Writer hygiene
// ────────────────────────────────────────────────────────────────────

describe('writeMemoryPack — wipes prior revocations on re-export', () => {
  it('does not preserve revocations from prior writes', () => {
    const kp = writeSignedFixturePack(dir);
    const hash = recordHash(FIXTURE_RECORDS[0]);
    appendRevocations(
      dir,
      [{ record_hash: hash }],
      { secretKey: kp.secretKey, publicKey: bs58.encode(kp.publicKey) },
    );
    expect(existsSync(join(dir, 'revocations.jsonl'))).toBe(true);

    // Re-export. Caller wanting carry-over must explicitly re-append.
    writeMemoryPack(dir, FIXTURE_RECORDS, {
      producer: { name: 'clude', version: '0.3.0', public_key: bs58.encode(kp.publicKey) },
      record_schema: 'clude-memory-v3',
      secretKey: kp.secretKey,
      clock: FIXTURE_CLOCK,
    });
    expect(existsSync(join(dir, 'revocations.jsonl'))).toBe(false);
  });
});
