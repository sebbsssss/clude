/**
 * @clude/cortex — End-to-End Test
 *
 * Tests: identity, pack creation, signing, verification,
 * merge, markdown export, JSON round-trip, OpenAI adapter.
 */

import {
  generateMemoryUUID, generateAgentId,
  createPack, mergePacks, computeContentHash,
  signPackHMAC, verifyPackIntegrity, verifyPackHMAC,
  packToMarkdown, packToJSON, packFromJSON,
  type PortableMemory, type PortableConnection,
} from '../src/index.js';
import { cludeTools, handleCludeTool } from '../src/adapters/openai.js';
import { CludeMemory } from '../src/adapters/langchain.js';

let pass = 0, fail = 0;

function assert(cond: boolean, name: string) {
  if (cond) { console.log(`  ✅ ${name}`); pass++; }
  else { console.log(`  ❌ ${name}`); fail++; }
}

async function main() {
  console.log('\n🔗 @clude/cortex — End-to-End Test\n');

  // ── 1. Identity ──────────────────────────────────────────
  console.log('1. Identity');

  const uuid1 = generateMemoryUUID('wallet-A', 'hello world', '2026-01-01');
  const uuid2 = generateMemoryUUID('wallet-A', 'hello world', '2026-01-01');
  const uuid3 = generateMemoryUUID('wallet-B', 'hello world', '2026-01-01');
  assert(uuid1 === uuid2, 'Deterministic UUID (same input = same output)');
  assert(uuid1 !== uuid3, 'Different wallet = different UUID');

  const agentId = generateAgentId();
  assert(agentId.startsWith('agent-'), `Agent ID format: ${agentId}`);

  // ── 2. Pack Creation ─────────────────────────────────────
  console.log('\n2. Pack Creation');

  const memories: PortableMemory[] = [
    { uuid: generateMemoryUUID('wallet-A', 'User likes TypeScript', '2026-01-01'), content: 'User likes TypeScript', summary: 'TypeScript preference', type: 'semantic', importance: 0.8, tags: ['preference'], created_at: '2026-01-01', access_count: 3, decay_factor: 0.95, source_wallet: 'wallet-A' },
    { uuid: generateMemoryUUID('wallet-A', 'Deploy with Railway', '2026-01-02'), content: 'Deploy with Railway', summary: 'Railway deployment', type: 'procedural', importance: 0.7, tags: ['deploy'], created_at: '2026-01-02', access_count: 1, decay_factor: 0.98, source_wallet: 'wallet-A' },
    { uuid: generateMemoryUUID('wallet-A', 'Had great conversation about AI', '2026-01-03'), content: 'Had great conversation about AI', summary: 'AI conversation', type: 'episodic', importance: 0.5, tags: ['ai'], created_at: '2026-01-03', access_count: 0, decay_factor: 1.0, source_wallet: 'wallet-A' },
  ];

  const connections: PortableConnection[] = [
    { from_uuid: memories[0].uuid, to_uuid: memories[1].uuid, type: 'supports', strength: 0.7, created_at: '2026-01-02' },
  ];

  const pack = createPack({
    wallet: 'wallet-A',
    name: 'Agent A',
    memories,
    connections,
    secret: 'test-secret',
  });

  assert(pack.version === 1, 'Pack version 1');
  assert(pack.format === 'clude-pack', 'Pack format');
  assert(pack.memories.length === 3, `${pack.memories.length} memories`);
  assert(pack.connections.length === 1, `${pack.connections.length} connections`);
  assert(pack.meta.signature !== undefined, 'Pack is signed');
  assert(pack.meta.signature_type === 'hmac-sha256', 'HMAC signature type');

  // ── 3. Integrity & Signing ───────────────────────────────
  console.log('\n3. Integrity & Signing');

  assert(verifyPackIntegrity(pack), 'Integrity check passes');
  assert(verifyPackHMAC(pack, 'test-secret'), 'HMAC verification passes');
  assert(!verifyPackHMAC(pack, 'wrong-secret'), 'Wrong secret rejected');

  // Tamper with content
  const tampered = JSON.parse(JSON.stringify(pack));
  tampered.memories[0].content = 'TAMPERED';
  assert(!verifyPackIntegrity(tampered), 'Tampered pack detected');

  // ── 4. JSON Round-Trip ───────────────────────────────────
  console.log('\n4. JSON Round-Trip');

  const json = packToJSON(pack);
  const parsed = packFromJSON(json);
  assert(parsed.memories.length === 3, 'JSON round-trip preserves memories');
  assert(parsed.meta.content_hash === pack.meta.content_hash, 'Hash preserved');
  assert(verifyPackIntegrity(parsed), 'Round-tripped pack still valid');

  // ── 5. Markdown Export ───────────────────────────────────
  console.log('\n5. Markdown Export');

  const md = packToMarkdown(pack);
  assert(md.includes('Memory Pack: Agent A'), 'Markdown has title');
  assert(md.includes('wallet-A'), 'Markdown has wallet');
  assert(md.includes('semantic'), 'Markdown has types');
  assert(md.includes('supports'), 'Markdown has connections');

  // ── 6. Pack Merge ────────────────────────────────────────
  console.log('\n6. Pack Merge');

  const packB = createPack({
    wallet: 'wallet-B',
    name: 'Agent B',
    memories: [
      memories[0],  // duplicate UUID — should be deduped
      { uuid: generateMemoryUUID('wallet-B', 'Venice is private', '2026-01-04'), content: 'Venice is private', summary: 'Venice privacy', type: 'semantic', importance: 0.9, tags: ['privacy'], created_at: '2026-01-04', access_count: 0, decay_factor: 1.0, source_wallet: 'wallet-B' },
    ],
  });

  const merged = mergePacks(pack, packB);
  assert(merged.memories.length === 4, `Merged: ${merged.memories.length} memories (3 + 2 - 1 dedup = 4)`);
  assert(merged.connections.length === 1, 'Connections preserved in merge');
  assert(verifyPackIntegrity(merged), 'Merged pack integrity valid');

  // ── 7. OpenAI Adapter ────────────────────────────────────
  console.log('\n7. OpenAI Adapter');

  assert(cludeTools.length === 3, `${cludeTools.length} tools defined`);
  assert(cludeTools[0].function.name === 'clude_remember', 'remember tool');
  assert(cludeTools[1].function.name === 'clude_recall', 'recall tool');
  assert(cludeTools[2].function.name === 'clude_forget', 'forget tool');

  // Mock engine
  const storedMemories: any[] = [];
  const mockEngine = {
    store: async (opts: any) => {
      const mem = { id: 'clude-test123', memory_type: opts.type || 'episodic', ...opts };
      storedMemories.push(mem);
      return mem;
    },
    recall: async (opts: any) => storedMemories.filter(m =>
      m.content?.toLowerCase().includes(opts.query?.toLowerCase().split(' ')[0] || '')
    ).slice(0, opts.limit || 5).map(m => ({ ...m, _score: 0.9 })),
    forget: async (id: string) => {
      const idx = storedMemories.findIndex(m => m.id === id);
      if (idx >= 0) { storedMemories.splice(idx, 1); return true; }
      return false;
    },
  };

  // Test remember
  const rememberResult = await handleCludeTool(
    { function: { name: 'clude_remember', arguments: JSON.stringify({ content: 'User likes dark mode', type: 'semantic' }) } },
    mockEngine,
  );
  const rememberParsed = JSON.parse(rememberResult);
  assert(rememberParsed.stored === true, 'OpenAI remember works');

  // Test recall
  const recallResult = await handleCludeTool(
    { function: { name: 'clude_recall', arguments: JSON.stringify({ query: 'user preferences' }) } },
    mockEngine,
  );
  const recallParsed = JSON.parse(recallResult);
  assert(Array.isArray(recallParsed), 'OpenAI recall returns array');
  assert(recallParsed.length > 0, `OpenAI recall found ${recallParsed.length} memories`);

  // Test forget
  const forgetResult = await handleCludeTool(
    { function: { name: 'clude_forget', arguments: JSON.stringify({ id: 'clude-test123' }) } },
    mockEngine,
  );
  const forgetParsed = JSON.parse(forgetResult);
  assert(forgetParsed.deleted === true, 'OpenAI forget works');

  // ── 8. LangChain Adapter ─────────────────────────────────
  console.log('\n8. LangChain Adapter');

  // Re-add a memory for recall test
  await mockEngine.store({ content: 'TypeScript is great for type safety', type: 'semantic' });

  const lcMemory = new CludeMemory(mockEngine);
  assert(lcMemory.memoryKeys[0] === 'history', 'Default memory key');

  const loaded = await lcMemory.loadMemoryVariables({ input: 'TypeScript' });
  assert(typeof loaded.history === 'string', 'loadMemoryVariables returns string');
  assert(loaded.history.includes('TypeScript') || loaded.history === 'No relevant memories found.', `LangChain load: ${loaded.history.slice(0, 60)}`);

  await lcMemory.saveContext({ input: 'What is TypeScript?' }, { output: 'A typed superset of JavaScript' });
  assert(storedMemories.length > 0, 'saveContext stores memory');

  // ── Summary ──────────────────────────────────────────────
  console.log(`\n${'━'.repeat(50)}`);
  console.log(`✅ ${pass} passed / ❌ ${fail} failed / ${pass + fail} total`);
  console.log(`${'━'.repeat(50)}\n`);

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
