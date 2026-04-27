import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  MemoryPackAnchor,
  MemoryPackBlobIndex,
  MemoryPackManifest,
  MemoryPackMinimalRecord,
  MemoryPackRecord,
  MemoryPackSignature,
} from './types.js';
import {
  decryptString,
  ENCRYPTION_KEY_BYTES,
  hashBuffer,
  hashRecordLine,
  verifyHash,
} from './sign.js';

// ────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────

export interface ReaderResult {
  manifest: MemoryPackManifest;
  /**
   * Records as written. When the pack is encrypted and a `decryptionKey`
   * was supplied, `content` is plaintext and `encrypted` is `false`.
   * When no key was supplied (or the scope didn't cover this record),
   * `content` stays as base64 ciphertext and `encrypted` stays `true`.
   */
  records: MemoryPackRecord[];
  verifiedRecords: Set<string>;
  unsignedRecords: Set<string>;
  anchors: MemoryPackAnchor[];
  /** Hashes of blobs whose bytes verified against the index. */
  verifiedBlobs: Set<string>;
  /**
   * Hashes confirmed against the chain. ALWAYS empty unless the caller
   * separately invokes `verifyChainAnchors()` and merges the result.
   * `readMemoryPack` is sync + offline by design — chain verification
   * needs an RPC and is therefore out of band.
   */
  verifiedAnchors: Set<string>;
  /**
   * Minimal projection consumers SHOULD prefer — the spec says readers
   * MUST handle this shape even when they don't recognise the
   * record_schema. Carries `encrypted` so consumers can refuse to
   * surface ciphertext as text.
   */
  minimalRecords: MemoryPackMinimalRecord[];
  warnings: string[];
}

export interface ReaderOptions {
  strictSignatures?: boolean;
  publicKey?: string;
  /**
   * Pack-level decryption key (32 bytes, xsalsa20-poly1305). When the
   * manifest declares encryption and this key is supplied, records and
   * (when scope='records+blobs') blob bytes are decrypted in place.
   * When manifest declares encryption but key is absent, the reader
   * pushes a warning, leaves ciphertext as-is, and excludes affected
   * records from `minimalRecords`.
   */
  decryptionKey?: Uint8Array;
}

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

/**
 * Read a MemoryPack from disk. Accepts either a directory or a
 * `.tar.zst` tarball; tarballs are auto-extracted to a temp dir which
 * is cleaned up before this function returns.
 *
 * Validates: manifest version, signature coverage (when present),
 * blob bytes against the index. Optionally decrypts records + blobs
 * when a `decryptionKey` is supplied.
 *
 * Chain anchor verification is intentionally out of band — call
 * `verifyChainAnchors()` separately and merge the result.
 */
export function readMemoryPack(
  path: string,
  opts: ReaderOptions = {},
): ReaderResult {
  const isTarball =
    /\.tar\.zst$/i.test(path) ||
    (existsSync(path) && statSync(path).isFile());

  if (!isTarball) {
    return readDirectory(path, opts);
  }

  // Tarball mode: extract to a per-call temp dir, read, clean up.
  let extractRoot: string | null = null;
  try {
    extractRoot = extractTarball(path);
    return readDirectory(extractRoot, opts);
  } finally {
    if (extractRoot) {
      rmSync(extractRoot, { recursive: true, force: true });
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// Directory read
// ────────────────────────────────────────────────────────────────────

function readDirectory(dir: string, opts: ReaderOptions): ReaderResult {
  const warnings: string[] = [];

  // ── manifest ──
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

  // ── records.jsonl ──
  const recordsPath = join(dir, 'records.jsonl');
  if (!existsSync(recordsPath)) {
    throw new Error(`MemoryPack: records.jsonl not found in ${dir}`);
  }
  const recordLines = readFileSync(recordsPath, 'utf-8').split('\n').filter((l) => l.length > 0);
  const records: MemoryPackRecord[] = [];
  const lineByHash = new Map<string, string>();
  for (const line of recordLines) {
    const rec = JSON.parse(line) as MemoryPackRecord;
    records.push(rec);
    lineByHash.set(hashRecordLine(line), line);
  }
  if (records.length !== manifest.record_count) {
    warnings.push(
      `record_count mismatch: manifest ${manifest.record_count} vs jsonl ${records.length}`,
    );
  }

  // ── signatures ── (verified BEFORE decryption — sigs cover ciphertext bytes)
  const verifiedRecords = new Set<string>();
  const sigsPath = join(dir, 'signatures.jsonl');
  const signaturesPresent = existsSync(sigsPath);
  if (signaturesPresent) {
    const sigLines = readFileSync(sigsPath, 'utf-8').split('\n').filter((l) => l.length > 0);
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
  if (!signaturesPresent) {
    for (const hash of lineByHash.keys()) unsignedRecords.add(hash);
  }
  if (opts.strictSignatures && unsignedRecords.size > 0) {
    throw new Error(
      `MemoryPack: strictSignatures=true but ${unsignedRecords.size} records are unsigned`,
    );
  }

  // ── anchors.jsonl ──
  const anchors: MemoryPackAnchor[] = [];
  const anchorsPath = join(dir, 'anchors.jsonl');
  if (existsSync(anchorsPath)) {
    const anchorLines = readFileSync(anchorsPath, 'utf-8').split('\n').filter((l) => l.length > 0);
    for (const line of anchorLines) {
      anchors.push(JSON.parse(line) as MemoryPackAnchor);
    }
  }

  // ── blobs ──
  const verifiedBlobs = new Set<string>();
  const blobsDir = join(dir, 'blobs', 'sha256');
  const blobIndexPath = join(dir, 'blobs', 'index.jsonl');
  const blobIndexEntries = new Map<string, MemoryPackBlobIndex>();
  if (existsSync(blobIndexPath)) {
    const indexLines = readFileSync(blobIndexPath, 'utf-8').split('\n').filter((l) => l.length > 0);
    for (const line of indexLines) {
      const entry = JSON.parse(line) as MemoryPackBlobIndex;
      blobIndexEntries.set(entry.hash, entry);
      const hex = entry.hash.replace(/^sha256:/, '');
      const blobPath = join(blobsDir, hex);
      if (!existsSync(blobPath)) {
        warnings.push(`declared blob ${entry.hash} missing from blobs/`);
        continue;
      }
      const data = readFileSync(blobPath);
      const computed = hashBuffer(data);
      if (computed !== entry.hash) {
        throw new Error(
          `MemoryPack: blob hash mismatch — declared ${entry.hash}, computed ${computed}`,
        );
      }
      const actualSize = statSync(blobPath).size;
      if (entry.byte_size !== actualSize) {
        warnings.push(
          `blob ${entry.hash} byte_size mismatch: declared ${entry.byte_size}, actual ${actualSize}`,
        );
      }
      verifiedBlobs.add(entry.hash);
    }
  }

  // Cross-check: every blob_ref in records resolves. Runs whether or
  // not the index file exists — a record claiming a blob the pack
  // doesn't physically contain is always a warning.
  for (const r of records) {
    if (r.blob_ref && !verifiedBlobs.has(r.blob_ref)) {
      // Distinguish between "index missing" and "index present but ref unknown"
      // for diagnostics, even though the warning shape is the same.
      const reason = blobIndexEntries.size === 0
        ? 'no blobs/index.jsonl in pack'
        : 'not present or not verified';
      warnings.push(
        `record ${r.id} references blob ${r.blob_ref} (${reason})`,
      );
    }
  }

  // ── decryption pass ──
  if (manifest.encryption) {
    if (!opts.decryptionKey) {
      warnings.push(
        `manifest declares encryption (${manifest.encryption.algorithm}, scope=${manifest.encryption.scope}) but no decryptionKey supplied — content remains ciphertext`,
      );
    } else if (opts.decryptionKey.length !== ENCRYPTION_KEY_BYTES) {
      throw new Error(
        `MemoryPack: decryptionKey must be ${ENCRYPTION_KEY_BYTES} bytes (got ${opts.decryptionKey.length})`,
      );
    } else {
      // Decrypt records.
      for (const r of records) {
        if (!r.encrypted) continue;
        if (!r.nonce) {
          warnings.push(`record ${r.id} marked encrypted but has no nonce — leaving ciphertext`);
          continue;
        }
        try {
          r.content = decryptString(r.content, r.nonce, opts.decryptionKey);
          r.encrypted = false;
          // Strip the nonce from the in-memory shape — a decrypted record
          // shouldn't carry a stale nonce that consumers might re-encrypt with.
          delete (r as Partial<MemoryPackRecord>).nonce;
        } catch (e) {
          warnings.push(
            `record ${r.id} decryption failed: ${(e as Error).message}`,
          );
        }
      }
      // Note on blob decryption: blobs are returned via verifiedBlobs (set
      // of hashes). Callers who need decrypted blob bytes should call
      // decryptBuffer(blob.data, entry.nonce, key) themselves — keeping
      // the reader's working set memory-safe for large attachments.
    }
  }

  // ── minimal projection ──
  // Spec contract: readers MUST handle this shape. Skip records that are
  // still ciphertext (encrypted=true) so a downstream consumer that
  // ignores `result.warnings` doesn't accidentally surface base64 as
  // plaintext content.
  const minimalRecords: MemoryPackMinimalRecord[] = records
    .filter((r) => !r.encrypted)
    .map((r) => ({
      id: r.id,
      created_at: r.created_at,
      kind: r.kind,
      content: r.content,
      tags: r.tags,
      importance: r.importance,
      source: r.source,
      encrypted: r.encrypted,
    }));

  return {
    manifest,
    records,
    verifiedRecords,
    unsignedRecords,
    anchors,
    verifiedBlobs,
    verifiedAnchors: new Set<string>(),
    minimalRecords,
    warnings,
  };
}

// ────────────────────────────────────────────────────────────────────
// Tarball extraction with path-traversal hardening
// ────────────────────────────────────────────────────────────────────

const SAFE_MEMBER_RE = /^[A-Za-z0-9._/-]+$/;

/**
 * Extract a `.tar.zst` archive into a fresh temp directory. Returns the
 * path to the directory inside the temp dir that contains
 * `manifest.json` (which may be the tmp dir itself if the producer
 * tarred at the manifest root, or a single wrapping subdir).
 *
 * Hardening:
 *  - `spawnSync` with argv array — no shell, no quoting hazards (Windows-safe).
 *  - Pre-list members with `tar -tf` and reject any that contain
 *    absolute paths, `..` segments, symlinks/hardlinks, or characters
 *    outside `[A-Za-z0-9._/-]`.
 *  - `--no-same-owner --no-same-permissions` so a malicious archive
 *    can't restore attacker-controlled ownership / setuid bits.
 */
function extractTarball(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`MemoryPack: tarball not found: ${path}`);
  }

  // 1. List members and verify each is safe before extracting.
  const list = spawnSync('tar', ['--zstd', '-tvf', path], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (list.error) {
    throw new Error(
      `MemoryPack: failed to invoke 'tar' (${(list.error as Error).message}). Install a recent tar with zstd support.`,
    );
  }
  if (list.status !== 0) {
    const stderr = list.stderr ? list.stderr.toString() : '';
    throw new Error(
      `MemoryPack: tar --zstd -tvf failed (exit ${list.status}): ${stderr.trim() || 'no stderr'}`,
    );
  }

  const lines = list.stdout.toString().split('\n').filter((l) => l.length > 0);
  for (const line of lines) {
    // tar -tvf format: `drwxr-xr-x  user/group   size  date time  name`
    // The first character indicates the type: '-' file, 'd' dir, 'l' symlink, 'h' hardlink, etc.
    const typeChar = line.charAt(0);
    if (typeChar === 'l' || typeChar === 'h') {
      throw new Error(
        `MemoryPack: tarball contains symlink/hardlink — refusing to extract (${line.slice(0, 80)})`,
      );
    }
    // Member name is the last whitespace-separated field on the line.
    const name = line.split(/\s+/).pop() ?? '';
    if (!name) continue;
    if (name.startsWith('/')) {
      throw new Error(`MemoryPack: tarball contains absolute path — refusing (${name})`);
    }
    if (name.split('/').some((seg) => seg === '..')) {
      throw new Error(`MemoryPack: tarball contains '..' segment — refusing (${name})`);
    }
    if (!SAFE_MEMBER_RE.test(name.replace(/\/$/, ''))) {
      throw new Error(`MemoryPack: tarball member has unsafe characters — refusing (${name})`);
    }
  }

  // 2. Extract into a fresh temp dir.
  const tmp = mkdtempSync(join(tmpdir(), 'mp-extract-'));
  const extract = spawnSync(
    'tar',
    [
      '--zstd',
      '--no-same-owner',
      '--no-same-permissions',
      '-xf',
      path,
      '-C',
      tmp,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  if (extract.status !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    const stderr = extract.stderr ? extract.stderr.toString() : '';
    throw new Error(
      `MemoryPack: tar --zstd -xf failed (exit ${extract.status}): ${stderr.trim() || 'no stderr'}`,
    );
  }

  // 3. Resolve the manifest location: either at root, or inside a
  //    single wrapping directory (which is what the writer produces).
  if (existsSync(join(tmp, 'manifest.json'))) {
    return tmp;
  }
  const fs = require('fs') as typeof import('fs');
  const entries = fs.readdirSync(tmp);
  if (entries.length === 1) {
    const inner = join(tmp, entries[0]);
    if (statSync(inner).isDirectory() && existsSync(join(inner, 'manifest.json'))) {
      return inner;
    }
  }
  rmSync(tmp, { recursive: true, force: true });
  throw new Error(
    `MemoryPack: tarball must contain manifest.json at the root or inside a single wrapping directory`,
  );
}
