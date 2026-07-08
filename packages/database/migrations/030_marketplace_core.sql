-- 030_marketplace_core.sql
-- Memory Pack Marketplace — Slice 1, Part A: listings core.
--
-- Adds the listing subsystem for the COPY-license marketplace (one-to-many license,
-- no chain, no money in this slice). A creator tokenises a knowledge/agent pack, then
-- creates a draft listing here; publish flips status to 'listed' ONLY after the
-- compliance gate passes (see 031_compliance.sql + compliance-gate.ts).
--
-- Tables:
--   pack_listings         — one listing per pack (uq_pack_listings_active_pack enforces
--                           a single non-terminal listing per pack). seller-scoped.
--   pack_listing_prices   — per-rail price rows (copy-license rails only in Part A).
--   pack_listing_samples  — which leaf indices are exposed in the sealed-safe preview.
--   pack_listing_events   — append-only audit of listing lifecycle transitions.
--   pack_reviews          — verified-purchase ratings (schema ships now; endpoints gated to later).
--
-- Deferred to Part B/C (intentionally NOT here): payments (marketplace_orders,
-- marketplace_payment_events, marketplace_title_holds, creator_payout_accounts,
-- creator_payouts, marketplace_ledger), title/access ledgers, and pmp_artifacts/devices.
--
-- Safe: purely additive — five new tables + their indexes, no change to any existing table.

BEGIN;

-- ─────────── Marketplace listings ───────────
-- content_category is denormalised from memory_packs.content_category at publish time so
-- browse/filter can read it without a join. The trusted source remains memory_packs
-- (server-set from the attestation); the client never sets it.
CREATE TABLE IF NOT EXISTS pack_listings (
  listing_id TEXT PRIMARY KEY,                              -- hash-id like 'lst-XXXXXXXX'
  pack_id TEXT NOT NULL REFERENCES memory_packs(pack_id) ON DELETE RESTRICT,
  seller_wallet TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  content_category TEXT NOT NULL CHECK (content_category IN ('personal', 'knowledge', 'agent')),
  license_type TEXT NOT NULL CHECK (license_type IN ('copy', 'title')),
  supply_kind TEXT NOT NULL CHECK (supply_kind IN ('unlimited', 'limited', 'single')),
  supply_total INTEGER,
  supply_sold INTEGER NOT NULL DEFAULT 0,
  preview_sample_count INTEGER NOT NULL DEFAULT 1,
  preview_redaction TEXT NOT NULL DEFAULT 'none'
    CHECK (preview_redaction IN ('none', 'mask_entities', 'summary_only')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_compliance', 'listed', 'sold_out', 'delisted', 'suspended', 'sold')),
  compliance_gate TEXT NOT NULL DEFAULT 'blocked'
    CHECK (compliance_gate IN ('blocked', 'passed')),
  disclaimer_doc_id TEXT,
  disclaimer_version INTEGER,
  listed_at TIMESTAMPTZ,
  delisted_at TIMESTAMPTZ,
  view_count INTEGER NOT NULL DEFAULT 0,
  rating_avg NUMERIC(3, 2),
  rating_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pack_listings_seller
  ON pack_listings(seller_wallet);
CREATE INDEX IF NOT EXISTS idx_pack_listings_status
  ON pack_listings(status) WHERE status = 'listed';
-- At most ONE non-terminal listing per pack. publish/create rely on this unique violation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pack_listings_active_pack
  ON pack_listings(pack_id)
  WHERE status IN ('draft', 'pending_compliance', 'listed', 'sold_out');

-- ─────────── Per-rail prices ───────────
CREATE TABLE IF NOT EXISTS pack_listing_prices (
  listing_id TEXT NOT NULL REFERENCES pack_listings(listing_id) ON DELETE CASCADE,
  rail TEXT NOT NULL CHECK (rail IN ('clude_solana', 'clude_base', 'stripe')),
  amount NUMERIC(38, 0) NOT NULL,                          -- integer minor units (lamports / cents / wei)
  currency TEXT NOT NULL,
  decimals SMALLINT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (listing_id, rail)
);

-- ─────────── Preview sample leaves ───────────
CREATE TABLE IF NOT EXISTS pack_listing_samples (
  listing_id TEXT NOT NULL REFERENCES pack_listings(listing_id) ON DELETE CASCADE,
  leaf_index INTEGER NOT NULL,
  PRIMARY KEY (listing_id, leaf_index)
);

-- ─────────── Listing lifecycle audit ───────────
CREATE TABLE IF NOT EXISTS pack_listing_events (
  event_id BIGSERIAL PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES pack_listings(listing_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_wallet TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pack_listing_events_listing
  ON pack_listing_events(listing_id, created_at DESC);

-- ─────────── Reviews (schema ships v1, endpoints gated to later) ───────────
-- verified_purchase guards against wash-trading: only buyers with an entitlement
-- (Part B) may leave a verified rating.
CREATE TABLE IF NOT EXISTS pack_reviews (
  review_id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES pack_listings(listing_id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL,
  reviewer_wallet TEXT NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT,
  verified_purchase BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (listing_id, reviewer_wallet)
);

COMMIT;
