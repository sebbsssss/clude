/**
 * @clude/cloud e2e test — tests SupabaseProvider against live Supabase.
 * Run: npx tsx test/e2e.ts
 *
 * Requires: SUPABASE_URL, SUPABASE_KEY, VOYAGE_API_KEY
 */

import { SupabaseProvider } from '../src/supabase-provider.js';
import { VoyageEmbeddings } from '../src/voyage-embeddings.js';
import { VeniceLLM } from '../src/venice-llm.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ilmkakcqakvwtfrsabrd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const VOYAGE_KEY = process.env.VOYAGE_API_KEY || '';
const VENICE_KEY = process.env.VENICE_API_KEY || '';
const TEST_WALLET = 'test-cloud-' + Date.now();

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

async function main() {
  console.log('\n🧪 @clude/cloud e2e tests\n');

  // ── Provider init ──
  const storage = new SupabaseProvider({ url: SUPABASE_URL, serviceKey: SUPABASE_KEY });
  assert(storage.name === 'supabase', 'Provider name is supabase');

  // ── Voyage Embeddings ──
  if (VOYAGE_KEY) {
    console.log('\n📐 Voyage Embeddings');
    const voyage = new VoyageEmbeddings({ apiKey: VOYAGE_KEY });
    assert(voyage.dimensions === 1024, 'Voyage dimensions = 1024');

    const emb = await voyage.embed('test memory about TypeScript');
    assert(emb.length === 1024, `embed() returns 1024 dims (got ${emb.length})`);

    const qEmb = await voyage.embedQuery('What programming language?');
    assert(qEmb.length === 1024, `embedQuery() returns 1024 dims`);

    const batch = await voyage.embedBatch(['hello', 'world']);
    assert(batch.length === 2, `embedBatch() returns 2 results`);
    assert(batch[0]!.length === 1024, `batch[0] is 1024 dims`);
  } else {
    console.log('\n⏭️  Skipping Voyage tests (no VOYAGE_API_KEY)');
  }

  // ── Venice LLM ──
  if (VENICE_KEY) {
    console.log('\n🤖 Venice LLM');
    const venice = new VeniceLLM({ apiKey: VENICE_KEY });
    const result = await venice.generate({ prompt: 'Say "hello" and nothing else.' });
    assert(result.toLowerCase().includes('hello'), `Venice generate works: "${result.slice(0, 50)}"`);
  } else {
    console.log('\n⏭️  Skipping Venice tests (no VENICE_API_KEY)');
  }

  // ── Storage CRUD (uses test wallet for isolation) ──
  if (SUPABASE_KEY) {
    console.log('\n💾 Storage CRUD');
    const scope = { owner_wallet: TEST_WALLET };

    // Insert
    const mem = await storage.insert({
      id: `clude-test-${Date.now()}`,
      memory_type: 'semantic',
      content: 'Clude cloud provider test memory',
      summary: 'Test memory for e2e',
      tags: ['test', 'cloud'],
      concepts: ['testing'],
      emotional_valence: 0,
      importance: 0.8,
      access_count: 0,
      source: 'test',
      metadata: { test: true },
      created_at: new Date().toISOString(),
      last_accessed: new Date().toISOString(),
      decay_factor: 1.0,
      owner_wallet: TEST_WALLET,
    });
    assert(!!mem.id, `insert() returned id: ${mem.id}`);

    // Get by ID
    const fetched = await storage.getById(mem.id, scope);
    assert(fetched !== null, 'getById() found the memory');
    assert(fetched?.summary === 'Test memory for e2e', 'getById() correct summary');

    // Update
    await storage.update(mem.id, { importance: 0.95 }, scope);
    const updated = await storage.getById(mem.id, scope);
    assert(updated?.importance === 0.95, `update() importance = ${updated?.importance}`);

    // Query by importance
    const byImportance = await storage.queryByImportance({ limit: 5, scope });
    assert(byImportance.length > 0, `queryByImportance() returned ${byImportance.length} results`);

    // Query by source
    const bySource = await storage.queryBySource({ source: 'test', limit: 5, scope });
    assert(bySource.length > 0, `queryBySource() returned ${bySource.length} results`);

    // Count
    const count = await storage.count(scope);
    assert(count > 0, `count() = ${count}`);

    // Delete
    const deleted = await storage.delete(mem.id, scope);
    assert(deleted, 'delete() returned true');

    const gone = await storage.getById(mem.id, scope);
    assert(gone === null, 'getById() returns null after delete');

    // Vector search (uses main wallet's memories)
    if (VOYAGE_KEY) {
      console.log('\n🔍 Vector Search');
      const voyage = new VoyageEmbeddings({ apiKey: VOYAGE_KEY });
      const queryEmb = await voyage.embedQuery('What is Clude?');
      const mainScope = { owner_wallet: '5vK6WRCq5V6BCte8cQvaNeNv2KzErCfGzeBDwtBGGv2r' };
      const results = await storage.vectorSearch({
        embedding: queryEmb,
        threshold: 0.25,
        limit: 5,
        scope: mainScope,
      });
      assert(results.length > 0, `vectorSearch() returned ${results.length} results`);
      assert(results[0].similarity > 0.25, `top result sim = ${results[0].similarity.toFixed(3)}`);
    }

    // Link graph
    console.log('\n🔗 Link Graph');
    // Insert two memories for linking
    const m1 = await storage.insert({
      id: `clude-link-a-${Date.now()}`, memory_type: 'semantic',
      content: 'Link test A', summary: 'Link A', tags: [], concepts: [],
      emotional_valence: 0, importance: 0.5, access_count: 0, source: 'test',
      metadata: {}, created_at: new Date().toISOString(),
      last_accessed: new Date().toISOString(), decay_factor: 1.0,
      owner_wallet: TEST_WALLET,
    });
    const m2 = await storage.insert({
      id: `clude-link-b-${Date.now()}`, memory_type: 'semantic',
      content: 'Link test B', summary: 'Link B', tags: [], concepts: [],
      emotional_valence: 0, importance: 0.5, access_count: 0, source: 'test',
      metadata: {}, created_at: new Date().toISOString(),
      last_accessed: new Date().toISOString(), decay_factor: 1.0,
      owner_wallet: TEST_WALLET,
    });

    await storage.upsertLink({
      source_id: m1.id, target_id: m2.id,
      link_type: 'supports', strength: 0.8,
    });
    assert(true, 'upsertLink() succeeded');

    const linked = await storage.getLinkedMemories([m1.id], 0.1, 10, scope);
    assert(linked.length > 0, `getLinkedMemories() returned ${linked.length}`);

    // Cleanup
    await storage.delete(m1.id, scope);
    await storage.delete(m2.id, scope);

    // Entity graph
    if (storage.entities) {
      console.log('\n🧬 Entity Graph');
      const entity = await storage.entities.findOrCreate('Clude', 'project');
      assert(!!entity.id, `findOrCreate() returned entity id: ${entity.id}`);
      assert(entity.normalized_name === 'clude', 'Entity normalized_name correct');
    }
  } else {
    console.log('\n⏭️  Skipping Storage tests (no SUPABASE_KEY)');
  }

  // ── Summary ──
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`✅ ${passed} passed, ❌ ${failed} failed`);
  console.log(`${'─'.repeat(40)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
