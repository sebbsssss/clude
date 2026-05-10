BEGIN;
ALTER TABLE agent_keys ADD COLUMN IF NOT EXISTS email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_keys_email
  ON agent_keys(email) WHERE email IS NOT NULL AND is_active = true;
COMMIT;
