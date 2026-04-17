import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export async function runDream(): Promise<void> {
  console.log('\n  DREAM CYCLE\n');

  const dbPath = path.join(os.homedir(), '.clude', 'brain.db');
  if (!fs.existsSync(dbPath)) {
    console.log('  ✗ No database found. Run "npx @clude/sdk setup" first.\n');
    return;
  }

  const { SqliteStore } = require('../storage/sqlite-store');
  const { LocalEmbedder } = require('../storage/embedder');
  const { DreamEngine } = require('../storage/dream-engine');

  const embedder = new LocalEmbedder();
  const store = new SqliteStore({ dbPath, embedder });
  const dream = new DreamEngine(store);

  console.log('  Running algorithmic decay...');
  dream.applyDecay();
  console.log('  ✓ Decay applied');

  const llm = await dream.detectLLM();
  if (llm) {
    console.log(`  Detected LLM: ${llm.type} (${llm.model})`);
    const processed = await dream.processDreamQueue();
    console.log(`  ✓ Processed ${processed} dream operations`);
  } else {
    const pending = store.getPendingDreams();
    if (pending.length > 0) {
      console.log(`  ! ${pending.length} operations queued (no LLM available)`);
      console.log('    Install Ollama and run a model for LLM dream cycles.');
    } else {
      console.log('  ✓ No pending dream operations');
    }
  }

  store.close();
  console.log('\n  Dream cycle complete.\n');
}
