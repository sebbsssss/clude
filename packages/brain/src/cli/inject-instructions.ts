import * as path from 'path';
import * as fs from 'fs';
import { printBanner, printSuccess, printWarn, printInfo, printDivider, c } from './banner';
import { injectInstructions } from './setup';

/**
 * npx @clude/sdk inject-instructions
 *
 * Idempotent command that writes/updates the Clude memory usage section
 * in CLAUDE.md or AGENTS.md. Migration path for existing installs.
 *
 * Flags:
 *   --agents   Force writing to AGENTS.md instead of CLAUDE.md
 *   --claude   Force writing to CLAUDE.md (default)
 *   --dir=X    Target directory (default: cwd)
 */
export async function runInjectInstructions(): Promise<void> {
  printBanner();
  console.log(`  ${c.bold}Inject Clude Memory Instructions${c.reset}`);
  console.log(`  ${c.gray}Write usage instructions to CLAUDE.md or AGENTS.md${c.reset}\n`);

  // Parse flags
  const args = process.argv.slice(3);
  const forceAgents = args.includes('--agents');
  const forceClaude = args.includes('--claude');
  const dirFlag = args.find(a => a.startsWith('--dir='));
  const dir = dirFlag ? path.resolve(dirFlag.slice(6)) : process.cwd();

  // Determine target file
  let useAgentsmd = forceAgents;
  if (!forceAgents && !forceClaude) {
    // Auto-detect: use AGENTS.md if it already exists or agents/ dir present
    useAgentsmd = fs.existsSync(path.join(dir, 'AGENTS.md')) ||
      fs.existsSync(path.join(dir, 'agents'));
  }

  const targetFile = useAgentsmd ? 'AGENTS.md' : 'CLAUDE.md';
  printInfo(`Target: ${path.join(dir, targetFile)}`);
  console.log('');

  const result = injectInstructions(dir, { agentsmd: useAgentsmd });

  if (result) {
    if (result.action === 'created') {
      printSuccess(`Created ${targetFile} with Clude memory instructions`);
    } else if (result.action === 'appended') {
      printSuccess(`Appended Clude memory section to existing ${targetFile}`);
    } else {
      printSuccess(`Updated existing Clude memory section in ${targetFile}`);
    }
    printInfo(`  ${c.dim}${result.file}${c.reset}`);
  } else {
    printWarn(`Could not write to ${targetFile}`);
    printInfo('Check directory permissions and try again.');
  }

  printDivider();
  console.log('');
}
