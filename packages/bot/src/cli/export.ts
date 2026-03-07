import { writeFileSync } from 'fs';
import { printSuccess, printError, printInfo, printDivider, c } from './banner';

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  return (bytes / 1024).toFixed(1) + ' KB';
}

export async function runExport(): Promise<void> {
  const args = process.argv.slice(3);

  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    console.log(`
  ${c.bold}Usage:${c.reset}  npx clude-bot export [options]

  ${c.bold}Options:${c.reset}
    --format <json|md>     Output format (default: json)
    --output <path>        Output file path
    --types <list>         Comma-separated: episodic,semantic,procedural,self_model
    -h, --help             Show this help

  ${c.bold}Examples:${c.reset}
    ${c.cyan}npx clude-bot export${c.reset}                          Export all as JSON
    ${c.cyan}npx clude-bot export --format md${c.reset}              Export as Markdown
    ${c.cyan}npx clude-bot export --types episodic,semantic${c.reset} Filter by type
    ${c.cyan}npx clude-bot export --output backup.json${c.reset}     Custom filename
`);
    return;
  }

  const format = getFlag(args, '--format') || 'json';
  const output = getFlag(args, '--output') || getFlag(args, '-o');
  const typesRaw = getFlag(args, '--types');
  const types = typesRaw ? typesRaw.split(',').map(t => t.trim()) : undefined;

  if (format !== 'json' && format !== 'md') {
    printError('Format must be "json" or "md"');
    process.exit(1);
  }

  // Lazy-load config to read .env
  const { config } = require('../config');

  const isHosted = !!config.cortex?.apiKey;
  const isSelfHosted = !!config.supabase?.url && !!config.supabase?.serviceKey;

  if (!isHosted && !isSelfHosted) {
    printError('No memory store configured.');
    console.log(`\n  Run ${c.cyan}npx clude-bot init${c.reset} to set up hosted or self-hosted mode.\n`);
    process.exit(1);
  }

  printDivider();
  console.log(`\n  ${c.bold}Export${c.reset}\n`);

  let memories: any[] = [];

  if (isHosted) {
    printInfo('Mode: hosted (Cortex API)');

    const baseUrl = config.cortex.hostUrl || 'https://cluude.ai';
    try {
      const res = await fetch(`${baseUrl}/api/cortex/packs/export`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.cortex.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'CLI Export',
          description: 'Exported via npx clude-bot export',
          limit: 10000,
          types,
        }),
      });

      if (!res.ok) {
        const msg = res.status === 401 ? 'Invalid API key' : `API error (${res.status})`;
        printError(msg);
        process.exit(1);
      }

      const pack = await res.json() as { memories?: any[] };
      memories = pack.memories || [];
    } catch (err) {
      printError(`Connection failed: ${(err as Error).message}`);
      process.exit(1);
    }
  } else {
    printInfo('Mode: self-hosted (Supabase)');

    try {
      const { getRecentMemories } = require('../core/memory');
      const raw = await getRecentMemories(8760, types, 10000);
      memories = (raw || []).map((m: any) => ({
        content: m.content,
        summary: m.summary,
        type: m.memory_type || m.type,
        importance: m.importance,
        tags: m.tags || [],
        concepts: m.concepts || [],
        created_at: m.created_at,
        access_count: m.access_count || 0,
        decay_factor: m.decay_factor ?? 1,
        emotional_valence: m.emotional_valence ?? 0,
        source: m.source || '',
      }));
    } catch (err) {
      printError(`Database query failed: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  if (memories.length === 0) {
    printError('No memories found to export.');
    process.exit(0);
  }

  printSuccess(`Fetched ${memories.length} memories`);

  let content: string;
  let defaultName: string;

  if (format === 'md') {
    defaultName = 'clude-memories.md';
    const byType: Record<string, any[]> = {};
    for (const m of memories) {
      const t = m.type || 'episodic';
      (byType[t] ??= []).push(m);
    }

    const lines = [
      '# Clude Memory Export',
      '',
      `> ${memories.length} memories — exported ${new Date().toISOString()}`,
      '', '---', '',
    ];

    for (const [type, mems] of Object.entries(byType)) {
      const title = type === 'self_model' ? 'Self Model' : type.charAt(0).toUpperCase() + type.slice(1);
      lines.push(`## ${title} (${mems.length})`, '');
      for (const m of mems) {
        lines.push(`- [${(m.importance || 0).toFixed(2)}] ${m.summary || m.content}`);
      }
      lines.push('');
    }
    content = lines.join('\n');
  } else {
    defaultName = 'clude-memories.json';
    const pack = {
      version: 1,
      wallet: config.owner?.wallet || '',
      memories: memories.map((m: any, i: number) => ({
        id: i + 1,
        content: m.content,
        summary: m.summary,
        type: m.type,
        importance: m.importance,
        tags: m.tags || [],
        created_at: m.created_at || new Date().toISOString(),
        access_count: m.access_count || 0,
        decay_factor: m.decay_factor ?? 1,
        emotional_valence: m.emotional_valence ?? 0,
        source: m.source || '',
      })),
      connections: [],
      meta: {
        exported_at: new Date().toISOString(),
        agent_name: 'clude-bot',
        memory_count: memories.length,
      },
    };
    content = JSON.stringify(pack, null, 2);
  }

  const filename = output || defaultName;
  writeFileSync(filename, content, 'utf-8');
  printSuccess(`Written to ${filename} (${formatBytes(Buffer.byteLength(content))})`);

  console.log(`\n  ${c.dim}Drop this file into ${c.reset}${c.cyan}clude.io/explore${c.reset}${c.dim} to visualize.${c.reset}`);
  printDivider();
  console.log('');
}
