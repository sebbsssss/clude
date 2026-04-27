// Reference test vectors for MemoryPack v0.2.
//
// External implementers can reproduce these from the same inputs to
// confirm their writer/reader hashes match the canonical implementation.
// Stable across runs because the clock is injected.

import type { MemoryPackRecord } from '../types.js';
import { hashRecordLine, hashBuffer } from '../sign.js';
import { serializeRecord } from '../writer.js';

/** A frozen set of input records. */
export const FIXTURE_RECORDS: MemoryPackRecord[] = [
  {
    id: '01HZRF000000000000000001',
    created_at: '2026-04-16T06:12:33Z',
    kind: 'episodic',
    content: 'User confirmed weekly newsletter cadence.',
    tags: ['preferences', 'newsletter'],
    importance: 0.72,
    source: 'chat',
  },
  {
    id: '01HZRF000000000000000002',
    created_at: '2026-04-16T06:13:00Z',
    kind: 'semantic',
    content: 'Clude signs each record with ed25519.',
    tags: ['spec'],
    importance: 0.8,
    source: 'doc',
    summary: 'ed25519 signing is mandatory for signed packs.',
  },
];

/** A frozen blob payload + its sha256. */
export const FIXTURE_BLOB_DATA = Buffer.from('reference attachment v0.2', 'utf-8');
export const FIXTURE_BLOB_HASH = hashBuffer(FIXTURE_BLOB_DATA);

/** A frozen 32-byte encryption key (deterministic for test vectors). */
export const FIXTURE_ENCRYPTION_KEY: Uint8Array = new Uint8Array(
  Array.from({ length: 32 }, (_, i) => i + 1),
);

/**
 * A frozen clock — every writer call that uses opts.clock = FIXTURE_CLOCK
 * sees the same `created_at`. Pair with a deterministic content set
 * to get byte-identical packs across runs (modulo random nonces, when
 * encryption is enabled).
 */
export const FIXTURE_CLOCK_ISO = '2026-04-16T06:12:33Z';
export const FIXTURE_CLOCK = () => FIXTURE_CLOCK_ISO;

/**
 * Expected per-record hashes for the canonical v0.2 fixture.
 *
 * Computed on the FROZEN serialized line bytes, so external implementers
 * can use these as a contract test:
 *  serialize(FIXTURE_RECORDS[i]) | sha256 | hex  === EXPECTED_RECORD_HASHES[i]
 */
export const EXPECTED_RECORD_HASHES: string[] = FIXTURE_RECORDS.map((r) =>
  hashRecordLine(serializeRecord(r)),
);
