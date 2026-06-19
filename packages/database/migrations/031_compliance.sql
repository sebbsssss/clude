-- 031_compliance.sql
-- Memory Pack Marketplace — Slice 1, Part A: compliance + safety foundation.
--
-- The greenfield compliance primitive (none existed before — design §0 C3). Records
-- ToS/disclaimer documents and acceptances, creator attestations, and per-pack
-- moderation (content-filter findings, REDACTED). The compliance gate (compliance-gate.ts)
-- reads memory_packs.content_category + the attestation booleans + moderation status to
-- decide whether a listing may publish.
--
-- Tables:
--   legal_documents    — versioned ToS / disclaimer bodies (body_hash for tamper-evidence).
--   legal_acceptances  — append-only acceptance log w/ ip + user agent for the audit trail.
--   pack_attestations  — creator's signed claims; content_source is the ONLY trusted source
--                        of content_category (own_personal→personal, curated_knowledge→knowledge,
--                        agent_memory→agent). attestation_hash binds the pack's merkle_root.
--   pack_moderation    — content-filter result per pack; findings JSONB holds REDACTED samples only.
--
-- memory_packs ALTER:
--   content_category  — server-derived from the attestation. NO DEFAULT on purpose: NULL means
--                       "unclassified" and the gate treats it as unsafe → blocked (fail-closed).
--   sale_mode         — 'copy' (default, the only mode in Part A) or 'title' (Part B).
--
-- Deferred to Part B (intentionally NOT here): pack_titles, pack_title_transfers,
-- pack_entitlements, pack_access_events, pack_takedowns, and the rest of the memory_packs
-- title columns (title_status, title_chain, current_owner_wallet, …).
--
-- Safe: purely additive — four new tables + two new columns on memory_packs.

BEGIN;

-- ─────────── Legal documents (ToS / disclaimers), versioned ───────────
CREATE TABLE IF NOT EXISTS legal_documents (
  doc_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  body_hash TEXT NOT NULL,                                  -- sha256 of the served body; clients verify
  url TEXT NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL,
  is_current BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (doc_id, version)
);

-- ─────────── Acceptance log (owner-scoped, append-only) ───────────
CREATE TABLE IF NOT EXISTS legal_acceptances (
  id BIGSERIAL PRIMARY KEY,
  owner_wallet TEXT NOT NULL,
  privy_user_id TEXT,
  doc_id TEXT NOT NULL,
  doc_version INTEGER NOT NULL,
  body_hash TEXT NOT NULL,
  context TEXT NOT NULL,                                    -- where it was accepted (e.g. 'listing_create')
  ip_inet INET,
  user_agent TEXT,
  accepted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_owner
  ON legal_acceptances(owner_wallet, doc_id);

-- ─────────── Creator attestations ───────────
-- content_source is the trusted origin of memory_packs.content_category, written server-side
-- at attest time. attestation_hash binds the pack's merkle_root so the attestation cannot be
-- silently re-pointed at different content.
CREATE TABLE IF NOT EXISTS pack_attestations (
  id BIGSERIAL PRIMARY KEY,
  pack_id TEXT NOT NULL REFERENCES memory_packs(pack_id) ON DELETE CASCADE,
  author_wallet TEXT NOT NULL,
  content_source TEXT NOT NULL
    CHECK (content_source IN ('own_personal', 'curated_knowledge', 'agent_memory')),
  owns_or_licensed BOOLEAN NOT NULL,
  no_thirdparty_pii BOOLEAN NOT NULL,
  not_investment_advice BOOLEAN NOT NULL,
  consent_basis TEXT,
  attestation_hash TEXT NOT NULL,
  signature TEXT,
  signed_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pack_attestations_pack
  ON pack_attestations(pack_id);

-- ─────────── Per-pack moderation result ───────────
-- findings holds ONLY redacted samples (first 4 chars + length) — never a raw secret.
CREATE TABLE IF NOT EXISTS pack_moderation (
  pack_id TEXT PRIMARY KEY REFERENCES memory_packs(pack_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'clean', 'flagged', 'quarantined', 'approved', 'rejected', 'taken_down')),
  filter_version TEXT NOT NULL,
  findings JSONB NOT NULL DEFAULT '[]',
  severity TEXT,
  reviewed_by TEXT,
  review_notes TEXT,
  scanned_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────── memory_packs: marketplace classification columns ───────────
-- NO DEFAULT on content_category: NULL = unclassified = fail-closed (gate blocks).
ALTER TABLE memory_packs
  ADD COLUMN IF NOT EXISTS content_category TEXT
    CHECK (content_category IN ('personal', 'knowledge', 'agent'));
ALTER TABLE memory_packs
  ADD COLUMN IF NOT EXISTS sale_mode TEXT
    CHECK (sale_mode IN ('copy', 'title')) DEFAULT 'copy';

COMMENT ON COLUMN memory_packs.content_category IS
  'Server-derived from pack_attestations.content_source. NULL = unclassified = blocked (fail-closed). Never client-set.';
COMMENT ON COLUMN memory_packs.sale_mode IS
  'copy (default; only mode in marketplace slice 1) or title (Part B).';

COMMIT;
