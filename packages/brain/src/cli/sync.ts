import { writeFileSync, watchFile, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { printSuccess, printError, printInfo, printDivider, c } from './banner';

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

async function generatePrompt(format: 'chatgpt' | 'gemini'): Promise<string> {
  // Re-use export logic
  const { config } = require('@clude/shared/config');
  const isHosted = !!config.cortex?.apiKey;

  let memories: any[] = [];

  if (isHosted) {
    const baseUrl = config.cortex.hostUrl || 'https://clude.io';
    const res = await fetch(`${baseUrl}/api/cortex/packs/export`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.cortex.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Sync', limit: 10000 }),
    });
    if (res.ok) {
      const pack = await res.json() as { memories?: any[] };
      memories = pack.memories || [];
    }
  } else {
    const { getRecentMemories } = require('../memory');
    const raw = await getRecentMemories(8760, undefined, 10000);
    memories = (raw || []).map((m: any) => ({
      content: m.content,
      summary: m.summary,
      type: m.memory_type || m.type,
      importance: m.importance,
      created_at: m.created_at,
    }));
  }

  if (memories.length === 0) return '# No memories yet';

  // Inline format generation (simplified)
  const byType: Record<string, any[]> = {};
  for (const m of memories) (byType[m.type || 'episodic'] ??= []).push(m);

  const sortImp = (arr: any[]) => [...arr].sort((a, b) => (b.importance || 0) - (a.importance || 0));

  const lines: string[] = format === 'chatgpt'
    ? ['You have persistent memory from a previous system. Here are your memories:', '']
    : ['# Memory Context', '', 'You are continuing a relationship with a user. Below is everything you know about them.', ''];

  const bullet = format === 'chatgpt' ? '-' : '•';

  const semantic = sortImp(byType['semantic'] || []).slice(0, 40);
  if (semantic.length) {
    lines.push(format === 'chatgpt' ? '## Key Facts' : '## What I Know');
    for (const m of semantic) lines.push(`${bullet} ${m.summary || m.content}`);
    lines.push('');
  }

  const procedural = sortImp(byType['procedural'] || []).slice(0, 30);
  if (procedural.length) {
    lines.push(format === 'chatgpt' ? '## Learned Behaviors' : '## How I Work');
    for (const m of procedural) lines.push(`${bullet} ${m.summary || m.content}`);
    lines.push('');
  }

  const episodic = (byType['episodic'] || [])
    .sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 20);
  if (episodic.length) {
    lines.push(format === 'chatgpt' ? '## Personal Context' : '## Recent History');
    for (const m of episodic) {
      const d = m.created_at ? new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
      lines.push(`${bullet} ${d ? `[${d}] ` : ''}${m.summary || m.content}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export async function runSync(): Promise<void> {
  const args = process.argv.slice(3);

  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    console.log(`
  ${c.bold}Usage:${c.reset}  npx clude-bot sync [options]

  Watches for memory changes and keeps an up-to-date system prompt file.

  ${c.bold}Options:${c.reset}
    --format <chatgpt|gemini>  Prompt format (default: chatgpt)
    --output <path>            Output file (default: ./clude-prompt.txt)
    --interval <seconds>       Refresh interval (default: 300)
    --once                     Generate once and exit
    -h, --help                 Show this help

  ${c.bold}Examples:${c.reset}
    ${c.cyan}npx clude-bot sync${c.reset}                              Watch mode
    ${c.cyan}npx clude-bot sync --once${c.reset}                       Generate once
    ${c.cyan}npx clude-bot sync --format gemini -o prompt.txt${c.reset}
`);
    return;
  }

  const format = (getFlag(args, '--format') || 'chatgpt') as 'chatgpt' | 'gemini';
  const output = getFlag(args, '--output') || getFlag(args, '-o') || 'clude-prompt.txt';
  const interval = parseInt(getFlag(args, '--interval') || '300', 10);
  const once = hasFlag(args, '--once');

  const { config } = require('@clude/shared/config');
  if (!config.cortex?.apiKey && !config.supabase?.url) {
    printError('No memory store configured.');
    process.exit(1);
  }

  printDivider();
  console.log(`\n  ${c.bold}Sync${c.reset}\n`);

  const refresh = async () => {
    try {
      const content = await generatePrompt(format);
      writeFileSync(output, content, 'utf-8');
      printSuccess(`Updated ${output} (${content.split(/\s+/).length} words) — ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      printError(`Refresh failed: ${(err as Error).message}`);
    }
  };

  await refresh();

  if (once) {
    printDivider();
    return;
  }

  printInfo(`Watching every ${interval}s. Press Ctrl+C to stop.`);
  console.log(`  ${c.dim}Symlink ${output} into your project for live memory access.${c.reset}\n`);

  setInterval(refresh, interval * 1000);
}
