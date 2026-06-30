-- 039_pmp_artifacts_encryption_scope_owner.sql
-- Widen pmp_artifacts.encryption_scope to the values the code ACTUALLY writes.
--
-- 033_pmp_artifacts.sql declared:
--     encryption_scope TEXT CHECK (encryption_scope IN ('none','records','records+blobs')) DEFAULT 'none'
-- but the live code never writes 'records'/'records+blobs'. It writes:
--   • 'owner' — the owner-sealed ENCRYPTED export (apps/server/src/routes/pmp-artifacts.routes.ts)
--   • 'pack'  — the title snapshot (apps/server/src/lib/payments/snapshot-pack-for-title-solana.ts)
--   • 'none'  — the plaintext path (both)
--
-- So every ENCRYPTED export's INSERT failed the CHECK (SQLSTATE 23514 check_violation) and the route
-- returned 500 export_failed. It was never caught: unit tests mock the DB (no real CHECK), and every
-- prod/preview verification was unauthenticated and stopped at the auth middleware, never reaching the
-- INSERT. The first real authenticated encrypted export on prod hit it head-on.
--
-- This migration only WIDENS the allowed set (keeps the original three for forward-compat), so it is
-- non-destructive: every existing row holds a value from the old set, all of which remain valid, and
-- the re-validating ADD CONSTRAINT passes. NULL stays allowed (the column is nullable; CHECK passes on
-- NULL). Idempotent: DROP ... IF EXISTS then ADD by the canonical inline-CHECK name.

BEGIN;

ALTER TABLE pmp_artifacts DROP CONSTRAINT IF EXISTS pmp_artifacts_encryption_scope_check;

ALTER TABLE pmp_artifacts ADD CONSTRAINT pmp_artifacts_encryption_scope_check
  CHECK (encryption_scope IN ('none', 'owner', 'pack', 'records', 'records+blobs'));

COMMIT;
