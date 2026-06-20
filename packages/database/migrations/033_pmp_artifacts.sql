-- 033_pmp_artifacts.sql
-- Memory Pack Marketplace — Part C: the desktop .pmp artifact + pairing subsystem.
--
-- The SERVER-SIDE contract the user's existing Clude desktop (Tauri) app links to.
-- A .pmp file IS a MemoryPack tar.zst (packages/memorypack) carrying a pack-level
-- Merkle root + per-record leaf hashes (packages/tokenization, content-hash
-- memory-hash-v1). These four tables register those built artifacts, account for
-- imports, and run the device-pairing handshake — they do NOT reinvent the file format.
--
-- Tables:
--   pmp_artifacts      — one row per built+registered .pmp file. owner-scoped. Its identity
--                        columns (merkle_root, manifest_hash, creator_pubkey, manifest_sig)
--                        mirror the manifest.json `pmp` block (design §4.1) so /pmp/verify
--                        can validate without re-reading the tarball. pack_id FK is
--                        ON DELETE SET NULL: deleting the source pack leaves the artifact
--                        record (the file may already be in a buyer's hands).
--   pmp_imports        — hash-verified import accounting: how many records came in, deduped
--                        (by content_hash), or were rejected. owner-scoped.
--   pmp_devices        — paired desktop devices. owner-scoped. device_pubkey (ed25519) is
--                        UNIQUE — desktop memory-pull routes are DEVICE-SIGNED, so a pubkey
--                        identifies exactly one device and a revoked device drops out of the
--                        active lookup (Risk R9: device-pull = full memory egress, must be
--                        revocable + scoped).
--   pmp_pairing_codes  — the anti-phishing handshake substrate (§00 MINOR 11). A short code
--                        is created (pending), CLAIMED by an AUTHENTICATED owner who confirms
--                        the surfaced device_name/platform (claimed), then CONSUMED by the
--                        device-signed complete step. expires_at is NOT NULL so the route
--                        layer can enforce the <2 min window — a code read aloud to an
--                        attacker must not let them silently pair.
--
-- Owner-scoping: every table carries owner_wallet (pmp_pairing_codes' is nullable until
-- the authenticated claim binds it). The route layer scopes all reads via ownerFromReq()
-- (req.verifiedWallet only — a client-supplied ?owner is NEVER trusted; Part A/B
-- requireOwnership pattern). Device-pull routes verify the ed25519 device signature.
--
-- §00 MINOR 14 (binding correction): pmp_artifacts.manifest_hash UNIQUE is SCOPED to
-- (owner_wallet, manifest_hash), NOT a global unique — two users exporting the SAME public
-- pack legitimately produce the same manifest_hash and MUST NOT collide.
--
-- Application to a real Postgres/Supabase database is a DEPLOY GATE, performed outside this
-- session — pmp-artifacts-migration.test.ts is the static proxy that this DDL is correct.
--
-- Safe: purely additive — four new tables + their indexes, no change to any existing table.

BEGIN;

-- ─────────── PMP ARTIFACTS: the built .pmp file registry ───────────
-- Identity columns mirror the manifest.json `pmp` block (design §4.1). manifest_hash binds
-- title + license + record_count + merkle_root under the creator's ed25519 manifest_sig;
-- the server re-derives + verifies it on register/verify. signing_device_id ties a
-- desktop-signed artifact back to the pmp_devices row that produced it.
CREATE TABLE IF NOT EXISTS pmp_artifacts (
  artifact_id TEXT PRIMARY KEY,                              -- hash-id like 'pmpa-XXXXXXXX'
  pack_id TEXT REFERENCES memory_packs(pack_id) ON DELETE SET NULL,
  owner_wallet TEXT NOT NULL,
  pmp_version TEXT NOT NULL,                                 -- e.g. '0.8'
  title TEXT NOT NULL,
  description TEXT,
  license_type TEXT NOT NULL CHECK (license_type IN ('copy', 'title')),
  record_count INTEGER NOT NULL,
  merkle_root TEXT,                                          -- pack-level root (null until anchored)
  manifest_hash TEXT NOT NULL,                              -- sha256 over canonical manifest (sig removed)
  creator_pubkey TEXT NOT NULL,                            -- ed25519 signer (the user's on-device key)
  manifest_sig TEXT NOT NULL,                              -- ed25519 over manifest_hash
  encryption_scope TEXT CHECK (encryption_scope IN ('none', 'records', 'records+blobs')) DEFAULT 'none',
  storage_url TEXT,                                         -- where the built tarball lives
  byte_size BIGINT,
  source_kind TEXT NOT NULL DEFAULT 'web'
    CHECK (source_kind IN ('web', 'desktop', 'cli', 'sdk')),
  signing_device_id TEXT,                                  -- the pmp_devices.device_id that signed it
  anchor_chain TEXT,                                       -- chain the Merkle root was committed on
  anchor_tx_sig TEXT,                                      -- on-chain commitment tx
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pmp_artifacts_owner
  ON pmp_artifacts(owner_wallet);
-- §00 MINOR 14: SCOPED uniqueness. The same public pack exported by two users yields the
-- same manifest_hash — collision is legitimate, so the unique key is the (owner, hash) pair.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pmp_artifacts_manifest_hash
  ON pmp_artifacts(owner_wallet, manifest_hash);

-- ─────────── PMP IMPORTS: hash-verified import accounting ───────────
-- A .pmp import hash-verifies each record (leaf_hash + content_hash), dedupes against the
-- owner's existing memories by content_hash, then re-embeds. These counters are the receipt.
CREATE TABLE IF NOT EXISTS pmp_imports (
  import_id TEXT PRIMARY KEY,                                -- hash-id like 'pmpi-XXXXXXXX'
  owner_wallet TEXT NOT NULL,
  artifact_manifest_hash TEXT,                              -- the source .pmp's manifest_hash
  source_pubkey TEXT,                                       -- the creator_pubkey that signed it
  record_count INTEGER NOT NULL,                            -- records present in the artifact
  imported_count INTEGER NOT NULL,                          -- newly landed memories
  deduped_count INTEGER NOT NULL,                           -- skipped (content_hash already owned)
  rejected_count INTEGER NOT NULL,                          -- failed hash/signature verification
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pmp_imports_owner
  ON pmp_imports(owner_wallet);

-- ─────────── DESKTOP PAIRING: paired devices ───────────
-- The desktop app holds an app-local ed25519 device key in the OS keychain (the wallet
-- signing key NEVER leaves the device). device_pubkey is UNIQUE: it is the identity the
-- device-signed memory-pull routes authenticate against. scopes bounds what a device may do
-- (default: read memories + export pmp). revoked_at drops a compromised device out of the
-- active partial index (Risk R9).
CREATE TABLE IF NOT EXISTS pmp_devices (
  device_id TEXT PRIMARY KEY,                               -- hash-id like 'dev-XXXXXXXX'
  owner_wallet TEXT NOT NULL,
  device_pubkey TEXT NOT NULL,
  device_name TEXT,
  platform TEXT,
  paired_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  scopes TEXT[] NOT NULL DEFAULT '{memories:read,pmp:export}'
);

-- Active devices per owner (revoked rows excluded — they must not appear in management or auth).
CREATE INDEX IF NOT EXISTS idx_pmp_devices_owner
  ON pmp_devices(owner_wallet) WHERE revoked_at IS NULL;
-- A device pubkey identifies exactly one device — a key cannot be paired twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pmp_devices_pubkey
  ON pmp_devices(device_pubkey);

-- ─────────── DESKTOP PAIRING: pairing codes (anti-phishing, §00 MINOR 11) ───────────
-- The PK is code_hash, never the plaintext code (the raw code is shown once to the user and
-- never stored). status walks pending → claimed → consumed (or expired). The CLAIM step
-- requires an authenticated Privy session AND surfaces device_name/platform for explicit
-- human confirmation, binding owner_wallet; complete is device-signed. expires_at NOT NULL
-- lets the route enforce the <2 min window — so a code social-engineered out of a user
-- cannot be silently claimed by an attacker's device.
CREATE TABLE IF NOT EXISTS pmp_pairing_codes (
  code_hash TEXT PRIMARY KEY,                               -- sha256 of the one-time pairing code
  device_pubkey TEXT NOT NULL,                             -- the device requesting the pair
  device_name TEXT,                                        -- surfaced to the human at claim time
  platform TEXT,                                           -- surfaced to the human at claim time
  owner_wallet TEXT,                                       -- null until the authenticated claim binds it
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'consumed', 'expired')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL                          -- enforces the <2 min pairing window
);

-- A device_pubkey may have one LIVE pending/claimed code at a time — re-running pair/init for the
-- same device replaces the prior code rather than accumulating claimable rows (and shrinks the
-- attack surface to exactly one outstanding code per device).
CREATE UNIQUE INDEX IF NOT EXISTS idx_pmp_pairing_codes_live_device
  ON pmp_pairing_codes(device_pubkey) WHERE status IN ('pending', 'claimed');

-- ─────────── DESKTOP PAIRING: device events (anti-phishing notification log) ───────────
-- The durable audit trail behind the "notify on a new device pair" anti-phishing requirement
-- (§00 MINOR 11) and the large-export egress alert (Risk R9). A pairing 'claimed'/'paired' row,
-- or a 'memory_pull' row over a size threshold, is what a notification worker reads to alert the
-- owner — exactly the pattern pack_listing_events / pack_access_events follow elsewhere. Append
-- only; owner-scoped. device_id is nullable because a 'claimed' event precedes the pmp_devices row.
CREATE TABLE IF NOT EXISTS pmp_device_events (
  event_id BIGSERIAL PRIMARY KEY,
  owner_wallet TEXT NOT NULL,
  device_id TEXT,                                          -- the pmp_devices row, once it exists
  device_pubkey TEXT,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('pair_claimed', 'paired', 'revoked', 'memory_pull')),
  device_name TEXT,
  platform TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pmp_device_events_owner
  ON pmp_device_events(owner_wallet, created_at DESC);

COMMIT;
