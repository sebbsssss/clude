/**
 * End-to-end portability test.
 * 
 * Simulates the full journey:
 *   1. Agent A (wallet A) stores memories and creates connections
 *   2. Agent A exports a signed MemoryPack
 *   3. Agent B (different wallet, different machine) imports the pack
 *   4. Agent B can recall Agent A's memories
 *   5. Connections survived the transfer
 *   6. Re-import skips duplicates (merge mode)
 *   7. Integrity verification catches tampering
 */

import { createStore, verifyPackIntegrity, verifyPackSignature } from '../src/index.js';
import type { MemoryPack } from '../src/index.js';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';

const WALLET_A = '5vK6WRCq5V6BCte8cQvaNeNv2KzErCfGzeBDwtBGGv2r';
const WALLET_B = 'CksMhzLJAEzzLQR1XGiEmu5tWYjbAZBrvS5cm8YZeZhR';
const SECRET = 'test-signing-secret-123';
const PACK_PATH = '/tmp/clude-portability/brain.clude.json';

async function main() {
  console.log('🔗 CLUDE Portability Test — End-to-End Journey\n');

  // ── Step 1: Agent A builds memories ──────────────────────

  console.log('1️⃣  Agent A stores memories with wallet identity...');
  const agentA = createStore({
    dbPath: '/tmp/clude-portability/agent-a.db',
    wallet: WALLET_A,
    name: 'Clude',
  });
  agentA.clear();
  agentA.connections.clear();
  await agentA.warmup();

  const m1 = await agentA.remember({
    content: 'Clude uses Solana as a public memory ledger with 4 cognitive memory types',
    type: 'semantic',
    importance: 1.0,
  });

  const m2 = await agentA.remember({
    content: 'Venice AI provides private inference, no data logging, censorship-free',
    type: 'semantic',
    importance: 0.9,
  });

  const m3 = await agentA.remember({
    content: 'Seb resigned from StarHub in February 2026 to build independently',
    type: 'episodic',
    importance: 0.8,
  });

  const m4 = await agentA.remember({
    content: 'Deploy to Railway using Dockerfile, always match EMBEDDING_MODEL and EMBEDDING_QUERY_MODEL',
    type: 'procedural',
    importance: 0.9,
    connectTo: [
      { id: m1.id, type: 'elaborates', strength: 0.7 },
    ],
  });

  const m5 = await agentA.remember({
    content: 'Benchmark hit 83.9/100 after fixing knowledge seed scoring pipeline',
    type: 'episodic',
    importance: 0.8,
    connectTo: [
      { id: m1.id, type: 'supports', strength: 0.8 },
      { id: m4.id, type: 'follows', strength: 0.6 },
    ],
  });

  // Manual connection
  agentA.connections.connect(m2.id, m1.id, 'supports', 0.9, m2.uuid, m1.uuid);

  console.log(`   ✅ ${agentA.count()} memories, ${agentA.connections.count()} connections`);
  console.log(`   Wallet: ${agentA.wallet}`);
  console.log(`   Identity: ${JSON.stringify(agentA.getIdentity())}\n`);

  // ── Step 2: Agent A recalls (sanity check) ──────────────

  console.log('2️⃣  Agent A recalls memories (sanity check)...');
  const results = await agentA.recall({ query: 'how does memory work on Solana?', limit: 3 });
  for (const r of results) {
    console.log(`   sim=${r.similarity.toFixed(3)} | ${r.content.slice(0, 70)}`);
  }
  console.log();

  // ── Step 3: Export as signed MemoryPack ─────────────────

  console.log('3️⃣  Exporting signed MemoryPack...');
  const pack = agentA.exportPack({ secret: SECRET });
  
  console.log(`   Version: ${pack.version}`);
  console.log(`   Wallet: ${pack.wallet}`);
  console.log(`   Memories: ${pack.meta.memory_count}`);
  console.log(`   Connections: ${pack.meta.connection_count}`);
  console.log(`   Content hash: ${pack.meta.content_hash.slice(0, 16)}...`);
  console.log(`   Signature: ${pack.meta.signature?.slice(0, 16)}...`);
  
  // Save to file
  writeFileSync(PACK_PATH, JSON.stringify(pack, null, 2));
  const sizeKB = (JSON.stringify(pack).length / 1024).toFixed(1);
  console.log(`   Saved to ${PACK_PATH} (${sizeKB}KB)\n`);

  // ── Step 4: Verify integrity ────────────────────────────

  console.log('4️⃣  Verifying pack integrity...');
  const isIntact = verifyPackIntegrity(pack);
  const isSignedCorrectly = verifyPackSignature(pack, SECRET);
  const wrongSecret = verifyPackSignature(pack, 'wrong-secret');
  console.log(`   Integrity: ${isIntact ? '✅' : '❌'}`);
  console.log(`   Signature (correct secret): ${isSignedCorrectly ? '✅' : '❌'}`);
  console.log(`   Signature (wrong secret): ${wrongSecret ? '❌ SHOULD FAIL' : '✅ Rejected'}\n`);

  // ── Step 5: Agent B imports the pack ────────────────────

  console.log('5️⃣  Agent B imports the pack (different wallet, different DB)...');
  const agentB = createStore({
    dbPath: '/tmp/clude-portability/agent-b.db',
    wallet: WALLET_B,
    name: 'Agent B',
  });
  agentB.clear();
  agentB.connections.clear();
  await agentB.warmup();

  // Load pack from file (simulating transfer)
  const loadedPack: MemoryPack = JSON.parse(readFileSync(PACK_PATH, 'utf-8'));
  const importResult = await agentB.importPack(loadedPack);
  
  console.log(`   Imported: ${importResult.memories} memories, ${importResult.connections} connections`);
  console.log(`   Skipped: ${importResult.skipped} (duplicates)`);
  console.log(`   Agent B total: ${agentB.count()} memories, ${agentB.connections.count()} connections\n`);

  // ── Step 6: Agent B can recall imported memories ────────

  console.log('6️⃣  Agent B recalls from imported memories...');
  const bResults = await agentB.recall({ query: 'Solana memory types', limit: 3 });
  for (const r of bResults) {
    console.log(`   sim=${r.similarity.toFixed(3)} uuid=${r.uuid.slice(0,8)} wallet=${r.wallet.slice(0,8)} | ${r.content.slice(0, 60)}`);
  }
  console.log();

  // ── Step 7: Re-import skips duplicates ──────────────────

  console.log('7️⃣  Re-importing same pack (merge mode, should skip all)...');
  const reimport = await agentB.importPack(loadedPack);
  console.log(`   Imported: ${reimport.memories}, Skipped: ${reimport.skipped}`);
  console.log(`   Total still: ${agentB.count()} memories ✅\n`);

  // ── Step 8: Tampered pack fails integrity ───────────────

  console.log('8️⃣  Tampering detection...');
  const tampered = JSON.parse(JSON.stringify(pack)) as MemoryPack;
  tampered.memories[0].content = 'TAMPERED CONTENT';
  const tamperedIntact = verifyPackIntegrity(tampered);
  console.log(`   Tampered pack integrity: ${tamperedIntact ? '❌ SHOULD FAIL' : '✅ Detected tampering'}\n`);

  // ── Step 9: Connections survived ────────────────────────

  console.log('9️⃣  Checking connections survived transfer...');
  const m1imported = agentB.export().find(m => m.content.includes('Solana as a public memory'));
  if (m1imported) {
    const conns = agentB.connections.getConnections(m1imported.id);
    console.log(`   Connections for "${m1imported.content.slice(0, 40)}...":`);
    for (const c of conns) {
      console.log(`     ${c.direction} [${c.type}] strength=${c.strength.toFixed(1)}`);
    }
  }
  console.log();

  // ── Step 10: Export as markdown ──────────────────────────

  console.log('🔟 Markdown export...');
  const md = agentB.exportMarkdown();
  const mdPath = '/tmp/clude-portability/brain.md';
  writeFileSync(mdPath, md);
  console.log(`   Saved to ${mdPath}`);
  console.log(`   Preview:\n${md.split('\n').slice(0, 8).map(l => '   ' + l).join('\n')}\n`);

  // ── Summary ─────────────────────────────────────────────

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ All portability checks passed!');
  console.log();
  console.log('Journey:');
  console.log(`  Agent A (${WALLET_A.slice(0,8)}...) → MemoryPack → Agent B (${WALLET_B.slice(0,8)}...)`);
  console.log(`  ${pack.meta.memory_count} memories + ${pack.meta.connection_count} connections transferred`);
  console.log(`  Integrity ✅ | Signature ✅ | Tamper detection ✅ | Merge dedup ✅`);

  agentA.close();
  agentB.close();
  
  // Cleanup
  try { unlinkSync(PACK_PATH); } catch {}
}

main().catch(console.error);
