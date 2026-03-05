const dim = '\x1b[2m';
const reset = '\x1b[0m';
const bold = '\x1b[1m';
const cyan = '\x1b[36m';
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const red = '\x1b[31m';
const white = '\x1b[97m';
const gray = '\x1b[90m';

export const c = { dim, reset, bold, cyan, green, yellow, red, white, gray };

export function printBanner(): void {
  console.log(`
${dim}────────────────────────────────────────────────────${reset}

${white}        ▄▄▄   ▄     ▄   ▄ ▄▄▄   ▄▄▄${reset}
${white}       █     █     █   █ █   █ █${reset}
${white}       █     █     █   █ █   █ █▀▀${reset}
${white}       █▄▄▄  █▄▄▄  ▀▄▄▀ █▄▄▀  █▄▄▄${reset}

${dim}  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░${reset}
${dim}  ░░░░░  ${reset}${bold}persistent memory for AI agents${reset}${dim}  ░░░░░${reset}
${dim}  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░${reset}

${dim}────────────────────────────────────────────────────${reset}
`);
}

export function printStep(step: number, total: number, title: string): void {
  console.log(`\n  ${cyan}─── Step ${step}/${total}: ${title} ${'─'.repeat(Math.max(0, 36 - title.length))}${reset}\n`);
}

export function printSuccess(msg: string): void {
  console.log(`  ${green}✓${reset} ${msg}`);
}

export function printWarn(msg: string): void {
  console.log(`  ${yellow}⚠${reset} ${msg}`);
}

export function printError(msg: string): void {
  console.log(`  ${red}✗${reset} ${msg}`);
}

export function printInfo(msg: string): void {
  console.log(`  ${gray}${msg}${reset}`);
}

export function printDivider(): void {
  console.log(`\n${dim}────────────────────────────────────────────────────${reset}`);
}

export function printCodeBlock(code: string): void {
  const lines = code.split('\n');
  console.log(`\n  ${dim}┌${'─'.repeat(50)}${reset}`);
  for (const line of lines) {
    console.log(`  ${dim}│${reset} ${line}`);
  }
  console.log(`  ${dim}└${'─'.repeat(50)}${reset}\n`);
}
