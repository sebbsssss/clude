#!/usr/bin/env node

const command = process.argv[2];

if (command === 'init') {
  const { runInit } = require('./init');
  runInit().catch((err: Error) => {
    console.error('Init failed:', err.message);
    process.exit(1);
  });
} else if (command === 'register') {
  const { runRegister } = require('./register');
  runRegister().catch((err: Error) => {
    console.error('Registration failed:', err.message);
    process.exit(1);
  });
} else if (command === 'start' || command === 'bot') {
  // Start the full Clude bot (requires env config)
  require('../index');
} else if (command === 'version' || command === '--version' || command === '-v') {
  const pkg = require('../../package.json');
  console.log(pkg.version);
} else {
  // Default: show banner + help (including bare `npx clude-bot`)
  const { printBanner, c } = require('./banner');
  printBanner();
  console.log(`  ${c.bold}Usage:${c.reset}\n`);
  console.log(`    ${c.cyan}npx clude-bot init${c.reset}        Set up hosted or self-hosted mode`);
  console.log(`    ${c.cyan}npx clude-bot register${c.reset}    Get an API key for hosted mode`);
  console.log(`    ${c.cyan}npx clude-bot help${c.reset}        Show this help message`);
  console.log(`    ${c.cyan}npx clude-bot start${c.reset}       Start the Clude bot (requires full config)\n`);
  console.log(`  ${c.bold}As a library:${c.reset}\n`);
  console.log(`    ${c.dim}const { Cortex } = require('clude-bot');${c.reset}`);
  console.log(`    ${c.dim}// Hosted (zero setup):${c.reset}`);
  console.log(`    ${c.dim}const brain = new Cortex({ hosted: { apiKey } });${c.reset}`);
  console.log(`    ${c.dim}// Self-hosted (your Supabase):${c.reset}`);
  console.log(`    ${c.dim}const brain = new Cortex({ supabase: { url, serviceKey } });${c.reset}`);
  console.log(`    ${c.dim}await brain.init();${c.reset}\n`);
  console.log(`  ${c.dim}Docs: https://github.com/sebbsssss/cludebot${c.reset}\n`);
}
