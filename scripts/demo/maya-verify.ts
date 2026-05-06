import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
const MAYA_DID = 'did:privy:cmor2u0z501lk0cie8u2yg3sn';

async function main() {
  const { data: rows } = await db
    .from('agent_keys')
    .select('agent_id, agent_name, owner_wallet, privy_did, is_active, last_used')
    .eq('privy_did', MAYA_DID);
  console.log('agent_keys rows for Maya:');
  console.log(JSON.stringify(rows, null, 2));

  if (rows && rows.length === 1) {
    const wallet = rows[0].owner_wallet;
    const { count } = await db
      .from('memories')
      .select('id', { count: 'exact', head: true })
      .eq('owner_wallet', wallet);
    console.log(`\nMemories owned by ${wallet}: ${count}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
