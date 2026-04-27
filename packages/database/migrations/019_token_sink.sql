-- Token sink subsystem (v0).
--
-- Backs the auto-swap mechanic: every dollar of revenue routes through
-- a hot wallet, swaps USDC → $CLUDE on Jupiter, and sends to a treasury
-- multisig. Three additive tables. No FK to existing tables, so
-- existing inserts cannot break.

-- Idempotency for incoming webhook / direct-USDC events.
CREATE TABLE IF NOT EXISTS sink_events (
  id TEXT PRIMARY KEY,                 -- external event id (Stripe evt_*, Solana tx sig, etc.)
  source TEXT NOT NULL,                -- 'stripe' | 'direct_usdc' | 'overflow' | 'anchor' | 'marketplace'
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Current tier per identity. Identity is either an email (Stripe) or
-- a Solana wallet (direct USDC).
CREATE TABLE IF NOT EXISTS user_tiers (
  id BIGSERIAL PRIMARY KEY,
  identity_kind TEXT NOT NULL CHECK (identity_kind IN ('email', 'wallet')),
  identity_value TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('free', 'personal', 'pro')),
  source TEXT NOT NULL,                -- 'stripe' | 'direct_usdc' | 'comped'
  external_id TEXT,                    -- Stripe sub id or USDC tx sig
  active_until TIMESTAMPTZ,            -- null = active until cancelled
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (identity_kind, identity_value)
);
-- No NOW() in the predicate — Postgres requires IMMUTABLE functions
-- in partial-index predicates. The composite index covers the
-- "active tier" lookup well enough; the optimizer adds a runtime
-- filter on active_until at query time.
CREATE INDEX IF NOT EXISTS idx_user_tiers_active ON user_tiers(tier, active_until);

-- Audit log of every USDC → $CLUDE swap. Source of truth for the
-- public treasury dashboard.
CREATE TABLE IF NOT EXISTS sink_ledger (
  id BIGSERIAL PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'swapping', 'completed', 'failed', 'skipped')),
  source TEXT NOT NULL,                -- matches sink_events.source
  source_ref TEXT,                     -- subscription id, tx sig, etc.
  usdc_in_micro BIGINT NOT NULL,       -- 6-dec USDC, intended swap input
  usdc_swapped_micro BIGINT,           -- actual amount swapped
  clude_out_lamports BIGINT,           -- received $CLUDE (6 dec)
  jupiter_route JSONB,                 -- the quote response
  realised_slippage_bps INT,
  swap_tx_sig TEXT,                    -- USDC→CLUDE swap tx
  treasury_transfer_tx_sig TEXT,       -- CLUDE → treasury transfer tx
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  swapped_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sink_ledger_status_created
  ON sink_ledger(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sink_ledger_completed_swapped_at
  ON sink_ledger(swapped_at DESC) WHERE status = 'completed';
