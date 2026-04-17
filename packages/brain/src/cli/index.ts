#!/usr/bin/env node

const command = process.argv[2];

if (command === 'setup') {
  const { runSetup } = require('./setup');
  runSetup().catch((err: Error) => {
    console.error('Setup failed:', err.message);
    process.exit(1);
  });
} else if (command === 'init') {
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
} else if (command === 'mcp-install') {
  const { runMcpInstall } = require('./setup');
  runMcpInstall().catch((err: Error) => {
    console.error('MCP install failed:', err.message);
    process.exit(1);
  });
} else if (command === 'ship') {
  const message = process.argv.slice(3).join(' ');
  const { runShip } = require('./ship');
  runShip(message).catch((err: Error) => {
    console.error('Ship failed:', err.message);
    process.exit(1);
  });
} else if (command === 'status') {
  const { runStatus } = require('./status');
  runStatus().catch((err: Error) => {
    console.error('Status check failed:', err.message);
    process.exit(1);
  });
} else if (command === 'export') {
  const { runExport } = require('./export');
  runExport().catch((err: Error) => {
    console.error('Export failed:', err.message);
    process.exit(1);
  });
} else if (command === 'import') {
  const { runImport } = require('./import');
  runImport().catch((err: Error) => {
    console.error('Import failed:', err.message);
    process.exit(1);
  });
} else if (command === 'sync') {
  const { runSync } = require('./sync');
  runSync().catch((err: Error) => {
    console.error('Sync failed:', err.message);
    process.exit(1);
  });
} else if (command === 'inject-instructions') {
  const { runInjectInstructions } = require('./inject-instructions');
  runInjectInstructions().catch((err: Error) => {
    console.error('Inject instructions failed:', err.message);
    process.exit(1);
  });
} else if (command === 'extract') {
  const { runExtract } = require('./extract');
  runExtract().catch((err: Error) => {
    console.error('Extract failed:', err.message);
    process.exit(1);
  });
} else if (command === 'doctor') {
  const { runDoctor } = require('./doctor');
  runDoctor().catch((err: Error) => {
    console.error('Doctor failed:', err.message);
    process.exit(1);
  });
} else if (command === 'dream') {
  const { runDream } = require('./dream');
  runDream().catch((err: Error) => {
    console.error('Dream failed:', err.message);
    process.exit(1);
  });
} else if (command === 'mcp-serve') {
  // Start the MCP server (used by IDE integrations)
  require('../mcp/server');
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
  console.log(`  ${c.bold}Quick start:${c.reset}\n`);
  console.log(`    ${c.cyan}npx clude-bot setup${c.reset}         ${c.dim}← start here${c.reset}`);
  console.log(`    ${c.dim}Register + create .env + install MCP in ~30 seconds${c.reset}\n`);
  console.log(`  ${c.bold}Commands:${c.reset}\n`);
  console.log(`    ${c.cyan}npx clude-bot setup${c.reset}         Guided setup (register + config + MCP)`);
  console.log(`    ${c.cyan}npx clude-bot status${c.reset}        Check if Clude is active + memory stats`);
  console.log(`    ${c.cyan}npx clude-bot init${c.reset}          Advanced setup (self-hosted options)`);
  console.log(`    ${c.cyan}npx clude-bot register${c.reset}      Get an API key only`);
  console.log(`    ${c.cyan}npx clude-bot mcp-install${c.reset}   Install MCP server for your IDE`);
  console.log(`    ${c.cyan}npx clude-bot inject-instructions${c.reset}  Write usage instructions to CLAUDE.md`);
  console.log(`    ${c.cyan}npx clude-bot extract${c.reset}       Extract domain knowledge into skills.md`);
  console.log(`    ${c.cyan}npx clude-bot export${c.reset}        Export memories (json/md/chatgpt/gemini)`);
  console.log(`    ${c.cyan}npx clude-bot import${c.reset}        Import from ChatGPT export, markdown, JSON`);
  console.log(`    ${c.cyan}npx clude-bot sync${c.reset}          Auto-update system prompt file`);
  console.log(`    ${c.cyan}npx clude-bot ship "msg"${c.reset}    Broadcast to Telegram channel`);
  console.log(`    ${c.cyan}npx clude-bot doctor${c.reset}        Run diagnostics`);
  console.log(`    ${c.cyan}npx clude-bot dream${c.reset}         Trigger dream cycle manually`);
  console.log(`    ${c.cyan}npx clude-bot start${c.reset}         Start the Clude bot\n`);
  console.log(`  ${c.bold}As a library:${c.reset}\n`);
  console.log(`    ${c.dim}const { Cortex } = require('clude-bot');${c.reset}`);
  console.log(`    ${c.dim}const brain = new Cortex({ hosted: { apiKey } });${c.reset}`);
  console.log(`    ${c.dim}await brain.init();${c.reset}\n`);
  console.log(`  ${c.dim}Docs: https://clude.io/docs${c.reset}\n`);
}
