/**
 * Chain-commit Maya's highlight memories to Solana mainnet.
 *
 * After `seed-maya.ts insert` lands, this picks up rows tagged with
 * source = 'demo-highlight' (no solana_signature yet), computes the
 * SHA-256 of each memory's content, writes a `clude:v1:sha256:<hex>`
 * memo to Solana via the bot wallet, and stores the resulting tx
 * signature on the row. The dashboard's `✓ on-chain` badge then
 * lights up + the System card's "On-Chain Proofs" counter ticks up.
 *
 * Usage:  node --experimental-strip-types --no-warnings scripts/demo/chain-commit-maya.ts
 *
 * Env required:  SUPABASE_URL, SUPABASE_SERVICE_KEY, SOLANA_RPC_URL, BOT_WALLET_PRIVATE_KEY
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { createHash } from 'crypto';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58Module from 'bs58';

config();
const bs58 = (bs58Module as any).default || bs58Module;

const WALLET = process.env.MAYA_WALLET || 'FRokptxESMhuTWbWgL8JF3Ti1EKzsrRLrEPSqu9uhza7';
const HIGHLIGHT_SOURCE = 'demo-highlight';
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const MEMO_MAX_LENGTH = 566;

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
const conn = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');

function loadBotWallet(): Keypair {
  const raw = (process.env.BOT_WALLET_PRIVATE_KEY || '').trim();
  if (!raw) throw new Error('BOT_WALLET_PRIVATE_KEY missing from env');
  const secret = raw.startsWith('[') ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw);
  return Keypair.fromSecretKey(secret);
}

async function writeMemo(wallet: Keypair, memo: string): Promise<string | null> {
  const truncated = memo.slice(0, MEMO_MAX_LENGTH);
  const instruction = new TransactionInstruction({
    keys: [{ pubkey: wallet.publicKey, isSigner: true, isWritable: true }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(truncated, 'utf-8'),
  });
  const tx = new Transaction().add(instruction);
  try {
    return await sendAndConfirmTransaction(conn, tx, [wallet]);
  } catch (err: any) {
    console.error('  tx error:', err.message);
    return null;
  }
}

async function main() {
  const wallet = loadBotWallet();
  console.log(`Bot wallet: ${wallet.publicKey.toBase58()}`);
  const balance = await conn.getBalance(wallet.publicKey);
  console.log(`Balance: ${(balance / 1e9).toFixed(4)} SOL`);

  // Fetch highlights without a signature yet
  const { data: rows, error } = await db
    .from('memories')
    .select('id, hash_id, content, summary')
    .eq('owner_wallet', WALLET)
    .eq('source', HIGHLIGHT_SOURCE)
    .is('solana_signature', null)
    .order('id', { ascending: true });
  if (error) { console.error('select error', error); process.exit(1); }
  if (!rows || rows.length === 0) {
    console.log('Nothing to commit (no demo-highlight rows missing solana_signature).');
    return;
  }
  console.log(`To commit: ${rows.length} memories`);
  // Estimate cost (5000 lamports per tx)
  const estLamports = rows.length * 5000;
  console.log(`Estimated cost: ${(estLamports / 1e9).toFixed(6)} SOL`);
  if (balance < estLamports * 1.5) {
    console.error('Bot wallet balance too low. Top up and re-run.');
    process.exit(1);
  }

  let done = 0, failed = 0;
  for (const m of rows) {
    const hash = createHash('sha256').update(m.content).digest('hex');
    const memo = `clude:v1:sha256:${hash}`;
    const sig = await writeMemo(wallet, memo);
    if (!sig) { failed++; continue; }
    const { error: e2 } = await db
      .from('memories')
      .update({ solana_signature: sig })
      .eq('id', m.id);
    if (e2) { console.error(`  update error for id ${m.id}: ${e2.message}`); failed++; continue; }
    done++;
    process.stdout.write(`  ✓ ${done}/${rows.length}  ${m.hash_id}  ${sig.slice(0, 16)}…\n`);
  }
  console.log(`\nDone. Committed: ${done}, failed: ${failed}.`);
}

main().catch(e => { console.error(e); process.exit(1); });
