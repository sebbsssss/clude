import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeMemoryPack, type WriterOptions } from '../writer';
import { readMemoryPack } from '../reader';
import type { MemoryPackRecord } from '../types';

/**
 * Memory 3.0 B1.5: the Track B1 exit gate, round-trip stability.
 *
 * export -> import -> re-export must be STABLE: records survive byte-identical,
 * the owner-sealed encryption header survives verbatim, and the manifest the
 * writer RETURNS (B1.2a) is the manifest the reader finds in the file. Covers
 * plain and encrypted records through REAL tarballs (no mocks).
 */

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mp-roundtrip-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const RECORDS: MemoryPackRecord[] = [
  {
    id: 'clude-aaaa0001',
    kind: 'semantic',
    content: 'the plain fact',
    created_at: '2026-06-01T00:00:00.000Z',
    tags: ['b1'],
    importance: 0.5,
    source: 'chat',
    metadata: { leaf_hash: 'lh:plain' },
  } as unknown as MemoryPackRecord,
  {
    id: 'clude-aaaa0002',
    kind: 'episodic',
    content: 'Q0lQSEVSVEVYVA==', // ciphertext body
    created_at: '2026-06-02T00:00:00.000Z',
    tags: [],
    importance: 0.7,
    source: 'chat',
    encrypted: true,
    nonce: 'b64:nonce-1',
    metadata: { leaf_hash: 'lh:secret' },
  } as unknown as MemoryPackRecord,
];

const OWNER_HEADER = {
  recipient_wallet: 'HolderWallet1111111111111111111111111111111',
  recipient_pubkey: 'b64:recipient-x25519',
  verifier_ct: 'b64:verifier',
  dek_wrap: 'b64:sealed-dek',
  wrap_pubkey: 'b64:ephemeral-pub',
};

const OPTS: WriterOptions = {
  producer: { name: 'clude-server', version: '0.2', public_key: 'ExporterPubKey' },
  record_schema: 'clude-memory-v1',
  format: 'tarball',
  pmp: {
    pmp_version: '0.8',
    title: 'Round Trip Pack',
    license_type: 'copy',
    merkle_root: 'sha256:feedface',
    merkle_algorithm: 'sha256-merkle-v1', // v1 recorded => v1 rules forever
  },
  ownerEncryption: OWNER_HEADER,
} as unknown as WriterOptions;

const stripCreatedAt = (m: Record<string, unknown>) => {
  const { created_at: _dropped, ...rest } = m;
  return rest;
};

describe('export -> import -> re-export round-trip (B1.5 gate)', () => {
  it('is stable through two full write/read cycles, plain + encrypted, header intact', () => {
    // Cycle 1
    const pack1 = join(dir, 'cycle1.pmp');
    const written1 = writeMemoryPack(pack1, RECORDS, OPTS);
    const read1 = readMemoryPack(pack1);

    // B1.2a contract: the RETURNED manifest is the manifest IN the file.
    expect(read1.manifest.created_at).toBe(written1.created_at);
    expect(read1.manifest.pack_format).toBe('tarball');
    expect(stripCreatedAt(read1.manifest as unknown as Record<string, unknown>)).toEqual(
      stripCreatedAt(written1 as unknown as Record<string, unknown>),
    );

    // The owner-sealed header survives verbatim (the encrypted-import prerequisite).
    expect(read1.manifest.encryption?.key_derivation).toBe('owner-sealed');
    expect(read1.manifest.encryption?.owner).toEqual(OWNER_HEADER);

    // v1 rules forever: the recorded merkle algorithm rides untouched.
    expect((read1.manifest.pmp as Record<string, unknown>).merkle_algorithm).toBe('sha256-merkle-v1');

    // Cycle 2: re-export what was read.
    const pack2 = join(dir, 'cycle2.pmp');
    const written2 = writeMemoryPack(pack2, read1.records, OPTS);
    const read2 = readMemoryPack(pack2);

    // Records byte-stable across the full cycle — including the ciphertext one.
    expect(read2.records).toEqual(read1.records);
    const enc = read2.records.find((r) => (r as { encrypted?: boolean }).encrypted);
    expect(enc).toBeDefined();
    expect((enc as { content: string }).content).toBe('Q0lQSEVSVEVYVA==');
    expect((enc as { nonce?: string }).nonce).toBe('b64:nonce-1');

    // Manifest identity stable modulo the wall clock.
    expect(stripCreatedAt(read2.manifest as unknown as Record<string, unknown>)).toEqual(
      stripCreatedAt(read1.manifest as unknown as Record<string, unknown>),
    );
    expect(written2.record_count).toBe(written1.record_count);
  });
});
