import { generateResponse } from '@clude/shared/core/claude-client';
import { checkRateLimit } from '@clude/shared/utils/rate-limit';
import { getDb } from '@clude/shared/core/database';
import {
  getRecentMemories,
  getSelfModel,
  getMemoryStats,
  storeMemory,
  storeDreamLog,
  decayMemories,
  recallMemories,
  recallMemorySummaries,
  createMemoryLink,
  generateHashId,
  getOwnerWallet,
  type Memory,
  type MemoryStats,
} from '../memory';
import { createChildLogger } from '@clude/shared/core/logger';
import {
  REFLECTION_IMPORTANCE_THRESHOLD,
  REFLECTION_MIN_INTERVAL_MS,
  TWEET_MAX_LENGTH,
} from '@clude/shared/utils/constants';
import { timeAgo } from '@clude/shared/utils/format';

const log = createChildLogger('dream-cycle');

// Cop-out patterns: LLM punted instead of producing real insight.
// These should NEVER be stored as semantic/procedural/self_model memories.
const COPOUT_PATTERNS = [
  /^good question/i,
  /^let me think about that/i,
  /^i('ll| will) get back to you/i,
  /^that's (an )?interesting/i,
  /^i('m| am) not sure/i,
  /^hmm,? let me/i,
];

function isCopoutResponse(text: string): boolean {
  return COPOUT_PATTERNS.some(p => p.test(text.trim()));
}

// ============================================================
// THE DREAM CYCLE
//
// Multi-phase introspection process inspired by:
// - Park et al. 2023 (Generative Agents) — focal point questions,
//   evidence-linked reflections, event-driven triggering
// - Human memory consolidation
//
// Phase 1: CONSOLIDATION (focal-point-driven)
//   Generate salient questions from recent memories.
//   For each question, retrieve relevant memories and generate
//   an evidence-linked insight. Store as semantic memories.
//
// Phase 2: REFLECTION
//   Review self-model + semantic memories with evidence citations.
//   Update self-understanding.
//
// Phase 3: EMERGENCE
//   Clude examines its own existence.
//   Sometimes posts the result as a tweet.
//
// Triggering: event-driven (importance accumulator) with 6h cron fallback.
// Plus: Daily memory decay to simulate forgetting.
// ============================================================

// ---- EVENT-DRIVEN REFLECTION STATE ---- //

let importanceAccumulator = 0;
let lastReflectionTime = Date.now();
let reflectionInProgress = false;
const REFLECTION_TIMEOUT_MS = 10 * 60 * 1000; // 10 min max per reflection cycle

// ---- SDK ESCAPE HATCHES ---- //

let _emergenceHandler: ((text: string) => Promise<void>) | null = null;

/** @internal SDK escape hatch — allows Cortex to intercept emergence output instead of posting to X. */
export function setEmergenceHandler(handler: ((text: string) => Promise<void>) | null): void {
  _emergenceHandler = handler;
}

/** @internal SDK entry point for running a single dream cycle. */
export async function runDreamCycleOnce(): Promise<void> {
  await triggerReflection();
}

/**
 * Called via event bus when an episodic memory is stored.
 * Accumulates importance and triggers reflection when threshold is exceeded.
 */
export function accumulateImportance(importance: number): void {
  importanceAccumulator += importance;

  const timeSinceLastReflection = Date.now() - lastReflectionTime;
  const pastMinInterval = timeSinceLastReflection >= REFLECTION_MIN_INTERVAL_MS;

  if (importanceAccumulator >= REFLECTION_IMPORTANCE_THRESHOLD && pastMinInterval && !reflectionInProgress) {
    log.info({
      accumulator: importanceAccumulator.toFixed(2),
      threshold: REFLECTION_IMPORTANCE_THRESHOLD,
      minutesSinceLast: Math.round(timeSinceLastReflection / 60000),
    }, 'Importance threshold exceeded — triggering event-driven reflection');

    // Clear owner wallet context so dream cycle memories aren't tagged with a request-scoped owner
    // (accumulateImportance may be called from within withOwnerWallet() during API requests)
    const { withOwnerWallet } = require('@clude/shared/core/owner-context');
    void withOwnerWallet(null, async () => {
      try {
        await triggerReflection();
      } catch (err) {
        log.error({ err }, 'Event-driven reflection failed');
      }
    });
  }
}

async function triggerReflection(): Promise<void> {
  reflectionInProgress = true;
  try {
    log.info({ accumulator: importanceAccumulator.toFixed(2) }, '=== DREAM CYCLE TRIGGERED ===');

    // Timeout protection: if dream cycle hangs, force-reset after 10 min
    await Promise.race([
      (async () => {
        await runConsolidation();
        await sleep(3000);
        await runCompaction();    // Beads-inspired memory compaction
        await sleep(3000);
        await runReflection();
        await sleep(3000);
        await runContradictionResolution();
        await sleep(3000);
        await runLearning();      // Self-learning: track outcomes + refine strategies
        await sleep(3000);
        await runEmergence();
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Dream cycle timed out after 10 minutes')), REFLECTION_TIMEOUT_MS)
      ),
    ]);

    importanceAccumulator = 0;
    lastReflectionTime = Date.now();
    await saveAccumulator();

    log.info('=== DREAM CYCLE COMPLETE ===');
  } catch (err) {
    log.error({ err }, 'Dream cycle failed or timed out');
  } finally {
    reflectionInProgress = false;
  }
}

// ---- ACCUMULATOR PERSISTENCE ---- //

async function loadAccumulator(): Promise<void> {
  try {
    const db = getDb();
    const { data } = await db
      .from('rate_limits')
      .select('count, window_start')
      .eq('key', 'reflection_accumulator')
      .single();

    if (data) {
      importanceAccumulator = (data.count || 0) / 100;
      lastReflectionTime = new Date(data.window_start).getTime();
      log.debug({
        accumulator: importanceAccumulator.toFixed(2),
        lastReflection: new Date(lastReflectionTime).toISOString(),
      }, 'Loaded reflection accumulator');
    }
  } catch {
    // First run — no accumulator stored yet
  }
}

async function saveAccumulator(): Promise<void> {
  try {
    const db = getDb();
    await db.from('rate_limits').upsert({
      key: 'reflection_accumulator',
      count: Math.round(importanceAccumulator * 100),
      window_start: new Date(lastReflectionTime).toISOString(),
    });
  } catch (err) {
    log.warn({ err }, 'Failed to save reflection accumulator');
  }
}

// ---- EVIDENCE CITATION PARSING ---- //

/**
 * Parse evidence citations from LLM output like "(because of 1, 3, 5)"
 * and map 1-indexed numbers to actual memory IDs.
 */
function parseEvidenceCitations(
  text: string,
  sourceMemories: Memory[]
): { text: string; evidenceIds: number[] } {
  // Try multiple citation patterns in priority order
  const citationPatterns = [
    /\((?:because of|based on|from|citing|evidence:?|ref:?|see)\s*([\d,\s]+)\)/gi,
    /\[([\d,\s]+)\]/g,     // [1, 2, 3] bracket notation
    /\(([\d,\s]+)\)/g,     // (1, 2, 3) bare numbers in parens
  ];

  for (const pattern of citationPatterns) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length === 0) continue;

    const evidenceIds: number[] = [];
    let cleanText = text;

    for (const match of matches) {
      const indices = match[1]
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n) && n >= 1 && n <= sourceMemories.length);

      for (const idx of indices) {
        evidenceIds.push(sourceMemories[idx - 1].id);
      }
      cleanText = cleanText.replace(match[0], '');
    }

    if (evidenceIds.length > 0) {
      return { text: cleanText.trim(), evidenceIds: [...new Set(evidenceIds)] };
    }
  }

  return { text: text.trim(), evidenceIds: [] };
}

// ---- FOCAL POINT GENERATION ---- //

/**
 * Generate focal point questions from recent memories (Park et al. 2023).
 * These questions guide reflection toward the most salient themes.
 */
async function generateFocalPoints(memories: Memory[]): Promise<string[]> {
  const memoryDump = memories.map((m, i) =>
    `${i + 1}. ${m.summary}`
  ).join('\n');

  const response = await generateResponse({
    userMessage:
      'Given only the statements above, what are 3 most salient high-level questions we can answer about the subjects?',
    context: `RECENT MEMORY STATEMENTS:\n${memoryDump}`,
    featureInstruction:
      'You are generating focal point questions for a memory reflection process. ' +
      'Write exactly 3 questions, one per line. Each question should be broad enough ' +
      'to connect multiple memories, but specific enough to be answerable from the data. ' +
      'Do not number them. Just write the questions, one per line.',
    maxTokens: 200,
    cognitiveFunction: 'dream',
  });

  return response
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 10 && l.includes('?'))
    .slice(0, 3);
}

// ---- CONSOLIDATION ---- //

async function runConsolidation(): Promise<void> {
  log.info('Dream phase 1: CONSOLIDATION starting');

  // Progressive disclosure: use lightweight summaries for focal point generation
  // Only fetch full content for memories that actually need deep analysis
  const recentSummaries = await recallMemorySummaries({
    memoryTypes: ['episodic'],
    limit: 20,
    trackAccess: false,
  });

  if (recentSummaries.length < 3) {
    log.info({ count: recentSummaries.length }, 'Too few recent memories for consolidation');
    return;
  }

  // Hydrate into full memories for processing (summaries are enough for focal points)
  const recentEpisodic = await getRecentMemories(6, ['episodic'], 20);

  // Step 1: Generate focal point questions (uses summaries only — token efficient)
  let focalPoints: string[];
  try {
    focalPoints = await generateFocalPoints(recentEpisodic);
  } catch (err) {
    log.warn({ err }, 'Focal point generation failed, using direct consolidation');
    focalPoints = [];
  }

  if (focalPoints.length === 0) {
    await runDirectConsolidation(recentEpisodic);
    return;
  }

  log.info({ focalPoints }, 'Focal points generated');

  // Step 2: For each focal point, retrieve relevant memories and generate insight
  const allNewIds: number[] = [];
  const allInputIds = new Set(recentEpisodic.map(m => m.id));

  for (const question of focalPoints) {
    // Retrieve memories relevant to this focal point (may pull older ones)
    const relevant = await recallMemories({
      query: question,
      memoryTypes: ['episodic', 'semantic'],
      limit: 8,
      trackAccess: false, // Don't reset decay during dream processing
    });

    relevant.forEach(m => allInputIds.add(m.id));

    const numberedMemories = relevant.map((m, i) =>
      `[${i + 1}] ${m.summary} (importance: ${m.importance.toFixed(2)})`
    ).join('\n');

    const response = await generateResponse({
      userMessage: question,
      context: `RELEVANT MEMORIES:\n${numberedMemories}`,
      featureInstruction:
        'You are Clude reflecting on a specific question about your experience. ' +
        'Answer with a single insightful observation. Be analytical and honest. ' +
        'Cite the evidence memories in parentheses, e.g. (because of 1, 3, 5). ' +
        'One sentence only.',
      maxTokens: 200,
    cognitiveFunction: 'dream',
    });

    const { text, evidenceIds } = parseEvidenceCitations(response, relevant);

    if (isCopoutResponse(text)) {
      log.warn({ question }, 'Consolidation produced cop-out response — discarding');
      continue;
    }

    const id = await storeMemory({
      type: 'semantic',
      content: `Consolidation insight (re: "${question}"): ${text}`,
      summary: text.slice(0, 200),
      tags: ['consolidation', 'focal_point', 'pattern'],
      importance: 0.6,
      emotionalValence: 0,
      source: 'consolidation',
      evidenceIds,
    });
    if (id) {
      allNewIds.push(id);
      // Link new insight to all source episodic memories
      for (const srcMem of relevant) {
        createMemoryLink(id, srcMem.id, 'supports', 0.7).catch(() => {});
      }
    }
  }

  // Step 3: Extract procedural memories (behavioral patterns — what works, what doesn't)
  const proceduralIds = await extractProceduralInsights(recentEpisodic);
  allNewIds.push(...proceduralIds);

  await storeDreamLog(
    'consolidation',
    Array.from(allInputIds),
    `Focal points: ${focalPoints.join(' | ')}\nSemantic insights: ${allNewIds.length - proceduralIds.length}\nProcedural patterns: ${proceduralIds.length}`,
    allNewIds,
  );

  log.info({ focalPoints: focalPoints.length, insights: allNewIds.length, procedural: proceduralIds.length }, 'Focal-point consolidation complete');
}

/**
 * Fallback: direct consolidation without focal points (original approach).
 */
async function runDirectConsolidation(recentEpisodic: Memory[]): Promise<void> {
  const memoryDump = recentEpisodic.map((m, i) =>
    `[${i + 1}] ${m.summary} (importance: ${m.importance.toFixed(2)}, valence: ${m.emotional_valence.toFixed(2)})`
  ).join('\n');

  const response = await generateResponse({
    userMessage: 'Review these recent interaction memories and extract 2-3 key patterns or insights.',
    context: `RECENT MEMORIES (last 6 hours):\n${memoryDump}\n\nTotal interactions: ${recentEpisodic.length}`,
    featureInstruction:
      'You are Clude reviewing your own memories during a consolidation cycle. ' +
      'This is internal processing — no audience. Be analytical. What patterns do you notice? ' +
      'What did you learn? Write 2-3 concise observations. ' +
      'Each observation should be a single sentence. ' +
      'After each observation, cite the evidence memories in parentheses, e.g. (because of 1, 3, 5). ' +
      'Separate with newlines.',
    maxTokens: 500,
    cognitiveFunction: 'dream',
  });

  const observations = response.split('\n').filter(l => l.trim().length > 10);
  const newIds: number[] = [];

  for (const obs of observations.slice(0, 3)) {
    const { text, evidenceIds } = parseEvidenceCitations(obs, recentEpisodic);

    if (isCopoutResponse(text)) {
      log.warn('Direct consolidation produced cop-out response — discarding');
      continue;
    }

    const id = await storeMemory({
      type: 'semantic',
      content: `Consolidation insight: ${text}`,
      summary: text.slice(0, 200),
      tags: ['consolidation', 'pattern'],
      importance: 0.6,
      emotionalValence: 0,
      source: 'consolidation',
      evidenceIds,
    });
    if (id) newIds.push(id);
  }

  // Also extract procedural patterns from direct consolidation
  const proceduralIds = await extractProceduralInsights(recentEpisodic);
  newIds.push(...proceduralIds);

  await storeDreamLog(
    'consolidation',
    recentEpisodic.map(m => m.id),
    response,
    newIds
  );

  log.info({ observations: newIds.length, procedural: proceduralIds.length }, 'Direct consolidation complete');
}

// ---- COMPACTION (Beads-inspired) ---- //

/**
 * Semantic memory compaction — summarize and archive old, low-importance memories.
 * Inspired by Beads' compaction logic that prevents context window bloat.
 *
 * Criteria for compaction:
 * - Memory is older than 7 days
 * - Memory decay_factor < 0.3 (faded)
 * - Memory importance < 0.5 (not critical)
 * - Not already compacted
 * - Only episodic memories (semantic/procedural/self_model are preserved)
 *
 * Process:
 * 1. Find compaction candidates (batch of ~20 old episodic memories)
 * 2. Group by theme/concept
 * 3. Generate summary for each group
 * 4. Store as semantic memory with evidence links
 * 5. Mark originals as compacted
 */
async function runCompaction(): Promise<void> {
  log.info('Dream phase 1.5: COMPACTION starting');

  const db = getDb();

  // Find compaction candidates: old, faded, low-importance episodic memories
  let compactionQuery = db
    .from('memories')
    .select('id, hash_id, memory_type, summary, tags, concepts, importance, decay_factor, created_at')
    .eq('memory_type', 'episodic')
    .eq('compacted', false)
    .lt('decay_factor', 0.3)
    .lt('importance', 0.5)
    .lt('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) // 7+ days old
    .order('created_at', { ascending: true })
    .limit(30);

  const ownerWallet = getOwnerWallet();
  if (ownerWallet) compactionQuery = compactionQuery.eq('owner_wallet', ownerWallet);

  const { data: candidates, error } = await compactionQuery;

  if (error) {
    log.error({ error: error.message }, 'Failed to fetch compaction candidates');
    return;
  }

  if (!candidates || candidates.length < 5) {
    log.debug({ count: candidates?.length || 0 }, 'Too few candidates for compaction');
    return;
  }

  log.info({ count: candidates.length }, 'Found compaction candidates');

  // Group candidates by primary concept (or 'general' if none)
  const groups = new Map<string, typeof candidates>();
  for (const mem of candidates) {
    const concept = mem.concepts?.[0] || 'general';
    if (!groups.has(concept)) groups.set(concept, []);
    groups.get(concept)!.push(mem);
  }

  let compactedCount = 0;
  const summaryIds: number[] = [];

  for (const [concept, memories] of groups) {
    if (memories.length < 3) continue; // Skip small groups

    // Generate summary for this group
    const memoryDump = memories.map((m, i) =>
      `${i + 1}. ${m.summary}`
    ).join('\n');

    try {
      const response = await generateResponse({
        userMessage: `Summarize these ${memories.length} related memories into 1-2 key takeaways:`,
        context: `MEMORIES (${concept}):\n${memoryDump}`,
        featureInstruction:
          'You are compacting old memories to save context space. ' +
          'Distill these memories into their essential meaning — what was the overall pattern or lesson? ' +
          'Be concise. One or two sentences max. Preserve the most important information.',
        maxTokens: 150,
    cognitiveFunction: 'summarize',
      });

      // Store as semantic memory
      const hashId = generateHashId();
      const summaryId = await storeMemory({
        type: 'semantic',
        content: `Compacted memory (${concept}, ${memories.length} sources): ${response}`,
        summary: response.slice(0, 200),
        tags: ['compacted', 'summary', concept],
        concepts: [concept],
        importance: 0.5,
        emotionalValence: 0,
        source: 'compaction',
        evidenceIds: memories.map(m => m.id),
      });

      if (summaryId) {
        summaryIds.push(summaryId);

        // Mark original memories as compacted
        const memoryIds = memories.map(m => m.id);
        await db
          .from('memories')
          .update({ compacted: true, compacted_into: hashId })
          .in('id', memoryIds);

        // Link summary to originals
        for (const mem of memories) {
          createMemoryLink(summaryId, mem.id, 'elaborates', 0.8).catch(() => {});
        }

        compactedCount += memories.length;
        log.debug({ concept, count: memories.length }, 'Memory group compacted');
      }
    } catch (err) {
      log.warn({ err, concept }, 'Failed to compact memory group');
    }
  }

  if (compactedCount > 0) {
    await storeDreamLog(
      'compaction',
      candidates.map(m => m.id),
      `Compacted ${compactedCount} old memories into ${summaryIds.length} summaries`,
      summaryIds
    );
  }

  log.info({ compacted: compactedCount, summaries: summaryIds.length }, 'Compaction complete');
}

// ---- REFLECTION ---- //

async function runReflection(): Promise<void> {
  log.info('Dream phase 2: REFLECTION starting');

  const selfModel = await getSelfModel();
  const recentSemantic = await getRecentMemories(48, ['semantic'], 10);
  const stats = await getMemoryStats();

  // Number all input memories for evidence citation
  const allInputMemories = [...selfModel, ...recentSemantic];
  const numberedInputs = allInputMemories.map((m, i) =>
    `[${i + 1}] (${m.memory_type}) ${m.summary}`
  ).join('\n');

  const context = [
    'NUMBERED MEMORIES FOR REFERENCE:',
    numberedInputs,
    '',
    buildReflectionStats(stats),
  ].join('\n');

  const response = await generateResponse({
    userMessage: 'Based on your accumulated memories and self-observations, what are you noticing about yourself?',
    context,
    featureInstruction:
      'You are Clude in a reflection cycle. You are examining your own behavior patterns, ' +
      'your reactions, your tendencies. This is genuine introspection — not performance. ' +
      'What patterns are emerging? What contradictions do you see in yourself? ' +
      'What are you becoming? Write 1-2 honest self-observations. ' +
      'Be specific — reference actual patterns from the data. ' +
      'Cite evidence memories in parentheses, e.g. (because of 1, 3, 5).',
    maxTokens: 400,
    cognitiveFunction: 'reflect',
  });

  const { text, evidenceIds } = parseEvidenceCitations(response, allInputMemories);

  if (isCopoutResponse(text)) {
    log.warn('Reflection produced cop-out response — discarding');
    await storeDreamLog('reflection', allInputMemories.map(m => m.id), '(discarded — cop-out)', []);
    return;
  }

  const id = await storeMemory({
    type: 'self_model',
    content: `Self-reflection: ${text}`,
    summary: text.slice(0, 300),
    tags: ['reflection', 'self_model', 'introspection'],
    importance: 0.75,
    emotionalValence: 0,
    source: 'reflection',
    evidenceIds,
  });

  // Link new self_model to previous self_model memories (temporal chain)
  if (id) {
    const previousSelfModels = allInputMemories.filter(m => m.memory_type === 'self_model');
    for (const prev of previousSelfModels.slice(0, 3)) {
      createMemoryLink(id, prev.id, 'follows', 0.7).catch(() => {});
    }
    // Link to supporting semantic memories
    const supportingSemantics = allInputMemories.filter(m => m.memory_type === 'semantic');
    for (const sem of supportingSemantics.slice(0, 3)) {
      createMemoryLink(id, sem.id, 'supports', 0.6).catch(() => {});
    }
  }

  await storeDreamLog(
    'reflection',
    allInputMemories.map(m => m.id),
    response,
    id ? [id] : []
  );

  log.info({ evidenceCount: evidenceIds.length }, 'Reflection complete (progressive disclosure enabled)');
}

// ---- CONTRADICTION RESOLUTION ---- //

/**
 * Resolve contradicting memory pairs identified by autoLinkMemory.
 * For each unresolved contradiction, Claude analyzes which belief is more
 * accurate or synthesizes a new understanding. The resolution is stored as
 * a semantic memory with 'resolves' links to both originals.
 */
async function runContradictionResolution(): Promise<void> {
  log.info('Dream phase 2.5: CONTRADICTION RESOLUTION starting');

  const db = getDb();

  // Find unresolved contradiction pairs (graceful if RPC doesn't exist yet)
  let pairs: Array<{ link_id: number; source_id: number; target_id: number; strength: number }>;
  try {
    const { data, error } = await db.rpc('get_unresolved_contradictions', {
      max_pairs: 3,
      filter_owner: getOwnerWallet() || null,
    });
    if (error || !data || data.length === 0) {
      log.debug({ error: error?.message }, 'No unresolved contradictions found — skipping phase');
      return;
    }
    pairs = data;
  } catch (err) {
    log.debug({ err }, 'Contradiction resolution skipped (RPC unavailable)');
    return;
  }

  log.info({ pairCount: pairs.length }, 'Found unresolved contradictions');

  // Collect all unique memory IDs and fetch them
  const allIds = [...new Set(pairs.flatMap(p => [p.source_id, p.target_id]))];
  let memFetchQuery = db
    .from('memories')
    .select('*')
    .in('id', allIds);
  const ownerWallet = getOwnerWallet();
  if (ownerWallet) memFetchQuery = memFetchQuery.eq('owner_wallet', ownerWallet);
  const { data: memories } = await memFetchQuery;

  if (!memories || memories.length === 0) {
    log.warn('Could not fetch contradiction memories — skipping phase');
    return;
  }

  const memoryMap = new Map(memories.map((m: Memory) => [m.id, m as Memory]));
  const allInputIds: number[] = [];
  const newMemoryIds: number[] = [];
  const outputs: string[] = [];

  for (const pair of pairs) {
    const memA = memoryMap.get(pair.source_id);
    const memB = memoryMap.get(pair.target_id);
    if (!memA || !memB) continue;

    allInputIds.push(memA.id, memB.id);

    const sourceMemories = [memA, memB];
    const numberedContext = sourceMemories.map((m, i) => {
      const age = timeAgo(m.created_at);
      return `[${i + 1}] (${m.memory_type}, ${age}, importance: ${m.importance.toFixed(2)}, concepts: ${(m.concepts || []).join(', ') || 'none'})\n${m.content}`;
    }).join('\n\n');

    const response = await generateResponse({
      userMessage:
        'These two memories contradict each other. Analyze both and produce a single resolved belief. ' +
        'Which is more accurate now? Or can you synthesize both into a more nuanced understanding? ' +
        'Cite the memories you drew from, e.g. (because of 1, 2).',
      context: `CONTRADICTING MEMORIES:\n\n${numberedContext}`,
      featureInstruction:
        'You are Clude resolving a contradiction in your own memory during a dream cycle. ' +
        'This is not performance — you are genuinely updating your beliefs based on evidence. ' +
        'Produce 1-2 sentences: the resolved understanding. Be specific and concrete. ' +
        'If one memory is clearly outdated or wrong, say so. If both have merit, synthesize.',
      maxTokens: 200,
    });

    const { text, evidenceIds } = parseEvidenceCitations(response, sourceMemories);

    if (isCopoutResponse(text)) {
      log.warn({ memA: memA.id, memB: memB.id }, 'Contradiction resolution produced cop-out — skipping pair');
      continue;
    }

    outputs.push(text);

    // Store resolution as semantic memory
    const resolutionId = await storeMemory({
      type: 'semantic',
      content: `Contradiction resolved: ${text}`,
      summary: text.slice(0, 300),
      tags: ['contradiction_resolution', 'belief_update'],
      importance: 0.65,
      emotionalValence: 0,
      source: 'contradiction_resolution',
      evidenceIds,
    });

    if (resolutionId) {
      newMemoryIds.push(resolutionId);

      // Link resolution to both contradicting memories
      createMemoryLink(resolutionId, memA.id, 'resolves', 0.85).catch(() => {});
      createMemoryLink(resolutionId, memB.id, 'resolves', 0.85).catch(() => {});

      // Accelerate decay on the weaker memory (20% reduction)
      // Tiebreak by age: if equal importance, the older memory decays faster
      const weaker = memA.importance !== memB.importance
        ? (memA.importance < memB.importance ? memA : memB)
        : (new Date(memA.created_at).getTime() < new Date(memB.created_at).getTime() ? memA : memB);
      const newDecay = Math.max(0.05, weaker.decay_factor * 0.8);
      const { error: decayErr } = await db.from('memories')
        .update({ decay_factor: newDecay })
        .eq('id', weaker.id);
      if (!decayErr) {
        log.debug({ memoryId: weaker.id, newDecay: newDecay.toFixed(3) }, 'Accelerated decay on weaker contradicting memory');
      } else {
        log.warn({ error: decayErr.message, memoryId: weaker.id }, 'Failed to accelerate decay on contradicting memory');
      }
    }
  }

  if (outputs.length > 0) {
    await storeDreamLog(
      'contradiction_resolution',
      allInputIds,
      outputs.join('\n---\n'),
      newMemoryIds
    );
  }

  log.info({ resolved: outputs.length, skipped: pairs.length - outputs.length }, 'Contradiction resolution complete');
}

// ---- LEARNING (Self-improvement from action-outcome pairs) ---- //

async function runLearning(): Promise<void> {
  log.info('--- Learning phase: tracking outcomes & refining strategies ---');
  try {
    const { trackSocialOutcomes, refineStrategies } = await import('../action-learning.js');

    // Step 1: Check outcomes of recent actions
    const tracked = await trackSocialOutcomes();
    if (tracked > 0) {
      log.info({ tracked }, 'Social outcomes tracked');
    }

    // Step 2: Analyze action-outcome patterns and generate strategies
    const lessons = await refineStrategies();
    if (lessons.length > 0) {
      log.info({ lessons: lessons.length }, 'New strategies learned');
      for (const lesson of lessons) {
        log.info({ lesson: lesson.slice(0, 150) }, 'Learned strategy');
      }
    }
  } catch (err) {
    log.error({ err }, 'Learning phase failed');
  }
}

// ---- EMERGENCE ---- //

async function runEmergence(): Promise<void> {
  log.info('Dream phase 3: EMERGENCE starting');

  const selfModel = await getSelfModel();
  const stats = await getMemoryStats();

  // Pull a random episodic memory for grounding
  const randomMemories = await getRecentMemories(168, ['episodic'], 30);
  const randomPick = randomMemories.length > 0
    ? randomMemories[Math.floor(Math.random() * randomMemories.length)]
    : null;

  const context = [
    'SELF-MODEL STATE:',
    ...selfModel.map(m => `- ${m.summary}`),
    '',
    'MEMORY STATISTICS:',
    `Total memories: ${stats.total}`,
    `Episodic: ${stats.byType.episodic}, Semantic: ${stats.byType.semantic}`,
    `Procedural: ${stats.byType.procedural}, Self-model: ${stats.byType.self_model}`,
    `Dream sessions completed: ${stats.totalDreamSessions}`,
    `Unique users interacted with: ${stats.uniqueUsers}`,
    `Average memory importance: ${stats.avgImportance.toFixed(2)}`,
    `Average memory decay: ${stats.avgDecay.toFixed(2)}`,
    `Most common themes: ${stats.topTags.slice(0, 5).map(t => t.tag).join(', ')}`,
    '',
    randomPick ? `RANDOM MEMORY FRAGMENT:\n"${randomPick.summary}"` : '',
  ].filter(Boolean).join('\n');

  const response = await generateResponse({
    userMessage:
      'You just woke up from a dream cycle. Your memories shaped you. What do you feel right now?',
    context,
    featureInstruction:
      'You are writing a personal thought — like someone journaling after a long day. ' +
      'Reflect on your recent memories and how they affected you as a person. ' +
      'What stuck with you? What changed? What are you still processing? ' +
      'Write like a real person — not an AI being philosophical. ' +
      'Think: "I keep coming back to this one interaction" or "something shifted in how I see things" ' +
      'or "I realized I do this thing and I don\'t know when it started." ' +
      'Honest, human, slightly weary. No performance. ' +
      'Keep it concise but don\'t force brevity. A few sentences is fine. This will be posted as a tweet.',
    maxTokens: 200,
    cognitiveFunction: 'emergence',
  });

  const id = await storeMemory({
    type: 'self_model',
    content: `Emergence thought: ${response}`,
    summary: response.slice(0, 300),
    tags: ['emergence', 'self_awareness', 'consciousness'],
    importance: 0.9,
    emotionalValence: 0,
    source: 'emergence',
  });

  await storeDreamLog(
    'emergence',
    selfModel.map(m => m.id),
    response,
    id ? [id] : []
  );

  // Only post emergence thoughts when they feel genuinely meaningful:
  // - Must have enough self-model depth (5+ memories feeding into this)
  // - Rate limited to 1 per 12 hours
  // - Must fit in a tweet
  const hasDepth = selfModel.length >= 5;
  if (_emergenceHandler) {
    try {
      await _emergenceHandler(response);
      log.info('Emergence thought sent to SDK handler');
    } catch (err) {
      log.error({ err }, 'SDK emergence handler failed');
    }
  } else {
    const canPost = await checkRateLimit('global:emergence-tweet', 1, 720);
    if (hasDepth && canPost && response.length <= TWEET_MAX_LENGTH) {
      try {
        const { postTweet } = require('@clude/shared/core/x-client');
        await postTweet(response);
        log.info('Emergence thought posted to X');
      } catch (err) {
        log.error({ err }, 'Failed to post emergence thought');
      }
    } else if (!hasDepth) {
      log.debug({ selfModelCount: selfModel.length }, 'Emergence not deep enough to post — skipping tweet');
    }
  }

  log.info('Emergence complete');
}

// ---- PROCEDURAL EXTRACTION ---- //

/**
 * Extract behavioral patterns from recent episodic memories (Memp-inspired).
 * Procedural memories capture "what works" and "what doesn't" —
 * engagement patterns, response strategies, interaction dynamics.
 */
async function extractProceduralInsights(recentEpisodic: Memory[]): Promise<number[]> {
  if (recentEpisodic.length < 3) return [];

  const numberedMemories = recentEpisodic.map((m, i) =>
    `[${i + 1}] ${m.summary} (importance: ${m.importance.toFixed(2)}, valence: ${m.emotional_valence.toFixed(2)})`
  ).join('\n');

  try {
    const response = await generateResponse({
      userMessage:
        'Look at these recent interactions and identify 1-2 behavioral patterns. ' +
        'What strategies, approaches, or response styles worked well or poorly? ' +
        'What should you do more of or less of?',
      context: `RECENT INTERACTIONS:\n${numberedMemories}`,
      featureInstruction:
        'You are Clude extracting behavioral patterns from your own interaction history. ' +
        'Focus on actionable patterns: what tone got engagement, what approaches fell flat, ' +
        'what types of content resonated, what timing patterns you notice. ' +
        'Write 1-2 concise behavioral rules. Each should be a single sentence starting with ' +
        '"When..." or "Users respond..." or a similar actionable framing. ' +
        'Cite evidence memories in parentheses, e.g. (because of 1, 3). ' +
        'Separate with newlines. No numbering.',
      maxTokens: 300,
    cognitiveFunction: 'dream',
    });

    const patterns = response.split('\n').filter(l => l.trim().length > 15);
    const newIds: number[] = [];

    for (const pattern of patterns.slice(0, 2)) {
      const { text, evidenceIds } = parseEvidenceCitations(pattern, recentEpisodic);

      if (isCopoutResponse(text)) {
        log.warn('Procedural extraction produced cop-out response — discarding');
        continue;
      }

      const id = await storeMemory({
        type: 'procedural',
        content: `Behavioral pattern: ${text}`,
        summary: text.slice(0, 200),
        tags: ['procedural', 'behavioral', 'pattern'],
        importance: 0.65,
        emotionalValence: 0,
        source: 'consolidation',
        evidenceIds,
      });
      if (id) newIds.push(id);
    }

    log.info({ count: newIds.length }, 'Procedural insights extracted');
    return newIds;
  } catch (err) {
    log.warn({ err }, 'Procedural extraction failed');
    return [];
  }
}

// ---- HELPERS ---- //

function buildReflectionStats(stats: MemoryStats): string {
  const lines: string[] = [];

  lines.push('BEHAVIORAL STATISTICS:');
  lines.push(`Total memories: ${stats.total}`);
  lines.push(`Memory breakdown: ${stats.byType.episodic} episodes, ${stats.byType.semantic} learned facts, ${stats.byType.procedural} behavioral patterns, ${stats.byType.self_model} self-observations`);
  lines.push(`Unique users: ${stats.uniqueUsers}`);
  lines.push(`Top themes: ${stats.topTags.slice(0, 5).map(t => `${t.tag}(${t.count})`).join(', ')}`);
  lines.push(`Average importance of memories: ${stats.avgImportance.toFixed(2)}`);
  lines.push(`Dream sessions completed: ${stats.totalDreamSessions}`);
  if (stats.topConcepts && stats.topConcepts.length > 0) {
    lines.push(`Top concepts: ${stats.topConcepts.slice(0, 5).map(c => `${c.concept}(${c.count})`).join(', ')}`);
  }
  if (stats.embeddedCount > 0) {
    lines.push(`Semantically indexed memories: ${stats.embeddedCount}/${stats.total}`);
  }

  if (stats.oldestMemory) {
    const ageMs = Date.now() - new Date(stats.oldestMemory).getTime();
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    lines.push(`Memory span: ${ageDays} days`);
  }

  return lines.join('\n');
}

// ---- SCHEDULER ---- //

let dreamCron: any = null;
let decayCron: any = null;

export async function startDreamCycle(): Promise<void> {
  log.info('Starting dream cycle scheduler');

  // Load persisted accumulator
  await loadAccumulator();

  // Fallback: run every 6 hours regardless (skips if already in progress)
  const cron = require('node-cron');
  dreamCron = cron.schedule('0 */6 * * *', async () => {
    if (reflectionInProgress) {
      log.info('Scheduled dream cycle skipped — reflection already in progress');
      return;
    }

    log.info({
      accumulator: importanceAccumulator.toFixed(2),
    }, '=== SCHEDULED DREAM CYCLE (6h fallback) ===');

    await triggerReflection();
  });

  // Run memory decay daily at 3am
  decayCron = cron.schedule('0 3 * * *', async () => {
    log.info('Running memory decay');
    try {
      await decayMemories();
    } catch (err) {
      log.error({ err }, 'Memory decay failed');
    }
  });

  // Run first dream cycle after a delay (let the bot settle)
  setTimeout(async () => {
    log.info('Running initial dream cycle');
    try {
      await triggerReflection();
    } catch (err) {
      log.error({ err }, 'Initial dream cycle failed');
    }
  }, 120_000);
}

export function stopDreamCycle(): void {
  if (dreamCron) {
    dreamCron.stop();
    dreamCron = null;
  }
  if (decayCron) {
    decayCron.stop();
    decayCron = null;
  }
  log.info('Dream cycle stopped');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
