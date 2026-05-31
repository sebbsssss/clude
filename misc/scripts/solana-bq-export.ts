/**
 * solana-bq-export.ts
 *
 * One-time BigQuery export of a bounded, reproducible Solana fact corpus.
 * Dataset : bigquery-public-data.crypto_solana_mainnet_us
 * Frozen date : 2025-03-31 (export authored)
 * Fixed window : block_timestamp BETWEEN "2025-03-25 00:00:00" AND "2025-03-25 00:05:00"
 *   → partition-pruned, cheap scan, confirmed ~1 500 txns/block in this range
 *   → slots start ~328969452
 *
 * Output: misc/datasets/solana-bq/facts.jsonl (one JSON fact per line)
 *
 * Usage (from repo root):
 *   /Users/sebastien/Projects/cluude-bot/node_modules/.bin/tsx misc/scripts/solana-bq-export.ts
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PROJECT_ID = 'clude-query-sol-data';
const WINDOW_START = '2025-03-25 00:00:00';
const WINDOW_END = '2025-03-25 00:05:00';
const ROW_LIMIT = 250;

const DATASET_DIR = path.join(__dirname, '..', 'datasets', 'solana-bq');
const OUT_FILE = path.join(DATASET_DIR, 'facts.jsonl');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bqQuery(sql: string): Record<string, unknown>[] {
  const bqBin = `${process.env['HOME']}/google-cloud-sdk/bin/bq`;
  const cmd = `export PATH="${process.env['HOME']}/google-cloud-sdk/bin:$PATH"; ${bqBin} query --quiet --use_legacy_sql=false --format=json --project_id=${PROJECT_ID} '${sql}'`;

  const stdout = execFileSync('bash', ['-lc', cmd], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  const trimmed = stdout.trim();
  if (!trimmed || trimmed === '[]') return [];
  return JSON.parse(trimmed) as Record<string, unknown>[];
}

function writeLines(lines: string[], fd: number): void {
  for (const line of lines) {
    fs.writeSync(fd, line + '\n');
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function fetchBlocks(): Record<string, unknown>[] {
  console.log('Fetching Blocks...');
  const sql = `
SELECT
  slot,
  FORMAT_TIMESTAMP("%Y-%m-%dT%H:%M:%SZ", block_timestamp) AS block_time,
  leader,
  transaction_count,
  block_hash
FROM \`bigquery-public-data.crypto_solana_mainnet_us.Blocks\`
WHERE block_timestamp BETWEEN TIMESTAMP("${WINDOW_START}") AND TIMESTAMP("${WINDOW_END}")
  AND leader IS NOT NULL
LIMIT ${ROW_LIMIT}
`.trim().replace(/\n/g, ' ');

  const rows = bqQuery(sql);
  return rows.map((r) => ({
    id: `block:${r['slot']}`,
    category: 'block',
    slot: r['slot'],
    block_time: r['block_time'],
    leader: r['leader'],
    transaction_count: r['transaction_count'],
    block_hash: r['block_hash'],
  }));
}

function fetchTransactions(): Record<string, unknown>[] {
  console.log('Fetching Transactions...');
  const sql = `
SELECT
  signature,
  block_slot,
  CAST(fee AS STRING) AS fee,
  status,
  CAST(compute_units_consumed AS STRING) AS compute_units
FROM \`bigquery-public-data.crypto_solana_mainnet_us.Transactions\`
WHERE block_timestamp BETWEEN TIMESTAMP("${WINDOW_START}") AND TIMESTAMP("${WINDOW_END}")
  AND signature IS NOT NULL
LIMIT ${ROW_LIMIT}
`.trim().replace(/\n/g, ' ');

  const rows = bqQuery(sql);
  return rows.map((r) => ({
    id: `tx:${r['signature']}`,
    category: 'tx',
    signature: r['signature'],
    block_slot: r['block_slot'],
    fee: r['fee'],
    status: r['status'],
    compute_units: r['compute_units'],
  }));
}

function fetchAccounts(): Record<string, unknown>[] {
  console.log('Fetching Accounts...');
  const sql = `
SELECT
  pubkey,
  owner,
  CAST(lamports AS STRING) AS lamports,
  executable,
  program
FROM \`bigquery-public-data.crypto_solana_mainnet_us.Accounts\`
WHERE block_timestamp BETWEEN TIMESTAMP("${WINDOW_START}") AND TIMESTAMP("${WINDOW_END}")
  AND owner IS NOT NULL
LIMIT ${ROW_LIMIT}
`.trim().replace(/\n/g, ' ');

  const rows = bqQuery(sql);
  return rows.map((r) => ({
    id: `account:${r['pubkey']}`,
    category: 'account',
    pubkey: r['pubkey'],
    owner: r['owner'],
    lamports: r['lamports'],
    executable: r['executable'],
    program: r['program'],
  }));
}

function fetchTokens(): Record<string, unknown>[] {
  console.log('Fetching Tokens...');
  const sql = `
SELECT
  mint,
  name,
  symbol,
  is_nft
FROM \`bigquery-public-data.crypto_solana_mainnet_us.Tokens\`
WHERE block_timestamp BETWEEN TIMESTAMP("${WINDOW_START}") AND TIMESTAMP("${WINDOW_END}")
  AND symbol IS NOT NULL
LIMIT ${ROW_LIMIT}
`.trim().replace(/\n/g, ' ');

  const rows = bqQuery(sql);
  return rows.map((r) => ({
    id: `token:${r['mint']}`,
    category: 'token',
    mint: r['mint'],
    name: r['name'],
    symbol: r['symbol'],
    is_nft: r['is_nft'],
  }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  console.log('=== Solana BigQuery Export ===');
  console.log(`Window : ${WINDOW_START} → ${WINDOW_END}`);
  console.log(`Output : ${OUT_FILE}`);
  console.log('');

  // Ensure output directory exists
  fs.mkdirSync(DATASET_DIR, { recursive: true });

  // Open file for writing (truncate if exists)
  const fd = fs.openSync(OUT_FILE, 'w');

  try {
    const blocks = fetchBlocks();
    console.log(`  → ${blocks.length} blocks`);
    writeLines(blocks.map((r) => JSON.stringify(r)), fd);

    const txns = fetchTransactions();
    console.log(`  → ${txns.length} transactions`);
    writeLines(txns.map((r) => JSON.stringify(r)), fd);

    const accounts = fetchAccounts();
    console.log(`  → ${accounts.length} accounts`);
    writeLines(accounts.map((r) => JSON.stringify(r)), fd);

    const tokens = fetchTokens();
    console.log(`  → ${tokens.length} tokens`);
    writeLines(tokens.map((r) => JSON.stringify(r)), fd);

    const total = blocks.length + txns.length + accounts.length + tokens.length;
    console.log('');
    console.log(`Total lines written: ${total}`);

    // Sanity-check: print first line of each category
    console.log('');
    console.log('--- Sample lines ---');
    if (blocks.length > 0) console.log('block:', JSON.stringify(blocks[0]));
    if (txns.length > 0) console.log('tx:   ', JSON.stringify(txns[0]));
    if (accounts.length > 0) console.log('acct: ', JSON.stringify(accounts[0]));
    if (tokens.length > 0) console.log('token:', JSON.stringify(tokens[0]));
  } finally {
    fs.closeSync(fd);
  }

  console.log('');
  console.log('Done. facts.jsonl written successfully.');
}

main();
