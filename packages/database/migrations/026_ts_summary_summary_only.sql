-- 026: ts_summary summary-only repurpose (encryption §9, deferred from migration 022 step 5).
-- The old ts_summary expression referenced both summary AND content. After encryption
-- activation, revoke sets summary='' but leaves content as ciphertext — so the combined
-- ts_summary would continue to hold *content-derived* lexemes after revoke, BM25-searchable
-- as ciphertext lexemes (small but real privacy leak). Repurpose to summary-only so it
-- auto-empties when summary='' is set.
--
-- Postgres does not permit ALTER GENERATED expression, so this is DROP + ADD.
-- The new expression matches what packages/database/supabase-schema.sql + initDatabase
-- already declare (declarative state — this migration brings live state into sync).
--
-- ────────────────────────────────────────────────────────────────────────────────
-- IMPORTANT LOCKING NOTE — read before applying:
--   • DROP COLUMN ts_summary  — metadata-only, fast (also cascades-drops the GIN index
--                                idx_memories_ts_summary)
--   • ADD COLUMN ... GENERATED ALWAYS AS ... STORED — REWRITES EVERY ROW (the expensive
--                                step) and holds ACCESS EXCLUSIVE for the duration.
--                                On ~600K rows: realistically 2–5 minutes.
--   • CREATE INDEX (non-CONCURRENTLY) inside a transaction holds ACCESS EXCLUSIVE for
--                                another 30–60s.
--
-- We SPLIT into two phases to minimise lock time:
--   PHASE 1 — row-rewriting transaction below (writes blocked ~2–5 min; schedule a window)
--   PHASE 2 — CREATE INDEX CONCURRENTLY in a SEPARATE connection AFTER COMMIT (non-blocking
--             writes, but BM25 lookups against ts_summary degrade to seq-scan until VALID)
--
-- BOTH PHASES MUST RUN IN THE SAME MAINTENANCE WINDOW — between Phase 1 COMMIT and
-- Phase 2 VALID, BM25 recall p95 against ts_summary degrades from ~10ms to seconds.
-- Pre-load Phase 2 SQL in a separate psql Session pooler session BEFORE starting Phase 1.
--
-- Direct psql via the Session pooler is required for Phase 2's CONCURRENTLY
-- (transaction pooler mode rejects it). Connection string:
--   aws-1-ap-southeast-2.pooler.supabase.com:5432
--   user postgres.<project-ref>
-- ────────────────────────────────────────────────────────────────────────────────

BEGIN;
  ALTER TABLE memories DROP COLUMN ts_summary;  -- also drops idx_memories_ts_summary
  ALTER TABLE memories ADD  COLUMN ts_summary tsvector
    GENERATED ALWAYS AS (setweight(to_tsvector('english', COALESCE(summary, '')), 'A')) STORED;
COMMIT;

-- ────────────────────────────────────────────────────────────────────────────────
-- PHASE 2 — run in a SEPARATE psql Session-pooler connection, NOT inside a transaction:
--
--   SET statement_timeout = 0;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memories_ts_summary
--     ON memories USING GIN (ts_summary);
--
-- Then verify validity:
--   SELECT indexrelid::regclass, indisvalid
--   FROM pg_index
--   WHERE indrelid = 'memories'::regclass
--     AND indexrelid::regclass::text LIKE '%ts_summary%';
--
-- Expected: indisvalid = true. If false → DROP and rebuild (still CONCURRENTLY).
-- ────────────────────────────────────────────────────────────────────────────────
