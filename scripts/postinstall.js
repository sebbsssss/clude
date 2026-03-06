#!/usr/bin/env node

// Lightweight postinstall banner — no dependencies, no async, just vibes.

const dim = '\x1b[2m';
const reset = '\x1b[0m';
const bold = '\x1b[1m';
const cyan = '\x1b[36m';
const white = '\x1b[97m';

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

  ${cyan}Get started:${reset}  npx clude-bot init
  ${cyan}Docs:${reset}         https://github.com/sebbsssss/cludebot
  ${cyan}Website:${reset}      https://clude.io

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
