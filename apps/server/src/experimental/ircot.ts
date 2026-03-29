/**
 * Experiment 4: IRCoT — Iterative Retrieval with Chain-of-Thought
 *
 * Problem: Single-pass retrieval can't answer multi-hop questions that require
 * chaining evidence across multiple memories.
 *
 * Fix: IRCoT loop (Trivedi et al., ACL 2023) that interleaves retrieval
 * with chain-of-thought reasoning. Each iteration:
 * 1. LLM reasons about what's known and what's missing
 * 2. Extracts new retrieval queries from the reasoning
 * 3. Recalls more memories with those queries
 * 4. Repeats until answer is ready or max iterations reached
 *
 * Expected improvement: Multi-hop 49.6% → 60-65% (+10-15pp)
 * Effort: Medium — requires response pipeline restructuring.
 */

import { createChildLogger } from '../core/logger';
import type { RecallOptions } from '../core/memory';

const log = createChildLogger('exp-ircot');

export type RecallFn = (opts: RecallOptions) => Promise<Array<{ id: number; summary: string; content?: string; _score: number; [key: string]: any }>>;
export type LLMCallFn = (systemPrompt: string, userMessage: string) => Promise<string>;

export interface IRCoTResult {
  memories: Array<{ id: number; summary: string; content?: string; _score: number; [key: string]: any }>;
  iterations: number;
  reasoningChain: string[];
  earlyStop: boolean;
}

/**
 * Run an IRCoT iterative retrieval loop for complex/multi-hop queries.
 */
export async function runIRCoT(
  originalQuery: string,
  initialMemories: Array<{ id: number; summary: string; content?: string; _score: number; [key: string]: any }>,
  recallFn: RecallFn,
  llmCallFn: LLMCallFn,
  opts: {
    maxSteps?: number;
    recallLimit?: number;
    baseRecallOpts?: Partial<RecallOptions>;
  } = {},
): Promise<IRCoTResult> {
  const maxSteps = opts.maxSteps ?? 3;
  const recallLimit = opts.recallLimit ?? 5;

  const allMemories = [...initialMemories];
  const seenIds = new Set(initialMemories.map(m => m.id));
  const reasoningChain: string[] = [];
  let earlyStop = false;

  for (let step = 0; step < maxSteps; step++) {
    const contextSummary = allMemories
      .map((m, i) => `[${i + 1}] ${m.summary}`)
      .join('\n');

    const reasoning = await llmCallFn(
      IRCOT_REASONING_PROMPT,
      `Original question: ${originalQuery}\n\nRetrieved context:\n${contextSummary}\n\nIteration: ${step + 1}/${maxSteps}`,
    );

    reasoningChain.push(reasoning);

    const queries = extractQueries(reasoning);

    if (queries.length === 0) {
      log.info({ step: step + 1, reason: 'no_new_queries' }, 'IRCoT early stop');
      earlyStop = true;
      break;
    }

    let newMemoriesThisStep = 0;
    for (const query of queries.slice(0, 3)) {
      try {
        const newMemories = await recallFn({
          query,
          limit: recallLimit,
          trackAccess: true,
          ...opts.baseRecallOpts,
        });

        for (const mem of newMemories) {
          if (!seenIds.has(mem.id)) {
            allMemories.push(mem);
            seenIds.add(mem.id);
            newMemoriesThisStep++;
          }
        }
      } catch (err) {
        log.debug({ err, query: query.slice(0, 80) }, 'IRCoT sub-query recall failed');
      }
    }

    log.info({
      step: step + 1,
      queries: queries.length,
      newMemories: newMemoriesThisStep,
      totalMemories: allMemories.length,
    }, 'IRCoT iteration complete');

    if (newMemoriesThisStep === 0) {
      log.info({ step: step + 1, reason: 'no_new_memories' }, 'IRCoT early stop');
      earlyStop = true;
      break;
    }
  }

  return {
    memories: allMemories,
    iterations: reasoningChain.length,
    reasoningChain,
    earlyStop,
  };
}

/**
 * Detect whether a query likely requires multi-hop reasoning.
 */
export function isMultiHopQuery(query: string): boolean {
  const lower = query.toLowerCase();

  if (/what did .+ say about .+/.test(lower)) return true;
  if (/how does .+ relate to .+/.test(lower)) return true;
  if (/compare .+ (?:with|and|to) .+/.test(lower)) return true;
  if (/after .+(?:,| ) (?:what|how|did|who)/.test(lower)) return true;
  if (/before .+ (?:what|how|did|who)/.test(lower)) return true;
  if (/since .+ (?:what|how|has)/.test(lower)) return true;
  if (/how (?:many|often|much) (?:times?|did)/.test(lower)) return true;

  const words = query.split(/\s+/);
  const capitalWords = words.filter(w => /^[A-Z][a-z]+$/.test(w));
  if (capitalWords.length >= 2) return true;

  if (lower.includes(' and ') && lower.includes('?')) return true;

  return false;
}

function extractQueries(reasoning: string): string[] {
  const queries: string[] = [];

  const queryLines = reasoning.match(/^QUERY:\s*(.+)$/gim);
  if (queryLines) {
    for (const line of queryLines) {
      const q = line.replace(/^QUERY:\s*/i, '').trim();
      if (q.length >= 2) queries.push(q);
    }
  }

  if (/^SUFFICIENT$/im.test(reasoning)) {
    return [];
  }

  return queries;
}

const IRCOT_REASONING_PROMPT = `You are a retrieval reasoning agent. Given a question and retrieved context, determine if you have enough information to answer, or if you need to look up more.

Respond in this exact format:

THINKING: [1-2 sentences about what you know and what's missing]

Then EITHER:
- If you have enough: write "SUFFICIENT" on its own line
- If you need more: write one or more "QUERY: [search query]" lines (max 3)

QUERY lines should be specific search terms that would find the missing information in a memory database. Focus on:
- Named entities (people, projects, tokens)
- Specific events or dates
- Facts that would connect the evidence you already have

Do NOT repeat queries that would return the same memories you already have.
Do NOT write anything else after SUFFICIENT or QUERY lines.`;
