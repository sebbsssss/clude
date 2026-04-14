BEGIN;
ALTER TABLE agent_keys ADD COLUMN IF NOT EXISTS privy_did TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_keys_privy_did
  ON agent_keys(privy_did) WHERE privy_did IS NOT NULL;
COMMIT;
