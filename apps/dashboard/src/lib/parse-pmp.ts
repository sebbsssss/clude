/**
 * parse-pmp — browser-side extraction of `{ manifest, records }` from `.pmp` bytes, so the owner
 * can decrypt locally (decrypt-pmp.ts) with NOTHING sent to the server.
 *
 * A `.pmp` is a MemoryPack pack: a USTAR tar whose members include `<dir>/manifest.json` (pretty
 * JSON) and `<dir>/records.jsonl` (one JSON record per line). The server's `format: 'tarball'`
 * additionally zstd-COMPRESSES that tar (`.tar.zst`) by shelling out to the system `tar --zstd`.
 *
 * ── zstd, in-browser ─────────────────────────────────────────────────────────────────────────
 * `fzstd` (a tiny, zero-dependency, pure-JS zstd DEcompressor) inflates the server's `.tar.zst` in
 * the browser. When the bytes are a zstd frame (magic `0x28 0xB5 0x2F 0xFD`) we `decompress` them
 * to the underlying USTAR `.tar`, then run the SAME tar walk used for an uncompressed `.pmp`. An
 * already-uncompressed USTAR `.pmp` skips the inflate. We do NOT import any Node-only module
 * (`tar-stream`, `node:zlib`); `fzstd` is pure JS and browser-safe.
 *
 * Pure parsing only — no crypto here (decryptPmp does that), no network, no logging of contents.
 */
import { decompress } from 'fzstd';
import type { PmpManifestForDecrypt, EncryptedRecord } from './decrypt-pmp';

/** Thrown when bytes are a zstd frame but inflation fails (corrupt/unsupported zstd stream). */
export class PmpZstdDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PmpZstdDecodeError';
  }
}

/** Thrown when the bytes are neither a zstd frame nor a readable USTAR tar with the needed members. */
export class PmpUnreadableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PmpUnreadableError';
  }
}

const TAR_BLOCK = 512;
const USTAR_MAGIC_OFFSET = 257; // "ustar" appears here in a POSIX tar header
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]; // little-endian 0xFD2FB528

/** Decode a standard base64 string to bytes via `atob` (no Buffer). */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function hasZstdMagic(bytes: Uint8Array): boolean {
  if (bytes.length < ZSTD_MAGIC.length) return false;
  for (let i = 0; i < ZSTD_MAGIC.length; i++) if (bytes[i] !== ZSTD_MAGIC[i]) return false;
  return true;
}

function looksLikeUstar(bytes: Uint8Array): boolean {
  if (bytes.length < USTAR_MAGIC_OFFSET + 5) return false;
  return (
    bytes[USTAR_MAGIC_OFFSET] === 0x75 && // u
    bytes[USTAR_MAGIC_OFFSET + 1] === 0x73 && // s
    bytes[USTAR_MAGIC_OFFSET + 2] === 0x74 && // t
    bytes[USTAR_MAGIC_OFFSET + 3] === 0x61 && // a
    bytes[USTAR_MAGIC_OFFSET + 4] === 0x72 // r
  );
}

/** Read a NUL-terminated ASCII field from a tar header slice. */
function readString(bytes: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const limit = offset + length;
  while (end < limit && bytes[end] !== 0) end += 1;
  return new TextDecoder().decode(bytes.subarray(offset, end));
}

/** Parse a tar size field (octal ASCII, NUL/space terminated). */
function readOctalSize(bytes: Uint8Array, offset: number, length: number): number {
  const raw = readString(bytes, offset, length).trim();
  if (!raw) return 0;
  const n = parseInt(raw, 8);
  return Number.isFinite(n) ? n : 0;
}

interface TarEntry {
  name: string;
  data: Uint8Array;
}

/**
 * True for tar members that are not real pack files but archiver sidecars: pax extended-header
 * blocks (`<dir>/PaxHeader/...`) and macOS BSD-tar AppleDouble resource forks (`._<name>`). Both
 * can carry a basename that collides with `manifest.json` / `records.jsonl`, so they MUST be
 * excluded before basename matching. (GNU tar on the server emits neither; BSD tar — e.g. macOS in
 * tests — emits both.)
 */
function isSidecarName(name: string): boolean {
  const segments = name.split('/');
  const base = segments[segments.length - 1] ?? '';
  if (base.startsWith('._')) return true; // AppleDouble resource fork
  return segments.some((seg) => seg === 'PaxHeader'); // pax extended header dir
}

/**
 * Walk a plain USTAR archive and return its real file entries. Header name (offset 0, 100 bytes) +
 * size (offset 124, 12 bytes octal); each entry's data is `ceil(size/512)*512` bytes after its
 * 512-byte header. Two all-zero blocks (or end of buffer) terminate. Skips directories/links (by
 * typeflag) and archiver sidecars (pax headers, AppleDouble) so they can't shadow the pack files.
 */
function parseTar(bytes: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + TAR_BLOCK <= bytes.length) {
    const name = readString(bytes, offset, 100);
    if (name === '') break; // zero block → end of archive
    const size = readOctalSize(bytes, offset + 124, 12);
    const typeFlag = bytes[offset + 156]; // '0'/NUL = regular file; 'x'/'g' = pax header; '5' = dir
    const dataStart = offset + TAR_BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) {
      throw new PmpUnreadableError('truncated .pmp tar entry');
    }
    // Regular files only (type '0' 0x30 or NUL 0x00); skip dirs/links/pax headers, and drop
    // archiver sidecars by name — but always advance past the data.
    if ((typeFlag === 0x30 || typeFlag === 0x00 || typeFlag === undefined) && !isSidecarName(name)) {
      entries.push({ name, data: bytes.subarray(dataStart, dataEnd) });
    }
    const padded = Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
    offset = dataStart + padded;
  }
  return entries;
}

/** Match a tar entry by basename, ignoring the inner-dir prefix the writer adds. */
function findByBasename(entries: TarEntry[], basename: string): TarEntry | undefined {
  return entries.find((e) => {
    const parts = e.name.split('/');
    return parts[parts.length - 1] === basename;
  });
}

export interface ParsedPmp {
  manifest: PmpManifestForDecrypt;
  records: EncryptedRecord[];
}

/**
 * Parse `.pmp` bytes (base64) into `{ manifest, records }` for a client-side decrypt.
 *
 * Accepts BOTH the server's default `.tar.zst` (zstd-framed; inflated here via `fzstd`) and an
 * already-uncompressed USTAR `.pmp`. Throws `PmpZstdDecodeError` if a zstd frame fails to inflate,
 * or `PmpUnreadableError` for anything that — after any inflate — is not a USTAR tar carrying
 * manifest.json + records.jsonl. NEVER fabricates plaintext.
 */
export function parsePmpBase64(pmpBase64: string): ParsedPmp {
  const raw = base64ToBytes(pmpBase64);

  // zstd-framed (.tar.zst, the server default) → inflate to the underlying USTAR tar; otherwise the
  // bytes are already a plain tar.
  let tarBytes: Uint8Array;
  if (hasZstdMagic(raw)) {
    try {
      tarBytes = decompress(raw);
    } catch (err) {
      throw new PmpZstdDecodeError(
        `failed to zstd-decompress .pmp: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    tarBytes = raw;
  }

  if (!looksLikeUstar(tarBytes)) {
    throw new PmpUnreadableError('not a readable .pmp (no USTAR tar after any zstd inflate)');
  }

  const entries = parseTar(tarBytes);
  const manifestEntry = findByBasename(entries, 'manifest.json');
  const recordsEntry = findByBasename(entries, 'records.jsonl');
  if (!manifestEntry) throw new PmpUnreadableError('.pmp is missing manifest.json');
  if (!recordsEntry) throw new PmpUnreadableError('.pmp is missing records.jsonl');

  let manifest: PmpManifestForDecrypt;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data)) as PmpManifestForDecrypt;
  } catch {
    throw new PmpUnreadableError('.pmp manifest.json is not valid JSON');
  }

  const records: EncryptedRecord[] = [];
  const text = new TextDecoder().decode(recordsEntry.data);
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as EncryptedRecord);
    } catch {
      throw new PmpUnreadableError('.pmp records.jsonl contains a malformed line');
    }
  }

  return { manifest, records };
}
