/**
 * Compliance gate — pure, FAIL-CLOSED listing eligibility for the memory-pack marketplace.
 *
 * Tradeable Memory Packs — Slice 1, Part A, Task 3.
 *
 * The gate is the single decision point that says whether a pack may be listed.
 * It is deliberately a pure function (no DB, no I/O) so every blocking path is
 * exhaustively unit-testable. The binding rules (design §00 + founder):
 *   - ToS must be accepted.
 *   - A full, truthful attestation must be present.
 *   - SECRETS are a HARD reject — no input combination may pass with secrets present.
 *   - personal-category packs are held back in Part A (privacy work lands in Part D).
 *   - an unclassified (null) category is treated as unsafe → blocked (fail-closed).
 *   - title sales are not in slice 1.
 * PII alone does NOT block a non-personal pack in Part A (it only `hold`s personal
 * packs, which are already blocked for a different reason).
 */
import { describe, it, expect } from 'vitest';
import { evaluateGate, type GateInput } from '../compliance-gate.js';

/** A fully-valid, listable knowledge pack — the one combination the gate must pass. */
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

describe('compliance-gate — the all-pass case', () => {
  it('a clean, attested, ToS-accepted knowledge copy pack passes with no reasons', () => {
    const res = evaluateGate(passingInput());
    expect(res.gate).toBe('passed');
    expect(res.blocking_reasons).toEqual([]);
  });

  it('an agent-category pack is equally listable', () => {
    const res = evaluateGate({ ...passingInput(), contentCategory: 'agent' });
    expect(res.gate).toBe('passed');
    expect(res.blocking_reasons).toEqual([]);
  });
});

describe('compliance-gate — one blocking reason per rule', () => {
  it('ToS not accepted → tos_not_accepted', () => {
    const res = evaluateGate({ ...passingInput(), tosAccepted: false });
    expect(res.gate).toBe('blocked');
    expect(res.blocking_reasons).toContain('tos_not_accepted');
  });

  it('attestation entirely missing → attestation_missing', () => {
    const res = evaluateGate({ ...passingInput(), attestation: null });
    expect(res.gate).toBe('blocked');
    expect(res.blocking_reasons).toContain('attestation_missing');
  });

  it('attestation present but owns_or_licensed:false → attestation_missing', () => {
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

  it('attestation present but no_thirdparty_pii:false → attestation_missing', () => {
    const res = evaluateGate({
      ...passingInput(),
      attestation: {
        owns_or_licensed: true,
        no_thirdparty_pii: false,
        not_investment_advice: true,
        signed: true,
      },
    });
    expect(res.gate).toBe('blocked');
    expect(res.blocking_reasons).toContain('attestation_missing');
  });

  it('attestation present but not_investment_advice:false → attestation_missing', () => {
    const res = evaluateGate({
      ...passingInput(),
      attestation: {
        owns_or_licensed: true,
        no_thirdparty_pii: true,
        not_investment_advice: false,
        signed: true,
      },
    });
    expect(res.gate).toBe('blocked');
    expect(res.blocking_reasons).toContain('attestation_missing');
  });

  it('secrets present → contains_secrets (hard reject)', () => {
    const res = evaluateGate({
      ...passingInput(),
      filter: { hasSecrets: true, hasPii: false },
    });
    expect(res.gate).toBe('blocked');
    expect(res.blocking_reasons).toContain('contains_secrets');
  });

  it('personal category → personal_packs_not_yet_supported', () => {
    const res = evaluateGate({ ...passingInput(), contentCategory: 'personal' });
    expect(res.gate).toBe('blocked');
    expect(res.blocking_reasons).toContain('personal_packs_not_yet_supported');
  });

  it('unclassified (null) category → category_unset (fail-closed)', () => {
    const res = evaluateGate({ ...passingInput(), contentCategory: null });
    expect(res.gate).toBe('blocked');
    expect(res.blocking_reasons).toContain('category_unset');
  });

  it('title sale mode → title_sales_not_in_slice1', () => {
    const res = evaluateGate({ ...passingInput(), saleMode: 'title' });
    expect(res.gate).toBe('blocked');
    expect(res.blocking_reasons).toContain('title_sales_not_in_slice1');
  });
});

describe('compliance-gate — PII does not block a non-personal pack (Part A)', () => {
  it('a knowledge pack with PII (but no secrets) still passes', () => {
    // PII only `hold`s a *personal* pack; on knowledge/agent it is not a listing
    // blocker in Part A. This documents the deliberate Part-A scoping.
    const res = evaluateGate({
      ...passingInput(),
      filter: { hasSecrets: false, hasPii: true },
    });
    expect(res.gate).toBe('passed');
    expect(res.blocking_reasons).toEqual([]);
  });
});

describe('compliance-gate — accumulates every applicable reason', () => {
  it('a maximally-bad input surfaces all relevant blocking reasons at once', () => {
    const res = evaluateGate({
      tosAccepted: false,
      attestation: null,
      filter: { hasSecrets: true, hasPii: true },
      contentCategory: null,
      saleMode: 'title',
    });
    expect(res.gate).toBe('blocked');
    expect(res.blocking_reasons).toEqual(
      expect.arrayContaining([
        'tos_not_accepted',
        'attestation_missing',
        'contains_secrets',
        'category_unset',
        'title_sales_not_in_slice1',
      ]),
    );
    // personal_packs_not_yet_supported is NOT here: category is null, not 'personal'.
    expect(res.blocking_reasons).not.toContain('personal_packs_not_yet_supported');
  });
});

describe('compliance-gate — SECRETS are an unconditional hard reject (property test)', () => {
  it('NO input combination with hasSecrets:true ever returns gate:passed', () => {
    const bool = [true, false];
    const cats: GateInput['contentCategory'][] = ['personal', 'knowledge', 'agent', null];
    const modes: GateInput['saleMode'][] = ['copy', 'title'];
    let checked = 0;
    for (const tosAccepted of bool) {
      for (const owns of bool) {
        for (const noPii of bool) {
          for (const notAdvice of bool) {
            for (const signed of bool) {
              for (const hasPii of bool) {
                for (const contentCategory of cats) {
                  for (const saleMode of modes) {
                    for (const withAttestation of bool) {
                      const res = evaluateGate({
                        tosAccepted,
                        attestation: withAttestation
                          ? {
                              owns_or_licensed: owns,
                              no_thirdparty_pii: noPii,
                              not_investment_advice: notAdvice,
                              signed,
                            }
                          : null,
                        filter: { hasSecrets: true, hasPii },
                        contentCategory,
                        saleMode,
                      });
                      checked += 1;
                      expect(res.gate, 'secrets must never pass').toBe('blocked');
                      expect(res.blocking_reasons).toContain('contains_secrets');
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    // sanity: we actually exercised the whole grid, not zero iterations.
    expect(checked).toBe(2 * 2 * 2 * 2 * 2 * 2 * 4 * 2 * 2);
  });
});
