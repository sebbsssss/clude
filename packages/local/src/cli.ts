#!/usr/bin/env node

/**
 * CLUDE CLI — Memory from the command line.
 *
 * Usage:
 *   npx clude remember "User prefers dark mode"
 *   npx clude recall "user preferences"
 *   npx clude list
 *   npx clude search "dark mode"
 *   npx clude count
 *   npx clude forget 42
 *   npx clude export
 *   npx clude clear
 */

import { remember, recall, count, list, search, forget, clear, exportAll, warmup } from './index.js';

const args = process.argv.slice(2);
const command = args[0];
const rest = args.slice(1).join(' ');

async function main() {
  switch (command) {
    case 'remember':
    case 'store':
    case 'add': {
      if (!rest) { console.error('Usage: clude remember "your memory text"'); process.exit(1); }
      const mem = await remember(rest);
      console.log(`✅ Stored memory #${mem.id}: ${mem.summary}`);
      break;
    }

    case 'recall':
    case 'search-semantic':
    case 'find': {
      if (!rest) { console.error('Usage: clude recall "your query"'); process.exit(1); }
      const limit = 5;
      const results = await recall({ query: rest, limit });
      if (results.length === 0) {
        console.log('No matching memories found.');
      } else {
        for (const r of results) {
          console.log(`  [#${r.id}] sim=${r.similarity.toFixed(3)} | ${r.content.slice(0, 100)}`);
        }
      }
      break;
    }

    case 'search':
    case 'grep': {
      if (!rest) { console.error('Usage: clude search "keyword"'); process.exit(1); }
      const results = search(rest);
      if (results.length === 0) {
        console.log('No matching memories found.');
      } else {
        for (const r of results) {
          console.log(`  [#${r.id}] ${r.type} | ${r.content.slice(0, 100)}`);
        }
      }
      break;
    }

    case 'list':
    case 'ls': {
      const n = parseInt(rest) || 10;
      const mems = list(n);
      if (mems.length === 0) {
        console.log('No memories stored yet.');
      } else {
        for (const m of mems) {
          console.log(`  [#${m.id}] ${m.type} (imp=${m.importance.toFixed(1)}) | ${m.summary.slice(0, 80)}`);
        }
        console.log(`\n  Showing ${mems.length} of ${count()} total`);
      }
      break;
    }

    case 'count': {
      console.log(`${count()} memories`);
      break;
    }

    case 'forget':
    case 'rm':
    case 'delete': {
      const id = parseInt(rest);
      if (!id) { console.error('Usage: clude forget <id>'); process.exit(1); }
      const ok = forget(id);
      console.log(ok ? `✅ Forgot memory #${id}` : `❌ Memory #${id} not found`);
      break;
    }

    case 'clear': {
      clear();
      console.log('🗑️  All memories cleared.');
      break;
    }

    case 'export': {
      const mems = exportAll();
      console.log(JSON.stringify(mems, null, 2));
      break;
    }

    case 'warmup': {
      const t = performance.now();
      await warmup();
      console.log(`Model ready in ${(performance.now()-t).toFixed(0)}ms`);
      break;
    }

    default: {
      console.log(`🧠 CLUDE — Persistent memory for AI agents

Commands:
  clude remember "text"     Store a memory
  clude recall "query"      Semantic search for relevant memories
  clude search "keyword"    Keyword search (no embeddings)
  clude list [n]            List recent memories
  clude count               Count memories
  clude forget <id>         Delete a memory
  clude export              Export all memories as JSON
  clude clear               Delete all memories
  clude warmup              Pre-load the embedding model`);
    }
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
