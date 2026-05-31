/**
 * solana-qa-gen.ts
 *
 * Reads misc/datasets/solana-bq/facts.jsonl, converts each fact into one or more
 * SolanaQA items using the shared grader, and writes the result to
 * apps/web/public/proof/solana-qa.json.
 *
 * Run with:
 *   /Users/sebastien/Projects/cluude-bot/node_modules/.bin/tsx misc/scripts/solana-qa-gen.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { factToQA, type SolanaQA } from '../../packages/shared/src/core/solana-grading.js';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const INPUT_PATH = path.join(REPO_ROOT, 'misc', 'datasets', 'solana-bq', 'facts.jsonl');
const OUTPUT_DIR = path.join(REPO_ROOT, 'apps', 'web', 'public', 'proof');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'solana-qa.json');

async function main(): Promise<void> {
  const items: SolanaQA[] = [];
  const categoryCounts: Record<string, number> = {};

  const rl = readline.createInterface({
    input: fs.createReadStream(INPUT_PATH),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const fact = JSON.parse(trimmed) as Record<string, string>;
    const qas = factToQA(fact);
    for (const qa of qas) {
      items.push(qa);
      categoryCounts[qa.category] = (categoryCounts[qa.category] ?? 0) + 1;
    }
  }

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const output = {
    datasetVersion: 'crypto_solana_mainnet_us@2025-03-31',
    generatedFrom: 'misc/datasets/solana-bq/facts.jsonl',
    count: items.length,
    items,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\nWritten to: ${OUTPUT_PATH}`);
  console.log(`Total QA items: ${items.length}`);
  console.log('\nCategory counts:');
  for (const [cat, count] of Object.entries(categoryCounts).sort()) {
    console.log(`  ${cat}: ${count}`);
  }

  console.log('\nSample items (one per category):');
  const seen = new Set<string>();
  for (const qa of items) {
    if (!seen.has(qa.category)) {
      seen.add(qa.category);
      console.log(`\n  [${qa.category}]`);
      console.log(`    question: ${qa.question}`);
      console.log(`    gold:     ${qa.gold}`);
      console.log(`    sourceRef:${qa.sourceRef}`);
    }
  }
}

main().catch((err: unknown) => {
  console.error('Error:', err);
  process.exit(1);
});
