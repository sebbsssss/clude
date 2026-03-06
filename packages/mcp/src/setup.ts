#!/usr/bin/env node
/**
 * CLUDE Setup Wizard — Get persistent memory in 60 seconds.
 *
 * Usage:
 *   npx @clude/mcp setup
 *   npx @clude/mcp setup --cloud
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';

// ── Colors ───────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  white: '\x1b[97m',
};

function ok(msg: string) { console.log(`  ${c.green}✓${c.reset} ${msg}`); }
function warn(msg: string) { console.log(`  ${c.yellow}!${c.reset} ${msg}`); }
function info(msg: string) { console.log(`  ${c.gray}${msg}${c.reset}`); }

function banner() {
  console.log('');
  console.log(`  ${c.bold}🧠 CLUDE Setup${c.reset}`);
  console.log(`  ${c.dim}Persistent memory for AI agents${c.reset}`);
  console.log('');
}

// ── Prompt helper ────────────────────────────────────────────
function createRL(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl: readline.Interface, q: string, defaultVal = ''): Promise<string> {
  const suffix = defaultVal ? ` ${c.dim}(${defaultVal})${c.reset}` : '';
  return new Promise(resolve => {
    rl.question(`  ${c.white}?${c.reset} ${q}${suffix}: `, answer => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

function askYN(rl: readline.Interface, q: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  return new Promise(resolve => {
    rl.question(`  ${c.white}?${c.reset} ${q} (${hint}): `, answer => {
      const a = answer.trim().toLowerCase();
      if (a === '') resolve(defaultYes);
      else resolve(a === 'y' || a === 'yes');
    });
  });
}

// ── Detect environment ───────────────────────────────────────

function detectClaudeDesktop(): string | null {
  const paths = [
    path.join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), // macOS
    path.join(homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'), // Windows
    path.join(homedir(), '.config', 'claude', 'claude_desktop_config.json'), // Linux
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ── Main ─────────────────────────────────────────────────────

async function setup() {
  banner();

  const isCloud = process.argv.includes('--cloud');
  const rl = createRL();

  if (isCloud) {
    await setupCloud(rl);
  } else {
    await setupLocal(rl);
  }

  rl.close();
}

// ── Local Setup (default, 3 steps) ───────────────────────────

async function setupLocal(rl: readline.Interface) {
  console.log(`  ${c.bold}Mode: Local${c.reset} ${c.dim}(SQLite, zero API keys needed)${c.reset}\n`);
  info('Memories stored in ~/.clude/memories.db\n');

  // Step 1: Check better-sqlite3
  console.log(`  ${c.bold}Step 1/3:${c.reset} Dependencies\n`);
  let hasSqlite = false;
  try {
    require.resolve('better-sqlite3');
    hasSqlite = true;
    ok('better-sqlite3 found');
  } catch {
    warn('better-sqlite3 not found');
    info('Installing...');
    const { execSync } = require('child_process');
    try {
      execSync('npm install -g better-sqlite3', { stdio: 'pipe' });
      ok('better-sqlite3 installed');
      hasSqlite = true;
    } catch {
      warn('Could not auto-install. Run: npm install -g better-sqlite3');
    }
  }

  // Step 2: Where to add MCP
  console.log(`\n  ${c.bold}Step 2/3:${c.reset} Connect to your AI tool\n`);

  const mcpCommand = process.argv[1] || 'npx tsx packages/mcp/src/index.ts';
  const mcpDir = path.resolve(path.dirname(process.argv[1] || '.'), '..');

  // Detect Claude Desktop
  const claudeConfig = detectClaudeDesktop();
  if (claudeConfig) {
    ok(`Found Claude Desktop config`);
    const addIt = await askYN(rl, 'Add Clude to Claude Desktop?');
    if (addIt) {
      addToClaudeDesktop(claudeConfig, {});
    }
  }

  // Claude Code
  info('For Claude Code, run:');
  console.log(`\n    ${c.cyan}claude mcp add clude -- npx tsx ${path.resolve(mcpDir, 'src', 'index.ts')}${c.reset}\n`);

  // Cursor
  info('For Cursor, add to MCP settings:');
  console.log(`    ${c.cyan}Command: npx tsx ${path.resolve(mcpDir, 'src', 'index.ts')}${c.reset}\n`);

  // Step 3: Test
  console.log(`  ${c.bold}Step 3/3:${c.reset} Test it\n`);
  info('Ask your AI: "Remember that I prefer dark mode"');
  info('Then: "What are my preferences?"\n');

  printDone('local');
}

// ── Cloud Setup (4 steps) ────────────────────────────────────

async function setupCloud(rl: readline.Interface) {
  console.log(`  ${c.bold}Mode: Cloud${c.reset} ${c.dim}(Supabase + Voyage AI)${c.reset}\n`);
  info('Vector search, 13k+ memories, shared across agents\n');

  const env: Record<string, string> = { CLUDE_MODE: 'cloud' };

  // Step 1: Supabase
  console.log(`  ${c.bold}Step 1/4:${c.reset} Supabase\n`);
  info('Free at supabase.com. Need the URL + service role key.\n');

  env.CLUDE_SUPABASE_URL = await ask(rl, 'Supabase URL');
  env.CLUDE_SUPABASE_KEY = await ask(rl, 'Service Role Key');

  if (env.CLUDE_SUPABASE_URL && env.CLUDE_SUPABASE_KEY) {
    ok('Supabase configured');
  } else {
    warn('Skipped. Add CLUDE_SUPABASE_URL and CLUDE_SUPABASE_KEY later.');
  }

  // Step 2: Voyage (optional)
  console.log(`\n  ${c.bold}Step 2/4:${c.reset} Voyage AI ${c.dim}(vector search)${c.reset}\n`);
  info('Enables semantic search. Get a key at voyageai.com\n');

  env.CLUDE_VOYAGE_KEY = await ask(rl, 'Voyage API Key (Enter to skip)');
  if (env.CLUDE_VOYAGE_KEY) {
    ok('Voyage configured. Vector search enabled');
  } else {
    info('Skipped. Recall will use keyword matching.');
  }

  // Step 3: Owner wallet (optional)
  console.log(`\n  ${c.bold}Step 3/4:${c.reset} Owner Wallet ${c.dim}(optional)${c.reset}\n`);
  info('Your Solana public address. Proves memory ownership.\n');

  env.CLUDE_OWNER_WALLET = await ask(rl, 'Wallet address (Enter to skip)');
  if (env.CLUDE_OWNER_WALLET) {
    ok('Wallet set');
  }

  // Step 4: Connect
  console.log(`\n  ${c.bold}Step 4/4:${c.reset} Connect to your AI tool\n`);

  const mcpDir = path.resolve(path.dirname(process.argv[1] || '.'), '..');
  const scriptPath = path.resolve(mcpDir, 'src', 'index.ts');

  // Build env flags for Claude Code
  const envFlags = Object.entries(env)
    .filter(([_, v]) => v)
    .map(([k, v]) => `--env ${k}=${v}`)
    .join(' ');

  info('For Claude Code:');
  console.log(`\n    ${c.cyan}claude mcp add clude ${envFlags} -- npx tsx ${scriptPath}${c.reset}\n`);

  // Claude Desktop
  const claudeConfig = detectClaudeDesktop();
  if (claudeConfig) {
    ok('Found Claude Desktop config');
    const addIt = await askYN(rl, 'Add Clude to Claude Desktop?');
    if (addIt) {
      addToClaudeDesktop(claudeConfig, env);
    }
  }

  // Cursor
  info('For Cursor, add MCP server with env vars above.\n');

  printDone('cloud');
}

// ── Add to Claude Desktop config ─────────────────────────────

function addToClaudeDesktop(configPath: string, env: Record<string, string>) {
  try {
    let config: any = {};
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch { /* new file */ }

    if (!config.mcpServers) config.mcpServers = {};

    const mcpDir = path.resolve(path.dirname(process.argv[1] || '.'), '..');
    const scriptPath = path.resolve(mcpDir, 'src', 'index.ts');

    config.mcpServers.clude = {
      command: 'npx',
      args: ['tsx', scriptPath],
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    ok('Added to Claude Desktop. Restart Claude to activate.');
  } catch (err: any) {
    warn(`Could not update config: ${err.message}`);
    info(`Manually add to ${configPath}`);
  }
}

// ── Done ─────────────────────────────────────────────────────

function printDone(mode: string) {
  console.log(`  ${'─'.repeat(44)}`);
  console.log(`\n  ${c.green}${c.bold}Ready!${c.reset}\n`);
  console.log(`  ${c.bold}Try saying to your AI:${c.reset}`);
  console.log(`    "Remember that my favorite color is blue"`);
  console.log(`    "What's my favorite color?"`);
  console.log(`    "Show me my memory graph"  ${c.dim}(opens 3D brain visualization)${c.reset}`);
  console.log('');
  info(`Mode: ${mode}`);
  info('Tools: remember, recall, forget, memory_stats, visualize');
  info('Docs: github.com/sebbsssss/clude');
  console.log(`  ${'─'.repeat(44)}\n`);
}

// ── Entry ────────────────────────────────────────────────────

const cmd = process.argv[2];
if (cmd === 'setup' || cmd === 'init') {
  setup().catch(err => { console.error(err); process.exit(1); });
} else {
  // If run directly, just launch setup
  setup().catch(err => { console.error(err); process.exit(1); });
}
