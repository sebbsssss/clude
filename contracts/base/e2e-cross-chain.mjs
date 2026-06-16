// Local cross-chain proof: take a memory fingerprint that is ALREADY committed on
// Solana (a live showcase memory) and anchor + verify the SAME fingerprint on an EVM
// chain via the MemoryCommitment contract. Proves PMP is chain-neutral: one canonical
// memory-hash-v1 fingerprint, verifiable on Solana and on EVM, no bridge.
//
// Runs against a local anvil node (no testnet, no funded wallet). Tomorrow the only
// change is (chain, rpcUrl, privateKey) -> Base Sepolia. Run: node contracts/base/e2e-cross-chain.mjs

import { spawn } from 'child_process';
import { anvil } from 'viem/chains';
import { makeClients, deployCommitment, commitFingerprint, verifyFingerprint } from './evm-commitment.mjs';

const RPC = 'http://127.0.0.1:8545';
// anvil's deterministic prefunded account #0 (well-known dev key, local only).
const ANVIL_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ANVIL_BIN = `${process.env.HOME}/.foundry/bin/anvil`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpcUp() {
  try {
    const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
    return r.ok;
  } catch { return false; }
}

async function solanaFingerprint(hashId) {
  const r = await fetch(`https://clude.io/v1/memories/${hashId}/verify`);
  const v = await r.json();
  if (!v.recomputed_hash) throw new Error(`no fingerprint for ${hashId}`);
  return { hash: v.recomputed_hash, solscan: v.solscan_url, verified: v.verified };
}

async function main() {
  console.log('PMP cross-chain proof — same fingerprint, Solana + EVM\n');

  // 1. A real memory already anchored on Solana.
  const id = 'clude-11db4f18';
  const sol = await solanaFingerprint(id);
  console.log(`Solana side (live):`);
  console.log(`  memory:      ${id}`);
  console.log(`  fingerprint: ${sol.hash}`);
  console.log(`  verified:    ${sol.verified}`);
  console.log(`  proof:       ${sol.solscan ? sol.solscan.slice(0, 56) + '…' : '(legacy)'}\n`);

  // 2. Local EVM (stand-in for Base; identical code path).
  const node = spawn(ANVIL_BIN, ['--silent'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 50 && !(await rpcUp()); i++) await sleep(200);
    if (!(await rpcUp())) throw new Error('anvil did not start');

    const { publicClient, walletClient, account } = makeClients({ chain: anvil, rpcUrl: RPC, privateKey: ANVIL_PK });
    console.log(`EVM side (local anvil, stands in for Base Sepolia):`);
    console.log(`  deployer:    ${account.address}`);

    const address = await deployCommitment({ walletClient, publicClient });
    console.log(`  contract:    ${address}`);

    // 3. Anchor the SAME Solana fingerprint on the EVM chain.
    const txHash = await commitFingerprint({ walletClient, publicClient, address, fingerprintHex: sol.hash });
    console.log(`  commit tx:   ${txHash}`);

    // 4. Read-side cross-chain VERIFY against the EVM contract.
    const out = await verifyFingerprint({ publicClient, address, fingerprintHex: sol.hash });
    console.log(`  verified:    ${out.committed} (committedAt=${out.committedAt})\n`);

    // 5. Negative control: a different fingerprint must NOT verify.
    const bogus = 'f'.repeat(64);
    const neg = await verifyFingerprint({ publicClient, address, fingerprintHex: bogus });

    const pass = out.committed === true && out.committedAt > 0 && neg.committed === false;
    if (!pass) throw new Error(`cross-chain assertion failed: ${JSON.stringify({ out, neg })}`);

    console.log('✅ PASS — the same memory-hash-v1 fingerprint that is committed on Solana');
    console.log('   was anchored and verified on EVM through one shared code path.');
    console.log('   Negative control rejected an unknown fingerprint. Cross-chain compatible.');
  } finally {
    node.kill('SIGKILL');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL', e.message); process.exit(1); });
