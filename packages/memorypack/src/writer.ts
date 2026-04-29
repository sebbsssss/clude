import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { basename, dirname, join, resolve } from 'path';
import {
  MEMORYPACK_VERSION,
  MemoryPackAnchor,
  MemoryPackBlobIndex,
  MemoryPackManifest,
  MemoryPackRecord,
  MemoryPackRevocation,
  MemoryPackRevocationAnchor,
  MemoryPackSignature,
} from './types.js';
import {
  encryptBuffer,
  encryptString,
  ENCRYPTION_KEY_BYTES,
  hashBuffer,
  hashRecordLine,
  signHash,
  signRevocation,
} from './sign.js';

// ────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────

export interface WriterBlob {
  /** Raw bytes the producer wants attached. */
  data: Buffer | Uint8Array;
  filename?: string;
  content_type?: string;
}

export interface WriterEncryption {
  /** 32-byte symmetric key (xsalsa20-poly1305 secret). */
  key: Uint8Array;
  /**
   * What the encryption envelope covers.
   * - `records`        — only `record.content`
   * - `records+blobs`  — record.content AND blob bytes/index metadata
   *
   * Default `records+blobs` when blobs are supplied; otherwise `records`.
   */
  scope?: 'records' | 'records+blobs';
}

export interface WriterOptions {
  producer: {
    name: string;
    version: string;
    agent_id?: string;
    did?: string;
    public_key?: string;
  };
  record_schema: string;
  /** 64-byte ed25519 secret key. When set + `producer.public_key` set, records get signed. */
  secretKey?: Uint8Array;
  anchor_chain?: string;

  // ── v0.2 ──

  /** `directory` (default) emits a folder; `tarball` emits `.tar.zst`. */
  format?: 'directory' | 'tarball';
  /** Pack-level encryption envelope. */
  encryption?: WriterEncryption;
  /** Map of blob hash (`sha256:hex` of plaintext) → blob payload. */
  blobs?: Map<string, WriterBlob>;
  /** Caller-supplied chain anchor entries (written to anchors.jsonl). */
  anchors?: MemoryPackAnchor[];
  /**
   * Override the timestamp source for deterministic test vectors.
   * Default: `() => new Date().toISOString()`.
   */
  clock?: () => string;
}

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

/**
 * Serialize one record to a JSONL line with stable key order. Stable
 * order matters because the line bytes are what gets hashed and signed.
 */
export function serializeRecord(record: MemoryPackRecord): string {
  const KNOWN_ORDER: (keyof MemoryPackRecord)[] = [
    'id',
    'created_at',
    'kind',
    'content',
    'tags',
    'importance',
    'source',
    'summary',
    'embedding',
    'embedding_model',
    'metadata',
    'access_count',
    'last_accessed_at',
    'parent_ids',
    'compacted_from',
    'blob_ref',
    'encrypted',
    'nonce',
  ];
  const out: Record<string, unknown> = {};
  for (const k of KNOWN_ORDER) {
    if (record[k] !== undefined) out[k] = record[k];
  }
  const recAsUnknown = record as unknown as Record<string, unknown>;
  const unknownKeys = Object.keys(recAsUnknown).filter(
    (k) => !KNOWN_ORDER.includes(k as keyof MemoryPackRecord),
  );
  for (const k of unknownKeys.sort()) {
    out[k] = recAsUnknown[k];
  }
  return JSON.stringify(out);
}

/**
 * Write a MemoryPack to disk.
 *
 * `format: 'directory'` (default) writes the pack as a folder at `targetPath`.
 * `format: 'tarball'` writes a `.tar.zst` file at `targetPath` (which SHOULD
 * end in `.tar.zst`); contents are staged in a sibling temp dir, tarred via
 * the system `tar` binary, and the temp dir is cleaned up.
 *
 * Cross-platform note: the tarball mode invokes `tar --zstd` via spawnSync
 * (no shell), so it works on macOS, Linux, and Windows (≥1803, where
 * Microsoft ships bsdtar with zstd support) without quoting hazards.
 */
export function writeMemoryPack(
  targetPath: string,
  records: MemoryPackRecord[],
  opts: WriterOptions,
): void {
  const format = opts.format ?? 'directory';
  if (format === 'tarball') {
    writeTarball(targetPath, records, opts);
    return;
  }
  writeDirectory(targetPath, records, opts);
}

// ────────────────────────────────────────────────────────────────────
// Directory mode
// ────────────────────────────────────────────────────────────────────

function writeDirectory(
  dir: string,
  records: MemoryPackRecord[],
  opts: WriterOptions,
): void {
  // Clear known prior outputs so a re-export over an existing pack
  // directory doesn't leak stale signatures/anchors/blobs into the new
  // pack. Only removes our own well-known files; foreign files in the
  // target dir are left alone.
  if (existsSync(dir)) {
    for (const f of [
      'manifest.json',
      'records.jsonl',
      'signatures.jsonl',
      'anchors.jsonl',
      'revocations.jsonl',
      'revocation_anchors.jsonl',
    ]) {
      const p = join(dir, f);
      if (existsSync(p)) rmSync(p, { force: true });
    }
    const blobsDir = join(dir, 'blobs');
    if (existsSync(blobsDir)) rmSync(blobsDir, { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });

  const clock = opts.clock ?? (() => new Date().toISOString());

  // Encryption normalization: default scope based on whether blobs are present.
  const encryption = opts.encryption
    ? {
        ...opts.encryption,
        scope: opts.encryption.scope ?? (opts.blobs && opts.blobs.size > 0 ? 'records+blobs' : 'records'),
      }
    : undefined;
  if (encryption && encryption.key.length !== ENCRYPTION_KEY_BYTES) {
    throw new Error(`encryption.key must be ${ENCRYPTION_KEY_BYTES} bytes`);
  }
  const encryptBlobs = encryption?.scope === 'records+blobs';

  // ── records (with optional encryption) ──
  const recordsToWrite: MemoryPackRecord[] = records.map((r) => {
    if (!encryption) return r;
    const { ciphertext, nonce } = encryptString(r.content, encryption.key);
    return { ...r, content: ciphertext, encrypted: true, nonce };
  });

  // ── manifest ──
  const manifest: MemoryPackManifest = {
    memorypack_version: MEMORYPACK_VERSION,
    producer: opts.producer,
    created_at: clock(),
    record_count: recordsToWrite.length,
    record_schema: opts.record_schema,
    signature_algorithm: opts.secretKey ? 'ed25519' : undefined,
    anchor_chain: opts.anchor_chain,
    pack_format: 'directory',
    blobs_count: opts.blobs && opts.blobs.size > 0 ? opts.blobs.size : undefined,
    encryption: encryption
      ? {
          algorithm: 'xsalsa20-poly1305',
          nonce_strategy: 'per-record-random',
          key_derivation: 'none',
          scope: encryption.scope!,
        }
      : undefined,
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // ── records.jsonl + signatures.jsonl ──
  const recordLines: string[] = [];
  const sigs: MemoryPackSignature[] = [];
  for (const record of recordsToWrite) {
    const line = serializeRecord(record);
    recordLines.push(line);

    if (opts.secretKey && opts.producer.public_key) {
      const hash = hashRecordLine(line);
      const signature = signHash(hash, opts.secretKey);
      sigs.push({
        record_hash: hash,
        signature,
        algorithm: 'ed25519',
        public_key: opts.producer.public_key,
      });
    }
  }
  writeFileSync(join(dir, 'records.jsonl'), recordLines.join('\n') + '\n');

  if (sigs.length > 0) {
    writeFileSync(
      join(dir, 'signatures.jsonl'),
      sigs.map((s) => JSON.stringify(s)).join('\n') + '\n',
    );
  }

  if (opts.anchors && opts.anchors.length > 0) {
    writeFileSync(
      join(dir, 'anchors.jsonl'),
      opts.anchors.map((a) => JSON.stringify(a)).join('\n') + '\n',
    );
  }

  // ── blobs ──
  if (opts.blobs && opts.blobs.size > 0) {
    const blobsDir = join(dir, 'blobs', 'sha256');
    mkdirSync(blobsDir, { recursive: true });
    const indexEntries: MemoryPackBlobIndex[] = [];
    for (const [declaredHash, blob] of opts.blobs.entries()) {
      const dataBuf = Buffer.from(blob.data);
      const computedPlainHash = hashBuffer(dataBuf);
      if (computedPlainHash !== declaredHash) {
        throw new Error(
          `MemoryPack: blob key '${declaredHash}' does not match sha256 of data (computed ${computedPlainHash})`,
        );
      }
      let storedBytes: Buffer;
      let entry: MemoryPackBlobIndex;
      if (encryptBlobs && encryption) {
        const { ciphertext, nonce } = encryptBuffer(dataBuf, encryption.key);
        storedBytes = ciphertext;
        const storedHash = hashBuffer(ciphertext);
        entry = {
          hash: storedHash,
          byte_size: ciphertext.length,
          encrypted: true,
          nonce,
          // filename + content_type intentionally omitted under records+blobs
          // encryption to avoid leaking attachment metadata in cleartext.
        };
      } else {
        storedBytes = dataBuf;
        entry = {
          hash: declaredHash,
          byte_size: dataBuf.length,
          content_type: blob.content_type,
          filename: blob.filename,
        };
      }
      const hex = entry.hash.replace(/^sha256:/, '');
      writeFileSync(join(blobsDir, hex), storedBytes);
      indexEntries.push(entry);
    }
    writeFileSync(
      join(dir, 'blobs', 'index.jsonl'),
      indexEntries.map((e) => JSON.stringify(e)).join('\n') + '\n',
    );
  }
}

// ────────────────────────────────────────────────────────────────────
// Tarball mode
// ────────────────────────────────────────────────────────────────────

function writeTarball(
  targetPath: string,
  records: MemoryPackRecord[],
  opts: WriterOptions,
): void {
  const targetAbs = resolve(targetPath);
  const parent = dirname(targetAbs);
  // Stable inner-dir name: derived from the target filename so the
  // archive layout is deterministic across PIDs and clocks.
  const innerName = basename(targetAbs).replace(/\.tar\.zst$/i, '') || 'memorypack';
  const tmpRoot = `${targetAbs}.tmp-${process.pid}-${Date.now()}`;
  const stagingDir = join(tmpRoot, innerName);
  mkdirSync(stagingDir, { recursive: true });

  try {
    // Stage as a directory pack, then tar the inner directory.
    writeDirectory(stagingDir, records, opts);

    // Patch manifest to reflect the actual on-disk packaging.
    const manifestPath = join(stagingDir, 'manifest.json');
    const manifest = JSON.parse(
      require('fs').readFileSync(manifestPath, 'utf-8'),
    ) as MemoryPackManifest;
    manifest.pack_format = 'tarball';
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // Invoke `tar` directly via argv array — no shell, no quoting hazards.
    // Works on macOS/Linux GNU tar and Windows bsdtar (≥1803).
    const res = spawnSync(
      'tar',
      ['--zstd', '-cf', targetAbs, '-C', tmpRoot, innerName],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    if (res.error) {
      throw new Error(
        `MemoryPack: failed to invoke 'tar' (${(res.error as Error).message}). Install a recent tar with zstd support.`,
      );
    }
    if (res.status !== 0) {
      const stderr = res.stderr ? res.stderr.toString() : '';
      throw new Error(
        `MemoryPack: tar --zstd failed (exit ${res.status}): ${stderr.trim() || 'no stderr'}`,
      );
    }
    // Sanity: the archive should exist and be non-empty.
    if (!existsSync(targetAbs) || statSync(targetAbs).size === 0) {
      throw new Error('MemoryPack: tar produced an empty archive');
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// ────────────────────────────────────────────────────────────────────
// Revocations — append-only soft-delete protocol (v0.3)
//
// `appendRevocations` is intentionally separate from `writeMemoryPack`.
// Records and signatures are immutable; revocations are added post-hoc.
// The function appends signed entries to revocations.jsonl without
// touching records.jsonl, signatures.jsonl, anchors.jsonl, or
// manifest.json.
//
// Tarball mode is NOT supported in v0.3. Operators with .tar.zst packs
// should: (1) extract, (2) appendRevocations, (3) re-tarball via
// writeMemoryPack with format: 'tarball'. Direct append-to-tarball is
// v0.4.
// ────────────────────────────────────────────────────────────────────

export interface RevocationInput {
  /** sha256:<hex> of the record being revoked. */
  record_hash: string;
  /** Free-form, optional. */
  reason?: string;
}

export interface AppendRevocationsOptions {
  /** 64-byte ed25519 secret key — same one that signed the records. */
  secretKey: Uint8Array;
  /** base58-encoded ed25519 public key. */
  publicKey: string;
  /**
   * Override the timestamp source for deterministic test vectors.
   * Default: `() => new Date().toISOString()`.
   */
  clock?: () => string;
}

/**
 * Append signed revocations to a MemoryPack. Accepts either a directory
 * pack or a `.tar.zst` tarball. Returns the full revocation entries
 * that were written.
 *
 * For tarballs the function extracts to a temp dir, appends to the
 * inner directory, repacks atomically (write-temp + rename), and
 * cleans up. The original tarball is untouched until the new one is
 * fully written, so a mid-flight failure leaves the original intact.
 *
 * Idempotent at the (record_hash, revoked_at) level: callers passing
 * the same input twice will get duplicate entries because the
 * `revoked_at` differs. To dedupe, pre-check via `readMemoryPack`'s
 * `revokedRecordHashes` set.
 */
export function appendRevocations(
  packPath: string,
  revocations: RevocationInput[],
  opts: AppendRevocationsOptions,
): MemoryPackRevocation[] {
  if (revocations.length === 0) return [];

  if (isTarballPath(packPath)) {
    return withExtractedTarball(packPath, (innerDir) =>
      appendRevocationsToDirectory(innerDir, revocations, opts),
    );
  }
  return appendRevocationsToDirectory(packPath, revocations, opts);
}

function appendRevocationsToDirectory(
  packDir: string,
  revocations: RevocationInput[],
  opts: AppendRevocationsOptions,
): MemoryPackRevocation[] {
  if (!existsSync(packDir) || !statSync(packDir).isDirectory()) {
    throw new Error(`appendRevocations: ${packDir} is not a directory`);
  }
  if (!existsSync(join(packDir, 'manifest.json'))) {
    throw new Error(`appendRevocations: ${packDir} is missing manifest.json`);
  }
  if (revocations.length === 0) return [];

  const clock = opts.clock ?? (() => new Date().toISOString());

  const built: MemoryPackRevocation[] = revocations.map((r) => {
    const revoked_at = clock();
    const signature = signRevocation(r.record_hash, revoked_at, opts.secretKey);
    return {
      record_hash: r.record_hash,
      revoked_at,
      reason: r.reason,
      signature,
      algorithm: 'ed25519',
      public_key: opts.publicKey,
    };
  });

  const path = join(packDir, 'revocations.jsonl');
  const existing = existsSync(path) ? readFileSync(path, 'utf-8') : '';
  const trailingNewline = existing.length === 0 || existing.endsWith('\n');
  const appended =
    (trailingNewline ? existing : existing + '\n') +
    built.map((r) => JSON.stringify(r)).join('\n') +
    '\n';
  writeFileSync(path, appended);

  return built;
}

// ────────────────────────────────────────────────────────────────────
// Revocation anchors — chain-anchored timing proofs (v0.6)
//
// `appendRevocationAnchors` is the writer-side companion to
// `verifyRevocationAnchors`. The producer (or whoever else holds the
// pack):
//   1. Already wrote a revocations.jsonl entry via appendRevocations.
//   2. Issued a Solana tx with memo `revoke:v1:sha256:<hex>:<rfc3339>`
//      using whatever Solana wallet/lib they prefer. We don't ship a
//      tx-builder here.
//   3. Calls this function with the tx signature.
// The append goes to revocation_anchors.jsonl.
// ────────────────────────────────────────────────────────────────────

export interface RevocationAnchorInput {
  record_hash: string;
  revoked_at: string;
  chain: string;
  tx: string;
  slot?: number;
}

/**
 * Append chain-anchor entries to revocation_anchors.jsonl. Accepts
 * either a directory pack or a `.tar.zst` tarball — same atomic
 * extract/repack flow as appendRevocations.
 *
 * The (record_hash, revoked_at) pair MUST match an existing entry in
 * revocations.jsonl — otherwise the chain anchor is meaningless. This
 * function does not enforce that cross-check (callers shouldn't have
 * to load the whole revocations file just to append); the verifier
 * does enforce it.
 */
export function appendRevocationAnchors(
  packPath: string,
  anchors: RevocationAnchorInput[],
): MemoryPackRevocationAnchor[] {
  if (anchors.length === 0) return [];

  if (isTarballPath(packPath)) {
    return withExtractedTarball(packPath, (innerDir) =>
      appendRevocationAnchorsToDirectory(innerDir, anchors),
    );
  }
  return appendRevocationAnchorsToDirectory(packPath, anchors);
}

function appendRevocationAnchorsToDirectory(
  packDir: string,
  anchors: RevocationAnchorInput[],
): MemoryPackRevocationAnchor[] {
  if (!existsSync(packDir) || !statSync(packDir).isDirectory()) {
    throw new Error(`appendRevocationAnchors: ${packDir} is not a directory`);
  }
  if (!existsSync(join(packDir, 'manifest.json'))) {
    throw new Error(`appendRevocationAnchors: ${packDir} is missing manifest.json`);
  }
  if (anchors.length === 0) return [];

  const built: MemoryPackRevocationAnchor[] = anchors.map((a) => ({
    record_hash: a.record_hash,
    revoked_at: a.revoked_at,
    chain: a.chain,
    tx: a.tx,
    slot: a.slot,
    anchor_format: 'memo-revoke-v1',
  }));

  const path = join(packDir, 'revocation_anchors.jsonl');
  const existing = existsSync(path) ? readFileSync(path, 'utf-8') : '';
  const trailingNewline = existing.length === 0 || existing.endsWith('\n');
  const appended =
    (trailingNewline ? existing : existing + '\n') +
    built.map((a) => JSON.stringify(a)).join('\n') +
    '\n';
  writeFileSync(path, appended);

  return built;
}

// ────────────────────────────────────────────────────────────────────
// Tarball-aware append helper (v0.7)
//
// The append APIs accept .tar.zst paths transparently. For each
// invocation we:
//   1. Extract the tarball into a per-call temp dir.
//   2. Run the directory-mode append against the inner pack dir.
//   3. Repack the inner dir into `<original>.new`.
//   4. Atomically rename `<original>.new` → `<original>`.
//   5. Clean up the temp dir.
//
// The atomic rename means a mid-flight failure (tar exit, JSON write
// error, signal) leaves the ORIGINAL tarball intact. The producer's
// audit trail never enters a half-written state.
//
// Concurrent appends to the same tarball are NOT safe — last writer
// wins. Same constraint as concurrent writes to a directory pack;
// callers needing multi-process coordination must layer their own
// locking. Documented in CHANGELOG.
// ────────────────────────────────────────────────────────────────────

function isTarballPath(path: string): boolean {
  if (/\.tar\.zst$/i.test(path)) return true;
  // Some callers may pass a tarball without the canonical extension.
  // Stat-then-isFile so directory packs (which we want to handle in
  // directory-mode) don't get routed through the tarball path.
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function withExtractedTarball<T>(
  tarballPath: string,
  fn: (innerDir: string) => T,
): T {
  if (!existsSync(tarballPath)) {
    throw new Error(`tarball not found: ${tarballPath}`);
  }

  const extractRoot = mkdtempSync(join(tmpdir(), 'mp-append-'));
  try {
    const extract = spawnSync(
      'tar',
      ['--zstd', '-xf', tarballPath, '-C', extractRoot],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    if (extract.status !== 0) {
      const stderr = extract.stderr ? extract.stderr.toString() : '';
      throw new Error(
        `tar --zstd extraction failed: ${stderr.trim() || 'no stderr'}`,
      );
    }

    const entries = readdirSync(extractRoot);
    if (entries.length !== 1) {
      throw new Error(
        `tarball expected single top-level dir, got ${entries.length}`,
      );
    }
    const innerName = entries[0];
    const innerDir = join(extractRoot, innerName);

    // Run the caller's mutation against the extracted directory.
    const result = fn(innerDir);

    // Repack to a sibling temp file, then atomically rename. If the
    // tar invocation fails, we throw before touching the original.
    const stagingPath = `${tarballPath}.new-${process.pid}-${Date.now()}`;
    const repack = spawnSync(
      'tar',
      ['--zstd', '-cf', stagingPath, '-C', extractRoot, innerName],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    if (repack.status !== 0) {
      try { rmSync(stagingPath, { force: true }); } catch { /* ignore */ }
      const stderr = repack.stderr ? repack.stderr.toString() : '';
      throw new Error(
        `tar --zstd repack failed: ${stderr.trim() || 'no stderr'}`,
      );
    }
    if (!existsSync(stagingPath) || statSync(stagingPath).size === 0) {
      try { rmSync(stagingPath, { force: true }); } catch { /* ignore */ }
      throw new Error('tar produced an empty repack');
    }

    renameSync(stagingPath, tarballPath);
    return result;
  } finally {
    rmSync(extractRoot, { recursive: true, force: true });
  }
}
