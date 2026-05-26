-- 021: Encryption key registry + per-memory wrapped DEKs (PMP memory encryption-at-rest, Plan 1)
-- See docs/pmp/memory-encryption-design.md §9. No data is encrypted by this migration —
-- it only creates the tables the envelope scheme will use.

-- Owner public-key registry. No private keys, ever.
CREATE TABLE IF NOT EXISTS encryption_keys (
  owner_wallet  TEXT PRIMARY KEY,
  x25519_pubkey TEXT NOT NULL,
  verifier_ct   TEXT NOT NULL,                 -- secretbox("clude-key-verifier-v1") under derived key (H2)
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Per-memory wrapped DEKs. Wrap = sealed box; wrap_pubkey is the ephemeral sender pubkey.
CREATE TABLE IF NOT EXISTS memory_dek_wraps (
  memory_id   BIGINT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  recipient   TEXT   NOT NULL,                 -- 'owner' | 'provider'
  wrapped_dek TEXT   NOT NULL,                 -- base64(nonce || box(DEK))
  wrap_pubkey TEXT   NOT NULL,                 -- base64 ephemeral sender X25519 pubkey
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (memory_id, recipient)
);
CREATE INDEX IF NOT EXISTS idx_dek_wraps_memory ON memory_dek_wraps(memory_id);
