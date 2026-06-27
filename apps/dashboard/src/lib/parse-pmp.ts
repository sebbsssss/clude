/**
 * parse-pmp — browser-side extraction of `{ manifest, records }` from `.pmp` bytes, so the owner
 * can decrypt locally (decrypt-pmp.ts) with NOTHING sent to the server.
 *
 * A `.pmp` is a MemoryPack pack: a USTAR tar whose members include `<dir>/manifest.json` (pretty
 * JSON) and `<dir>/records.jsonl` (one JSON record per line). The server's `format: 'tarball'`
 * additionally zstd-COMPRESSES that tar (`.tar.zst`) by shelling out to the system `tar --zstd`.
 *
 * ── KNOWN LIMITATION (honest, not faked) ─────────────────────────────────────────────────────
 * There is no zstd decompressor in the browser bundle (no WASM zstd dep; jszip handles zip/deflate,
 * not zstd). So this parser handles a PLAIN USTAR tar in full, but when the bytes are zstd-framed it
 * throws `PmpZstdUnsupportedError` rather than returning anything — the caller surfaces a clear
 * message and offers the hosted verify / desktop path. It NEVER fabricates plaintext.
 *
 * Pure parsing only — no crypto here (decryptPmp does that), no network, no logging of contents.
 */
import type { PmpManifestForDecrypt, EncryptedRecord } from './decrypt-pmp';

/** Thrown when the `.pmp` bytes are zstd-compressed, which the browser cannot decompress yet. */
export class PmpZstdUnsupportedError extends Error {
  constructor() {
    super('This .pmp is zstd-compressed; in-browser decompression is not supported yet.');
    this.name = 'PmpZstdUnsupportedError';
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
 * Walk a plain USTAR archive and return its file entries. Header name (offset 0, 100 bytes) +
 * size (offset 124, 12 bytes octal); each entry's data is `ceil(size/512)*512` bytes after its
 * 512-byte header. Two all-zero blocks (or end of buffer) terminate.
 */
function parseTar(bytes: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + TAR_BLOCK <= bytes.length) {
    const name = readString(bytes, offset, 100);
    if (name === '') break; // zero block → end of archive
    const size = readOctalSize(bytes, offset + 124, 12);
    const typeFlag = bytes[offset + 156]; // '0'/NUL = regular file
    const dataStart = offset + TAR_BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) {
      throw new PmpUnreadableError('truncated .pmp tar entry');
    }
    // Regular files only (type '0' 0x30 or NUL 0x00); skip dirs/links but still advance.
    if (typeFlag === 0x30 || typeFlag === 0x00 || typeFlag === undefined) {
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
 * Parse `.pmp` bytes (base64) into `{ manifest, records }` for a client-side decrypt. Throws
 * `PmpZstdUnsupportedError` for zstd-framed bytes (the server's default), or `PmpUnreadableError`
 * for anything that is neither a zstd frame nor a USTAR tar carrying manifest.json + records.jsonl.
 */
export function parsePmpBase64(pmpBase64: string): ParsedPmp {
  const bytes = base64ToBytes(pmpBase64);

  if (hasZstdMagic(bytes)) throw new PmpZstdUnsupportedError();
  if (!looksLikeUstar(bytes)) {
    throw new PmpUnreadableError('not a readable .pmp (neither a zstd frame nor a USTAR tar)');
  }

  const entries = parseTar(bytes);
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
