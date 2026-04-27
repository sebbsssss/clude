// `clude snapshot` — cron-friendly MemoryPack snapshot.
//
// Writes a dated `.tar.zst` tarball to ~/.clude/snapshots/ (or a
// caller-supplied path). Intended for crontab — single-line stdout
// on success (the snapshot path), stderr only on failure, exit code
// drives the cron mailer.
//
// Local mode only in v0.2: cron is the natural pairing for users
// running Clude with `~/.clude/memories.json`. Hosted/self-hosted
// users can wrap `npx @clude/sdk export --format memorypack` in their
// own scheduling — they already have one.

import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import {
  writeMemoryPack,
  type MemoryPackRecord,
  ENCRYPTION_KEY_BYTES,
} from '../memorypack/index.js';

interface Args {
  out?: string;
  encryptKey?: string;
  showHelp: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(3);
  const args: Args = { showHelp: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.showHelp = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--encrypt-key') args.encryptKey = argv[++i];
  }
  return args;
}

function printUsage() {
  console.log(`Usage: clude snapshot [options]

  Writes a dated MemoryPack tarball of your local memories.

Options:
  --out <path>              Output path (default:
                            ~/.clude/snapshots/clude-YYYYMMDD-HHMMSS.tar.zst)
  --encrypt-key <base64>    Encrypt the snapshot (32 bytes, base64).
                            Without this, the snapshot is plaintext on
                            disk — fine for personal local backups,
                            but encrypt for anything you'll move off-host.

Cron example (daily 03:00):
  0 3 * * * /usr/local/bin/node /usr/local/lib/node_modules/@clude/sdk/dist/cli/index.js snapshot

Exit code: 0 on success, 1 on failure. Single-line stdout on success
(the snapshot path); errors go to stderr.`);
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function defaultOutPath(): string {
  const dir = join(homedir(), '.clude', 'snapshots');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, `clude-${timestamp()}.tar.zst`);
}

export async function runSnapshot(): Promise<void> {
  const args = parseArgs();
  if (args.showHelp) {
    printUsage();
    process.exit(0);
  }

  // ── load memories from local store ──
  let raw: any[];
  try {
    const { localRecall, localStats } = require('../mcp/local-store');
    const stats = localStats();
    if (stats.total_memories === 0) {
      console.error('clude snapshot: no local memories found in ~/.clude/memories.json');
      process.exit(1);
    }
    raw = localRecall({ query: '', limit: 10_000 });
  } catch (err: any) {
    console.error(`clude snapshot: failed to read local store: ${err.message}`);
    process.exit(1);
  }

  // ── shape into MemoryPackRecord ──
  const records: MemoryPackRecord[] = raw.map((m: any, i: number) => {
    const rec: MemoryPackRecord = {
      id: m.id ? String(m.id) : String(i + 1),
      created_at: m.created_at || new Date().toISOString(),
      kind: m.type || m.memory_type || 'episodic',
      content: m.content || '',
      tags: m.tags || [],
      importance: typeof m.importance === 'number' ? m.importance : 0.5,
      source: m.source || '',
    };
    if (m.summary) rec.summary = m.summary;
    if (m.access_count != null) rec.access_count = m.access_count;
    if (m.last_accessed_at) rec.last_accessed_at = m.last_accessed_at;
    return rec;
  });

  // ── pull wallet for signing if available ──
  let secretKey: Uint8Array | undefined;
  let publicKey: string | undefined;
  try {
    const { getBotWallet } = require('@clude/shared/core/solana-client');
    const wallet = getBotWallet();
    if (wallet) {
      secretKey = wallet.secretKey;
      publicKey = wallet.publicKey.toBase58();
    }
  } catch {
    /* unsigned snapshot — fine for local backup */
  }

  // ── decode encryption key if supplied ──
  let encryption: { key: Uint8Array } | undefined;
  if (args.encryptKey) {
    const buf = Buffer.from(args.encryptKey, 'base64');
    if (buf.length !== ENCRYPTION_KEY_BYTES) {
      console.error(
        `clude snapshot: --encrypt-key must decode to ${ENCRYPTION_KEY_BYTES} bytes (got ${buf.length})`,
      );
      process.exit(1);
    }
    encryption = { key: new Uint8Array(buf) };
  }

  // ── write tarball ──
  const outPath = args.out || defaultOutPath();
  try {
    writeMemoryPack(outPath, records, {
      producer: {
        name: 'clude',
        version: '3.1.0',
        public_key: publicKey,
      },
      record_schema: 'clude-memory-v3',
      secretKey,
      anchor_chain: 'solana-mainnet',
      format: 'tarball',
      encryption,
    });
  } catch (err: any) {
    console.error(`clude snapshot: write failed: ${err.message}`);
    process.exit(1);
  }

  // Single-line success — cron-friendly.
  console.log(outPath);
}
