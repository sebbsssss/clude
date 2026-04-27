import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
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
  serializeRecord,
  hashRecordLine,
  signHash,
  verifyHash,
  MemoryPackRecord,
} from '../index.js';

function makeRecords(): MemoryPackRecord[] {
  return [
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
}

describe('MemoryPack round-trip', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mp-test-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('unsigned pack round-trips', () => {
    const records = makeRecords();
    writeMemoryPack(dir, records, {
      producer: { name: 'clude', version: '3.0.3' },
      record_schema: 'clude-memory-v3',
    });
    const result = readMemoryPack(dir);
    expect(result.records).toHaveLength(records.length);
    expect(result.records[0].id).toBe(records[0].id);
    expect(result.verifiedRecords.size).toBe(0);
    expect(result.unsignedRecords.size).toBe(records.length);
  });

  it('signed pack round-trips and verifies', () => {
    const records = makeRecords();
    const keypair = nacl.sign.keyPair();
    const publicKey = bs58.encode(keypair.publicKey);
    writeMemoryPack(dir, records, {
      producer: { name: 'clude', version: '3.0.3', public_key: publicKey },
      record_schema: 'clude-memory-v3',
      secretKey: keypair.secretKey,
    });
    const result = readMemoryPack(dir);
    expect(result.records).toHaveLength(records.length);
    expect(result.verifiedRecords.size).toBe(records.length);
    expect(result.unsignedRecords.size).toBe(0);
  });

  it('tampered record rejected', () => {
    const records = makeRecords();
    const keypair = nacl.sign.keyPair();
    const publicKey = bs58.encode(keypair.publicKey);
    writeMemoryPack(dir, records, {
      producer: { name: 'clude', version: '3.0.3', public_key: publicKey },
      record_schema: 'clude-memory-v3',
      secretKey: keypair.secretKey,
    });
    const recordsPath = join(dir, 'records.jsonl');
    writeFileSync(recordsPath, readFileSync(recordsPath, 'utf-8').replace('weekly', 'daily'));
    expect(() => readMemoryPack(dir)).toThrow(/signature verification failed/i);
  });

  it('wrong public key rejected', () => {
    const records = makeRecords();
    const keypair = nacl.sign.keyPair();
    const publicKey = bs58.encode(keypair.publicKey);
    writeMemoryPack(dir, records, {
      producer: { name: 'clude', version: '3.0.3', public_key: publicKey },
      record_schema: 'clude-memory-v3',
      secretKey: keypair.secretKey,
    });
    const wrongKeypair = nacl.sign.keyPair();
    expect(() => readMemoryPack(dir, { publicKey: bs58.encode(wrongKeypair.publicKey) }))
      .toThrow(/signature verification failed/i);
  });

  it('strictSignatures rejects unsigned pack', () => {
    writeMemoryPack(dir, makeRecords(), {
      producer: { name: 'clude', version: '3.0.3' },
      record_schema: 'clude-memory-v3',
    });
    expect(() => readMemoryPack(dir, { strictSignatures: true })).toThrow(/unsigned/i);
  });

  it('rejects memorypack_version outside 0.x', () => {
    writeMemoryPack(dir, makeRecords(), {
      producer: { name: 'clude', version: '3.0.3' },
      record_schema: 'clude-memory-v3',
    });
    const manifestPath = join(dir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    manifest.memorypack_version = '1.0';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => readMemoryPack(dir)).toThrow(/unsupported memorypack_version/i);
  });

  it('stable serialization order', () => {
    const a: MemoryPackRecord = {
      id: '1', created_at: '2026-04-16T00:00:00Z', kind: 'episodic',
      content: 'x', tags: ['t'], importance: 0.5, source: 'test', summary: 'y',
    };
    const b: MemoryPackRecord = {
      summary: 'y', source: 'test', importance: 0.5, tags: ['t'],
      content: 'x', kind: 'episodic', created_at: '2026-04-16T00:00:00Z', id: '1',
    };
    expect(serializeRecord(a)).toBe(serializeRecord(b));
  });
});

describe('MemoryPack sign utilities', () => {
  it('hashRecordLine is stable', () => {
    const line = '{"id":"1","content":"hi"}';
    expect(hashRecordLine(line)).toBe(hashRecordLine(line));
    expect(hashRecordLine(line)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('trailing newline is ignored', () => {
    expect(hashRecordLine('x')).toBe(hashRecordLine('x\n'));
  });

  it('sign + verify round-trips', () => {
    const kp = nacl.sign.keyPair();
    const sig = signHash('sha256:abc', kp.secretKey);
    expect(verifyHash('sha256:abc', sig, bs58.encode(kp.publicKey))).toBe(true);
  });

  it('verify fails for wrong key', () => {
    const kp = nacl.sign.keyPair();
    const other = nacl.sign.keyPair();
    const sig = signHash('sha256:abc', kp.secretKey);
    expect(verifyHash('sha256:abc', sig, bs58.encode(other.publicKey))).toBe(false);
  });
});
