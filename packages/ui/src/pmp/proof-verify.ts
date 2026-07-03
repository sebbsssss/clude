/**
 * Browser-side proof verification (Memory 3.0 · B2.3).
 *
 * The client half of the trust surface: given the proof bundle served by
 * GET /v1/pmp/artifacts/:id/proof, verify IN THE BROWSER that
 *   1. the attestation really is a valid ed25519 signature by the claimed
 *      Clude proof-plane key over the artifact's identity tuple, and
 *   2. a memory's content hash really is a member of the pack's merkle root
 *      (sha256-merkle-v2 inclusion proof).
 * Neither check trusts the server that served the bundle — that is the point.
 *
 * Browser-clean by construction: tweetnacl + Web Crypto only, no Node imports,
 * and base58 is decoded by a ~20-line dependency-free implementation below
 * (pinned against real bs58 output via golden-vector tests).
 */
import nacl from 'tweetnacl';
import { leafHashV2Browser, innerHashV2Browser } from './decrypt-pmp';

// ── base58 (bitcoin alphabet) ────────────────────────────────────────────────

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_MAP = new Map([...B58_ALPHABET].map((c, i) => [c, i]));

/** Decode a base58btc string to bytes. Throws on characters outside the alphabet. */
export function b58Decode(s: string): Uint8Array {
  // Leading '1's encode leading zero bytes; decode only the remainder so an
  // all-'1's input yields exactly that many zeros (no phantom seed byte).
  let zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros++;

  const bytes: number[] = []; // little-endian accumulator
  for (let i = zeros; i < s.length; i++) {
    const val = B58_MAP.get(s[i]!);
    if (val === undefined) throw new Error(`b58Decode: invalid character '${s[i]}'`);
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[zeros + bytes.length - 1 - i] = bytes[i]!;
  }
  return out;
}

// ── attestation (offline ed25519 check) ──────────────────────────────────────

/** Shape served by the proof oracle; mirrors the server's ExportAttestation. */
export interface ExportAttestationLike {
  message: string;
  signature_b58: string;
  pubkey_b58: string;
  algorithm: string;
}

/**
 * Does the attestation verify against its own claimed pubkey? Pin the pubkey
 * separately (evaluateProofBundle's expectedPubkeyB58) to also assert WHOSE
 * signature it is — a self-consistent signature from an attacker's key is
 * caught there, not here.
 */
export function verifyAttestationBrowser(att: ExportAttestationLike): boolean {
  try {
    if (att.algorithm !== 'ed25519') return false;
    return nacl.sign.detached.verify(
      new TextEncoder().encode(att.message),
      b58Decode(att.signature_b58),
      b58Decode(att.pubkey_b58),
    );
  } catch {
    return false;
  }
}

// ── merkle-v2 inclusion (membership check) ───────────────────────────────────

/** Shape produced by @clude/tokenization inclusionProofV2 (served alongside packs). */
export interface InclusionProofV2Like {
  /** Original content hash (hex); the prefixed leaf node is re-derived here. */
  leaf: string;
  path: Array<{ hash: string; side: 'left' | 'right' }>;
}

/**
 * Verify a sha256-merkle-v2 inclusion proof against a claimed root, in the
 * browser. Byte-twin of tokenization's verifyInclusionV2 (Node canonical);
 * parity is pinned by golden vectors generated from that implementation.
 */
export async function verifyInclusionProofV2(root: string, proof: InclusionProofV2Like): Promise<boolean> {
  try {
    let current = await leafHashV2Browser(proof.leaf);
    for (const step of proof.path) {
      current =
        step.side === 'left'
          ? await innerHashV2Browser(step.hash, current)
          : await innerHashV2Browser(current, step.hash);
    }
    return current === root;
  } catch {
    return false;
  }
}

// ── proof-bundle evaluation (the chip's decision function) ───────────────────

export interface AnchorSurfaceLike {
  chain: string;
  tx_sig: string;
  explorer_url: string | null;
}

export interface ProofBundleLike {
  attestation: ExportAttestationLike | null;
  anchor: AnchorSurfaceLike | null;
}

export type ProofStatus = 'attested+anchored' | 'attested' | 'anchored' | 'unverified';

export interface ProofEvaluation {
  /** true = valid signature; false = INVALID (tampered or wrong key); null = no attestation served. */
  attestationValid: boolean | null;
  /** Set when the attestation verified but was signed by a key other than the pinned one. */
  pubkeyMismatch: boolean;
  anchorPresent: boolean;
  explorerUrl: string | null;
  status: ProofStatus;
}

/**
 * Pure decision function behind the citation chip. Rendering is a thin layer
 * over this (export-flow.ts precedent: load-bearing logic stays testable).
 *
 * @param expectedPubkeyB58 the published Clude proof-plane pubkey; when given,
 *   an attestation signed by any other key counts as INVALID (pubkeyMismatch).
 */
export function evaluateProofBundle(
  bundle: ProofBundleLike,
  opts: { expectedPubkeyB58?: string } = {},
): ProofEvaluation {
  let attestationValid: boolean | null = null;
  let pubkeyMismatch = false;

  if (bundle.attestation) {
    attestationValid = verifyAttestationBrowser(bundle.attestation);
    if (attestationValid && opts.expectedPubkeyB58 && bundle.attestation.pubkey_b58 !== opts.expectedPubkeyB58) {
      attestationValid = false;
      pubkeyMismatch = true;
    }
  }

  const anchorPresent = bundle.anchor !== null;
  const explorerUrl = bundle.anchor?.explorer_url ?? null;

  const status: ProofStatus =
    attestationValid && anchorPresent
      ? 'attested+anchored'
      : attestationValid
        ? 'attested'
        : anchorPresent
          ? 'anchored'
          : 'unverified';

  return { attestationValid, pubkeyMismatch, anchorPresent, explorerUrl, status };
}
