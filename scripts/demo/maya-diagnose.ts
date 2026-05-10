import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_KEY!;
const wallet = 'FRokptxESMhuTWbWgL8JF3Ti1EKzsrRLrEPSqu9uhza7';
const db = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  console.log('Wallet:', wallet);
  console.log('---');

  // 1. agent_keys rows pointing at this wallet
  const { data: rows, error: e1 } = await db
    .from('agent_keys')
    .select('*')
    .eq('owner_wallet', wallet);
  if (e1) { console.error('agent_keys err:', e1); return; }
  console.log('agent_keys rows:', rows?.length || 0);
  console.log(JSON.stringify(rows, null, 2));

  // 2. memory count by source/type
  const { count: total } = await db
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('owner_wallet', wallet);
  console.log('---');
  console.log('Total memories owned by this wallet:', total);

  // 3. by source
  const { data: bySource } = await db
    .from('memories')
    .select('source')
    .eq('owner_wallet', wallet)
    .limit(2000);
  const counts: Record<string, number> = {};
  (bySource || []).forEach(m => { counts[m.source || 'null'] = (counts[m.source || 'null'] || 0) + 1; });
  console.log('---');
  console.log('Sample (first 2000) by source:');
  console.log(JSON.stringify(counts, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
