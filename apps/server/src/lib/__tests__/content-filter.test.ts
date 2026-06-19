/**
 * Content filter — PII + SECRETS detector (the safety core of the marketplace).
 *
 * Tradeable Memory Packs — Slice 1, Part A, Task 2.
 *
 * Severity contract (founder decision, FAIL-CLOSED):
 *   - every `secret_*` finding has severity:'reject'  → hasSecrets:true  → pack is REJECTED
 *   - every `pii_*`    finding has severity:'hold'    → hasPii:true      → pack is HELD BACK
 *   - `sample` is REDACTED (first 4 chars + '…' + length). The raw secret must NEVER
 *     appear in a finding, so a moderation row can never persist a live credential.
 *
 * These vectors are the red-team's first targets: a false negative here is a leaked
 * credential shipping inside a listed pack, so every documented secret shape is covered.
 */
import { describe, it, expect } from 'vitest';
import {
  scanText,
  scanPack,
  type FilterCategory,
  type FilterResult,
} from '../content-filter.js';

/** Assert exactly that `category` is present, is a reject-secret, and is redacted. */
function expectSecret(res: FilterResult, category: FilterCategory, raw: string): void {
  expect(res.hasSecrets, `expected hasSecrets for ${category}`).toBe(true);
  const hit = res.findings.find((f) => f.category === category);
  expect(hit, `expected a ${category} finding`).toBeDefined();
  expect(hit!.severity).toBe('reject');
  // Redaction: the full secret must never be echoed back in the sample.
  expect(hit!.sample).not.toContain(raw);
}

function expectPii(res: FilterResult, category: FilterCategory): void {
  expect(res.hasPii, `expected hasPii for ${category}`).toBe(true);
  const hit = res.findings.find((f) => f.category === category);
  expect(hit, `expected a ${category} finding`).toBeDefined();
  expect(hit!.severity).toBe('hold');
}

describe('content-filter — SECRETS (every match → reject, hasSecrets:true)', () => {
  it('PEM private keys: RSA / EC / OPENSSH / PKCS#8', () => {
    for (const header of [
      '-----BEGIN PRIVATE KEY-----',
      '-----BEGIN RSA PRIVATE KEY-----',
      '-----BEGIN EC PRIVATE KEY-----',
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      '-----BEGIN PGP PRIVATE KEY-----',
    ]) {
      const text = `here is my key\n${header}\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----`;
      expectSecret(scanText(text), 'secret_private_key', header);
    }
  });

  it('BIP39 mnemonic: 12-word and 24-word', () => {
    const twelve = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
    const twentyFour =
      'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title';
    expectSecret(scanText(twelve), 'secret_seed_phrase', twelve);
    expectSecret(scanText(twentyFour), 'secret_seed_phrase', twentyFour);
  });

  it('OpenAI keys: sk-... and sk-proj-...', () => {
    const sk = 'sk-' + 'A'.repeat(48);
    const proj = 'sk-proj-' + 'B'.repeat(48);
    expectSecret(scanText(`OPENAI_API_KEY=${sk}`), 'secret_api_key', sk);
    expectSecret(scanText(`OPENAI_API_KEY=${proj}`), 'secret_api_key', proj);
  });

  it('Anthropic key: sk-ant-...', () => {
    const key = 'sk-ant-api03-' + 'C'.repeat(80) + 'AA';
    expectSecret(scanText(`my anthropic key ${key}`), 'secret_api_key', key);
  });

  it('Stripe keys: sk_live_ / rk_live_ / whsec_', () => {
    const live = 'sk_live_' + 'd'.repeat(24);
    const restricted = 'rk_live_' + 'e'.repeat(24);
    const webhook = 'whsec_' + 'f'.repeat(32);
    expectSecret(scanText(live), 'secret_api_key', live);
    expectSecret(scanText(restricted), 'secret_api_key', restricted);
    expectSecret(scanText(webhook), 'secret_api_key', webhook);
  });

  it('AWS: AKIA access key id and AWS_SECRET_ACCESS_KEY env line', () => {
    const akia = 'AKIA' + 'I'.repeat(16);
    expectSecret(scanText(`aws_access_key_id = ${akia}`), 'secret_api_key', akia);
    const secretLine = 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    expectSecret(scanText(secretLine), 'secret_api_key', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
  });

  it('GitHub tokens: ghp_ / gho_ / ghu_ / ghs_ / ghr_', () => {
    for (const prefix of ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_']) {
      const tok = prefix + 'g'.repeat(36);
      expectSecret(scanText(`token: ${tok}`), 'secret_api_key', tok);
    }
  });

  it('GitLab PAT: glpat-...', () => {
    const tok = 'glpat-' + 'h'.repeat(20);
    expectSecret(scanText(tok), 'secret_api_key', tok);
  });

  it('npm token: npm_...', () => {
    const tok = 'npm_' + 'i'.repeat(36);
    expectSecret(scanText(`//registry.npmjs.org/:_authToken=${tok}`), 'secret_api_key', tok);
  });

  it('HuggingFace token: hf_...', () => {
    const tok = 'hf_' + 'j'.repeat(34);
    expectSecret(scanText(tok), 'secret_api_key', tok);
  });

  it('Google API key: AIza...', () => {
    const tok = 'AIza' + 'k'.repeat(35);
    expectSecret(scanText(`key=${tok}`), 'secret_api_key', tok);
  });

  it('Slack tokens: xoxb / xoxa / xoxp / xoxr / xoxs', () => {
    for (const prefix of ['xoxb-', 'xoxa-', 'xoxp-', 'xoxr-', 'xoxs-']) {
      const tok = prefix + '2222222222-3333333333-' + 'l'.repeat(24);
      expectSecret(scanText(tok), 'secret_api_key', tok);
    }
  });

  it('Solana keys: base58 64-byte secret AND JSON-array keypair (64 ints)', () => {
    // 88-char base58 ≈ 64 bytes — typical Solana secret key export.
    const base58 = '4'.repeat(88);
    expectSecret(scanText(`secretKey: ${base58}`), 'secret_private_key', base58);
    // JSON array of 64 ints — the `id.json` keypair format from `solana-keygen`.
    const arr = '[' + Array.from({ length: 64 }, (_, i) => (i * 3) % 256).join(',') + ']';
    expectSecret(scanText(`keypair = ${arr}`), 'secret_private_key', arr);
  });

  it('EVM private key: 0x + 64 hex', () => {
    const key = '0x' + 'a'.repeat(64);
    expectSecret(scanText(`PRIVATE_KEY=${key}`), 'secret_private_key', key);
  });

  it('JWT: eyJ….eyJ….sig', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expectSecret(scanText(`Authorization: Bearer ${jwt}`), 'secret_jwt', jwt);
  });

  it('connection strings: scheme://user:pass@host', () => {
    const conn = 'postgres://admin:s3cr3tP%40ss@db.internal:5432/app';
    expectSecret(scanText(`DATABASE_URL=${conn}`), 'secret_password', 'admin:s3cr3tP%40ss');
  });

  it('inline passwords: password: / passwd= / PASSWORD=', () => {
    expectSecret(scanText('password: hunter2hunter2'), 'secret_password', 'hunter2hunter2');
    expectSecret(scanText('db_passwd=Tr0ub4dor&3xxxx'), 'secret_password', 'Tr0ub4dor&3xxxx');
    expectSecret(scanText('PASSWORD=correcthorsebattery'), 'secret_password', 'correcthorsebattery');
  });

  it('Shannon-entropy fallback: long unknown high-entropy token → hold', () => {
    // Not a recognised prefix shape, but clearly a random secret-like blob.
    const blob = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MEFCQ0RFRkdISktMTU5PUFFSU1RVVldYWVo';
    const res = scanText(`opaque token ${blob} embedded here`);
    const hit = res.findings.find((f) => f.category === 'secret_password');
    expect(hit, 'entropy fallback should flag the blob').toBeDefined();
    expect(hit!.severity).toBe('hold');
    expect(res.hasSecrets, 'a hold-severity entropy hit is not a hard secret').toBe(false);
    expect(hit!.sample).not.toContain(blob);
  });
});

describe('content-filter — PII (every match → hold, hasPii:true)', () => {
  it('email address', () => {
    expectPii(scanText('reach me at jane.doe@example.com any time'), 'pii_email');
  });

  it('US phone number', () => {
    expectPii(scanText('call (415) 555-0132 tomorrow'), 'pii_phone');
    expectPii(scanText('call 415 555 0132 tomorrow'), 'pii_phone');
  });

  it('US SSN', () => {
    expectPii(scanText('SSN 123-45-6789 on file'), 'pii_ssn');
  });

  it('Luhn-VALID 16-digit credit card matches', () => {
    // 4111 1111 1111 1111 is a canonical Luhn-valid Visa test number.
    expectPii(scanText('card 4111111111111111 exp 12/29'), 'pii_credit_card');
    expectPii(scanText('card 4111 1111 1111 1111 exp 12/29'), 'pii_credit_card');
  });

  it('Luhn-INVALID 16-digit string must NOT be flagged as a card', () => {
    const res = scanText('order id 1234567812345678 shipped');
    expect(res.findings.some((f) => f.category === 'pii_credit_card')).toBe(false);
  });
});

describe('content-filter — clean text', () => {
  it('ordinary prose has no findings', () => {
    const res = scanText(
      'The dream cycle consolidates episodic memories into semantic insights every night.',
    );
    expect(res.findings).toEqual([]);
    expect(res.hasSecrets).toBe(false);
    expect(res.hasPii).toBe(false);
  });

  it('empty string is clean', () => {
    expect(scanText('')).toEqual({ findings: [], hasSecrets: false, hasPii: false });
  });
});

describe('content-filter — redaction', () => {
  it('sample is first-4 + ellipsis + length, never the full secret', () => {
    const key = 'sk-ant-api03-' + 'Z'.repeat(90);
    const res = scanText(key);
    const hit = res.findings.find((f) => f.category === 'secret_api_key')!;
    expect(hit.sample).not.toContain(key);
    expect(hit.sample.startsWith('sk-a')).toBe(true);
    expect(hit.sample).toContain('…');
    // length of the original is disclosed, the body is not.
    expect(hit.sample).toContain(String(key.length));
  });
});

describe('content-filter — scanPack unions per-record findings', () => {
  it('unions secrets and PII across multiple records', () => {
    const records = [
      { content: 'totally clean note' },
      { content: 'email me at bob@acme.io' },
      { content: 'OPENAI_API_KEY=sk-' + 'q'.repeat(48) },
    ];
    const res = scanPack(records);
    expect(res.hasSecrets).toBe(true);
    expect(res.hasPii).toBe(true);
    expect(res.findings.some((f) => f.category === 'pii_email')).toBe(true);
    expect(res.findings.some((f) => f.category === 'secret_api_key')).toBe(true);
  });

  it('empty pack is clean', () => {
    expect(scanPack([])).toEqual({ findings: [], hasSecrets: false, hasPii: false });
  });
});

describe('content-filter — adversarial reviewer cases', () => {
  it('multiple secrets in one record are all surfaced', () => {
    const evm = '0x' + 'b'.repeat(64);
    const stripe = 'sk_live_' + 'c'.repeat(24);
    const res = scanText(`config: ${evm} and ${stripe}`);
    expect(res.findings.some((f) => f.category === 'secret_private_key')).toBe(true);
    expect(res.findings.some((f) => f.category === 'secret_api_key')).toBe(true);
    expect(res.hasSecrets).toBe(true);
  });

  it('a key embedded inside JSON is still caught', () => {
    const key = 'sk-ant-api03-' + 'Y'.repeat(80) + 'AA';
    const json = JSON.stringify({ provider: 'anthropic', apiKey: key, note: 'do not leak' });
    expectSecret(scanText(json), 'secret_api_key', key);
  });

  it('every finding carries the byte index of its match', () => {
    const key = 'sk-' + 'A'.repeat(48);
    const text = `prefix text ${key}`;
    const res = scanText(text);
    const hit = res.findings.find((f) => f.category === 'secret_api_key')!;
    expect(hit.index).toBe(text.indexOf(key));
  });
});
