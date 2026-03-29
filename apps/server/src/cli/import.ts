import { readFileSync, existsSync } from 'fs';
import { printSuccess, printError, printInfo, printDivider, c } from './banner';

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

interface ImportedMemory {
  content: string;
  summary: string;
  type: 'episodic' | 'semantic' | 'procedural';
  importance: number;
  tags: string[];
  source: string;
}

function isZipFile(path: string): boolean {
  try {
    const buf = readFileSync(path);
    return buf[0] === 0x50 && buf[1] === 0x4b;
  } catch { return false; }
}

function isJsonFile(path: string): boolean {
  return path.endsWith('.json');
}

function isMarkdownOrText(path: string): boolean {
  return path.endsWith('.md') || path.endsWith('.txt') || path.endsWith('.markdown');
}

// Heuristics: skip trivial messages
function isSubstantive(text: string): boolean {
  if (!text || text.length < 20) return false;
  const lower = text.toLowerCase().trim();
  const trivial = [
    'hello', 'hi', 'hey', 'thanks', 'thank you', 'ok', 'okay', 'sure',
    'yes', 'no', 'bye', 'goodbye', 'good morning', 'good night', 'lol',
    'haha', 'hmm', 'wow', 'nice', 'cool', 'great', 'awesome',
  ];
  if (trivial.includes(lower)) return false;
  if (lower.length < 30 && !lower.includes(' ')) return false;
  return true;
}

function extractFromChatGPTConversations(conversations: any[]): ImportedMemory[] {
  const memories: ImportedMemory[] = [];
  const seen = new Set<string>();

  // Extract user messages that contain knowledge/preferences
  for (const conv of conversations) {
    const title = conv.title || '';
    const mapping = conv.mapping || {};

    const messages: { role: string; content: string; time: number }[] = [];
    for (const node of Object.values(mapping) as any[]) {
      const msg = node?.message;
      if (!msg || !msg.content?.parts) continue;
      const text = msg.content.parts.filter((p: any) => typeof p === 'string').join('\n').trim();
      if (!text) continue;
      messages.push({
        role: msg.author?.role || 'unknown',
        content: text,
        time: msg.create_time || 0,
      });
    }

    // Extract user preferences/corrections (user messages with signals)
    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      if (!isSubstantive(msg.content)) continue;

      const lower = msg.content.toLowerCase();
      const fingerprint = msg.content.slice(0, 100).toLowerCase();
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);

      // Preference signals
      const prefSignals = ['i prefer', 'i like', 'i want', 'always use', 'never use', 'don\'t use',
        'i need', 'my name is', 'i am', 'i work', 'my job', 'i live'];
      const isPref = prefSignals.some(s => lower.includes(s));

      // Correction signals
      const corrSignals = ['actually', 'no,', 'instead', 'correction', 'not that', 'wrong'];
      const isCorrection = corrSignals.some(s => lower.includes(s));

      // Technical knowledge
      const techSignals = ['api', 'endpoint', 'database', 'deploy', 'config', 'server', 'error'];
      const isTech = techSignals.some(s => lower.includes(s));

      if (isPref || isCorrection) {
        memories.push({
          content: msg.content.slice(0, 500),
          summary: msg.content.slice(0, 200),
          type: isCorrection ? 'procedural' : 'semantic',
          importance: isPref ? 0.7 : 0.6,
          tags: ['imported', 'chatgpt'],
          source: 'chatgpt-export',
        });
      } else if (isTech && msg.content.length > 50) {
        memories.push({
          content: msg.content.slice(0, 500),
          summary: msg.content.slice(0, 200),
          type: 'semantic',
          importance: 0.5,
          tags: ['imported', 'chatgpt', 'technical'],
          source: 'chatgpt-export',
        });
      }
    }

    // Store conversation topic as episodic if title is meaningful
    if (title && title.length > 5 && title !== 'New chat' && messages.length > 2) {
      const fp = title.toLowerCase();
      if (!seen.has(fp)) {
        seen.add(fp);
        const time = messages[0]?.time || 0;
        memories.push({
          content: `Conversation: "${title}" (${messages.length} messages)`,
          summary: title,
          type: 'episodic',
          importance: 0.4,
          tags: ['imported', 'chatgpt'],
          source: 'chatgpt-export',
        });
      }
    }
  }

  return memories;
}

async function parseChatGPTZip(filePath: string): Promise<ImportedMemory[]> {
  // Use built-in zlib + manual zip parsing or dynamic import
  const { execSync } = require('child_process');
  const { mkdtempSync, readdirSync } = require('fs');
  const { join } = require('path');
  const os = require('os');

  const tmpDir = mkdtempSync(join(os.tmpdir(), 'clude-import-'));

  try {
    execSync(`unzip -o -q "${filePath}" -d "${tmpDir}"`);
  } catch {
    printError('Failed to unzip file. Make sure "unzip" is installed.');
    process.exit(1);
  }

  // Look for conversations.json
  const files = readdirSync(tmpDir);
  const convFile = files.find((f: string) => f === 'conversations.json')
    ? join(tmpDir, 'conversations.json')
    : null;

  if (!convFile) {
    // Try nested
    const { execSync: exec2 } = require('child_process');
    try {
      const found = exec2(`find "${tmpDir}" -name "conversations.json" -type f`, { encoding: 'utf-8' }).trim();
      if (!found) {
        printError('No conversations.json found in ZIP.');
        process.exit(1);
      }
      const conversations = JSON.parse(readFileSync(found.split('\n')[0], 'utf-8'));
      return extractFromChatGPTConversations(conversations);
    } catch {
      printError('No conversations.json found in ZIP.');
      process.exit(1);
    }
  }

  const conversations = JSON.parse(readFileSync(convFile, 'utf-8'));
  return extractFromChatGPTConversations(conversations);
}

function parseMarkdown(filePath: string): ImportedMemory[] {
  const content = readFileSync(filePath, 'utf-8');
  const memories: ImportedMemory[] = [];

  // Split by headings or double newlines
  const sections = content.split(/\n#{1,3}\s+|\n\n+/).filter(s => s.trim().length > 20);

  for (const section of sections) {
    const text = section.trim();
    if (!isSubstantive(text)) continue;

    // Detect bullet lists — each bullet is a memory
    const bullets = text.split('\n').filter(l => /^\s*[-*•]\s+/.test(l));
    if (bullets.length > 1) {
      for (const bullet of bullets) {
        const clean = bullet.replace(/^\s*[-*•]\s+/, '').trim();
        if (clean.length < 15) continue;
        memories.push({
          content: clean,
          summary: clean.slice(0, 200),
          type: 'semantic',
          importance: 0.5,
          tags: ['imported', 'text'],
          source: filePath,
        });
      }
    } else {
      memories.push({
        content: text.slice(0, 1000),
        summary: text.slice(0, 200),
        type: 'episodic',
        importance: 0.5,
        tags: ['imported', 'text'],
        source: filePath,
      });
    }
  }

  return memories;
}

function parseMemoryPack(filePath: string): ImportedMemory[] {
  const data = JSON.parse(readFileSync(filePath, 'utf-8'));

  // Check if it's a MemoryPack
  if (data.memories && Array.isArray(data.memories)) {
    return data.memories.map((m: any) => ({
      content: m.content || m.summary || '',
      summary: m.summary || m.content?.slice(0, 200) || '',
      type: m.type || m.memory_type || 'episodic',
      importance: m.importance ?? 0.5,
      tags: [...(m.tags || []), 'imported'],
      source: 'memorypack',
    }));
  }

  printError('JSON file does not appear to be a MemoryPack (no "memories" array).');
  process.exit(1);
}

async function storeMemories(memories: ImportedMemory[]): Promise<void> {
  const isLocal = process.argv.includes('--local') || process.env.CLUDE_LOCAL === 'true';
  let config: any = {};
  let isHosted = false;

  if (!isLocal) {
    try { config = require('../config').config; } catch {}
    isHosted = !!config.cortex?.apiKey;
  }

  if (isLocal) {
    const { localStore } = require('../mcp/local-store');
    for (let i = 0; i < memories.length; i++) {
      const m = memories[i];
      localStore({ content: m.content, summary: m.summary, type: m.type, importance: m.importance, tags: m.tags });
      if ((i + 1) % 50 === 0) printInfo(`Stored ${i + 1}/${memories.length}...`);
    }
  } else if (isHosted) {
    const baseUrl = config.cortex.hostUrl || 'https://clude.io';
    // Batch store via API
    const batchSize = 50;
    for (let i = 0; i < memories.length; i += batchSize) {
      const batch = memories.slice(i, i + batchSize);
      const res = await fetch(`${baseUrl}/api/cortex/memory/batch`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.cortex.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ memories: batch }),
      });

      if (!res.ok) {
        // Fallback to individual stores
        for (const m of batch) {
          await fetch(`${baseUrl}/api/cortex/memory`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${config.cortex.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(m),
          });
        }
      }
      printInfo(`Stored ${Math.min(i + batchSize, memories.length)}/${memories.length}...`);
    }
  } else {
    // Self-hosted: use local store
    const { storeMemory } = require('../core/memory');
    for (let i = 0; i < memories.length; i++) {
      const m = memories[i];
      try {
        await storeMemory(m.content, m.type, {
          importance: m.importance,
          tags: m.tags,
          source: m.source,
        });
      } catch (err) {
        // Skip duplicates
      }
      if ((i + 1) % 50 === 0) {
        printInfo(`Stored ${i + 1}/${memories.length}...`);
      }
    }
  }
}

export async function runImport(): Promise<void> {
  const args = process.argv.slice(3);

  if (hasFlag(args, '--help') || hasFlag(args, '-h') || args.length === 0) {
    console.log(`
  ${c.bold}Usage:${c.reset}  npx clude-bot import <file> [options]

  ${c.bold}Supported formats:${c.reset}
    ${c.cyan}chatgpt-export.zip${c.reset}     ChatGPT data export (ZIP with conversations.json)
    ${c.cyan}memories.md${c.reset}             Markdown or text file (paragraphs → memories)
    ${c.cyan}pack.json${c.reset}               Clude MemoryPack JSON

  ${c.bold}Options:${c.reset}
    --dry-run              Show what would be imported without storing
    -h, --help             Show this help

  ${c.bold}Examples:${c.reset}
    ${c.cyan}npx clude-bot import chatgpt-export.zip${c.reset}
    ${c.cyan}npx clude-bot import notes.md${c.reset}
    ${c.cyan}npx clude-bot import backup.json${c.reset}
    ${c.cyan}npx clude-bot import data.zip --dry-run${c.reset}
`);
    return;
  }

  const filePath = args.find(a => !a.startsWith('--'))!;
  const dryRun = hasFlag(args, '--dry-run');

  if (!existsSync(filePath)) {
    printError(`File not found: ${filePath}`);
    process.exit(1);
  }

  // Detect mode
  const isLocal = args.includes('--local') || process.env.CLUDE_LOCAL === 'true';
  let config: any = {};
  let isHosted = false;
  let isSelfHosted = false;

  if (!isLocal) {
    try {
      config = require('../config').config;
    } catch { /* OK for local */ }
    isHosted = !!config.cortex?.apiKey;
    isSelfHosted = !!config.supabase?.url && !!config.supabase?.serviceKey;
  }

  if (!isLocal && !isHosted && !isSelfHosted) {
    printError('No memory store configured.');
    console.log(`\n  Use ${c.cyan}--local${c.reset} for local memories, or run ${c.cyan}npx clude-bot init${c.reset} to configure.\n`);
    process.exit(1);
  }

  printDivider();
  console.log(`\n  ${c.bold}Import${c.reset}\n`);

  let memories: ImportedMemory[];

  if (isZipFile(filePath)) {
    printInfo('Detected: ChatGPT data export (ZIP)');
    memories = await parseChatGPTZip(filePath);
  } else if (isJsonFile(filePath)) {
    printInfo('Detected: MemoryPack JSON');
    memories = parseMemoryPack(filePath);
  } else if (isMarkdownOrText(filePath)) {
    printInfo('Detected: Markdown/text file');
    memories = parseMarkdown(filePath);
  } else {
    // Try as text
    printInfo('Treating as text file');
    memories = parseMarkdown(filePath);
  }

  if (memories.length === 0) {
    printError('No memories extracted from file.');
    process.exit(0);
  }

  // Deduplicate
  const seen = new Set<string>();
  memories = memories.filter(m => {
    const key = m.summary.toLowerCase().slice(0, 100);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const byType: Record<string, number> = {};
  for (const m of memories) byType[m.type] = (byType[m.type] || 0) + 1;

  printSuccess(`Extracted ${memories.length} memories:`);
  for (const [type, count] of Object.entries(byType)) {
    console.log(`    ${c.dim}${type}: ${count}${c.reset}`);
  }

  if (dryRun) {
    console.log(`\n  ${c.dim}(dry run — nothing stored)${c.reset}`);
    console.log(`\n  ${c.bold}Sample memories:${c.reset}\n`);
    for (const m of memories.slice(0, 10)) {
      console.log(`    [${m.type}] ${m.summary.slice(0, 80)}`);
    }
    printDivider();
    return;
  }

  printInfo('Storing memories...');
  await storeMemories(memories);
  printSuccess(`Imported ${memories.length} memories!`);

  printDivider();
  console.log('');
}
