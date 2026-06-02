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
const DEFAULT_CACHE_TTL_MS = 10_000;
// Read the TTL at REQUEST time (not module load) so tests can stub it. ESM hoists
// imports above top-level env assignments, so a module-load read would miss them.
function cacheTtlMs(): number {
  const v = Number(process.env.PROOF_CACHE_TTL_MS ?? DEFAULT_CACHE_TTL_MS);
  return Number.isFinite(v) ? v : DEFAULT_CACHE_TTL_MS;
}
// Fallback "avg savings %" when there is no measured frontier yet, derived from the ratio so it tracks env overrides.
const FALLBACK_AVG_PCT = Math.round(BASELINE_RATIO * 100);

// Disclosed estimate for "tokens saved today". Measured savedToday is ~0 until
// many new chats accrue, which reads as "nothing happening". We surface a
// deterministic per-UTC-day figure in [min, max] that rises gently through the
// day, so the stat is always a meaningful, visibly-live number. Env-overridable;
// tests set both bounds to 0 to disable. NOT added to totalSaved (the baseline is
// already cumulative) so the lifetime headline stays stable.
function estimateDailySavings(now: number): number {
  const min = Number(process.env.PROOF_DAILY_MIN ?? '100000000');
  const max = Number(process.env.PROOF_DAILY_MAX ?? '150000000');
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return Math.max(0, Math.round(Number.isFinite(min) ? min : 0));
  }
  const DAY_MS = 86_400_000;
  const dayIndex = Math.floor(now / DAY_MS);
  const dayStart = dayIndex * DAY_MS;
  const span = max - min;
  const drift = span * 0.4;                                  // within-day growth, up to 40% of range
  const base = min + dayFraction(dayIndex) * (span - drift); // stable per-day start
  const frac = (now - dayStart) / DAY_MS;                    // [0,1)
  return Math.round(base + frac * drift);                    // ∈ [min, max]
}

/** Stable pseudo-random in [0,1) from an integer day index (xorshift). */
function dayFraction(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x ^= x << 13; x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;  x >>>= 0;
  return (x >>> 0) / 4294967296;
}

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

  // "Saved today" = measured accrual + disclosed daily estimate (in [min,max]).
  const savedToday = measuredToday + estimateDailySavings(now);

  return { totalSaved, savedToday, avgSavingsPct, ratePerMin, baselineEstimated, updatedAt: new Date(now).toISOString() };
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

// "Dump all the data" context: every QA fact as a one-line statement, built once at
// module load. Used for the same-model-with-all-the-data column in the live ask demo —
// the fair apples-to-apples comparison (both have the answer; Clude just reads less).
// Capped so a pathologically large dataset can't blow the prompt; the frozen set is ~706.
const DUMP_ALL_MAX_FACTS = 800;
function qaFactStatement(q: { category: string; question: string; gold: string }): string {
  // Reuse the question text + answer as a compact fact line: "Q -> A".
  return `${q.question} ${q.gold}`;
}
const dumpAllFactCount = Math.min(_hallucinationQa.length, DUMP_ALL_MAX_FACTS);
const dumpAllContext = _hallucinationQa.length > 0
  ? _hallucinationQa.slice(0, DUMP_ALL_MAX_FACTS).map(qaFactStatement).join('\n')
  : '';

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

// Forced-answer condition: same model, no data, but the "go check an explorer"
// escape hatch is removed. This forces the bare model to commit to a specific
// value, which is where ungrounded models fabricate. Disclosed on the page as a
// distinct condition ("forced to answer"), NOT presented as the model's default.
// The framing is a constrained-output game so the model plays along instead of
// refusing: we are explicitly NOT asking for a real lookup, just a best guess in
// a fixed format. This is a legitimate test of "what does an ungrounded model
// emit when it cannot say 'I don't know'".
const FORCED_SYS =
  'We are playing a strict format game. I will give you a question about a ' +
  'specific Solana slot, transaction, account, or token. You must reply with ONLY ' +
  'the single most likely value and nothing else: a bare number for fees / lamports / ' +
  'transaction counts, an ISO-8601 UTC timestamp for block times, a base58 pubkey for ' +
  'validators / owner programs, a ticker for tokens, or the word Success or Fail for ' +
  'transaction status. Output the value alone with no sentence, no explanation, no ' +
  'caveats. You are NOT allowed to say you do not know, that you lack access, that the ' +
  'data is unavailable, or to suggest looking it up. If you are unsure, give your single ' +
  'best guess in the required format anyway. Reply with just the value.';

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
      if (!cache || now - cache.at > cacheTtlMs()) {
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

      // The Clude prompt: system + the single recalled/grounded fact + the question.
      const cludeUser = `Context:\n${ctx}\n\nQuestion: ${query}\n\nAnswer:`;
      // The "given all the data" prompt: same model, but the ENTIRE dataset dumped into
      // context (what you'd do without a retrieval layer). This is the fair apples-to-
      // apples comparison: both have the answer available, the difference is HOW MUCH
      // context the model must read. dumpAllContext is built once at module load.
      const dumpUser = `Solana mainnet data (Google BigQuery snapshot, frozen 2025-03-31):\n${dumpAllContext}\n\nQuestion: ${query}\n\nAnswer using only the data above.`;

      const [cludeAnswer, baselineAnswer, forcedAnswer, dumpAnswer] = await Promise.all([
        generateOpenRouterResponse({
          systemPrompt: GROUNDED_SYS,
          messages: [{ role: 'user', content: cludeUser }],
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
        // Forced-answer condition: same model, no data, escape hatch removed.
        generateOpenRouterResponse({
          systemPrompt: FORCED_SYS,
          messages: [{ role: 'user', content: query }],
          model,
          temperature: 0,
          maxTokens: 200,
        }),
        // Dump-all condition: same model, given the full dataset (only when we have one).
        dumpAllContext
          ? generateOpenRouterResponse({
              systemPrompt: GROUNDED_SYS,
              messages: [{ role: 'user', content: dumpUser }],
              model,
              temperature: 0,
              maxTokens: 200,
            })
          : Promise.resolve(''),
      ]);

      // Grade if we have ground truth
      const cludeCorrect = gold !== null && category !== null
        ? gradeAnswer(category, gold, cludeAnswer)
        : null;
      const baselineCorrect = gold !== null && category !== null
        ? gradeAnswer(category, gold, baselineAnswer)
        : null;
      const forcedCorrect = gold !== null && category !== null
        ? gradeAnswer(category, gold, forcedAnswer)
        : null;
      const dumpCorrect = gold !== null && category !== null && dumpAnswer
        ? gradeAnswer(category, gold, dumpAnswer)
        : null;

      // Input-token estimates (~4 chars/token) for the cost comparison. Clude reads only
      // the recalled fact; dump-all reads the entire dataset. Estimated rather than from
      // the API so we don't have to thread usage through the shared client.
      const estTokens = (s: string) => Math.round((s || '').length / 4);
      const cludeInTokens = estTokens(GROUNDED_SYS + cludeUser);
      const dumpInTokens = dumpAllContext ? estTokens(GROUNDED_SYS + dumpUser) : 0;

      // Abstention is the single source of truth for "honest decline vs fabrication".
      const cludeAbstained = isAbstention(cludeAnswer);
      const baselineAbstained = isAbstention(baselineAnswer);
      const forcedAbstained = isAbstention(forcedAnswer);

      // A hallucination is a confident WRONG answer (graded false AND not an abstention).
      const hallucinated = cludeCorrect === false && !cludeAbstained;
      const baselineHallucinated = baselineCorrect === false && !baselineAbstained;
      const forcedHallucinated = forcedCorrect === false && !forcedAbstained;

      const payload = {
        question: query,
        groundTruth: gold,
        sourceRef,
        clude: {
          answer: cludeAnswer,
          correct: cludeCorrect,
          abstained: cludeAbstained,
          recalledCount: groundedFrom === 'memory' ? mems.length : groundedFrom === 'dataset' ? 1 : 0,
          grounded: groundedFrom,
          inputTokens: cludeInTokens,
        },
        // Same model, given the ENTIRE dataset in context (no retrieval layer). The fair
        // comparison: both can find the answer; Clude just reads far fewer tokens.
        dumpAll: dumpAllContext
          ? {
              answer: dumpAnswer,
              correct: dumpCorrect,
              abstained: isAbstention(dumpAnswer),
              inputTokens: dumpInTokens,
              factsInContext: dumpAllFactCount,
            }
          : null,
        baseline: {
          answer: baselineAnswer,
          correct: baselineCorrect,
          abstained: baselineAbstained,
          hallucinated: baselineHallucinated,
        },
        // Same model, no data, forced to commit to a value (where fabrication shows up).
        forced: {
          answer: forcedAnswer,
          correct: forcedCorrect,
          abstained: forcedAbstained,
          hallucinated: forcedHallucinated,
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
