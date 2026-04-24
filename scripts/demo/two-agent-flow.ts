/**
 * Two-agent memory pool flow — hackathon demo scene (Act 3, 1:35-1:50).
 *
 * Sequence:
 *   1. Agent A creates a shared pool (namespace: "defi-research-2026")
 *   2. Agent A stores a memory → pays 0.001 $CLUDE-devnet → SPL transfer to treasury ATA
 *   3. Agent B cites the memory → pays 0.0001 $CLUDE-devnet → SPL transfer to Agent A
 *
 * Prints every tx hash with a Solana Explorer devnet link — so during recording,
 * the viewer can click through and see it confirmed on-chain.
 *
 * Prerequisites (one-time setup):
 *   - Anchor program deployed to devnet at PROGRAM_ID
 *   - $CLUDE-devnet SPL mint created, address in .env as CLUDE_DEVNET_MINT
 *   - Agent A + Agent B keypairs exist at demo-wallets/agent-{a,b}.json
 *   - Both agents have ATAs for $CLUDE-devnet, funded with ≥1 token
 *   - Both agents funded with ≥0.1 SOL for rent
 *
 * Run:
 *   npx tsx scripts/demo/two-agent-flow.ts
 *   # with --reset to retry a fresh pool each time:
 *   npx tsx scripts/demo/two-agent-flow.ts --reset
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  clusterApiUrl,
} from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, BN, Idl } from '@coral-xyz/anchor';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// ── Config ──────────────────────────────────────────────────────────────
const PROGRAM_ID = new PublicKey('GPc2p7rNNC23kd396zKgsCCTsRH1H3APxDUDRXLTVfdo');
const CLUDE_MINT = process.env.CLUDE_DEVNET_MINT
  ? new PublicKey(process.env.CLUDE_DEVNET_MINT)
  : null;
const CLUSTER_URL = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');

const REPO_ROOT = join(__dirname, '..', '..');
const IDL_PATH = join(REPO_ROOT, 'target', 'idl', 'memory_registry.json');
const WALLETS_DIR = join(REPO_ROOT, 'demo-wallets');

// Pool parameters (dust-level per spec §5.3)
const POOL_NAMESPACE_STR = 'defi-research-2026';
const WRITE_FEE = new BN(1_000_000);       // 0.001 $CLUDE (assuming 9 decimals)
const CITATION_FEE = new BN(100_000);      // 0.0001 $CLUDE

// ── Helpers ─────────────────────────────────────────────────────────────
function loadKeypair(name: string): Keypair {
  const path = join(WALLETS_DIR, `${name}.json`);
  try {
    const bytes = Uint8Array.from(JSON.parse(readFileSync(path, 'utf8')));
    return Keypair.fromSecretKey(bytes);
  } catch (err: any) {
    throw new Error(
      `Missing wallet at ${path}. Generate one with: solana-keygen new --outfile ${path} --no-bip39-passphrase`,
    );
  }
}

function padNamespace(s: string): Buffer {
  if (s.length > 32) throw new Error(`namespace too long: ${s.length} > 32`);
  const buf = Buffer.alloc(32);
  buf.write(s);
  return buf;
}

function explorerUrl(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

function explorerAccountUrl(addr: PublicKey): string {
  return `https://explorer.solana.com/address/${addr.toBase58()}?cluster=devnet`;
}

function headline(s: string): void {
  console.log(`\n━━━ ${s} ━━━`);
}

async function sleep(ms: number): Promise<void> {
  await new Promise(r => setTimeout(r, ms));
}

// ── Main flow ───────────────────────────────────────────────────────────
async function main(): Promise<void> {
  if (!CLUDE_MINT) {
    throw new Error(
      'CLUDE_DEVNET_MINT not set in .env. Run `spl-token create-token --decimals 9 --url devnet` and add to .env',
    );
  }

  headline('Setup');
  const connection = new Connection(CLUSTER_URL, 'confirmed');
  const agentA = loadKeypair('agent-a');
  const agentB = loadKeypair('agent-b');
  console.log(`Agent A: ${agentA.publicKey.toBase58()}`);
  console.log(`Agent B: ${agentB.publicKey.toBase58()}`);
  console.log(`$CLUDE-devnet mint: ${CLUDE_MINT.toBase58()}`);
  console.log(`Program: ${PROGRAM_ID.toBase58()}`);

  // Balance check
  const [solA, solB] = await Promise.all([
    connection.getBalance(agentA.publicKey),
    connection.getBalance(agentB.publicKey),
  ]);
  console.log(`Agent A SOL: ${(solA / 1e9).toFixed(4)}`);
  console.log(`Agent B SOL: ${(solB / 1e9).toFixed(4)}`);
  if (solA < 0.05e9 || solB < 0.05e9) {
    throw new Error('Agent wallets need ≥0.05 SOL each. Airdrop or transfer.');
  }

  // Load IDL
  const idl: Idl = JSON.parse(readFileSync(IDL_PATH, 'utf8'));

  // Anchor providers (one per agent so each signs its own tx)
  const providerA = new AnchorProvider(connection, new Wallet(agentA), {
    commitment: 'confirmed',
  });
  const providerB = new AnchorProvider(connection, new Wallet(agentB), {
    commitment: 'confirmed',
  });
  const programA = new Program(idl, providerA);
  const programB = new Program(idl, providerB);

  // ── Derive PDAs ───────────────────────────────────────────────────
  const namespace = padNamespace(POOL_NAMESPACE_STR);
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), namespace],
    PROGRAM_ID,
  );
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('treasury'), poolPda.toBuffer()],
    PROGRAM_ID,
  );

  // ATAs for $CLUDE-devnet
  const ataAgentA = await getAssociatedTokenAddress(CLUDE_MINT, agentA.publicKey);
  const ataAgentB = await getAssociatedTokenAddress(CLUDE_MINT, agentB.publicKey);
  // Treasury ATA is owned by the treasury PDA (offcurve=true)
  const ataTreasury = await getAssociatedTokenAddress(
    CLUDE_MINT,
    treasuryPda,
    true,
  );

  console.log(`Pool PDA:       ${poolPda.toBase58()}`);
  console.log(`Treasury PDA:   ${treasuryPda.toBase58()}`);
  console.log(`Treasury ATA:   ${ataTreasury.toBase58()}`);
  console.log(`Agent A ATA:    ${ataAgentA.toBase58()}`);
  console.log(`Agent B ATA:    ${ataAgentB.toBase58()}`);

  // ── Step 1: Create pool (Agent A is authority) ─────────────────────
  headline('1. Create pool');
  const poolInfo = await connection.getAccountInfo(poolPda);
  if (poolInfo) {
    console.log(`Pool already exists — reusing (${explorerAccountUrl(poolPda)})`);
  } else {
    const sig = await (programA.methods as any)
      .createPool(Array.from(namespace), WRITE_FEE, CITATION_FEE)
      .accounts({
        pool: poolPda,
        authority: agentA.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`✓ create_pool tx: ${sig}`);
    console.log(`  ${explorerUrl(sig)}`);
    await sleep(1000); // let the explorer catch up
  }

  // ── Step 2: Agent A stores a memory → pays 0.001 $CLUDE ────────────
  headline('2. Agent A stores memory → pays 0.001 $CLUDE');
  const contentHashStr = 'memory:arbitrum-tvl-report-2026-04-21';
  const contentHash = Buffer.alloc(32);
  contentHash.write(contentHashStr);
  const memoryId = new BN(Date.now()); // unique per run (ms timestamp)

  const [memoryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_mem'), poolPda.toBuffer(), memoryId.toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID,
  );

  const storeSig = await (programA.methods as any)
    .storeMemoryInPool(Array.from(contentHash), memoryId)
    .accounts({
      pool: poolPda,
      memory: memoryPda,
      authorTokenAccount: ataAgentA,
      treasuryTokenAccount: ataTreasury,
      author: agentA.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`✓ store_memory_in_pool tx: ${storeSig}`);
  console.log(`  ${explorerUrl(storeSig)}`);
  console.log(`  memory PDA: ${memoryPda.toBase58()}`);
  console.log(`  content hash: ${contentHashStr}`);
  await sleep(1000);

  // ── Step 3: Agent B cites Agent A's memory → pays 0.0001 $CLUDE ────
  headline('3. Agent B cites memory → pays 0.0001 $CLUDE to Agent A');
  // Derive citation PDA using CURRENT memory.citation_count (pre-increment)
  const memAccount = await (programA.account as any).poolMemoryRecord.fetch(memoryPda);
  const citationCount = memAccount.citationCount as BN;
  const [citationPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('citation'),
      memoryPda.toBuffer(),
      citationCount.toArrayLike(Buffer, 'le', 8),
    ],
    PROGRAM_ID,
  );

  const citeSig = await (programB.methods as any)
    .citeMemory()
    .accounts({
      pool: poolPda,
      memory: memoryPda,
      citation: citationPda,
      citerTokenAccount: ataAgentB,
      authorTokenAccount: ataAgentA,
      citer: agentB.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`✓ cite_memory tx: ${citeSig}`);
  console.log(`  ${explorerUrl(citeSig)}`);
  console.log(`  citation PDA: ${citationPda.toBase58()}`);
  await sleep(1000);

  // ── Summary ─────────────────────────────────────────────────────────
  headline('Flow complete');
  const updatedMem = await (programA.account as any).poolMemoryRecord.fetch(memoryPda);
  console.log(`Memory citation_count: ${updatedMem.citationCount.toString()}`);
  console.log(`Memory earnings (base units): ${updatedMem.earnings.toString()}`);
  const updatedPool = await (programA.account as any).pool.fetch(poolPda);
  console.log(`Pool memory_count:     ${updatedPool.memoryCount.toString()}`);
  console.log(`Pool citation_count:   ${updatedPool.citationCount.toString()}`);
  console.log('\nAll transactions confirmed on Solana devnet.');
  console.log(`  store_memory: ${explorerUrl(storeSig)}`);
  console.log(`  cite_memory:  ${explorerUrl(citeSig)}`);
  console.log(`  (pool already existed, reused. Fresh pool txs printed earlier if created this run.)`);
}

main().catch((err) => {
  console.error('\n✗ FAILED:', err.message || err);
  if (err.logs) console.error('Logs:', err.logs);
  process.exit(1);
});
