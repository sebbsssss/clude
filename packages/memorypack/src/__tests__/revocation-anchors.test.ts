// Chain-anchored revocations — pure-function + reader integration tests.
//
// We don't mock @solana/web3.js here (the package has no Solana RPC
// mocks today); the verifier function itself is exercised end-to-end
// in fork tests. These tests cover:
//   - expectedRevocationMemo formatting
//   - appendRevocationAnchors append-only file behaviour
//   - reader exposes revocationAnchors when revocations + anchors match
//   - reader skips anchors whose (record_hash, revoked_at) pair has no
//     matching verified revocation
//   - reader skips anchors with unsupported anchor_format
//   - reader skips malformed anchor lines
//   - streamMemoryPack exposes revocationAnchors
//   - writeMemoryPack wipes prior revocation_anchors.jsonl on re-export

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
  appendRevocationAnchors,
  appendRevocations,
  expectedRevocationMemo,
  hashRecordLine,
  readMemoryPack,
  streamMemoryPack,
  writeMemoryPack,
} from '../index.js';
import { FIXTURE_RECORDS, FIXTURE_CLOCK } from './fixtures.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mp-revanchor-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function writeSignedFixturePack(target: string) {
  const kp = nacl.sign.keyPair();
  writeMemoryPack(target, FIXTURE_RECORDS, {
    producer: { name: 'clude', version: '0.6.0', public_key: bs58.encode(kp.publicKey) },
    record_schema: 'clude-memory-v3',
    secretKey: kp.secretKey,
    clock: FIXTURE_CLOCK,
  });
  return kp;
}

function recordHashAt(idx: number): string {
  const lines = readFileSync(join(dir, 'records.jsonl'), 'utf-8')
    .split('\n')
    .filter((l) => l.length > 0);
  return hashRecordLine(lines[idx]);
}

// ────────────────────────────────────────────────────────────────────
// Pure function
// ────────────────────────────────────────────────────────────────────

describe('expectedRevocationMemo', () => {
  it('formats `revoke:v1:<record_hash>:<revoked_at>` exactly', () => {
    const hash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
    const at = '2026-04-29T12:00:00Z';
    expect(expectedRevocationMemo(hash, at)).toBe(`revoke:v1:${hash}:${at}`);
  });

  it('output fits well within Solana memo cap', () => {
    const hash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
    const at = '2026-04-29T12:00:00.000Z';
    const memo = expectedRevocationMemo(hash, at);
    // Solana memo limit is 566 bytes. We're under 100. Sanity bound:
    expect(memo.length).toBeLessThan(120);
    expect(memo.length).toBeGreaterThan(80);
  });
});

// ────────────────────────────────────────────────────────────────────
// appendRevocationAnchors — file I/O
// ────────────────────────────────────────────────────────────────────

describe('appendRevocationAnchors', () => {
  it('writes a revocation_anchors.jsonl with the expected entry shape', () => {
    writeSignedFixturePack(dir);
    const written = appendRevocationAnchors(dir, [
      {
        record_hash: 'sha256:abc',
        revoked_at: '2026-04-29T00:00:00Z',
        chain: 'solana-mainnet',
        tx: '5K8mZTXTX',
        slot: 248_000_000,
      },
    ]);
    expect(written).toHaveLength(1);
    expect(written[0].anchor_format).toBe('memo-revoke-v1');

    const lines = readFileSync(join(dir, 'revocation_anchors.jsonl'), 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toMatchObject({
      record_hash: 'sha256:abc',
      revoked_at: '2026-04-29T00:00:00Z',
      chain: 'solana-mainnet',
      tx: '5K8mZTXTX',
      slot: 248_000_000,
      anchor_format: 'memo-revoke-v1',
    });
  });

  it('appends rather than overwriting on subsequent calls', () => {
    writeSignedFixturePack(dir);
    appendRevocationAnchors(dir, [{
      record_hash: 'sha256:1', revoked_at: '2026-04-29T00:00:00Z', chain: 'solana-mainnet', tx: 't1',
    }]);
    appendRevocationAnchors(dir, [{
      record_hash: 'sha256:2', revoked_at: '2026-04-29T01:00:00Z', chain: 'solana-mainnet', tx: 't2',
    }]);
    const lines = readFileSync(join(dir, 'revocation_anchors.jsonl'), 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).tx).toBe('t1');
    expect(JSON.parse(lines[1]).tx).toBe('t2');
  });

  it('throws when tarball file does not exist', () => {
    expect(() =>
      appendRevocationAnchors(join(dir, 'nonexistent-pack.tar.zst'), [{
        record_hash: 'sha256:abc', revoked_at: '2026-04-29T00:00:00Z', chain: 'solana-mainnet', tx: 't',
      }]),
    ).toThrow(/not found/i);
  });

  it('throws when manifest.json missing', () => {
    expect(() =>
      appendRevocationAnchors(dir, [{
        record_hash: 'sha256:abc', revoked_at: '2026-04-29T00:00:00Z', chain: 'solana-mainnet', tx: 't',
      }]),
    ).toThrow(/manifest\.json/);
  });

  it('no-op on empty input', () => {
    writeSignedFixturePack(dir);
    expect(appendRevocationAnchors(dir, [])).toHaveLength(0);
    expect(existsSync(join(dir, 'revocation_anchors.jsonl'))).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// Reader integration
// ────────────────────────────────────────────────────────────────────

describe('readMemoryPack — revocation anchors', () => {
  it('exposes revocationAnchors when paired revocation exists', () => {
    const kp = writeSignedFixturePack(dir);
    const hash = recordHashAt(0);
    appendRevocations(dir, [{ record_hash: hash, reason: 'gdpr' }], {
      secretKey: kp.secretKey,
      publicKey: bs58.encode(kp.publicKey),
      clock: () => '2026-04-29T00:00:00.000Z',
    });
    appendRevocationAnchors(dir, [{
      record_hash: hash,
      revoked_at: '2026-04-29T00:00:00.000Z',
      chain: 'solana-mainnet',
      tx: '5K8mZ...',
    }]);

    const result = readMemoryPack(dir);
    expect(result.revocationAnchors).toHaveLength(1);
    expect(result.revocationAnchors[0].record_hash).toBe(hash);
    expect(result.verifiedRevocationAnchors.size).toBe(0); // no RPC call
  });

  it('skips anchor whose (hash, revoked_at) pair has no matching revocation', () => {
    const kp = writeSignedFixturePack(dir);
    const hash = recordHashAt(0);
    // Revocation says revoked_at = T0 but anchor says T1 — pair doesn't match
    appendRevocations(dir, [{ record_hash: hash }], {
      secretKey: kp.secretKey,
      publicKey: bs58.encode(kp.publicKey),
      clock: () => '2026-04-29T00:00:00.000Z',
    });
    appendRevocationAnchors(dir, [{
      record_hash: hash,
      revoked_at: '2026-04-29T01:00:00.000Z', // ← wrong
      chain: 'solana-mainnet',
      tx: 't',
    }]);

    const result = readMemoryPack(dir);
    expect(result.revocationAnchors).toHaveLength(0);
    expect(result.warnings.some((w) => /does not match/.test(w))).toBe(true);
  });

  it('skips anchor with unsupported anchor_format', () => {
    const kp = writeSignedFixturePack(dir);
    const hash = recordHashAt(0);
    appendRevocations(dir, [{ record_hash: hash }], {
      secretKey: kp.secretKey,
      publicKey: bs58.encode(kp.publicKey),
      clock: () => '2026-04-29T00:00:00.000Z',
    });
    // Hand-write an anchor with unknown format
    writeFileSync(join(dir, 'revocation_anchors.jsonl'), JSON.stringify({
      record_hash: hash,
      revoked_at: '2026-04-29T00:00:00.000Z',
      chain: 'solana-mainnet',
      tx: 't',
      anchor_format: 'memo-revoke-v9000',
    }) + '\n');

    const result = readMemoryPack(dir);
    expect(result.revocationAnchors).toHaveLength(0);
    expect(result.warnings.some((w) => /unsupported format/.test(w))).toBe(true);
  });

  it('skips malformed lines without throwing', () => {
    writeSignedFixturePack(dir);
    writeFileSync(join(dir, 'revocation_anchors.jsonl'), 'not json\n{also\n');
    const result = readMemoryPack(dir);
    expect(result.revocationAnchors).toHaveLength(0);
    expect(result.warnings.filter((w) => /malformed line/.test(w))).toHaveLength(2);
  });
});

// ────────────────────────────────────────────────────────────────────
// Stream integration
// ────────────────────────────────────────────────────────────────────

describe('streamMemoryPack — revocation anchors', () => {
  it('exposes revocationAnchors alongside the iterator', async () => {
    const kp = writeSignedFixturePack(dir);
    const hash = recordHashAt(0);
    appendRevocations(dir, [{ record_hash: hash }], {
      secretKey: kp.secretKey,
      publicKey: bs58.encode(kp.publicKey),
      clock: () => '2026-04-29T00:00:00.000Z',
    });
    appendRevocationAnchors(dir, [{
      record_hash: hash,
      revoked_at: '2026-04-29T00:00:00.000Z',
      chain: 'solana-mainnet',
      tx: 'streamed-tx',
    }]);

    const { revocationAnchors, records } = await streamMemoryPack(dir);
    expect(revocationAnchors).toHaveLength(1);
    expect(revocationAnchors[0].tx).toBe('streamed-tx');

    let count = 0;
    for await (const _ of records) count++;
    expect(count).toBe(FIXTURE_RECORDS.length);
  });
});

// ────────────────────────────────────────────────────────────────────
// Writer hygiene
// ────────────────────────────────────────────────────────────────────

describe('writeMemoryPack — wipes prior revocation_anchors.jsonl', () => {
  it('does not preserve anchors from prior writes', () => {
    const kp = writeSignedFixturePack(dir);
    const hash = recordHashAt(0);
    appendRevocations(dir, [{ record_hash: hash }], {
      secretKey: kp.secretKey,
      publicKey: bs58.encode(kp.publicKey),
      clock: () => '2026-04-29T00:00:00.000Z',
    });
    appendRevocationAnchors(dir, [{
      record_hash: hash,
      revoked_at: '2026-04-29T00:00:00.000Z',
      chain: 'solana-mainnet',
      tx: 't',
    }]);
    expect(existsSync(join(dir, 'revocation_anchors.jsonl'))).toBe(true);

    // Re-export
    writeMemoryPack(dir, FIXTURE_RECORDS, {
      producer: { name: 'clude', version: '0.6.0', public_key: bs58.encode(kp.publicKey) },
      record_schema: 'clude-memory-v3',
      secretKey: kp.secretKey,
      clock: FIXTURE_CLOCK,
    });
    expect(existsSync(join(dir, 'revocation_anchors.jsonl'))).toBe(false);
  });
});
