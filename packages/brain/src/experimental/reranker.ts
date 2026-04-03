/**
 * Experiment 3: Cross-Encoder Reranking
 *
 * Problem: The recall pipeline uses bi-encoder (Voyage) scores for ranking.
 * Bi-encoders score query and document independently — they can't capture
 * fine-grained relevance that requires joint attention over both.
 *
 * Fix: After the final recall phase, pass top-25 results through a cross-encoder
 * reranker (Cohere Rerank or Voyage Rerank) which jointly scores query+document.
 * Return top-10 reranked results to the LLM.
 *
 * Expected improvement: LongMemEval overall +7-10pp (68.4% → 75-78%)
 * Hallucination impact: Strongly positive — eliminates irrelevant context.
 */

import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('exp-reranker');

/** A memory-like object with at least id, summary, content, and _score */
export interface RerankableMemory {
  id: number;
  summary: string;
  content?: string;
  _score: number;
  [key: string]: any;
}

interface RerankResult {
  index: number;
  relevance_score: number;
}

/**
 * Rerank memories using Cohere Rerank API.
 *
 * Takes the top-N recall results and reranks them with a cross-encoder model
 * that jointly attends to query + document. This is the single highest-leverage
 * improvement for retrieval precision (Researcher report, Exp 3).
 *
 * @param memories - Pre-sorted recall results (top-25 recommended)
 * @param query - The original user query
 * @param opts - Configuration options
 * @returns Reranked memories with updated _score values
 */
export async function rerankWithCrossEncoder(
  memories: RerankableMemory[],
  query: string,
  opts: {
    apiKey: string;
    topN?: number;
    model?: string;
  },
): Promise<RerankableMemory[]> {
  if (!opts.apiKey || memories.length <= 1) return memories;

  const topN = opts.topN ?? 10;
  const model = opts.model ?? 'rerank-v3.5';

  // Build documents: summary + first 500 chars of content for cross-encoder input
  const documents = memories.map(m => {
    const text = m.summary + (m.content ? '\n' + m.content.slice(0, 500) : '');
    return text;
  });

  try {
    const response = await fetch('https://api.cohere.com/v2/rerank', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model,
        query,
        documents,
        top_n: Math.min(topN, memories.length),
        return_documents: false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      log.warn({ status: response.status, body: errText.slice(0, 200) }, 'Cohere Rerank API error, returning original order');
      return memories;
    }

    const body = await response.json() as { results: RerankResult[] };
    const reranked = body.results
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .map(r => ({
        ...memories[r.index],
        _score: r.relevance_score,
        _originalScore: memories[r.index]._score,
      }));

    log.info({
      inputCount: memories.length,
      outputCount: reranked.length,
      topRelevance: reranked[0]?._score?.toFixed(3),
      bottomRelevance: reranked[reranked.length - 1]?._score?.toFixed(3),
    }, 'Cross-encoder reranking complete');

    return reranked;
  } catch (err) {
    log.warn({ err }, 'Cross-encoder reranking failed, returning original order');
    return memories;
  }
}

/**
 * Alternative: Rerank using Voyage AI Reranker.
 * Useful if already using Voyage for embeddings (same account/billing).
 */
export async function rerankWithVoyage(
  memories: RerankableMemory[],
  query: string,
  opts: {
    apiKey: string;
    topN?: number;
    model?: string;
  },
): Promise<RerankableMemory[]> {
  if (!opts.apiKey || memories.length <= 1) return memories;

  const topN = opts.topN ?? 10;
  const model = opts.model ?? 'rerank-2.5';

  const documents = memories.map(m =>
    m.summary + (m.content ? '\n' + m.content.slice(0, 500) : ''),
  );

  try {
    const response = await fetch('https://api.voyageai.com/v1/rerank', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model,
        query,
        documents,
        top_k: Math.min(topN, memories.length),
        return_documents: false,
      }),
    });

    if (!response.ok) {
      log.warn({ status: response.status }, 'Voyage Rerank API error');
      return memories;
    }

    const body = await response.json() as { data: Array<{ index: number; relevance_score: number }> };
    const reranked = body.data
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .map(r => ({
        ...memories[r.index],
        _score: r.relevance_score,
        _originalScore: memories[r.index]._score,
      }));

    log.info({ inputCount: memories.length, outputCount: reranked.length }, 'Voyage reranking complete');
    return reranked;
  } catch (err) {
    log.warn({ err }, 'Voyage reranking failed, returning original order');
    return memories;
  }
}
