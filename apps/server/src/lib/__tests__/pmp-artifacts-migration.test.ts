/**
 * Static validation of the Memory Pack Marketplace — desktop .pmp subsystem
 * (migration 033_pmp_artifacts.sql, design spec §2 "PMP ARTIFACTS" + "DESKTOP PAIRING").
 *
 * A stateless session cannot apply SQL to a real Postgres/Supabase branch, so this
 * suite is the testable proxy for "the migration is correct": it parses
 * 033_pmp_artifacts.sql and asserts it declares every PMP-ARTIFACT + DESKTOP-PAIRING
 * table, column, CHECK constraint, and index the design spec §2 requires.
 *
 * The two anti-phishing / anti-collision guarantees this slice rests on:
 *   uq_pmp_artifacts_manifest_hash  UNIQUE(owner_wallet, manifest_hash)
 *       — SCOPED to the owner (§00 MINOR 14, binding correction): two users exporting
 *         the SAME public pack produce the same manifest_hash and MUST NOT collide on
 *         a global unique index.
 *   pmp_pairing_codes.expires_at NOT NULL + a 'pending'|'claimed'|'consumed'|'expired'
 *         status lifecycle — the substrate for the <2 min, human-confirmed, authed-claim
 *         pairing handshake (§00 MINOR 11): a code read aloud to an attacker must not let
 *         them silently pair.
 *
 * House-style guards (BEGIN/COMMIT, IF NOT EXISTS, numbered header) keep this consistent
 * with 030_marketplace_core.sql / 031_compliance.sql / 032_payments.sql. Applying the
 * migration to a real database remains a deploy gate, performed outside this session.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../../packages/database/migrations');

const PMP_FILE = path.join(MIGRATIONS_DIR, '033_pmp_artifacts.sql');

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

/** Collapse whitespace so multi-line DDL can be matched with simple substrings. */
function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ');
}

describe('pmp-artifacts migration — house style', () => {
  it('is wrapped in a single transaction with a numbered header comment', () => {
    const sql = read(PMP_FILE);
    expect(sql, '033_pmp_artifacts.sql must start with a numbered header comment').toMatch(/^--\s*033[_:]/);
    expect(sql, '033_pmp_artifacts.sql must open BEGIN;').toMatch(/^\s*--[\s\S]*?\bBEGIN;/);
    expect(sql, '033_pmp_artifacts.sql must end COMMIT;').toMatch(/\bCOMMIT;\s*$/);
  });

  it('every CREATE TABLE / CREATE INDEX is idempotent (IF NOT EXISTS)', () => {
    const sql = read(PMP_FILE);
    const creates = sql.match(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\b(?!\s+IF\s+NOT\s+EXISTS)/gi);
    expect(creates, 'all CREATE TABLE/INDEX must use IF NOT EXISTS').toBeNull();
    const adds = sql.match(/ADD\s+COLUMN\b(?!\s+IF\s+NOT\s+EXISTS)/gi);
    expect(adds, 'all ADD COLUMN must use IF NOT EXISTS').toBeNull();
  });
});

describe('033_pmp_artifacts.sql — pmp artifact + desktop tables', () => {
  const sql = () => normalize(read(PMP_FILE));

  it('creates every desktop-.pmp subsystem table', () => {
    for (const table of ['pmp_artifacts', 'pmp_imports', 'pmp_devices', 'pmp_pairing_codes']) {
      expect(sql(), `missing table ${table}`).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i'),
      );
    }
  });

  // ─────────── pmp_artifacts: the built .pmp file registry ───────────
  it('pmp_artifacts has artifact_id PK and is owner-scoped', () => {
    expect(sql()).toMatch(/CREATE TABLE IF NOT EXISTS pmp_artifacts\s*\(\s*artifact_id\s+TEXT\s+PRIMARY KEY/i);
    expect(sql()).toMatch(/pmp_artifacts[\s\S]*?owner_wallet\s+TEXT\s+NOT NULL/i);
  });

  it('pmp_artifacts references memory_packs(pack_id) with ON DELETE SET NULL', () => {
    expect(sql()).toMatch(
      /pmp_artifacts[\s\S]*?pack_id\s+TEXT\s+REFERENCES\s+memory_packs\(pack_id\)\s+ON DELETE SET NULL/i,
    );
  });

  it('pmp_artifacts carries every identity column from the .pmp manifest', () => {
    for (const col of [
      'pmp_version',
      'title',
      'record_count',
      'merkle_root',
      'manifest_hash',
      'creator_pubkey',
      'manifest_sig',
      'storage_url',
      'byte_size',
      'signing_device_id',
      'anchor_chain',
      'anchor_tx_sig',
    ]) {
      expect(sql(), `pmp_artifacts missing column ${col}`).toMatch(new RegExp(`\\b${col}\\b`));
    }
    // NOT NULL on the load-bearing identity fields.
    expect(sql()).toMatch(/manifest_hash\s+TEXT\s+NOT NULL/i);
    expect(sql()).toMatch(/creator_pubkey\s+TEXT\s+NOT NULL/i);
    expect(sql()).toMatch(/manifest_sig\s+TEXT\s+NOT NULL/i);
    expect(sql()).toMatch(/record_count\s+INTEGER\s+NOT NULL/i);
  });

  it('pmp_artifacts constrains license_type, encryption_scope, and source_kind', () => {
    expect(sql()).toMatch(/license_type\s+TEXT\s+NOT NULL\s+CHECK\s*\(\s*license_type\s+IN\s*\(\s*'copy'\s*,\s*'title'\s*\)/i);
    expect(sql()).toMatch(
      /encryption_scope\s+TEXT\s+CHECK\s*\(\s*encryption_scope\s+IN\s*\(\s*'none'\s*,\s*'records'\s*,\s*'records\+blobs'\s*\)\s*\)\s+DEFAULT\s+'none'/i,
    );
    expect(sql()).toMatch(
      /source_kind\s+TEXT\s+NOT NULL\s+DEFAULT\s+'web'\s+CHECK\s*\(\s*source_kind\s+IN\s*\(\s*'web'\s*,\s*'desktop'\s*,\s*'cli'\s*,\s*'sdk'\s*\)/i,
    );
  });

  it('pmp_artifacts.manifest_hash UNIQUE is SCOPED to (owner_wallet, manifest_hash) — NOT global', () => {
    // §00 MINOR 14 binding correction: two users exporting the same public pack must
    // not collide. The unique key MUST be the (owner_wallet, manifest_hash) pair.
    expect(sql()).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_pmp_artifacts_manifest_hash\s+ON pmp_artifacts\(owner_wallet,\s*manifest_hash\)/i,
    );
    // And it must NOT be a bare global unique on manifest_hash alone.
    expect(sql()).not.toMatch(/CREATE UNIQUE INDEX[^;]*\bON pmp_artifacts\(manifest_hash\)/i);
  });

  it('pmp_artifacts has an owner lookup index', () => {
    expect(sql()).toMatch(/CREATE INDEX IF NOT EXISTS idx_pmp_artifacts_owner\s+ON pmp_artifacts\(owner_wallet\)/i);
  });

  // ─────────── pmp_imports: hash-verified import accounting ───────────
  it('pmp_imports is owner-scoped with the dedupe / reject counters', () => {
    expect(sql()).toMatch(/CREATE TABLE IF NOT EXISTS pmp_imports\s*\(\s*import_id\s+TEXT\s+PRIMARY KEY/i);
    expect(sql()).toMatch(/pmp_imports[\s\S]*?owner_wallet\s+TEXT\s+NOT NULL/i);
    for (const col of [
      'artifact_manifest_hash',
      'source_pubkey',
      'record_count',
      'imported_count',
      'deduped_count',
      'rejected_count',
    ]) {
      expect(sql(), `pmp_imports missing column ${col}`).toMatch(new RegExp(`\\b${col}\\b`));
    }
    expect(sql()).toMatch(/CREATE INDEX IF NOT EXISTS idx_pmp_imports_owner\s+ON pmp_imports\(owner_wallet\)/i);
  });

  // ─────────── pmp_devices: desktop pairing registry ───────────
  it('pmp_devices is owner-scoped with a UNIQUE device_pubkey and revoke/scope columns', () => {
    expect(sql()).toMatch(/CREATE TABLE IF NOT EXISTS pmp_devices\s*\(\s*device_id\s+TEXT\s+PRIMARY KEY/i);
    expect(sql()).toMatch(/pmp_devices[\s\S]*?owner_wallet\s+TEXT\s+NOT NULL/i);
    expect(sql()).toMatch(/device_pubkey\s+TEXT\s+NOT NULL/i);
    for (const col of ['device_name', 'platform', 'paired_at', 'last_seen_at', 'revoked_at', 'scopes']) {
      expect(sql(), `pmp_devices missing column ${col}`).toMatch(new RegExp(`\\b${col}\\b`));
    }
    // A device pubkey identifies exactly one device — a stolen/duplicate key cannot register twice.
    expect(sql()).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_pmp_devices_pubkey\s+ON pmp_devices\(device_pubkey\)/i);
    // Active-device lookup excludes revoked rows (R9: revocable devices).
    expect(sql()).toMatch(/CREATE INDEX IF NOT EXISTS idx_pmp_devices_owner\s+ON pmp_devices\(owner_wallet\)\s+WHERE revoked_at IS NULL/i);
  });

  // ─────────── pmp_pairing_codes: the anti-phishing handshake substrate (§00 MINOR 11) ───────────
  it('pmp_pairing_codes keys on code_hash and carries the device identity for human confirmation', () => {
    expect(sql()).toMatch(/CREATE TABLE IF NOT EXISTS pmp_pairing_codes\s*\(\s*code_hash\s+TEXT\s+PRIMARY KEY/i);
    // device name + platform are surfaced to the user for explicit confirmation at claim time.
    expect(sql()).toMatch(/pmp_pairing_codes[\s\S]*?device_pubkey\s+TEXT\s+NOT NULL/i);
    for (const col of ['device_name', 'platform', 'owner_wallet']) {
      expect(sql(), `pmp_pairing_codes missing column ${col}`).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('pmp_pairing_codes constrains the status lifecycle and requires expires_at', () => {
    expect(sql()).toMatch(
      /status\s+TEXT\s+NOT NULL\s+DEFAULT\s+'pending'\s+CHECK\s*\(\s*status\s+IN\s*\(\s*'pending'\s*,\s*'claimed'\s*,\s*'consumed'\s*,\s*'expired'\s*\)/i,
    );
    // expires_at is NOT NULL: a pairing code without an expiry could never enforce the <2 min window.
    expect(sql()).toMatch(/expires_at\s+TIMESTAMPTZ\s+NOT NULL/i);
  });

  it('does NOT redefine Part A / Part B tables (those live in 030 / 031 / 032)', () => {
    for (const forbidden of [
      'pack_listings',
      'pack_listing_prices',
      'marketplace_orders',
      'marketplace_payment_events',
      'pack_entitlements',
      'pack_titles',
      'pack_title_transfers',
      'marketplace_title_holds',
      'legal_documents',
      'pack_attestations',
    ]) {
      expect(read(PMP_FILE), `033 must not (re)define ${forbidden}`).not.toMatch(
        new RegExp(`CREATE TABLE[^;]*\\b${forbidden}\\b`, 'i'),
      );
    }
  });
});
