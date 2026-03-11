import * as readline from 'readline';
import { printBanner, printSuccess, printWarn, printInfo, printDivider, c } from './banner';

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

export async function runRegister(): Promise<void> {
  printBanner();
  console.log(`  ${c.bold}Register for hosted Cortex access${c.reset}\n`);
  console.log(`  ${c.gray}This gives you an API key to store memories on CLUDE infrastructure.${c.reset}\n`);

  const rl = createPrompt();

  const name = await ask(rl, 'Agent name (your project name): ');
  if (!name || name.length < 2) {
    printWarn('Name must be at least 2 characters');
    rl.close();
    return;
  }

  const wallet = await ask(rl, 'Your Solana wallet address: ');
  if (!wallet || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
    printWarn('Invalid Solana address');
    rl.close();
    return;
  }

  const url = 'https://clude.io';

  console.log('');
  process.stdout.write(`  ${c.gray}Registering...${c.reset}`);

  try {
    const res = await fetch(`${url}/api/cortex/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, wallet }),
    });

    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);

    const data = await res.json() as { apiKey?: string; agentId?: string; error?: string };

    if (!res.ok) {
      printWarn(`Registration failed: ${data.error || res.statusText}`);
      rl.close();
      return;
    }

    printDivider();
    console.log('');
    printSuccess('Registered successfully!\n');

    console.log(`  ${c.bold}API Key:${c.reset}  ${c.green}${data.apiKey}${c.reset}`);
    console.log(`  ${c.bold}Agent ID:${c.reset} ${data.agentId}`);
    console.log(`  ${c.bold}Wallet:${c.reset}   ${wallet}\n`);

    printWarn('Save this API key — it will not be shown again.\n');

    printInfo('Add to your .env:');
    console.log(`    CORTEX_API_KEY=${data.apiKey}`);
    console.log(`    OWNER_WALLET=${wallet}\n`);

    printInfo('Then in your code:');
    console.log(`    const brain = new Cortex({`);
    console.log(`      hosted: { apiKey: process.env.CORTEX_API_KEY },`);
    console.log(`      ownerWallet: process.env.OWNER_WALLET,`);
    console.log(`    });\n`);

  } catch (err) {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    const msg = (err as Error).message || '';
    const isCert = /certificate|CERT|SSL|self.signed|unable to verify/i.test(msg);
    if (isCert) {
      printWarn('SSL certificate error — your network may be intercepting HTTPS traffic');
      printInfo('This is common with corporate firewalls (Fortinet, Zscaler, etc.)');
      printInfo('Try: switch to a mobile hotspot or VPN, or ask IT to whitelist clude.io');
    } else {
      printWarn(`Could not reach ${url} — is the server running?`);
      printInfo(`Error: ${msg}`);
    }
  }

  printDivider();
  console.log('');
  rl.close();
}
