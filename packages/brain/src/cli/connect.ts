import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { printBanner, printStep, printSuccess, printWarn, printError, printInfo, printDivider, printCodeBlock, c } from './banner';

const DEFAULT_HOST = process.env.CORTEX_HOST_URL || 'https://clude.io';
const MCP_PATH = '/api/mcp';

function createPrompt(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`  ${c.white}?${c.reset} ${question}`, (answer) => resolve(answer.trim()));
  });
}

function askYesNo(rl: readline.Interface, question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  return ask(rl, `${question} [${hint}]: `).then((a) => {
    if (!a) return defaultYes;
    return /^y(es)?$/i.test(a);
  });
}

interface StoredConfig {
  apiKey?: string;
  email?: string;
  wallet?: string;
  agentId?: string;
}

function readStoredConfig(): StoredConfig | null {
  const p = path.join(os.homedir(), '.clude', 'config.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function detectClaudeDesktopConfigPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
  }
  return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

async function verifyMcpKey(host: string, apiKey: string): Promise<{ ok: boolean; serverName?: string; error?: string }> {
  try {
    const res = await fetch(`${host}${MCP_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'clude-connect', version: '1.0.0' },
        },
      }),
    });
    if (res.status === 401) return { ok: false, error: 'Bearer key rejected (401)' };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = await res.text();
    // Server returns SSE: "event: message\ndata: {...}\n\n"
    const match = body.match(/data:\s*(\{.*\})/);
    if (!match) return { ok: false, error: 'No SSE data frame in response' };
    const doc = JSON.parse(match[1]);
    if (doc.error) return { ok: false, error: doc.error.message };
    return { ok: true, serverName: doc?.result?.serverInfo?.name };
  } catch (err: any) {
    return { ok: false, error: err.message ?? 'fetch failed' };
  }
}

async function registerNewKey(host: string, name: string, email?: string): Promise<{ apiKey: string; agentId: string } | { error: string }> {
  try {
    const res = await fetch(`${host}/api/cortex/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(email ? { name, email } : { name }),
    });
    const data = (await res.json()) as any;
    if (!res.ok || !data.apiKey) return { error: data?.error ?? `HTTP ${res.status}` };
    return { apiKey: data.apiKey, agentId: data.agentId };
  } catch (err: any) {
    return { error: err.message ?? 'register failed' };
  }
}

function buildDesktopEntry(host: string, apiKey: string): { name: string; entry: Record<string, unknown> } {
  return {
    name: 'clude',
    entry: {
      url: `${host}${MCP_PATH}`,
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  };
}

function writeDesktopConfig(configPath: string, host: string, apiKey: string): { wrote: boolean; merged: boolean } {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  let existing: Record<string, any> = {};
  let merged = false;
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      merged = true;
    } catch {
      existing = {};
    }
  }
  const { name, entry } = buildDesktopEntry(host, apiKey);
  existing.mcpServers = existing.mcpServers || {};
  existing.mcpServers[name] = entry;
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n');
  return { wrote: true, merged };
}

export async function runConnect(): Promise<void> {
  const args = process.argv.slice(3);
  const nonInteractive = args.includes('--non-interactive') || args.includes('-y');
  const hostFlag = args.find((a) => a.startsWith('--host='));
  const host = hostFlag ? hostFlag.split('=')[1] : DEFAULT_HOST;
  const keyFlag = args.find((a) => a.startsWith('--key='));

  printBanner();
  console.log(`  ${c.bold}Connect Clude to Claude Desktop${c.reset}\n`);
  console.log(`  ${c.gray}Adds Clude as a remote MCP connector. You'll see memory tools${c.reset}`);
  console.log(`  ${c.gray}(recall_memories, store_memory, get_memory_stats) in Claude.${c.reset}\n`);

  // ── Step 1: get an API key ──────────────────────────────
  printStep(1, 3, 'Get your API key');

  let apiKey = keyFlag?.split('=')[1] || process.env.CORTEX_API_KEY || '';
  let source = apiKey ? (keyFlag ? '--key flag' : 'CORTEX_API_KEY env var') : '';

  if (!apiKey) {
    const stored = readStoredConfig();
    if (stored?.apiKey) {
      apiKey = stored.apiKey;
      source = '~/.clude/config.json';
    }
  }

  if (apiKey) {
    printSuccess(`Using existing key from ${source}`);
    printInfo(`  ${apiKey.slice(0, 12)}…`);
  } else if (nonInteractive) {
    printError('No API key found. Provide one with --key=<clk_…> or run `npx @clude/sdk setup` first.');
    process.exit(1);
  } else {
    const rl = createPrompt();
    try {
      console.log(`  ${c.gray}No API key found locally. Choose one:${c.reset}\n`);
      console.log(`    ${c.cyan}1${c.reset}) Register a new key now (free)`);
      console.log(`    ${c.cyan}2${c.reset}) Paste an existing ${c.gray}clk_…${c.reset} key\n`);
      const choice = await ask(rl, 'Choice [1]: ');
      if (choice === '' || choice === '1') {
        const name = (await ask(rl, 'Display name: ')) || 'claude-desktop-user';
        const email = await ask(rl, 'Email (optional, enables dashboard login): ');
        printInfo('  Registering…');
        const reg = await registerNewKey(host, name, email || undefined);
        if ('error' in reg) {
          printError(`Registration failed: ${reg.error}`);
          process.exit(1);
        }
        apiKey = reg.apiKey;
        printSuccess(`API key created  ${c.green}${apiKey}${c.reset}`);
        printWarn('Save this key. It will not be shown again.');
      } else {
        apiKey = await ask(rl, 'Paste your clk_… key: ');
        if (!apiKey.startsWith('clk_')) {
          printError('Key should start with clk_. Aborting.');
          process.exit(1);
        }
      }
    } finally {
      rl.close();
    }
  }

  // ── Step 2: verify it works against /api/mcp ────────────
  printStep(2, 3, 'Verify connector');
  printInfo(`  POST ${host}${MCP_PATH} → initialize`);
  const verify = await verifyMcpKey(host, apiKey);
  if (!verify.ok) {
    printError(`Connector check failed: ${verify.error}`);
    printInfo('  If the host is right, double-check the bearer key at https://clude.io/dashboard');
    process.exit(1);
  }
  printSuccess(`Connector responded — server: ${c.green}${verify.serverName ?? 'clude'}${c.reset}`);

  // ── Step 3: write Claude Desktop config (or print snippet) ──
  printStep(3, 3, 'Install in Claude Desktop');
  const configPath = detectClaudeDesktopConfigPath();
  let shouldWrite = nonInteractive;
  if (!nonInteractive) {
    const rl = createPrompt();
    try {
      console.log(`  ${c.gray}Config path: ${configPath}${c.reset}`);
      shouldWrite = await askYesNo(rl, 'Write this connector to your Claude Desktop config?', true);
    } finally {
      rl.close();
    }
  }

  if (shouldWrite) {
    try {
      const { merged } = writeDesktopConfig(configPath, host, apiKey);
      printSuccess(`${merged ? 'Merged into' : 'Created'} ${configPath}`);
      printInfo('  Restart Claude Desktop to pick up the new connector.');
    } catch (err: any) {
      printError(`Could not write config: ${err.message}`);
      printSnippet(host, apiKey);
      process.exit(1);
    }
  } else {
    printSnippet(host, apiKey);
  }

  // ── Claude Code snippet always printed ──────────────────
  printDivider();
  console.log(`\n  ${c.bold}Claude Code users:${c.reset} add this to your project's ${c.cyan}.mcp.json${c.reset}\n`);
  printCodeBlock(JSON.stringify({
    mcpServers: { clude: buildDesktopEntry(host, apiKey).entry },
  }, null, 2));

  console.log(`  ${c.bold}claude.ai web users:${c.reset}`);
  console.log(`    1. Open Settings → Connectors → Add custom connector`);
  console.log(`    2. URL:    ${c.cyan}${host}${MCP_PATH}${c.reset}`);
  console.log(`    3. Header: ${c.cyan}Authorization: Bearer ${apiKey.slice(0, 12)}…${c.reset}\n`);
  console.log(`  ${c.gray}Docs: https://clude.io/docs/connector${c.reset}\n`);
}

function printSnippet(host: string, apiKey: string): void {
  const configPath = detectClaudeDesktopConfigPath();
  printWarn(`Skipped writing config. Add manually to ${configPath}:`);
  printCodeBlock(JSON.stringify({
    mcpServers: { clude: buildDesktopEntry(host, apiKey).entry },
  }, null, 2));
}
