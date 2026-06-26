/**
 * Static validation of the Base pack-title trading saga — title mirror + saga state
 * (migration 035_title_mirror.sql, the SEC-1-gated TITLE rail, TESTNET first).
 *
 * A stateless session cannot apply SQL to a real Postgres/Supabase branch, so this
 * suite is the testable proxy for "the migration is correct": it parses
 * 035_title_mirror.sql and asserts it declares every TITLE-MIRROR + SAGA-STATE +
 * TRANSFER-AUDIT table, column, CHECK constraint, FK, and index the build requires.
 *
 * The load-bearing invariants this slice rests on (from the adversarial review):
 *
 *   pack_titles is a CACHE/INDEX of on-chain ownerOf — the chain is the source of
 *     truth. current_owner is NULL until minted; status walks
 *     pending_mint → minted → transferring → transferred. The unlock gate (B2/RT9)
 *     reads ownerOf live and FAILS CLOSED on RPC error — this row is only ever a
 *     fast-path/reconciliation index, never the authority.
 *
 *   title_sale_sagas is the FORWARD-ONLY, resumable saga state (M4/RT1/RT3). The
 *     step enum encodes the exact M4 ordering of the sale
 *     (created → dek_rewrapped → paid → transferred → revoked) plus the terminal
 *     refunded/failed branches. The REFUND-BEFORE-MOVE boundary (RT3) is queryable:
 *     a refund is only legal while step is strictly BEFORE 'transferred' (the
 *     irreversible on-chain move) — once the title moved on-chain the sale is FINAL.
 *     order_id is UNIQUE so a retried sale collapses to one resumable saga.
 *
 *   title_transfers is the append-only on-chain transfer audit (one row per
 *     ownerOf change), the substrate for reconciliation against the chain.
 *
 * House-style guards (BEGIN/COMMIT, IF NOT EXISTS, DO-block CHECKs, numbered header)
 * keep this consistent with 030_marketplace_core.sql … 034_title_holder_dek_wrap.sql.
 * Applying the migration to a real database remains a DEPLOY GATE, performed outside
 * this session — this static suite is the proxy that this DDL is correct.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../../packages/database/migrations');

const TITLE_MIRROR_FILE = path.join(MIGRATIONS_DIR, '035_title_mirror.sql');

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

/** Collapse whitespace so multi-line DDL can be matched with simple substrings. */
function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ');
}

describe('title-mirror migration — house style', () => {
  it('is wrapped in a single transaction with a numbered header comment', () => {
    const sql = read(TITLE_MIRROR_FILE);
    expect(sql, '035_title_mirror.sql must start with a numbered header comment').toMatch(/^--\s*035[_:]/);
    expect(sql, '035_title_mirror.sql must open BEGIN;').toMatch(/^\s*--[\s\S]*?\bBEGIN;/);
    expect(sql, '035_title_mirror.sql must end COMMIT;').toMatch(/\bCOMMIT;\s*$/);
  });

  it('every CREATE TABLE / CREATE INDEX is idempotent (IF NOT EXISTS)', () => {
    const sql = read(TITLE_MIRROR_FILE);
    const creates = sql.match(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\b(?!\s+IF\s+NOT\s+EXISTS)/gi);
    expect(creates, 'all CREATE TABLE/INDEX must use IF NOT EXISTS').toBeNull();
    const adds = sql.match(/ADD\s+COLUMN\b(?!\s+IF\s+NOT\s+EXISTS)/gi);
    expect(adds, 'all ADD COLUMN must use IF NOT EXISTS').toBeNull();
  });

  it('any constraint added via ALTER is guarded by a DO-block existence check (re-runnable)', () => {
    const sql = read(TITLE_MIRROR_FILE);
    // If the migration ALTERs to ADD CONSTRAINT, it must be inside a DO $$ … pg_constraint guard
    // (the 034 pattern) so a re-run does not error. No bare ADD CONSTRAINT allowed.
    const bareAddConstraint = sql.match(/ALTER TABLE[^;]*ADD CONSTRAINT/gi);
    if (bareAddConstraint) {
      expect(sql, 'ADD CONSTRAINT must be inside a DO-block guarded by pg_constraint').toMatch(
        /DO \$\$ BEGIN[\s\S]*?pg_constraint[\s\S]*?ADD CONSTRAINT/i,
      );
    }
  });
});

describe('035_title_mirror.sql — title mirror, saga state, transfer audit', () => {
  const sql = () => normalize(read(TITLE_MIRROR_FILE));

  it('creates the three title-rail tables', () => {
    for (const table of ['pack_titles', 'title_sale_sagas', 'title_transfers']) {
      expect(sql(), `missing table ${table}`).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i'),
      );
    }
  });

  // ─────────── pack_titles: the on-chain ownerOf MIRROR (cache/index) ───────────
  it('pack_titles keys on pack_id (one title per pack)', () => {
    // pack_id is the natural key — exactly one 1-of-1 title per pack.
    expect(sql()).toMatch(/CREATE TABLE IF NOT EXISTS pack_titles\s*\(\s*pack_id\s+TEXT\s+PRIMARY KEY/i);
  });

  it('pack_titles binds to memory_packs(pack_id)', () => {
    expect(sql()).toMatch(/pack_titles[\s\S]*?pack_id\s+TEXT\s+PRIMARY KEY\s+REFERENCES\s+memory_packs\(pack_id\)/i);
  });

  it('pack_titles carries the on-chain identity columns (token_id as a decimal string)', () => {
    for (const col of [
      'token_id',
      'contract_address',
      'chain',
      'current_owner',
      'creator_wallet',
      'mint_tx',
      'mint_block',
      'last_synced_block',
      'status',
      'created_at',
      'updated_at',
    ]) {
      expect(sql(), `pack_titles missing column ${col}`).toMatch(new RegExp(`\\b${col}\\b`));
    }
    // token_id is the uint256 stored as a DECIMAL STRING (TEXT) — a BIGINT would overflow.
    expect(sql()).toMatch(/token_id\s+TEXT/i);
    // mint_block / last_synced_block are block heights — BIGINT.
    expect(sql()).toMatch(/mint_block\s+BIGINT/i);
    expect(sql()).toMatch(/last_synced_block\s+BIGINT/i);
  });

  it('pack_titles.chain constrains the testnet/mainnet set (base-sepolia | base), testnet by default', () => {
    expect(sql()).toMatch(
      /chain\s+TEXT\s+NOT NULL\s+DEFAULT\s+'base-sepolia'\s+CHECK\s*\(\s*chain\s+IN\s*\(\s*'base-sepolia'\s*,\s*'base'\s*\)/i,
    );
  });

  it('pack_titles.status constrains the mint/transfer lifecycle', () => {
    expect(sql()).toMatch(
      /status\s+TEXT\s+NOT NULL\s+DEFAULT\s+'pending_mint'\s+CHECK\s*\(\s*status\s+IN\s*\(\s*'pending_mint'\s*,\s*'minted'\s*,\s*'transferring'\s*,\s*'transferred'\s*\)/i,
    );
  });

  it('pack_titles.current_owner is NULLABLE (NULL until minted) — the chain is the source of truth', () => {
    // current_owner is a CACHE of ownerOf; it must NOT be NOT NULL (a pending_mint title has no owner yet).
    const col = normalize(read(TITLE_MIRROR_FILE)).match(/current_owner\s+TEXT[^,]*/i)?.[0] ?? '';
    expect(col, 'current_owner must be nullable (NULL until minted)').not.toMatch(/NOT NULL/i);
  });

  it('pack_titles has a current_owner lookup index (fast gating / reconciliation)', () => {
    expect(sql()).toMatch(/CREATE INDEX IF NOT EXISTS idx_pack_titles_owner\s+ON pack_titles\(current_owner\)/i);
  });

  // ─────────── title_sale_sagas: forward-only resumable saga state (M4/RT1/RT3) ───────────
  it('title_sale_sagas keys on saga_id and is UNIQUE per order (one resumable saga per order)', () => {
    expect(sql()).toMatch(/CREATE TABLE IF NOT EXISTS title_sale_sagas\s*\(\s*saga_id\s+TEXT\s+PRIMARY KEY/i);
    // order_id is UNIQUE + FK to marketplace_orders so a retried sale collapses to one saga (RT1).
    expect(sql()).toMatch(/order_id\s+TEXT\s+NOT NULL\s+UNIQUE\s+REFERENCES\s+marketplace_orders\(order_id\)/i);
  });

  it('title_sale_sagas carries the parties + step bookkeeping columns', () => {
    for (const col of [
      'pack_id',
      'seller_wallet',
      'buyer_wallet',
      'step',
      'transfer_tx',
      'last_error',
      'created_at',
      'updated_at',
    ]) {
      expect(sql(), `title_sale_sagas missing column ${col}`).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('title_sale_sagas.step encodes the M4 forward-only ordering + terminal branches', () => {
    // The exact M4 ordering: re-wrap DEK → capture payment → on-chain transfer → revoke seller.
    // created → dek_rewrapped → paid → transferred → revoked, plus refunded/failed terminals.
    expect(sql()).toMatch(
      /step\s+TEXT\s+NOT NULL\s+DEFAULT\s+'created'\s+CHECK\s*\(\s*step\s+IN\s*\(\s*'created'\s*,\s*'dek_rewrapped'\s*,\s*'paid'\s*,\s*'transferred'\s*,\s*'revoked'\s*,\s*'refunded'\s*,\s*'failed'\s*\)/i,
    );
    // 'transferred' — the irreversible on-chain move — MUST appear in the enum: it is the
    // refund-before-move boundary the saga is queried against (RT3).
    expect(sql(), "step enum must include 'transferred' (the RT3 finality boundary)").toMatch(/'transferred'/);
  });

  it('title_sale_sagas can be queried by step to resume + enforce the refund-before-move boundary', () => {
    // A partial index on (step) lets the resumer scan in-flight sagas and lets the refund
    // path assert step is strictly BEFORE 'transferred' without a table scan.
    expect(sql()).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_title_sale_sagas_step\s+ON title_sale_sagas\(step\)/i,
    );
  });

  // ─────────── title_transfers: append-only on-chain transfer audit ───────────
  it('title_transfers is the append-only on-chain ownerOf-change audit', () => {
    expect(sql()).toMatch(/CREATE TABLE IF NOT EXISTS title_transfers\s*\(\s*transfer_id\s+BIGSERIAL\s+PRIMARY KEY/i);
    for (const col of ['pack_id', 'token_id', 'from_wallet', 'to_wallet', 'tx', 'block', 'at']) {
      expect(sql(), `title_transfers missing column ${col}`).toMatch(new RegExp(`\\b${col}\\b`));
    }
    // block is a chain block height — BIGINT.
    expect(sql()).toMatch(/block\s+BIGINT/i);
  });

  it('title_transfers has a pack lookup index for per-title history', () => {
    expect(sql()).toMatch(/CREATE INDEX IF NOT EXISTS idx_title_transfers_pack\s+ON title_transfers\(pack_id/i);
  });

  // ─────────── scope guard: do NOT redefine tables owned by 030–034 ───────────
  // 035 legitimately FK-references marketplace_orders + memory_packs, so the guard must match
  // only a CREATE TABLE whose *target* is the forbidden name (the name immediately following
  // CREATE TABLE [IF NOT EXISTS]), NOT a REFERENCES clause or a prose mention of it.
  it('does NOT (re)define tables that live in 030 / 031 / 032 / 033 / 034', () => {
    for (const forbidden of [
      'pack_listings',
      'pack_listing_prices',
      'marketplace_orders',
      'marketplace_payment_events',
      'pack_entitlements',
      'pack_access_events',
      'memory_dek_wraps',
      'legal_documents',
      'pack_attestations',
      'pmp_artifacts',
      'pmp_devices',
    ]) {
      expect(normalize(read(TITLE_MIRROR_FILE)), `035 must not (re)define ${forbidden}`).not.toMatch(
        new RegExp(`CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?${forbidden}\\b`, 'i'),
      );
    }
  });
});
