-- 037_solana_title.sql
-- Solana-native pack TITLE support — the ownership-chain PIVOT (2026-06-24).
--
-- The pack title is now a 1-of-1 *Solana* SPL NFT held NON-CUSTODIALLY in the user's own
-- wallet (supply 1, decimals 0, mint authority revoked), minted by a dedicated authority
-- (solana-title-mint.ts, devnet-verified). Base becomes an OPT-IN PORT, not the default —
-- so pack_titles, built Base-only in 035, must mirror EITHER chain. This migration makes the
-- single pack_titles mirror chain-polymorphic. It is purely additive: no table is created and
-- no existing Base row is touched (Base rows keep token_id + contract_address NOT-set-to-null).
--
-- The on-chain holder is STILL the source of truth on both chains (the unlock gate reads the
-- live holder and fails closed); pack_titles stays a cache / reconciliation index. A Solana row
-- caches the SPL mint in mint_address (the analog of Base's token_id + contract_address) and the
-- current SPL holder (base58) in current_owner.
--
-- Changes to pack_titles:
--   1. + mint_address TEXT          — the SPL mint = the Solana title's on-chain id. NULL on Base rows.
--   2. token_id / contract_address  — DROP NOT NULL: they are Base-only (a Solana row has neither).
--   3. chain CHECK widened          — add 'solana-devnet' (testnet-first) + 'solana' (mainnet, SEC-gated),
--                                     mirroring the existing 'base-sepolia' / 'base' testnet/mainnet split.
--   4. + a per-chain well-formedness CHECK — a Base row MUST carry token_id + contract_address; a Solana
--                                     row MUST carry mint_address. Neither chain can persist a half-row.
--   5. + idx on mint_address        — the Solana ownership reconciliation lookup (the Base path uses
--                                     idx_pack_titles_owner / idx_pack_titles_status from 035).
--
-- TESTNET-first: a Solana title defaults to 'solana-devnet'; the 'solana' (mainnet) flip is gated on the
-- SAME SEC-1 securities call as 'base' (ALLOW_SOLANA_MAINNET_TITLES, enforced in solana-title-mint.ts).
--
-- Application to a real Postgres/Supabase database is a DEPLOY GATE, performed outside this session —
-- 037_solana_title.test.ts is the static proxy that this DDL is correct (mirrors 035's test).
--
-- Safe: purely additive (one column, two NOT-NULL relaxations, two CHECK widenings, one index) — no
-- data migration, no change to any other table.

BEGIN;

-- 1) mint_address: the SPL mint (the Solana title's on-chain id). NULL on Base rows.
ALTER TABLE pack_titles ADD COLUMN IF NOT EXISTS mint_address TEXT;

-- 2) token_id + contract_address are Base-only — relax NOT NULL so a Solana row can omit them.
--    (Idempotent: DROP NOT NULL on an already-nullable column is a no-op, not an error.)
ALTER TABLE pack_titles ALTER COLUMN token_id DROP NOT NULL;
ALTER TABLE pack_titles ALTER COLUMN contract_address DROP NOT NULL;

-- 3) Widen the chain CHECK to the Solana set. The 035 inline CHECK is auto-named
--    pack_titles_chain_check; drop it (idempotent) and re-add the widened set, guarded so a re-run
--    that already has the widened constraint is a no-op (034 DO-block / pg_constraint house style).
ALTER TABLE pack_titles DROP CONSTRAINT IF EXISTS pack_titles_chain_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pack_titles_chain_check') THEN
    ALTER TABLE pack_titles ADD CONSTRAINT pack_titles_chain_check
      CHECK (chain IN ('base-sepolia', 'base', 'solana-devnet', 'solana'));
  END IF;
END $$;

-- 4) Per-chain well-formedness: a Base row carries token_id + contract_address; a Solana row carries
--    mint_address. Prevents a half-formed row on either chain (e.g. a Solana row with no mint).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pack_titles_chain_identity_chk') THEN
    ALTER TABLE pack_titles ADD CONSTRAINT pack_titles_chain_identity_chk
      CHECK (
        (chain IN ('base-sepolia', 'base') AND token_id IS NOT NULL AND contract_address IS NOT NULL)
        OR (chain IN ('solana-devnet', 'solana') AND mint_address IS NOT NULL)
      );
  END IF;
END $$;

-- 5) Fast lookup by SPL mint for the Solana ownership reconciliation path.
CREATE INDEX IF NOT EXISTS idx_pack_titles_mint_address
  ON pack_titles(mint_address);

COMMIT;
