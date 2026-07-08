-- 035_title_mirror.sql
-- Base pack-TITLE trading saga — Phase 1 (the core): on-chain title mirror + saga state.
--
-- The TITLE rail (Memory Pack Marketplace, Slice 2). A 1-of-1 ERC-721 title for a pack
-- lives on Base (contract CludePackTitle, LIVE on Base Sepolia). Unlike a COPY-license
-- sale, a TITLE sale does NOT clone the pack — the SAME pack changes hands on-chain, the
-- DEK wrap rotates to the buyer (memory_dek_wraps title_holder, migration 034), and the
-- on-chain title moves seller → buyer. This migration adds the three off-chain tables that
-- mirror + drive that flow. It does NOT touch the chain or the file format.
--
-- TESTNET-first: chain defaults to 'base-sepolia'; a 'base' (mainnet) flip is gated on the
-- SEC-1 securities call (a config flag, not this build).
--
-- Tables:
--   pack_titles       — a MIRROR / cache-index of on-chain ownerOf. The on-chain ownerOf
--                       is the SOURCE OF TRUTH; this row is a fast-path for gating + a
--                       reconciliation index. current_owner caches ownerOf (lowercased EVM
--                       addr, NULL until minted). token_id is the uint256 stored as a DECIMAL
--                       STRING (TEXT) — a uint256 overflows BIGINT. status walks
--                       pending_mint → minted → transferring → transferred.
--                       NOTE (B2/RT9): the unlock gate reads ownerOf LIVE and FAILS CLOSED on
--                       an RPC error — it NEVER trusts this cache as the authority.
--   title_sale_sagas  — the FORWARD-ONLY, resumable saga state for a title sale (M4/RT1/RT3).
--                       This sale does NOT fit delivery-dispatcher's single deliver() callback
--                       (RT1), so it gets its OWN persisted step machine. step encodes the M4
--                       ordering — the IRREVERSIBLE on-chain move is LAST:
--                         created → dek_rewrapped → paid → transferred → revoked
--                       ((1) additively re-wrap the pack DEK to the buyer, (2) capture payment,
--                       (3) on-chain transfer seller → buyer, (4) revoke the seller wrap),
--                       plus terminal 'refunded' / 'failed' branches. Each step is idempotent +
--                       resumable. order_id is UNIQUE + FK so a retried sale collapses to one saga.
--                       RT3 (the refund boundary): a refund is IMPOSSIBLE once the title moved
--                       on-chain — you cannot claw back the buyer's NFT. A refund is therefore
--                       legal ONLY while step is strictly BEFORE 'transferred'; after that the
--                       sale is FINAL. That boundary is queryable off `step` (idx below).
--   title_transfers   — append-only audit: one row per on-chain ownerOf change (mint counts as
--                       from NULL). The durable substrate for reconciliation against the chain.
--
-- Owner-scoping: pack_titles is single-owner via current_owner / creator_wallet; the two-party
-- saga stores both seller_wallet + buyer_wallet (mirrors marketplace_orders, design §2) and is
-- filtered per party in the route layer. title_transfers is an internal audit, never returned
-- un-scoped. The route layer scopes all reads via the requireOwnership pattern (req.verifiedWallet
-- only — a client-supplied ?owner is NEVER trusted).
--
-- Application to a real Postgres/Supabase database is a DEPLOY GATE, performed outside this
-- session — title-mirror-migration.test.ts is the static proxy that this DDL is correct.
--
-- Safe: purely additive — three new tables + their indexes, no change to any existing table.

BEGIN;

-- ─────────── PACK TITLES: the on-chain ownerOf MIRROR (cache / reconciliation index) ───────────
-- A cache of the contract's truth, NOT the authority. ownerOf(tokenId) on Base is canonical;
-- current_owner is the last-synced copy, used only for fast gating + drift reconciliation.
-- token_id is the contract's uint256 (= keccak256("clude-pmp-title:v1:"+packId)) as a decimal
-- string. current_owner is the lowercased EVM address, NULL until the title is minted.
CREATE TABLE IF NOT EXISTS pack_titles (
  pack_id TEXT PRIMARY KEY REFERENCES memory_packs(pack_id) ON DELETE RESTRICT,
  token_id TEXT NOT NULL,                                   -- the uint256 as a decimal string (overflows BIGINT)
  contract_address TEXT NOT NULL,                          -- CludePackTitle address (lowercased)
  chain TEXT NOT NULL DEFAULT 'base-sepolia'
    CHECK (chain IN ('base-sepolia', 'base')),             -- testnet first; 'base' gated on SEC-1
  current_owner TEXT,                                      -- cached ownerOf, lowercased EVM addr; NULL until minted
  creator_wallet TEXT NOT NULL,                            -- the wallet the title was first minted to
  mint_tx TEXT,                                            -- mint transaction hash
  mint_block BIGINT,                                       -- block height of the mint
  last_synced_block BIGINT,                                -- highest block reconciled against the chain
  status TEXT NOT NULL DEFAULT 'pending_mint'
    CHECK (status IN ('pending_mint', 'minted', 'transferring', 'transferred')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast owner → title lookup for the unlock gate's reconciliation path (the gate still reads
-- ownerOf LIVE and fails closed; this index serves drift detection + management views).
CREATE INDEX IF NOT EXISTS idx_pack_titles_owner
  ON pack_titles(current_owner);
-- The reconciliation worker scans (status) to find titles mid-mint / mid-transfer to re-sync.
CREATE INDEX IF NOT EXISTS idx_pack_titles_status
  ON pack_titles(status);

-- ─────────── TITLE SALE SAGAS: the forward-only, resumable saga state (M4 / RT1 / RT3) ───────────
-- One saga per title-sale order. step is the persisted progress of the M4-ordered flow whose
-- LAST irreversible act is the on-chain transfer. Each step is idempotent + resumable + 429-safe:
-- the resumer reads `step`, re-derives the next action, and retries forward only — it NEVER walks
-- backward past 'transferred'. last_error captures the most recent failure for observability /
-- the 'failed' terminal. order_id UNIQUE + FK collapses a retried sale to a single saga (RT1).
CREATE TABLE IF NOT EXISTS title_sale_sagas (
  saga_id TEXT PRIMARY KEY,                                 -- hash-id like 'tsaga-XXXXXXXX'
  order_id TEXT NOT NULL UNIQUE REFERENCES marketplace_orders(order_id) ON DELETE RESTRICT,
  pack_id TEXT NOT NULL,
  seller_wallet TEXT NOT NULL,
  buyer_wallet TEXT NOT NULL,
  -- step values, in M4 order:
  --   'created'       — saga opened, nothing irreversible done
  --   'dek_rewrapped' — (1) pack DEK additively re-wrapped to the buyer (additive-first, RT7)
  --   'paid'          — (2) payment captured
  --   'transferred'   — (3) on-chain title moved seller → buyer (IRREVERSIBLE — the RT3 boundary)
  --   'revoked'       — (4) seller DEK wrap revoked (revoke-last, RT7) — sale complete
  --   'refunded'      — terminal: refund issued (only legal BEFORE the transfer, i.e. step IN
  --                     ('created','dek_rewrapped','paid') — RT3. Enforced by set-membership in
  --                     title-saga.ts (isStepBefore), NOT a lexicographic `step < 'transferred'`.)
  --   'failed'        — terminal: saga abandoned after exhausting retries
  step TEXT NOT NULL DEFAULT 'created'
    CHECK (step IN ('created', 'dek_rewrapped', 'paid', 'transferred', 'revoked', 'refunded', 'failed')),
  transfer_tx TEXT,                                         -- the on-chain transfer tx hash (set at step 'transferred')
  last_error TEXT,                                          -- most recent step failure, for resume/observability
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The resumer scans in-flight sagas by step; the refund path asserts step is strictly BEFORE
-- 'transferred' (the RT3 finality boundary) without a table scan.
CREATE INDEX IF NOT EXISTS idx_title_sale_sagas_step
  ON title_sale_sagas(step);
-- Per-pack saga history (a pack can be resold many times — one saga per sale).
CREATE INDEX IF NOT EXISTS idx_title_sale_sagas_pack
  ON title_sale_sagas(pack_id, created_at DESC);

-- ─────────── TITLE TRANSFERS: append-only on-chain ownerOf-change audit ───────────
-- One row per confirmed on-chain ownership change (a mint is recorded with from_wallet NULL).
-- This is the durable trail the reconciliation worker diffs against ownerOf, and the provenance
-- chain surfaced in the UI. Append only; from_wallet/to_wallet are lowercased EVM addresses.
CREATE TABLE IF NOT EXISTS title_transfers (
  transfer_id BIGSERIAL PRIMARY KEY,
  pack_id TEXT NOT NULL,
  token_id TEXT NOT NULL,                                   -- the uint256 as a decimal string
  from_wallet TEXT,                                         -- NULL for a mint
  to_wallet TEXT NOT NULL,
  tx TEXT NOT NULL,                                         -- on-chain tx hash
  block BIGINT,                                             -- block height of the transfer
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-title transfer history, newest first.
CREATE INDEX IF NOT EXISTS idx_title_transfers_pack
  ON title_transfers(pack_id, at DESC);

COMMIT;
