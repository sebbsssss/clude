import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });

async function main() {
  // Recently used rows (chat-v2 calls recordAgentInteraction on every cortex hit,
  // so an active session pings last_used within seconds).
  const { data: recent } = await db
    .from('agent_keys')
    .select('agent_id, agent_name, owner_wallet, privy_did, email, is_active, last_used')
    .gte('last_used', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('last_used', { ascending: false })
    .limit(20);
  console.log('Active in last 24h:');
  console.log(JSON.stringify(recent, null, 2));

  // All rows ever associated with maya by email/DID/seeded wallet.
  const { data: anyAssoc } = await db
    .from('agent_keys')
    .select('agent_id, agent_name, owner_wallet, privy_did, email, is_active, last_used')
    .or(
      [
        'email.eq.maya@clude.io',
        'privy_did.eq.did:privy:cmor2u0z501lk0cie8u2yg3sn',
        'privy_did.eq.did:privy:cmmhr8si7017m0dl5ylg5u0sb',
        'owner_wallet.eq.FRokptxESMhuTWbWgL8JF3Ti1EKzsrRLrEPSqu9uhza7',
        'owner_wallet.eq.5vK6WRCq5V6BCte8cQvaNeNv2KzErCfGzeBDwtBGGv2r',
      ].join(','),
    );
  console.log('\nAny row associated with Maya, FRokptx, 5vK6, or either DID:');
  console.log(JSON.stringify(anyAssoc, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
