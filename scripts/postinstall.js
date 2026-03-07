#!/usr/bin/env node

// Lightweight postinstall banner — no dependencies, no async, just vibes.

const dim = '\x1b[2m';
const reset = '\x1b[0m';
const bold = '\x1b[1m';
const cyan = '\x1b[36m';
const green = '\x1b[32m';
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

  ${bold}Next step — run the setup wizard:${reset}

    ${cyan}npx clude-bot setup${reset}

  ${gray}This will (in ~30 seconds):${reset}
  ${gray}  1. Register your agent and get an API key${reset}
  ${gray}  2. Create your .env file automatically${reset}
  ${gray}  3. Install MCP server for your IDE (optional)${reset}

  ${dim}Already have an API key?${reset}
  ${dim}  npx clude-bot setup      ${gray}← paste it when asked${reset}

  ${dim}Want full control?${reset}
  ${dim}  npx clude-bot init       ${gray}← advanced self-hosted setup${reset}

${dim}────────────────────────────────────────────────────${reset}
  ${dim}Docs:    https://clude.io/docs${reset}
  ${dim}Website: https://clude.io${reset}
${dim}────────────────────────────────────────────────────${reset}
`;

// npm 10+ suppresses both stdout and stderr from lifecycle scripts.
// Write directly to /dev/tty to bypass npm's pipe redirection.
const fs = require('fs');
try {
  fs.writeFileSync('/dev/tty', '\n' + banner + '\n');
} catch {
  // /dev/tty unavailable (CI, Windows, non-interactive) — silent fallback
  try { process.stderr.write('\n' + banner + '\n'); } catch {}
}
