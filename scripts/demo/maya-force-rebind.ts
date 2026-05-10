/**
 * One-shot, destructive: retire the cmor2u0z claim on FRokptx… and
 * bind Maya's existing agent_keys row to the seeded wallet + email.
 *
 * Pre-conditions verified before any write:
 *   - SEEDED_WALLET has exactly one active row, owned by CONFLICT_DID.
 *   - MAYA_DID has exactly one active row.
 *   - The seeded wallet has memories.
 *
 * Re-runnable: idempotent. If the rebinding has already happened the
 * script reports "already bound" and exits clean.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const SEEDED_WALLET = 'FRokptxESMhuTWbWgL8JF3Ti1EKzsrRLrEPSqu9uhza7';
const MAYA_EMAIL = 'maya@clude.io';
const MAYA_DID = 'did:privy:cmmhr8si7017m0dl5ylg5u0sb';
const CONFLICT_DID = 'did:privy:cmor2u0z501lk0cie8u2yg3sn';
const CONFLICT_AGENT_ID = 'agent_69541d0807ed44cc';
const MAYA_AGENT_ID = 'agent_7b3583be1963bd91';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in env.');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const SELECT = 'agent_id, agent_name, owner_wallet, privy_did, email, is_active';

async function read(agentId: string) {
  const { data } = await db.from('agent_keys').select(SELECT).eq('agent_id', agentId).maybeSingle();
  return data;
}

async function memoryCount(wallet: string): Promise<number> {
  const { count } = await db
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('owner_wallet', wallet);
  return count ?? 0;
}

async function main() {
  console.log('=== maya-force-rebind ===');
  console.log({ SEEDED_WALLET, MAYA_EMAIL, MAYA_DID, CONFLICT_DID });

  const before = {
    conflict: await read(CONFLICT_AGENT_ID),
    maya: await read(MAYA_AGENT_ID),
    memories: await memoryCount(SEEDED_WALLET),
  };
  console.log('\nBEFORE');
  console.log('  conflict row:', before.conflict);
  console.log('  maya row:    ', before.maya);
  console.log('  memories on seeded wallet:', before.memories);

  // Idempotency check: already done?
  if (
    before.maya?.owner_wallet === SEEDED_WALLET &&
    before.maya?.email === MAYA_EMAIL &&
    (!before.conflict || !before.conflict.is_active || before.conflict.owner_wallet !== SEEDED_WALLET)
  ) {
    console.log('\n✅ Already bound — nothing to do.');
    return;
  }

  // Pre-condition guards
  if (!before.conflict) {
    console.error('\n❌ Conflict row missing. Re-verify state.');
    process.exit(2);
  }
  if (before.conflict.privy_did !== CONFLICT_DID) {
    console.error(`\n❌ Conflict row's privy_did changed (now ${before.conflict.privy_did}). Aborting for safety.`);
    process.exit(3);
  }
  if (!before.maya) {
    console.error('\n❌ Maya row missing.');
    process.exit(4);
  }
  if (before.maya.privy_did !== MAYA_DID) {
    console.error(`\n❌ Maya row's privy_did changed (now ${before.maya.privy_did}). Aborting for safety.`);
    process.exit(5);
  }
  if (before.memories === 0) {
    console.error('\n❌ Seeded wallet has 0 memories. Re-run seed first.');
    process.exit(6);
  }

  // 1. Retire the conflict row — clear privy_did + owner_wallet + is_active so
  //    the unique partial indexes free up for Maya's incoming UPDATE.
  console.log(`\n→ Retiring conflict row ${CONFLICT_AGENT_ID}`);
  const { error: e1 } = await db
    .from('agent_keys')
    .update({ privy_did: null, owner_wallet: null, is_active: false })
    .eq('agent_id', CONFLICT_AGENT_ID);
  if (e1) {
    console.error(`Retire failed: ${e1.message}`);
    process.exit(7);
  }

  // 2. Bind Maya's row to the seeded wallet + email.
  console.log(`→ Binding ${MAYA_AGENT_ID} → owner_wallet=${SEEDED_WALLET}, email=${MAYA_EMAIL}`);
  const { error: e2 } = await db
    .from('agent_keys')
    .update({ owner_wallet: SEEDED_WALLET, email: MAYA_EMAIL })
    .eq('agent_id', MAYA_AGENT_ID);
  if (e2) {
    console.error(`Bind failed: ${e2.message}`);
    console.error('  Conflict row already retired — re-run after diagnosing or restore manually.');
    process.exit(8);
  }

  const after = {
    conflict: await read(CONFLICT_AGENT_ID),
    maya: await read(MAYA_AGENT_ID),
    memories: await memoryCount(SEEDED_WALLET),
  };
  console.log('\nAFTER');
  console.log('  conflict row:', after.conflict);
  console.log('  maya row:    ', after.maya);
  console.log('  memories on seeded wallet:', after.memories);

  if (
    after.maya?.owner_wallet === SEEDED_WALLET &&
    after.maya?.email === MAYA_EMAIL &&
    after.conflict?.is_active === false
  ) {
    console.log(`\n✅ Done. Maya's next chat-v2 login resolves to ${SEEDED_WALLET} (${after.memories} memories).`);
  } else {
    console.error('\n⚠ Post-state unexpected — review AFTER output.');
    process.exit(9);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
