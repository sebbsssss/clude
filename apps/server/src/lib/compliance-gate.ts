/**
 * Compliance gate — pure, FAIL-CLOSED listing eligibility for the memory-pack marketplace.
 *
 * Tradeable Memory Packs — Slice 1, Part A, Task 3.
 *
 * This is the single decision point that decides whether a pack may be listed.
 * It is intentionally a pure function — no DB, no I/O — so every blocking path is
 * exhaustively unit-testable and the routes layer can call it from anywhere
 * (compliance-status endpoint, listing pre-check, publish guard) with identical
 * semantics. Callers supply the already-resolved facts (ToS acceptance from
 * `legal_acceptances`, attestation from `pack_attestations`, filter result from
 * `scanPack`, category from the server-derived `memory_packs.content_category`);
 * this module never trusts the client and never reaches out to a store.
 *
 * Binding rules (design §00 + founder decision). The gate FAILS CLOSED — anything
 * not provably safe is blocked:
 *   - `!tosAccepted`                                    → 'tos_not_accepted'
 *   - missing / incomplete attestation                  → 'attestation_missing'
 *   - `filter.hasSecrets`                               → 'contains_secrets'  (HARD reject;
 *        no input combination may pass with secrets present — property-tested)
 *   - `contentCategory === 'personal'`                  → 'personal_packs_not_yet_supported'
 *        (personal packs are held back until the Part D privacy work)
 *   - `contentCategory == null`  (unclassified)         → 'category_unset'    (treated as unsafe)
 *   - `saleMode === 'title'`                            → 'title_sales_not_in_slice1'
 *
 * PII alone does NOT block a non-personal pack in Part A: `filter.hasPii` only
 * `hold`s personal-category packs, which are already blocked for a different reason.
 * Passing requires an empty `blocking_reasons` list.
 */

/** A signed attestation the author made about a pack's content (from `pack_attestations`). */
export interface GateAttestation {
  owns_or_licensed: boolean;
  no_thirdparty_pii: boolean;
  not_investment_advice: boolean;
  signed: boolean;
}

export interface GateInput {
  /** Has the author accepted the current ToS (a row exists in `legal_acceptances`)? */
  tosAccepted: boolean;
  /** The pack's attestation, or `null` when the author has not attested at all. */
  attestation: GateAttestation | null;
  /** Summary of the content-filter scan over the pack's plaintext members. */
  filter: { hasSecrets: boolean; hasPii: boolean };
  /** Server-derived category. `null` = unclassified = fail-closed. Never client-set. */
  contentCategory: 'personal' | 'knowledge' | 'agent' | null;
  /** Slice 1 supports `copy` only; `title` is blocked. */
  saleMode: 'copy' | 'title';
}

/** The exhaustive set of reasons the gate can block on (stable string codes). */
export type GateBlockingReason =
  | 'tos_not_accepted'
  | 'attestation_missing'
  | 'contains_secrets'
  | 'personal_packs_not_yet_supported'
  | 'category_unset'
  | 'title_sales_not_in_slice1';

export interface GateResult {
  gate: 'passed' | 'blocked';
  blocking_reasons: GateBlockingReason[];
}

/**
 * Evaluate every gating rule and accumulate all that fail. Pure and order-stable:
 * the same input always yields the same `blocking_reasons` ordering, which makes
 * the result safe to surface verbatim in the `/compliance` endpoint.
 */
export function evaluateGate(input: GateInput): GateResult {
  const blocking_reasons: GateBlockingReason[] = [];

  if (!input.tosAccepted) {
    blocking_reasons.push('tos_not_accepted');
  }

  // A truthful, complete attestation is required. Any missing pledge — or no
  // attestation at all — fails closed under the single 'attestation_missing' code.
  const a = input.attestation;
  if (!a || !a.owns_or_licensed || !a.no_thirdparty_pii || !a.not_investment_advice) {
    blocking_reasons.push('attestation_missing');
  }

  // SECRETS are an unconditional hard reject — no other field can rescue this.
  if (input.filter.hasSecrets) {
    blocking_reasons.push('contains_secrets');
  }

  // Category gate. `null` (unclassified) is treated as unsafe, distinct from a
  // known-but-held 'personal'. Both block; the reason codes differ for clarity.
  if (input.contentCategory === null) {
    blocking_reasons.push('category_unset');
  } else if (input.contentCategory === 'personal') {
    blocking_reasons.push('personal_packs_not_yet_supported');
  }

  if (input.saleMode === 'title') {
    blocking_reasons.push('title_sales_not_in_slice1');
  }

  return {
    gate: blocking_reasons.length === 0 ? 'passed' : 'blocked',
    blocking_reasons,
  };
}
