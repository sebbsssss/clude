-- 036_dek_wraps_additive_title_holder.sql
-- Widen memory_dek_wraps so a pack TITLE can carry the OUTGOING (seller) and INCOMING (buyer)
-- title_holder DEK wraps SIMULTANEOUSLY during a sale.
--
-- WHY: the binding law RT7 is additive-first / revoke-last — ADD the buyer's title_holder wrap,
-- perform the irreversible on-chain transfer, THEN remove the seller's wrap, so there is never a
-- window where neither party can decrypt. The 021 primary key (memory_id, recipient) allows only ONE
-- 'title_holder' row per memory, so the buyer INSERT collides on the seller's existing row and is
-- silently dropped (23502/23505) — after the transfer + the seller-revoke, ZERO title_holder wraps
-- remain and the paid buyer who owns the NFT can never decrypt (the RT7 catastrophe the title-saga
-- adversarial backtest flagged as CRITICAL). Replace the PK with a HOLDER-AWARE unique index so:
--   - exactly one ('owner', NULL) and one ('provider', NULL) per memory (NULLS NOT DISTINCT collapses
--     the NULL holder rows to one each), and
--   - one ('title_holder', <holder_wallet>) per (memory, holder) — the seller and buyer coexist.
--
-- SAFETY / blast radius: the owner/provider write paths use a PLAIN INSERT (no ON CONFLICT on the PK
-- — memory.ts, grant-copy.ts, database.ts), so dropping the PK does not affect them; the new unique
-- still enforces one owner + one provider per memory. The ONLY (memory_id, recipient) conflict target
-- in code is the title rewrap (title-dek.ts), updated in the same change to
-- (memory_id, recipient, holder_wallet). No rows are rewritten.
--
-- Requires Postgres 15+ for NULLS NOT DISTINCT (Supabase is 15+). DB-apply is the deploy gate.

BEGIN;

-- Drop the legacy two-column PK; its uniqueness is re-established holder-aware below.
ALTER TABLE memory_dek_wraps DROP CONSTRAINT IF EXISTS memory_dek_wraps_pkey;

-- Holder-aware uniqueness. NULLS NOT DISTINCT treats the NULL holder of owner/provider rows as equal,
-- so each memory still gets exactly one owner + one provider wrap, while distinct title_holder
-- holders (seller, buyer) coexist on the same memory during a sale.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dek_wraps_identity
  ON memory_dek_wraps (memory_id, recipient, holder_wallet) NULLS NOT DISTINCT;

COMMIT;
