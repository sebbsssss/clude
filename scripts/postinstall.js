#!/usr/bin/env node

// Postinstall: show banner + run inline setup wizard.
// 100% synchronous — no readline, no event loop, no child process for setup.
// Reads input via fs.readSync on /dev/tty, writes via fs.writeFileSync.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const dim = '\x1b[2m';
const reset = '\x1b[0m';
const bold = '\x1b[1m';
const cyan = '\x1b[36m';
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const white = '\x1b[97m';
const gray = '\x1b[90m';

// ─── I/O Helpers ─────────────────────────────────────────

function writeTty(text) {
  try { fs.writeFileSync('/dev/tty', text); return true; }
  catch { try { process.stderr.write(text); return false; } catch { return false; } }
}

function readLine() {
  // Read one line synchronously from /dev/tty
  const buf = Buffer.alloc(1024);
  let input = '';
  const fd = fs.openSync('/dev/tty', 'r');
  try {
    const n = fs.readSync(fd, buf, 0, 1024);
    input = buf.toString('utf-8', 0, n).replace(/\r?\n$/, '').trim();
  } catch {}
  fs.closeSync(fd);
  return input;
}

function ask(question) {
  writeTty(`  ${white}?${reset} ${question}`);
  return readLine();
}

function ok(msg) { writeTty(`  ${green}✓${reset} ${msg}\n`); }
function warn(msg) { writeTty(`  ${yellow}⚠${reset} ${msg}\n`); }
function info(msg) { writeTty(`  ${gray}${msg}${reset}\n`); }
function step(n, total, title) {
  writeTty(`\n  ${cyan}─── Step ${n}/${total}: ${title} ${'─'.repeat(Math.max(0, 36 - title.length))}${reset}\n\n`);
}

// ─── Animated Banner ─────────────────────────────────────

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {} // busy-wait (ok for postinstall)
}

// ANSI helpers
const hide = '\x1b[?25l';  // hide cursor
const show = '\x1b[?25h';  // show cursor
const up = (n) => `\x1b[${n}A`;
const clearLine = '\x1b[2K\r';

function animateBanner() {
  writeTty(hide);

  // Phase 1: Neural network builds up (fast)
  const network = [
    `        ${dim}·${reset}`,
    `        ${dim}·   ·${reset}`,
    `      ${dim}· · · · ·${reset}`,
    `    ${dim}· · · · · · · ·${reset}`,
    `  ${dim}· · · · · · · · · · ·${reset}`,
    `${dim}· · · · · · · · · · · · · ·${reset}`,
  ];

  // Reserve space
  writeTty('\n\n\n\n\n\n\n\n\n\n\n\n\n\n');
  writeTty(up(14));

  // Draw neural dots building up
  for (let i = 0; i < network.length; i++) {
    writeTty(clearLine + '  ' + network[i] + '\n');
    sleep(40);
  }
  sleep(80);

  // Phase 2: Dots transform into neural connections
  writeTty(up(6));
  const connections = [
    `        ${cyan}◉${reset}`,
    `      ${cyan}◉${dim}───${reset}${cyan}◉${reset}`,
    `    ${cyan}◉${dim}───${reset}${cyan}◉${dim}───${reset}${cyan}◉${reset}`,
    `  ${cyan}◉${dim}─┬─${reset}${cyan}◉${dim}─┬─${reset}${cyan}◉${dim}─┬─${reset}${cyan}◉${reset}`,
    `  ${dim}│ ╲ │ ╳ │ ╱ │${reset}`,
    `  ${cyan}◉${dim}─┴─${reset}${cyan}◉${dim}─┴─${reset}${cyan}◉${dim}─┴─${reset}${cyan}◉${reset}`,
  ];

  for (let i = 0; i < connections.length; i++) {
    writeTty(clearLine + '          ' + connections[i] + '\n');
    sleep(50);
  }
  sleep(100);

  // Phase 3: Network fades, CLUDE text types in
  writeTty(up(6));
  // Clear the network area
  for (let i = 0; i < 6; i++) {
    writeTty(clearLine + '\n');
  }
  writeTty(up(6));

  writeTty(clearLine + `${dim}────────────────────────────────────────────────────${reset}\n`);
  writeTty(clearLine + '\n');

  // Type the CLUDE letters one at a time (Pagga figlet font)
  const letters = [
    // C
    ['░█▀▀', '░█░░', '░▀▀▀'],
    // L
    ['░█░░', '░█░░', '░▀▀▀'],
    // U
    ['░█░█', '░█░█', '░▀▀▀'],
    // D
    ['░█▀▄', '░█░█', '░▀▀░'],
    // E
    ['░█▀▀', '░█▀▀', '░▀▀▀'],
  ];

  // Build display line by line, letter by letter (no spaces — ░ IS the separator)
  const display = ['', '', ''];
  for (let li = 0; li < letters.length; li++) {
    for (let row = 0; row < 3; row++) {
      display[row] += letters[li][row];
    }
    // Redraw all 3 lines with trailing ░
    if (li > 0) writeTty(up(3));
    for (let row = 0; row < 3; row++) {
      writeTty(clearLine + `${white}       ${display[row]}░${reset}\n`);
    }
    sleep(80);
  }

  sleep(150);

  // Phase 4: Tagline slides in
  writeTty(clearLine + '\n');
  const tagline = 'Persistent Memory For AI Agents';
  const pad = '  ░░░░░  ';
  writeTty(clearLine + `${dim}  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░${reset}\n`);

  // Type the tagline
  for (let i = 0; i <= tagline.length; i++) {
    const typed = tagline.slice(0, i);
    const remaining = ' '.repeat(tagline.length - i);
    writeTty(clearLine + `${dim}${pad}${reset}${bold}${typed}${reset}${remaining}${dim}  ░░░░░${reset}`);
    sleep(20);
  }
  writeTty('\n');
  writeTty(clearLine + `${dim}  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░${reset}\n`);

  sleep(100);

  // Phase 5: Bottom bar + installed
  writeTty(clearLine + '\n');
  writeTty(clearLine + `${dim}────────────────────────────────────────────────────${reset}\n`);
  writeTty(clearLine + '\n');
  writeTty(clearLine + `  ${green}✓${reset} ${bold}Installed!${reset}\n`);

  writeTty(show);
}

try {
  animateBanner();
} catch {
  // Fallback: static banner if animation fails (e.g., no TTY)
  const banner = `
${dim}────────────────────────────────────────────────────${reset}

${white}       ░█▀▀░█░░░█░█░█▀▄░█▀▀░${reset}
${white}       ░█░░░█░░░█░█░█░█░█▀▀░${reset}
${white}       ░▀▀▀░▀▀▀░▀▀▀░▀▀░░▀▀▀░${reset}

${dim}  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░${reset}
${dim}  ░░░░░  ${reset}${bold}Persistent Memory For AI Agents${reset}${dim}  ░░░░░${reset}
${dim}  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░${reset}

${dim}────────────────────────────────────────────────────${reset}

  ${green}✓${reset} Installed!
`;
  writeTty('\n' + banner);
}

// ─── Check if already configured ─────────────────────────

const userDir = process.env.INIT_CWD || process.cwd();
const envPath = path.join(userDir, '.env');

try {
  const env = fs.readFileSync(envPath, 'utf-8');
  if (env.includes('CORTEX_API_KEY=') && !env.includes('CORTEX_API_KEY=your-api-key')) {
    writeTty(`  ${gray}Already configured — .env found with API key.${reset}\n`);
    writeTty(`  ${gray}Run ${reset}${cyan}npx clude-bot setup${reset}${gray} to reconfigure.${reset}\n\n`);
    writeTty(`${dim}────────────────────────────────────────────────────${reset}\n`);
    process.exit(0);
  }
} catch {}

// ─── Check if /dev/tty is available for input ────────────

let canReadTty = false;
try {
  const fd = fs.openSync('/dev/tty', 'r');
  fs.closeSync(fd);
  canReadTty = true;
} catch {}

if (!canReadTty) {
  writeTty(`\n  ${bold}To set up, run:${reset}  ${cyan}npx clude-bot setup${reset}\n`);
  writeTty(`  ${gray}Or visit:${reset}       ${cyan}https://clude.io/setup${reset}\n\n`);
  writeTty(`${dim}────────────────────────────────────────────────────${reset}\n`);
  process.exit(0);
}

// ─── Setup Wizard (fully synchronous) ────────────────────

writeTty(`\n  ${bold}Let's get your agent's memory running.${reset}\n`);

let apiKey = '';
let agentName = '';
let wallet = '';

// ─── Step 1: Register ────────────────────────────────────

step(1, 3, 'Register');
info('We\'ll create an account on clude.io and get you an API key.');
info('Already have a key? Just paste it below.\n');

const existingKey = ask('API key (or Enter to register a new one): ');

if (existingKey) {
  apiKey = existingKey;
  ok('Using existing API key');
} else {
  agentName = ask('Agent name (your project name): ');
  if (!agentName || agentName.length < 2) {
    agentName = path.basename(userDir);
    info(`Using directory name: ${agentName}`);
  }

  wallet = ask('Solana wallet address (Enter to skip): ');
  writeTty('\n');
  writeTty(`  ${gray}Registering on clude.io...${reset}`);

  try {
    const payload = JSON.stringify({ name: agentName, wallet: wallet || 'pending' });
    const result = execSync(
      `curl -s -X POST https://clude.io/api/cortex/register -H "Content-Type: application/json" -d '${payload.replace(/'/g, "'\\''")}'`,
      { timeout: 15000, encoding: 'utf-8' }
    );

    writeTty('\r' + ' '.repeat(50) + '\r');

    const data = JSON.parse(result);
    if (data.apiKey) {
      apiKey = data.apiKey;
      ok(`Registered! API key: ${green}${apiKey.slice(0, 12)}...${reset}`);
      if (data.agentId) info(`Agent ID: ${data.agentId}`);
    } else if (data.error) {
      warn(`Registration failed: ${data.error}`);
      info('Run npx clude-bot register later to get a key');
    }
  } catch (err) {
    writeTty('\r' + ' '.repeat(50) + '\r');
    const msg = (err && err.message) || String(err);
    if (/certificate|CERT|SSL|self.signed|unable to verify/i.test(msg)) {
      warn('SSL certificate error — your network may be intercepting HTTPS');
      info('Common with corporate firewalls (Fortinet, Zscaler, etc.)');
      info('Try a mobile hotspot/VPN, or ask IT to whitelist clude.io');
    } else {
      warn('Could not reach clude.io');
    }
    info('Run npx clude-bot register later to get a key');
  }
}

writeTty('\n');

// ─── Step 2: Create .env ─────────────────────────────────

step(2, 3, 'Configuration');

const envLines = [
  '# Generated by clude-bot setup',
  '',
  '# Cortex API (hosted memory)',
  `CORTEX_API_KEY=${apiKey || 'your-api-key'}`,
  'CORTEX_HOST_URL=https://clude.io',
  '',
];
if (wallet) {
  envLines.push('# Owner wallet', `OWNER_WALLET=${wallet}`, '');
}
const envContent = envLines.join('\n');

try {
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
} catch (err) {
  warn('Could not write .env: ' + err.message);
}

// .gitignore
try {
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
} catch {}

writeTty('\n');

// ─── Step 3: MCP Install ─────────────────────────────────

step(3, 3, 'IDE Integration');
info('Install the MCP server so your AI IDE can access memories.\n');

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

for (const t of targets) {
  writeTty(`    ${cyan}${t.key}${reset}) ${t.label}\n`);
}
writeTty(`    ${cyan}4${reset}) All of the above\n`);
writeTty(`    ${cyan}5${reset}) Skip\n`);

const mcpChoice = ask('\nSelect (number): ');
writeTty('\n');

function installMcp(configPath) {
  const entry = {
    command: 'npx',
    args: ['clude-bot', 'mcp-serve'],
    env: {
      ...(apiKey ? { CORTEX_API_KEY: apiKey } : {}),
      CORTEX_HOST_URL: 'https://clude.io',
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
  } catch { return false; }
}

if (mcpChoice && mcpChoice !== '5') {
  const toInstall = mcpChoice === '4' ? targets : targets.filter(t => t.key === mcpChoice);

  if (toInstall.length === 0) {
    info('Skipped — run npx clude-bot mcp-install anytime');
  } else {
    for (const t of toInstall) {
      if (installMcp(t.path)) {
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

// ─── Done ────────────────────────────────────────────────

writeTty(`\n${dim}────────────────────────────────────────────────────${reset}\n`);
writeTty(`\n  ${bold}${green}You're all set!${reset}\n\n`);

if (apiKey) ok('API key configured');
else warn('No API key yet — run: npx clude-bot register');
ok('.env created');

writeTty(`\n  ${bold}Next steps:${reset}\n`);
writeTty(`  ${dim}Explorer:${reset}   ${cyan}https://clude.io/explore${reset}\n`);
writeTty(`  ${dim}Docs:${reset}       ${cyan}https://clude.io/docs${reset}\n`);
writeTty(`  ${dim}Reconfigure:${reset} ${cyan}npx clude-bot setup${reset}\n`);
writeTty(`${dim}────────────────────────────────────────────────────${reset}\n\n`);
