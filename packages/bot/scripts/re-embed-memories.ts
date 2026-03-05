/**
 * Re-embed all memories with the current embedding provider.
 * 
 * Run: npx tsx scripts/re-embed-memories.ts
 * 
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, EMBEDDING_PROVIDER, EMBEDDING_API_KEY
 * Optional: EMBEDDING_MODEL (defaults to provider's default), BATCH_SIZE (default 20)
 */
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER || 'voyage';
const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY!;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'voyage-4-large';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '20', 10);

const PROVIDER_URLS: Record<string, string> = {
  voyage: 'https://api.voyageai.com/v1/embeddings',
  openai: 'https://api.openai.com/v1/embeddings',
  venice: 'https://api.venice.ai/api/v1/embeddings',
};

async function supabaseRPC(method: string, path: string, body?: any) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'PATCH' ? 'return=minimal' : 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
  }
  if (method === 'PATCH') return null;
  return res.json();
}

async function generateEmbeddings(texts: string[]): Promise<(number[] | null)[]> {
  const url = PROVIDER_URLS[EMBEDDING_PROVIDER];
  if (!url) throw new Error(`Unknown provider: ${EMBEDDING_PROVIDER}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${EMBEDDING_API_KEY}`,
    },
    body: JSON.stringify({
      input: texts.map(t => t.slice(0, 8000)),
      model: EMBEDDING_MODEL,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Embedding API error: ${res.status} ${text.slice(0, 300)}`);
    return texts.map(() => null);
  }

  const data = await res.json() as { data: Array<{ embedding: number[]; index: number }> };
  const result: (number[] | null)[] = texts.map(() => null);
  for (const item of data.data || []) {
    result[item.index] = item.embedding;
  }
  return result;
}

async function main() {
  console.log(`Re-embedding with ${EMBEDDING_PROVIDER} / ${EMBEDDING_MODEL}`);
  console.log(`Batch size: ${BATCH_SIZE}`);

  // Fetch all memories that have content
  let offset = 0;
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalFailed = 0;

  while (true) {
    const memories = await supabaseRPC(
      'GET',
      `memories?select=id,content,summary&order=created_at.asc&offset=${offset}&limit=${BATCH_SIZE}`
    );

    if (!memories || memories.length === 0) break;

    // Use summary if available, otherwise content (matching how generateEmbedding is called in memory.ts)
    const texts = memories.map((m: any) => {
      const text = m.summary || m.content || '';
      return text.slice(0, 8000);
    });

    console.log(`\nBatch ${Math.floor(offset / BATCH_SIZE) + 1}: ${memories.length} memories (offset ${offset})`);

    const embeddings = await generateEmbeddings(texts);

    for (let i = 0; i < memories.length; i++) {
      const memory = memories[i];
      const embedding = embeddings[i];

      if (!embedding) {
        console.error(`  FAIL: ${memory.id} (no embedding returned)`);
        totalFailed++;
        continue;
      }

      try {
        await supabaseRPC('PATCH', `memories?id=eq.${memory.id}`, {
          embedding: JSON.stringify(embedding),
        });
        totalUpdated++;
      } catch (err: any) {
        console.error(`  FAIL: ${memory.id} - ${err.message}`);
        totalFailed++;
      }
    }

    console.log(`  Updated: ${totalUpdated - (totalProcessed - totalFailed)} | Failed: ${totalFailed}`);
    totalProcessed += memories.length;
    offset += BATCH_SIZE;

    // Rate limit: ~100ms between batches
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\nDone! Total: ${totalProcessed} | Updated: ${totalUpdated} | Failed: ${totalFailed}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
