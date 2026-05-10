/**
 * Apply migration 018_email_on_agent_keys.sql via the Supabase exec_sql RPC.
 *
 * Idempotent — uses ADD COLUMN IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS,
 * so re-runs are no-ops. Verifies the column exists afterwards.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';
config();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in env.');
  process.exit(1);
}

const sqlPath = join(process.cwd(), 'packages/database/migrations/018_email_on_agent_keys.sql');
// Strip BEGIN/COMMIT — Supabase exec_sql wraps queries in PL/pgSQL EXECUTE
// which forbids transaction control. Each statement is already idempotent
// (IF NOT EXISTS), so a transaction is optional for this migration.
const sql = readFileSync(sqlPath, 'utf8')
  .replace(/^\s*BEGIN\s*;?\s*$/gim, '')
  .replace(/^\s*COMMIT\s*;?\s*$/gim, '')
  .trim();

const db = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  console.log('=== run-migration-018 ===');
  console.log(`Target: ${url}`);
  console.log(`SQL file: ${sqlPath}`);
  console.log('---');
  console.log(sql);
  console.log('---');

  const { error } = await db.rpc('exec_sql', { query: sql });
  if (error) {
    console.error('exec_sql failed:', error);
    process.exit(2);
  }
  console.log('✅ Migration applied.');

  // Verify: query information_schema for the email column on agent_keys.
  const { data: colCheck, error: colErr } = await db
    .rpc('exec_sql', {
      query: `SELECT column_name, data_type
              FROM information_schema.columns
              WHERE table_name = 'agent_keys' AND column_name = 'email';`,
    });
  if (colErr) {
    console.warn('verify (column) skipped — exec_sql may not return rows:', colErr.message);
  } else {
    console.log('Column check result:', colCheck);
  }

  // Verify by attempting a SELECT on email — proves the column is queryable.
  const { error: selErr } = await db
    .from('agent_keys')
    .select('agent_id, email')
    .limit(1);
  if (selErr) {
    console.error('❌ SELECT email FROM agent_keys failed:', selErr.message);
    process.exit(3);
  }
  console.log('✅ agent_keys.email is queryable.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
