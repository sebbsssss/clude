import { describe, it, expect } from 'vitest';
import {
  b58Decode,
  verifyAttestationBrowser,
  verifyInclusionProofV2,
  evaluateProofBundle,
  type ExportAttestationLike,
} from '../proof-verify';

/**
 * Memory 3.0 B2.3: browser proof verification, pinned by GOLDEN VECTORS.
 *
 * - The attestation vector was produced by the SERVER stack (tweetnacl detached
 *   ed25519 over a seed-7 keypair + real bs58 encoding), so verifying it here
 *   pins b58Decode AND the signature path against the canonical encoders.
 * - The inclusion vectors were produced by @clude/tokenization inclusionProofV2
 *   over sha256('a'..'e') leaves — same tree as the merkle-v2 parity suite.
 */

// ── golden attestation (throwaway seed-7 keypair; NOT a real key) ─────────────
const GOLDEN_ATT: ExportAttestationLike = {
  message:
    'clude-attest|v1|pmp_7|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|2026-07-03T00:00:00.000Z',
  signature_b58:
    'zd6hmbwMP2FvAj6ynBY3dtbovfts6uepN9iej9BbceExAggKtd51FkafspTv3c82wGUh7xmn2wYyUn6fkXiEJ3R',
  pubkey_b58: 'GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB',
  algorithm: 'ed25519',
};

// ── golden merkle-v2 inclusion vectors (sha256('a'..'e') leaves) ──────────────
const LEAVES = [
  'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
  '3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d',
  '2e7d2c03a9507ae265ecf5b5356885a53393a2029d241394997265a1a25aefc6',
  '18ac3e7343f016890c510e93f935261169d9e3f565436429830faf0934f4f8e4',
  '3f79bb7b435b05321651daefd374cdc681dc06faa65e374e38337b88ca046dea',
];
const ROOT5 = '4dc1abc938a0141a3c7cd1fed88948c35c4452e7e8aff9b1503eb5100a2c77b3';
const PROOFS: Record<number, Array<{ hash: string; side: 'left' | 'right' }>> = {
  0: [
    { hash: 'a0d9f0a50b35b9f7d7edc57fb64f4771ddef0fefeaca4e6f949a1514db5b136d', side: 'right' },
    { hash: '52840e7b1da66a39188d5d2fa2b2bc5bff35fd3df4fe16781c8425b92115d077', side: 'right' },
    { hash: 'ccfa4ba2b7ea0f00e2ab8e295f288befbfd9f316b854edaccb5bfdca87970fc6', side: 'right' },
  ],
  2: [
    { hash: 'de22f76c222682c331f7dda7349654b6a9f4f710077025e9b29130023712780f', side: 'right' },
    { hash: 'ad5ca6cddc0b27c6a83e332bf28011769236e6c6a1f786ebf7b5267b37a5bd22', side: 'left' },
    { hash: 'ccfa4ba2b7ea0f00e2ab8e295f288befbfd9f316b854edaccb5bfdca87970fc6', side: 'right' },
  ],
  // Leaf 4 is the promoted odd tail: a single-step path.
  4: [{ hash: '3baac34fdbf4f2297a37c0613822d0c48efdcd6602ca7a4f48ceb31339ffb3d5', side: 'left' }],
};

describe('b58Decode (dependency-free base58btc)', () => {
  it('decodes a real bs58-encoded 32-byte pubkey', () => {
    const pub = b58Decode(GOLDEN_ATT.pubkey_b58);
    expect(pub).toHaveLength(32);
  });

  it('handles leading 1s as zero bytes and rejects invalid characters', () => {
    expect(Array.from(b58Decode('11'))).toEqual([0, 0]);
    expect(b58Decode('')).toHaveLength(0);
    expect(() => b58Decode('0OIl')).toThrow('invalid character');
  });
});

describe('verifyAttestationBrowser (golden vector from the server encoder)', () => {
  it('verifies the canonical server-produced attestation', () => {
    expect(verifyAttestationBrowser(GOLDEN_ATT)).toBe(true);
  });

  it('rejects a tampered message, signature, pubkey, or algorithm', () => {
    expect(verifyAttestationBrowser({ ...GOLDEN_ATT, message: GOLDEN_ATT.message.replace('pmp_7', 'pmp_8') })).toBe(false);
    expect(verifyAttestationBrowser({ ...GOLDEN_ATT, signature_b58: GOLDEN_ATT.signature_b58.slice(0, -2) + '11' })).toBe(false);
    expect(verifyAttestationBrowser({ ...GOLDEN_ATT, pubkey_b58: '11111111111111111111111111111111' })).toBe(false);
    expect(verifyAttestationBrowser({ ...GOLDEN_ATT, algorithm: 'rsa' })).toBe(false);
  });

  it('never throws on garbage input', () => {
    expect(verifyAttestationBrowser({ message: 'x', signature_b58: '!!!', pubkey_b58: '???', algorithm: 'ed25519' })).toBe(false);
  });
});

describe('verifyInclusionProofV2 (golden vectors from tokenization inclusionProofV2)', () => {
  for (const idx of [0, 2, 4]) {
    it(`verifies membership of leaf ${idx} (${idx === 4 ? 'promoted odd tail' : 'paired'})`, async () => {
      expect(await verifyInclusionProofV2(ROOT5, { leaf: LEAVES[idx]!, path: PROOFS[idx]! })).toBe(true);
    });
  }

  it('rejects the wrong leaf, a tampered path, and the wrong root', async () => {
    expect(await verifyInclusionProofV2(ROOT5, { leaf: LEAVES[1]!, path: PROOFS[0]! })).toBe(false);
    const tampered = PROOFS[2]!.map((p, i) => (i === 0 ? { ...p, hash: 'f'.repeat(64) } : p));
    expect(await verifyInclusionProofV2(ROOT5, { leaf: LEAVES[2]!, path: tampered })).toBe(false);
    expect(await verifyInclusionProofV2('e'.repeat(64), { leaf: LEAVES[0]!, path: PROOFS[0]! })).toBe(false);
  });
});

describe('evaluateProofBundle (the chip decision function)', () => {
  const ANCHOR = { chain: 'solana', tx_sig: 'Tx1', explorer_url: 'https://solscan.io/tx/Tx1' };

  it('attested+anchored when both halves check out', () => {
    const ev = evaluateProofBundle({ attestation: GOLDEN_ATT, anchor: ANCHOR });
    expect(ev.status).toBe('attested+anchored');
    expect(ev.attestationValid).toBe(true);
    expect(ev.explorerUrl).toBe('https://solscan.io/tx/Tx1');
  });

  it('pins the proof-plane pubkey: a valid signature from the WRONG key is invalid', () => {
    const ev = evaluateProofBundle(
      { attestation: GOLDEN_ATT, anchor: null },
      { expectedPubkeyB58: 'SomeOtherPublishedKey1111111111111111111111' },
    );
    expect(ev.attestationValid).toBe(false);
    expect(ev.pubkeyMismatch).toBe(true);
    expect(ev.status).toBe('unverified');
  });

  it('anchored-only before the attestation key existed; attested-only before the anchor lands', () => {
    expect(evaluateProofBundle({ attestation: null, anchor: ANCHOR }).status).toBe('anchored');
    expect(evaluateProofBundle({ attestation: GOLDEN_ATT, anchor: null }).status).toBe('attested');
  });

  it('unverified when the bundle is empty or the attestation is forged', () => {
    expect(evaluateProofBundle({ attestation: null, anchor: null }).status).toBe('unverified');
    const forged = { ...GOLDEN_ATT, message: GOLDEN_ATT.message + 'x' };
    const ev = evaluateProofBundle({ attestation: forged, anchor: null });
    expect(ev.attestationValid).toBe(false);
    expect(ev.status).toBe('unverified');
  });
});
