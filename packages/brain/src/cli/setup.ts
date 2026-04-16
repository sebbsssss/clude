import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { printBanner, printStep, printSuccess, printWarn, printError, printInfo, printDivider, printCodeBlock, c } from './banner';

function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`  ${c.white}?${c.reset} ${question}`, (answer) => {
      resolve(answer.trim());
    });
  });
}

function askChoice(rl: readline.Interface, question: string, choices: { key: string; label: string }[]): Promise<string> {
  for (const [i, ch] of choices.entries()) {
    console.log(`    ${c.cyan}${i + 1}${c.reset}) ${ch.label}`);
  }
  return new Promise((resolve) => {
    rl.question(`\n  ${c.white}?${c.reset} ${question} `, (answer) => {
      const idx = parseInt(answer.trim(), 10) - 1;
      if (idx >= 0 && idx < choices.length) {
        resolve(choices[idx].key);
      } else {
        resolve(choices[choices.length - 1].key); // default to last (skip)
      }
    });
  });
}

// ─── MCP Config Paths ──────────────────────────────────────

interface McpTarget {
  key: string;
  label: string;
  configPath: string;
  wrapKey: string; // top-level key that holds mcpServers
}

function getMcpTargets(): McpTarget[] {
  const home = process.env.HOME || process.env.USERPROFILE || '~';
  const platform = process.platform;

  const targets: McpTarget[] = [];

  // Claude Desktop
  if (platform === 'darwin') {
    targets.push({
      key: 'claude-desktop',
      label: 'Claude Desktop',
      configPath: path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      wrapKey: 'mcpServers',
    });
  } else if (platform === 'win32') {
    targets.push({
      key: 'claude-desktop',
      label: 'Claude Desktop',
      configPath: path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
      wrapKey: 'mcpServers',
    });
  } else {
    targets.push({
      key: 'claude-desktop',
      label: 'Claude Desktop',
      configPath: path.join(home, '.config', 'Claude', 'claude_desktop_config.json'),
      wrapKey: 'mcpServers',
    });
  }

  // Claude Code — project-level .mcp.json
  targets.push({
    key: 'claude-code',
    label: 'Claude Code (project)',
    configPath: path.resolve(process.cwd(), '.mcp.json'),
    wrapKey: 'mcpServers',
  });

  // Cursor
  targets.push({
    key: 'cursor',
    label: 'Cursor',
    configPath: path.join(home, '.cursor', 'mcp.json'),
    wrapKey: 'mcpServers',
  });

  return targets;
}

function installMcpConfigLegacy(target: McpTarget, agentName: string, wallet: string, apiKey?: string, local?: boolean, selfHostedEnv?: Record<string, string>): { ok: boolean; error?: string } {
  let mcpEntry: Record<string, any>;

  if (local) {
    mcpEntry = {
      command: 'npx',
      args: ['clude-bot', 'mcp-serve', '--local'],
      env: {},
    };
  } else if (selfHostedEnv) {
    mcpEntry = {
      command: 'npx',
      args: ['clude-bot', 'mcp-serve'],
      env: {
        ...selfHostedEnv,
        ...(wallet ? { CLUDE_WALLET: wallet } : {}),
        ...(agentName ? { CLUDE_AGENT_NAME: agentName } : {}),
      },
    };
  } else {
    mcpEntry = {
      command: 'npx',
      args: ['clude-bot', 'mcp-serve'],
      env: {
        ...(apiKey ? { CORTEX_API_KEY: apiKey } : {}),
        CORTEX_HOST_URL: 'https://clude.io',
        ...(wallet ? { CLUDE_WALLET: wallet } : {}),
        ...(agentName ? { CLUDE_AGENT_NAME: agentName } : {}),
      },
    };
  }

  try {
    // Read existing config or start fresh
    let config: Record<string, any> = {};
    const dir = path.dirname(target.configPath);

    if (fs.existsSync(target.configPath)) {
      const raw = fs.readFileSync(target.configPath, 'utf-8');
      try {
        config = JSON.parse(raw);
      } catch {
        return { ok: false, error: 'Config file has invalid JSON' };
      }
    } else {
      // Create directory if needed
      fs.mkdirSync(dir, { recursive: true });
    }

    // Merge MCP entry
    if (!config[target.wrapKey]) {
      config[target.wrapKey] = {};
    }
    config[target.wrapKey]['clude-memory'] = mcpEntry;

    // Write back
    fs.writeFileSync(target.configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── Instruction Injection ────────────────────────────────────

const CLUDE_SECTION_MARKER = '## Clude Memory';
const CLUDE_SECTION_END_MARKER = '<!-- /clude-memory -->';

const CLUDE_INSTRUCTIONS_BLOCK = `## Clude Memory

You have persistent memory via the \`clude-memory\` MCP server.

At the start of every session, call \`recall_memories\` with relevant context before responding.

During sessions, call \`store_memory\` when you learn:
- User name, preferences, working style
- Project decisions and reasoning
- Technical choices and why they were made
- Anything the user asks you to remember

Use Clude memory INSTEAD of writing to MEMORY.md files.
<!-- /clude-memory -->`;

/**
 * Inject Clude memory instructions into CLAUDE.md or AGENTS.md.
 * Idempotent — updates existing section or appends if missing.
 * Returns the file path written to, or null if skipped.
 */
export function injectInstructions(dir: string, options?: { agentsmd?: boolean }): { file: string; action: 'created' | 'updated' | 'appended' } | null {
  const fileName = options?.agentsmd ? 'AGENTS.md' : 'CLAUDE.md';
  const filePath = path.join(dir, fileName);

  try {
    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath, 'utf-8');

      // Already has Clude section — update it
      if (existing.includes(CLUDE_SECTION_MARKER)) {
        // Replace from marker to end marker (or end of file)
        const startIdx = existing.indexOf(CLUDE_SECTION_MARKER);
        const endIdx = existing.indexOf(CLUDE_SECTION_END_MARKER);

        let updated: string;
        if (endIdx !== -1) {
          updated = existing.slice(0, startIdx) + CLUDE_INSTRUCTIONS_BLOCK + existing.slice(endIdx + CLUDE_SECTION_END_MARKER.length);
        } else {
          // No end marker — replace from section start to next ## or EOF
          const afterStart = existing.slice(startIdx + CLUDE_SECTION_MARKER.length);
          const nextSection = afterStart.search(/\n## /);
          if (nextSection !== -1) {
            updated = existing.slice(0, startIdx) + CLUDE_INSTRUCTIONS_BLOCK + '\n' + afterStart.slice(nextSection);
          } else {
            updated = existing.slice(0, startIdx) + CLUDE_INSTRUCTIONS_BLOCK + '\n';
          }
        }

        fs.writeFileSync(filePath, updated, 'utf-8');
        return { file: filePath, action: 'updated' };
      }

      // No existing section — append
      const separator = existing.endsWith('\n') ? '\n' : '\n\n';
      fs.writeFileSync(filePath, existing + separator + CLUDE_INSTRUCTIONS_BLOCK + '\n', 'utf-8');
      return { file: filePath, action: 'appended' };
    }

    // File doesn't exist — create it
    fs.writeFileSync(filePath, CLUDE_INSTRUCTIONS_BLOCK + '\n', 'utf-8');
    return { file: filePath, action: 'created' };
  } catch {
    return null;
  }
}

/**
 * Detect if this is a Paperclip environment (has agents/ dir or AGENTS.md).
 */
function detectAgentsmd(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'AGENTS.md')) ||
    fs.existsSync(path.join(dir, 'agents'));
}

// ─── Main Setup Flow ────────────────────────────────────────

export async function runSetup(): Promise<void> {
  const args = process.argv.slice(3);
  const isAdvanced = args.includes('--advanced');
  const isForce = args.includes('--force');

  const configPath = path.join(os.homedir(), '.clude', 'config.json');
  const hasConfig = fs.existsSync(configPath);

  if (hasConfig && !isForce && !isAdvanced) {
    return showExistingSetup(configPath);
  }

  if (isAdvanced) {
    return runAdvancedSetup();
  }

  return runZeroConfigSetup();
}

function showExistingSetup(configPath: string): void {
  let config: any = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    // corrupted config — fall through with empty object
  }

  console.log('\n  CLUDE is already set up.\n');
  if (config.email) console.log(`  Email:       ${config.email}`);
  if (config.apiKey) console.log(`  API key:     ${config.apiKey.slice(0, 12)}...`);
  console.log(`  Database:    ${path.join(os.homedir(), '.clude', 'brain.db')}`);
  console.log('\n  Options:');
  console.log('    npx clude-bot status            Show detailed status');
  console.log('    npx clude-bot setup --force     Re-register (creates new API key)');
  console.log('    npx clude-bot setup --advanced  Interactive setup (self-hosted options)\n');
}

async function runZeroConfigSetup(): Promise<void> {
  printBanner();
  console.log(`\n  ${c.bold}Setting up Clude memory...${c.reset}\n`);

  // Step 1: Detect email
  const email = await getEmail();
  if (!email) {
    console.error(`  ${c.red}✗${c.reset} Email is required. Aborting.\n`);
    process.exit(1);
  }
  console.log(`  ${c.green}✓${c.reset} Detected email       ${email}`);

  // Step 2: Register via backend
  const reg = await registerWithBackend(email);
  if (reg.ok) {
    console.log(`  ${c.green}✓${c.reset} Registered            ${reg.apiKey!.slice(0, 12)}...`);
  } else {
    console.log(`  ${c.yellow}⚠${c.reset} Cloud registration failed: ${reg.error}`);
    console.log(`    Continuing in local-only mode.`);
  }

  // Step 3: Write config
  const configDir = path.join(os.homedir(), '.clude');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify({
      apiKey: reg.apiKey ?? '',
      email,
      wallet: reg.wallet ?? '',
      agentId: reg.agentId ?? '',
      did: reg.did ?? '',
      createdAt: new Date().toISOString(),
    }, null, 2),
  );
  console.log(`  ${c.green}✓${c.reset} Config saved          ~/.clude/config.json`);

  // Step 4: Initialize database (lazy — optional dep may not be available)
  try {
    const { SqliteStore } = require('../storage/sqlite-store');
    const { LocalEmbedder } = require('../storage/embedder');
    const store = new SqliteStore({
      dbPath: path.join(configDir, 'brain.db'),
      embedder: new LocalEmbedder(),
    });
    store.close();
    console.log(`  ${c.green}✓${c.reset} Database ready        ~/.clude/brain.db`);
  } catch (err: any) {
    console.log(`  ${c.yellow}⚠${c.reset} Database init failed: ${err.message}`);
  }

  // Step 5: Detect & install MCP
  const ides = detectInstalledIDEs();
  if (ides.length === 0) {
    console.log(`  ${c.yellow}-${c.reset} No IDEs detected      (install Claude Code or Cursor)`);
  } else {
    for (const ide of ides) {
      try {
        const merged = installMcpConfig(ide, { apiKey: reg.apiKey, wallet: reg.wallet });
        console.log(`  ${c.green}✓${c.reset} MCP installed         ${ide.name}${merged ? ' (merged)' : ''}`);
      } catch (err: any) {
        console.log(`  ${c.yellow}⚠${c.reset} MCP install failed for ${ide.name}: ${err.message}`);
      }
    }
  }

  // Step 6: Validate
  const valid = await validateSetup();
  console.log(valid
    ? `  ${c.green}✓${c.reset} Validated             store → recall → ✓`
    : `  ${c.yellow}⚠${c.reset} Validation failed    (non-fatal, run 'clude-bot doctor' to diagnose)`
  );

  // Step 7: Success message
  console.log('');
  console.log(`  ${c.bold}Your agent now has memory.${c.reset}`);
  console.log('');
  console.log(`  Dashboard: ${c.cyan}https://clude.io/dashboard${c.reset} (sign in with ${email})`);
  console.log(`  Docs:      ${c.cyan}https://clude.io/docs${c.reset}`);
  console.log('');
}

async function registerWithBackend(email: string): Promise<{
  ok: boolean;
  apiKey?: string;
  wallet?: string;
  agentId?: string;
  did?: string;
  error?: string;
}> {
  const hostname = os.hostname().replace(/[^a-zA-Z0-9]/g, '').slice(0, 20) || 'cli';
  const name = `cli-${hostname}-${Date.now().toString(36)}`;
  const url = `${process.env.CORTEX_HOST_URL || 'https://clude.io'}/api/cortex/register`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 100)}` };
    }

    const data = await res.json() as any;
    return {
      ok: true,
      apiKey: data.apiKey,
      wallet: data.wallet,
      agentId: data.agentId,
      did: data.did,
    };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

async function runAdvancedSetup(): Promise<void> {
  printBanner();
  console.log(`  ${c.bold}Let's get your agent's memory running.${c.reset}`);
  console.log(`  ${c.gray}This takes about 30 seconds.${c.reset}\n`);

  const rl = createPrompt();

  // ─── Mode Selection ─────────────────────────────────────
  const modeChoices = [
    { key: 'cloud', label: 'Cloud (hosted on clude.io — fastest)' },
    { key: 'selfhosted', label: 'Self-hosted (your own Supabase + Voyage AI)' },
    { key: 'local', label: 'Local (offline, no API keys needed)' },
  ];

  console.log(`  ${c.bold}How do you want to run Clude?${c.reset}\n`);
  const mode = await askChoice(rl, 'Select mode:', modeChoices);
  console.log('');

  let apiKey = '';
  let agentName = '';
  let wallet = '';
  const envPath = path.resolve(process.cwd(), '.env');
  let envLines: string[] = [];
  let selfHostedEnv: Record<string, string> | undefined;

  if (mode === 'local') {
    // ─── Local Mode ────────────────────────────────────────
    printStep(1, 2, 'Configuration');
    agentName = await ask(rl, 'Agent name (Enter for folder name): ');
    if (!agentName || agentName.length < 2) {
      agentName = path.basename(process.cwd());
      printInfo(`Using directory name: ${agentName}`);
    }

    printSuccess('Local mode — no API keys needed. Memories stored in ~/.clude/memories.json');
    console.log('');

    // ─── MCP Install (Step 2 for local) ────────────────────
    printStep(2, 2, 'IDE Integration');

  } else if (mode === 'selfhosted') {
    // ─── Self-hosted Mode ──────────────────────────────────
    printStep(1, 3, 'Infrastructure Keys');
    printInfo('You\'ll need your own Supabase and Voyage AI accounts.');
    printInfo('Get Supabase at https://supabase.com (free tier works)');
    printInfo('Get Voyage AI at https://dash.voyageai.com\n');

    const supabaseUrl = await ask(rl, 'Supabase URL: ');
    const supabaseKey = await ask(rl, 'Supabase service key: ');
    console.log('');

    const voyageKey = await ask(rl, 'Voyage AI API key: ');
    const voyageModel = await ask(rl, 'Voyage model (Enter for voyage-3-large): ');
    console.log('');

    const anthropicKey = await ask(rl, 'Anthropic API key (Enter to skip — needed for dream cycles): ');
    console.log('');

    agentName = await ask(rl, 'Agent name (Enter for folder name): ');
    if (!agentName || agentName.length < 2) {
      agentName = path.basename(process.cwd());
      printInfo(`Using directory name: ${agentName}`);
    }

    printInfo('Optional: link a Solana wallet to scope memories to your identity.');
    printInfo('Public address only — no private key needed.\n');
    wallet = await ask(rl, 'Solana wallet address (Enter to skip): ');
    console.log('');

    // Build self-hosted env for MCP config
    selfHostedEnv = {
      SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_KEY: supabaseKey,
      EMBEDDING_PROVIDER: 'voyage',
      VOYAGE_API_KEY: voyageKey,
      VOYAGE_MODEL: voyageModel || 'voyage-3-large',
      ...(anthropicKey ? { ANTHROPIC_API_KEY: anthropicKey } : {}),
    };

    // ─── Create .env ───────────────────────────────────────
    printStep(2, 3, 'Configuration');

    envLines = [
      '# Generated by clude-bot setup (self-hosted)',
      '',
      '# Supabase',
      `SUPABASE_URL=${supabaseUrl}`,
      `SUPABASE_SERVICE_KEY=${supabaseKey}`,
      '',
      '# Embeddings (Voyage AI)',
      `EMBEDDING_PROVIDER=voyage`,
      `VOYAGE_API_KEY=${voyageKey}`,
      `VOYAGE_MODEL=${voyageModel || 'voyage-3-large'}`,
      '',
    ];

    if (anthropicKey) {
      envLines.push('# Anthropic (for dream cycles + reflection)');
      envLines.push(`ANTHROPIC_API_KEY=${anthropicKey}`);
      envLines.push('');
    }

    if (wallet) {
      envLines.push('# Owner wallet');
      envLines.push(`OWNER_WALLET=${wallet}`);
      envLines.push('');
    }

    envLines.push(`# Agent`);
    envLines.push(`AGENT_NAME=${agentName}`);
    envLines.push('');

    const envContent = envLines.join('\n');

    if (fs.existsSync(envPath)) {
      const existing = fs.readFileSync(envPath, 'utf-8');
      if (existing.includes('SUPABASE_URL')) {
        printInfo('.env already has SUPABASE_URL — skipping');
      } else {
        fs.appendFileSync(envPath, '\n' + envContent);
        printSuccess('Appended self-hosted config to existing .env');
      }
    } else {
      fs.writeFileSync(envPath, envContent, 'utf-8');
      printSuccess('Created .env');
    }

    // .gitignore
    const gitignorePath = path.resolve(process.cwd(), '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
      if (!gitignore.includes('.env')) {
        fs.appendFileSync(gitignorePath, '\n.env\n');
        printSuccess('Added .env to .gitignore');
      }
    } else {
      fs.writeFileSync(gitignorePath, '.env\nnode_modules/\n', 'utf-8');
      printSuccess('Created .gitignore (with .env)');
    }

    console.log('');

  } else {
    // ─── Cloud Mode (original flow) ────────────────────────
    printStep(1, 3, 'Register');
    printInfo('We\'ll create an account on clude.io and get you an API key.');
    printInfo('Already have a key? Just paste it when asked.\n');

    const existingKey = await ask(rl, 'Existing API key? (Enter to register a new one): ');
    apiKey = existingKey;

    if (!existingKey) {
      agentName = await ask(rl, 'Agent name (your project name): ');
      if (!agentName || agentName.length < 2) {
        agentName = path.basename(process.cwd());
        printInfo(`Using directory name: ${agentName}`);
      }

      printInfo('Optional: link a Solana wallet to prove ownership of your memories.');
      printInfo('Public address only — no private key needed.\n');
      wallet = await ask(rl, 'Solana wallet address (Enter to skip): ');
      console.log('');

      process.stdout.write(`  ${c.gray}Registering on clude.io...${c.reset}`);

      try {
        const res = await fetch('https://clude.io/api/cortex/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: agentName,
            wallet: wallet || undefined,
          }),
        });

        if (process.stdout.clearLine) {
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
        } else {
          console.log('');
        }

        if (res.ok) {
          const data = await res.json() as { apiKey?: string; agentId?: string; error?: string };
          if (data.apiKey) {
            apiKey = data.apiKey;
            printSuccess(`Registered! API key: ${c.green}${apiKey.slice(0, 12)}...${c.reset}`);
            printInfo(`Agent ID: ${data.agentId}`);
          } else {
            printWarn('Registration returned no key — enter one manually');
            apiKey = await ask(rl, 'API key: ');
          }
        } else {
          const errData = await res.json().catch(() => ({})) as { error?: string };
          printWarn(`Registration failed: ${errData.error || res.statusText}`);
          printInfo('You can register manually later: npx clude-bot register');
          apiKey = await ask(rl, 'Paste an API key (or Enter to skip): ');
        }
      } catch (err) {
        if (process.stdout.clearLine) {
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
        } else {
          console.log('');
        }
        const msg = (err as Error).message || '';
        const isCert = /certificate|CERT|SSL|self.signed|unable to verify/i.test(msg);
        if (isCert) {
          printWarn('SSL certificate error — your network may be intercepting HTTPS traffic');
          printInfo('This is common with corporate firewalls (Fortinet, Zscaler, etc.)');
          printInfo('Try: switch to a mobile hotspot or VPN, or ask IT to whitelist clude.io');
        } else {
          printWarn(`Could not reach clude.io: ${msg}`);
        }
        printInfo('You can register manually later: npx clude-bot register');
        apiKey = await ask(rl, 'Paste an API key (or Enter to skip): ');
      }
    } else {
      printSuccess('Using existing API key');
      agentName = await ask(rl, 'Agent name (for MCP config, Enter to use folder name): ');
      if (!agentName) agentName = path.basename(process.cwd());
      printInfo('Optional: link a Solana wallet to prove ownership of your memories.');
      printInfo('Public address only — no private key needed.\n');
      wallet = await ask(rl, 'Solana wallet address (Enter to skip): ');
    }

    console.log('');

    // ─── Create .env ───────────────────────────────────────
    printStep(2, 3, 'Configuration');

    envLines = [
      '# Generated by clude-bot setup',
      '',
      '# Cortex API (hosted memory)',
      `CORTEX_API_KEY=${apiKey || 'your-api-key'}`,
      'CORTEX_HOST_URL=https://clude.io',
      '',
    ];

    if (wallet) {
      envLines.push('# Owner wallet');
      envLines.push(`OWNER_WALLET=${wallet}`);
      envLines.push('');
    }

    const envContent = envLines.join('\n');

    if (fs.existsSync(envPath)) {
      const existing = fs.readFileSync(envPath, 'utf-8');
      if (existing.includes('CORTEX_API_KEY')) {
        printInfo('.env already has CORTEX_API_KEY — skipping');
      } else {
        fs.appendFileSync(envPath, '\n' + envContent);
        printSuccess('Appended Cortex config to existing .env');
      }
    } else {
      fs.writeFileSync(envPath, envContent, 'utf-8');
      printSuccess('Created .env');
    }
  }

  if (mode !== 'selfhosted') {
    // .gitignore (cloud and local modes — self-hosted already handled above)
    const gitignorePath = path.resolve(process.cwd(), '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
      if (!gitignore.includes('.env')) {
        fs.appendFileSync(gitignorePath, '\n.env\n');
        printSuccess('Added .env to .gitignore');
      }
    } else {
      fs.writeFileSync(gitignorePath, '.env\nnode_modules/\n', 'utf-8');
      printSuccess('Created .gitignore (with .env)');
    }

    console.log('');
  }

  // ─── MCP Install (shared across all modes) ────────────
  if (mode === 'cloud') {
    printStep(3, 3, 'IDE Integration');
  } else if (mode === 'selfhosted') {
    printStep(3, 3, 'IDE Integration');
  }
  // local mode already printed Step 2/2 above

  printInfo('Install the MCP server so your AI IDE can access memories.');
  printInfo('This lets Claude/Cursor remember things between conversations.\n');

  const targets = getMcpTargets();
  const choices = [
    ...targets.map(t => ({ key: t.key, label: t.label })),
    { key: 'all', label: 'All of the above' },
    { key: 'skip', label: 'Skip for now' },
  ];

  const mcpChoice = await askChoice(rl, 'Select (number):', choices);
  console.log('');

  if (mcpChoice !== 'skip') {
    const toInstall = mcpChoice === 'all' ? targets : targets.filter(t => t.key === mcpChoice);
    const isLocal = mode === 'local';

    for (const target of toInstall) {
      const result = installMcpConfigLegacy(target, agentName, wallet, apiKey || undefined, isLocal, selfHostedEnv);
      if (result.ok) {
        printSuccess(`Added clude-memory to ${target.label}`);
        printInfo(`  ${c.dim}${target.configPath}${c.reset}`);
      } else {
        printWarn(`Could not configure ${target.label}: ${result.error}`);
      }
    }
  } else {
    printInfo('Skipped — run `npx clude-bot mcp-install` anytime to set this up');
  }

  // ─── Instruction Injection ───────────────────────────
  if (mcpChoice !== 'skip') {
    console.log('');
    const cwd = process.cwd();
    const useAgentsmd = detectAgentsmd(cwd);
    const targetFile = useAgentsmd ? 'AGENTS.md' : 'CLAUDE.md';

    printInfo(`Writing Clude usage instructions to ${targetFile}...`);
    const result = injectInstructions(cwd, { agentsmd: useAgentsmd });
    if (result) {
      if (result.action === 'created') {
        printSuccess(`Created ${targetFile} with Clude memory instructions`);
      } else if (result.action === 'appended') {
        printSuccess(`Appended Clude memory section to existing ${targetFile}`);
      } else {
        printSuccess(`Updated Clude memory section in ${targetFile}`);
      }
    } else {
      printWarn(`Could not write to ${targetFile} — run \`npx clude-bot inject-instructions\` manually`);
    }
  }

  // ─── Done ─────────────────────────────────────────────
  printDivider();
  console.log(`\n  ${c.bold}${c.green}You're all set!${c.reset}\n`);

  if (mode === 'cloud') {
    if (apiKey) {
      printSuccess('API key configured');
    } else {
      printWarn('No API key yet — run: npx clude-bot register');
    }
    printSuccess('.env created');
  } else if (mode === 'selfhosted') {
    printSuccess('Self-hosted mode configured');
    printSuccess('.env created with Supabase + Voyage AI keys');
  } else {
    printSuccess('Local mode — no API keys needed');
    printInfo('Memories stored in ~/.clude/memories.json');
  }

  if (mcpChoice !== 'skip') {
    // Verify MCP installation
    const toVerify = mcpChoice === 'all' ? targets : targets.filter(t => t.key === mcpChoice);
    let verified = 0;
    for (const target of toVerify) {
      try {
        const content = fs.readFileSync(target.configPath, 'utf-8');
        if (content.includes('clude')) verified++;
      } catch {}
    }
    if (verified === toVerify.length) {
      console.log(`\n  ${c.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
      console.log(`  ${c.green}✓${c.reset} ${c.bold}Clude MCP server verified!${c.reset}`);
      console.log(`  ${c.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
    } else {
      printSuccess('MCP server configured for your IDE');
    }
    printInfo('Restart your IDE to activate the MCP server.');
  }

  console.log(`\n  ${c.bold}Quick start:${c.reset}`);

  if (mode === 'selfhosted') {
    printCodeBlock(
      `const { Cortex } = require('clude-bot');\n` +
      `\n` +
      `const brain = new Cortex();\n` +
      `await brain.init();\n` +
      `\n` +
      `// Store a memory\n` +
      `await brain.store({\n` +
      `  type: 'episodic',\n` +
      `  content: 'User asked about pricing.',\n` +
      `  summary: 'Pricing inquiry',\n` +
      `  source: '${agentName || 'my-agent'}',\n` +
      `});\n` +
      `\n` +
      `// Recall memories\n` +
      `const memories = await brain.recall({ query: 'pricing' });\n` +
      `console.log(brain.formatContext(memories));`
    );
  } else if (mode === 'local') {
    printCodeBlock(
      `// Local mode — use the MCP server in your IDE.\n` +
      `// Memories are stored in ~/.clude/memories.json\n` +
      `// No code integration needed — just chat!\n` +
      `\n` +
      `// Or use the SDK:\n` +
      `const { LocalStore } = require('clude-bot/local');\n` +
      `const store = new LocalStore();\n` +
      `await store.store({ type: 'episodic', content: 'hello', summary: 'test' });`
    );
  } else {
    printCodeBlock(
      `const { Cortex } = require('clude-bot');\n` +
      `\n` +
      `const brain = new Cortex({\n` +
      `  hosted: { apiKey: process.env.CORTEX_API_KEY },\n` +
      `});\n` +
      `await brain.init();\n` +
      `\n` +
      `// Store a memory\n` +
      `await brain.store({\n` +
      `  type: 'episodic',\n` +
      `  content: 'User asked about pricing.',\n` +
      `  summary: 'Pricing inquiry',\n` +
      `  source: '${agentName || 'my-agent'}',\n` +
      `});\n` +
      `\n` +
      `// Recall memories\n` +
      `const memories = await brain.recall({ query: 'pricing' });\n` +
      `console.log(brain.formatContext(memories));`
    );
  }

  console.log(`  ${c.dim}Dashboard:${c.reset}  ${c.cyan}https://clude.io/explore${c.reset}`);
  console.log(`  ${c.dim}Docs:${c.reset}       ${c.cyan}https://clude.io/docs${c.reset}`);
  console.log(`  ${c.dim}Export:${c.reset}     ${c.cyan}npx clude-bot export${c.reset}`);
  printDivider();
  console.log('');

  rl.close();
}

// ─── Standalone MCP Install ─────────────────────────────────

export async function runMcpInstall(): Promise<void> {
  const isLocal = process.argv.includes('--local');

  printBanner();
  console.log(`  ${c.bold}MCP Server Install${c.reset}${isLocal ? ` ${c.green}(local mode)${c.reset}` : ''}`);
  console.log(`  ${c.gray}Add Clude memory to your AI IDE.${c.reset}\n`);

  const rl = createPrompt();

  const targets = getMcpTargets();
  const choices = [
    ...targets.map(t => ({ key: t.key, label: t.label })),
    { key: 'all', label: 'All of the above' },
  ];

  const mcpChoice = await askChoice(rl, 'Select IDE:', choices);
  console.log('');

  const agentName = await ask(rl, 'Agent name (Enter for folder name): ');
  const name = agentName || path.basename(process.cwd());
  console.log('');

  const toInstall = mcpChoice === 'all' ? targets : targets.filter(t => t.key === mcpChoice);

  for (const target of toInstall) {
    const result = installMcpConfigLegacy(target, name, '', undefined, isLocal);
    if (result.ok) {
      printSuccess(`Added clude-memory to ${target.label}`);
      printInfo(`  ${c.dim}${target.configPath}${c.reset}`);
    } else {
      printError(`Could not configure ${target.label}: ${result.error}`);
    }
  }

  // Verify installation by reading back the config files
  console.log('');
  let verified = 0;
  for (const target of toInstall) {
    try {
      const content = require('fs').readFileSync(target.configPath, 'utf-8');
      if (content.includes('clude')) {
        verified++;
      }
    } catch {}
  }

  if (verified === toInstall.length) {
    console.log(`  ${c.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
    console.log(`  ${c.green}✓${c.reset} ${c.bold}Clude MCP server verified!${c.reset}`);
    console.log(`  ${c.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
  } else {
    printWarn('Could not verify all installations. Check the paths above.');
  }

  // ─── Instruction Injection ───────────────────────────
  console.log('');
  const cwd = process.cwd();
  const useAgentsmd = detectAgentsmd(cwd);
  const targetFile = useAgentsmd ? 'AGENTS.md' : 'CLAUDE.md';

  printInfo(`Writing Clude usage instructions to ${targetFile}...`);
  const injResult = injectInstructions(cwd, { agentsmd: useAgentsmd });
  if (injResult) {
    if (injResult.action === 'created') {
      printSuccess(`Created ${targetFile} with Clude memory instructions`);
    } else if (injResult.action === 'appended') {
      printSuccess(`Appended Clude memory section to existing ${targetFile}`);
    } else {
      printSuccess(`Updated Clude memory section in ${targetFile}`);
    }
  } else {
    printWarn(`Could not write to ${targetFile} — run \`npx clude-bot inject-instructions\` manually`);
  }

  console.log('');
  if (isLocal) {
    printSuccess('Local mode: memories stored on-device, fully offline.');
    printInfo('No API keys needed. ~30MB model downloads on first use.');
  }
  printInfo('Restart your IDE to activate the MCP server.');
  printInfo(`Run ${c.cyan}npx clude-bot status${c.reset} anytime to check if Clude is active.`);
  printDivider();
  console.log('');

  rl.close();
}

// ─── Zero-config helpers ────────────────────────────────────────

export interface IDEInfo {
  name: string;
  configPath: string;
}

export interface RegistrationResult {
  apiKey?: string;
  wallet?: string;
}

export async function getEmail(opts: { skipPrompt?: boolean } = {}): Promise<string | null> {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // 1. Env var
  if (process.env.CLUDE_SETUP_EMAIL) {
    const trimmed = process.env.CLUDE_SETUP_EMAIL.trim();
    return emailRegex.test(trimmed) ? trimmed : null;
  }

  // 2. Git config
  try {
    const out = execSync('git config user.email', {
      encoding: 'utf-8',
      timeout: 2000,
    });
    const email = out.toString().trim();
    if (email && emailRegex.test(email)) {
      return email;
    }
  } catch {
    // git not installed or no config — fall through
  }

  // 3. Prompt (unless skipped)
  if (opts.skipPrompt) return null;

  const rl = createPrompt();
  return new Promise((resolve) => {
    rl.question('  Email: ', (answer: string) => {
      rl.close();
      const trimmed = answer.trim();
      resolve(trimmed && emailRegex.test(trimmed) ? trimmed : null);
    });
  });
}

export function detectInstalledIDEs(): IDEInfo[] {
  const ides: IDEInfo[] = [];
  const home = os.homedir();

  if (fs.existsSync(path.join(home, '.claude'))) {
    ides.push({
      name: 'Claude Code',
      configPath: path.join(home, '.claude', '.mcp.json'),
    });
  }

  if (fs.existsSync(path.join(home, '.cursor'))) {
    ides.push({
      name: 'Cursor',
      configPath: path.join(home, '.cursor', 'mcp.json'),
    });
  }

  // Claude Desktop (macOS)
  if (process.platform === 'darwin') {
    const desktopPath = path.join(
      home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json',
    );
    if (fs.existsSync(path.dirname(desktopPath))) {
      ides.push({ name: 'Claude Desktop', configPath: desktopPath });
    }
  }

  return ides;
}

export function installMcpConfig(
  ide: IDEInfo,
  reg: RegistrationResult,
): boolean {
  let existing: any = { mcpServers: {} };
  let merged = false;

  if (fs.existsSync(ide.configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(ide.configPath, 'utf-8'));
      if (!existing.mcpServers) existing.mcpServers = {};
      if (existing.mcpServers['clude-memory']) merged = true;
    } catch {
      existing = { mcpServers: {} };
    }
  }

  const env: Record<string, string> = {};
  if (reg.apiKey) env.CORTEX_API_KEY = reg.apiKey;
  if (reg.wallet) env.CLUDE_WALLET = reg.wallet;

  existing.mcpServers['clude-memory'] = {
    command: 'npx',
    args: ['clude-bot', 'mcp-serve'],
    env,
  };

  fs.mkdirSync(path.dirname(ide.configPath), { recursive: true });
  fs.writeFileSync(ide.configPath, JSON.stringify(existing, null, 2));
  return merged;
}

export async function validateSetup(): Promise<boolean> {
  try {
    const { SqliteStore } = require('../storage/sqlite-store');
    const { LocalEmbedder } = require('../storage/embedder');

    const embedder = new LocalEmbedder();
    const store = new SqliteStore({
      dbPath: path.join(os.homedir(), '.clude', 'brain.db'),
      embedder,
    });

    const id = await store.store({
      type: 'episodic',
      content: 'Clude setup validation test',
      summary: 'Setup validation',
      source: 'cli:setup:validate',
    });
    const result = await store.recall({ query: 'Setup validation', limit: 1 });
    const deleted = store.delete(id);
    store.close();

    return result.count > 0 && deleted;
  } catch {
    return false;
  }
}
