/**
 * Simulate the queries `/api/cortex/stats` makes for Maya's wallet, top to bottom.
 * If this returns 878 but chat-v2 UI says 0, the issue is downstream of the API.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const WALLET = 'FRokptxESMhuTWbWgL8JF3Ti1EKzsrRLrEPSqu9uhza7';
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });

async function main() {
  // Total
  const { count: total } = await db
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('owner_wallet', WALLET);
  console.log('total:', total);

  // Embedded
  const { count: embedded } = await db
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('owner_wallet', WALLET)
    .not('embedding', 'is', null);
  console.log('embedded:', embedded);

  // By type
  const types = ['episodic', 'semantic', 'procedural', 'self_model', 'introspective'];
  for (const t of types) {
    const { count } = await db
      .from('memories')
      .select('id', { count: 'exact', head: true })
      .eq('owner_wallet', WALLET)
      .eq('memory_type', t);
    console.log(`byType.${t}:`, count);
  }

  // Recent within 168h (Wiki default)
  const since168 = new Date(Date.now() - 168 * 60 * 60 * 1000).toISOString();
  const { count: recent168 } = await db
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('owner_wallet', WALLET)
    .gte('created_at', since168);
  console.log('recent within 168h (created_at):', recent168);

  // Recent within 6h (chat-v2 default for /api/cortex/recent)
  const since6 = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { count: recent6 } = await db
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('owner_wallet', WALLET)
    .gte('created_at', since6);
  console.log('recent within 6h (created_at):', recent6);

  // What's the date spread of seeded memories? (to confirm hours-based filters miss them)
  const { data: oldest } = await db
    .from('memories')
    .select('id, created_at, event_date, source')
    .eq('owner_wallet', WALLET)
    .order('created_at', { ascending: true })
    .limit(1);
  const { data: newest } = await db
    .from('memories')
    .select('id, created_at, event_date, source')
    .eq('owner_wallet', WALLET)
    .order('created_at', { ascending: false })
    .limit(1);
  console.log('oldest:', oldest);
  console.log('newest:', newest);
}
main().catch(e => { console.error(e); process.exit(1); });
