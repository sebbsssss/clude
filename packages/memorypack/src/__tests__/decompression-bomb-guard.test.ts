// Decompression-bomb guard for `.tar.zst` extraction (opsec H1).
//
// An unauthenticated POST /v1/pmp/verify stages + zstd-extracts attacker-controlled bytes. A small
// archive can expand thousands-fold, so extractTarball caps the UNCOMPRESSED size: it sums the sizes
// the `tar -tvf` listing declares (pre-extract, GNU tar) AND statSyncs the extracted tree as a
// backstop (post-extract, platform-independent). Either layer throws past the cap. The cap is
// MEMORYPACK_MAX_UNCOMPRESSED_BYTES (default 64MB), read at extraction time so it is tunable here.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import nacl from 'tweetnacl';
// @ts-ignore — bs58 is ESM-only, works at runtime via Node CJS/ESM interop
import * as bs58Module from 'bs58';
const bs58: { encode: (b: Uint8Array) => string } = (bs58Module as any).default || bs58Module;
import { readMemoryPack, writeMemoryPack } from '../index.js';
import { FIXTURE_RECORDS, FIXTURE_CLOCK } from './fixtures.js';

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'mp-bomb-'));
});
afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  delete process.env.MEMORYPACK_MAX_UNCOMPRESSED_BYTES;
});

function buildTarball(target: string): void {
  const kp = nacl.sign.keyPair();
  writeMemoryPack(target, FIXTURE_RECORDS, {
    producer: { name: 'clude', version: '0.7.0', public_key: bs58.encode(kp.publicKey) },
    record_schema: 'clude-memory-v3',
    secretKey: kp.secretKey,
    clock: FIXTURE_CLOCK,
    format: 'tarball',
  });
}

describe('decompression-bomb guard (opsec H1)', () => {
  it('refuses a .tar.zst whose uncompressed size exceeds the cap', () => {
    const tarball = join(workdir, 'pack.tar.zst');
    buildTarball(tarball);
    // The fixture pack is well over 50 bytes uncompressed; the guard must reject it.
    process.env.MEMORYPACK_MAX_UNCOMPRESSED_BYTES = '50';
    expect(() => readMemoryPack(tarball)).toThrow(/decompression-bomb guard/);
  });

  it('reads a normal pack at the default cap — no false positive', () => {
    const tarball = join(workdir, 'pack.tar.zst');
    buildTarball(tarball);
    const result = readMemoryPack(tarball); // env unset → 64MB default
    expect(result.records.length).toBe(FIXTURE_RECORDS.length);
  });
});
