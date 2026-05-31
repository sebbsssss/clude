-- 027: backfill provider_delegated for plaintext rows wrongly marked revoked.
--
-- ROOT CAUSE: storeMemory wrote `provider_delegated: envelope !== null`, which evaluates
-- to FALSE for every plaintext write while encryption is dormant (envelope is always null).
-- The recall filter `.not('provider_delegated','is',false)` treats FALSE as "revoked → exclude",
-- so those rows were silently hidden from recall. The code fix (delegationStateForWrite) writes
-- null for plaintext / true for envelope going forward; this migration heals existing rows.
--
-- SAFETY: revoke only ever acts on encrypted rows (the revoke RPC requires encrypted=true).
-- The `encrypted IS NOT TRUE` guard means we only touch never-encrypted rows — so we cannot
-- accidentally un-revoke a legitimately revoked (encrypted) memory. At the time of writing
-- prod has zero encrypted rows, so every provider_delegated=false row is the bug.
--
-- Sets to NULL (not TRUE) to match the post-fix plaintext write path: plaintext has no
-- delegation model. NULL and TRUE are both included by the recall filter (only FALSE excludes).

UPDATE memories
SET provider_delegated = NULL
WHERE provider_delegated = false
  AND encrypted IS NOT TRUE;

-- Verify: should return 0 after the update.
-- SELECT COUNT(*) FROM memories WHERE provider_delegated = false AND encrypted IS NOT TRUE;
