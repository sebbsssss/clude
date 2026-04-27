#!/usr/bin/env node
//
// Test helper — sends a USDC tier upgrade end-to-end without the web UI.
//
// Usage:
//   node scripts/sign-billing-upgrade.mjs \
//     --keypair ~/buyer.json \
//     --tier personal \
//     --hot <SINK_HOT_PUBKEY> \
//     [--rpc https://api.mainnet-beta.solana.com] \
//     [--api https://clude.io] \
//     [--dry-run]
//
// Reads a Solana keypair JSON file (the byte-array format `solana-keygen`
// writes), builds + sends a USDC transferChecked to the hot wallet,
// signs the canonical billing message, and POSTs /api/billing/upgrade.
//
// Designed for the runbook step 6 — first manual mainnet test.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { argv, exit } from 'node:process';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import * as splToken from '@solana/spl-token';
import nacl from 'tweetnacl';
import bs58Mod from 'bs58';
const bs58 = bs58Mod.default || bs58Mod;

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TIER_PRICE_USDC = { personal: 5, pro: 19 };

function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= argv.length) return fallback;
  return argv[i + 1];
}
function flag(name) {
  return argv.includes(`--${name}`);
}

const keypairPath = (arg('keypair') || '').replace(/^~/, homedir());
const tier = arg('tier');
const hotPubkeyStr = arg('hot');
const rpc = arg('rpc', 'https://api.mainnet-beta.solana.com');
const api = arg('api', 'https://clude.io');
const dryRun = flag('dry-run');

if (!keypairPath || !tier || !hotPubkeyStr) {
  console.error('usage: sign-billing-upgrade.mjs --keypair <path> --tier personal|pro --hot <pubkey> [--rpc URL] [--api URL] [--dry-run]');
  exit(1);
}
if (!(tier in TIER_PRICE_USDC)) {
  console.error(`unknown tier ${tier}; must be personal | pro`);
  exit(1);
}

const buyer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf-8'))));
const hot = new PublicKey(hotPubkeyStr);
const conn = new Connection(rpc, 'confirmed');

console.log(`buyer:   ${buyer.publicKey.toBase58()}`);
console.log(`tier:    ${tier} ($${TIER_PRICE_USDC[tier]})`);
console.log(`hot:     ${hot.toBase58()}`);
console.log(`rpc:     ${rpc}`);
console.log(`api:     ${api}`);
console.log('');

const usdcMint = new PublicKey(USDC_MINT);
const fromAta = await splToken.getAssociatedTokenAddress(usdcMint, buyer.publicKey);
const toAta = await splToken.getAssociatedTokenAddress(usdcMint, hot);
const amountMicro = BigInt(TIER_PRICE_USDC[tier]) * 1_000_000n;

if (dryRun) {
  console.log('--dry-run: would send', amountMicro.toString(), 'micro-USDC');
  console.log('  from ATA:', fromAta.toBase58());
  console.log('  to   ATA:', toAta.toBase58());
  exit(0);
}

console.log('Building USDC transferChecked…');
const ix = splToken.createTransferCheckedInstruction(
  fromAta,
  usdcMint,
  toAta,
  buyer.publicKey,
  amountMicro,
  6,
);
const tx = new Transaction().add(ix);
const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
tx.recentBlockhash = blockhash;
tx.lastValidBlockHeight = lastValidBlockHeight;
tx.feePayer = buyer.publicKey;
tx.sign(buyer);

console.log('Sending tx…');
const txSig = await conn.sendRawTransaction(tx.serialize());
console.log(`  tx: ${txSig}`);
console.log('Confirming…');
await conn.confirmTransaction({ signature: txSig, blockhash, lastValidBlockHeight }, 'confirmed');
console.log('  confirmed');

const canonical = `clude-billing-upgrade-v1:${buyer.publicKey.toBase58()}:${tier}:${txSig}`;
const sigBytes = nacl.sign.detached(Buffer.from(canonical, 'utf-8'), buyer.secretKey);
const signedMessage = bs58.encode(sigBytes);

console.log('Posting /api/billing/upgrade…');
const res = await fetch(`${api}/api/billing/upgrade`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    wallet: buyer.publicKey.toBase58(),
    tier,
    tx_sig: txSig,
    signed_message: signedMessage,
  }),
});
const body = await res.json();
console.log(`  HTTP ${res.status}`);
console.log('  response:', JSON.stringify(body, null, 2));

if (!res.ok) exit(1);
console.log('');
console.log(`✓ Tier active until ${body.active_until}`);
console.log(`  Solscan: https://solscan.io/tx/${txSig}`);
console.log('  Treasury dashboard will pick up the swap within ~1 hour.');
