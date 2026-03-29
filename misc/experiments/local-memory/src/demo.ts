/**
 * Interactive demo of LocalMemory.
 * Shows basic store/recall/link operations with a local SQLite + Ollama backend.
 *
 * Usage: npx ts-node src/demo.ts
 */

import * as readline from 'readline';
import { LocalMemory } from './local-memory';

async function main() {
  console.log('=== Clude Local Memory Demo ===');
  console.log('Backend: SQLite + Ollama (nomic-embed-text)');
  console.log('No external APIs required.\n');

  const memory = new LocalMemory({
    dbPath: './demo-memory.db',
    ollamaUrl: 'http://localhost:11434',
    embeddingModel: 'nomic-embed-text',
    llmModel: 'llama3.2:3b',
  });

  await memory.init();

  // Seed some example memories
  console.log('Seeding example memories...');
  const ids: number[] = [];

  ids.push(await memory.store({
    type: 'episodic',
    summary: 'User mentioned they hold 50k $CLUDE tokens on Solana',
    content: 'The user said they have been holding since the early days and believe in the project.',
    importance: 0.9,
    tags: ['solana', 'clude', 'tokens', 'user'],
  }));

  ids.push(await memory.store({
    type: 'semantic',
    summary: '$CLUDE is a meme token on the Solana blockchain',
    content: 'CLUDE is an AI-powered meme token with persistent memory capabilities, deployed on Solana.',
    importance: 0.85,
    tags: ['clude', 'solana', 'crypto'],
  }));

  ids.push(await memory.store({
    type: 'episodic',
    summary: 'User asked about the best time to buy crypto',
    content: 'User was interested in DCA strategies and whether market timing matters.',
    importance: 0.7,
    tags: ['crypto', 'strategy', 'user'],
  }));

  ids.push(await memory.store({
    type: 'procedural',
    summary: 'Respond to crypto questions with balanced, educational tone',
    content: 'When users ask about crypto investments, provide educational information without financial advice. Mention risk factors.',
    importance: 0.8,
    tags: ['procedure', 'crypto', 'response-style'],
  }));

  ids.push(await memory.store({
    type: 'self_model',
    summary: 'I am Clude, an AI agent with persistent memory on Solana',
    content: 'I represent the $CLUDE meme token and engage with the crypto community with humor and knowledge.',
    importance: 0.95,
    tags: ['identity', 'clude'],
  }));

  // Link some memories
  memory.link({
    sourceId: ids[0],
    targetId: ids[1],
    linkType: 'relates',
    strength: 0.8,
  });
  memory.link({
    sourceId: ids[2],
    targetId: ids[3],
    linkType: 'causes',
    strength: 0.7,
  });

  console.log(`Stored ${ids.length} example memories.\n`);

  // Interactive recall loop
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));

  console.log('Commands:');
  console.log('  recall <query>   — search memories');
  console.log('  consolidate      — run consolidation on recent memories');
  console.log('  decay            — apply decay to all memories');
  console.log('  quit             — exit\n');

  while (true) {
    const input = await ask('> ');
    const [cmd, ...rest] = input.trim().split(' ');
    const arg = rest.join(' ');

    if (cmd === 'quit' || cmd === 'exit') break;

    if (cmd === 'recall') {
      if (!arg) { console.log('Usage: recall <query>'); continue; }
      console.log(`\nRecalling: "${arg}"`);
      const results = await memory.recall(arg, { limit: 3 });
      if (results.length === 0) {
        console.log('No results found.');
      } else {
        for (const r of results) {
          console.log(`\n[${r.type}] (score: ${r.score.toFixed(3)}, importance: ${r.importance.toFixed(2)})`);
          console.log(`  Summary: ${r.summary}`);
          console.log(`  Tags: ${r.tags.join(', ')}`);
        }
      }
      console.log();
    } else if (cmd === 'consolidate') {
      console.log('\nRunning consolidation (requires Ollama with llm model)...');
      const insight = await memory.consolidate(ids.slice(0, 3));
      if (insight) {
        console.log(`\nInsight generated:\n  [${insight.type}] ${insight.summary}\n`);
      } else {
        console.log('No insight generated (Ollama may not be available).\n');
      }
    } else if (cmd === 'decay') {
      memory.applyDecay();
      console.log('Decay applied to all memories.\n');
    } else {
      console.log(`Unknown command: ${cmd}`);
    }
  }

  memory.close();
  rl.close();
  console.log('\nGoodbye!');
}

main().catch(console.error);
