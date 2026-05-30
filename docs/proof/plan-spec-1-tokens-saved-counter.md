# Spec 1 — Proof API + Live "Tokens Saved to Date" Counter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist per-message token savings, expose a cached global "tokens saved to date" total via `GET /api/proof/tokens-saved`, and render a live-ticking counter on the dashboard, chat, and public landing hero.

**Architecture:** One backend source of truth (a new `proof.routes.ts` + a Postgres totals RPC + server-side cache) feeds three thin, per-app renderers (dashboard React card, chat topbar chip, web hero signal stat). Savings are computed at the chat-message insert site from the prior conversation a memoryless agent would re-send, and the same value powers the existing per-message footer so chat numbers and the global counter agree. Counter = measured (real, post-migration) + a disclosed historical estimate (hybrid baseline).

**Tech Stack:** TypeScript (ESM/NodeNext), Express, Supabase REST (`getDb()`), Postgres RPC, Vitest 4 (server), React 19 (dashboard/chat), static React-UMD + Babel (web).

**Spec:** `docs/proof/proof-features-design.md` (§4, §6, §7). This plan implements **Spec 1** only.

**Conventions to honor:** named exports; Pino via `createChildLogger` (no `console.log` in `src/`); Zod/guards at boundaries; owner scoping is irrelevant here (the counter is a global aggregate of non-PII token counts only — never returns memory content); conventional commits `type(scope): ...`; target `staging` for PRs (see `CLAUDE.md`). Migrations are applied to Supabase via the Dashboard by a human (per `MEMORY.md`), and the in-code `initDatabase()` block must be kept in sync.

---

## File Structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `packages/database/migrations/026_proof_token_savings.sql` | **Create** | Add `frontier_tokens`/`memories_used`/`tokens_saved` to `chat_messages`; add partial index; add `proof_tokens_saved_totals()` RPC |
| `packages/shared/src/core/database.ts` | Modify (~611–622) | Sync the `CREATE TABLE IF NOT EXISTS chat_messages` block with the 3 new columns + index (fresh-DB parity) |
| `apps/server/src/lib/proof-savings.ts` | **Create** | Pure `computeSavings()` helper (frontier + saved math) — the unit-tested core |
| `apps/server/src/lib/__tests__/proof-savings.test.ts` | **Create** | TDD unit tests for `computeSavings()` |
| `apps/server/src/routes/chat.routes.ts` | Modify (~1010, ~1186–1205, ~1262–1271) | Compute `priorTurnsTokens` once; persist the 3 columns in the assistant insert; align the streamed `frontier_tokens` (footer) to the same value |
| `apps/server/src/routes/proof.routes.ts` | **Create** | `GET /api/proof/tokens-saved` — calls the RPC, caches, computes `ratePerMin` + hybrid baseline |
| `apps/server/src/routes/__tests__/proof-routes.test.ts` | **Create** | TDD route tests (shape, baseline math, cache) |
| `apps/server/src/routes/index.ts` | Modify | Mount `app.use('/api/proof', proofRoutes())` |
| `apps/dashboard/src/lib/api.ts` | Modify | `getTokensSaved()` method |
| `apps/dashboard/src/pages/Dashboard.tsx` | Modify | New "Tokens saved" stat card + grid area + poll |
| `apps/chat/src/lib/api.ts` | Modify | `getTokensSaved()` method |
| `apps/chat/src/v2/CcChat.tsx` | Modify | Fetch to-date total, pass to topbar |
| `apps/chat/src/v2/CcTopbar.tsx` + `atoms.tsx` | Modify | Render an "all-time" saved chip beside the existing today chip |
| `apps/web/public/app.jsx` | Modify (~52–95, ~628–649) | Fetch + render a 4th `.hero__signal` stat |

~13 files. If the combined diff exceeds the repo's 400-line guidance, ship **Phase A (backend, Tasks 1–5)** and **Phase B (frontends, Tasks 6–9)** as two PRs to `staging`. Phase A is independently shippable and testable.

---

## PHASE A — Backend

### Task 1: Migration 026 — columns + totals RPC

**Files:**
- Create: `packages/database/migrations/026_proof_token_savings.sql`
- Modify: `packages/shared/src/core/database.ts:611-622`

- [ ] **Step 1: Write the migration SQL**

Create `packages/database/migrations/026_proof_token_savings.sql`:

```sql
-- 026: persist per-message token savings on chat_messages + totals RPC for the
-- public "tokens saved to date" counter (proof-features §6/§7). Additive.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS frontier_tokens INTEGER;  -- full transcript a memoryless agent re-sends this turn (prior turns + this prompt)
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS memories_used   INTEGER;  -- count of recalled memories used this turn (= memory_ids length)
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS tokens_saved    INTEGER;  -- max(0, frontier_tokens - tokens_prompt); NULL on pre-migration (legacy) rows

CREATE INDEX IF NOT EXISTS idx_chat_msg_saved ON chat_messages(created_at) WHERE tokens_saved IS NOT NULL;

-- Totals for the proof counter. measured_* cover rows with tokens_saved populated
-- (post-migration, real); historical_prompt_sum covers legacy rows (tokens_saved IS NULL)
-- for the disclosed hybrid baseline estimate (§7.3). One pass, no per-row fetch.
CREATE OR REPLACE FUNCTION proof_tokens_saved_totals()
RETURNS TABLE(
  measured_saved        bigint,
  measured_today        bigint,
  measured_frontier     bigint,
  historical_prompt_sum bigint,
  n                     bigint
) LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(SUM(tokens_saved)    FILTER (WHERE tokens_saved IS NOT NULL), 0)::bigint,
    COALESCE(SUM(tokens_saved)    FILTER (WHERE tokens_saved IS NOT NULL AND created_at >= date_trunc('day', now())), 0)::bigint,
    COALESCE(SUM(frontier_tokens) FILTER (WHERE tokens_saved IS NOT NULL), 0)::bigint,
    COALESCE(SUM(tokens_prompt)   FILTER (WHERE tokens_saved IS NULL), 0)::bigint,
    COUNT(*)                      FILTER (WHERE tokens_saved IS NOT NULL)::bigint
  FROM chat_messages;
$$;
```

- [ ] **Step 2: Sync the in-code schema block**

In `packages/shared/src/core/database.ts`, the `CREATE TABLE IF NOT EXISTS chat_messages (...)` block (lines 611–622) must gain the 3 columns so a fresh `initDatabase()` matches the migration. Add the three columns after `memory_ids INTEGER[],` and add the index + a guarded `CREATE OR REPLACE FUNCTION proof_tokens_saved_totals()` (same body as Step 1) after the existing `idx_chat_msg_conv` index. Match the surrounding SQL-in-template-string style exactly.

- [ ] **Step 3: Verify the SQL parses (local sanity)**

Run: `psql "$SUPABASE_DB_URL" -f packages/database/migrations/026_proof_token_savings.sql` if a local/staging DB URL is available; otherwise paste into the Supabase SQL editor's "explain" or run against a scratch DB. Expected: no errors; `SELECT * FROM proof_tokens_saved_totals();` returns one row of zeros (or current totals).

> NOTE: raw SQL migrations have no Vitest coverage in this repo. Application to staging/prod Supabase is a **human step via the Dashboard** (per `MEMORY.md`). Flag in the PR description that migration 026 must be applied before the endpoint returns non-zero measured values.

- [ ] **Step 4: Commit**

```bash
git add packages/database/migrations/026_proof_token_savings.sql packages/shared/src/core/database.ts
git commit -m "feat(database): migration 026 — chat_messages token-savings columns + totals RPC"
```

---

### Task 2: Pure savings helper (TDD)

REQUIRED SUB-SKILL: @superpowers:test-driven-development

**Files:**
- Create: `apps/server/src/lib/proof-savings.ts`
- Test: `apps/server/src/lib/__tests__/proof-savings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/lib/__tests__/proof-savings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeSavings } from '../proof-savings.js';

describe('computeSavings', () => {
  it('first turn (no prior history) saves nothing', () => {
    expect(computeSavings({ priorTurnsTokens: 0, tokensPrompt: 1800 }))
      .toEqual({ frontierTokens: 1800, tokensSaved: 0 });
  });

  it('high-usage turn: saved equals the prior transcript a memoryless agent re-sends', () => {
    // 50k of prior history, this turn's actual prompt only 2k → 50k saved, 52k frontier baseline
    expect(computeSavings({ priorTurnsTokens: 50000, tokensPrompt: 2000 }))
      .toEqual({ frontierTokens: 52000, tokensSaved: 50000 });
  });

  it('never returns negative and coerces missing/garbage inputs to 0', () => {
    expect(computeSavings({ priorTurnsTokens: -5, tokensPrompt: NaN }))
      .toEqual({ frontierTokens: 0, tokensSaved: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && npm test -- src/lib/__tests__/proof-savings.test.ts`
Expected: FAIL — `Cannot find module '../proof-savings.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/server/src/lib/proof-savings.ts`:

```ts
/**
 * Token-savings accounting for the proof counter (proof-features §7.1).
 *
 * frontierTokens = the full transcript a memoryless agent carries into this turn
 *                  (all prior turns it must re-send + this turn's actual prompt).
 * tokensSaved    = frontierTokens − cludeContext, where cludeContext is this turn's
 *                  actual prompt (completion is equal across both scenarios, so it
 *                  cancels). This reduces to priorTurnsTokens and grows with the
 *                  conversation — ~82% on high-usage sessions.
 */
export function computeSavings(input: {
  priorTurnsTokens: number;
  tokensPrompt: number;
}): { frontierTokens: number; tokensSaved: number } {
  const prior = Math.max(0, Number.isFinite(input.priorTurnsTokens) ? input.priorTurnsTokens : 0);
  const prompt = Math.max(0, Number.isFinite(input.tokensPrompt) ? input.tokensPrompt : 0);
  const frontierTokens = prior + prompt;
  const tokensSaved = Math.max(0, frontierTokens - prompt);
  return { frontierTokens, tokensSaved };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/server && npm test -- src/lib/__tests__/proof-savings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/lib/proof-savings.ts apps/server/src/lib/__tests__/proof-savings.test.ts
git commit -m "feat(server): computeSavings helper for proof token counter (TDD)"
```

---

### Task 3: Persist savings + align footer in chat.routes.ts

**Files:**
- Modify: `apps/server/src/routes/chat.routes.ts` (compute prior turns; persist 3 columns at ~1262; align streamed `frontier_tokens` at ~1202)

This wires the pure helper into the live handler. `conversationId`, `memoryIds`, `tokensPrompt`, `db` are all in scope (verified). The handler streams first (the `messageMetadata` callback at ~1186 computes the footer's `frontier_tokens`) then inserts post-stream (~1262). We compute `priorTurnsTokens` ONCE before streaming and reuse it in both places so footer and persisted value agree.

- [ ] **Step 1: Add the prior-turns query + import**

Near the top of the file, add the import (match the existing `.js` ESM style):
```ts
import { computeSavings } from '../lib/proof-savings.js';
```
After `conversationId` is known and `db` is obtained (before the stream starts — co-locate with where conversation history is loaded), add:
```ts
// Prior assistant turns = the transcript a memoryless agent would re-send each turn.
// Indexed by idx_chat_msg_conv. Summed once and reused for both the footer and the persisted total.
let priorTurnsTokens = 0;
try {
  const { data: priorRows } = await db
    .from('chat_messages')
    .select('tokens_prompt, tokens_completion')
    .eq('conversation_id', conversationId)
    .eq('role', 'assistant');
  priorTurnsTokens = (priorRows || []).reduce(
    (s: number, r: any) => s + (r.tokens_prompt || 0) + (r.tokens_completion || 0),
    0,
  );
} catch { /* non-fatal: savings degrades to this-turn-only */ }
```

- [ ] **Step 2: Align the streamed footer `frontier_tokens` (~1202–1205)**

Replace the `AVG_TOKENS_PER_RECALLED_MEMORY`/`frontierTokens` block with the unified definition so the per-message footer matches the counter:
```ts
// Footer baseline: align with the persisted proof metric (proof-features §7.1).
const { frontierTokens } = computeSavings({ priorTurnsTokens, tokensPrompt });
```
Keep the returned `frontier_tokens: frontierTokens` and `frontier_model` fields as-is (the chat footer reads `frontier_tokens`). The old `300`-per-memory heuristic is removed.

- [ ] **Step 3: Persist the 3 columns in the assistant insert (~1262)**

Compute once just before `const dbOps = [...]` (uses the post-stream `tokensPrompt` at ~1230):
```ts
const { frontierTokens: persistedFrontier, tokensSaved } = computeSavings({ priorTurnsTokens, tokensPrompt });
```
Add three keys to the `db.from('chat_messages').insert({ ... })` object:
```ts
          frontier_tokens: persistedFrontier,
          memories_used: memoryIds.length,
          tokens_saved: tokensSaved,
```

- [ ] **Step 4: Typecheck + run the existing chat-routes tests (no regression)**

Run: `cd apps/server && npx tsc --noEmit && npm test -- src/routes/__tests__/`
Expected: typecheck clean; existing chat-routes tests still PASS. (The added insert keys and the prior-turns select are tolerated by the queue-Proxy mock; if a chat-routes test asserts an exact insert payload, update it to include the new keys.)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/chat.routes.ts
git commit -m "feat(server): persist token savings on chat_messages + align footer baseline"
```

---

### Task 4: proof.routes.ts — GET /api/proof/tokens-saved (TDD)

REQUIRED SUB-SKILL: @superpowers:test-driven-development

**Files:**
- Create: `apps/server/src/routes/proof.routes.ts`
- Test: `apps/server/src/routes/__tests__/proof-routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/routes/__tests__/proof-routes.test.ts` using the repo's queue-Proxy `getDb` mock + real `http.Server` + `fetch` (mirror `chat-routes-conversation.test.ts`). The RPC result arrives via `.then` (await), so push it onto the queue:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';

const mockDbQueue: Array<{ data: any; error?: any }> = [];
function dequeue() { return Promise.resolve(mockDbQueue.shift() ?? { data: null, error: null }); }
function chainBuilder(): any {
  const terminal = {
    single: () => dequeue(),
    then: (f: any, r: any) => dequeue().then(f, r),
  };
  return new Proxy(terminal, { get(t, p: string) { return p in t ? (t as any)[p] : () => chainBuilder(); } });
}
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('@clude/shared/core/database', () => ({
  getDb: () => ({ from: () => chainBuilder(), rpc: () => chainBuilder() }),
}));

import { proofRoutes } from '../proof.routes.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/proof', proofRoutes());
  return app;
}

describe('GET /api/proof/tokens-saved', () => {
  let server: Server; let baseUrl: string;
  beforeAll(async () => {
    await new Promise<void>((res) => { server = createTestApp().listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as any).port}`; res(); }); });
  });
  afterAll(async () => { await new Promise<void>((res) => server.close(() => res())); });
  beforeEach(() => { mockDbQueue.length = 0; });

  it('returns measured + hybrid-estimated total with the documented shape', async () => {
    // RPC row: 100k measured saved, 10k today, 120k frontier, 1,000,000 legacy prompt tokens, n=500
    mockDbQueue.push({ data: [{ measured_saved: 100000, measured_today: 10000, measured_frontier: 120000, historical_prompt_sum: 1000000, n: 500 }], error: null });
    const r = await fetch(`${baseUrl}/api/proof/tokens-saved`);
    const body = await r.json();
    expect(r.status).toBe(200);
    // baselineEstimated = round(1_000_000 * 0.82) = 820000 ; totalSaved = 100000 + 820000
    expect(body.baselineEstimated).toBe(820000);
    expect(body.totalSaved).toBe(920000);
    expect(body.savedToday).toBe(10000);
    expect(body.avgSavingsPct).toBe(83); // round(100000/120000*100)
    expect(typeof body.ratePerMin).toBe('number');
    expect(typeof body.updatedAt).toBe('string');
  });

  it('degrades to a safe payload when the RPC errors', async () => {
    mockDbQueue.push({ data: null, error: { message: 'boom' } });
    const r = await fetch(`${baseUrl}/api/proof/tokens-saved`);
    const body = await r.json();
    expect(r.status).toBe(200);
    expect(body.totalSaved).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && npm test -- src/routes/__tests__/proof-routes.test.ts`
Expected: FAIL — `Cannot find module '../proof.routes.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/server/src/routes/proof.routes.ts` (template: `demo.routes.ts`):

```ts
import { Router, Request, Response } from 'express';
import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('proof-routes');

// Hybrid baseline (§7.3): legacy rows (pre-migration, tokens_saved IS NULL) have no
// reconstructable savings, so we disclose an estimate = historical prompt tokens × ratio.
const BASELINE_RATIO = Number(process.env.PROOF_BASELINE_RATIO || '0.82');
const CACHE_TTL_MS = 10_000;

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
    const fallbackTotal = cache?.payload.totalSaved ?? 0;
    return {
      totalSaved: fallbackTotal, savedToday: 0, avgSavingsPct: 82,
      ratePerMin: 0, baselineEstimated: cache?.payload.baselineEstimated ?? 0,
      updatedAt: new Date(now).toISOString(),
    };
  }
  const measuredSaved = Number(row.measured_saved || 0);
  const measuredToday = Number(row.measured_today || 0);
  const measuredFrontier = Number(row.measured_frontier || 0);
  const historicalPromptSum = Number(row.historical_prompt_sum || 0);

  const baselineEstimated = Math.round(historicalPromptSum * BASELINE_RATIO);
  const totalSaved = measuredSaved + baselineEstimated;
  const avgSavingsPct = measuredFrontier > 0
    ? Math.round((measuredSaved / measuredFrontier) * 100)
    : 82;

  let ratePerMin = 0;
  if (lastSample && now > lastSample.at) {
    const deltaTokens = totalSaved - lastSample.total;
    const deltaMin = (now - lastSample.at) / 60_000;
    ratePerMin = deltaMin > 0 ? Math.max(0, Math.round(deltaTokens / deltaMin)) : 0;
  }
  lastSample = { total: totalSaved, at: now };

  return { totalSaved, savedToday: measuredToday, avgSavingsPct, ratePerMin, baselineEstimated, updatedAt: new Date(now).toISOString() };
}

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
      res.json({ totalSaved: cache?.payload.totalSaved ?? 0, savedToday: 0, avgSavingsPct: 82, ratePerMin: 0, baselineEstimated: cache?.payload.baselineEstimated ?? 0, updatedAt: new Date().toISOString() });
    }
  });

  return router;
}
```

> The route is public (no auth) and returns only aggregate, non-PII token counts — matching `handleInferenceStats` in `memory.routes.ts`. The TTL cache means the RPC runs at most once per 10s regardless of traffic.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/server && npm test -- src/routes/__tests__/proof-routes.test.ts`
Expected: PASS (2 tests). (Note: `ratePerMin` is 0 on the first call within a fresh module; the test only asserts its type.)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/proof.routes.ts apps/server/src/routes/__tests__/proof-routes.test.ts
git commit -m "feat(server): GET /api/proof/tokens-saved with cache + hybrid baseline (TDD)"
```

---

### Task 5: Mount the proof routes

**Files:**
- Modify: `apps/server/src/routes/index.ts`

- [ ] **Step 1: Confirm the mount file**

Run: `cd apps/server && rg -n "app.use\('/api/demo'" src/routes/index.ts`
Expected: a line `app.use('/api/demo', demoRoutes());` inside `mountApiRoutes`. (If absent, `rg -n "app.use\('/api/demo'" src` to locate the real aggregator and use that file instead.)

- [ ] **Step 2: Add the import + mount**

Add alongside the other route imports:
```ts
import { proofRoutes } from './proof.routes.js';
```
Add inside `mountApiRoutes`, near the other public read mounts (e.g. after `app.use('/api/account', accountRoutes());`):
```ts
app.use('/api/proof', proofRoutes());
```

- [ ] **Step 3: Typecheck + full server test suite (default pool — what CI uses)**

Run: `cd apps/server && npx tsc --noEmit && npm test`
Expected: typecheck clean; all suites PASS including the new `proof-routes` + `proof-savings` tests.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/routes/index.ts
git commit -m "feat(server): mount /api/proof routes"
```

- [ ] **Step 5: Live smoke (optional, if staging/local server reachable)**

Run: `curl -s https://cludebot-test-preview.up.railway.app/api/proof/tokens-saved | jq` (or localhost). Expected: JSON with `totalSaved`, `savedToday`, `avgSavingsPct`, `ratePerMin`, `baselineEstimated`, `updatedAt`.

---

## PHASE B — Frontend counters (thin renderers)

> Frontends are isolated apps with their own deps. There is no shared component — each renders the same `/api/proof/tokens-saved` payload in its own style. The dashboard/chat apps have limited automated UI tests; verify these with the **browse skill** (navigate, screenshot, assert the number renders and ticks). Use @superpowers:verification-before-completion before claiming done.

### Task 6: Dashboard stat card

**Files:**
- Modify: `apps/dashboard/src/lib/api.ts` (add method)
- Modify: `apps/dashboard/src/pages/Dashboard.tsx` (grid area, card, state, poll)

- [ ] **Step 1: Add the API method**

In `apps/dashboard/src/lib/api.ts`, add to the `CludeAPI` class (mirror `getInferenceStats`; the endpoint is global/public so no wallet scoping):
```ts
async getTokensSaved(): Promise<{ totalSaved: number; savedToday: number; avgSavingsPct: number; ratePerMin: number } | null> {
  try { return await this.fetch('/api/proof/tokens-saved'); } catch { return null; }
}
```

- [ ] **Step 2: Add state + grid area + card in `Dashboard.tsx`**

- Add state near the other `useState` hooks: `const [tokensSaved, setTokensSaved] = useState<number>(0);`
- Animate it: `const savedCount = useCounter(tokensSaved);`
- Add a `"savings"` area to `gridTemplateAreas` (lines ~465–470), e.g. replace `"agents  memories memories spark"` with `"agents  savings  memories spark"` (and adjust an adjacent area so the grid stays rectangular — verify columns sum correctly).
- Insert a new `<Card area="savings" delay={0.03}>` after the AGENTS card (~line 501), copying the AGENTS single-number structure: `SECTION_HEADER` label "Tokens saved", big number `{savedCount.toLocaleString()}`, sublabel `{avgSavingsPct}% avg · all-time`.
- In the initial `Promise.all` (~287) add `api.getTokensSaved().catch(() => null)` and set `tokensSaved`/avg from it; in the polling block (~319–358) add a `refreshTokensSaved` on the 30s interval.

- [ ] **Step 3: Typecheck + build**

Run: `cd apps/dashboard && npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 4: Verify in browser (browse skill)**

Start the dashboard dev server (or use the staging preview), navigate to `/`, screenshot. Expected: a "Tokens saved" card showing a non-zero animated number (assuming migration 026 applied + some chat usage). Assert the number is present and formatted.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/lib/api.ts apps/dashboard/src/pages/Dashboard.tsx
git commit -m "feat(dashboard): tokens-saved-to-date stat card"
```

---

### Task 7: Chat all-time chip

**Files:**
- Modify: `apps/chat/src/lib/api.ts` (method)
- Modify: `apps/chat/src/v2/atoms.tsx` (chip variant)
- Modify: `apps/chat/src/v2/CcTopbar.tsx` + `apps/chat/src/v2/CcChat.tsx` (fetch + render)

- [ ] **Step 1: Add the API method**

In `apps/chat/src/lib/api.ts` (base URL is `''`, same-origin; endpoint is public — use bare `fetch` like `getGuestStatus`):
```ts
async getTokensSaved(): Promise<{ totalSaved: number } | null> {
  try { const res = await fetch(`${API_BASE}/api/proof/tokens-saved`); if (!res.ok) return null; return res.json(); }
  catch { return null; }
}
```

- [ ] **Step 2: Add an "all-time" chip + render it**

- In `atoms.tsx`, add a sibling to `CcSavingsChip` (reuse `.cc-savedchip` CSS, change the label):
```tsx
export function CcSavedAllTimeChip({ saved }: { saved: number }) {
  return (
    <a className="cc-savedchip" href="/proof.html" title="Total tokens saved across Clude, to date">
      <span className="cc-savedchip__val">−{saved.toLocaleString()}</span>
      <span className="cc-savedchip__lbl">tok saved · all-time</span>
    </a>
  );
}
```
- In `CcChat.tsx`, add `const [savedAllTime, setSavedAllTime] = useState(0);` and a `useEffect` that calls `api.getTokensSaved()` on mount and every 30s, setting `savedAllTime` from `totalSaved`. Pass `savedAllTime` into `CcTopbar`.
- In `CcTopbar.tsx`, accept `savedAllTime?: number` and render `{savedAllTime > 0 && <CcSavedAllTimeChip saved={savedAllTime} />}` next to the existing today chip in `.cc-topbar__right`.

- [ ] **Step 3: Typecheck + build**

Run: `cd apps/chat && npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 4: Verify in browser (browse skill)** — open chat, confirm both the "today" and "all-time" chips render; the all-time chip links to `/proof.html`.

- [ ] **Step 5: Commit**

```bash
git add apps/chat/src/lib/api.ts apps/chat/src/v2/atoms.tsx apps/chat/src/v2/CcTopbar.tsx apps/chat/src/v2/CcChat.tsx
git commit -m "feat(chat): all-time tokens-saved chip in topbar"
```

---

### Task 8: Public landing hero signal

**Files:**
- Modify: `apps/web/public/app.jsx` (Hero + App; ~52–95, ~628–649)

The hero `.hero__signal` strip already shows 3 stats (incl. a hardcoded `1.96% HaluMem hallucination`). Add a 4th: live tokens saved.

- [ ] **Step 1: Fetch in `App` and pass down**

In `App` (uses `const { useState, useEffect } = React;`), add:
```jsx
const [tokensSaved, setTokensSaved] = useState(null);
useEffect(() => {
  let alive = true;
  const load = () => fetch('/api/proof/tokens-saved')
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (alive && d) setTokensSaved(d.totalSaved); })
    .catch(() => {});
  load();
  const t = setInterval(load, 30000);
  return () => { alive = false; clearInterval(t); };
}, []);
```
Pass `tokensSaved` to `<Hero tokensSaved={tokensSaved} />`.

- [ ] **Step 2: Render the 4th signal stat**

In `Hero({ tokensSaved })`, add inside `.hero__signal` (after the existing 3 divs):
```jsx
<div>
  <strong>{tokensSaved == null ? '…' : (tokensSaved >= 1e6 ? (tokensSaved/1e6).toFixed(1)+'M' : tokensSaved.toLocaleString())}</strong>
  Tokens saved · to date
</div>
```
(Inherits `.hero__signal` mono/tabular styling from `styles.css`; no CSS change needed.)

- [ ] **Step 3: Verify in browser (browse skill)** — load the landing page, confirm the 4th stat renders (shows `…` then the number once the API responds). No build step (static + in-browser Babel); just reload.

- [ ] **Step 4: Commit**

```bash
git add apps/web/public/app.jsx
git commit -m "feat(web): live tokens-saved stat in landing hero"
```

---

### Task 9: End-to-end verification + ship

REQUIRED SUB-SKILL: @superpowers:verification-before-completion

- [ ] **Step 1:** Confirm migration 026 is applied to the target Supabase (ask the human / check the Dashboard). Without it, `/api/proof/tokens-saved` returns measured=0 (baseline-only) and the chat insert will error on unknown columns — so this gate is mandatory before merging the chat.routes change to an environment.
- [ ] **Step 2:** With a server running against a migrated DB, send a few chat messages in a conversation, then `curl /api/proof/tokens-saved` and confirm `totalSaved`/`savedToday` increase and `avgSavingsPct` is plausible (rising toward ~82% on a long conversation).
- [ ] **Step 3:** Browse all three surfaces (landing, dashboard, chat) and confirm each shows the counter and that repeated loads tick upward.
- [ ] **Step 4:** Run the full server suite once more (`cd apps/server && npm test`) — green.
- [ ] **Step 5:** Ship via the `/ship` skill targeting `staging` (per CLAUDE.md). If the combined diff exceeds ~400 lines, ship Phase A and Phase B as separate PRs. PR description MUST note the migration-026-before-deploy requirement.

---

## Notes for the implementer
- **Migration ordering hazard:** the `chat.routes.ts` insert writes 3 new columns. If deployed before migration 026 is applied, every assistant message insert fails. Apply 026 first (and ideally guard rollout). This is the single most important sequencing constraint.
- **Footer change is intentional** (proof-features §7.1): the per-message "−N tok" footer now reflects the full-history baseline, so the numbers users see will jump up versus the old `300/memory` heuristic. Call this out in the PR.
- **`avgSavingsPct` is measured-only** (excludes the estimated baseline) so it can't be gamed by the seed.
- **No `console.log`** in server code — use the `log` child logger. **Named exports** only.
- If a sibling chat-routes test asserts the exact insert object, extend it with the 3 new keys (defensive-mock hygiene per `MEMORY.md`).
