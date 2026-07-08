/**
 * Compliance gate — EDGE-CASE / INVARIANT hardening.
 *
 * Tradeable Memory Packs — Slice 1, Part A. Companion to compliance-gate.test.ts
 * (one-reason-per-rule + the secrets property test). This file pins the gate's
 * FAIL-CLOSED invariants at the boundaries the base suite does not assert:
 *
 *   - Category mutual-exclusion: `category_unset` (null) and
 *     `personal_packs_not_yet_supported` ('personal') are distinct codes that must
 *     NEVER both appear — a category is exactly one of {null, personal, other}.
 *   - The `signed` field is INFORMATIONAL: the pure gate gates on the three truth
 *     pledges, not on signature presence (signature is persisted/verified at the
 *     route layer). This pins that contract so a refactor can't silently start
 *     (or stop) gating on it without a failing test.
 *   - Property: NO unsafe category EVER yields gate:'passed' (the category dual of
 *     the existing secrets property test).
 *   - Property: every non-personal category passes WITH PII present (Part A scope).
 *   - title + personal compound case (independent reasons both fire).
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateGate,
  type GateInput,
  type GateAttestation,
} from '../compliance-gate.js';

function passingInput(): GateInput {
  return {
    tosAccepted: true,
    attestation: {
      owns_or_licensed: true,
      no_thirdparty_pii: true,
      not_investment_advice: true,
      signed: true,
    },
    filter: { hasSecrets: false, hasPii: false },
    contentCategory: 'knowledge',
    saleMode: 'copy',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Category gate — null vs 'personal' are mutually exclusive, both fail-closed.
// ─────────────────────────────────────────────────────────────────────────────

describe('compliance-gate — category null/personal are distinct + mutually exclusive', () => {
  it('null category emits category_unset and NOT personal_packs_not_yet_supported', () => {
    const res = evaluateGate({ ...passingInput(), contentCategory: null });
    expect(res.blocking_reasons).toContain('category_unset');
    expect(res.blocking_reasons).not.toContain('personal_packs_not_yet_supported');
  });

  it("'personal' emits personal_packs_not_yet_supported and NOT category_unset", () => {
    const res = evaluateGate({ ...passingInput(), contentCategory: 'personal' });
    expect(res.blocking_reasons).toContain('personal_packs_not_yet_supported');
    expect(res.blocking_reasons).not.toContain('category_unset');
  });

  it('never emits BOTH category codes for any single category value', () => {
    const cats: GateInput['contentCategory'][] = ['personal', 'knowledge', 'agent', null];
    for (const contentCategory of cats) {
      const res = evaluateGate({ ...passingInput(), contentCategory });
      const both =
        res.blocking_reasons.includes('category_unset') &&
        res.blocking_reasons.includes('personal_packs_not_yet_supported');
      expect(both, `both category codes fired for ${String(contentCategory)}`).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The `signed` field is informational — the pure gate does not gate on it.
//    (Signature presence is persisted + verified at the route layer; the gate's
//    documented contract is the three content-truth pledges only.)
// ─────────────────────────────────────────────────────────────────────────────

describe('compliance-gate — `signed` is informational, not a gating field', () => {
  it('signed:false with all three pledges true still PASSES (gate ignores signed)', () => {
    const res = evaluateGate({
      ...passingInput(),
      attestation: {
        owns_or_licensed: true,
        no_thirdparty_pii: true,
        not_investment_advice: true,
        signed: false,
      },
    });
    expect(res.gate).toBe('passed');
    expect(res.blocking_reasons).toEqual([]);
  });

  it('signed:true cannot rescue a missing pledge (pledge gate is independent of signed)', () => {
    const res = evaluateGate({
      ...passingInput(),
      attestation: {
        owns_or_licensed: false,
        no_thirdparty_pii: true,
        not_investment_advice: true,
        signed: true,
      },
    });
    expect(res.gate).toBe('blocked');
    expect(res.blocking_reasons).toContain('attestation_missing');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Compound case — title + personal raise INDEPENDENT reasons.
// ─────────────────────────────────────────────────────────────────────────────

describe('compliance-gate — independent reasons compound', () => {
  it('a personal pack sold as title surfaces BOTH personal and title reasons', () => {
    const res = evaluateGate({
      ...passingInput(),
      contentCategory: 'personal',
      saleMode: 'title',
    });
    expect(res.gate).toBe('blocked');
    expect(res.blocking_reasons).toEqual(
      expect.arrayContaining(['personal_packs_not_yet_supported', 'title_sales_not_in_slice1']),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Property — every non-personal category passes WITH PII present (Part A).
//    PII alone never blocks a knowledge/agent pack (it only `hold`s personal,
//    which is blocked for a different reason). This is the PII dual of the
//    secrets property test and pins the Part-A scoping decision.
// ─────────────────────────────────────────────────────────────────────────────

describe('compliance-gate — PII never blocks a non-personal pack (property)', () => {
  it('knowledge + agent both pass with hasPii:true and no secrets', () => {
    for (const contentCategory of ['knowledge', 'agent'] as const) {
      const res = evaluateGate({
        ...passingInput(),
        contentCategory,
        filter: { hasSecrets: false, hasPii: true },
      });
      expect(res.gate, `${contentCategory} with PII must pass`).toBe('passed');
      expect(res.blocking_reasons).toEqual([]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Property — NO unsafe category EVER passes (the category dual of the
//    secrets-never-pass property). With ToS+attestation+copy+no-secrets all
//    valid, ONLY 'knowledge'/'agent' may pass; 'personal' and null must block.
// ─────────────────────────────────────────────────────────────────────────────

describe('compliance-gate — unsafe categories never pass (property)', () => {
  it('across the full attestation/PII grid, personal & null categories always block', () => {
    const bool = [true, false];
    const fullAttestation: GateAttestation = {
      owns_or_licensed: true,
      no_thirdparty_pii: true,
      not_investment_advice: true,
      signed: true,
    };
    let checkedUnsafe = 0;
    let checkedSafe = 0;
    for (const hasPii of bool) {
      for (const contentCategory of ['personal', null] as const) {
        const res = evaluateGate({
          tosAccepted: true,
          attestation: fullAttestation,
          filter: { hasSecrets: false, hasPii },
          contentCategory,
          saleMode: 'copy',
        });
        checkedUnsafe += 1;
        expect(res.gate, `${String(contentCategory)} must never pass`).toBe('blocked');
      }
      // Control: the safe categories DO pass under the same otherwise-valid input.
      for (const contentCategory of ['knowledge', 'agent'] as const) {
        const res = evaluateGate({
          tosAccepted: true,
          attestation: fullAttestation,
          filter: { hasSecrets: false, hasPii },
          contentCategory,
          saleMode: 'copy',
        });
        checkedSafe += 1;
        expect(res.gate, `${contentCategory} should pass`).toBe('passed');
      }
    }
    expect(checkedUnsafe).toBe(2 * 2); // 2 PII states × 2 unsafe categories
    expect(checkedSafe).toBe(2 * 2); // 2 PII states × 2 safe categories
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Determinism — the same input yields a byte-stable blocking_reasons ordering
//    (the route surfaces this list verbatim, so order must be reproducible).
// ─────────────────────────────────────────────────────────────────────────────

describe('compliance-gate — deterministic, order-stable output', () => {
  it('identical maximally-bad input yields identical blocking_reasons every call', () => {
    const bad: GateInput = {
      tosAccepted: false,
      attestation: null,
      filter: { hasSecrets: true, hasPii: true },
      contentCategory: null,
      saleMode: 'title',
    };
    const a = evaluateGate(bad);
    const b = evaluateGate(bad);
    expect(a.blocking_reasons).toEqual(b.blocking_reasons);
    // The documented accumulation order: tos → attestation → secrets → category → title.
    expect(a.blocking_reasons).toEqual([
      'tos_not_accepted',
      'attestation_missing',
      'contains_secrets',
      'category_unset',
      'title_sales_not_in_slice1',
    ]);
  });
});
