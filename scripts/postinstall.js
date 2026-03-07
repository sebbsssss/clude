#!/usr/bin/env node

// Postinstall: show banner, then run inline setup wizard.
// Uses readline directly on /dev/tty to bypass npm's pipe suppression.
// No child process — everything runs in this script.

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const dim = '\x1b[2m';
const reset = '\x1b[0m';
const bold = '\x1b[1m';
const cyan = '\x1b[36m';
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const white = '\x1b[97m';
const gray = '\x1b[90m';

const banner = `
${dim}────────────────────────────────────────────────────${reset}

${white}        ▄▄▄   ▄     ▄   ▄ ▄▄▄   ▄▄▄${reset}
${white}       █     █     █   █ █   █ █${reset}
${white}       █     █     █   █ █   █ █▀▀${reset}
${white}       █▄▄▄  █▄▄▄  ▀▄▄▀ █▄▄▀  █▄▄▄${reset}

${dim}  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░${reset}
${dim}  ░░░░░  ${reset}${bold}persistent memory for AI agents${reset}${dim}  ░░░░░${reset}
${dim}  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░${reset}

${dim}────────────────────────────────────────────────────${reset}

  ${green}✓${reset} Installed!
`;

const fallbackHelp = `
  ${bold}Next step — run the setup wizard:${reset}

    ${cyan}npx clude-bot setup${reset}

  ${gray}This will register your agent, create .env, and${reset}
  ${gray}optionally install the MCP server for your IDE.${reset}

${dim}────────────────────────────────────────────────────${reset}
`;

// ─── Helpers ──────────────────────────────────────────────

function writeTty(text) {
  try {
    fs.writeFileSync('/dev/tty', text);
    return true;
  } catch {
    try { process.stderr.write(text); return false; } catch { return false; }
  }
}

function ok(msg) { writeTty(`  ${green}✓${reset} ${msg}\n`); }
function warn(msg) { writeTty(`  ${yellow}⚠${reset} ${msg}\n`); }
function info(msg) { writeTty(`  ${gray}${msg}${reset}\n`); }
function step(n, total, title) {
  writeTty(`\n  ${cyan}─── Step ${n}/${total}: ${title} ${'─'.repeat(Math.max(0, 36 - title.length))}${reset}\n\n`);
}

// ─── Show banner ──────────────────────────────────────────

writeTty('\n' + banner);

// ─── Check if already configured ─────────────────────────

const userDir = process.env.INIT_CWD || process.cwd();
const envPath = path.join(userDir, '.env');
let alreadyConfigured = false;

try {
  const env = fs.readFileSync(envPath, 'utf-8');
  if (env.includes('CORTEX_API_KEY=') && !env.includes('CORTEX_API_KEY=your-api-key')) {
    alreadyConfigured = true;
  }
} catch {}

if (alreadyConfigured) {
  writeTty(`  ${gray}Already configured — .env found with API key.${reset}\n`);
  writeTty(`  ${gray}Run ${reset}${cyan}npx clude-bot setup${reset}${gray} to reconfigure.${reset}\n\n`);
  writeTty(`${dim}────────────────────────────────────────────────────${reset}\n`);
  process.exit(0);
}

// ─── Try to open /dev/tty for interactive setup ──────────

let ttyIn, ttyOut;
try {
  ttyIn = fs.createReadStream('/dev/tty');
  ttyOut = fs.createWriteStream('/dev/tty');
} catch {
  // Non-interactive (CI, Windows, Docker) — just show help
  writeTty(fallbackHelp + '\n');
  process.exit(0);
}

const rl = readline.createInterface({ input: ttyIn, output: ttyOut });

function ask(question) {
  return new Promise((resolve) => {
    rl.question(`  ${white}?${reset} ${question}`, (answer) => {
      resolve(answer.trim());
    });
  });
}

// ─── MCP Config ──────────────────────────────────────────

function getMcpTargets() {
  const home = process.env.HOME || process.env.USERPROFILE || '~';
  const targets = [];

  if (process.platform === 'darwin') {
    targets.push({ key: '1', label: 'Claude Desktop', path: path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json') });
  } else if (process.platform === 'win32') {
    targets.push({ key: '1', label: 'Claude Desktop', path: path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json') });
  } else {
    targets.push({ key: '1', label: 'Claude Desktop', path: path.join(home, '.config', 'Claude', 'claude_desktop_config.json') });
  }
  targets.push({ key: '2', label: 'Claude Code (project)', path: path.join(userDir, '.mcp.json') });
  targets.push({ key: '3', label: 'Cursor', path: path.join(home, '.cursor', 'mcp.json') });
  return targets;
}

function installMcp(configPath, agentName, wallet) {
  const entry = {
    command: 'npx',
    args: ['-y', '@clude/mcp'],
    env: {
      ...(wallet ? { CLUDE_WALLET: wallet } : {}),
      ...(agentName ? { CLUDE_AGENT_NAME: agentName } : {}),
    },
  };
  try {
    let config = {};
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } else {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
    }
    if (!config.mcpServers) config.mcpServers = {};
    config.mcpServers['clude-memory'] = entry;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    return true;
  } catch {
    return false;
  }
}

// ─── Inline Setup Wizard ─────────────────────────────────

async function runSetup() {
  writeTty(`\n  ${bold}Let's get your agent's memory running.${reset}\n`);

  let apiKey = '';
  let agentName = '';
  let wallet = '';

  // ─── Step 1: Register ────────────────────────────────
  step(1, 3, 'Register');
  info('We\'ll create an account on clude.io and get you an API key.');
  info('Already have a key? Just paste it below.\n');

  const existingKey = await ask('API key (or Enter to register a new one): ');

  if (existingKey) {
    apiKey = existingKey;
    ok('Using existing API key');
  } else {
    agentName = await ask('Agent name (your project name): ');
    if (!agentName || agentName.length < 2) {
      agentName = path.basename(userDir);
      info(`Using directory name: ${agentName}`);
    }

    wallet = await ask('Solana wallet address (Enter to skip): ');
    writeTty('\n');

    writeTty(`  ${gray}Registering on clude.io...${reset}`);

    try {
      const res = await fetch('https://cluude.ai/api/cortex/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: agentName, wallet: wallet || 'pending' }),
      });

      // Clear loading text
      writeTty('\r' + ' '.repeat(40) + '\r');

      if (res.ok) {
        const data = await res.json();
        if (data.apiKey) {
          apiKey = data.apiKey;
          ok(`Registered! API key: ${green}${apiKey.slice(0, 12)}...${reset}`);
          info(`Agent ID: ${data.agentId}`);
        } else {
          warn('Registration returned no key');
        }
      } else {
        const err = await res.json().catch(() => ({}));
        warn(`Registration failed: ${err.error || res.statusText}`);
        info('Run npx clude-bot register later to get a key');
      }
    } catch (err) {
      writeTty('\r' + ' '.repeat(40) + '\r');
      warn(`Could not reach clude.io: ${err.message}`);
      info('Run npx clude-bot register later to get a key');
    }
  }

  writeTty('\n');

  // ─── Step 2: Create .env ─────────────────────────────
  step(2, 3, 'Configuration');

  const envLines = [
    '# Generated by clude-bot setup',
    '',
    '# Cortex API (hosted memory)',
    `CORTEX_API_KEY=${apiKey || 'your-api-key'}`,
    'CORTEX_HOST_URL=https://cluude.ai',
    '',
  ];
  if (wallet) {
    envLines.push('# Owner wallet', `OWNER_WALLET=${wallet}`, '');
  }
  const envContent = envLines.join('\n');

  if (fs.existsSync(envPath)) {
    const existing = fs.readFileSync(envPath, 'utf-8');
    if (existing.includes('CORTEX_API_KEY')) {
      info('.env already has CORTEX_API_KEY — skipping');
    } else {
      fs.appendFileSync(envPath, '\n' + envContent);
      ok('Appended Cortex config to existing .env');
    }
  } else {
    fs.writeFileSync(envPath, envContent, 'utf-8');
    ok('Created .env');
  }

  // .gitignore
  const gitignorePath = path.join(userDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gi = fs.readFileSync(gitignorePath, 'utf-8');
    if (!gi.includes('.env')) {
      fs.appendFileSync(gitignorePath, '\n.env\n');
      ok('Added .env to .gitignore');
    }
  } else {
    fs.writeFileSync(gitignorePath, '.env\nnode_modules/\n', 'utf-8');
    ok('Created .gitignore');
  }

  writeTty('\n');

  // ─── Step 3: MCP Install ─────────────────────────────
  step(3, 3, 'IDE Integration');
  info('Install the MCP server so your AI IDE can access memories.\n');

  const targets = getMcpTargets();
  for (const t of targets) {
    writeTty(`    ${cyan}${t.key}${reset}) ${t.label}\n`);
  }
  writeTty(`    ${cyan}4${reset}) All of the above\n`);
  writeTty(`    ${cyan}5${reset}) Skip\n`);

  const mcpChoice = await ask('\nSelect (number): ');
  writeTty('\n');

  if (mcpChoice !== '5' && mcpChoice.toLowerCase() !== 'skip') {
    const toInstall = mcpChoice === '4'
      ? targets
      : targets.filter(t => t.key === mcpChoice);

    if (toInstall.length === 0 && mcpChoice !== '5') {
      // Default to skip if invalid
      info('Skipped — run npx clude-bot mcp-install anytime');
    } else {
      for (const t of toInstall) {
        if (installMcp(t.path, agentName, wallet)) {
          ok(`Added clude-memory to ${t.label}`);
          info(`  ${dim}${t.path}${reset}`);
        } else {
          warn(`Could not configure ${t.label}`);
        }
      }
    }
  } else {
    info('Skipped — run npx clude-bot mcp-install anytime');
  }

  // ─── Done ────────────────────────────────────────────
  writeTty(`\n${dim}────────────────────────────────────────────────────${reset}\n`);
  writeTty(`\n  ${bold}${green}You're all set!${reset}\n\n`);

  if (apiKey) ok('API key configured');
  else warn('No API key yet — run: npx clude-bot register');
  ok('.env created');

  writeTty(`\n  ${bold}Quick start:${reset}\n`);
  writeTty(`  ${dim}┌──────────────────────────────────────────────────${reset}\n`);
  writeTty(`  ${dim}│${reset} const { Cortex } = require('clude-bot');\n`);
  writeTty(`  ${dim}│${reset} const brain = new Cortex({\n`);
  writeTty(`  ${dim}│${reset}   hosted: { apiKey: process.env.CORTEX_API_KEY },\n`);
  writeTty(`  ${dim}│${reset} });\n`);
  writeTty(`  ${dim}│${reset} await brain.init();\n`);
  writeTty(`  ${dim}└──────────────────────────────────────────────────${reset}\n`);

  writeTty(`\n  ${dim}Dashboard:${reset}  ${cyan}https://clude.io/explore${reset}\n`);
  writeTty(`  ${dim}Docs:${reset}       ${cyan}https://clude.io/docs${reset}\n`);
  writeTty(`${dim}────────────────────────────────────────────────────${reset}\n\n`);

  rl.close();
  ttyIn.destroy();
  ttyOut.end();
}

runSetup().catch(() => {
  // If anything fails, show fallback
  try { rl.close(); } catch {}
  writeTty(fallbackHelp + '\n');
});
