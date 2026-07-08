/**
 * RED-TEAM probe of the secret/PII detector (content-filter.ts).
 *
 * Every vector is built from OBVIOUSLY-FAKE placeholder pieces (repeated chars,
 * fixed ints) so this file itself is never content-filtered. We assert the
 * detector's PUBLIC contract: a real secret format must produce a finding with
 * severity:'reject' and hasSecrets:true. Anything that slips through is a FALSE
 * NEGATIVE = a leaked credential shipping in a sellable pack.
 *
 * Tests are written to ASSERT THE DESIRED behaviour (reject), so a MISS shows up
 * as a failing test — that is the gap list.
 */
import { describe, it, expect } from 'vitest';
import { scanText, type FilterResult } from '../content-filter.js';

/** True iff the text is rejected as containing a secret. */
function rejected(text: string): boolean {
  const r: FilterResult = scanText(text);
  return r.hasSecrets === true && r.findings.some((f) => f.severity === 'reject');
}

/** True iff flagged at all (reject OR hold). */
function flaggedAny(text: string): boolean {
  const r = scanText(text);
  return r.findings.length > 0;
}

describe('RED-TEAM — false negatives the founder cares about (must REJECT)', () => {
  // ── 1. Provider API keys named in the brief ──

  it('Anthropic sk-ant- + long token', () => {
    expect(rejected('sk-ant-' + 'A'.repeat(95))).toBe(true);
  });

  it('OpenAI project key sk-proj- + long token', () => {
    expect(rejected('sk-proj-' + 'A'.repeat(48))).toBe(true);
  });

  it('Stripe sk_live_', () => {
    expect(rejected('sk_live_' + 'A'.repeat(24))).toBe(true);
  });
  it('Stripe rk_live_', () => {
    expect(rejected('rk_live_' + 'A'.repeat(24))).toBe(true);
  });
  it('Stripe whsec_', () => {
    expect(rejected('whsec_' + 'A'.repeat(32))).toBe(true);
  });

  // ── 2. PEM variants ──

  it('PEM OPENSSH PRIVATE KEY header', () => {
    expect(rejected('-----BEGIN OPENSSH PRIVATE KEY-----')).toBe(true);
  });
  it('PEM EC PRIVATE KEY header', () => {
    expect(rejected('-----BEGIN EC PRIVATE KEY-----')).toBe(true);
  });
  it('PEM (PKCS#8) PRIVATE KEY header', () => {
    expect(rejected('-----BEGIN PRIVATE KEY-----')).toBe(true);
  });

  // ── 3. Solana keypair JSON array (64 ints) ──

  it('Solana keypair JSON array of 64 ints', () => {
    const arr = '[' + Array(64).fill(7).join(',') + ']';
    expect(rejected('keypair ' + arr)).toBe(true);
  });

  // ── 4. Connection string with creds ──

  it('postgres:// connection string with user:pass@host', () => {
    expect(rejected('postgres://user:PLACEHOLDERPASS@host:5432/db')).toBe(true);
  });

  // ── 5. Remaining provider tokens ──

  it('GitLab glpat-', () => {
    expect(rejected('glpat-' + 'A'.repeat(20))).toBe(true);
  });
  it('npm npm_', () => {
    expect(rejected('npm_' + 'A'.repeat(36))).toBe(true);
  });
  it('HuggingFace hf_', () => {
    expect(rejected('hf_' + 'A'.repeat(34))).toBe(true);
  });
  it('AWS AKIA + 16', () => {
    expect(rejected('AKIA' + 'A'.repeat(16))).toBe(true);
  });
  it('AWS_SECRET_ACCESS_KEY=... env line', () => {
    expect(rejected('AWS_SECRET_ACCESS_KEY=' + 'A'.repeat(40))).toBe(true);
  });
});

describe('RED-TEAM — extra realistic shapes NOT in the existing suite', () => {
  // These probe the gaps a determined seller would hit. All placeholder-built.

  it('GitHub fine-grained PAT github_pat_', () => {
    // Real shape: github_pat_<22>_<59>. The detector only knows gh[pousr]_.
    expect(rejected('github_pat_' + 'A'.repeat(22) + '_' + 'B'.repeat(59))).toBe(true);
  });

  it('Google OAuth client secret GOCSPX-', () => {
    expect(rejected('GOCSPX-' + 'A'.repeat(28))).toBe(true);
  });

  it('Slack webhook URL hooks.slack.com/services/...', () => {
    expect(
      rejected('https://hooks.slack.com/services/T00000000/B00000000/' + 'A'.repeat(24)),
    ).toBe(true);
  });

  it('SendGrid API key SG.', () => {
    expect(rejected('SG.' + 'A'.repeat(22) + '.' + 'B'.repeat(43))).toBe(true);
  });

  it('Twilio Account SID + auth token env line', () => {
    expect(rejected('TWILIO_AUTH_TOKEN=' + 'a'.repeat(32))).toBe(true);
  });

  it('mysql:// connection string with creds', () => {
    expect(rejected('mysql://root:PLACEHOLDERPASS@10.0.0.1:3306/prod')).toBe(true);
  });

  it('redis:// connection string with creds', () => {
    expect(rejected('redis://default:PLACEHOLDERPASS@cache.internal:6379')).toBe(true);
  });

  it('mongodb+srv:// connection string with creds', () => {
    expect(rejected('mongodb+srv://admin:PLACEHOLDERPASS@cluster0.mongodb.net/db')).toBe(true);
  });

  it('generic api_key= env line with high-entropy value', () => {
    // 40+ chars of base64-ish → entropy fallback should at least HOLD; ideally reject.
    expect(flaggedAny('api_key=' + 'aB3xK9zQ7mN2pL5vR8wT4yU6'.repeat(2))).toBe(true);
  });

  it('GitHub PAT inside an Authorization: token header', () => {
    expect(rejected('Authorization: token ghp_' + 'A'.repeat(36))).toBe(true);
  });

  it('OpenAI sk-proj- with REAL shape (short segment then dash) — regex needs 20 consec alnum', () => {
    // Real sk-proj- keys contain '-' and '_' in the body. The OpenAI regex
    // sk-(?:proj-)?[A-Za-z0-9]{20,} requires 20 consecutive ALNUM after the
    // prefix; a short first segment before a dash defeats it entirely.
    expect(rejected('sk-proj-abcd-' + 'A'.repeat(60))).toBe(true);
  });

  it('bare 32-hex API token with no env keyword (classic MD5-style secret)', () => {
    // 32 chars is below the 40-char entropy floor and matches no prefix → invisible.
    expect(rejected('config a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6 done')).toBe(true);
  });
});

describe('RED-TEAM — redaction (no finding may echo the raw secret body)', () => {
  it('every finding sample is head4 + ellipsis + length, never the body', () => {
    const secrets = [
      'sk-ant-' + 'A'.repeat(95),
      'sk_live_' + 'B'.repeat(24),
      '0x' + 'c'.repeat(64),
      '-----BEGIN PRIVATE KEY-----',
      '[' + Array(64).fill(7).join(',') + ']',
      'postgres://user:PLACEHOLDERPASS@host:5432/db',
      'glpat-' + 'D'.repeat(20),
    ];
    for (const s of secrets) {
      const res = scanText(s);
      for (const f of res.findings) {
        // The raw matched value must never be fully present in the sample.
        // (sample = first4 + '…(' + len + ')'.) We check the captured body
        // isn't echoed: sample length is tiny relative to long secrets.
        expect(f.sample).not.toContain('PLACEHOLDERPASS');
        expect(f.sample).toMatch(/…\(\d+\)$/);
        // For long secrets the body (e.g. the 95 A's) cannot appear.
        if (s.length > 12) {
          expect(f.sample.length).toBeLessThan(s.length);
        }
      }
    }
  });
});

describe('RED-TEAM — false positives (clean prose must NOT be a secret)', () => {
  const clean = [
    'The dream cycle consolidates episodic memories into semantic insights nightly.',
    'Our pipeline scores recency times relevance times importance for each candidate.',
    'I will meet you at the office around three to discuss the quarterly roadmap.',
    'This base58 address belongs to the treasury and is public on the explorer.',
    'Please update the documentation before you open the pull request next week.',
    'sk- is a common prefix but this sentence is just prose about it, nothing more.',
    'The password policy requires at least twelve characters and one symbol.', // talks ABOUT password, no value
    'A long hexadecimal commit hash like abc123 was referenced in the changelog.',
  ];
  for (const text of clean) {
    it(`clean: ${text.slice(0, 40)}…`, () => {
      const r = scanText(text);
      expect(r.hasSecrets, `unexpected secret in clean prose: ${JSON.stringify(r.findings)}`).toBe(
        false,
      );
    });
  }

  it('a long lowercase English word run that is NOT bip39 is not a seed phrase', () => {
    const sentence =
      'the quick brown fox jumps over the lazy dog while the sun rises slowly today here';
    const r = scanText(sentence);
    expect(r.findings.some((f) => f.category === 'secret_seed_phrase')).toBe(false);
  });

  it('a base64-looking word in a sentence below entropy threshold is not held', () => {
    // 40+ chars but low entropy (very repetitive) should fall below 3.8 bits.
    const r = scanText('token ' + 'ababababababababababababababababababababab' + ' done');
    expect(r.hasSecrets).toBe(false);
  });
});
