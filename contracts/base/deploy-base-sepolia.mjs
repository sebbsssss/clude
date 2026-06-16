// Deploy MemoryCommitment to Base Sepolia and anchor a real memory fingerprint.
// Run this once the deployer address (contracts/base/.deployer.env) is funded with
// Base Sepolia testnet ETH. Same code path as the local E2E — only the chain changes.
//
//   node contracts/base/deploy-base-sepolia.mjs
//
// Prints the contract address + Basescan links, and writes contracts/base/deployed.json
// so the live cross-chain VERIFY route can be pointed at it.

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { baseSepolia } from 'viem/chains';
import { formatEther } from 'viem';
import { makeClients, deployCommitment, commitFingerprint, verifyFingerprint } from './evm-commitment.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org';
const SCAN = 'https://sepolia.basescan.org';
const SHOWCASE = 'clude-11db4f18'; // a memory already committed on Solana

function loadDeployerKey() {
  const env = readFileSync(resolve(__dirname, '.deployer.env'), 'utf8');
  const m = env.match(/BASE_SEPOLIA_DEPLOYER_PK=(0x[0-9a-fA-F]+)/);
  if (!m) throw new Error('BASE_SEPOLIA_DEPLOYER_PK not found in .deployer.env');
  return m[1];
}

async function solanaFingerprint(hashId) {
  const r = await fetch(`https://clude.io/v1/memories/${hashId}/verify`);
  const v = await r.json();
  if (!v.recomputed_hash) throw new Error(`no fingerprint for ${hashId}`);
  return v.recomputed_hash;
}

async function main() {
  const pk = loadDeployerKey();
  const { publicClient, walletClient, account } = makeClients({ chain: baseSepolia, rpcUrl: RPC, privateKey: pk });

  console.log('Deploying PMP MemoryCommitment to Base Sepolia\n');
  console.log(`  deployer: ${account.address}`);
  const bal = await publicClient.getBalance({ address: account.address });
  console.log(`  balance:  ${formatEther(bal)} ETH`);
  if (bal === 0n) {
    console.error('\n🛑 Deployer has 0 testnet ETH. Fund it from a Base Sepolia faucet first:');
    console.error('   https://portal.cdp.coinbase.com/products/faucet  (or alchemy / quicknode)');
    process.exit(1);
  }

  // Deploy.
  const address = await deployCommitment({ walletClient, publicClient });
  console.log(`\n  contract: ${address}`);
  console.log(`            ${SCAN}/address/${address}`);

  // Anchor the same fingerprint that is live on Solana — cross-chain, no bridge.
  const fp = await solanaFingerprint(SHOWCASE);
  const txHash = await commitFingerprint({ walletClient, publicClient, address, fingerprintHex: fp });
  console.log(`\n  anchored ${SHOWCASE} fingerprint on Base:`);
  console.log(`    ${fp}`);
  console.log(`    tx: ${SCAN}/tx/${txHash}`);

  // Confirm read-side VERIFY on Base.
  const out = await verifyFingerprint({ publicClient, address, fingerprintHex: fp });
  console.log(`\n  verified on Base: ${out.committed} (committedAt=${out.committedAt})`);

  writeFileSync(resolve(__dirname, 'deployed.json'), JSON.stringify({
    chain: 'base-sepolia', address, rpc: RPC, scan: SCAN,
    deployer: account.address, anchoredMemory: SHOWCASE, anchoredFingerprint: fp, commitTx: txHash,
  }, null, 2));
  console.log('\n✅ Base Sepolia is live. Same memory-hash-v1 fingerprint now verifiable on Solana AND Base.');
  console.log('   Wrote contracts/base/deployed.json for the cross-chain VERIFY wiring.');
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL', e.message); process.exit(1); });
