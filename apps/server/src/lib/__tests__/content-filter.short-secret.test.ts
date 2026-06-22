/**
 * Content-filter — SHORT / COLON-DELIMITED secret regression (pre-deploy stress test).
 *
 * Tradeable Memory Packs — Slice 1, Part A. Companion to content-filter.test.ts,
 * content-filter.redteam.test.ts, and content-filter.edgecases.test.ts.
 *
 * VERIFIED PROD BUG (pre-deploy stress test of the PMP marketplace):
 *   The entropy catch-all required a 40+ CONTIGUOUS [A-Za-z0-9+/_-] run, and that
 *   char class EXCLUDES ':'. So a Telegram bot token `<bot_id>:<35-char-secret>`
 *   split at the colon into two sub-40 runs and was flagged as NOTHING; likewise any
 *   opaque credential under 40 chars with no recognised provider prefix evaded the
 *   filter entirely. scanPack therefore returned hasSecrets:false and the secret
 *   shipped inside a sellable pack — a hole straight through the marketplace's core
 *   safety promise.
 *
 * FIX (fail closed on unknown shapes WITHOUT over-flagging prose):
 *   - lower the entropy length floor to 20 chars, but gate 20–39 char runs behind a
 *     stricter 4.0 bits/char bar (measured English words/identifiers top out ≈3.6
 *     bits; real random tokens sit ≥4.5), and split candidates on ':';
 *   - add Telegram bot-token and DigitalOcean (dop/doo/dor_v1_) shapes to
 *     SECRET_DETECTORS so recognised credentials hard-REJECT.
 *
 * Every vector is OBVIOUSLY-FAKE (placeholder body) so this file is never itself
 * content-filtered. These tests FAIL on the pre-fix filter (the tokens come back
 * clean) and PASS after; the two clean-prose cases pin the false-positive boundary
 * the lowered floor must not cross.
 */
import { describe, it, expect } from 'vitest';
import { scanText, type FilterResult } from '../content-filter.js';

/** Caught at all — reject OR hold. Either gates the pack (status becomes 'flagged'). */
function flagged(res: FilterResult): boolean {
  return res.findings.length > 0 && (res.hasSecrets === true || res.hasPii === true);
}

describe('content-filter — short / colon-delimited secrets must NOT ship clean (regression)', () => {
  it('Telegram bot token (digits:base64ish) is caught (was a false negative)', () => {
    // Real shape: <bot_id>:<~35 chars of [A-Za-z0-9_-]>. The ':' split the value into
    // two sub-40 runs, so the old contiguous-run entropy rule saw neither half.
    const token = '123456789:AAFakeTokenBodyabcdefghijklmnopqrstuv';
    const res = scanText(`TELEGRAM_BOT_TOKEN=${token}`);
    expect(flagged(res), 'Telegram bot token must be flagged (reject or hold)').toBe(true);
    // Recognised provider shape → hard reject; and exactly one finding (no double-flag).
    const hit = res.findings.find((f) => f.category === 'secret_api_key');
    expect(hit, 'Telegram token should be a recognised api-key reject').toBeDefined();
    expect(hit!.severity).toBe('reject');
    // Redaction invariant holds for the new detector too: the body never echoes.
    expect(hit!.sample).not.toContain(token);
  });

  it('a 24-char opaque high-entropy token with no provider prefix is caught (was clean)', () => {
    // Below the old 40-char floor and matching no prefix → previously invisible. High
    // entropy (≈4.6 bits/char), so the stricter short-run bar holds it.
    const token = 'aB3xK9zQ7mN2pL5vR8wT4yU6'; // 24 chars, obviously fake
    const res = scanText(`here is a token ${token} embedded in a note`);
    expect(flagged(res), '24-char opaque token must be flagged (reject or hold)').toBe(true);
    // Unknown shape → HOLD (suspicious but not provably a credential), never a hard reject.
    const hit = res.findings.find((f) => f.severity === 'hold');
    expect(hit, 'opaque token should be held').toBeDefined();
    expect(hit!.sample).not.toContain(token);
  });

  it('a paragraph of normal prose is still clean (false-positive boundary held)', () => {
    const prose =
      'The dream cycle consolidates episodic memories into semantic insights every night, ' +
      'then reflects on contradictions and resolves them before the next morning. ' +
      'Our retrieval pipeline scores recency times relevance times importance for each ' +
      'candidate, and the documentation explains every phase in plain language.';
    const res = scanText(prose);
    expect(res.findings, `unexpected finding in clean prose: ${JSON.stringify(res.findings)}`).toEqual(
      [],
    );
    expect(res.hasSecrets).toBe(false);
    expect(res.hasPii).toBe(false);
  });

  it('a normal sentence with a long word is still clean (long words are not secrets)', () => {
    // 'internationalization' (20) / 'characteristically' (18) are ordinary high-length
    // words whose entropy stays under the short-run bar — they must not flag.
    const sentence =
      'The internationalization layer behaves characteristically and counterproductively ' +
      'when responsibilities are distributed across indistinguishable services.';
    const res = scanText(sentence);
    expect(res.findings, `long words must not be flagged: ${JSON.stringify(res.findings)}`).toEqual(
      [],
    );
    expect(res.hasSecrets).toBe(false);
  });
});
