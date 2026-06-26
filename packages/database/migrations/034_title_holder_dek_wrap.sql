-- ============================================================================
-- 034_title_holder_dek_wrap.sql — RT2 fix for the Base pack-title saga
--
-- A COPY-license sale CLONES the pack's memories and wraps the DEK to the buyer
-- as a new 'owner' (grant-copy.ts). A TITLE sale does NOT clone — the SAME pack
-- changes hands on Base — so the CURRENT title holder needs a DEK wrap on the
-- ORIGINAL memories, and that wrap must ROTATE when the title transfers.
--
-- memory_dek_wraps.recipient was effectively 'owner' | 'provider' with
-- PRIMARY KEY (memory_id, recipient). This adds:
--   - a 'title_holder' recipient (exactly one per memory, rotated on transfer), and
--   - holder_wallet, naming WHICH wallet the title-holder wrap is for, so the
--     unlock gate can require ownerOf(tokenId) == that wallet before serving the DEK.
--
-- Idempotent + additive: no existing row is touched (owner/provider wraps keep
-- holder_wallet NULL). Re-runnable. DB-apply is the deploy gate.
-- ============================================================================
BEGIN;

ALTER TABLE memory_dek_wraps
  ADD COLUMN IF NOT EXISTS holder_wallet TEXT;

-- recipient was free TEXT ('owner' | 'provider'); pin the allowed set now that
-- 'title_holder' joins it. Existing owner/provider rows already satisfy this.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memory_dek_wraps_recipient_chk') THEN
    ALTER TABLE memory_dek_wraps
      ADD CONSTRAINT memory_dek_wraps_recipient_chk
      CHECK (recipient IN ('owner', 'provider', 'title_holder'));
  END IF;
END $$;

-- A title-holder wrap MUST name its holder; owner/provider wraps MUST NOT. Both
-- existing recipient kinds satisfy this (recipient<>'title_holder' AND holder NULL).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memory_dek_wraps_holder_chk') THEN
    ALTER TABLE memory_dek_wraps
      ADD CONSTRAINT memory_dek_wraps_holder_chk
      CHECK ((recipient = 'title_holder') = (holder_wallet IS NOT NULL));
  END IF;
END $$;

-- Look up the current title-holder wrap by wallet (for the unlock gate).
CREATE INDEX IF NOT EXISTS idx_dek_wraps_title_holder
  ON memory_dek_wraps(holder_wallet)
  WHERE recipient = 'title_holder';

COMMIT;
