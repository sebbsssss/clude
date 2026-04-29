// verifyChainAnchors + verifyRevocationAnchors — RPC-mocked tests.
//
// Strategy: vi.mock('@solana/web3.js') with a MockConnection class
// that pulls canned responses from a vi.hoisted state object. Each
// test populates the state in beforeEach.
//
// What's covered:
//   - happy path on memo-v1 (record anchors) and memo-revoke-v1
//     (revocation anchors)
//   - tx not found → unverified
//   - missing SPL Memo program instruction → unverified
//   - wrong memo bytes → unverified
//   - expectedSigner not in tx signers → unverified
//   - cluster cross-check pass / mismatch
//   - strict mode throws on first failure
//   - empty input is a no-op (no Connection construction)
//   - both data encodings: Uint8Array (compiledInstructions) and
//     bs58 string (legacy instructions)
//   - unsupported anchor_format → throws (caller catches)
//
// We deliberately do NOT exercise the lookup-table / getAccountKeys()
// path — that requires a versioned tx shape with loadedAddresses.
// Tests use the legacy + compiled paths which already cover the
// security surface (memo match + signer binding).

import { describe, it, expect, beforeEach, vi } from 'vitest';
// @ts-ignore — bs58 is ESM-only, works at runtime via Node CJS/ESM interop
import * as bs58Module from 'bs58';
const bs58: { encode: (b: Uint8Array) => string; decode: (s: string) => Uint8Array } =
  (bs58Module as any).default || bs58Module;

// ────────────────────────────────────────────────────────────────────
// Mock state — visible inside the vi.mock factory via vi.hoisted
// ────────────────────────────────────────────────────────────────────

const { mockState } = vi.hoisted(() => ({
  mockState: {
    genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', // devnet by default
    transactions: new Map<string, any>(),
    /** When true, getGenesisHash() throws once and resets the flag. */
    failNextGenesis: false,
    /** Counter so tests can assert RPC was/wasn't called. */
    connectionCount: 0,
    getTransactionCalls: 0,
  },
}));

vi.mock('@solana/web3.js', () => {
  class MockConnection {
    constructor(_url: string, _opts?: unknown) {
      mockState.connectionCount++;
    }
    async getGenesisHash() {
      if (mockState.failNextGenesis) {
        mockState.failNextGenesis = false;
        throw new Error('mock RPC error');
      }
      return mockState.genesisHash;
    }
    async getTransaction(sig: string, _cfg: unknown) {
      mockState.getTransactionCalls++;
      return mockState.transactions.has(sig) ? mockState.transactions.get(sig) : null;
    }
  }
  class MockPublicKey {
    constructor(public _key: string) {}
    toBase58() { return this._key; }
  }
  return { Connection: MockConnection, PublicKey: MockPublicKey };
});

// IMPORTANT: import after the mock is registered.
import {
  verifyChainAnchors,
  verifyRevocationAnchors,
  expectedMemoForRecordHash,
  expectedRevocationMemo,
} from '../chain-verify.js';
import type { MemoryPackAnchor, MemoryPackRevocationAnchor } from '../types.js';

// ────────────────────────────────────────────────────────────────────
// Constants + tx builders
// ────────────────────────────────────────────────────────────────────

const MEMO_V3 = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const MEMO_V1 = 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo';
const SIGNER = '7xK3CnTSRC2vt2GxgVUv6XnpNenSbcv9SgxoXdEnSGtpAA1y';
const SIGNER_OTHER = 'CnTSRC2vt2GxgVUv6XnpNenSbcv9SgxoXdEnSGtpAA1y00';
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

// We import PublicKey from the mock to construct accountKeys arrays
// the verifier reads.
import { PublicKey } from '@solana/web3.js';

interface FakeTx {
  transaction: {
    message: {
      accountKeys: PublicKey[];
      header: { numRequiredSignatures: number };
      instructions?: Array<{ programIdIndex: number; data: unknown }>;
      compiledInstructions?: Array<{ programIdIndex: number; data: Uint8Array }>;
    };
  };
  meta: object;
}

/** Build a fake tx with the memo carried via compiledInstructions (Uint8Array data). */
function fakeTxCompiled(memo: string, signer: string, programId = MEMO_V3): FakeTx {
  const data = Buffer.from(memo, 'utf-8');
  return {
    transaction: {
      message: {
        accountKeys: [new PublicKey(signer), new PublicKey(programId)],
        header: { numRequiredSignatures: 1 },
        compiledInstructions: [{ programIdIndex: 1, data }],
      },
    },
    meta: {},
  };
}

/** Build a fake tx with the memo carried via legacy instructions (bs58 string data). */
function fakeTxLegacy(memo: string, signer: string, programId = MEMO_V3): FakeTx {
  const dataBytes = Buffer.from(memo, 'utf-8');
  const dataB58 = bs58.encode(new Uint8Array(dataBytes));
  return {
    transaction: {
      message: {
        accountKeys: [new PublicKey(signer), new PublicKey(programId)],
        header: { numRequiredSignatures: 1 },
        instructions: [{ programIdIndex: 1, data: dataB58 }],
      },
    },
    meta: {},
  };
}

const ANCHOR: MemoryPackAnchor = {
  record_hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
  chain: 'solana-mainnet',
  tx: 'tx-good',
  slot: 248_100_000,
  anchor_format: 'memo-v1',
};

const REV_ANCHOR: MemoryPackRevocationAnchor = {
  record_hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000002',
  revoked_at: '2026-04-29T12:00:00.000Z',
  chain: 'solana-mainnet',
  tx: 'tx-revoke-good',
  slot: 248_100_001,
  anchor_format: 'memo-revoke-v1',
};

// ────────────────────────────────────────────────────────────────────
// Setup
// ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockState.genesisHash = MAINNET_GENESIS;
  mockState.transactions.clear();
  mockState.failNextGenesis = false;
  mockState.connectionCount = 0;
  mockState.getTransactionCalls = 0;
});

// ────────────────────────────────────────────────────────────────────
// verifyChainAnchors
// ────────────────────────────────────────────────────────────────────

describe('verifyChainAnchors', () => {
  it('happy path: matching memo + signer → verified', async () => {
    const memo = expectedMemoForRecordHash(ANCHOR.record_hash);
    mockState.transactions.set(ANCHOR.tx, fakeTxCompiled(memo, SIGNER));

    const { verified, warnings } = await verifyChainAnchors([ANCHOR], {
      rpcUrl: 'mock://rpc',
      expectedSigner: SIGNER,
    });
    expect(verified.has(ANCHOR.record_hash)).toBe(true);
    expect(warnings).toHaveLength(0);
  });

  it('legacy-instructions path with bs58 data also verifies', async () => {
    const memo = expectedMemoForRecordHash(ANCHOR.record_hash);
    mockState.transactions.set(ANCHOR.tx, fakeTxLegacy(memo, SIGNER));

    const { verified } = await verifyChainAnchors([ANCHOR], {
      rpcUrl: 'mock://rpc',
      expectedSigner: SIGNER,
    });
    expect(verified.has(ANCHOR.record_hash)).toBe(true);
  });

  it('legacy memo program ID (v1) also accepted', async () => {
    const memo = expectedMemoForRecordHash(ANCHOR.record_hash);
    mockState.transactions.set(ANCHOR.tx, fakeTxCompiled(memo, SIGNER, MEMO_V1));

    const { verified } = await verifyChainAnchors([ANCHOR], {
      rpcUrl: 'mock://rpc',
      expectedSigner: SIGNER,
    });
    expect(verified.has(ANCHOR.record_hash)).toBe(true);
  });

  it('tx not found → not verified, warning', async () => {
    // No transactions registered — getTransaction returns null
    const { verified, warnings } = await verifyChainAnchors([ANCHOR], {
      rpcUrl: 'mock://rpc',
    });
    expect(verified.size).toBe(0);
    expect(warnings.some((w) => /transaction not found/.test(w))).toBe(true);
  });

  it('no SPL Memo program instruction → not verified', async () => {
    // tx with a non-Memo program at index 1
    const otherProgram = '11111111111111111111111111111111';
    mockState.transactions.set(ANCHOR.tx, {
      transaction: {
        message: {
          accountKeys: [new PublicKey(SIGNER), new PublicKey(otherProgram)],
          header: { numRequiredSignatures: 1 },
          compiledInstructions: [{ programIdIndex: 1, data: Buffer.from('hello') }],
        },
      },
      meta: {},
    });

    const { verified, warnings } = await verifyChainAnchors([ANCHOR], {
      rpcUrl: 'mock://rpc',
    });
    expect(verified.size).toBe(0);
    expect(warnings.some((w) => /no SPL Memo program instruction/.test(w))).toBe(true);
  });

  it('wrong memo bytes → not verified', async () => {
    mockState.transactions.set(ANCHOR.tx, fakeTxCompiled('clude:v1:sha256:wrong', SIGNER));

    const { verified, warnings } = await verifyChainAnchors([ANCHOR], {
      rpcUrl: 'mock://rpc',
    });
    expect(verified.size).toBe(0);
    expect(warnings.some((w) => /no Memo instruction with data exactly equal/.test(w))).toBe(true);
  });

  it('expectedSigner not among tx signers → not verified', async () => {
    const memo = expectedMemoForRecordHash(ANCHOR.record_hash);
    mockState.transactions.set(ANCHOR.tx, fakeTxCompiled(memo, SIGNER));

    const { verified, warnings } = await verifyChainAnchors([ANCHOR], {
      rpcUrl: 'mock://rpc',
      expectedSigner: SIGNER_OTHER,
    });
    expect(verified.size).toBe(0);
    expect(warnings.some((w) => /not among tx signers/.test(w))).toBe(true);
  });

  it('cluster cross-check pass → all anchors verified normally', async () => {
    const memo = expectedMemoForRecordHash(ANCHOR.record_hash);
    mockState.transactions.set(ANCHOR.tx, fakeTxCompiled(memo, SIGNER));
    mockState.genesisHash = MAINNET_GENESIS;

    const { verified, warnings } = await verifyChainAnchors([ANCHOR], {
      rpcUrl: 'mock://rpc',
      cluster: 'mainnet',
      expectedSigner: SIGNER,
    });
    expect(verified.has(ANCHOR.record_hash)).toBe(true);
    expect(warnings).toHaveLength(0);
  });

  it('cluster mismatch → all anchors rejected, warning', async () => {
    mockState.genesisHash = DEVNET_GENESIS;

    const { verified, warnings } = await verifyChainAnchors([ANCHOR], {
      rpcUrl: 'mock://rpc',
      cluster: 'mainnet',
    });
    expect(verified.size).toBe(0);
    expect(warnings.some((w) => /cluster mismatch/.test(w))).toBe(true);
    // Anchors NOT processed when genesis mismatches — no per-tx fetch
    expect(mockState.getTransactionCalls).toBe(0);
  });

  it('cluster mismatch + strict → throws', async () => {
    mockState.genesisHash = DEVNET_GENESIS;

    await expect(
      verifyChainAnchors([ANCHOR], {
        rpcUrl: 'mock://rpc',
        cluster: 'mainnet',
        strict: true,
      }),
    ).rejects.toThrow(/cluster mismatch/);
  });

  it('strict + per-anchor failure throws on first failure', async () => {
    // tx1 verifies, tx2 fails (not found)
    const memo1 = expectedMemoForRecordHash(ANCHOR.record_hash);
    mockState.transactions.set('tx1', fakeTxCompiled(memo1, SIGNER));
    // tx2 deliberately not registered

    const a1 = { ...ANCHOR, tx: 'tx1' };
    const a2 = { ...ANCHOR, tx: 'tx2', record_hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000099' };

    await expect(
      verifyChainAnchors([a1, a2], {
        rpcUrl: 'mock://rpc',
        expectedSigner: SIGNER,
        strict: true,
      }),
    ).rejects.toThrow(/transaction not found/);
  });

  it('empty input → no Connection constructed, returns empty', async () => {
    const result = await verifyChainAnchors([], { rpcUrl: 'mock://rpc' });
    expect(result.verified.size).toBe(0);
    expect(result.warnings).toHaveLength(0);
    expect(mockState.connectionCount).toBe(0);
  });

  it('unsupported anchor_format → caught, surfaced as warning', async () => {
    const bad = { ...ANCHOR, anchor_format: 'memo-v9000' as any };

    const { verified, warnings } = await verifyChainAnchors([bad], {
      rpcUrl: 'mock://rpc',
    });
    expect(verified.size).toBe(0);
    expect(warnings.some((w) => /unsupported anchor_format/.test(w))).toBe(true);
  });

  it('multiple anchors: some verify, some fail — partial verified set', async () => {
    const a1 = { ...ANCHOR, tx: 'tx1' };
    const a2 = {
      ...ANCHOR,
      tx: 'tx2',
      record_hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000003',
    };

    const memo1 = expectedMemoForRecordHash(a1.record_hash);
    mockState.transactions.set('tx1', fakeTxCompiled(memo1, SIGNER));
    // tx2 not registered → fails

    const { verified, warnings } = await verifyChainAnchors([a1, a2], {
      rpcUrl: 'mock://rpc',
      expectedSigner: SIGNER,
    });
    expect(verified.has(a1.record_hash)).toBe(true);
    expect(verified.has(a2.record_hash)).toBe(false);
    expect(warnings.length).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────
// verifyRevocationAnchors
// ────────────────────────────────────────────────────────────────────

describe('verifyRevocationAnchors', () => {
  it('happy path: matching memo + signer → verified', async () => {
    const memo = expectedRevocationMemo(REV_ANCHOR.record_hash, REV_ANCHOR.revoked_at);
    mockState.transactions.set(REV_ANCHOR.tx, fakeTxCompiled(memo, SIGNER));

    const { verified, warnings } = await verifyRevocationAnchors([REV_ANCHOR], {
      rpcUrl: 'mock://rpc',
      expectedSigner: SIGNER,
    });
    expect(verified.has(REV_ANCHOR.record_hash)).toBe(true);
    expect(warnings).toHaveLength(0);
  });

  it('memo with wrong revoked_at → not verified (timestamp pinning)', async () => {
    // Producer claims revoked_at=T0 but the on-chain memo says T1.
    const wrongMemo = expectedRevocationMemo(REV_ANCHOR.record_hash, '2025-01-01T00:00:00.000Z');
    mockState.transactions.set(REV_ANCHOR.tx, fakeTxCompiled(wrongMemo, SIGNER));

    const { verified, warnings } = await verifyRevocationAnchors([REV_ANCHOR], {
      rpcUrl: 'mock://rpc',
      expectedSigner: SIGNER,
    });
    expect(verified.size).toBe(0);
    expect(warnings.some((w) => /no Memo instruction with data exactly equal/.test(w))).toBe(true);
  });

  it('strict + memo mismatch throws', async () => {
    mockState.transactions.set(REV_ANCHOR.tx, fakeTxCompiled('something else', SIGNER));

    await expect(
      verifyRevocationAnchors([REV_ANCHOR], {
        rpcUrl: 'mock://rpc',
        expectedSigner: SIGNER,
        strict: true,
      }),
    ).rejects.toThrow(/no Memo instruction/);
  });

  it('expectedSigner mismatch → not verified', async () => {
    const memo = expectedRevocationMemo(REV_ANCHOR.record_hash, REV_ANCHOR.revoked_at);
    mockState.transactions.set(REV_ANCHOR.tx, fakeTxCompiled(memo, SIGNER));

    const { verified, warnings } = await verifyRevocationAnchors([REV_ANCHOR], {
      rpcUrl: 'mock://rpc',
      expectedSigner: SIGNER_OTHER,
    });
    expect(verified.size).toBe(0);
    expect(warnings.some((w) => /not among tx signers/.test(w))).toBe(true);
  });

  it('unsupported anchor_format → caught, warning', async () => {
    const bad = { ...REV_ANCHOR, anchor_format: 'memo-revoke-v9000' as any };

    const { verified, warnings } = await verifyRevocationAnchors([bad], {
      rpcUrl: 'mock://rpc',
    });
    expect(verified.size).toBe(0);
    expect(warnings.some((w) => /unsupported anchor_format/.test(w))).toBe(true);
  });

  it('cluster cross-check applies to revocation anchors too', async () => {
    mockState.genesisHash = DEVNET_GENESIS;

    const { verified, warnings } = await verifyRevocationAnchors([REV_ANCHOR], {
      rpcUrl: 'mock://rpc',
      cluster: 'mainnet',
    });
    expect(verified.size).toBe(0);
    expect(warnings.some((w) => /cluster mismatch/.test(w))).toBe(true);
  });

  it('empty input → no Connection constructed', async () => {
    const result = await verifyRevocationAnchors([], { rpcUrl: 'mock://rpc' });
    expect(result.verified.size).toBe(0);
    expect(mockState.connectionCount).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────
// expected memo helpers — pure function bounds (sanity)
// ────────────────────────────────────────────────────────────────────

describe('expectedMemoForRecordHash + expectedRevocationMemo bounds', () => {
  it('record memo is exactly `clude:v1:<record_hash>`', () => {
    const h = 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    expect(expectedMemoForRecordHash(h)).toBe(`clude:v1:${h}`);
  });

  it('revocation memo is exactly `revoke:v1:<record_hash>:<revoked_at>`', () => {
    const h = 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const at = '2026-04-29T12:00:00.000Z';
    expect(expectedRevocationMemo(h, at)).toBe(`revoke:v1:${h}:${at}`);
  });
});
