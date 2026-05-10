import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });

async function main() {
  const { data: didRows } = await db
    .from('agent_keys')
    .select('agent_id, agent_name, owner_wallet, privy_did, email, is_active, last_used')
    .eq('privy_did', 'did:privy:cmmhr8si7017m0dl5ylg5u0sb');
  console.log('Rows on Maya DID:', didRows?.length ?? 0);
  console.log(JSON.stringify(didRows, null, 2));

  const { data: byAgent } = await db
    .from('agent_keys')
    .select('agent_id, agent_name, owner_wallet, privy_did, email, is_active, last_used')
    .eq('agent_id', 'agent_7b3583be1963bd91');
  console.log('\nRow for agent_7b3583be1963bd91:');
  console.log(JSON.stringify(byAgent, null, 2));

  const { data: byEmail } = await db
    .from('agent_keys')
    .select('agent_id, agent_name, owner_wallet, privy_did, email, is_active, last_used')
    .eq('email', 'maya@clude.io');
  console.log('\nRows with email=maya@clude.io:');
  console.log(JSON.stringify(byEmail, null, 2));

  const { data: byWallet } = await db
    .from('agent_keys')
    .select('agent_id, agent_name, owner_wallet, privy_did, email, is_active, last_used')
    .eq('owner_wallet', 'FRokptxESMhuTWbWgL8JF3Ti1EKzsrRLrEPSqu9uhza7');
  console.log('\nRows on FRokptx wallet:');
  console.log(JSON.stringify(byWallet, null, 2));
}
main();
