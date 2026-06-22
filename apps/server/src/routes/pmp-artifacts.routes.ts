/**
 * PMP ARTIFACTS endpoints — the SERVER side of the desktop `.pmp` integration.
 *
 * Tradeable Memory Packs — Part C, Task 2 (spec §2 PMP ARTIFACTS · §3C · §4 .pmp format).
 *
 *   POST /v1/pmp/export         Build a .pmp from an owned pack, register a pmp_artifacts row
 *   GET  /v1/pmp/artifacts       Owner-scoped artifact list
 *   GET  /v1/pmp/artifacts/:id   Owner-scoped artifact metadata
 *   POST /v1/pmp/verify          Hosted twin of `npx @clude/memorypack verify` — NO auth
 *   POST /v1/pmp/import          Hash-verify + dedupe-by-content_hash + ingest as owner memories
 *
 * What a `.pmp` IS (spec §4.1): a MemoryPack `.tar.zst` (packages/memorypack) carrying a
 * pack-level Merkle root + per-record canonical leaf hashes (packages/tokenization,
 * content-hash `memory-hash-v1`). This module REUSES that format end-to-end — it does NOT
 * reinvent a writer/reader/hash. `manifest_hash` = sha256 over the canonical manifest with
 * `pmp.manifest_sig` removed (the artifact's identity); the server re-derives it on register
 * and on verify so a download can be validated without trusting the uploader.
 *
 * AUTH (the fixed Part A/B pattern): owner routes use requirePrivyAuth + requireOwnership and
 * read the wallet ONLY from req.verifiedWallet (ownerFromReq) — a client-supplied ?owner= is
 * NEVER trusted (that was the impersonation hole closed in cc4f2871). /verify is public.
 *
 * Owner-scoping: every pmp_artifacts / pmp_imports / memories query filters by the caller
 * wallet. §00 MINOR 14: pmp_artifacts.manifest_hash UNIQUE is scoped to (owner_wallet,
 * manifest_hash) at the DB layer (migration 033) — two users exporting the same public pack
 * legitimately share a manifest_hash and must not collide.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  MEMORYPACK_VERSION,
  writeMemoryPack,
  readMemoryPack,
  type MemoryPackManifest,
  type MemoryPackRecord,
} from '@clude/memorypack';
import { memoryContentHash, buildPackTree, type MemoryType } from '@clude/tokenization';
import { getDb } from '@clude/shared/core/database';
import { requirePrivyAuth, optionalPrivyAuth } from '@clude/brain/auth/privy-auth';
import { requireOwnership } from '@clude/brain/auth/require-ownership';
import { createChildLogger } from '@clude/shared/core/logger';
import { getMinterEvmTitleClient } from '../lib/payments/evm-title-config.js';
import { getBaseIdentityResolver } from '../lib/payments/base-identity.js';
import { mintTitleOnExport } from '../lib/payments/mint-title-on-export.js';

const log = createChildLogger('pmp-artifacts-routes');

const PMP_FORMAT_VERSION = '0.8';
const LEAF_HASH_ALGORITHM = 'memory-hash-v1';
const MERKLE_ALGORITHM = 'sha256-merkle-v1';
const RECORD_SCHEMA = 'clude-memory-v1';
const MAX_RECORDS = 10_000;
/** Supabase REST caps a SELECT at 1000 rows; the selection path pages with .range() at this size. */
const SELECTION_PAGE_SIZE = 1000;
const MEMORY_TYPE_VALUES = [
  'episodic',
  'semantic',
  'procedural',
  'self_model',
  'introspective',
] as const;
const VALID_MEMORY_TYPES = new Set<MemoryType>(MEMORY_TYPE_VALUES);
const CONTENT_CATEGORY_VALUES = ['personal', 'knowledge', 'agent'] as const;

// ─────────── Selection contract (mirrors @clude/ui ExportSelection — keep in lockstep) ───────────
// The panel sends EITHER a pack_id (the existing pack path) OR a `selection` describing which of
// the caller's OWN memories to gather. `scope` drives which extra filter is applied on top of the
// mandatory owner-scope (.eq('owner_wallet', owner)); a selection must NEVER pull another tenant's
// rows, so the owner filter is unconditional and the scope filters only ever NARROW the set.

const memoryTypeSchema = z.enum(MEMORY_TYPE_VALUES);

const exportSelectionSchema = z
  .object({
    scope: z.enum(['all', 'type', 'tag', 'range', 'pack']),
    types: z.array(memoryTypeSchema).optional(),
    tags: z.array(z.string()).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    pack_id: z.string().optional(),
  })
  .strict();

type ExportSelection = z.infer<typeof exportSelectionSchema>;

const contentCategorySchema = z.enum(CONTENT_CATEGORY_VALUES);

/** POST /v1/pmp/export body — pack path (pack_id) XOR selection path (selection + name + category). */
const exportBodySchema = z
  .object({
    pack_id: z.string().optional(),
    selection: exportSelectionSchema.optional(),
    name: z.string().optional(),
    description: z.string().nullish(),
    category: contentCategorySchema.optional(),
    encrypt: z.boolean().optional(),
  })
  .strict();

/** POST /v1/pmp/export/preview body. */
const previewBodySchema = z
  .object({ selection: exportSelectionSchema })
  .strict();

/** The memory columns the export mapper + leaf hash need. One source of truth for both paths. */
interface MemoryRow {
  id: number;
  hash_id: string;
  memory_type: string;
  content: string;
  summary: string | null;
  owner_wallet: string | null;
  created_at: string;
  tags: string[] | null;
  source: string | null;
  related_user: string | null;
  related_wallet: string | null;
  content_hash: string | null;
  importance: number | null;
}

const MEMORY_SELECT_COLUMNS =
  'id, hash_id, memory_type, content, summary, owner_wallet, created_at, tags, source, related_user, related_wallet, content_hash, importance';

interface ErrorBody {
  error: string;
  reason?: string;
  hint?: string;
}

/**
 * The wallet the caller has been VERIFIED to own — never a client-supplied value.
 * requireOwnership precedes every owner route and sets req.verifiedWallet; mirrors
 * pack-marketplace.routes.ts:79.
 */
function ownerFromReq(req: Request): string | null {
  return req.verifiedWallet ?? null;
}

function generateArtifactId(): string {
  return `pmpa-${randomBytes(4).toString('hex')}`;
}

function generateImportId(): string {
  return `pmpi-${randomBytes(4).toString('hex')}`;
}

/**
 * FOUNDER MODEL (2026-06-23): a title-licensed pack becomes an ON-CHAIN ASSET at EXPORT — the moment
 * the `.pmp` is produced, not when it is later listed for sale. Mint the Base title here.
 *
 * BEST-EFFORT + IDEMPOTENT. The `.pmp` has already shipped in the export response, so this NEVER fails
 * the export: a missing Base env (CLUDE_PACK_TITLE_ADDRESS / BASE_MINTER_KEY / BASE_CUSTODIAL_SEED — so
 * non-Base deployments simply skip), the SEC-1 mainnet gate, or a transient chain error is LOGGED and
 * swallowed. mintTitleOnExport is itself idempotent (deterministic snapshot, no-op mint once the title
 * exists), so a later re-export — or a reconciliation retry — completes a miss without double-minting.
 */
async function mintTitleAtExportBestEffort(
  db: ReturnType<typeof getDb>,
  sourcePackId: string,
  creatorAppWallet: string,
): Promise<void> {
  try {
    const evm = getMinterEvmTitleClient();
    const resolver = getBaseIdentityResolver();
    const r = await mintTitleOnExport(db, evm, resolver, { sourcePackId, creatorAppWallet });
    log.info(
      { sourcePackId, snapshotPackId: r.snapshotPackId, tokenId: r.tokenId, alreadyMinted: r.alreadyMinted },
      'export: Base title minted at export',
    );
  } catch (err) {
    log.warn(
      { err: (err as Error).message, sourcePackId },
      'export: Base title mint skipped (Base env missing or chain error) — .pmp already delivered',
    );
  }
}

// ─────────── Canonicalisation (matches content-hash.ts `stableStringify`) ───────────
// Alphabetical object keys, JSON scalar encoding. The `.pmp` manifest_hash is sha256 over
// the canonical manifest JSON with `pmp.manifest_sig` removed (spec §4.1), so the server
// re-derives the same hash the desktop signer bound under `manifest_sig`.

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    const pairs = keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]));
    return '{' + pairs.join(',') + '}';
  }
  throw new Error(`stableStringify: unsupported value of type ${typeof value}`);
}

/**
 * Compute the artifact's `manifest_hash`: sha256 over the canonical manifest JSON with the
 * `pmp.manifest_sig` stripped. Deterministic for identical pack content (§4.1: "binds title,
 * license, count, Merkle root under one signature").
 */
function computeManifestHash(manifest: MemoryPackManifest): string {
  // Deep-clone + strip the signature so the hash is over everything-but-the-sig.
  const clone = JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>;
  const pmp = clone.pmp as Record<string, unknown> | undefined;
  if (pmp && 'manifest_sig' in pmp) delete pmp.manifest_sig;
  return createHash('sha256').update(stableStringify(clone), 'utf8').digest('hex');
}

// ─────────── Leaf hashing — REUSE memoryContentHash (memory-hash-v1) ───────────
// The leaf hash is computed over the SAME canonical fields content-hash.ts uses, so an
// imported record's recomputed leaf matches the leaf a `tokenizePack` would have committed.
// A `.pmp` record's `kind`/`source`/`tags`/`created_at`/`content` map onto those fields.

interface LeafInput {
  content: string;
  memory_type: MemoryType;
  owner_wallet: string | null;
  created_at: string;
  tags: string[];
  source: string | null;
  related_user: string | null;
  related_wallet: string | null;
}

function leafHashFor(input: LeafInput): string {
  return memoryContentHash(input);
}

function recordMemoryType(kind: string): MemoryType {
  return VALID_MEMORY_TYPES.has(kind as MemoryType) ? (kind as MemoryType) : 'semantic';
}

// ─────────── Memory → { record, leaf } — the ONE mapping both export paths share ───────────
// Both the pack path (members of memory_pack_contents) and the selection path (owner memories
// matching a filter) hand their hydrated `memories` rows through THIS function, so a record built
// either way hashes byte-identically (same leaf input → same leaf, same MemoryPackRecord shape →
// same writeMemoryPack output → same Merkle root → same manifest_hash). If the two paths diverged,
// the same memory could produce two different artifacts.

interface MappedMemory {
  record: MemoryPackRecord;
  leaf: string;
}

function mapMemoryToRecord(m: MemoryRow): MappedMemory {
  const leafInput: LeafInput = {
    content: m.content,
    memory_type: recordMemoryType(m.memory_type),
    owner_wallet: m.owner_wallet,
    created_at: m.created_at,
    tags: Array.isArray(m.tags) ? m.tags : [],
    source: m.source,
    related_user: m.related_user,
    related_wallet: m.related_wallet,
  };
  const leaf = leafHashFor(leafInput);
  const record: MemoryPackRecord = {
    id: m.hash_id,
    created_at: m.created_at,
    kind: m.memory_type,
    content: m.content,
    tags: Array.isArray(m.tags) ? m.tags : [],
    importance: typeof m.importance === 'number' ? m.importance : 0.5,
    source: typeof m.source === 'string' ? m.source : 'pack',
    metadata: {
      leaf_hash: leaf,
      owner_wallet: m.owner_wallet,
      related_user: m.related_user,
      related_wallet: m.related_wallet,
    },
  };
  return { record, leaf };
}

// ─────────── Selection → owner-scoped `memories` query ───────────
// `applySelectionFilter` is the SINGLE place the scope→filter mapping lives, reused by the export
// gather (which paginates + hydrates) and the preview counts (head-only, no hydration). The owner
// .eq() is applied by the CALLER unconditionally; this only layers the scope-specific narrowing,
// so it can never widen past the owner. `q` is the loosely-typed Supabase query builder.

function applySelectionFilter<Q extends {
  in(col: string, vals: readonly unknown[]): Q;
  overlaps(col: string, vals: readonly unknown[]): Q;
  gte(col: string, val: unknown): Q;
  lte(col: string, val: unknown): Q;
}>(q: Q, selection: ExportSelection): Q {
  let out = q;
  if (selection.scope === 'type') {
    out = out.in('memory_type', selection.types ?? []);
  } else if (selection.scope === 'tag') {
    out = out.overlaps('tags', selection.tags ?? []);
  } else if (selection.scope === 'range') {
    if (selection.from) out = out.gte('created_at', selection.from);
    if (selection.to) out = out.lte('created_at', selection.to);
  }
  // scope 'all' adds nothing beyond the caller's owner scope; 'pack' is never routed here.
  return out;
}

/**
 * Gather ALL owner memories matching a selection, oldest-first, paging past Supabase's 1000-row
 * REST cap. Owner-scoping is enforced here (`.eq('owner_wallet', owner)`) so a selection can never
 * read another tenant's rows. Returns the rows in created_at ASC order across every page.
 */
async function gatherSelectionMemories(
  db: ReturnType<typeof getDb>,
  owner: string,
  selection: ExportSelection,
): Promise<MemoryRow[]> {
  const out: MemoryRow[] = [];
  let offset = 0;
  // Page until a short page (fewer than the page size) signals the last batch.
  for (;;) {
    const base = db
      .from('memories')
      .select(MEMORY_SELECT_COLUMNS)
      .eq('owner_wallet', owner);
    const filtered = applySelectionFilter(base, selection)
      .order('created_at', { ascending: true })
      .range(offset, offset + SELECTION_PAGE_SIZE - 1);
    const { data, error } = await filtered;
    if (error) throw error;
    const rows = (data ?? []) as MemoryRow[];
    out.push(...rows);
    if (rows.length < SELECTION_PAGE_SIZE) break;
    offset += SELECTION_PAGE_SIZE;
  }
  return out;
}

/**
 * The leaf hash a record DECLARES, if any. Prefers the spec's top-level `leaf_hash` record
 * field (§4: "MemoryPackRecord + leaf_hash per line"); falls back to `metadata.leaf_hash`
 * (the location our own server exporter writes). Returns null when none is declared.
 */
function declaredLeafHash(rec: MemoryPackRecord): string | null {
  const top = (rec as unknown as { leaf_hash?: unknown }).leaf_hash;
  if (typeof top === 'string' && top.length > 0) return top;
  const meta = (rec.metadata as Record<string, unknown> | undefined)?.leaf_hash;
  if (typeof meta === 'string' && meta.length > 0) return meta;
  return null;
}

/** Pull the structured fields a leaf hash needs out of a MemoryPack record + its metadata. */
function leafInputFromRecord(rec: MemoryPackRecord, ownerWallet: string | null): LeafInput {
  const meta = (rec.metadata ?? {}) as Record<string, unknown>;
  return {
    content: rec.content,
    memory_type: recordMemoryType(rec.kind),
    // The committed leaf is bound to the AUTHOR's wallet (the value that was hashed at
    // tokenize time). The `.pmp` carries it in metadata.owner_wallet; fall back to the
    // record's declared owner or null. Verify uses whatever the record carries.
    owner_wallet:
      typeof meta.owner_wallet === 'string' ? (meta.owner_wallet as string) : ownerWallet,
    created_at: rec.created_at,
    tags: Array.isArray(rec.tags) ? rec.tags : [],
    source: typeof rec.source === 'string' ? rec.source : null,
    related_user: typeof meta.related_user === 'string' ? (meta.related_user as string) : null,
    related_wallet:
      typeof meta.related_wallet === 'string' ? (meta.related_wallet as string) : null,
  };
}

// ─────────── .pmp payload extraction (verify / import) ───────────
// Accept the tarball as base64 in the JSON body. Stage it to a temp file so the REUSED
// readMemoryPack (which reads from a path) can parse it; always clean up the temp dir.

function extractPmpBase64(req: Request): string | null {
  const body = req.body ?? {};
  const b64 = body.pmp_base64 ?? body.pmp ?? body.artifact_base64;
  return typeof b64 === 'string' && b64.length > 0 ? b64 : null;
}

function withStagedPmp<T>(b64: string, fn: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'pmp-in-'));
  const file = join(dir, 'artifact.tar.zst');
  try {
    writeFileSync(file, Buffer.from(b64, 'base64'));
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface PmpManifestPmpBlock {
  pmp_version?: string;
  artifact_id?: string;
  title?: string;
  license_type?: 'copy' | 'title';
  merkle_root?: string;
  creator_pubkey?: string;
  manifest_sig?: string;
}

function pmpBlock(manifest: MemoryPackManifest): PmpManifestPmpBlock {
  return ((manifest as unknown as { pmp?: PmpManifestPmpBlock }).pmp ?? {}) as PmpManifestPmpBlock;
}

// ─────────── Shared write + register + respond tail ───────────
// The pack path and the selection path build identical { records, leaves } and per-artifact
// parameters, then hand them HERE. Everything below (Merkle root → pmp identity → writeMemoryPack →
// manifest_hash → register, with the UNIQUE(owner_wallet, manifest_hash) dedup branch) is the SAME
// for both, so the two flows can never drift on how an artifact is built or persisted. Always sends
// a response; returns { handled: true } so the caller knows the response was written.

interface WriteRegisterArgs {
  res: Response;
  db: ReturnType<typeof getDb>;
  owner: string;
  artifactId: string;
  records: MemoryPackRecord[];
  leaves: string[];
  title: string;
  description: string | null;
  licenseType: 'copy' | 'title';
  contentSource: 'personal' | 'knowledge' | 'agent' | null;
  /** pmp_artifacts.pack_id — the saved pack for the pack path, null for a selection. */
  packIdColumn: string | null;
  anchorChain: 'solana' | null;
  /** Base name for the staged `.pmp` file (pack id, or artifact id for a selection). */
  pmpFilenameBase: string;
  logContext: Record<string, unknown>;
  /** Lazily create the staging dir so the route's finally{} can clean it up. */
  mkStagedDir: () => string;
}

async function writeRegisterRespond(args: WriteRegisterArgs): Promise<{ handled: boolean }> {
  const {
    res,
    db,
    owner,
    artifactId,
    records,
    leaves,
    title,
    description,
    licenseType,
    contentSource,
    packIdColumn,
    anchorChain,
    pmpFilenameBase,
    logContext,
    mkStagedDir,
  } = args;

  // 5. Compute the pack-level Merkle root (REUSE buildPackTree).
  const tree = buildPackTree(leaves);

  // 6. Build the artifact identity (`pmp` block) BEFORE writing so it is PERSISTED into the
  //    .pmp manifest — this makes the artifact SELF-VERIFIABLE: POST /v1/pmp/verify recomputes
  //    the pack Merkle root and compares it to pmp.merkle_root, no server trust. The block carries
  //    NO per-export id and the hash excludes the wall-clock created_at, so two exports of the same
  //    content yield the same merkle_root + manifest_hash (the dedup collision, §00 MINOR 14).
  const pmpIdentity: Record<string, unknown> = {
    pmp_version: PMP_FORMAT_VERSION,
    title,
    description,
    license_type: licenseType,
    content_source: contentSource,
    record_count: records.length,
    leaf_hash_algorithm: LEAF_HASH_ALGORITHM,
    merkle_algorithm: MERKLE_ALGORITHM,
    merkle_root: tree.root,
    creator_pubkey: owner,
  };

  // 7. Write the .pmp tarball via the REUSED writer, EMBEDDING the pmp block (so verify can read
  //    pmp.merkle_root back out of the file). Producer public_key is the owner (provenance).
  const stagedDir = mkStagedDir();
  const outFile = join(stagedDir, `${pmpFilenameBase}.pmp`);
  writeMemoryPack(outFile, records, {
    producer: { name: 'clude-server', version: MEMORYPACK_VERSION, public_key: owner },
    record_schema: RECORD_SCHEMA,
    format: 'tarball',
    anchor_chain: anchorChain ?? undefined,
    pmp: pmpIdentity,
  });

  // 8. Compute manifest_hash over the canonical manifest (sig removed) using the SAME pmp block
  //    that was written to disk, so the stored hash describes the actual artifact.
  const manifestForHash: MemoryPackManifest = {
    memorypack_version: MEMORYPACK_VERSION,
    producer: { name: 'clude-server', version: MEMORYPACK_VERSION, public_key: owner },
    created_at: '', // excluded from identity — stable across exports
    record_count: records.length,
    record_schema: RECORD_SCHEMA,
    pmp: pmpIdentity,
  };
  const manifestHash = computeManifestHash(manifestForHash);

  // Read the staged .pmp once: its size for the row, and its bytes (base64) for an INLINE download
  // so the client can save the file directly — no server-side blob storage, no dangling /download URL.
  let byteSize: number | null = null;
  let pmpBase64: string | null = null;
  try {
    const bytes = readFileSync(outFile);
    byteSize = bytes.byteLength;
    pmpBase64 = bytes.toString('base64');
  } catch {
    byteSize = null;
  }
  const pmpFilename = `${pmpFilenameBase}.pmp`;

  // 9. Register the artifact. UNIQUE(owner_wallet, manifest_hash) (§00 MINOR 14): a repeat export of
  //    the same content collides — treat the conflict as "already registered".
  const nowIso = new Date().toISOString();
  const artifactRow = {
    artifact_id: artifactId,
    pack_id: packIdColumn,
    owner_wallet: owner,
    pmp_version: PMP_FORMAT_VERSION,
    title,
    description,
    license_type: licenseType,
    record_count: records.length,
    merkle_root: tree.root,
    manifest_hash: manifestHash,
    creator_pubkey: owner,
    manifest_sig: '', // server export is unsigned-by-user; desktop signs the title path
    encryption_scope: 'none' as const,
    storage_url: null,
    byte_size: byteSize,
    source_kind: 'web' as const,
    signing_device_id: null,
    anchor_chain: anchorChain,
    anchor_tx_sig: null,
    created_at: nowIso,
  };

  const { error: insErr } = await db.from('pmp_artifacts').insert(artifactRow);
  if (insErr) {
    if ((insErr as { code?: string }).code === '23505') {
      // Already registered for this owner — return the existing artifact metadata.
      const { data: existing } = await db
        .from('pmp_artifacts')
        .select('*')
        .eq('owner_wallet', owner)
        .eq('manifest_hash', manifestHash)
        .limit(1)
        .maybeSingle();
      if (existing) {
        // Re-export of identical content: the artifact row already exists, but we still generated the
        // .pmp bytes this call, so return them inline so the client can download the same pack again.
        res.status(200).json({
          artifact: existing,
          deduped: true,
          pmp_base64: pmpBase64,
          filename: pmpFilename,
        });
        return { handled: true };
      }
    }
    log.warn({ err: insErr, ...logContext, artifactId }, 'export: artifact insert failed');
    res.status(500).json({ error: 'export_failed' } satisfies ErrorBody);
    return { handled: true };
  }

  // Return the artifact metadata + the .pmp bytes inline (base64) so the client downloads the file
  // directly. No storage_url / no /download handler: the bytes are served once here, on export.
  res.status(201).json({
    artifact: artifactRow,
    pmp_base64: pmpBase64,
    filename: pmpFilename,
  });
  return { handled: true };
}

// ─────────── Route module ───────────

export function pmpArtifactsRoutes(): Router {
  const router = Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  /**
   * POST /v1/pmp/export — build a `.pmp` and register it. TWO gather paths, ONE writer/register tail.
   *
   * Body: EITHER { pack_id } OR { selection, name, category, description? } (see @clude/ui
   *   ExportSelection / ExportRequest). pack_id and a non-pack selection are mutually exclusive.
   *
   *   pack_id path (unchanged):
   *     - Loads the owner's pack + its member memories (owner-scoped; 403 if not the author).
   *
   *   selection path (scope all|type|tag|range — `pack` scope is treated as the pack_id path):
   *     - Gathers the caller's OWN memories matching the filter (owner-scoped, paginated past the
   *       1000-row REST cap). `name` (pack title) + `category` (content_source) are REQUIRED.
   *
   *   Both paths then map each memory → { record, leaf } via the SAME mapMemoryToRecord (so an
   *   identical memory hashes byte-identically), buildPackTree → writeMemoryPack (embedding the pmp
   *   block) → register a pmp_artifacts row scoped to (owner_wallet, manifest_hash). A repeat of the
   *   same content collides on that unique key and returns the existing artifact (deduped).
   */
  router.post(
    '/v1/pmp/export',
    requirePrivyAuth,
    requireOwnership,
    async (req: Request, res: Response) => {
      const owner = ownerFromReq(req);
      if (!owner) {
        res.status(401).json({ error: 'unauthenticated' } satisfies ErrorBody);
        return;
      }

      const parsed = exportBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res
          .status(422)
          .json({ error: 'invalid_body', hint: parsed.error.issues[0]?.message ?? 'malformed body' } satisfies ErrorBody);
        return;
      }
      const body = parsed.data;

      // A selection with scope 'pack' is just the pack_id path; everything else is the new gather.
      const packIdFromBody = body.pack_id?.trim() || body.selection?.pack_id?.trim() || '';
      const useSelection =
        !!body.selection && body.selection.scope !== 'pack' && !packIdFromBody;

      if (!useSelection && !packIdFromBody) {
        res
          .status(422)
          .json({ error: 'invalid_body', hint: 'pack_id or a non-pack selection is required' } satisfies ErrorBody);
        return;
      }

      // Track packId for the catch logger (selection path leaves it null).
      const packId: string | null = useSelection ? null : packIdFromBody;

      let stagedDir: string | null = null;
      try {
        const db = getDb();

        // ── Per-path parameters the shared tail consumes ───────────────────────────────
        // The pack path reads these off the pack row; the selection path off the validated body.
        // Both feed the SAME write+register tail so the only thing that differs is the gather.
        let records: MemoryPackRecord[];
        let leaves: string[];
        let title: string;
        let description: string | null;
        let licenseType: 'copy' | 'title';
        let contentSource: 'personal' | 'knowledge' | 'agent' | null;
        let packIdColumn: string | null;
        let anchorChain: 'solana' | null;
        let pmpFilenameBase: string;

        if (useSelection) {
          // ── Selection path: gather the caller's OWN memories matching the filter ──
          const selection = body.selection!;
          const name = body.name?.trim() ?? '';
          if (!name) {
            res.status(422).json({ error: 'invalid_body', hint: 'name is required for a selection export' } satisfies ErrorBody);
            return;
          }
          if (!body.category) {
            res
              .status(422)
              .json({ error: 'invalid_body', hint: 'category (personal|knowledge|agent) is required for a selection export' } satisfies ErrorBody);
            return;
          }

          let memories: MemoryRow[];
          try {
            memories = await gatherSelectionMemories(db, owner, selection);
          } catch (gatherErr) {
            log.warn({ err: gatherErr, scope: selection.scope }, 'export: selection gather failed');
            res.status(500).json({ error: 'export_failed' } satisfies ErrorBody);
            return;
          }
          if (memories.length === 0) {
            res.status(409).json({ error: 'empty_selection', hint: 'no memories match this selection' } satisfies ErrorBody);
            return;
          }

          records = [];
          leaves = [];
          for (const m of memories) {
            const { record, leaf } = mapMemoryToRecord(m);
            records.push(record);
            leaves.push(leaf);
          }

          const artifactId = generateArtifactId();
          title = name;
          description = body.description ?? null;
          licenseType = 'copy'; // selection exports are the server `copy` path
          contentSource = body.category;
          packIdColumn = null; // not tied to a saved pack
          anchorChain = null; // selection packs are not anchored on chain
          pmpFilenameBase = artifactId;

          // The shared tail below registers with `artifactId`; build it once and reuse.
          const result = await writeRegisterRespond({
            res,
            db,
            owner,
            artifactId,
            records,
            leaves,
            title,
            description,
            licenseType,
            contentSource,
            packIdColumn,
            anchorChain,
            pmpFilenameBase,
            logContext: { scope: selection.scope },
            mkStagedDir: () => {
              stagedDir = mkdtempSync(join(tmpdir(), 'pmp-out-'));
              return stagedDir;
            },
          });
          if (!result.handled) {
            // writeRegisterRespond always responds; this is unreachable but keeps the type honest.
            res.status(500).json({ error: 'export_failed' } satisfies ErrorBody);
          }
          return;
        }

        // ── Pack path (unchanged behaviour) ──
        const effectivePackId = packId!;

        // 1. Load the pack. Ownership is enforced against author_wallet (never a client field).
        const { data: packData, error: packErr } = await db
          .from('memory_packs')
          .select(
            'pack_id, author_wallet, name, description, version, memory_count, merkle_root, pack_token_address, content_category, sale_mode',
          )
          .eq('pack_id', effectivePackId)
          .limit(1)
          .maybeSingle();
        if (packErr) {
          log.warn({ err: packErr, packId: effectivePackId }, 'export: pack lookup failed');
          res.status(500).json({ error: 'export_failed' } satisfies ErrorBody);
          return;
        }
        if (!packData) {
          res.status(404).json({ error: 'pack_not_found' } satisfies ErrorBody);
          return;
        }
        const pack = packData as {
          pack_id: string;
          author_wallet: string;
          name: string;
          description: string | null;
          version: string;
          memory_count: number;
          merkle_root: string | null;
          pack_token_address: string | null;
          content_category: 'personal' | 'knowledge' | 'agent' | null;
          sale_mode: 'copy' | 'title' | null;
        };
        if (pack.author_wallet !== owner) {
          res.status(403).json({ error: 'forbidden', hint: 'you do not own this pack' } satisfies ErrorBody);
          return;
        }

        // 2. Resolve member memories in tree order (pack-scoped).
        const { data: contentsRaw, error: contentsErr } = await db
          .from('memory_pack_contents')
          .select('memory_id, leaf_index, content_hash')
          .eq('pack_id', effectivePackId)
          .order('leaf_index', { ascending: true });
        if (contentsErr) {
          log.warn({ err: contentsErr, packId: effectivePackId }, 'export: contents lookup failed');
          res.status(500).json({ error: 'export_failed' } satisfies ErrorBody);
          return;
        }
        const contents = (contentsRaw ?? []) as Array<{
          memory_id: number;
          leaf_index: number;
          content_hash: string;
        }>;
        if (contents.length === 0) {
          res.status(409).json({ error: 'empty_pack', hint: 'pack has no member memories' } satisfies ErrorBody);
          return;
        }

        // 3. Hydrate the member memories, scoped to the pack AUTHOR (defence in depth — a
        //    tampered memory_pack_contents row cannot pull another tenant's memory into the file).
        const memberIds = contents.map((c) => c.memory_id);
        const { data: memsRaw, error: memsErr } = await db
          .from('memories')
          .select(MEMORY_SELECT_COLUMNS)
          .in('id', memberIds)
          .eq('owner_wallet', owner);
        if (memsErr) {
          log.warn({ err: memsErr, packId: effectivePackId }, 'export: member hydrate failed');
          res.status(500).json({ error: 'export_failed' } satisfies ErrorBody);
          return;
        }
        const memById = new Map<number, MemoryRow>();
        for (const m of (memsRaw ?? []) as MemoryRow[]) {
          if (m) memById.set(m.id, m);
        }

        // 4. Build records + leaf hashes in tree order via the SHARED mapper. Skip any id that
        //    failed the owner scope.
        records = [];
        leaves = [];
        for (const c of contents) {
          const m = memById.get(c.memory_id);
          if (!m) continue;
          const { record, leaf } = mapMemoryToRecord(m);
          records.push(record);
          leaves.push(leaf);
        }
        if (records.length === 0) {
          res.status(409).json({ error: 'empty_pack', reason: 'no_owned_members' } satisfies ErrorBody);
          return;
        }

        licenseType = pack.sale_mode === 'title' ? 'title' : 'copy';
        title = pack.name;
        description = pack.description;
        contentSource = pack.content_category;
        packIdColumn = effectivePackId;
        anchorChain = pack.pack_token_address ? 'solana' : null;
        pmpFilenameBase = effectivePackId;

        const result = await writeRegisterRespond({
          res,
          db,
          owner,
          artifactId: generateArtifactId(),
          records,
          leaves,
          title,
          description,
          licenseType,
          contentSource,
          packIdColumn,
          anchorChain,
          pmpFilenameBase,
          logContext: { packId: effectivePackId },
          mkStagedDir: () => {
            stagedDir = mkdtempSync(join(tmpdir(), 'pmp-out-'));
            return stagedDir;
          },
        });
        if (!result.handled) {
          res.status(500).json({ error: 'export_failed' } satisfies ErrorBody);
        } else if (licenseType === 'title') {
          // FOUNDER MODEL: a title pack exists on Base AT EXPORT. The .pmp already shipped in the
          // response above; mint the Base title best-effort + idempotent (never fails the export).
          await mintTitleAtExportBestEffort(db, effectivePackId, owner);
        }
      } catch (err) {
        log.error({ err, packId }, 'POST /v1/pmp/export failed');
        res.status(500).json({ error: 'export_failed' } satisfies ErrorBody);
      } finally {
        if (stagedDir) rmSync(stagedDir, { recursive: true, force: true });
      }
    },
  );

  /**
   * POST /v1/pmp/export/preview — cheap pre-flight for the panel. Returns the count of the caller's
   * OWN memories a selection would gather, broken down by memory_type — NO row hydration, just
   * head-only COUNT queries (count:exact, head:true) per type under the SAME owner-scoped filter the
   * real export uses. Owner-scoping is mandatory: a preview can never count another tenant's rows.
   *
   * Body: { selection } -> { total, by_type }
   */
  router.post(
    '/v1/pmp/export/preview',
    requirePrivyAuth,
    requireOwnership,
    async (req: Request, res: Response) => {
      const owner = ownerFromReq(req);
      if (!owner) {
        res.status(401).json({ error: 'unauthenticated' } satisfies ErrorBody);
        return;
      }

      const parsed = previewBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res
          .status(422)
          .json({ error: 'invalid_body', hint: parsed.error.issues[0]?.message ?? 'malformed body' } satisfies ErrorBody);
        return;
      }
      const { selection } = parsed.data;

      try {
        const db = getDb();

        // One head-only COUNT per memory_type, each under the owner scope + the selection filter.
        // When the selection itself constrains memory_type (scope 'type'), a type not in the list
        // simply counts 0 — the filter excludes it — so the per-type loop stays correct.
        const byType: Partial<Record<MemoryType, number>> = {};
        let total = 0;
        for (const memType of MEMORY_TYPE_VALUES) {
          const base = db
            .from('memories')
            .select('id', { count: 'exact', head: true })
            .eq('owner_wallet', owner)
            .eq('memory_type', memType);
          const { count, error } = await applySelectionFilter(base, selection);
          if (error) {
            log.warn({ err: error, scope: selection.scope, memType }, 'preview: count query failed');
            res.status(500).json({ error: 'preview_failed' } satisfies ErrorBody);
            return;
          }
          const n = typeof count === 'number' ? count : 0;
          if (n > 0) byType[memType] = n;
          total += n;
        }

        res.json({ total, by_type: byType });
      } catch (err) {
        log.error({ err }, 'POST /v1/pmp/export/preview failed');
        res.status(500).json({ error: 'preview_failed' } satisfies ErrorBody);
      }
    },
  );

  /** GET /v1/pmp/artifacts — the caller's own artifacts (auth required, owner-scoped). */
  router.get(
    '/v1/pmp/artifacts',
    requirePrivyAuth,
    requireOwnership,
    async (req: Request, res: Response) => {
      const owner = ownerFromReq(req);
      if (!owner) {
        res.status(401).json({ error: 'unauthenticated' } satisfies ErrorBody);
        return;
      }
      try {
        const db = getDb();
        const { data, error } = await db
          .from('pmp_artifacts')
          .select('*')
          .eq('owner_wallet', owner)
          .order('created_at', { ascending: false })
          .limit(200);
        if (error) {
          log.warn({ err: error, owner }, 'GET /v1/pmp/artifacts failed');
          res.status(500).json({ error: 'list_failed' } satisfies ErrorBody);
          return;
        }
        res.json({ artifacts: data ?? [] });
      } catch (err) {
        log.error({ err }, 'GET /v1/pmp/artifacts failed');
        res.status(500).json({ error: 'list_failed' } satisfies ErrorBody);
      }
    },
  );

  /**
   * GET /v1/pmp/artifacts/:id — owner-scoped metadata. A non-owner gets 404 (not 403) so the
   * endpoint does not leak the existence of another tenant's artifact.
   */
  router.get(
    '/v1/pmp/artifacts/:id',
    requirePrivyAuth,
    requireOwnership,
    async (req: Request, res: Response) => {
      const owner = ownerFromReq(req);
      if (!owner) {
        res.status(401).json({ error: 'unauthenticated' } satisfies ErrorBody);
        return;
      }
      const id = String(req.params.id ?? '');
      if (!id || id.length > 64) {
        res.status(422).json({ error: 'invalid_id' } satisfies ErrorBody);
        return;
      }
      try {
        const db = getDb();
        const { data, error } = await db
          .from('pmp_artifacts')
          .select('*')
          .eq('artifact_id', id)
          .eq('owner_wallet', owner) // owner-scoped: another wallet's artifact is invisible
          .limit(1)
          .maybeSingle();
        if (error) {
          log.warn({ err: error, id }, 'GET /v1/pmp/artifacts/:id failed');
          res.status(500).json({ error: 'retrieve_failed' } satisfies ErrorBody);
          return;
        }
        if (!data) {
          res.status(404).json({ error: 'artifact_not_found' } satisfies ErrorBody);
          return;
        }
        res.json({ artifact: data });
      } catch (err) {
        log.error({ err, id }, 'GET /v1/pmp/artifacts/:id failed');
        res.status(500).json({ error: 'retrieve_failed' } satisfies ErrorBody);
      }
    },
  );

  /**
   * POST /v1/pmp/verify — hosted twin of `npx @clude/memorypack verify`. NO auth.
   *
   * Body: { pmp_base64 } — the `.tar.zst` bytes, base64-encoded.
   *   1. readMemoryPack parses + structurally validates (signatures, blob bytes).
   *   2. Recompute every record's leaf hash (memory-hash-v1) and the pack-level Merkle root
   *      (buildPackTree).
   *   3. Compare the recomputed root to the root the manifest's `pmp` block declares.
   *      verified = recomputedRoot === declaredRoot. A tampered record body recomputes a
   *      different root → verified:false. Returns { verified, root, recomputed_root }.
   */
  router.post('/v1/pmp/verify', async (req: Request, res: Response) => {
    const b64 = extractPmpBase64(req);
    if (!b64) {
      res
        .status(422)
        .json({ error: 'invalid_body', hint: 'pmp_base64 (the .tar.zst bytes) is required' } satisfies ErrorBody);
      return;
    }

    try {
      const result = withStagedPmp(b64, (path) => readMemoryPack(path));
      const declaredRoot = pmpBlock(result.manifest).merkle_root ?? null;

      // Recompute each leaf over the canonical fields the record carries, then the root.
      const leaves: string[] = [];
      for (const rec of result.records) {
        leaves.push(leafHashFor(leafInputFromRecord(rec, null)));
      }
      if (leaves.length === 0) {
        res.json({ verified: false, reason: 'no_records', root: declaredRoot, recomputed_root: null });
        return;
      }
      const recomputedRoot = buildPackTree(leaves).root;
      const verified = declaredRoot !== null && recomputedRoot === declaredRoot;

      res.json({
        verified,
        root: declaredRoot,
        recomputed_root: recomputedRoot,
        record_count: result.records.length,
        leaf_hash_algorithm: LEAF_HASH_ALGORITHM,
        merkle_algorithm: MERKLE_ALGORITHM,
        warnings: result.warnings,
      });
    } catch (err) {
      // A malformed / non-.pmp upload is the caller's error, not a server fault.
      log.warn({ err: (err as Error).message }, 'POST /v1/pmp/verify: unreadable artifact');
      res
        .status(422)
        .json({ error: 'unreadable_pmp', hint: (err as Error).message } satisfies ErrorBody);
    }
  });

  /**
   * POST /v1/pmp/import — ingest a `.pmp` into the caller's memory namespace.
   *
   * Body: { pmp_base64 }
   *   1. readMemoryPack parses the artifact.
   *   2. HASH-VERIFY each record: recompute its leaf hash (memory-hash-v1); if the record
   *      carries a declared `metadata.leaf_hash` that DISAGREES, reject it (counted, not
   *      ingested). Records with no declared leaf are accepted at their recomputed hash.
   *   3. DEDUPE by content_hash against the owner's existing memories — a record whose leaf
   *      hash already exists in the caller's namespace is skipped (deduped).
   *   4. INGEST the rest as owner-scoped `memories` rows (content_hash = recomputed leaf).
   *   5. Write a pmp_imports receipt row with the counts. Owner-scoped throughout.
   */
  router.post(
    '/v1/pmp/import',
    requirePrivyAuth,
    requireOwnership,
    async (req: Request, res: Response) => {
      const owner = ownerFromReq(req);
      if (!owner) {
        res.status(401).json({ error: 'unauthenticated' } satisfies ErrorBody);
        return;
      }
      const b64 = extractPmpBase64(req);
      if (!b64) {
        res
          .status(422)
          .json({ error: 'invalid_body', hint: 'pmp_base64 (the .tar.zst bytes) is required' } satisfies ErrorBody);
        return;
      }

      let result;
      try {
        result = withStagedPmp(b64, (path) => readMemoryPack(path));
      } catch (err) {
        log.warn({ err: (err as Error).message }, 'POST /v1/pmp/import: unreadable artifact');
        res
          .status(422)
          .json({ error: 'unreadable_pmp', hint: (err as Error).message } satisfies ErrorBody);
        return;
      }

      if (result.records.length > MAX_RECORDS) {
        res
          .status(422)
          .json({ error: 'too_many_records', hint: `import capped at ${MAX_RECORDS} records` } satisfies ErrorBody);
        return;
      }

      try {
        const db = getDb();
        const manifest = result.manifest;
        const block = pmpBlock(manifest);
        const sourcePubkey =
          (manifest.producer && manifest.producer.public_key) || block.creator_pubkey || null;

        // 1+2. Hash-verify each record. A declared leaf_hash that disagrees with the recompute
        //      is a rejected record (the byte stream was tampered post-signing). Encrypted
        //      records (ciphertext content without a key) cannot be leaf-verified → rejected.
        interface VerifiedRecord {
          rec: MemoryPackRecord;
          leaf: string;
        }
        const verified: VerifiedRecord[] = [];
        let rejectedCount = 0;
        for (const rec of result.records) {
          if (rec.encrypted) {
            rejectedCount += 1;
            continue;
          }
          const leaf = leafHashFor(leafInputFromRecord(rec, owner));
          // The spec carries `leaf_hash` as a top-level record field (§4: "records.jsonl ←
          // MemoryPackRecord + leaf_hash per line"). Read it there first; tolerate the
          // metadata location our own exporter writes. A declared leaf that disagrees with the
          // recompute means the byte stream was tampered post-signing → reject.
          const declared = declaredLeafHash(rec);
          if (declared !== null && declared !== leaf) {
            rejectedCount += 1;
            continue;
          }
          verified.push({ rec, leaf });
        }

        // 3. Dedupe by content_hash against the owner's existing memories. One IN-query over
        //    the candidate leaf set, scoped to the caller — never another tenant's rows.
        const candidateLeaves = Array.from(new Set(verified.map((v) => v.leaf)));
        const existingHashes = new Set<string>();
        if (candidateLeaves.length > 0) {
          const { data: existingRaw, error: existErr } = await db
            .from('memories')
            .select('content_hash')
            .eq('owner_wallet', owner)
            .in('content_hash', candidateLeaves);
          if (existErr) {
            log.warn({ err: existErr }, 'import: dedupe lookup failed');
            res.status(500).json({ error: 'import_failed' } satisfies ErrorBody);
            return;
          }
          for (const r of (existingRaw ?? []) as Array<{ content_hash: string | null }>) {
            if (r.content_hash) existingHashes.add(r.content_hash);
          }
        }

        // 4. Ingest the non-deduped survivors as owner-scoped memory rows. Dedupe within the
        //    batch too (two records hashing identically land once). content_hash = the leaf so
        //    the row participates in the same dedupe set on a future import.
        const nowIso = new Date().toISOString();
        const importTag = sourcePubkey ? `imported_from_pmp:${block.artifact_id ?? sourcePubkey}` : 'imported_from_pmp';
        const seenInBatch = new Set<string>();
        let importedCount = 0;
        let dedupedCount = 0;
        const toInsert: Array<Record<string, unknown>> = [];
        for (const { rec, leaf } of verified) {
          if (existingHashes.has(leaf) || seenInBatch.has(leaf)) {
            dedupedCount += 1;
            continue;
          }
          seenInBatch.add(leaf);
          importedCount += 1;
          const baseTags = Array.isArray(rec.tags) ? rec.tags.filter((t) => t !== importTag) : [];
          toInsert.push({
            memory_type: recordMemoryType(rec.kind),
            content: rec.content,
            summary: typeof rec.summary === 'string' ? rec.summary : rec.content.slice(0, 280),
            tags: [...baseTags, importTag],
            importance: typeof rec.importance === 'number' ? rec.importance : 0.5,
            access_count: 0,
            source: importTag,
            related_user: null,
            related_wallet: null,
            metadata: { imported_from_pmp: block.artifact_id ?? null, source_pubkey: sourcePubkey },
            owner_wallet: owner,
            content_hash: leaf,
            tokenization_status: 'pending',
            created_at: rec.created_at && !Number.isNaN(Date.parse(rec.created_at)) ? rec.created_at : nowIso,
          });
        }

        if (toInsert.length > 0) {
          const { error: insErr } = await db.from('memories').insert(toInsert);
          if (insErr) {
            log.warn({ err: insErr }, 'import: memory insert failed');
            res.status(500).json({ error: 'import_failed' } satisfies ErrorBody);
            return;
          }
        }

        // 5. Write the import receipt (owner-scoped accounting).
        const importId = generateImportId();
        const receipt = {
          import_id: importId,
          owner_wallet: owner,
          artifact_manifest_hash: computeManifestHash(manifest),
          source_pubkey: sourcePubkey,
          record_count: result.records.length,
          imported_count: importedCount,
          deduped_count: dedupedCount,
          rejected_count: rejectedCount,
          created_at: nowIso,
        };
        const { error: recErr } = await db.from('pmp_imports').insert(receipt);
        if (recErr) {
          // The memories already landed; a receipt failure shouldn't 500 the caller. Log + report.
          log.warn({ err: recErr, importId }, 'import: receipt insert failed (memories already ingested)');
        }

        res.status(201).json({
          import_id: importId,
          record_count: result.records.length,
          imported_count: importedCount,
          deduped_count: dedupedCount,
          rejected_count: rejectedCount,
          source_pubkey: sourcePubkey,
        });
      } catch (err) {
        log.error({ err }, 'POST /v1/pmp/import failed');
        res.status(500).json({ error: 'import_failed' } satisfies ErrorBody);
      }
    },
  );

  return router;
}
