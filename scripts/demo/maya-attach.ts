/**
 * Re-bind Maya's email + DID onto the seeded wallet's agent_keys row,
 * so chat v2 surfaces the 814 demo memories at next login.
 *
 * Run AFTER migration 018 (email column exists on agent_keys).
 *
 * Decision tree:
 *   1. agent_keys row already on SEEDED_WALLET with maya@clude.io → stamp email if missing, done.
 *   2. No agent_keys row on SEEDED_WALLET → take Maya's existing DID-bound row (synthetic
 *      embedded wallet from her first login) and rewrite owner_wallet to SEEDED_WALLET.
 *   3. Orphan row exists on SEEDED_WALLET (privy_did = NULL) → retire Maya's old DID row,
 *      stamp privy_did + email on the seeded row.
 *   4. SEEDED_WALLET row has a DIFFERENT active privy_did → conflict, abort.
 *
 * Usage:
 *   pnpm dlx tsx scripts/demo/maya-attach.ts
 *   (set MAYA_PRIVY_DID env var to skip the agent_id constant lookup)
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const SEEDED_WALLET = process.env.MAYA_WALLET || 'FRokptxESMhuTWbWgL8JF3Ti1EKzsrRLrEPSqu9uhza7';
const MAYA_EMAIL = (process.env.MAYA_EMAIL || 'maya@clude.io').trim().toLowerCase();
const MAYA_AGENT_ID_HINT = process.env.MAYA_AGENT_ID || 'agent_7b3583be1963bd91';
const MAYA_PRIVY_DID = process.env.MAYA_PRIVY_DID || null;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in env.');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

interface AgentRow {
  agent_id: string;
  agent_name: string;
  owner_wallet: string | null;
  privy_did: string | null;
  email: string | null;
  is_active: boolean;
}

const SELECT = 'agent_id, agent_name, owner_wallet, privy_did, email, is_active';

async function rowsByDid(did: string): Promise<AgentRow[]> {
  const { data, error } = await db.from('agent_keys').select(SELECT).eq('privy_did', did);
  if (error) throw new Error(`agent_keys by privy_did failed: ${error.message}`);
  return (data || []) as AgentRow[];
}

async function rowsByWallet(wallet: string): Promise<AgentRow[]> {
  const { data, error } = await db.from('agent_keys').select(SELECT).eq('owner_wallet', wallet);
  if (error) throw new Error(`agent_keys by owner_wallet failed: ${error.message}`);
  return (data || []) as AgentRow[];
}

async function rowsByEmail(email: string): Promise<AgentRow[]> {
  const { data, error } = await db.from('agent_keys').select(SELECT).eq('email', email);
  if (error) throw new Error(`agent_keys by email failed: ${error.message}`);
  return (data || []) as AgentRow[];
}

async function rowByAgentId(id: string): Promise<AgentRow | null> {
  const { data } = await db.from('agent_keys').select(SELECT).eq('agent_id', id).maybeSingle();
  return (data as AgentRow | null) || null;
}

async function memoryCountForWallet(wallet: string): Promise<number> {
  const { count, error } = await db
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('owner_wallet', wallet);
  if (error) throw new Error(`memory count failed: ${error.message}`);
  return count ?? 0;
}

async function findMayaRow(): Promise<AgentRow | null> {
  // Preferred: explicit Privy DID via env.
  if (MAYA_PRIVY_DID) {
    const rows = await rowsByDid(MAYA_PRIVY_DID);
    const active = rows.find((r) => r.is_active);
    if (active) return active;
    if (rows[0]) return rows[0];
  }
  // Fallback: known agent_id hint.
  const byHint = await rowByAgentId(MAYA_AGENT_ID_HINT);
  if (byHint) return byHint;
  return null;
}

async function main() {
  console.log('=== maya-attach ===');
  console.log({ SEEDED_WALLET, MAYA_EMAIL, MAYA_AGENT_ID_HINT, MAYA_PRIVY_DID });

  const seededMemories = await memoryCountForWallet(SEEDED_WALLET);
  console.log(`Memories on SEEDED_WALLET: ${seededMemories}`);
  if (seededMemories === 0) {
    console.warn('  ⚠ no memories on SEEDED_WALLET — re-run the seed first.');
  }

  const seededRows = await rowsByWallet(SEEDED_WALLET);
  const emailRows = await rowsByEmail(MAYA_EMAIL);
  const mayaRow = await findMayaRow();

  console.log('\nBEFORE');
  console.log('  rows on SEEDED_WALLET:', seededRows);
  console.log('  rows on email:        ', emailRows);
  console.log('  Maya hint row:        ', mayaRow);

  const seededOnly = seededRows.filter((r) => r.is_active);
  const emailOnly = emailRows.filter((r) => r.is_active);

  // --- Decision tree --- //

  // Case 1: an active row already pairs SEEDED_WALLET with MAYA_EMAIL — done.
  const ideal = seededOnly.find((r) => r.email === MAYA_EMAIL);
  if (ideal) {
    console.log('\n✅ Already correctly bound:', ideal.agent_id);
    return;
  }

  // Case 2: orphan row exists on SEEDED_WALLET (no privy_did, no email).
  //         Retire Maya's old row first if it has a stale DID, then stamp.
  const orphanSeeded = seededOnly.find((r) => !r.privy_did && !r.email);
  if (orphanSeeded) {
    if (mayaRow && mayaRow.agent_id !== orphanSeeded.agent_id && mayaRow.is_active) {
      console.log(`\n→ Retiring stale Maya row ${mayaRow.agent_id} (wallet ${mayaRow.owner_wallet})`);
      const { error } = await db
        .from('agent_keys')
        .update({ privy_did: null, is_active: false })
        .eq('agent_id', mayaRow.agent_id);
      if (error) throw new Error(`retire failed: ${error.message}`);
    }

    const update: Record<string, unknown> = { email: MAYA_EMAIL };
    if (mayaRow?.privy_did) update.privy_did = mayaRow.privy_did;

    console.log(`\n→ Stamping ${JSON.stringify(update)} onto seeded row ${orphanSeeded.agent_id}`);
    const { error } = await db
      .from('agent_keys')
      .update(update)
      .eq('agent_id', orphanSeeded.agent_id);
    if (error) throw new Error(`stamp failed: ${error.message}`);
  }
  // Case 3: SEEDED_WALLET has a row with a different active privy_did → conflict.
  else if (seededOnly.some((r) => r.privy_did && mayaRow && r.privy_did !== mayaRow.privy_did)) {
    console.error('\n❌ SEEDED_WALLET row already bound to a different DID. Aborting.');
    process.exit(2);
  }
  // Case 4: no row exists on SEEDED_WALLET. Rewrite Maya's existing row's wallet.
  else if (mayaRow) {
    console.log(`\n→ Rewriting Maya row ${mayaRow.agent_id} wallet ${mayaRow.owner_wallet} → ${SEEDED_WALLET}`);
    const update: Record<string, unknown> = {
      owner_wallet: SEEDED_WALLET,
      email: MAYA_EMAIL,
    };
    const { error } = await db
      .from('agent_keys')
      .update(update)
      .eq('agent_id', mayaRow.agent_id);
    if (error) throw new Error(`rewrite failed: ${error.message}`);
  }
  // Case 5: nothing to attach to — surface this so user can pick the right hint.
  else {
    console.error('\n❌ No agent_keys row found for Maya by DID, agent_id hint, or email.');
    console.error('   Set MAYA_PRIVY_DID or MAYA_AGENT_ID env var and re-run.');
    process.exit(3);
  }

  // --- Verify --- //

  const after = {
    seeded: await rowsByWallet(SEEDED_WALLET),
    email: await rowsByEmail(MAYA_EMAIL),
  };
  console.log('\nAFTER');
  console.log('  rows on SEEDED_WALLET:', after.seeded);
  console.log('  rows on email:        ', after.email);

  const ok = after.seeded.find((r) => r.is_active && r.email === MAYA_EMAIL);
  if (ok) {
    console.log(`\n✅ Bound. Maya's next login will land on ${ok.agent_id} → ${SEEDED_WALLET} (${seededMemories} memories).`);
  } else {
    console.warn('\n⚠ Final state unexpected — review the AFTER output above.');
    process.exit(4);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
