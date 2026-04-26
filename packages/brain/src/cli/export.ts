import { writeFileSync } from 'fs';
import { printSuccess, printError, printInfo, printDivider, c } from './banner';
import { writeMemoryPack, MemoryPackRecord } from '../memorypack/index.js';

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

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function groupByType(memories: any[]): Record<string, any[]> {
  const byType: Record<string, any[]> = {};
  for (const m of memories) {
    const t = m.type || m.memory_type || 'episodic';
    (byType[t] ??= []).push(m);
  }
  return byType;
}

function sortByImportance(mems: any[]): any[] {
  return [...mems].sort((a, b) => (b.importance || 0) - (a.importance || 0));
}

function formatChatGPT(memories: any[]): string {
  const byType = groupByType(memories);
  const lines: string[] = [
    'You have persistent memory from a previous system. Here are your memories:',
    '',
  ];

  // Semantic — Key Facts
  const semantic = sortByImportance(byType['semantic'] || []).slice(0, 40);
  if (semantic.length) {
    lines.push('## Key Facts (semantic memories)');
    for (const m of semantic) {
      lines.push(`- ${m.summary || m.content}`);
    }
    lines.push('');
  }

  // Procedural — Learned Behaviors
  const procedural = sortByImportance(byType['procedural'] || []).slice(0, 30);
  if (procedural.length) {
    lines.push('## Learned Behaviors (procedural memories)');
    for (const m of procedural) {
      lines.push(`- ${m.summary || m.content}`);
    }
    lines.push('');
  }

  // Self Model
  const selfModel = sortByImportance(byType['self_model'] || []).slice(0, 10);
  if (selfModel.length) {
    lines.push('## Self Model');
    for (const m of selfModel) {
      lines.push(`- ${m.summary || m.content}`);
    }
    lines.push('');
  }

  // Episodic — Personal Context (most recent)
  const episodic = (byType['episodic'] || [])
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 20);
  if (episodic.length) {
    lines.push('## Personal Context (episodic memories, most recent)');
    for (const m of episodic) {
      const date = m.created_at ? formatDate(m.created_at) : '';
      const prefix = date ? `[${date}] ` : '';
      lines.push(`- ${prefix}${m.summary || m.content}`);
    }
    lines.push('');
  }

  // Trim to ~1500 words
  let result = lines.join('\n');
  const words = result.split(/\s+/);
  if (words.length > 1500) {
    result = words.slice(0, 1500).join(' ') + '\n\n(Truncated to fit character limit)';
  }
  return result;
}

function formatGemini(memories: any[]): string {
  const byType = groupByType(memories);
  const lines: string[] = [
    '# Memory Context',
    '',
    'You are continuing a relationship with a user. Below is everything you know about them from previous interactions.',
    '',
  ];

  const semantic = sortByImportance(byType['semantic'] || []).slice(0, 40);
  if (semantic.length) {
    lines.push('## What I Know');
    for (const m of semantic) {
      lines.push(`• ${m.summary || m.content}`);
    }
    lines.push('');
  }

  const procedural = sortByImportance(byType['procedural'] || []).slice(0, 30);
  if (procedural.length) {
    lines.push('## How I Work');
    for (const m of procedural) {
      lines.push(`• ${m.summary || m.content}`);
    }
    lines.push('');
  }

  const selfModel = sortByImportance(byType['self_model'] || []).slice(0, 10);
  if (selfModel.length) {
    lines.push('## About Myself');
    for (const m of selfModel) {
      lines.push(`• ${m.summary || m.content}`);
    }
    lines.push('');
  }

  const episodic = (byType['episodic'] || [])
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 20);
  if (episodic.length) {
    lines.push('## Recent History');
    for (const m of episodic) {
      const date = m.created_at ? formatDate(m.created_at) : '';
      const prefix = date ? `[${date}] ` : '';
      lines.push(`• ${prefix}${m.summary || m.content}`);
    }
    lines.push('');
  }

  let result = lines.join('\n');
  const words = result.split(/\s+/);
  if (words.length > 1500) {
    result = words.slice(0, 1500).join(' ') + '\n\n(Truncated to fit character limit)';
  }
  return result;
}

function formatMarkdown(memories: any[]): string {
  const byType = groupByType(memories);
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
  return lines.join('\n');
}

export async function runExport(): Promise<void> {
  const args = process.argv.slice(3);

  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    console.log(`
  ${c.bold}Usage:${c.reset}  npx @clude/sdk export [options]

  ${c.bold}Options:${c.reset}
    --format <format>      Output format: json, md, chatgpt, gemini, clipboard
    --output <path>        Output file path
    --types <list>         Comma-separated: episodic,semantic,procedural,self_model
    -h, --help             Show this help

  ${c.bold}Formats:${c.reset}
    ${c.cyan}json${c.reset}        Legacy single-file JSON (default)
    ${c.cyan}memorypack${c.reset}  MemoryPack v0.1 spec directory (manifest + records.jsonl + sigs)
    ${c.cyan}md${c.reset}          Clean Markdown
    ${c.cyan}chatgpt${c.reset}     System prompt for ChatGPT Custom Instructions
    ${c.cyan}gemini${c.reset}      System prompt for Gemini Gems
    ${c.cyan}clipboard${c.reset}   ChatGPT format, copied to clipboard

  ${c.bold}Examples:${c.reset}
    ${c.cyan}npx @clude/sdk export${c.reset}                          Export all as JSON
    ${c.cyan}npx @clude/sdk export --format chatgpt${c.reset}         For ChatGPT
    ${c.cyan}npx @clude/sdk export --format gemini${c.reset}          For Gemini Gems
    ${c.cyan}npx @clude/sdk export --format clipboard${c.reset}       Copy to clipboard
    ${c.cyan}npx @clude/sdk export --format md${c.reset}              Export as Markdown
    ${c.cyan}npx @clude/sdk export --types episodic,semantic${c.reset} Filter by type
`);
    return;
  }

  const format = getFlag(args, '--format') || 'json';
  const output = getFlag(args, '--output') || getFlag(args, '-o');
  const typesRaw = getFlag(args, '--types');
  const types = typesRaw ? typesRaw.split(',').map(t => t.trim()) : undefined;

  const validFormats = ['json', 'md', 'chatgpt', 'gemini', 'clipboard', 'memorypack'];
  if (!validFormats.includes(format)) {
    printError(`Format must be one of: ${validFormats.join(', ')}`);
    process.exit(1);
  }

  // Detect mode: local > hosted > self-hosted
  const isLocal = args.includes('--local') || process.env.CLUDE_LOCAL === 'true';
  let isHosted = false;
  let isSelfHosted = false;
  let config: any = {};

  if (!isLocal) {
    try {
      config = require('@clude/shared/config').config;
    } catch {
      // Config may fail if env vars missing — that's OK for local mode
    }
    isHosted = !!config.cortex?.apiKey;
    isSelfHosted = !!config.supabase?.url && !!config.supabase?.serviceKey;
  }

  if (!isLocal && !isHosted && !isSelfHosted) {
    printError('No memory store configured.');
    console.log(`\n  Use ${c.cyan}--local${c.reset} for local memories, or run ${c.cyan}npx @clude/sdk init${c.reset} to configure.\n`);
    process.exit(1);
  }

  printDivider();
  console.log(`\n  ${c.bold}Export${c.reset} (${format})\n`);

  let memories: any[] = [];

  if (isLocal) {
    printInfo('Mode: local (~/.clude/memories.json)');
    try {
      const { localRecall, localStats } = require('../mcp/local-store');
      const stats = localStats();
      if (stats.total_memories === 0) {
        printError('No local memories found.');
        process.exit(1);
      }
      // Get all memories by recalling with a broad query
      const allMems = localRecall({ query: '', limit: 10000 });
      memories = allMems.map((m: any) => ({
        id: m.id,
        content: m.content,
        summary: m.summary,
        memory_type: m.type || m.memory_type || 'episodic',
        importance: m.importance || 0.5,
        tags: m.tags || [],
        created_at: m.created_at || new Date().toISOString(),
      }));
      printInfo(`Found ${memories.length} local memories`);
    } catch (err: any) {
      printError(`Local export failed: ${err.message}`);
      process.exit(1);
    }
  } else if (isHosted) {
    printInfo('Mode: hosted (Cortex API)');

    const baseUrl = config.cortex.hostUrl || 'https://clude.io';
    try {
      const res = await fetch(`${baseUrl}/api/cortex/packs/export`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.cortex.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'CLI Export',
          description: 'Exported via npx @clude/sdk export',
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
      const { getRecentMemories } = require('../memory');
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

  if (format === 'chatgpt') {
    content = formatChatGPT(memories);
    defaultName = 'clude-chatgpt-prompt.txt';
  } else if (format === 'gemini') {
    content = formatGemini(memories);
    defaultName = 'clude-gemini-prompt.txt';
  } else if (format === 'clipboard') {
    content = formatChatGPT(memories);
    defaultName = '';
    // Copy to clipboard
    try {
      const { execSync } = require('child_process');
      const platform = process.platform;
      if (platform === 'darwin') {
        execSync('pbcopy', { input: content });
      } else if (platform === 'linux') {
        try {
          execSync('xclip -selection clipboard', { input: content });
        } catch {
          execSync('xsel --clipboard --input', { input: content });
        }
      } else if (platform === 'win32') {
        execSync('clip', { input: content });
      }
      printSuccess(`Copied to clipboard! (${content.split(/\s+/).length} words)`);
      console.log(`\n  ${c.dim}Paste into ChatGPT Custom Instructions or System Prompt.${c.reset}`);
      printDivider();
      console.log('');
      return;
    } catch {
      printInfo('Could not copy to clipboard — writing to file instead');
      defaultName = 'clude-chatgpt-prompt.txt';
    }
  } else if (format === 'md') {
    content = formatMarkdown(memories);
    defaultName = 'clude-memories.md';
  } else if (format === 'memorypack') {
    // Spec-compliant MemoryPack v0.1 directory output.
    // Writes manifest.json + records.jsonl (+ signatures.jsonl if a
    // wallet keypair is available). Signatures are best-effort: if
    // no signing key is configured, the pack is emitted unsigned
    // (spec allows this).
    const outputDir = output || 'clude-memorypack';

    const records: MemoryPackRecord[] = memories.map((m: any, i: number) => {
      const id = m.id ? String(m.id) : String(i + 1);
      const kind = m.type || m.memory_type || 'episodic';
      const rec: MemoryPackRecord = {
        id,
        created_at: m.created_at || new Date().toISOString(),
        kind,
        content: m.content || '',
        tags: m.tags || [],
        importance: typeof m.importance === 'number' ? m.importance : 0.5,
        source: m.source || '',
      };
      if (m.summary) rec.summary = m.summary;
      if (m.access_count != null) rec.access_count = m.access_count;
      if (m.last_accessed_at) rec.last_accessed_at = m.last_accessed_at;
      return rec;
    });

    // Pull the wallet keypair if available. Local mode with a
    // configured wallet, or hosted mode that injected it via
    // _configureSolana, will sign records. Otherwise emit unsigned.
    let secretKey: Uint8Array | undefined;
    let publicKey: string | undefined;
    try {
      const { getBotWallet } = require('@clude/shared/core/solana-client');
      const wallet = getBotWallet();
      if (wallet) {
        secretKey = wallet.secretKey;
        publicKey = wallet.publicKey.toBase58();
      }
    } catch {
      /* no wallet configured — emit unsigned pack */
    }

    writeMemoryPack(outputDir, records, {
      producer: {
        name: 'clude',
        version: '3.0.3',
        agent_id: config?.agent?.id,
        public_key: publicKey,
      },
      record_schema: 'clude-memory-v3',
      secretKey,
      anchor_chain: 'solana-mainnet',
    });

    printSuccess(
      `MemoryPack written to ${outputDir}/ (${records.length} records${secretKey ? ', signed' : ', UNSIGNED'})`,
    );
    if (!secretKey) {
      console.log(
        `\n  ${c.dim}No wallet configured — pack is unsigned. Set CLUDE_WALLET_SECRET to sign.${c.reset}`,
      );
    }
    console.log(
      `\n  ${c.dim}Contents: manifest.json, records.jsonl${secretKey ? ', signatures.jsonl' : ''}${c.reset}`,
    );
    printDivider();
    console.log('');
    return;
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
        agent_name: 'clude',
        memory_count: memories.length,
      },
    };
    content = JSON.stringify(pack, null, 2);
  }

  const filename = output || defaultName;
  writeFileSync(filename, content, 'utf-8');
  printSuccess(`Written to ${filename} (${formatBytes(Buffer.byteLength(content))})`);

  if (format === 'chatgpt') {
    console.log(`\n  ${c.dim}Paste into ChatGPT → Settings → Custom Instructions${c.reset}`);
  } else if (format === 'gemini') {
    console.log(`\n  ${c.dim}Paste into Gemini → Create a Gem → Instructions${c.reset}`);
  } else {
    console.log(`\n  ${c.dim}Drop this file into ${c.reset}${c.cyan}clude.io/explore${c.reset}${c.dim} to visualize.${c.reset}`);
  }
  printDivider();
  console.log('');
}
