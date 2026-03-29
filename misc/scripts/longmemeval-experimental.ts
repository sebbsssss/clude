/**
 * Experimental LongMemEval Benchmark — Phase 1: All Tier 1 experiments
 *
 * Thin wrapper around longmemeval-benchmark.ts that monkey-patches
 * Cortex.recall to use enhancedRecallMemories() from src/experimental/.
 *
 * Tier 1 experiments enabled:
 *   - Exp 9: Temporal Bonds (temporal link weights in graph traversal)
 *   - Exp 4: IRCoT (iterative retrieval for multi-hop questions)
 *   - Exp 3: Reranking (Voyage rerank-2.5 cross-encoder)
 *   - Exp 8: BM25 (PostgreSQL tsvector full-text search augmentation)
 *
 * Disabled:
 *   - Exp 6: Confidence Gate (off — hurts recall on open questions)
 *   - Exp 1: RRF Merge (off — additive scoring sufficient with Temporal Bonds)
 *
 * Usage: npx tsx scripts/longmemeval-experimental.ts [same flags as longmemeval-benchmark.ts]
 */

// Set experimental feature flags before any imports
process.env.EXP_TEMPORAL_BONDS = 'true';
process.env.EXP_IRCOT = 'true';
process.env.EXP_RERANKING = 'true';
process.env.EXP_BM25_SEARCH = 'true';
process.env.EXP_CONFIDENCE_GATE = 'false';
process.env.EXP_RRF_MERGE = 'false';

// Enable Voyage reranking (rerank-2.5) — key from .env (same account as embeddings)
if (!process.env.EMBEDDING_API_KEY && !process.env.VOYAGE_API_KEY) {
  process.env.EMBEDDING_API_KEY = 'pa-M-rDVzpYrI82t-2Fad54iKZugVyejn995zFi9ZNmHhh';
}
process.env.EXP_RERANK_PROVIDER = 'voyage';

async function run() {
  // Dynamic imports so env vars are set before module initialization
  const { Cortex } = await import('../src/sdk');
  const { enhancedRecallMemories } = await import('../src/experimental/enhanced-recall');
  const { bm25SearchMemories } = await import('../src/experimental/bm25-search');
  const { hydrateMemories } = await import('../src/core/memory');
  const { getExperimentalConfig } = await import('../src/experimental/config');

  // Build Anthropic LLM caller for IRCoT reasoning steps (uses haiku — fast + cheap)
  const AnthropicSDK = await import('@anthropic-ai/sdk');
  const anthropic = new AnthropicSDK.default({ apiKey: process.env.ANTHROPIC_API_KEY });
  const llmCallFn = async (systemPrompt: string, userMessage: string): Promise<string> => {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    const content = response.content[0];
    return content.type === 'text' ? content.text : '';
  };

  // Monkey-patch Cortex.recall to use enhanced pipeline
  Cortex.prototype.recall = async function (opts: any = {}): Promise<any[]> {
    (this as any).guard();
    const config = getExperimentalConfig();

    // Run enhanced recall: temporal bonds + IRCoT + reranking + confidence gate
    const result = await enhancedRecallMemories(opts, llmCallFn);
    let memories = result.memories;

    // BM25 augmentation: fetch additional candidates not found by standard recall
    if (config.bm25Search && opts.query) {
      const existingIds = new Set(memories.map((m: any) => m.id));
      const bm25Results = await bm25SearchMemories(opts.query, {
        limit: opts.limit || 50,
        filterTags: opts.tags || null,
      });

      const newIds = bm25Results
        .filter((r: any) => !existingIds.has(r.id))
        .slice(0, 10)
        .map((r: any) => r.id as number);

      if (newIds.length > 0) {
        const hydrated = await hydrateMemories(newIds);
        const bm25Scored = hydrated.map((m: any) => ({
          ...m,
          _score: bm25Results.find((r: any) => r.id === m.id)?.rank || 0,
        }));
        memories = [...memories, ...bm25Scored];
      }
    }

    return memories;
  };

  // Phase 2: Ensemble answering — monkey-patch answer generation
  const config = getExperimentalConfig();
  if (config.ensembleAnswer) {
    const { ensembleAnswer } = await import('../src/experimental/ensemble-answer');

    // Override the benchmark's answer generation with ensemble pipeline
    (globalThis as any).__generateAnswerOverride = async (
      context: string,
      question: string,
      questionType: string,
      _readerModel: string,
      questionDate?: string,
    ): Promise<string> => {
      const result = await ensembleAnswer(context, question, llmCallFn, questionType, questionDate);
      // Log per-question ensemble stats
      const specialists = result.specialists.map(s =>
        `${s.role}:${s.insufficient ? 'INSUF' : s.confidence.toFixed(2)}`
      ).join(', ');
      console.log(`  [ENSEMBLE] strategy=${result.strategy} calls=${result.llmCalls} cost=$${result.estimatedCostUsd.toFixed(4)} [${specialists}]`);
      return result.answer;
    };
  }

  const ensembleStatus = config.ensembleAnswer ? 'ON' : 'OFF';
  console.log('[EXPERIMENTAL] Phase 1+2 — experiments active:');
  console.log('  - Temporal Bonds (Exp 9): ON');
  console.log('  - IRCoT (Exp 4): ON');
  console.log('  - Reranking/Voyage (Exp 3): ON');
  console.log('  - BM25 search (Exp 8): ON');
  console.log('  - Confidence Gate: OFF');
  console.log('  - RRF Merge: OFF');
  console.log(`  - Ensemble Answer (Phase 2): ${ensembleStatus}`);
  console.log();

  // Import the benchmark — auto-runs main()
  await import('./longmemeval-benchmark');
}

run();
