/**
 * Content-filter — EDGE-CASE / FAILURE-MODE / INVARIANT hardening.
 *
 * Tradeable Memory Packs — Slice 1, Part A. Companion to content-filter.test.ts
 * (happy path) and content-filter.redteam.test.ts (provider-shape coverage). This
 * file probes the *boundaries* the other two do not:
 *
 *   - Obfuscated / mixed-case / whitespace-split secret vectors (the shapes a
 *     determined seller reaches for once the obvious ones are blocked).
 *   - PII notation variants (SSN with space/dot separators — a real gap that was
 *     fixed in the implementation; see `real_bugs`).
 *   - Runtime FAIL-CLOSED-but-don't-crash invariants: null/undefined/non-string
 *     input, malformed pack records — these must never throw and never silently
 *     mark unsafe input as clean.
 *   - The internal span-claim invariant: a recognised secret is flagged EXACTLY
 *     once (a broad detector / the entropy fallback must not double-count it).
 *
 * Every vector is OBVIOUSLY-FAKE (repeated chars / fixed ints / placeholder
 * tokens) so this file is never itself content-filtered. A miss is a false
 * negative = a leaked credential or undetected PII shipping inside a sold pack.
 */
import { describe, it, expect } from 'vitest';
import {
  scanText,
  scanPack,
  type FilterResult,
  type FilterCategory,
} from '../content-filter.js';

// ─────────── helpers ───────────

function rejects(text: string): boolean {
  const r = scanText(text);
  return r.hasSecrets === true && r.findings.some((f) => f.severity === 'reject');
}
function holds(text: string): boolean {
  const r = scanText(text);
  return r.findings.some((f) => f.severity === 'hold');
}
function flagged(text: string): boolean {
  return scanText(text).findings.length > 0;
}
function has(res: FilterResult, category: FilterCategory): boolean {
  return res.findings.some((f) => f.category === category);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. PII notation variants — the SSN obfuscation gap (REAL BUG that was fixed).
//    The original detector only matched dash-separated SSNs; a space- or
//    dot-separated SSN (both extremely common) slipped through entirely.
// ─────────────────────────────────────────────────────────────────────────────

describe('content-filter — SSN notation variants (obfuscation that must still HOLD)', () => {
  it('dash-separated SSN holds (baseline)', () => {
    const res = scanText('SSN 123-45-6789 on file');
    expect(has(res, 'pii_ssn')).toBe(true);
    expect(res.findings.find((f) => f.category === 'pii_ssn')!.severity).toBe('hold');
  });

  it('space-separated SSN holds (was a false negative before the fix)', () => {
    const res = scanText('SSN 123 45 6789 on file');
    expect(has(res, 'pii_ssn'), 'space-separated SSN must be detected').toBe(true);
  });

  it('dot-separated SSN holds (was a false negative before the fix)', () => {
    const res = scanText('SSN 123.45.6789 on file');
    expect(has(res, 'pii_ssn'), 'dot-separated SSN must be detected').toBe(true);
  });

  it('SSN at index 0 (boundary) is still caught', () => {
    expect(has(scanText('123-45-6789'), 'pii_ssn')).toBe(true);
    expect(has(scanText('123 45 6789'), 'pii_ssn')).toBe(true);
  });

  it('a space-separated SSN is NOT mis-attributed to phone (9 digits, not 10)', () => {
    const res = scanText('SSN 123 45 6789 here');
    expect(has(res, 'pii_ssn')).toBe(true);
    expect(has(res, 'pii_phone'), 'a 3-2-4 SSN must not also fire the 3-3-4 phone rule').toBe(
      false,
    );
  });

  it('a bare 9-digit run with NO separator is intentionally NOT flagged (too FP-prone)', () => {
    // Any order id / zip+ext / account number is 9 digits; requiring a separator is
    // the deliberate precision/recall tradeoff. This pins that behaviour so a future
    // "tighten SSN" change can't silently start flagging every 9-digit number.
    const res = scanText('order 123456789 shipped');
    expect(has(res, 'pii_ssn')).toBe(false);
  });

  it('a real 10-digit phone with spaces still holds (no regression from the SSN change)', () => {
    expect(has(scanText('call 415 555 0132 tomorrow'), 'pii_phone')).toBe(true);
    expect(has(scanText('call (415) 555-0132 tomorrow'), 'pii_phone')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Mixed-case / case-mangled secret prefixes.
//    Provider prefixes are case-canonical by spec (sk-ant-, ghp_, AKIA, GOCSPX-),
//    so a deliberately case-mangled prefix is NOT a recognised shape. BUT a real
//    key body is high-entropy, so the entropy fallback is the safety net: a
//    case-mangled key with a REALISTIC (high-entropy) body must still be FLAGGED
//    (held), never pass silently. This documents the defence-in-depth contract.
// ─────────────────────────────────────────────────────────────────────────────

describe('content-filter — case-mangled prefixes fall through to the entropy net', () => {
  // High-entropy placeholder body (mixed case + digits), obviously fake but NOT a
  // single repeated char, so Shannon entropy clears the 3.8 bits/char floor.
  const HOT_BODY = 'aB3xK9zQ7mN2pL5vR8wT4yU6jH1cF0dG'.repeat(3);

  it('canonical-case sk-ant- key is a hard REJECT (control)', () => {
    expect(rejects('sk-ant-api03-' + HOT_BODY)).toBe(true);
  });

  it('case-mangled SK-ANT- with a realistic body is at least HELD (entropy net)', () => {
    // Not a recognised prefix shape, so not a hard reject — but the high-entropy
    // body must not let it pass clean. Held > passed for an unknown credential blob.
    expect(flagged('SK-ANT-api03-' + HOT_BODY), 'case-mangled key must not pass clean').toBe(true);
  });

  it('case-mangled Stripe Sk_Live_ with a realistic body is at least HELD', () => {
    expect(flagged('Sk_Live_' + HOT_BODY)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Whitespace / newline-split + unprefixed hex secrets.
//    A seller might break a key across a newline or strip the 0x prefix to dodge
//    the EVM rule. The bare-hex rules + the env-line capture must still catch it.
// ─────────────────────────────────────────────────────────────────────────────

describe('content-filter — whitespace-split & unprefixed hex secrets (must REJECT)', () => {
  it('0x EVM key with a newline between prefix and body still rejects', () => {
    // The trailing 64-hex run is itself the bare-private-key shape, so even if the
    // 0x is orphaned on the previous line the body is caught.
    expect(rejects('private key:\n0x\n' + 'a'.repeat(64))).toBe(true);
  });

  it('UPPERCASE 0X-prefixed EVM key rejects (prefix is case-insensitive)', () => {
    expect(rejects('0X' + 'a'.repeat(64))).toBe(true);
  });

  it('bare 64-hex private key (no 0x) rejects — lower AND upper hex', () => {
    expect(rejects('key ' + 'a'.repeat(64) + ' end')).toBe(true);
    expect(rejects('key ' + 'F'.repeat(64) + ' end')).toBe(true);
  });

  it('bare 32-hex token (MD5-style / Twilio auth-token shape) rejects', () => {
    expect(rejects('token a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6 done')).toBe(true);
  });

  it('generic SECRET_KEY= / api_key: / private_key= env lines reject the value', () => {
    expect(rejects('SECRET_KEY=' + 'A'.repeat(20))).toBe(true);
    expect(rejects('api_key: ' + 'A'.repeat(20))).toBe(true);
    expect(rejects('private_key=' + 'A'.repeat(20))).toBe(true);
    expect(rejects('client_secret = ' + 'A'.repeat(20))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Runtime FAIL-CLOSED-but-don't-crash invariants.
//    scanText/scanPack are called over arbitrary pack member content. They must
//    tolerate null/undefined/non-string and malformed records WITHOUT throwing —
//    a throw inside the filter would skip the check and let the route fail open.
// ─────────────────────────────────────────────────────────────────────────────

describe('content-filter — runtime guards never throw, never falsely-clean', () => {
  it('scanText(null) / (undefined) / (number) return a clean result without throwing', () => {
    for (const bad of [null, undefined, 12345, {}, []]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = scanText(bad as any);
      expect(res).toEqual({ findings: [], hasSecrets: false, hasPii: false });
    }
  });

  it('scanText("") is clean', () => {
    expect(scanText('')).toEqual({ findings: [], hasSecrets: false, hasPii: false });
  });

  it('scanText of pure whitespace is clean (no spurious findings)', () => {
    const res = scanText('   \n\t  \r\n ');
    expect(res.findings).toEqual([]);
    expect(res.hasSecrets).toBe(false);
  });

  it('scanPack(null) and scanPack(undefined) are clean without throwing', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(scanPack(null as any)).toEqual({ findings: [], hasSecrets: false, hasPii: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(scanPack(undefined as any)).toEqual({ findings: [], hasSecrets: false, hasPii: false });
  });

  it('scanPack tolerates records with null / missing content fields', () => {
    const res = scanPack([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { content: null as any },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      { content: 'OPENAI_API_KEY=sk-' + 'q'.repeat(48) },
    ]);
    // The one real secret is still caught; the malformed records are skipped, not thrown on.
    expect(res.hasSecrets).toBe(true);
    expect(has(res, 'secret_api_key')).toBe(true);
  });

  it('a secret split across two pack records is unioned (cross-record safety)', () => {
    const res = scanPack([
      { content: 'just some clean prose here' },
      { content: '0x' + 'b'.repeat(64) },
      { content: 'email me at bob@acme.io' },
    ]);
    expect(res.hasSecrets).toBe(true);
    expect(res.hasPii).toBe(true);
    expect(has(res, 'secret_private_key')).toBe(true);
    expect(has(res, 'pii_email')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Internal invariant: a recognised secret is flagged EXACTLY once.
//    The span-claim machinery must stop a broad detector (bare-32-hex inside a
//    bare-64-hex, or the entropy fallback) from double-counting the same token.
//    A double-count wouldn't change hasSecrets but would corrupt the findings list
//    a moderator reviews.
// ─────────────────────────────────────────────────────────────────────────────

describe('content-filter — span-claim: each secret counted once, never double-flagged', () => {
  it('a 64-hex key is ONE private_key finding (not also two 32-hex findings)', () => {
    const res = scanText('key ' + 'a'.repeat(64) + ' end');
    const keyFindings = res.findings.filter(
      (f) => f.category === 'secret_private_key' || f.category === 'secret_api_key',
    );
    expect(keyFindings.length).toBe(1);
    expect(keyFindings[0].category).toBe('secret_private_key');
  });

  it('a 0x-prefixed EVM key is ONE finding (entropy fallback does not re-flag it)', () => {
    const res = scanText('config 0x' + 'a'.repeat(64) + ' trailing');
    expect(res.findings.filter((f) => f.severity === 'reject').length).toBe(1);
  });

  it('a long base58 secret is ONE finding, not also an entropy hold over the same span', () => {
    const base58 = '1' + 'A'.repeat(87); // 88 chars, in the 86–90 base58 window
    const res = scanText('secretKey ' + base58);
    expect(res.findings.length).toBe(1);
    expect(res.findings[0].category).toBe('secret_private_key');
  });

  it('findings are returned sorted by byte index', () => {
    const email = 'bob@acme.io';
    const key = 'sk-' + 'A'.repeat(48);
    const text = `lead ${key} middle ${email} tail`;
    const res = scanText(text);
    const indices = res.findings.map((f) => f.index);
    const sorted = [...indices].sort((a, b) => a - b);
    expect(indices).toEqual(sorted);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Redaction invariant under adversarial bodies — the raw secret body must
//    NEVER survive into a finding, regardless of shape (this is what lets a
//    moderation row persist findings safely).
// ─────────────────────────────────────────────────────────────────────────────

describe('content-filter — redaction never echoes the raw secret body', () => {
  it('long secrets: sample is head4 + ellipsis + length, strictly shorter than the body', () => {
    const secrets = [
      'sk-ant-api03-' + 'A'.repeat(95),
      '0x' + 'b'.repeat(64),
      'F'.repeat(64),
      'whsec_' + 'c'.repeat(40),
      '1' + 'A'.repeat(87),
    ];
    for (const s of secrets) {
      const res = scanText(s);
      expect(res.findings.length).toBeGreaterThan(0);
      for (const f of res.findings) {
        expect(f.sample).not.toContain(s);
        expect(f.sample).toMatch(/^.{0,4}…\(\d+\)$/);
        expect(f.sample.length).toBeLessThan(s.length);
      }
    }
  });

  it('the password value in a connection string is captured but never echoed', () => {
    const res = scanText('DATABASE_URL=postgres://admin:PLACEHOLDERPASS@db.internal:5432/app');
    const pw = res.findings.find((f) => f.category === 'secret_password');
    expect(pw).toBeDefined();
    expect(pw!.sample).not.toContain('PLACEHOLDERPASS');
  });
});
