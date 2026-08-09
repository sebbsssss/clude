/**
 * PMP Encryption Crypto Round-Trip Probe (Plan 5 Task 0, sections C9 + C10).
 *
 * Two independent checks:
 *   C9  — encrypt → wrap(owner) + wrap(provider) → unwrap → decrypt, both recipients
 *         yield the original plaintext. Also: a forged wrap (different DEK, sealed to the
 *         same provider) MUST fail the content decrypt (validate-by-decrypt invariant).
 *   C10 — deriveOwnerEncryptionKeypair() is deterministic for the same input + the
 *         derived key actually round-trips end-to-end (encrypt → wrap to derived pub →
 *         unwrap with derived secret → decrypt).
 *
 * Run: `npx tsx scripts/encryption/roundtrip-probe.ts`
 * Exit 0 on success; non-zero with explicit error on any failure.
 */
import nacl from 'tweetnacl';
import {
  generateDek,
  encryptField,
  decryptField,
  wrapDek,
  unwrapDek,
  deriveOwnerEncryptionKeypair,
} from '@clude/shared/core/memory-envelope';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function main() {
  // ── C9: encrypt → dual-wrap → dual-unwrap → decrypt + validate-by-decrypt invariant ──

  const provider = nacl.box.keyPair();
  const owner = nacl.box.keyPair(); // stand-in for any owner key (real owner key tested in C10)
  const plaintext = `pmp-preflight-roundtrip-${Date.now()}`;

  const dek = generateDek();
  if (dek.length !== 32) throw new Error(`C9: DEK length ${dek.length}, expected 32`);

  const ct = encryptField(plaintext, dek);
  const wOwner = wrapDek(dek, owner.publicKey);
  const wProvider = wrapDek(dek, provider.publicKey);

  const dekFromOwner = unwrapDek(wOwner.wrapped, wOwner.wrapPubkey, owner.secretKey);
  const dekFromProvider = unwrapDek(wProvider.wrapped, wProvider.wrapPubkey, provider.secretKey);
  if (!dekFromOwner) throw new Error('C9: owner unwrap returned null');
  if (!dekFromProvider) throw new Error('C9: provider unwrap returned null');

  const pFromOwner = decryptField(ct, dekFromOwner);
  const pFromProvider = decryptField(ct, dekFromProvider);
  if (pFromOwner !== plaintext) throw new Error(`C9: owner decrypt mismatch: got "${pFromOwner}"`);
  if (pFromProvider !== plaintext) throw new Error(`C9: provider decrypt mismatch: got "${pFromProvider}"`);

  // Forged wrap: a wrap of a DIFFERENT dek (sealed to the same provider) must fail the
  // content decrypt — Poly1305 authenticates only the correct per-memory DEK.
  const wrongDek = generateDek();
  const forged = wrapDek(wrongDek, provider.publicKey);
  const dekFromForged = unwrapDek(forged.wrapped, forged.wrapPubkey, provider.secretKey);
  if (dekFromForged) {
    const decrypted = decryptField(ct, dekFromForged);
    if (decrypted !== null) {
      throw new Error('C9: validate-by-decrypt INVARIANT BROKEN — forged wrap decrypted content');
    }
  }

  // Forged wrap #2: wrap to a *different* recipient (provider can't unwrap at all).
  const stranger = nacl.box.keyPair();
  const sealed_to_stranger = wrapDek(dek, stranger.publicKey);
  const should_be_null = unwrapDek(sealed_to_stranger.wrapped, sealed_to_stranger.wrapPubkey, provider.secretKey);
  if (should_be_null !== null) {
    throw new Error('C9: provider unwrapped a wrap sealed to a different recipient');
  }

  console.log('✅ C9 — encrypt + dual-wrap + dual-unwrap + decrypt; forged-wrap correctly rejected (validate-by-decrypt invariant holds)');

  // ── C10: deriveOwnerEncryptionKeypair determinism + end-to-end with derived key ──

  // Fixed 64-byte test signature (NOT a real wallet signature — deterministic bytes used as HKDF IKM).
  const testSig = new Uint8Array(64);
  for (let i = 0; i < 64; i++) testSig[i] = (i * 31 + 7) & 0xff;

  const kp1 = await deriveOwnerEncryptionKeypair(testSig);
  const kp2 = await deriveOwnerEncryptionKeypair(testSig);

  if (kp1.publicKey.length !== 32) throw new Error(`C10: derived pubkey length ${kp1.publicKey.length}, expected 32`);
  if (kp1.secretKey.length !== 32) throw new Error(`C10: derived secret length ${kp1.secretKey.length}, expected 32`);
  if (!bytesEqual(kp1.publicKey, kp2.publicKey)) {
    throw new Error('C10: DETERMINISM BROKEN — two derivations from the same signature yielded different public keys');
  }
  if (!bytesEqual(kp1.secretKey, kp2.secretKey)) {
    throw new Error('C10: DETERMINISM BROKEN — two derivations yielded different secret keys');
  }

  // End-to-end with the derived key (proves the derivation produces a usable X25519 keypair).
  const dekX = generateDek();
  const ctX = encryptField('derived-key-roundtrip', dekX);
  const wX = wrapDek(dekX, kp1.publicKey);
  const dekY = unwrapDek(wX.wrapped, wX.wrapPubkey, kp1.secretKey);
  if (!dekY) throw new Error('C10: derived-key wrap failed to unwrap');
  if (decryptField(ctX, dekY) !== 'derived-key-roundtrip') {
    throw new Error('C10: derived-key end-to-end round-trip mismatch');
  }

  // Different signature → different keypair (the determinism check above guarantees same-in-same-out,
  // but we also want different-in-different-out — i.e. it's not a constant function).
  const altSig = new Uint8Array(64);
  for (let i = 0; i < 64; i++) altSig[i] = ((i * 17) + 3) & 0xff;
  const kpAlt = await deriveOwnerEncryptionKeypair(altSig);
  if (bytesEqual(kp1.publicKey, kpAlt.publicKey)) {
    throw new Error('C10: derivation produced the SAME pubkey for two different inputs — HKDF is degenerate');
  }

  console.log('✅ C10 — deriveOwnerEncryptionKeypair: deterministic for same input, distinct for different inputs, end-to-end round-trips with derived key');

  console.log('');
  console.log('All probes passed. Pre-flight C9 + C10 GREEN.');
}

main().catch((err) => {
  console.error('');
  console.error('🛑 PROBE FAILED:', err.message);
  console.error('   This is a STOP condition for Plan 5. Investigate before any activation step.');
  process.exit(1);
});
