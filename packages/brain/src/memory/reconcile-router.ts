import { config } from '@clude/shared/config';
import { createChildLogger } from '@clude/shared/core/logger';
import { generateOpenRouterResponse, isOpenRouterEnabled } from '@clude/shared/core/openrouter-client';

const log = createChildLogger('reconcile-router');

/**
 * Memory 3.0 C1 slice 1.5 — the LLM reconciliation router.
 *
 * Given a NEW fact and the owner's similar EXISTING facts, classify the relationship as
 * add / update / noop. Still SHADOW: the caller LOGS the op, never applies it.
 *
 * FAIL-SAFE TO ADD. A false `add` is a harmless duplicate; a false `update`/`noop` is a dropped
 * correct fact. So ANY deviation from a strictly-valid reply — parse error, wrong op string, a
 * targetId that is not one of the candidate ids we actually sent (a hallucinated / cross-tenant
 * id), an array/prose reply, or an API error — degrades to `add`. The model can only ever move a
 * decision toward supersession when it returns a clean op naming a real candidate.
 */

export type RouterOp = 'add' | 'update' | 'noop';

export interface RouterFact {
  id: number;
  summary: string;
  eventDate: string | null;
}

export interface RouterDecision {
  op: RouterOp;
  targetId: number | null;
  reason: string;
  model: string;
}

const ROUTER_SYSTEM =
  'You are a memory reconciliation classifier. Given a NEW fact and a list of EXISTING candidate ' +
  'facts that all belong to the SAME user, decide the relationship of the NEW fact to the ' +
  'candidates. Respond with ONLY a single JSON object, no prose, no markdown.\n' +
  'Format: {"op":"add"|"update"|"noop","targetId":<candidate id or null>,"reason":"<short>"}\n' +
  '- "noop": NEW states the SAME thing as candidate <targetId> (a duplicate). Set targetId.\n' +
  '- "update": NEW corrects or SUPERSEDES candidate <targetId> — same underlying fact, changed ' +
  'value or a newer date. Set targetId to that candidate id.\n' +
  '- "add": NEW is distinct from every candidate. targetId must be null.\n' +
  'When unsure, choose "add". NEVER invent a targetId that is not in the candidate list.';

function shortReason(x: unknown): string {
  return typeof x === 'string' ? x.slice(0, 200) : '';
}

/**
 * Strict validator. Returns a router-proposed op ONLY when the reply is a clean JSON object with a
 * valid op and (for update/noop) a targetId that is a member of `candidateIds`. Everything else →
 * add. Exported for direct unit testing.
 */
export function parseRouterReply(raw: string, candidateIds: Set<number>, model: string): RouterDecision {
  const fail = (reason: string): RouterDecision => ({ op: 'add', targetId: null, reason, model });

  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/); // tolerate a JSON object embedded in prose
    if (!m) return fail('router_parse_error');
    try { obj = JSON.parse(m[0]); } catch { return fail('router_parse_error'); }
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return fail('router_invalid_shape');

  const rec = obj as Record<string, unknown>;
  const op = rec.op;
  if (op !== 'add' && op !== 'update' && op !== 'noop') return fail('router_invalid_op');
  if (op === 'add') return { op: 'add', targetId: null, reason: shortReason(rec.reason), model };

  // update | noop MUST name a real candidate id (reject missing / non-numeric / hallucinated).
  const rawTarget = rec.targetId ?? rec.target_id;
  const targetId = typeof rawTarget === 'number' ? rawTarget : Number(rawTarget);
  if (!Number.isInteger(targetId) || !candidateIds.has(targetId)) return fail('router_invalid_target');
  return { op, targetId, reason: shortReason(rec.reason), model };
}

function buildPayload(newFact: { summary: string; eventDate: string | null }, candidates: RouterFact[]): string {
  const lines = candidates.map(
    (c) => `[id ${c.id}] date: ${c.eventDate ?? 'unknown'} — ${c.summary}`,
  );
  return (
    `NEW fact:\n  date: ${newFact.eventDate ?? 'unknown'} — ${newFact.summary}\n\n` +
    `Candidate facts:\n${lines.join('\n')}`
  );
}

/** True when the router may run: sub-flag on, a model configured, AND OpenRouter available. */
export function isRouterConfigured(): boolean {
  return config.memory.reconcileRouter && !!config.memory.reconcileModel && isOpenRouterEnabled();
}

// ── Per-owner soft daily budget (approximate, per-process) ──────────────────────────────────────
// Bounds LLM spend during the measurement window. Deliberately NOT a hard global cap: it is an
// in-memory per-process counter, so with N server instances the real cap is ~budget × N, and it is
// racy under a same-owner burst. That is acceptable for a shadow cost guardrail — precise spend
// accounting is not needed when the router is opt-in and nothing is applied.
let budgetDay = '';
const budgetByOwner = new Map<string, number>();
function utcDay(): string { return new Date().toISOString().slice(0, 10); }
function rollDay(): void {
  const d = utcDay();
  if (d !== budgetDay) { budgetDay = d; budgetByOwner.clear(); }
}
function budgetKey(owner: string | null): string { return owner ?? '__BOT_OWN__'; }

export function routerBudgetAvailable(owner: string | null): boolean {
  rollDay();
  return (budgetByOwner.get(budgetKey(owner)) ?? 0) < config.memory.reconcileBudget;
}

export function noteRouterCall(owner: string | null): void {
  rollDay();
  const k = budgetKey(owner);
  budgetByOwner.set(k, (budgetByOwner.get(k) ?? 0) + 1);
}

/** @internal test-only reset of the in-memory budget. */
export function _resetRouterBudget(): void {
  budgetDay = '';
  budgetByOwner.clear();
}

/**
 * Classify NEW against the owner's candidate facts. The candidate list is owner-scoped by the
 * caller, so the prompt never contains another tenant's text. Never throws — fail-safe to `add`.
 */
export async function routeReconcile(
  newFact: { summary: string; eventDate: string | null },
  candidates: RouterFact[],
): Promise<RouterDecision> {
  const model = config.memory.reconcileModel;
  const candidateIds = new Set(candidates.map((c) => c.id));
  try {
    const raw = await generateOpenRouterResponse({
      systemPrompt: ROUTER_SYSTEM,
      messages: [{ role: 'user', content: buildPayload(newFact, candidates) }],
      model, // explicit — never cognitiveFunction (which overrides model with the fast llama slot)
      maxTokens: 150,
      temperature: 0,
    });
    return parseRouterReply(raw, candidateIds, model);
  } catch (err) {
    log.warn({ err: (err as { message?: string })?.message }, 'reconcile router call failed — defaulting to add');
    return { op: 'add', targetId: null, reason: 'router_error', model };
  }
}
