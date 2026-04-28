#!/usr/bin/env node
// @clude/memorypack — standalone CLI verifier.
//
// Designed for auditors and long-term preservation. Install one tiny
// package, point it at a pack, get a clean OK/REJECTED with exit code
// 0/1. No Clude SDK, no Supabase, no API keys.
//
// Usage:
//   npx @clude/memorypack verify <pack> [options]
//
// Run with no args to see the help text.

import { readMemoryPack } from './reader.js';
import { verifyChainAnchors } from './chain-verify.js';

// ── Tiny ANSI helpers (no deps) ────────────────────────────────────
const isTTY = process.stdout.isTTY;
const noColor = !isTTY || process.env.NO_COLOR != null || process.env.TERM === 'dumb';
const ansi = (code: string, s: string) => (noColor ? s : `\x1b[${code}m${s}\x1b[0m`);
const c = {
  dim: (s: string) => ansi('2', s),
  bold: (s: string) => ansi('1', s),
  green: (s: string) => ansi('32', s),
  yellow: (s: string) => ansi('33', s),
  red: (s: string) => ansi('31', s),
};

// ── Args ───────────────────────────────────────────────────────────

interface Args {
  command: 'verify' | 'help' | 'version';
  path: string;
  publicKey?: string;
  strictSignatures: boolean;
  verifyChain: boolean;
  strictChain: boolean;
  rpcUrl: string;
  cluster?: 'mainnet' | 'mainnet-beta' | 'devnet' | 'testnet';
  decryptKey?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: 'help',
    path: '',
    strictSignatures: false,
    verifyChain: false,
    strictChain: false,
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  };
  if (argv.length === 0) return args;

  // First positional must be the subcommand
  const first = argv[0];
  if (first === '--version' || first === '-v') {
    args.command = 'version';
    return args;
  }
  if (first === '--help' || first === '-h' || first === 'help') {
    args.command = 'help';
    return args;
  }
  if (first !== 'verify') {
    throw new Error(`unknown command "${first}". Run with --help for usage.`);
  }
  args.command = 'verify';

  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.command = 'help';
      return args;
    }
    if (a === '--public-key') args.publicKey = argv[++i];
    else if (a === '--strict-signatures') args.strictSignatures = true;
    else if (a === '--strict-chain') args.strictChain = true;
    else if (a === '--verify-chain') args.verifyChain = true;
    else if (a === '--rpc-url') args.rpcUrl = argv[++i];
    else if (a === '--cluster') args.cluster = argv[++i] as Args['cluster'];
    else if (a === '--decrypt-key') args.decryptKey = argv[++i];
    else if (!a.startsWith('--') && !args.path) args.path = a;
    else throw new Error(`unknown argument "${a}". Run with --help for usage.`);
  }
  return args;
}

function printUsage(): void {
  console.log(`@clude/memorypack — standalone MemoryPack verifier

Usage:
  npx @clude/memorypack verify <pack> [options]
  npx @clude/memorypack --version
  npx @clude/memorypack --help

Options:
  --public-key <base58>     Override the public key (default: from manifest)
  --strict-signatures       Fail if any record is unsigned
  --verify-chain            Also verify Solana on-chain anchors
  --strict-chain            Fail on any chain verification mismatch
  --rpc-url <url>           Solana RPC URL for chain verification
                            (default: SOLANA_RPC_URL env or mainnet-beta)
  --cluster <name>          Cross-check RPC genesis hash (mainnet | devnet | testnet)
  --decrypt-key <base64>    Pack-level decryption key (32 bytes, base64)

Exit code: 0 if valid, 1 if any check failed.

For the format spec: https://github.com/sebbsssss/clude/blob/main/docs/memorypack.md`);
}

function printVersion(): void {
  // Read package.json next to dist/. When running from src (tsx / vitest),
  // walk up two dirs; from dist, walk up one. Try both.
  const fs = require('fs');
  const path = require('path');
  const candidates = [
    path.join(__dirname, '..', 'package.json'),
    path.join(__dirname, '..', '..', 'package.json'),
  ];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (pkg.name === '@clude/memorypack') {
        console.log(pkg.version);
        return;
      }
    } catch {
      /* fall through */
    }
  }
  console.log('(version unknown — package.json not located)');
}

// ── Verify command ─────────────────────────────────────────────────

async function runVerify(args: Args): Promise<number> {
  if (!args.path) {
    printUsage();
    return 1;
  }

  console.log(`${c.bold('MemoryPack verify')}  ${c.dim(args.path)}\n`);

  let decryptionKey: Uint8Array | undefined;
  if (args.decryptKey) {
    decryptionKey = new Uint8Array(Buffer.from(args.decryptKey, 'base64'));
  }

  let result;
  try {
    result = readMemoryPack(args.path, {
      publicKey: args.publicKey,
      strictSignatures: args.strictSignatures,
      decryptionKey,
    });
  } catch (e: any) {
    console.error(`${c.red('REJECTED')}: ${e.message}`);
    return 1;
  }

  const {
    manifest,
    records,
    verifiedRecords,
    unsignedRecords,
    anchors,
    verifiedBlobs,
    revocations,
    revokedRecordHashes,
    minimalRecords,
    warnings,
  } = result;

  // Manifest summary
  console.log(`  ${c.dim('producer:')}        ${manifest.producer.name} ${manifest.producer.version}`);
  if (manifest.producer.did) console.log(`  ${c.dim('did:')}             ${manifest.producer.did}`);
  if (manifest.producer.public_key) console.log(`  ${c.dim('public_key:')}      ${manifest.producer.public_key}`);
  console.log(`  ${c.dim('created_at:')}      ${manifest.created_at}`);
  console.log(`  ${c.dim('records:')}         ${records.length}`);
  console.log(`  ${c.dim('schema:')}          ${manifest.record_schema}`);
  console.log(`  ${c.dim('encryption:')}      ${manifest.encryption ? `${manifest.encryption.algorithm} (scope=${manifest.encryption.scope})` : 'none'}`);
  console.log(`  ${c.dim('pack_format:')}     ${manifest.pack_format ?? 'directory'}`);
  console.log();

  // Signatures
  console.log(`  ${c.bold('Signatures')}`);
  console.log(`    verified:    ${c.green(String(verifiedRecords.size))}`);
  console.log(`    unsigned:    ${unsignedRecords.size}`);
  console.log();

  // Blobs (only when declared)
  if (verifiedBlobs.size > 0 || manifest.blobs_count) {
    console.log(`  ${c.bold('Blobs')}`);
    console.log(`    verified:    ${c.green(String(verifiedBlobs.size))} of ${manifest.blobs_count ?? '?'}`);
    console.log();
  }

  // Revocations (only when present)
  if (revocations.length > 0) {
    console.log(`  ${c.bold('Revocations')}`);
    console.log(`    verified:    ${c.green(String(revocations.length))}`);
    console.log(`    distinct records affected: ${revokedRecordHashes.size}`);
    console.log();
  }

  // Anchors
  console.log(`  ${c.bold('Anchors')}`);
  console.log(`    declared:    ${anchors.length}`);

  let chainFailed = false;
  if (args.verifyChain && anchors.length > 0) {
    process.stdout.write('    fetching:    ');
    try {
      const expectedSigner = args.publicKey ?? manifest.producer.public_key;
      const { verified, warnings: chainWarnings } = await verifyChainAnchors(anchors, {
        rpcUrl: args.rpcUrl,
        cluster: args.cluster,
        expectedSigner,
        strict: args.strictChain,
      });
      console.log(`${c.green(String(verified.size))}/${anchors.length} verified on-chain`);
      for (const w of chainWarnings) console.log(`    ${c.yellow('warn:')} ${w}`);
      if (verified.size < anchors.length) chainFailed = true;
    } catch (e: any) {
      console.log(c.red('FAILED'));
      console.error(`    ${c.red(e.message)}`);
      chainFailed = true;
    }
  }
  console.log();

  // Encryption / minimal diagnostic
  if (manifest.encryption) {
    console.log(`  ${c.bold('Encryption')}`);
    if (decryptionKey) {
      const decrypted = records.filter((r) => !r.encrypted).length;
      console.log(`    decrypted:   ${c.green(String(decrypted))} of ${records.length}`);
    } else {
      console.log(`    ${c.yellow(`no --decrypt-key supplied; ${records.length - minimalRecords.length} record(s) excluded from minimalRecords`)}`);
    }
    console.log();
  }

  // Warnings
  if (warnings.length > 0) {
    console.log(`  ${c.bold('Warnings')}`);
    for (const w of warnings) console.log(`    ${c.yellow('!')} ${w}`);
    console.log();
  }

  if (chainFailed) {
    console.log(`${c.red('REJECTED')}  Chain verification incomplete.`);
    return 1;
  }
  console.log(`${c.green('OK')}  Pack is valid.`);
  return 0;
}

// ── Entry point ────────────────────────────────────────────────────

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e: any) {
    console.error(`${c.red('error:')} ${e.message}`);
    return 1;
  }

  switch (args.command) {
    case 'help':
      printUsage();
      return 0;
    case 'version':
      printVersion();
      return 0;
    case 'verify':
      return await runVerify(args);
  }
}

// Only auto-run when invoked directly as a script. Importing this
// module in tests / programmatic callers won't trigger main().
if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(`${c.red('fatal:')} ${err.message ?? err}`);
    process.exit(1);
  });
}

export { runVerify, parseArgs, printUsage, printVersion };
