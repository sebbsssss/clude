// Tarball-aware appends — appendRevocations + appendRevocationAnchors
// now operate on .tar.zst files transparently.
//
// Coverage:
//   - Append revocations to a tarball, read back, verify presence
//   - Append revocation anchors to a tarball, read back
//   - Atomic-rename safety: a successful append leaves no orphan
//     `<tarball>.new-...` siblings
//   - Tarball with multiple top-level dirs is rejected
//   - Empty input early-returns without re-tarballing
//     (tarball mtime / bytes unchanged)
//   - Append + verify round-trip on tarballs uses streamMemoryPack too

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import nacl from 'tweetnacl';
// @ts-ignore — bs58 is ESM-only, works at runtime via Node CJS/ESM interop
import * as bs58Module from 'bs58';
const bs58: { encode: (b: Uint8Array) => string; decode: (s: string) => Uint8Array } =
  (bs58Module as any).default || bs58Module;
import {
  appendRevocationAnchors,
  appendRevocations,
  hashRecordLine,
  readMemoryPack,
  streamMemoryPack,
  writeMemoryPack,
} from '../index.js';
import { FIXTURE_RECORDS, FIXTURE_CLOCK } from './fixtures.js';

let workdir: string;
beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), 'mp-tar-append-')); });
afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

function buildSignedTarball(target: string) {
  const kp = nacl.sign.keyPair();
  writeMemoryPack(target, FIXTURE_RECORDS, {
    producer: { name: 'clude', version: '0.7.0', public_key: bs58.encode(kp.publicKey) },
    record_schema: 'clude-memory-v3',
    secretKey: kp.secretKey,
    clock: FIXTURE_CLOCK,
    format: 'tarball',
  });
  return kp;
}

function readPackHash(target: string): string {
  // Pull the canonical hash of FIXTURE_RECORDS[0] from the tarball.
  // Extract to a temp dir, hash records.jsonl line 1, clean up.
  const tmp = mkdtempSync(join(tmpdir(), 'mp-hash-'));
  try {
    spawnSync('tar', ['--zstd', '-xf', target, '-C', tmp]);
    const inner = join(tmp, readdirSync(tmp)[0]);
    const lines = readFileSync(join(inner, 'records.jsonl'), 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    return hashRecordLine(lines[0]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ────────────────────────────────────────────────────────────────────
// Revocations on tarballs
// ────────────────────────────────────────────────────────────────────

describe('appendRevocations on tarball packs', () => {
  it('round-trips: append → read → revocation present', () => {
    const tarball = join(workdir, 'pack.tar.zst');
    const kp = buildSignedTarball(tarball);
    const hash = readPackHash(tarball);

    const written = appendRevocations(
      tarball,
      [{ record_hash: hash, reason: 'gdpr-tarball' }],
      {
        secretKey: kp.secretKey,
        publicKey: bs58.encode(kp.publicKey),
        clock: () => '2026-04-29T12:00:00.000Z',
      },
    );
    expect(written).toHaveLength(1);

    // Re-read the tarball and confirm the revocation made it in.
    const result = readMemoryPack(tarball);
    expect(result.revocations).toHaveLength(1);
    expect(result.revocations[0].reason).toBe('gdpr-tarball');
    expect(result.revokedRecordHashes.has(hash)).toBe(true);
  });

  it('successful append leaves no orphan staging files in the workdir', () => {
    const tarball = join(workdir, 'pack.tar.zst');
    const kp = buildSignedTarball(tarball);
    const hash = readPackHash(tarball);

    appendRevocations(tarball, [{ record_hash: hash }], {
      secretKey: kp.secretKey,
      publicKey: bs58.encode(kp.publicKey),
    });

    const siblings = readdirSync(workdir);
    expect(siblings).toEqual(['pack.tar.zst']);
  });

  it('multiple appends to the same tarball stack', () => {
    const tarball = join(workdir, 'pack.tar.zst');
    const kp = buildSignedTarball(tarball);
    const hash = readPackHash(tarball);
    const opts = {
      secretKey: kp.secretKey,
      publicKey: bs58.encode(kp.publicKey),
      clock: (() => {
        let i = 0;
        return () => `2026-04-29T12:00:0${i++}.000Z`;
      })(),
    };

    appendRevocations(tarball, [{ record_hash: hash, reason: 'first' }], opts);
    appendRevocations(tarball, [{ record_hash: hash, reason: 'second' }], opts);

    const result = readMemoryPack(tarball);
    expect(result.revocations).toHaveLength(2);
    expect(result.revocations.map((r) => r.reason)).toEqual(['first', 'second']);
  });

  it('empty input is a no-op — does not re-tarball', () => {
    const tarball = join(workdir, 'pack.tar.zst');
    buildSignedTarball(tarball);
    const before = readFileSync(tarball);

    const written = appendRevocations(tarball, [], {
      secretKey: new Uint8Array(64),
      publicKey: 'fake',
    });
    expect(written).toHaveLength(0);

    const after = readFileSync(tarball);
    expect(after.equals(before)).toBe(true);
  });

  it('rejects tarball with multiple top-level dirs', () => {
    // Hand-build a malformed tarball with two top-level directories.
    const stagingDir = mkdtempSync(join(tmpdir(), 'mp-bad-tar-'));
    try {
      const a = join(stagingDir, 'pack-a');
      const b = join(stagingDir, 'pack-b');
      writeMemoryPack(a, FIXTURE_RECORDS, {
        producer: { name: 'clude', version: '0.7.0' },
        record_schema: 'clude-memory-v3',
      });
      writeMemoryPack(b, FIXTURE_RECORDS, {
        producer: { name: 'clude', version: '0.7.0' },
        record_schema: 'clude-memory-v3',
      });
      const target = join(workdir, 'malformed.tar.zst');
      const r = spawnSync('tar', ['--zstd', '-cf', target, '-C', stagingDir, 'pack-a', 'pack-b']);
      expect(r.status).toBe(0);

      expect(() =>
        appendRevocations(target, [{ record_hash: 'sha256:abc' }], {
          secretKey: new Uint8Array(64),
          publicKey: 'fake',
        }),
      ).toThrow(/single top-level dir/);
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Revocation anchors on tarballs
// ────────────────────────────────────────────────────────────────────

describe('appendRevocationAnchors on tarball packs', () => {
  it('round-trips: append revocation + anchor → read → both present', () => {
    const tarball = join(workdir, 'pack.tar.zst');
    const kp = buildSignedTarball(tarball);
    const hash = readPackHash(tarball);

    appendRevocations(tarball, [{ record_hash: hash }], {
      secretKey: kp.secretKey,
      publicKey: bs58.encode(kp.publicKey),
      clock: () => '2026-04-29T12:00:00.000Z',
    });
    const written = appendRevocationAnchors(tarball, [{
      record_hash: hash,
      revoked_at: '2026-04-29T12:00:00.000Z',
      chain: 'solana-mainnet',
      tx: 'tarball-tx',
    }]);
    expect(written).toHaveLength(1);

    const result = readMemoryPack(tarball);
    expect(result.revocations).toHaveLength(1);
    expect(result.revocationAnchors).toHaveLength(1);
    expect(result.revocationAnchors[0].tx).toBe('tarball-tx');
  });

  it('streamMemoryPack also surfaces the appended anchor', async () => {
    const tarball = join(workdir, 'pack.tar.zst');
    const kp = buildSignedTarball(tarball);
    const hash = readPackHash(tarball);

    appendRevocations(tarball, [{ record_hash: hash }], {
      secretKey: kp.secretKey,
      publicKey: bs58.encode(kp.publicKey),
      clock: () => '2026-04-29T13:00:00.000Z',
    });
    appendRevocationAnchors(tarball, [{
      record_hash: hash,
      revoked_at: '2026-04-29T13:00:00.000Z',
      chain: 'solana-mainnet',
      tx: 'streamed-tarball-tx',
    }]);

    const { revocationAnchors, records } = await streamMemoryPack(tarball);
    expect(revocationAnchors).toHaveLength(1);
    expect(revocationAnchors[0].tx).toBe('streamed-tarball-tx');

    let count = 0;
    for await (const _ of records) count++;
    expect(count).toBe(FIXTURE_RECORDS.length);
  });

  it('empty input is a no-op — does not re-tarball', () => {
    const tarball = join(workdir, 'pack.tar.zst');
    buildSignedTarball(tarball);
    const before = readFileSync(tarball);

    const written = appendRevocationAnchors(tarball, []);
    expect(written).toHaveLength(0);

    const after = readFileSync(tarball);
    expect(after.equals(before)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// Sanity: directory packs still work (regression guard)
// ────────────────────────────────────────────────────────────────────

describe('directory-mode appends still work after refactor', () => {
  it('appendRevocations on directory unchanged', () => {
    const dir = join(workdir, 'pack');
    const kp = nacl.sign.keyPair();
    writeMemoryPack(dir, FIXTURE_RECORDS, {
      producer: { name: 'clude', version: '0.7.0', public_key: bs58.encode(kp.publicKey) },
      record_schema: 'clude-memory-v3',
      secretKey: kp.secretKey,
      clock: FIXTURE_CLOCK,
    });
    const lines = readFileSync(join(dir, 'records.jsonl'), 'utf-8')
      .split('\n').filter((l) => l.length > 0);
    const hash = hashRecordLine(lines[0]);

    appendRevocations(dir, [{ record_hash: hash, reason: 'directory-mode' }], {
      secretKey: kp.secretKey,
      publicKey: bs58.encode(kp.publicKey),
    });
    const result = readMemoryPack(dir);
    expect(result.revocations).toHaveLength(1);
    expect(result.revocations[0].reason).toBe('directory-mode');
  });
});
