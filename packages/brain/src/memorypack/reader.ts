import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  MemoryPackManifest,
  MemoryPackRecord,
  MemoryPackSignature,
  MemoryPackAnchor,
} from './types.js';
import { hashRecordLine, verifyHash } from './sign.js';

export interface ReaderResult {
  manifest: MemoryPackManifest;
  records: MemoryPackRecord[];
  verifiedRecords: Set<string>;
  unsignedRecords: Set<string>;
  anchors: MemoryPackAnchor[];
  warnings: string[];
}

export interface ReaderOptions {
  strictSignatures?: boolean;
  publicKey?: string;
}

/**
 * Read a MemoryPack directory. Validates manifest version, parses
 * records, verifies signatures against manifest's declared public key.
 *
 * When signatures.jsonl is present, this reader enforces that every
 * record has a matching valid signature. This is stricter than the
 * spec's literal "records without a signature entry are accepted as
 * unsigned" — because if a tamperer mutates a record, its hash changes
 * and the original signature becomes orphaned. Treating the mutated
 * record as "unsigned" would silently accept it. We reject.
 */
export function readMemoryPack(dir: string, opts: ReaderOptions = {}): ReaderResult {
  const warnings: string[] = [];

  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`MemoryPack: manifest.json not found in ${dir}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as MemoryPackManifest;

  if (!manifest.memorypack_version) {
    throw new Error('MemoryPack: manifest missing memorypack_version');
  }
  if (!manifest.memorypack_version.startsWith('0.')) {
    throw new Error(
      `MemoryPack: unsupported memorypack_version ${manifest.memorypack_version} (reader supports 0.x)`,
    );
  }

  const recordsPath = join(dir, 'records.jsonl');
  if (!existsSync(recordsPath)) {
    throw new Error(`MemoryPack: records.jsonl not found in ${dir}`);
  }
  const recordLines = readFileSync(recordsPath, 'utf-8').split('\n').filter(l => l.length > 0);

  const records: MemoryPackRecord[] = [];
  const lineByHash = new Map<string, string>();
  for (const line of recordLines) {
    const rec = JSON.parse(line) as MemoryPackRecord;
    records.push(rec);
    lineByHash.set(hashRecordLine(line), line);
  }

  if (records.length !== manifest.record_count) {
    warnings.push(`record_count mismatch: manifest ${manifest.record_count} vs jsonl ${records.length}`);
  }

  const verifiedRecords = new Set<string>();
  const sigsPath = join(dir, 'signatures.jsonl');
  const signaturesFilePresent = existsSync(sigsPath);
  if (signaturesFilePresent) {
    const sigLines = readFileSync(sigsPath, 'utf-8').split('\n').filter(l => l.length > 0);
    const pubkey = opts.publicKey ?? manifest.producer.public_key;
    if (!pubkey) {
      throw new Error('MemoryPack: signatures.jsonl present but no public_key in manifest');
    }

    const validSigHashes = new Set<string>();
    for (const line of sigLines) {
      const sig = JSON.parse(line) as MemoryPackSignature;
      const ok = verifyHash(sig.record_hash, sig.signature, pubkey);
      if (!ok) {
        throw new Error(`MemoryPack: signature verification failed for ${sig.record_hash}`);
      }
      validSigHashes.add(sig.record_hash);
    }

    for (const recordHash of lineByHash.keys()) {
      if (!validSigHashes.has(recordHash)) {
        throw new Error(
          `MemoryPack: signature verification failed — record ${recordHash} has no matching signature`,
        );
      }
      verifiedRecords.add(recordHash);
    }
  }

  const unsignedRecords = new Set<string>();
  if (!signaturesFilePresent) {
    for (const hash of lineByHash.keys()) unsignedRecords.add(hash);
  }

  if (opts.strictSignatures && unsignedRecords.size > 0) {
    throw new Error(
      `MemoryPack: strictSignatures=true but ${unsignedRecords.size} records are unsigned`,
    );
  }

  const anchors: MemoryPackAnchor[] = [];
  const anchorsPath = join(dir, 'anchors.jsonl');
  if (existsSync(anchorsPath)) {
    const anchorLines = readFileSync(anchorsPath, 'utf-8').split('\n').filter(l => l.length > 0);
    for (const line of anchorLines) {
      anchors.push(JSON.parse(line) as MemoryPackAnchor);
    }
  }

  return { manifest, records, verifiedRecords, unsignedRecords, anchors, warnings };
}
