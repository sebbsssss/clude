import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Memory 3.0 C1 slice 1.5 — LLM reconciliation router. Guarantees under test: the validator is
 * FAIL-SAFE to `add` on every deviation (parse error, wrong op, a targetId not in the candidate set
 * we sent — i.e. hallucinated/cross-tenant — array/prose, API error); the model is passed
 * EXPLICITLY (never a cognitiveFunction, which would silently swap in the fast llama slot); the
 * per-owner soft budget bounds calls; isRouterConfigured gates on the sub-flag + provider.
 */
vi.hoisted(() => {
  process.env.SITE_ONLY = 'true';
  process.env.MEMORY_RECONCILE_ROUTER = 'true';
  process.env.MEMORY_RECONCILE_MODEL = 'anthropic/claude-haiku-4.5';
  process.env.MEMORY_RECONCILE_BUDGET = '3';
});

const { generateOpenRouterResponse, isOpenRouterEnabled } = vi.hoisted(() => ({
  generateOpenRouterResponse: vi.fn((..._a: unknown[]) => Promise.resolve('{}')),
  isOpenRouterEnabled: vi.fn(() => true),
}));
vi.mock('@clude/shared/core/openrouter-client', () => ({ generateOpenRouterResponse, isOpenRouterEnabled }));
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  parseRouterReply,
  routeReconcile,
  isRouterConfigured,
  routerBudgetAvailable,
  noteRouterCall,
  _resetRouterBudget,
} from '../reconcile-router';

const MODEL = 'anthropic/claude-haiku-4.5';
const CANDS = new Set([42, 43]);

beforeEach(() => {
  vi.clearAllMocks();
  _resetRouterBudget();
  generateOpenRouterResponse.mockResolvedValue('{}');
  isOpenRouterEnabled.mockReturnValue(true);
});

describe('parseRouterReply — strict, fail-safe to add', () => {
  it('valid update naming a real candidate → update', () => {
    expect(parseRouterReply('{"op":"update","targetId":42,"reason":"newer"}', CANDS, MODEL))
      .toEqual({ op: 'update', targetId: 42, reason: 'newer', model: MODEL });
  });
  it('valid noop → noop', () => {
    expect(parseRouterReply('{"op":"noop","targetId":43}', CANDS, MODEL))
      .toMatchObject({ op: 'noop', targetId: 43 });
  });
  it('add with null target → add', () => {
    expect(parseRouterReply('{"op":"add","targetId":null}', CANDS, MODEL))
      .toMatchObject({ op: 'add', targetId: null });
  });
  it('add that wrongly carries a target → target is dropped', () => {
    expect(parseRouterReply('{"op":"add","targetId":42}', CANDS, MODEL))
      .toMatchObject({ op: 'add', targetId: null });
  });
  it('accepts snake_case target_id', () => {
    expect(parseRouterReply('{"op":"update","target_id":42}', CANDS, MODEL))
      .toMatchObject({ op: 'update', targetId: 42 });
  });
  it('HALLUCINATED targetId (not in candidate set) → add(invalid_target)', () => {
    expect(parseRouterReply('{"op":"update","targetId":99}', CANDS, MODEL))
      .toEqual({ op: 'add', targetId: null, reason: 'router_invalid_target', model: MODEL });
  });
  it('update with missing targetId → add(invalid_target)', () => {
    expect(parseRouterReply('{"op":"update"}', CANDS, MODEL)).toMatchObject({ op: 'add', reason: 'router_invalid_target' });
  });
  it('wrong-case op → add(invalid_op)', () => {
    expect(parseRouterReply('{"op":"UPDATE","targetId":42}', CANDS, MODEL)).toMatchObject({ op: 'add', reason: 'router_invalid_op' });
  });
  it('JSON embedded in prose → extracted and honored', () => {
    expect(parseRouterReply('Sure! {"op":"noop","targetId":42} hope that helps', CANDS, MODEL))
      .toMatchObject({ op: 'noop', targetId: 42 });
  });
  it('array reply → add(invalid_shape)', () => {
    expect(parseRouterReply('[{"op":"noop","targetId":42}]', CANDS, MODEL)).toMatchObject({ op: 'add', reason: 'router_invalid_shape' });
  });
  it('non-JSON garbage → add(parse_error)', () => {
    expect(parseRouterReply('no idea', CANDS, MODEL)).toMatchObject({ op: 'add', reason: 'router_parse_error' });
  });
});

describe('routeReconcile — call shape + fail-safe', () => {
  const newFact = { summary: 'flight rebooked to 5pm', eventDate: '2026-07-10' };
  const cands = [{ id: 42, summary: 'flight at 3pm', eventDate: '2026-07-10' }];

  it('passes the model EXPLICITLY and never a cognitiveFunction', async () => {
    generateOpenRouterResponse.mockResolvedValue('{"op":"update","targetId":42}');
    const d = await routeReconcile(newFact, cands);
    expect(d).toMatchObject({ op: 'update', targetId: 42, model: MODEL });
    const callArg = generateOpenRouterResponse.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.model).toBe(MODEL);
    expect(callArg.cognitiveFunction).toBeUndefined();
    expect(callArg.temperature).toBe(0);
  });

  it('an API error → add(router_error), never throws', async () => {
    generateOpenRouterResponse.mockRejectedValue(new Error('OpenRouter 500'));
    await expect(routeReconcile(newFact, cands)).resolves.toEqual(
      expect.objectContaining({ op: 'add', reason: 'router_error', model: MODEL }),
    );
  });
});

describe('budget + configured gate', () => {
  it('soft budget: available until reconcileBudget calls are noted, then not', () => {
    expect(routerBudgetAvailable('wallet-A')).toBe(true);
    noteRouterCall('wallet-A'); noteRouterCall('wallet-A'); noteRouterCall('wallet-A'); // budget = 3
    expect(routerBudgetAvailable('wallet-A')).toBe(false);
    expect(routerBudgetAvailable('wallet-B')).toBe(true); // per-owner
  });

  it('isRouterConfigured is false when OpenRouter is unavailable', () => {
    expect(isRouterConfigured()).toBe(true);
    isOpenRouterEnabled.mockReturnValue(false);
    expect(isRouterConfigured()).toBe(false);
  });
});
