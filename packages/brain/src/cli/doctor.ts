import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export async function runDoctor(): Promise<void> {
  console.log('\n  CLUDE DIAGNOSTICS\n');

  // 1. Check database
  const dbPath = path.join(os.homedir(), '.clude', 'brain.db');
  if (fs.existsSync(dbPath)) {
    try {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      const count = (db.prepare('SELECT COUNT(*) as c FROM memories').get() as any).c;
      const stats = fs.statSync(dbPath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
      console.log(`  ✓ Database      ${dbPath} (${count} memories, ${sizeMB} MB)`);
      db.close();
    } catch (e: any) {
      console.log(`  ✗ Database      ${dbPath} (error: ${e.message})`);
    }
  } else {
    console.log(`  ✗ Database      Not found (run 'npx clude-bot setup')`);
  }

  // 2. Check embedding model cache
  const modelDir = path.join(os.homedir(), '.clude', 'models');
  const modelCached = fs.existsSync(modelDir) && fs.readdirSync(modelDir).length > 0;
  console.log(modelCached
    ? '  ✓ Embeddings    all-MiniLM-L6-v2 (cached)'
    : '  ✗ Embeddings    Model not cached (will download on first use)'
  );

  // 3. Check cloud config
  const configPath = path.join(os.homedir(), '.clude', 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      console.log(config.apiKey
        ? `  ✓ Cloud         ${config.apiKey.slice(0, 8)}... (configured)`
        : '  ✗ Cloud         No API key configured'
      );
    } catch {
      console.log('  ✗ Cloud         Config file corrupted');
    }
  } else {
    console.log('  - Cloud         Not configured (local-only mode)');
  }

  // 4. Check Ollama
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json() as any;
      const models = data.models?.map((m: any) => m.name).join(', ') || 'no models';
      console.log(`  ✓ Ollama        localhost:11434 (${models})`);
    } else {
      console.log('  ✗ Ollama        Not responding');
    }
  } catch {
    console.log('  ✗ Ollama        Not running');
  }

  // 5. Check MCP configs
  const mcpPaths = [
    { name: 'Claude Code', path: path.join(os.homedir(), '.claude', '.mcp.json') },
    { name: 'Cursor', path: path.join(os.homedir(), '.cursor', 'mcp.json') },
  ];
  for (const mcp of mcpPaths) {
    if (fs.existsSync(mcp.path)) {
      try {
        const config = JSON.parse(fs.readFileSync(mcp.path, 'utf-8'));
        const hasClude = config.mcpServers?.['clude-memory'] !== undefined;
        console.log(hasClude
          ? `  ✓ MCP           ${mcp.name}`
          : `  - MCP           ${mcp.name} (no clude-memory entry)`
        );
      } catch {
        console.log(`  ✗ MCP           ${mcp.name} (parse error)`);
      }
    } else {
      console.log(`  ✗ MCP           ${mcp.name} (not detected)`);
    }
  }

  // 6. Check dream queue
  if (fs.existsSync(dbPath)) {
    try {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      const pending = (db.prepare("SELECT COUNT(*) as c FROM dream_queue WHERE status = 'pending'").get() as any).c;
      console.log(`  ${pending > 0 ? '!' : '✓'} Dream queue   ${pending} pending operations`);
      db.close();
    } catch {}
  }

  console.log('');
}
