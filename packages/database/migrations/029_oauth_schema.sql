-- 029: OAuth 2.1 Authorization Server for the remote MCP connector.
--
-- Adds the persistence layer so claude.ai / Claude Desktop can connect to Clude's MCP
-- server (/api/mcp) through a real OAuth 2.1 Authorization Code + PKCE flow instead of a
-- manually-pasted Bearer API key. Required for the Anthropic Connectors Directory listing
-- (reviewers expect OAuth 2.0 for connectors that handle private user data).
--
-- IDENTITY MODEL: every issued token resolves to an `owner_wallet` — the existing atomic
-- tenancy unit. The human authenticates at /authorize via the existing Privy login, and
-- findOrCreateAgentForDid(did) maps the Privy DID -> owner_wallet (provisioning an embedded
-- Solana wallet when needed). No new identity system; OAuth just front-ends the same model.
--
-- SECURITY: authorization codes and refresh tokens are stored HASHED (sha256) at rest, never
-- plaintext. Access tokens are stateless signed JWTs (not stored). Codes are single-use with a
-- short TTL and bound to a PKCE S256 challenge + exact redirect_uri. Refresh tokens rotate on
-- use (the old hash is marked revoked and chained via rotated_to for reuse detection).
--
-- Safe: purely additive — three new tables, no change to any existing table.

BEGIN;

-- Registered OAuth clients (RFC 7591 Dynamic Client Registration). Claude registers itself.
CREATE TABLE IF NOT EXISTS oauth_clients (
  id                          BIGSERIAL PRIMARY KEY,
  client_id                   TEXT UNIQUE NOT NULL,
  client_secret_hash          TEXT,                          -- NULL for public (PKCE) clients
  client_name                 TEXT,
  redirect_uris               TEXT[] NOT NULL DEFAULT '{}',
  grant_types                 TEXT[] NOT NULL DEFAULT ARRAY['authorization_code', 'refresh_token'],
  response_types              TEXT[] NOT NULL DEFAULT ARRAY['code'],
  token_endpoint_auth_method  TEXT   NOT NULL DEFAULT 'none',
  scope                       TEXT,
  metadata                    JSONB  NOT NULL DEFAULT '{}'::jsonb,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_client_id ON oauth_clients(client_id);

-- Short-lived authorization codes: single-use, PKCE-bound. Code value stored hashed.
CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  id                    BIGSERIAL PRIMARY KEY,
  code_hash             TEXT UNIQUE NOT NULL,
  client_id             TEXT NOT NULL,
  owner_wallet          TEXT NOT NULL,
  redirect_uri          TEXT NOT NULL,
  scope                 TEXT,
  code_challenge        TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  expires_at            TIMESTAMPTZ NOT NULL,
  consumed_at           TIMESTAMPTZ,                          -- set on first exchange; reuse -> reject
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_hash ON oauth_authorization_codes(code_hash);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires ON oauth_authorization_codes(expires_at);

-- Refresh tokens (rotated on use). Token value stored hashed; access tokens are stateless JWTs.
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id            BIGSERIAL PRIMARY KEY,
  token_hash    TEXT UNIQUE NOT NULL,
  token_type    TEXT NOT NULL DEFAULT 'refresh',
  client_id     TEXT NOT NULL,
  owner_wallet  TEXT NOT NULL,
  scope         TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  rotated_to    TEXT,                                         -- successor token_hash (reuse-detection chain)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_hash  ON oauth_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_owner ON oauth_tokens(owner_wallet);

COMMIT;
