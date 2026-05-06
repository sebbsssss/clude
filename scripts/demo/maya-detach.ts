import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
const AGENT_ID = 'agent_7b3583be1963bd91';

async function main() {
  // 1. Read before
  const { data: before, error: e1 } = await db
    .from('agent_keys')
    .select('agent_id, agent_name, owner_wallet, privy_did, is_active, last_used')
    .eq('agent_id', AGENT_ID)
    .single();
  if (e1) { console.error('read err', e1); return; }
  console.log('BEFORE:');
  console.log(JSON.stringify(before, null, 2));

  if (!before.privy_did) {
    console.log('\nAlready detached (privy_did is null). Nothing to do.');
    return;
  }

  // 2. Update
  const { error: e2 } = await db
    .from('agent_keys')
    .update({ privy_did: null })
    .eq('agent_id', AGENT_ID);
  if (e2) { console.error('update err', e2); return; }

  // 3. Read after
  const { data: after } = await db
    .from('agent_keys')
    .select('agent_id, agent_name, owner_wallet, privy_did, is_active, last_used')
    .eq('agent_id', AGENT_ID)
    .single();
  console.log('\nAFTER:');
  console.log(JSON.stringify(after, null, 2));

  // 4. Sanity: confirm Maya's DID is no longer linked anywhere
  const { data: anyBound } = await db
    .from('agent_keys')
    .select('agent_id, owner_wallet, privy_did')
    .eq('privy_did', before.privy_did);
  console.log('\nRows still bound to that DID:', (anyBound || []).length);
  if (anyBound && anyBound.length > 0) {
    console.log(JSON.stringify(anyBound, null, 2));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
