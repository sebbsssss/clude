-- 032_payments.sql
-- Memory Pack Marketplace — Slice 1, Part B (chunk 1): payments + durable delivery.
--
-- MONEY CODE. The payment + access foundation for COPY-license packs paid by card
-- (Stripe). Builds on the Part A listing/compliance subsystem (030 + 031).
--
-- The §00 M6 binding correction governs this schema: delivery is driven off ORDER
-- STATE + a separate worker/poller, NEVER an in-process event. The Stripe webhook
-- handler verifies the signature, writes status='paid' IDEMPOTENTLY (via the dedupe
-- index below), returns 200 fast, and does NOT run delivery inline. A worker then
-- transitions paid → delivering → delivered → settled, retryable, so a crash between
-- webhook-ack and delivery never loses the pack. This mirrors the proven
-- topup.routes.ts pattern (intent + UNIQUE dedupe + poller fallback).
--
-- The two idempotency guarantees the whole money path rests on:
--   uq_orders_idem        UNIQUE(buyer_wallet, client_token)  — a retried order intent
--                                                               can never double-charge.
--   uq_pay_events_dedup   UNIQUE(rail, rail_event_id)         — a Stripe webhook
--                                                               re-delivery is processed
--                                                               at most once.
--
-- Tables:
--   marketplace_orders         — the order state machine the delivery worker drives off.
--                                Two-party (buyer + seller): a deliberate departure from
--                                single-owner scoping (design §2) — queries filter on the
--                                relevant party; the table is never returned un-scoped.
--   marketplace_payment_events — append-only rail-event log; (rail, rail_event_id) dedupe.
--   creator_payout_accounts    — one payout destination per creator (Stripe Connect v1).
--   creator_payouts            — per-order payout records; (owner, client_token) idempotent.
--   marketplace_ledger         — double-entry (debit/credit) money log.
--   pack_entitlements          — the SINGLE table the unlock gate checks. A copy buyer's
--                                'copy_license' grant (or a 'title_owner' grant later) is
--                                the off-chain authority the gate honours (Risk R3): fiat
--                                buyers hold no on-chain token. UNIQUE(pack_id, holder_wallet,
--                                grant_kind) so the grant is upsert-idempotent.
--   pack_access_events         — preview/unlock/reveal audit + per-delivery watermark tag.
--
-- Owner-scoping: single-owner tables use owner_wallet / holder_wallet; the two-party
-- orders table stores both buyer_wallet + seller_wallet and is filtered per party in the
-- route layer. Server-internal tables (payment_events, ledger) are never returned un-scoped.
--
-- Deferred to later Part-B / Part-C chunks (intentionally NOT here): marketplace_title_holds
-- + the title ledgers (pack_titles, pack_title_transfers) — title is Slice 2, gated on the
-- devnet mint spike + securities-counsel sign-off (§00 B1/B7); and pmp_artifacts / pmp_devices
-- / pmp_imports / pmp_pairing_codes (desktop artifact subsystem).
--
-- Application to a real Postgres/Supabase database is a DEPLOY GATE, performed outside
-- this session — payments-migration.test.ts is the static proxy that this DDL is correct.
--
-- Safe: purely additive — seven new tables + their indexes, no change to any existing table.

BEGIN;

-- ─────────── Orders: the state machine delivery is driven off (M6) ───────────
-- amount/fee/payout use NUMERIC(20,8): exact, no float drift. The full status enum is
-- load-bearing — the worker walks paid → delivering → delivered → settled; a missing
-- intermediate state would mean a crash could strand a paid order with no resume path.
CREATE TABLE IF NOT EXISTS marketplace_orders (
  order_id TEXT PRIMARY KEY,                                -- hash-id like 'ord-XXXXXXXX'
  pack_id TEXT NOT NULL REFERENCES memory_packs(pack_id) ON DELETE RESTRICT,
  listing_id TEXT REFERENCES pack_listings(listing_id),
  listing_kind TEXT NOT NULL CHECK (listing_kind IN ('copy', 'title')),
  buyer_wallet TEXT,                                        -- nullable: keyless (email-only) buyers
  buyer_account_id TEXT,
  seller_wallet TEXT NOT NULL,
  rail TEXT NOT NULL CHECK (rail IN ('stripe', 'solana', 'base')),
  currency TEXT NOT NULL,
  amount NUMERIC(20, 8) NOT NULL,
  fee_amount NUMERIC(20, 8) NOT NULL DEFAULT 0,
  payout_amount NUMERIC(20, 8) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN (
      'created', 'awaiting_payment', 'paid', 'delivering', 'delivered',
      'settled', 'refunding', 'refunded', 'failed', 'expired'
    )),
  rail_ref TEXT,                                            -- e.g. Stripe PaymentIntent id
  rail_tx TEXT,                                             -- on-chain tx sig (crypto rails)
  client_token TEXT NOT NULL,                              -- caller-supplied idempotency key
  created_at TIMESTAMPTZ DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  metadata JSONB DEFAULT '{}'
);

-- A retried order intent (same buyer + client_token) collapses to one row — no double-charge.
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_idem
  ON marketplace_orders(buyer_wallet, client_token);
-- At most one order settled against a given on-chain tx (crypto rails).
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_rail_tx
  ON marketplace_orders(rail, rail_tx) WHERE rail_tx IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_seller
  ON marketplace_orders(seller_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_buyer
  ON marketplace_orders(buyer_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_rail_ref
  ON marketplace_orders(rail, rail_ref);
-- The sweeper/poller scans (status, expires_at) to revive stuck orders + expire stale intents.
CREATE INDEX IF NOT EXISTS idx_orders_status_expiry
  ON marketplace_orders(status, expires_at);

-- ─────────── Payment events: webhook replay guard (Risk R6) ───────────
-- Every rail callback lands here FIRST. The unique dedupe index makes a Stripe webhook
-- re-delivery a no-op (insert hits 23505 → handler returns 200 without re-processing).
-- The Stripe signature MUST be verified (stripe.webhooks.constructEvent) BEFORE this insert.
CREATE TABLE IF NOT EXISTS marketplace_payment_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT REFERENCES marketplace_orders(order_id) ON DELETE CASCADE,
  rail TEXT NOT NULL,
  kind TEXT NOT NULL,                                       -- rail event type, e.g. 'payment_intent.succeeded'
  rail_event_id TEXT,                                      -- e.g. Stripe event 'evt_...' id
  prev_status TEXT,
  new_status TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pay_events_dedup
  ON marketplace_payment_events(rail, rail_event_id) WHERE rail_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pay_events_order
  ON marketplace_payment_events(order_id, created_at DESC);

-- ─────────── Creator payout destination (one per creator) ───────────
CREATE TABLE IF NOT EXISTS creator_payout_accounts (
  account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_wallet TEXT NOT NULL UNIQUE,
  payout_rail TEXT NOT NULL CHECK (payout_rail IN ('stripe_connect', 'solana', 'base')),
  stripe_connect_id TEXT,
  crypto_address TEXT,
  payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────── Creator payouts (idempotent per owner + client_token) ───────────
CREATE TABLE IF NOT EXISTS creator_payouts (
  payout_id TEXT PRIMARY KEY,                              -- hash-id like 'pyt-XXXXXXXX'
  owner_wallet TEXT NOT NULL,
  order_id TEXT REFERENCES marketplace_orders(order_id),
  amount NUMERIC(20, 8) NOT NULL,
  currency TEXT NOT NULL,
  payout_rail TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'paid', 'failed')),
  rail_payout_ref TEXT,
  client_token TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  UNIQUE (owner_wallet, client_token)
);

CREATE INDEX IF NOT EXISTS idx_creator_payouts_owner
  ON creator_payouts(owner_wallet, created_at DESC);

-- ─────────── Double-entry money ledger ───────────
CREATE TABLE IF NOT EXISTS marketplace_ledger (
  entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT,
  account TEXT NOT NULL,                                    -- logical account, e.g. 'platform_fee', 'creator:<wallet>'
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount NUMERIC(20, 8) NOT NULL,
  currency TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_ledger_order
  ON marketplace_ledger(order_id, created_at);

-- ─────────── Entitlements: the SINGLE table the unlock gate checks ───────────
-- Both modes resolve here. A copy buyer gets grant_kind='copy_license'; the future
-- title owner gets 'title_owner'. The gate reads ONLY this table for copy unlocks and
-- never touches the chain (Risk R3: fiat buyers hold no token). UNIQUE(pack_id,
-- holder_wallet, grant_kind) makes the grant upsert-idempotent — the delivery worker can
-- re-run safely. A refund/chargeback flips status to 'refunded' (copy clawback, §00 M10).
CREATE TABLE IF NOT EXISTS pack_entitlements (
  id BIGSERIAL PRIMARY KEY,
  pack_id TEXT NOT NULL REFERENCES memory_packs(pack_id) ON DELETE CASCADE,
  holder_wallet TEXT NOT NULL,
  grant_kind TEXT NOT NULL CHECK (grant_kind IN ('copy_license', 'title_owner')),
  order_id TEXT,
  payment_rail TEXT CHECK (payment_rail IN ('clude_solana', 'clude_base', 'stripe')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'refunded')),
  delivered_copy BOOLEAN DEFAULT FALSE,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (pack_id, holder_wallet, grant_kind)
);

CREATE INDEX IF NOT EXISTS idx_pack_entitlements_holder
  ON pack_entitlements(holder_wallet) WHERE status = 'active';

-- ─────────── Access audit + watermark trail ───────────
CREATE TABLE IF NOT EXISTS pack_access_events (
  id BIGSERIAL PRIMARY KEY,
  pack_id TEXT NOT NULL,
  holder_wallet TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('preview', 'unlock', 'reveal')),
  watermark_tag TEXT,
  ip_hash TEXT,                                             -- hashed, never raw IP (no PII in logs)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pack_access_pack
  ON pack_access_events(pack_id, created_at);

COMMIT;
