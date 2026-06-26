/**
 * Static validation of the Memory Pack Marketplace — Slice 1, Part B: payments +
 * durable-delivery foundation (migration 032_payments.sql).
 *
 * MONEY CODE. A stateless session cannot apply SQL to a real Postgres/Supabase
 * branch, so this suite is the testable proxy for "the migration is correct": it
 * parses 032_payments.sql and asserts it declares every PAYMENT + ACCESS table,
 * column, CHECK constraint, and UNIQUE index that design spec §2 and the §00 M6
 * binding correction require.
 *
 * The two load-bearing idempotency guarantees the whole money path rests on:
 *   uq_pay_events_dedup  UNIQUE(rail, rail_event_id)   — a Stripe webhook re-delivery
 *                                                         can never double-process.
 *   uq_orders_idem       UNIQUE(buyer_wallet, client_token) — a retried order intent
 *                                                         can never double-charge.
 * These mirror the proven topup.routes.ts pattern (UNIQUE + 23505 dedupe + poller).
 *
 * M6 (the headline correction): delivery is driven off ORDER STATE, not an in-process
 * event. The order status enum therefore MUST carry the full paid → delivering →
 * delivered → settled progression so a separate worker can transition it, retryable,
 * after the webhook has only written status='paid' and returned 200.
 *
 * House-style guards (BEGIN/COMMIT, IF NOT EXISTS, numbered header) keep this
 * consistent with 030_marketplace_core.sql / 031_compliance.sql. Applying the
 * migration to a real database remains a deploy gate, performed outside this session.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../../packages/database/migrations');

const PAYMENTS_FILE = path.join(MIGRATIONS_DIR, '032_payments.sql');

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

/** Collapse whitespace so multi-line DDL can be matched with simple substrings. */
function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ');
}

describe('payments migration — house style', () => {
  it('is wrapped in a single transaction with a numbered header comment', () => {
    const sql = read(PAYMENTS_FILE);
    expect(sql, '032_payments.sql must start with a numbered header comment').toMatch(/^--\s*032[_:]/);
    expect(sql, '032_payments.sql must open BEGIN;').toMatch(/^\s*--[\s\S]*?\bBEGIN;/);
    expect(sql, '032_payments.sql must end COMMIT;').toMatch(/\bCOMMIT;\s*$/);
  });

  it('every CREATE TABLE / CREATE INDEX / ADD COLUMN is idempotent (IF NOT EXISTS)', () => {
    const sql = read(PAYMENTS_FILE);
    const creates = sql.match(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\b(?!\s+IF\s+NOT\s+EXISTS)/gi);
    expect(creates, 'all CREATE TABLE/INDEX must use IF NOT EXISTS').toBeNull();
    const adds = sql.match(/ADD\s+COLUMN\b(?!\s+IF\s+NOT\s+EXISTS)/gi);
    expect(adds, 'all ADD COLUMN must use IF NOT EXISTS').toBeNull();
  });
});

describe('032_payments.sql — payment + access tables', () => {
  const sql = () => normalize(read(PAYMENTS_FILE));

  it('creates every Part-B payment + access table', () => {
    for (const table of [
      'marketplace_orders',
      'marketplace_payment_events',
      'creator_payout_accounts',
      'creator_payouts',
      'marketplace_ledger',
      'pack_entitlements',
      'pack_access_events',
    ]) {
      expect(sql(), `missing table ${table}`).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i'),
      );
    }
  });

  // ─────────── marketplace_orders: the state machine M6 drives delivery off ───────────
  it('marketplace_orders is FK-bound to memory_packs and stores both parties', () => {
    expect(sql()).toMatch(/marketplace_orders[\s\S]*?pack_id\s+TEXT\s+NOT NULL\s+REFERENCES\s+memory_packs\(pack_id\)/i);
    // two-party table (deliberate departure from single-owner scoping — design §2)
    expect(sql()).toMatch(/seller_wallet\s+TEXT\s+NOT NULL/i);
    expect(sql()).toMatch(/buyer_wallet\s+TEXT/i);
  });

  it('marketplace_orders constrains rail, listing_kind, and the full M6 status lifecycle', () => {
    expect(sql()).toMatch(/rail[^,]*CHECK\s*\(\s*rail\s+IN\s*\(\s*'stripe'\s*,\s*'solana'\s*,\s*'base'\s*\)/i);
    expect(sql()).toMatch(/listing_kind[^,]*CHECK\s*\(\s*listing_kind\s+IN\s*\(\s*'copy'\s*,\s*'title'\s*\)/i);
    // M6: delivery is a worker-driven state transition, so paid→delivering→delivered→settled
    // MUST all be representable. A missing intermediate state = a lost pack on crash.
    for (const s of [
      'created',
      'awaiting_payment',
      'paid',
      'delivering',
      'delivered',
      'settled',
      'refunding',
      'refunded',
      'failed',
      'expired',
    ]) {
      expect(sql(), `order status enum missing '${s}'`).toMatch(new RegExp(`'${s}'`));
    }
  });

  it('marketplace_orders carries client_token + the money columns', () => {
    expect(sql()).toMatch(/client_token\s+TEXT\s+NOT NULL/i);
    expect(sql()).toMatch(/amount\s+NUMERIC\([^)]+\)\s+NOT NULL/i);
    expect(sql()).toMatch(/fee_amount\s+NUMERIC/i);
    expect(sql()).toMatch(/payout_amount\s+NUMERIC/i);
  });

  it('marketplace_orders enforces the two idempotency UNIQUE indexes', () => {
    // uq_orders_idem — a retried order intent can never create a second charge.
    expect(sql()).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_idem\s+ON marketplace_orders\(buyer_wallet,\s*client_token\)/i,
    );
    // uq_orders_rail_tx — one settled order per on-chain tx (crypto rails).
    expect(sql()).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_rail_tx\s+ON marketplace_orders\(rail,\s*rail_tx\)\s+WHERE rail_tx IS NOT NULL/i,
    );
  });

  it('marketplace_orders has the seller / buyer / status-expiry lookup indexes', () => {
    expect(sql()).toMatch(/CREATE INDEX IF NOT EXISTS idx_orders_seller\b/i);
    expect(sql()).toMatch(/CREATE INDEX IF NOT EXISTS idx_orders_buyer\b/i);
    // the sweeper/poller scans (status, expires_at) to revive stuck orders.
    expect(sql()).toMatch(/CREATE INDEX IF NOT EXISTS idx_orders_status_expiry\s+ON marketplace_orders\(status,\s*expires_at\)/i);
  });

  // ─────────── marketplace_payment_events: webhook dedupe (R6) ───────────
  it('marketplace_payment_events dedupes on (rail, rail_event_id) — the webhook replay guard', () => {
    expect(sql()).toMatch(/marketplace_payment_events[\s\S]*?order_id\s+TEXT\s+REFERENCES\s+marketplace_orders\(order_id\)/i);
    // THE guarantee that a Stripe webhook re-delivery is processed at most once.
    expect(sql()).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_pay_events_dedup\s+ON marketplace_payment_events\(rail,\s*rail_event_id\)\s+WHERE rail_event_id IS NOT NULL/i,
    );
  });

  // ─────────── pack_entitlements: the SINGLE table the unlock gate checks ───────────
  it('pack_entitlements is the single unlock-gate table with the right grant_kind + status enums', () => {
    expect(sql()).toMatch(/pack_entitlements[\s\S]*?pack_id\s+TEXT\s+NOT NULL\s+REFERENCES\s+memory_packs\(pack_id\)\s+ON DELETE CASCADE/i);
    expect(sql()).toMatch(/holder_wallet\s+TEXT\s+NOT NULL/i);
    expect(sql()).toMatch(
      /grant_kind\s+TEXT\s+NOT NULL\s+CHECK\s*\(\s*grant_kind\s+IN\s*\(\s*'copy_license'\s*,\s*'title_owner'\s*\)/i,
    );
    expect(sql()).toMatch(
      /status\s+TEXT\s+NOT NULL\s+DEFAULT\s+'active'\s+CHECK\s*\(\s*status\s+IN\s*\(\s*'active'\s*,\s*'revoked'\s*,\s*'refunded'\s*\)/i,
    );
  });

  it('pack_entitlements is unique per (pack, holder, grant_kind) and indexes active holders', () => {
    // One entitlement of a kind per holder per pack — the gate upserts against this.
    expect(sql()).toMatch(/UNIQUE\s*\(\s*pack_id\s*,\s*holder_wallet\s*,\s*grant_kind\s*\)/i);
    expect(sql()).toMatch(/CREATE INDEX IF NOT EXISTS idx_pack_entitlements_holder\s+ON pack_entitlements\(holder_wallet\)\s+WHERE status\s*=\s*'active'/i);
  });

  // ─────────── creator payouts + ledger ───────────
  it('creator_payout_accounts is one-per-owner and rail-constrained', () => {
    expect(sql()).toMatch(/creator_payout_accounts[\s\S]*?owner_wallet\s+TEXT\s+NOT NULL\s+UNIQUE/i);
    expect(sql()).toMatch(/payout_rail[^,]*CHECK\s*\(\s*payout_rail\s+IN\s*\(\s*'stripe_connect'\s*,\s*'solana'\s*,\s*'base'\s*\)/i);
  });

  it('creator_payouts is idempotent per (owner, client_token) with a status enum', () => {
    expect(sql()).toMatch(/creator_payouts[\s\S]*?owner_wallet\s+TEXT\s+NOT NULL/i);
    expect(sql()).toMatch(/status[^,]*CHECK\s*\(\s*status\s+IN\s*\(\s*'pending'\s*,\s*'processing'\s*,\s*'paid'\s*,\s*'failed'\s*\)/i);
    expect(sql()).toMatch(/UNIQUE\s*\(\s*owner_wallet\s*,\s*client_token\s*\)/i);
  });

  it('marketplace_ledger is a double-entry log (debit/credit constrained)', () => {
    expect(sql()).toMatch(/marketplace_ledger[\s\S]*?direction[^,]*CHECK\s*\(\s*direction\s+IN\s*\(\s*'debit'\s*,\s*'credit'\s*\)/i);
    expect(sql()).toMatch(/marketplace_ledger[\s\S]*?amount\s+NUMERIC/i);
  });

  // ─────────── pack_access_events ───────────
  it('pack_access_events constrains event_type for the watermark/audit trail', () => {
    expect(sql()).toMatch(/pack_access_events[\s\S]*?holder_wallet\s+TEXT\s+NOT NULL/i);
    expect(sql()).toMatch(/event_type[^,]*CHECK\s*\(\s*event_type\s+IN\s*\(\s*'preview'\s*,\s*'unlock'\s*,\s*'reveal'\s*\)/i);
  });

  it('does NOT include title / pmp-artifact tables (those are later Part-B / Part-C slices)', () => {
    for (const forbidden of [
      'pack_titles',
      'pack_title_transfers',
      'marketplace_title_holds',
      'pmp_artifacts',
      'pmp_devices',
      'pmp_imports',
      'pmp_pairing_codes',
    ]) {
      expect(read(PAYMENTS_FILE), `chunk 1 must not define ${forbidden}`).not.toMatch(
        new RegExp(`CREATE TABLE[^;]*\\b${forbidden}\\b`, 'i'),
      );
    }
  });
});
