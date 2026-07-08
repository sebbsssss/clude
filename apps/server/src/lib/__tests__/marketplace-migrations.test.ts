/**
 * Static validation of the Memory Pack Marketplace — Slice 1, Part A migrations.
 *
 * A stateless session cannot apply SQL to a real Postgres/Supabase branch, so this
 * suite is the testable proxy for "the migration is correct": it parses the two SQL
 * files and asserts they declare every table / column / CHECK constraint / index the
 * Part A plan (docs/superpowers/plans/2026-06-18-memory-pack-marketplace-slice1-partA.md
 * Task 1) and design spec §2 require — and ONLY the Part-A subset (no payments, title,
 * or PMP-artifact tables, which belong to Part B/C).
 *
 * House-style guards (BEGIN/COMMIT, IF NOT EXISTS) keep these consistent with the
 * existing numbered migrations (see 029_oauth_schema.sql). Applying the migrations to
 * a real database remains a deploy gate, performed outside this stateless session.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../../packages/database/migrations');

const CORE_FILE = path.join(MIGRATIONS_DIR, '030_marketplace_core.sql');
const COMPLIANCE_FILE = path.join(MIGRATIONS_DIR, '031_compliance.sql');

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

/** Collapse whitespace so multi-line DDL can be matched with simple substrings. */
function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ');
}

describe('marketplace migrations — house style', () => {
  it('both files are wrapped in a single transaction', () => {
    for (const file of [CORE_FILE, COMPLIANCE_FILE]) {
      const sql = read(file);
      expect(sql, `${path.basename(file)} must open BEGIN;`).toMatch(/^\s*--[\s\S]*?\bBEGIN;/);
      expect(sql, `${path.basename(file)} must end COMMIT;`).toMatch(/\bCOMMIT;\s*$/);
    }
  });

  it('every CREATE TABLE / CREATE INDEX / ADD COLUMN is idempotent (IF NOT EXISTS)', () => {
    for (const file of [CORE_FILE, COMPLIANCE_FILE]) {
      const sql = read(file);
      const creates = sql.match(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\b(?!\s+IF\s+NOT\s+EXISTS)/gi);
      expect(creates, `${path.basename(file)}: all CREATE TABLE/INDEX must use IF NOT EXISTS`).toBeNull();
      const adds = sql.match(/ADD\s+COLUMN\b(?!\s+IF\s+NOT\s+EXISTS)/gi);
      expect(adds, `${path.basename(file)}: all ADD COLUMN must use IF NOT EXISTS`).toBeNull();
    }
  });

  it('starts with a numbered header comment', () => {
    expect(read(CORE_FILE)).toMatch(/^--\s*030[_:]/);
    expect(read(COMPLIANCE_FILE)).toMatch(/^--\s*031[_:]/);
  });
});

describe('030_marketplace_core.sql — listings subsystem', () => {
  const sql = () => normalize(read(CORE_FILE));

  it('creates the five Part-A listing tables', () => {
    for (const table of [
      'pack_listings',
      'pack_listing_prices',
      'pack_listing_samples',
      'pack_listing_events',
      'pack_reviews',
    ]) {
      expect(sql(), `missing table ${table}`).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i'),
      );
    }
  });

  it('pack_listings is FK-bound to memory_packs and owner-scoped by seller_wallet', () => {
    expect(sql()).toMatch(/pack_id\s+TEXT\s+NOT NULL\s+REFERENCES\s+memory_packs\(pack_id\)/i);
    expect(sql()).toMatch(/seller_wallet\s+TEXT\s+NOT NULL/i);
  });

  it('pack_listings constrains license_type, status, supply_kind, compliance_gate, content_category', () => {
    expect(sql()).toMatch(/license_type[^,]*CHECK\s*\(\s*license_type\s+IN\s*\(\s*'copy'\s*,\s*'title'\s*\)/i);
    expect(sql()).toMatch(/supply_kind[^,]*CHECK\s*\(\s*supply_kind\s+IN\s*\(\s*'unlimited'\s*,\s*'limited'\s*,\s*'single'\s*\)/i);
    expect(sql()).toMatch(/content_category[^,]*CHECK\s*\(\s*content_category\s+IN\s*\(\s*'personal'\s*,\s*'knowledge'\s*,\s*'agent'\s*\)/i);
    expect(sql()).toMatch(/compliance_gate[^,]*CHECK\s*\(\s*compliance_gate\s+IN\s*\(\s*'blocked'\s*,\s*'passed'\s*\)/i);
    // status must include the full lifecycle used by publish/delist
    for (const s of ['draft', 'pending_compliance', 'listed', 'sold_out', 'delisted', 'suspended', 'sold']) {
      expect(sql(), `status enum missing '${s}'`).toMatch(new RegExp(`'${s}'`));
    }
  });

  it('declares the seller, status, and unique-active-pack indexes', () => {
    expect(sql()).toMatch(/CREATE INDEX IF NOT EXISTS idx_pack_listings_seller\b/i);
    expect(sql()).toMatch(/CREATE INDEX IF NOT EXISTS idx_pack_listings_status\b/i);
    // Only ONE non-terminal listing may exist per pack — the core invariant publish relies on.
    expect(sql()).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_pack_listings_active_pack\s+ON pack_listings\(pack_id\)\s+WHERE status IN \(\s*'draft'\s*,\s*'pending_compliance'\s*,\s*'listed'\s*,\s*'sold_out'\s*\)/i,
    );
  });

  it('pack_listing_prices is rail-scoped and CASCADE-deletes with its listing', () => {
    expect(sql()).toMatch(/pack_listing_prices[\s\S]*?listing_id\s+TEXT\s+NOT NULL\s+REFERENCES\s+pack_listings\(listing_id\)\s+ON DELETE CASCADE/i);
    expect(sql()).toMatch(/rail[^,]*CHECK\s*\(\s*rail\s+IN\s*\(\s*'clude_solana'\s*,\s*'clude_base'\s*,\s*'stripe'\s*\)/i);
    expect(sql()).toMatch(/PRIMARY KEY \(listing_id, rail\)/i);
  });

  it('pack_reviews enforces a 1-5 rating and one review per (listing, reviewer)', () => {
    expect(sql()).toMatch(/rating\s+SMALLINT\s+NOT NULL\s+CHECK\s*\(\s*rating\s+BETWEEN\s+1\s+AND\s+5\s*\)/i);
    expect(sql()).toMatch(/UNIQUE \(listing_id, reviewer_wallet\)/i);
    // anti-wash-trade: ratings are verified-purchase-only (column must exist)
    expect(sql()).toMatch(/verified_purchase\s+BOOLEAN/i);
  });

  it('does NOT include payments / title / pmp-artifact tables (those are Part B/C)', () => {
    for (const forbidden of [
      'marketplace_orders',
      'marketplace_payment_events',
      'marketplace_title_holds',
      'creator_payout_accounts',
      'creator_payouts',
      'marketplace_ledger',
      'pmp_artifacts',
      'pmp_devices',
      'pack_titles',
    ]) {
      expect(read(CORE_FILE), `Part A must not define ${forbidden}`).not.toMatch(
        new RegExp(`CREATE TABLE[^;]*\\b${forbidden}\\b`, 'i'),
      );
    }
  });
});

describe('031_compliance.sql — compliance subsystem', () => {
  const sql = () => normalize(read(COMPLIANCE_FILE));

  it('creates the four compliance tables', () => {
    for (const table of [
      'legal_documents',
      'legal_acceptances',
      'pack_attestations',
      'pack_moderation',
    ]) {
      expect(sql(), `missing table ${table}`).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i'),
      );
    }
  });

  it('legal_documents is versioned with a composite PK', () => {
    expect(sql()).toMatch(/legal_documents[\s\S]*?PRIMARY KEY \(doc_id, version\)/i);
    expect(sql()).toMatch(/body_hash\s+TEXT\s+NOT NULL/i);
  });

  it('legal_acceptances captures ip + user agent for the audit trail', () => {
    expect(sql()).toMatch(/legal_acceptances[\s\S]*?owner_wallet\s+TEXT\s+NOT NULL/i);
    expect(sql()).toMatch(/ip_inet\s+INET/i);
    expect(sql()).toMatch(/user_agent\s+TEXT/i);
  });

  it('pack_attestations binds the pack, scopes by author, and constrains content_source', () => {
    expect(sql()).toMatch(/pack_attestations[\s\S]*?pack_id\s+TEXT\s+NOT NULL\s+REFERENCES\s+memory_packs\(pack_id\)/i);
    expect(sql()).toMatch(/author_wallet\s+TEXT\s+NOT NULL/i);
    expect(sql()).toMatch(
      /content_source\s+TEXT\s+NOT NULL\s+CHECK\s*\(\s*content_source\s+IN\s*\(\s*'own_personal'\s*,\s*'curated_knowledge'\s*,\s*'agent_memory'\s*\)/i,
    );
    // the three attestation booleans the compliance gate reads
    expect(sql()).toMatch(/owns_or_licensed\s+BOOLEAN\s+NOT NULL/i);
    expect(sql()).toMatch(/no_thirdparty_pii\s+BOOLEAN\s+NOT NULL/i);
    expect(sql()).toMatch(/not_investment_advice\s+BOOLEAN\s+NOT NULL/i);
    // attestation_hash binds the merkle_root
    expect(sql()).toMatch(/attestation_hash\s+TEXT\s+NOT NULL/i);
  });

  it('pack_moderation keyed by pack_id with a status enum + findings JSONB', () => {
    expect(sql()).toMatch(/pack_moderation\s*\(\s*pack_id\s+TEXT\s+PRIMARY KEY\s+REFERENCES\s+memory_packs\(pack_id\)/i);
    for (const s of ['pending', 'clean', 'flagged', 'quarantined', 'approved', 'rejected', 'taken_down']) {
      expect(sql(), `moderation status enum missing '${s}'`).toMatch(new RegExp(`'${s}'`));
    }
    expect(sql()).toMatch(/findings\s+JSONB\s+NOT NULL\s+DEFAULT\s+'\[\]'/i);
  });

  it('ALTERs memory_packs with content_category (NO default, fail-closed) and sale_mode', () => {
    // content_category: server-set from attestation; NULL = unclassified = blocked. MUST NOT have a DEFAULT.
    expect(sql()).toMatch(
      /ADD COLUMN IF NOT EXISTS content_category\s+TEXT\s+CHECK\s*\(\s*content_category\s+IN\s*\(\s*'personal'\s*,\s*'knowledge'\s*,\s*'agent'\s*\)\s*\)/i,
    );
    const contentCategoryClause = normalize(read(COMPLIANCE_FILE)).match(
      /ADD COLUMN IF NOT EXISTS content_category[^,;]*/i,
    )?.[0];
    expect(contentCategoryClause, 'content_category must NOT declare a DEFAULT (fail-closed)').not.toMatch(/DEFAULT/i);
    // sale_mode defaults to 'copy' in Part A
    expect(sql()).toMatch(
      /ADD COLUMN IF NOT EXISTS sale_mode\s+TEXT\s+CHECK\s*\(\s*sale_mode\s+IN\s*\(\s*'copy'\s*,\s*'title'\s*\)\s*\)\s+DEFAULT\s+'copy'/i,
    );
  });

  it('does NOT create title/access tables deferred to Part B', () => {
    for (const forbidden of ['pack_titles', 'pack_title_transfers', 'pack_entitlements', 'pack_access_events', 'pack_takedowns']) {
      expect(read(COMPLIANCE_FILE), `Part A must not define ${forbidden}`).not.toMatch(
        new RegExp(`CREATE TABLE[^;]*\\b${forbidden}\\b`, 'i'),
      );
    }
  });
});
