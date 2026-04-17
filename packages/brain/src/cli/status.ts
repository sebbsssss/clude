import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { printBanner, printSuccess, printWarn, printInfo, printDivider, c } from './banner';

const CLUDE_DIR = join(process.env.HOME || process.env.USERPROFILE || '.', '.clude');
const MEMORIES_FILE = join(CLUDE_DIR, 'memories.json');

interface LocalMemory {
  id: number;
  memory_type: string;
  summary: string;
  content: string;
  tags: string[];
  importance: number;
  decay_factor: number;
  access_count: number;
  source: string;
  created_at: string;
  last_accessed: string;
}

interface Store {
  version: number;
  next_id: number;
  memories: LocalMemory[];
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function detectMode(): { mode: string; details: string } {
  // Check for local store
  const hasLocal = existsSync(MEMORIES_FILE);

  // Check for .env in current directory
  const envPath = join(process.cwd(), '.env');
  let hasApiKey = false;
  let hasSupabase = false;
  let hostUrl = '';

  if (existsSync(envPath)) {
    try {
      const env = readFileSync(envPath, 'utf-8');
      hasApiKey = /^CORTEX_API_KEY=.+/m.test(env);
      hasSupabase = /^SUPABASE_URL=.+/m.test(env);
      const match = env.match(/^CORTEX_HOST_URL=(.+)/m);
      if (match) hostUrl = match[1].trim();
    } catch {}
  }

  // Also check process env
  if (process.env.CORTEX_API_KEY) hasApiKey = true;
  if (process.env.SUPABASE_URL) hasSupabase = true;

  if (hasLocal && !hasApiKey && !hasSupabase) {
    return { mode: 'local', details: MEMORIES_FILE };
  }
  if (hasApiKey) {
    return { mode: 'hosted', details: hostUrl || 'https://clude.io' };
  }
  if (hasSupabase) {
    return { mode: 'self-hosted', details: 'Supabase' };
  }
  if (hasLocal) {
    return { mode: 'local', details: MEMORIES_FILE };
  }
  return { mode: 'not configured', details: 'Run: npx @clude/sdk setup' };
}

function printLocalStatus(): void {
  if (!existsSync(MEMORIES_FILE)) {
    printWarn('No memories file found.');
    printInfo(`Expected: ${MEMORIES_FILE}`);
    printInfo('Store your first memory by chatting with Claude.\n');
    return;
  }

  let store: Store;
  try {
    store = JSON.parse(readFileSync(MEMORIES_FILE, 'utf-8'));
  } catch (err: any) {
    printWarn(`Could not read memories file: ${err.message}`);
    return;
  }

  const memories = store.memories || [];
  const fileStats = statSync(MEMORIES_FILE);
  const fileSizeKb = (fileStats.size / 1024).toFixed(1);

  if (memories.length === 0) {
    printInfo('No memories stored yet.');
    printInfo('Start a conversation with Claude — memories are created automatically.\n');
    return;
  }

  // Count by type
  const byType: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  const sourceCounts: Record<string, number> = {};
  let totalImportance = 0;
  let totalAccess = 0;

  for (const m of memories) {
    byType[m.memory_type] = (byType[m.memory_type] || 0) + 1;
    totalImportance += m.importance;
    totalAccess += m.access_count;
    for (const t of m.tags || []) {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
    if (m.source) {
      sourceCounts[m.source] = (sourceCounts[m.source] || 0) + 1;
    }
  }

  // Sort by created_at
  const sorted = [...memories].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const newest = sorted[0];
  const oldest = sorted[sorted.length - 1];

  // Most accessed
  const mostAccessed = [...memories].sort((a, b) => b.access_count - a.access_count)[0];

  // Top tags
  const topTags = Object.entries(tagCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  // Type labels for display
  const typeLabels: Record<string, string> = {
    episodic: 'episodic (events)',
    semantic: 'semantic (knowledge)',
    procedural: 'procedural (how-to)',
    self_model: 'self_model (identity)',
    introspective: 'introspective (journal)',
  };

  // Print summary
  console.log(`  ${c.bold}Memories:${c.reset}  ${c.green}${memories.length}${c.reset}  ${c.dim}(${fileSizeKb} KB)${c.reset}\n`);

  // By type
  console.log(`  ${c.bold}By type:${c.reset}`);
  const typeOrder = ['episodic', 'semantic', 'procedural', 'self_model', 'introspective'];
  for (const t of typeOrder) {
    const count = byType[t] || 0;
    if (count > 0) {
      const label = typeLabels[t] || t;
      const bar = '█'.repeat(Math.min(20, Math.ceil(count / memories.length * 20)));
      console.log(`    ${c.dim}${label.padEnd(28)}${c.reset} ${String(count).padStart(4)}  ${c.cyan}${bar}${c.reset}`);
    }
  }
  console.log('');

  // Timeline
  console.log(`  ${c.bold}Timeline:${c.reset}`);
  console.log(`    ${c.dim}First memory:${c.reset}  ${timeAgo(oldest.created_at)}  ${c.dim}(${oldest.created_at.slice(0, 10)})${c.reset}`);
  console.log(`    ${c.dim}Latest:${c.reset}        ${timeAgo(newest.created_at)}  ${c.dim}(${newest.created_at.slice(0, 10)})${c.reset}`);
  console.log('');

  // Latest memory
  console.log(`  ${c.bold}Latest:${c.reset}    "${newest.summary?.slice(0, 60) || newest.content?.slice(0, 60)}"`);
  if (mostAccessed && mostAccessed.access_count > 0) {
    console.log(`  ${c.bold}Most used:${c.reset} "${mostAccessed.summary?.slice(0, 60) || mostAccessed.content?.slice(0, 60)}" ${c.dim}(${mostAccessed.access_count}x)${c.reset}`);
  }
  console.log('');

  // Tags
  if (topTags.length > 0) {
    console.log(`  ${c.bold}Top tags:${c.reset}  ${topTags.map(([t, n]) => `${t} (${n})`).join(', ')}`);
    console.log('');
  }

  // Stats
  console.log(`  ${c.bold}Stats:${c.reset}`);
  console.log(`    ${c.dim}Avg importance:${c.reset} ${(totalImportance / memories.length).toFixed(2)}`);
  console.log(`    ${c.dim}Total recalls:${c.reset}  ${totalAccess}`);
  console.log(`    ${c.dim}Sources:${c.reset}        ${Object.keys(sourceCounts).join(', ') || 'none'}`);
  console.log('');
}

function printHostedStatus(): void {
  printInfo('Hosted mode — memories stored on clude.io');
  printInfo('Check your memories at: https://clude.io/explore\n');

  // Try a quick API check
  const apiKey = process.env.CORTEX_API_KEY;
  if (!apiKey) {
    // Check .env file
    const envPath = join(process.cwd(), '.env');
    if (existsSync(envPath)) {
      try {
        const env = readFileSync(envPath, 'utf-8');
        const match = env.match(/^CORTEX_API_KEY=(.+)/m);
        if (match) {
          printSuccess(`API key configured: ${match[1].trim().slice(0, 12)}...`);
        }
      } catch {}
    }
  } else {
    printSuccess(`API key configured: ${apiKey.slice(0, 12)}...`);
  }
  printInfo('Use "get_memory_stats" tool in Claude to see your memory count.\n');
}

function checkMcpInstalled(): void {
  const configs = [
    { name: 'Claude Desktop', path: join(process.env.HOME || '', 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json') },
    { name: 'Cursor', path: join(process.env.HOME || '', '.cursor', 'mcp.json') },
    { name: 'Claude Code', path: join(process.cwd(), '.mcp.json') },
  ];

  let found = false;
  for (const cfg of configs) {
    if (existsSync(cfg.path)) {
      try {
        const content = readFileSync(cfg.path, 'utf-8');
        if (content.includes('clude')) {
          printSuccess(`MCP installed: ${cfg.name}`);
          found = true;
        }
      } catch {}
    }
  }

  if (!found) {
    printWarn('MCP not detected in any IDE config');
    printInfo('Run: npx @clude/sdk mcp-install');
  }
  console.log('');
}

export async function runStatus(): Promise<void> {
  printBanner();

  const { mode, details } = detectMode();

  console.log(`  ${c.bold}Mode:${c.reset}      ${mode === 'not configured' ? c.yellow : c.green}${mode}${c.reset}`);
  console.log(`  ${c.bold}Storage:${c.reset}   ${c.dim}${details}${c.reset}\n`);

  printDivider();
  console.log('');

  checkMcpInstalled();

  if (mode === 'local') {
    printLocalStatus();
  } else if (mode === 'hosted') {
    printHostedStatus();
  } else if (mode === 'self-hosted') {
    printInfo('Self-hosted mode — connect to your Supabase dashboard to inspect memories.\n');
  } else {
    printWarn('Clude is not configured yet.\n');
    printInfo('Get started:');
    console.log(`    ${c.cyan}npx @clude/sdk setup${c.reset}              ${c.dim}Guided setup (recommended)${c.reset}`);
    console.log(`    ${c.cyan}npx @clude/sdk mcp-install --local${c.reset} ${c.dim}Quick local install${c.reset}\n`);
  }

  // Memory types reference
  console.log(`  ${c.dim}Memory types:${c.reset}`);
  console.log(`    ${c.dim}episodic${c.reset}       Events, conversations, interactions`);
  console.log(`    ${c.dim}semantic${c.reset}       Facts, knowledge, learned information`);
  console.log(`    ${c.dim}procedural${c.reset}     Preferences, workflows, how-to patterns`);
  console.log(`    ${c.dim}self_model${c.reset}     Identity, personality, values`);
  console.log(`    ${c.dim}introspective${c.reset}  Reflections, journal entries, insights`);
  console.log('');

  printDivider();
  console.log('');
}
