import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
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

function installMcpConfig(target: McpTarget, agentName: string, wallet: string): { ok: boolean; error?: string } {
  const mcpEntry = {
    command: 'npx',
    args: ['-y', '@clude/mcp'],
    env: {
      ...(wallet ? { CLUDE_WALLET: wallet } : {}),
      ...(agentName ? { CLUDE_AGENT_NAME: agentName } : {}),
    },
  };

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

// ─── Main Setup Flow ────────────────────────────────────────

export async function runSetup(): Promise<void> {
  printBanner();
  console.log(`  ${c.bold}Let's get your agent's memory running.${c.reset}`);
  console.log(`  ${c.gray}This takes about 30 seconds.${c.reset}\n`);

  const rl = createPrompt();

  // ─── Step 1: Register ──────────────────────────────────
  printStep(1, 3, 'Register');
  printInfo('We\'ll create an account on clude.io and get you an API key.');
  printInfo('Already have a key? Just paste it when asked.\n');

  const existingKey = await ask(rl, 'Existing API key? (Enter to register a new one): ');

  let apiKey = existingKey;
  let agentName = '';
  let wallet = '';

  if (!existingKey) {
    // Register flow
    agentName = await ask(rl, 'Agent name (your project name): ');
    if (!agentName || agentName.length < 2) {
      agentName = path.basename(process.cwd());
      printInfo(`Using directory name: ${agentName}`);
    }

    wallet = await ask(rl, 'Solana wallet address (Enter to skip): ');
    console.log('');

    // Try to register
    process.stdout.write(`  ${c.gray}Registering on clude.io...${c.reset}`);

    try {
      const res = await fetch('https://cluude.ai/api/cortex/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agentName,
          wallet: wallet || 'pending',
        }),
      });

      // Clear the loading line
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
      printWarn(`Could not reach clude.io: ${(err as Error).message}`);
      printInfo('You can register manually later: npx clude-bot register');
      apiKey = await ask(rl, 'Paste an API key (or Enter to skip): ');
    }
  } else {
    printSuccess('Using existing API key');
    agentName = await ask(rl, 'Agent name (for MCP config, Enter to use folder name): ');
    if (!agentName) agentName = path.basename(process.cwd());
    wallet = await ask(rl, 'Solana wallet address (Enter to skip): ');
  }

  console.log('');

  // ─── Step 2: Create .env ───────────────────────────────
  printStep(2, 3, 'Configuration');

  const envPath = path.resolve(process.cwd(), '.env');
  let envLines = [
    '# Generated by clude-bot setup',
    '',
    '# Cortex API (hosted memory)',
    `CORTEX_API_KEY=${apiKey || 'your-api-key'}`,
    'CORTEX_HOST_URL=https://cluude.ai',
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
      // Append to existing .env
      fs.appendFileSync(envPath, '\n' + envContent);
      printSuccess('Appended Cortex config to existing .env');
    }
  } else {
    fs.writeFileSync(envPath, envContent, 'utf-8');
    printSuccess('Created .env');
  }

  // Check .gitignore
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

  // ─── Step 3: MCP Install ──────────────────────────────
  printStep(3, 3, 'IDE Integration');
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

    for (const target of toInstall) {
      const result = installMcpConfig(target, agentName, wallet);
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

  // ─── Done ─────────────────────────────────────────────
  printDivider();
  console.log(`\n  ${c.bold}${c.green}You're all set!${c.reset}\n`);

  if (apiKey) {
    printSuccess('API key configured');
  } else {
    printWarn('No API key yet — run: npx clude-bot register');
  }
  printSuccess('.env created');
  if (mcpChoice !== 'skip') {
    printSuccess('MCP server configured for your IDE');
  }

  console.log(`\n  ${c.bold}Quick start:${c.reset}`);
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

  console.log(`  ${c.dim}Dashboard:${c.reset}  ${c.cyan}https://clude.io/explore${c.reset}`);
  console.log(`  ${c.dim}Docs:${c.reset}       ${c.cyan}https://clude.io/docs${c.reset}`);
  console.log(`  ${c.dim}Export:${c.reset}     ${c.cyan}npx clude-bot export${c.reset}`);
  printDivider();
  console.log('');

  rl.close();
}

// ─── Standalone MCP Install ─────────────────────────────────

export async function runMcpInstall(): Promise<void> {
  printBanner();
  console.log(`  ${c.bold}MCP Server Install${c.reset}`);
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

  const wallet = await ask(rl, 'Solana wallet (Enter to skip): ');
  console.log('');

  const toInstall = mcpChoice === 'all' ? targets : targets.filter(t => t.key === mcpChoice);

  for (const target of toInstall) {
    const result = installMcpConfig(target, name, wallet);
    if (result.ok) {
      printSuccess(`Added clude-memory to ${target.label}`);
      printInfo(`  ${c.dim}${target.configPath}${c.reset}`);
    } else {
      printError(`Could not configure ${target.label}: ${result.error}`);
    }
  }

  console.log('');
  printInfo('Restart your IDE to activate the MCP server.');
  printDivider();
  console.log('');

  rl.close();
}
