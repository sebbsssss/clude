/**
 * Read-only: simulate what the auth resolver does for Maya's DID and
 * confirm the memory count visible to chat-v2 server-side. If this prints
 * 878 memories, the DB is correct and the chat shows 0 due to client/auth
 * caching (hard-refresh / re-login should pick it up).
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const MAYA_DID = 'did:privy:cmmhr8si7017m0dl5ylg5u0sb';
const SEEDED_WALLET = 'FRokptxESMhuTWbWgL8JF3Ti1EKzsrRLrEPSqu9uhza7';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in env.');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  // 1. Replay step 1 of findOrCreateAgentForDid: lookup by privy_did + is_active.
  const { data: didRow, error: e1 } = await db
    .from('agent_keys')
    .select('agent_id, agent_name, owner_wallet, privy_did, email, is_active')
    .eq('privy_did', MAYA_DID)
    .eq('is_active', true)
    .limit(1)
    .single();
  console.log('Resolver step 1 (DID lookup):');
  console.log('  did:', MAYA_DID);
  console.log('  result:', didRow);
  if (e1) console.log('  error:', e1.message);

  if (!didRow) {
    console.error('\n❌ No active agent_keys row for Maya\'s DID. Auth would fall through to wallet provisioning.');
    process.exit(2);
  }

  // 2. Memory count for the resolved wallet — what chat-v2 backend would surface.
  const wallet = didRow.owner_wallet;
  const { count: memCount } = await db
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('owner_wallet', wallet);
  console.log(`\nMemories where owner_wallet = ${wallet}: ${memCount}`);

  // 3. Sample by source — confirms the seeded data is what we'd expect.
  const { data: sources } = await db
    .from('memories')
    .select('source')
    .eq('owner_wallet', wallet)
    .limit(5000);
  const breakdown: Record<string, number> = {};
  (sources || []).forEach((m) => { breakdown[m.source || 'null'] = (breakdown[m.source || 'null'] || 0) + 1; });
  console.log('Source breakdown:', breakdown);

  // 4. Are there ANY OTHER active rows for Maya's DID (would indicate dupes)?
  const { data: dupes } = await db
    .from('agent_keys')
    .select('agent_id, owner_wallet, is_active')
    .eq('privy_did', MAYA_DID);
  console.log(`\nAll agent_keys rows on Maya's DID (${dupes?.length ?? 0}):`, dupes);

  // 5. Are there any rows with owner_wallet = MAYA's old embedded wallet that
  //    might suggest data was stored there post-rebind?
  const { count: oldWalletMems } = await db
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('owner_wallet', '5vK6WRCq5V6BCte8cQvaNeNv2KzErCfGzeBDwtBGGv2r');
  console.log(`Memories on Maya's old embedded wallet (5vK6WRCq…): ${oldWalletMems}`);

  if (wallet === SEEDED_WALLET && (memCount ?? 0) >= 800) {
    console.log('\n✅ DB is correct. Chat showing 0 = client/session cache. Hard-refresh / log out & in.');
  } else {
    console.warn('\n⚠ DB does not match expected post-rebind state.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
