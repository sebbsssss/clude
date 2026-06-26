/**
 * Static validation of 037_solana_title.sql — the Solana-native pack-title schema PIVOT.
 *
 * A stateless session cannot apply SQL to a real Postgres/Supabase branch, so (like
 * title-mirror-migration.test.ts for 035) this suite is the testable proxy for "the migration is
 * correct": it parses 037_solana_title.sql and asserts it makes pack_titles chain-polymorphic
 * exactly as the Solana build requires, in the project's re-runnable house style.
 *
 * Load-bearing invariants:
 *   - pack_titles stays the SINGLE title mirror for BOTH chains (037 is additive — it must NOT
 *     recreate the 035 table). The on-chain holder remains the source of truth; this row is a cache.
 *   - A Solana title is identified by mint_address (the SPL mint); token_id + contract_address are
 *     Base-only and therefore become NULLABLE. A per-chain CHECK forbids a half-formed row: a Base
 *     row must have token_id + contract_address; a Solana row must have mint_address.
 *   - 'solana' (mainnet) is in the widened chain set but gated on the SAME SEC-1 call as 'base'
 *     (enforced in code, solana-title-mint.ts); 'solana-devnet' is the testnet-first default.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../../packages/database/migrations');
const SOLANA_TITLE_FILE = path.join(MIGRATIONS_DIR, '037_solana_title.sql');

function read(): string {
  return readFileSync(SOLANA_TITLE_FILE, 'utf8');
}

/** Collapse whitespace so multi-line DDL can be matched with simple substrings. */
function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ');
}

describe('037_solana_title.sql — house style (re-runnable, transactional)', () => {
  it('starts with a numbered header comment and is wrapped in one transaction', () => {
    const sql = read();
    expect(sql, '037 must start with a numbered header comment').toMatch(/^--\s*037[_:]/);
    expect(sql, '037 must open BEGIN;').toMatch(/^\s*--[\s\S]*?\bBEGIN;/);
    expect(sql, '037 must end COMMIT;').toMatch(/\bCOMMIT;\s*$/);
  });

  it('every ADD COLUMN and CREATE INDEX is idempotent (IF NOT EXISTS)', () => {
    const sql = read();
    const addCols = sql.match(/ADD\s+COLUMN\b(?!\s+IF\s+NOT\s+EXISTS)/gi);
    expect(addCols, 'all ADD COLUMN must use IF NOT EXISTS').toBeNull();
    const creates = sql.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\b(?!\s+IF\s+NOT\s+EXISTS)/gi);
    expect(creates, 'all CREATE INDEX must use IF NOT EXISTS').toBeNull();
  });

  it('every ADD CONSTRAINT is inside a DO-block guarded by pg_constraint (re-runnable)', () => {
    const sql = normalize(read());
    const adds = sql.match(/ADD CONSTRAINT/gi) ?? [];
    expect(adds.length, 'expected the widened chain CHECK + the per-chain identity CHECK').toBeGreaterThanOrEqual(2);
    // Each ADD CONSTRAINT must be preceded by a DO $$ BEGIN … pg_constraint existence guard.
    const guarded = sql.match(/DO \$\$ BEGIN IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = '[^']+'\)[\s\S]*?ADD CONSTRAINT/gi) ?? [];
    expect(guarded.length, 'every ADD CONSTRAINT must be pg_constraint-guarded').toBe(adds.length);
  });

  it('does NOT recreate pack_titles or any other table (037 is purely additive)', () => {
    expect(read(), '037 must not CREATE TABLE — it only ALTERs pack_titles').not.toMatch(/CREATE TABLE/i);
  });
});

describe('037_solana_title.sql — pack_titles becomes chain-polymorphic', () => {
  const sql = () => normalize(read());

  it('adds mint_address (the SPL mint = the Solana title id)', () => {
    expect(sql()).toMatch(/ALTER TABLE pack_titles ADD COLUMN IF NOT EXISTS mint_address TEXT/i);
  });

  it('relaxes the Base-only columns token_id + contract_address to NULLABLE', () => {
    expect(sql()).toMatch(/ALTER TABLE pack_titles ALTER COLUMN token_id DROP NOT NULL/i);
    expect(sql()).toMatch(/ALTER TABLE pack_titles ALTER COLUMN contract_address DROP NOT NULL/i);
  });

  it('widens the chain CHECK to the Solana set while keeping the Base set', () => {
    // The widened CHECK must list all four chains; drop-if-exists precedes it so the 035 inline
    // constraint is replaced rather than colliding.
    expect(sql()).toMatch(/DROP CONSTRAINT IF EXISTS pack_titles_chain_check/i);
    expect(sql()).toMatch(
      /ADD CONSTRAINT pack_titles_chain_check\s+CHECK \(chain IN \('base-sepolia', 'base', 'solana-devnet', 'solana'\)\)/i,
    );
  });

  it('adds a per-chain well-formedness CHECK (no half-formed row on either chain)', () => {
    const s = sql();
    expect(s).toMatch(/ADD CONSTRAINT pack_titles_chain_identity_chk/i);
    // Base branch: token_id + contract_address present.
    expect(s).toMatch(/chain IN \('base-sepolia', 'base'\) AND token_id IS NOT NULL AND contract_address IS NOT NULL/i);
    // Solana branch: mint_address present.
    expect(s).toMatch(/chain IN \('solana-devnet', 'solana'\) AND mint_address IS NOT NULL/i);
  });

  it('adds the mint_address reconciliation index', () => {
    expect(sql()).toMatch(/CREATE INDEX IF NOT EXISTS idx_pack_titles_mint_address\s+ON pack_titles\(mint_address\)/i);
  });
});
