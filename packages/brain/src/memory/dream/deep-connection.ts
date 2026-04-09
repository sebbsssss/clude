/**
 * Phase 4.5: Deep Connection
 *
 * Uses the JEPA client to predict latent embeddings for relation types
 * (supports, causes, elaborates) and finds non-obvious memory links
 * that standard recall would miss. Runs between Learning and Emergence.
 */

import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';
import {
  recallMemories,
  createMemoryLinksBatch,
  fetchExistingLinkTargets,
  markJepaQueried,
  fetchJepaQueriedSince,
  matchByEmbedding,
  type Memory,
  type MemoryLinkRow,
} from '../memory';
import { JepaClient, RELATION_TYPES, type JepaMetadata } from './jepa';

const log = createChildLogger('dream-deep-connection');

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const RECENT_SAMPLE = 15;
const HIGH_IMPORTANCE_SAMPLE = 5;
const HIGH_IMPORTANCE_THRESHOLD = 0.7;
const EMBEDDING_SIMILARITY_THRESHOLD = 0.55;
const MATCH_LIMIT = 5;
const TOP_LINKS_PER_MEMORY = 2;

export interface DeepConnectionResult {
  linksCreated: number;
  skipped: boolean;
  topLinks: Array<{ sourceId: number; targetId: number; relationType: string; score: number }>;
}

/**
 * Lazy-initialised singleton JEPA client. Reads env vars at first use.
 */
let _jepaClient: JepaClient | null = null;

function getJepaClient(): JepaClient {
  if (!_jepaClient) {
    _jepaClient = new JepaClient({
      url: process.env.JEPA_URL ?? '',
      token: process.env.JEPA_TOKEN ?? '',
      enabled: process.env.JEPA_ENABLED === 'true',
      timeoutMs: 8000,
    });
  }
  return _jepaClient;
}

/**
 * Shuffle an array in-place (Fisher-Yates).
 */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Run Phase 4.5: Deep Connection via JEPA.
 *
 * @param ownerWallet - Optional owner wallet for scoped queries.
 */
export async function runDeepConnectionPhase(
  ownerWallet?: string | null
): Promise<DeepConnectionResult> {
  const SKIPPED: DeepConnectionResult = { linksCreated: 0, skipped: true, topLinks: [] };

  if (process.env.JEPA_ENABLED !== 'true') {
    log.debug('JEPA disabled — skipping deep connection phase');
    return SKIPPED;
  }

  const jepaClient = getJepaClient();

  // ----------------------------------------------------------------
  // 1. Sample up to 20 memories: 15 recent + 5 random high-importance
  // ----------------------------------------------------------------
  const db = getDb();

  // Recent memories (last 48 h, ordered by created_at desc)
  const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  let recentQ = db
    .from('memories')
    .select('*')
    .gte('created_at', since48h)
    .order('created_at', { ascending: false })
    .limit(RECENT_SAMPLE);
  if (ownerWallet) recentQ = recentQ.eq('owner_wallet', ownerWallet);
  const { data: recentData } = await recentQ;
  const recentMemories: Memory[] = recentData ?? [];

  // High-importance memories (sampled randomly for serendipity)
  let highImpQ = db
    .from('memories')
    .select('*')
    .gte('importance', HIGH_IMPORTANCE_THRESHOLD)
    .order('created_at', { ascending: false })
    .limit(50); // fetch more, then sample
  if (ownerWallet) highImpQ = highImpQ.eq('owner_wallet', ownerWallet);
  const { data: highImpData } = await highImpQ;
  const highImpMemories: Memory[] = shuffle(highImpData ?? []).slice(0, HIGH_IMPORTANCE_SAMPLE);

  // Merge + deduplicate by id
  const seen = new Set<number>();
  const candidates: Memory[] = [];
  for (const m of [...recentMemories, ...highImpMemories]) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      candidates.push(m);
    }
  }

  if (candidates.length === 0) {
    log.debug('No candidate memories — skipping deep connection phase');
    return SKIPPED;
  }

  // ----------------------------------------------------------------
  // 2. Filter out memories already JEPA-queried in last 24 h
  // ----------------------------------------------------------------
  const queriedRecently = await fetchJepaQueriedSince(Date.now() - TWENTY_FOUR_HOURS_MS);
  const toProcess = candidates.filter(m => !queriedRecently.has(m.id));

  if (toProcess.length === 0) {
    log.debug('All candidates JEPA-queried in last 24 h — skipping');
    return SKIPPED;
  }

  log.info({ total: candidates.length, toProcess: toProcess.length }, 'Deep connection phase: processing memories');

  // ----------------------------------------------------------------
  // 3. For each memory, predict + match + filter + create links
  // ----------------------------------------------------------------
  const allLinks: MemoryLinkRow[] = [];
  const topLinks: DeepConnectionResult['topLinks'] = [];

  for (const mem of toProcess) {
    // Embedding is stored as a JSON string in the DB row but not typed in Memory
    const rawEmb = (mem as any).embedding;
    if (!rawEmb) continue;

    const embedding: number[] = typeof rawEmb === 'string' ? JSON.parse(rawEmb) : rawEmb;
    if (!Array.isArray(embedding) || embedding.length === 0) continue;

    const ageHours = (Date.now() - new Date(mem.created_at).getTime()) / (60 * 60 * 1000);

    const metadata: JepaMetadata = {
      memoryType: mem.memory_type as JepaMetadata['memoryType'],
      importance: mem.importance,
      decayFactor: mem.decay_factor,
      ageHours,
      concepts: mem.concepts ?? [],
    };

    // Predict latent embeddings for all relation types
    const prediction = await jepaClient.predict({
      memoryId: mem.id,
      embedding,
      metadata,
      relationTypes: [...RELATION_TYPES],
    });

    if (!prediction) {
      // Circuit open or JEPA unavailable — mark as queried so we don't retry immediately
      await markJepaQueried(mem.id);
      continue;
    }

    // Build the "already findable" set via normal recall on this memory's summary
    const normalRecallResults = await recallMemories({
      query: mem.summary,
      limit: 10,
      trackAccess: false,
      skipExpansion: true,
    });
    const normalRecallIds = new Set(normalRecallResults.map(r => r.id));

    // Existing links for this memory
    const existingTargets = await fetchExistingLinkTargets(mem.id);

    // For each predicted embedding, find matching memories
    const candidateLinks: Array<{ targetId: number; relationType: string; confidence: number; similarity: number }> = [];

    for (const pred of prediction.predictions) {
      const matches = await matchByEmbedding({
        embedding: pred.embedding,
        threshold: EMBEDDING_SIMILARITY_THRESHOLD,
        limit: MATCH_LIMIT,
        ownerWallet: ownerWallet ?? undefined,
      });

      for (const match of matches) {
        // Skip self
        if (match.id === mem.id) continue;
        // Skip memories already findable via normal recall
        if (normalRecallIds.has(match.id)) continue;
        // Skip already-linked memories
        if (existingTargets.has(match.id)) continue;

        candidateLinks.push({
          targetId: match.id,
          relationType: pred.relation_type,
          confidence: pred.confidence,
          similarity: match.similarity,
        });
      }
    }

    // Score and keep top 2
    const scored = candidateLinks
      .map(c => ({ ...c, score: c.confidence * c.similarity }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_LINKS_PER_MEMORY);

    for (const link of scored) {
      allLinks.push({
        source_id: mem.id,
        target_id: link.targetId,
        link_type: link.relationType as any, // RelationType is a valid MemoryLinkType subset
        strength: 0.5,
      });

      if (topLinks.length < 3) {
        topLinks.push({
          sourceId: mem.id,
          targetId: link.targetId,
          relationType: link.relationType,
          score: link.score,
        });
      }
    }

    await markJepaQueried(mem.id);
  }

  // ----------------------------------------------------------------
  // 4. Batch-create links
  // ----------------------------------------------------------------
  if (allLinks.length > 0) {
    await createMemoryLinksBatch(allLinks);
  }

  // ----------------------------------------------------------------
  // 5. Write dream log entry
  // ----------------------------------------------------------------
  const topSummary =
    topLinks.length > 0
      ? topLinks
          .map(l => `${l.sourceId}→${l.targetId} [${l.relationType}] score=${l.score.toFixed(3)}`)
          .join(', ')
      : 'none';

  try {
    await db.from('dream_logs').insert({
      session_type: 'deep_connection',
      input_memory_ids: toProcess.map(m => m.id),
      output: `JEPA deep connection: ${allLinks.length} links created. Top: ${topSummary}`,
      new_memories_created: [],
    });
  } catch (err) {
    // Non-fatal — log but don't fail the phase
    log.warn({ err }, 'Failed to write deep_connection dream log');
  }

  log.info({ linksCreated: allLinks.length, topLinks: topLinks.length }, 'Deep connection phase complete');

  return {
    linksCreated: allLinks.length,
    skipped: false,
    topLinks,
  };
}
