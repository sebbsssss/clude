// `clude verify <pack>` — standalone MemoryPack verifier.
//
// Validates a pack against just a wallet pubkey + an RPC. No Clude
// server, no Supabase. Designed for auditors and long-term preservation:
// a regulator in 2030 should be able to verify with nothing but Node,
// this CLI, and (optionally) a Solana RPC.

import {
  readMemoryPack,
  verifyChainAnchors,
} from '../memorypack/index.js';
import { c } from './banner.js';

interface Args {
  path: string;
  publicKey?: string;
  strictSignatures: boolean;
  verifyChain: boolean;
  rpcUrl: string;
  cluster?: 'mainnet' | 'mainnet-beta' | 'devnet' | 'testnet';
  decryptKey?: string;
  strictChain: boolean;
  showHelp: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(3);
  const args: Args = {
    path: '',
    strictSignatures: false,
    verifyChain: false,
    strictChain: false,
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    showHelp: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.showHelp = true;
    else if (a === '--public-key') args.publicKey = argv[++i];
    else if (a === '--strict-signatures') args.strictSignatures = true;
    else if (a === '--strict-chain') args.strictChain = true;
    else if (a === '--verify-chain') args.verifyChain = true;
    else if (a === '--rpc-url') args.rpcUrl = argv[++i];
    else if (a === '--cluster') args.cluster = argv[++i] as Args['cluster'];
    else if (a === '--decrypt-key') args.decryptKey = argv[++i];
    else if (!a.startsWith('--') && !args.path) args.path = a;
  }
  return args;
}

function printUsage() {
  console.log(`Usage: clude verify <pack> [options]

  Validates a MemoryPack directory or .tar.zst tarball.

Options:
  --public-key <base58>     Override the public key (default: from manifest)
  --strict-signatures       Fail if any record is unsigned
  --verify-chain            Also verify Solana on-chain anchors
  --strict-chain            Fail on any chain verification mismatch
  --rpc-url <url>           Solana RPC URL for chain verification
                            (default: SOLANA_RPC_URL env or mainnet-beta)
  --cluster <name>          Cross-check RPC genesis hash against this
                            cluster (mainnet | devnet | testnet)
  --decrypt-key <base64>    Pack-level decryption key (32 bytes, base64)

Exit code: 0 if valid, 1 if any check failed.`);
}

export async function runVerify(): Promise<void> {
  const args = parseArgs();
  if (args.showHelp || !args.path) {
    printUsage();
    process.exit(args.showHelp ? 0 : 1);
  }

  console.log(`${c.bold}MemoryPack verify${c.reset}  ${c.dim}${args.path}${c.reset}\n`);

  // Decode the optional decryption key.
  let decryptionKey: Uint8Array | undefined;
  if (args.decryptKey) {
    const buf = Buffer.from(args.decryptKey, 'base64');
    decryptionKey = new Uint8Array(buf);
  }

  // ── Read the pack. ──
  let result;
  try {
    result = readMemoryPack(args.path, {
      publicKey: args.publicKey,
      strictSignatures: args.strictSignatures,
      decryptionKey,
    });
  } catch (e: any) {
    console.error(`${c.red}REJECTED${c.reset}: ${e.message}`);
    process.exit(1);
  }

  const {
    manifest,
    records,
    verifiedRecords,
    unsignedRecords,
    anchors,
    verifiedBlobs,
    minimalRecords,
    warnings,
  } = result;

  // ── Manifest summary. ──
  console.log(`  ${c.dim}producer:${c.reset}        ${manifest.producer.name} ${manifest.producer.version}`);
  if (manifest.producer.did) console.log(`  ${c.dim}did:${c.reset}             ${manifest.producer.did}`);
  if (manifest.producer.public_key) console.log(`  ${c.dim}public_key:${c.reset}      ${manifest.producer.public_key}`);
  console.log(`  ${c.dim}created_at:${c.reset}      ${manifest.created_at}`);
  console.log(`  ${c.dim}records:${c.reset}         ${records.length}`);
  console.log(`  ${c.dim}schema:${c.reset}          ${manifest.record_schema}`);
  console.log(`  ${c.dim}encryption:${c.reset}      ${manifest.encryption ? `${manifest.encryption.algorithm} (scope=${manifest.encryption.scope})` : 'none'}`);
  console.log(`  ${c.dim}pack_format:${c.reset}     ${manifest.pack_format ?? 'directory'}`);
  console.log();

  // ── Signatures. ──
  console.log(`  ${c.bold}Signatures${c.reset}`);
  console.log(`    verified:    ${c.green}${verifiedRecords.size}${c.reset}`);
  console.log(`    unsigned:    ${unsignedRecords.size}`);
  console.log();

  // ── Blobs (only when present). ──
  if (verifiedBlobs.size > 0 || manifest.blobs_count) {
    console.log(`  ${c.bold}Blobs${c.reset}`);
    const declared = manifest.blobs_count ?? '?';
    console.log(`    verified:    ${c.green}${verifiedBlobs.size}${c.reset} of ${declared}`);
    console.log();
  }

  // ── Anchors (always show count; verify on demand). ──
  console.log(`  ${c.bold}Anchors${c.reset}`);
  console.log(`    declared:    ${anchors.length}`);

  let chainFailed = false;
  if (args.verifyChain && anchors.length > 0) {
    process.stdout.write(`    fetching:    `);
    try {
      const expectedSigner = args.publicKey ?? manifest.producer.public_key;
      const { verified, warnings: chainWarnings } = await verifyChainAnchors(anchors, {
        rpcUrl: args.rpcUrl,
        cluster: args.cluster,
        expectedSigner,
        strict: args.strictChain,
      });
      const ok = verified.size;
      console.log(`${c.green}${ok}${c.reset}/${anchors.length} verified on-chain`);
      if (chainWarnings.length > 0) {
        for (const w of chainWarnings) console.log(`    ${c.yellow}warn:${c.reset} ${w}`);
      }
      if (ok < anchors.length) chainFailed = true;
    } catch (e: any) {
      console.log(`${c.red}FAILED${c.reset}`);
      console.error(`    ${c.red}${e.message}${c.reset}`);
      chainFailed = true;
    }
  }
  console.log();

  // ── Decryption / minimal-shape diagnostic. ──
  if (manifest.encryption) {
    console.log(`  ${c.bold}Encryption${c.reset}`);
    if (decryptionKey) {
      const decrypted = records.filter((r) => !r.encrypted).length;
      console.log(`    decrypted:   ${c.green}${decrypted}${c.reset} of ${records.length}`);
    } else {
      console.log(`    ${c.yellow}no --decrypt-key supplied; ${records.length - minimalRecords.length} record(s) excluded from minimalRecords${c.reset}`);
    }
    console.log();
  }

  // ── Warnings. ──
  if (warnings.length > 0) {
    console.log(`  ${c.bold}Warnings${c.reset}`);
    for (const w of warnings) console.log(`    ${c.yellow}!${c.reset} ${w}`);
    console.log();
  }

  if (chainFailed) {
    console.log(`${c.red}REJECTED${c.reset}  Chain verification incomplete.`);
    process.exit(1);
  }
  console.log(`${c.green}OK${c.reset}  Pack is valid.`);
}
