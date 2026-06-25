-- 038_title_transfers_unique.sql
-- Back the title_transfers audit idempotency with a real UNIQUE index (Phase 3 backtest finding).
--
-- recordTransfer (title-saga.ts for Base, solana-title-sale.ts for Solana) records one audit row per
-- on-chain ownerOf change and relies on a (pack_id, to_wallet) prior-row check PLUS a `23505`-tolerant
-- insert for idempotency. But 035 gave title_transfers only a BIGSERIAL PK — there was NO unique
-- constraint, so the `23505` path could never fire and two concurrent recorders (or two resumes) could
-- both insert → duplicate audit rows. This adds the missing constraint.
--
-- KEY CHOICE — (pack_id, to_wallet, tx), not (pack_id, to_wallet): a wallet can legitimately buy a pack
-- title, sell it, and re-buy it later — a SECOND transfer to the same wallet for the same pack, with a
-- DIFFERENT tx. Keying on the tx signature dedupes the SAME transfer recorded twice (the idempotency
-- case, incl. the '(reconciled)' sentinel under one resume) while allowing a genuine re-buy. Shared by
-- the Base + Solana sagas (same table), so both gain the backstop.
--
-- Safe: title_transfers is empty until the title feature ships, so the index creates with no dup risk.
-- Application is the DEPLOY GATE; 038_title_transfers_unique.test.ts is the static proxy that this is correct.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_title_transfers_pack_to_tx
  ON title_transfers(pack_id, to_wallet, tx);

COMMIT;
