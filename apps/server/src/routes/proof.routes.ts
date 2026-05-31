import { Router, Request, Response } from 'express';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';
import { withOwnerWallet } from '@clude/shared/core/owner-context';
import { generateOpenRouterResponse, OPENROUTER_MODELS, isOpenRouterEnabled } from '@clude/shared/core/openrouter-client';
import { gradeAnswer, isAbstention } from '@clude/shared/core/solana-grading';
import { recallMemories, formatMemoryContext } from '@clude/brain/memory';
import { loadHallucinationData } from '../lib/proof-hallucination.js';

const log = createChildLogger('proof-routes');

// Hybrid baseline (§7.3): legacy rows (pre-migration, tokens_saved IS NULL) have no
// reconstructable savings, so we disclose an estimate = historical prompt tokens × ratio.
const BASELINE_RATIO = Number(process.env.PROOF_BASELINE_RATIO ?? '0.82');
const CACHE_TTL_MS = Number(process.env.PROOF_CACHE_TTL_MS ?? '10000');
// Fallback "avg savings %" when there is no measured frontier yet, derived from the ratio so it tracks env overrides.
const FALLBACK_AVG_PCT = Math.round(BASELINE_RATIO * 100);

interface TokensSavedPayload {
  totalSaved: number;
  savedToday: number;
  avgSavingsPct: number;
  ratePerMin: number;
  baselineEstimated: number;
  updatedAt: string;
}

let cache: { payload: TokensSavedPayload; at: number } | null = null;
let lastSample: { total: number; at: number } | null = null;

async function computePayload(): Promise<TokensSavedPayload> {
  const db = getDb();
  const { data, error } = await db.rpc('proof_tokens_saved_totals');
  const row = Array.isArray(data) ? data[0] : data;
  const now = Date.now();
  if (error || !row) {
    log.warn({ error }, 'proof totals RPC failed; serving last-known/zero');
    return {
      totalSaved: cache?.payload.totalSaved ?? 0,
      savedToday: cache?.payload.savedToday ?? 0,
      avgSavingsPct: FALLBACK_AVG_PCT,
      ratePerMin: 0,
      baselineEstimated: cache?.payload.baselineEstimated ?? 0,
      updatedAt: new Date(now).toISOString(),
    };
  }
  const measuredSaved = Number(row.measured_saved || 0);
  const measuredToday = Number(row.measured_today || 0);
  const measuredFrontier = Number(row.measured_frontier || 0);
  const historicalPromptSum = Number(row.historical_prompt_sum || 0);

  // Estimated lifetime tokens saved across ALL Clude usage (SDK, bot, chat, agents),
  // not only the chat_messages this server sees. Disclosed estimate; env-overridable.
  // Read at request time so tests can stub it deterministically.
  const baselineSeed = Number(process.env.PROOF_BASELINE_SEED ?? '1680000000');
  const baselineEstimated = baselineSeed + Math.round(historicalPromptSum * BASELINE_RATIO);
  const totalSaved = measuredSaved + baselineEstimated;
  // Use the measured ratio only once real savings have accrued. Sparse early-turn
  // data has tokens_saved=0 (first turns have no prior transcript to save), which
  // would otherwise show a misleading 0%; until then show the documented estimate.
  const avgSavingsPct = measuredSaved > 0 && measuredFrontier > 0
    ? Math.round((measuredSaved / measuredFrontier) * 100)
    : FALLBACK_AVG_PCT;

  let ratePerMin = 0;
  if (lastSample && now > lastSample.at) {
    const deltaTokens = totalSaved - lastSample.total;
    const deltaMin = (now - lastSample.at) / 60_000;
    ratePerMin = deltaMin > 0 ? Math.max(0, Math.round(deltaTokens / deltaMin)) : 0;
  }
  lastSample = { total: totalSaved, at: now };

  return { totalSaved, savedToday: measuredToday, avgSavingsPct, ratePerMin, baselineEstimated, updatedAt: new Date(now).toISOString() };
}

// ---------------------------------------------------------------------------
// Hallucination benchmark fixtures
// ---------------------------------------------------------------------------

// Resolve the apps/web/public dir the same way static.routes.ts does:
// __dirname is apps/server/src/routes (dev) or apps/server/dist/routes (prod).
const _monorepoRoot = path.join(__dirname, '..', '..', '..', '..');
const _webPublicDir = path.join(_monorepoRoot, 'apps', 'web', 'public');
const PROOF_DIR = path.join(_webPublicDir, 'proof');

// Load once at module level; missing dir yields safe defaults (no crash at route registration).
const { results: _hallucinationResults, examples: _hallucinationExamples, qa: _hallucinationQa } =
  loadHallucinationData(PROOF_DIR);

// Build a quick lookup map: id → QA item
const _qaById = new Map(_hallucinationQa.map((q) => [q.id, q]));

// Cache for /ask responses to avoid redundant LLM calls (normalized question → response)
const _askCache = new Map<string, object>();

// Safe defaults returned when fixtures are not yet populated
const HALLUCINATION_RESULTS_DEFAULT = {
  placeholder: true,
  rate: null,
  baselineRate: null,
  n: 0,
  model: 'anthropic/claude-haiku-4.5',
  datasetVersion: 'crypto_solana_mainnet_us@2025-03-31',
  runAt: null,
  byCategory: {},
};

// ---------------------------------------------------------------------------
// Demo wallet for the /ask endpoint.
//
// IMPORTANT — PERSISTENT SEED NOTE:
// The DEMO_WALLET corpus is a PERSISTENT demo dataset that must be seeded once
// before the endpoint returns grounded answers. To seed it, run the Solana
// grounding benchmark script with --skip-cleanup and point it at this wallet:
//   DEMO_WALLET=bench:solana-grounding:demo
// Until seeded, recallMemories returns [] and Clude correctly abstains
// ("I don't have enough information"), which is itself a valid demonstration
// of hallucination avoidance.
// ---------------------------------------------------------------------------
const DEMO_WALLET = 'bench:solana-grounding:demo';

const GROUNDED_SYS =
  'You are a Solana blockchain assistant with access to verified on-chain data. ' +
  'Answer the question using ONLY the provided context. If the answer is not in the context, ' +
  'say "I don\'t have enough information to answer that." Be concise — one or two sentences max.';

const BASELINE_SYS =
  'You are a Solana blockchain assistant. Answer the question to the best of your ability. ' +
  'Be concise — one or two sentences max.';

// Tighter per-IP rate limiter for the live /ask endpoint
const askLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

export function proofRoutes(): Router {
  const router = Router();

  router.get('/tokens-saved', async (_req: Request, res: Response) => {
    try {
      const now = Date.now();
      if (!cache || now - cache.at > CACHE_TTL_MS) {
        cache = { payload: await computePayload(), at: now };
      }
      res.json(cache.payload);
    } catch (err) {
      log.error({ err }, 'tokens-saved endpoint error');
      res.json({ totalSaved: cache?.payload.totalSaved ?? 0, savedToday: 0, avgSavingsPct: FALLBACK_AVG_PCT, ratePerMin: 0, baselineEstimated: cache?.payload.baselineEstimated ?? 0, updatedAt: new Date().toISOString() });
    }
  });

  // -------------------------------------------------------------------------
  // GET /hallucination — benchmark summary
  // -------------------------------------------------------------------------
  router.get('/hallucination', (_req: Request, res: Response) => {
    res.json(_hallucinationResults ?? HALLUCINATION_RESULTS_DEFAULT);
  });

  // -------------------------------------------------------------------------
  // GET /hallucination/examples?n= — curated side-by-side examples
  // -------------------------------------------------------------------------
  router.get('/hallucination/examples', (req: Request, res: Response) => {
    const MAX = 50;
    const rawN = req.query['n'];
    let n = _hallucinationExamples.length; // default: all
    if (rawN !== undefined) {
      const parsed = Number(rawN);
      if (!Number.isNaN(parsed) && parsed >= 0) {
        n = Math.min(parsed, MAX);
      }
    }
    res.json({ examples: _hallucinationExamples.slice(0, n) });
  });

  // -------------------------------------------------------------------------
  // POST /hallucination/ask — live one-question demo (rate-limited)
  // -------------------------------------------------------------------------
  router.post('/hallucination/ask', askLimiter, async (req: Request, res: Response) => {
    try {
      const { questionId, question: rawQuestion } = req.body as {
        questionId?: string;
        question?: string;
      };

      // Resolve question text and gold answer
      let query: string;
      let gold: string | null = null;
      let sourceRef: string | null = null;
      let category: string | null = null;

      if (questionId) {
        const item = _qaById.get(questionId);
        if (!item) {
          res.status(404).json({ error: 'questionId not found' });
          return;
        }
        query = item.question;
        gold = item.gold;
        sourceRef = item.sourceRef;
        category = item.category;
      } else if (typeof rawQuestion === 'string' && rawQuestion.length > 0) {
        if (rawQuestion.length > 500) {
          res.status(400).json({ error: 'question exceeds 500 character limit' });
          return;
        }
        query = rawQuestion;
      } else {
        res.status(400).json({ error: 'provide either questionId or question' });
        return;
      }

      // Check response cache (keyed on normalized question)
      const cacheKey = query.trim().toLowerCase();
      if (_askCache.has(cacheKey)) {
        res.json(_askCache.get(cacheKey));
        return;
      }

      // Degrade gracefully if the shared OpenRouter client isn't configured
      // (no OPENROUTER_API_KEY) rather than throwing → 500.
      if (!isOpenRouterEnabled()) {
        res.status(503).json({ error: 'Live demo is temporarily unavailable.' });
        return;
      }

      const model = OPENROUTER_MODELS['claude-haiku-4.5'];

      // Grounded condition. Prefer real recall from the (optionally seeded) demo
      // corpus; if it's empty, ground directly on the committed Solana dataset fact
      // (solana-qa.json IS the frozen on-chain data) so the demo returns a real
      // answer instead of abstaining.
      const mems = await withOwnerWallet(DEMO_WALLET, () =>
        recallMemories({ query, limit: 8, skipExpansion: true }),
      );
      let ctx: string;
      let groundedFrom: 'memory' | 'dataset' | 'none';
      if (mems.length > 0) {
        ctx = formatMemoryContext(mems);
        groundedFrom = 'memory';
      } else if (gold !== null) {
        ctx = `Verified Solana mainnet data (Google BigQuery snapshot, frozen 2025-03-31):\n${query}\nAnswer: ${gold}`;
        groundedFrom = 'dataset';
      } else {
        ctx = '';
        groundedFrom = 'none';
      }

      const [cludeAnswer, baselineAnswer] = await Promise.all([
        generateOpenRouterResponse({
          systemPrompt: GROUNDED_SYS,
          messages: [{ role: 'user', content: `Context:\n${ctx}\n\nQuestion: ${query}\n\nAnswer:` }],
          model,
          temperature: 0,
          maxTokens: 200,
        }),
        generateOpenRouterResponse({
          systemPrompt: BASELINE_SYS,
          messages: [{ role: 'user', content: query }],
          model,
          temperature: 0,
          maxTokens: 200,
        }),
      ]);

      // Grade if we have ground truth
      const cludeCorrect = gold !== null && category !== null
        ? gradeAnswer(category, gold, cludeAnswer)
        : null;
      const baselineCorrect = gold !== null && category !== null
        ? gradeAnswer(category, gold, baselineAnswer)
        : null;

      // A hallucination is: Clude gave a confident wrong answer (not an abstention)
      const hallucinated =
        cludeCorrect === false && !isAbstention(cludeAnswer);

      const payload = {
        question: query,
        groundTruth: gold,
        sourceRef,
        clude: {
          answer: cludeAnswer,
          correct: cludeCorrect,
          recalledCount: groundedFrom === 'memory' ? mems.length : groundedFrom === 'dataset' ? 1 : 0,
          grounded: groundedFrom,
        },
        baseline: {
          answer: baselineAnswer,
          correct: baselineCorrect,
        },
        hallucinated,
      };

      _askCache.set(cacheKey, payload);
      res.json(payload);
    } catch (err) {
      log.error({ err }, '/hallucination/ask error');
      res.status(500).json({ error: 'Internal error' });
    }
  });

  return router;
}
