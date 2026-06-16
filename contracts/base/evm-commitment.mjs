// EVM side of PMP cross-chain commitment. Mirrors the Solana commit + VERIFY path:
// the same canonical memory-hash-v1 fingerprint is anchored on, and read back from,
// the MemoryCommitment contract. Chain-agnostic by construction — point it at a local
// anvil, Base Sepolia, or Base mainnet by changing (chain, rpc).
//
// Exposes deploy / commit / verify so the local E2E, the testnet deploy script, and the
// eventual EvmMintClient integration all share one implementation.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  createPublicClient, createWalletClient, http, getContract,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Load the compiled ABI + bytecode produced by compile.mjs. */
export function loadArtifact() {
  const a = JSON.parse(readFileSync(resolve(__dirname, 'out/MemoryCommitment.json'), 'utf8'));
  return { abi: a.abi, bytecode: a.bytecode };
}

/** A hex SHA-256 fingerprint (memory-hash-v1, 64 hex chars) -> bytes32 for the contract. */
export function toBytes32(hexHash) {
  const h = hexHash.startsWith('0x') ? hexHash.slice(2) : hexHash;
  if (h.length !== 64) throw new Error(`fingerprint must be 32 bytes (64 hex chars), got ${h.length}`);
  return `0x${h}`;
}

/** Build viem public + wallet clients for a given chain/RPC/key. */
export function makeClients({ chain, rpcUrl, privateKey }) {
  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl);
  return {
    account,
    publicClient: createPublicClient({ chain, transport }),
    walletClient: createWalletClient({ account, chain, transport }),
  };
}

/** Deploy MemoryCommitment. Returns the contract address. */
export async function deployCommitment({ walletClient, publicClient }) {
  const { abi, bytecode } = loadArtifact();
  const hash = await walletClient.deployContract({ abi, bytecode, args: [] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error('no contract address in receipt');
  return receipt.contractAddress;
}

/** Anchor a fingerprint on-chain. Returns the tx hash. */
export async function commitFingerprint({ walletClient, publicClient, address, fingerprintHex }) {
  const { abi } = loadArtifact();
  const c = getContract({ address, abi, client: { public: publicClient, wallet: walletClient } });
  const hash = await c.write.commit([toBytes32(fingerprintHex)]);
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/** Read-side cross-chain VERIFY: is this fingerprint anchored, and when? */
export async function verifyFingerprint({ publicClient, address, fingerprintHex }) {
  const { abi } = loadArtifact();
  const c = getContract({ address, abi, client: { public: publicClient } });
  const bytes32 = toBytes32(fingerprintHex);
  const committed = await c.read.isCommitted([bytes32]);
  const at = await c.read.committedAt([bytes32]);
  return { committed, committedAt: Number(at) };
}
