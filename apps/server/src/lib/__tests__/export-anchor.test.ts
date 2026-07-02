import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * Memory 3.0 B1.4: per-export on-chain anchoring, signed by a DEDICATED
 * keypair. The guarantees under test:
 *  - loadAnchorSigner REFUSES the treasury key (raw-equal AND same key in a
 *    different encoding) — no env combination routes anchor volume through
 *    BOT_WALLET_PRIVATE_KEY.
 *  - Anchoring is default-OFF and never throws into the export flow.
 *  - The memo is never truncated (a truncated hash is a destroyed proof).
 *  - A confirmed anchor persists anchor_tx_sig onto the artifact row.
 */
vi.hoisted(() => {
  process.env.SITE_ONLY = 'true';
});

const logSpies = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('@clude/shared/core/logger', () => ({ createChildLogger: () => logSpies }));

const sendMock = vi.hoisted(() => vi.fn());
vi.mock('@solana/web3.js', async (importActual) => {
  const actual = await importActual<typeof import('@solana/web3.js')>();
  return { ...actual, sendAndConfirmTransaction: (...args: unknown[]) => sendMock(...args) };
});

vi.mock('@clude/shared/core/solana-client', () => ({ getConnection: () => ({}) }));

const updates = vi.hoisted(() => [] as Array<{ patch: any; where: any }>);
vi.mock('@clude/shared/core/database', () => ({
  getDb: () => ({
    from: (_t: string) => ({
      update: (patch: any) => ({
        eq: (col: string, val: string) => {
          updates.push({ patch, where: { [col]: val } });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  }),
}));

import {
  loadAnchorSigner,
  isExportAnchoringEnabled,
  buildAnchorMemo,
  anchorExportOnChain,
  anchorExportBestEffort,
  attestExport,
  verifyExportAttestation,
} from '../export-anchor';

const anchorKp = Keypair.generate();
const treasuryKp = Keypair.generate();
const anchorB58 = bs58.encode(anchorKp.secretKey);
const treasuryB58 = bs58.encode(treasuryKp.secretKey);
const treasuryJsonArray = JSON.stringify(Array.from(treasuryKp.secretKey));

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
});

describe('loadAnchorSigner (the treasury gate)', () => {
  it('loads a valid dedicated keypair', () => {
    const kp = loadAnchorSigner({ ANCHOR_WALLET_PRIVATE_KEY: anchorB58, BOT_WALLET_PRIVATE_KEY: treasuryB58 } as NodeJS.ProcessEnv);
    expect(kp.publicKey.equals(anchorKp.publicKey)).toBe(true);
  });

  it('throws when unset', () => {
    expect(() => loadAnchorSigner({} as NodeJS.ProcessEnv)).toThrow('not set');
  });

  it('REFUSES the treasury key (raw-equal)', () => {
    expect(() =>
      loadAnchorSigner({ ANCHOR_WALLET_PRIVATE_KEY: treasuryB58, BOT_WALLET_PRIVATE_KEY: treasuryB58 } as NodeJS.ProcessEnv),
    ).toThrow('TREASURY');
  });

  it('REFUSES the treasury key even re-encoded (bs58 anchor vs JSON-array treasury)', () => {
    expect(() =>
      loadAnchorSigner({ ANCHOR_WALLET_PRIVATE_KEY: treasuryB58, BOT_WALLET_PRIVATE_KEY: treasuryJsonArray } as NodeJS.ProcessEnv),
    ).toThrow('TREASURY');
  });

  it('throws on garbage key material', () => {
    expect(() => loadAnchorSigner({ ANCHOR_WALLET_PRIVATE_KEY: 'not-a-key' } as NodeJS.ProcessEnv)).toThrow('not a valid');
  });
});

describe('buildAnchorMemo', () => {
  it('carries both commitments un-truncated', () => {
    const root = 'a'.repeat(64);
    const mh = 'b'.repeat(64);
    const memo = buildAnchorMemo('pmp_123', root, mh);
    expect(memo).toBe(`clude-anchor|v1|pmp_123|${root}|${mh}`);
  });

  it('refuses to truncate an oversized memo', () => {
    expect(() => buildAnchorMemo('x'.repeat(600), 'r', 'm')).toThrow('refusing to truncate');
  });
});

describe('anchorExportOnChain', () => {
  const input = { artifactId: 'pmp_123', merkleRoot: 'a'.repeat(64), manifestHash: 'b'.repeat(64) };

  it('is a no-op when ANCHOR_EXPORTS_ON_CHAIN is unset (default off)', async () => {
    const res = await anchorExportOnChain(input, { ANCHOR_WALLET_PRIVATE_KEY: anchorB58 } as NodeJS.ProcessEnv);
    expect(res.status).toBe('disabled');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('anchors and returns the txSig when enabled with a dedicated key', async () => {
    sendMock.mockResolvedValue('tx-sig-42');
    const res = await anchorExportOnChain(input, {
      ANCHOR_EXPORTS_ON_CHAIN: 'true',
      ANCHOR_WALLET_PRIVATE_KEY: anchorB58,
      BOT_WALLET_PRIVATE_KEY: treasuryB58,
    } as NodeJS.ProcessEnv);
    expect(res).toEqual({ status: 'anchored', txSig: 'tx-sig-42' });
  });

  it('returns error (never throws) when enabled but pointed at the treasury', async () => {
    const res = await anchorExportOnChain(input, {
      ANCHOR_EXPORTS_ON_CHAIN: 'true',
      ANCHOR_WALLET_PRIVATE_KEY: treasuryB58,
      BOT_WALLET_PRIVATE_KEY: treasuryB58,
    } as NodeJS.ProcessEnv);
    expect(res.status).toBe('error');
    expect(res.error).toContain('TREASURY');
    expect(sendMock).not.toHaveBeenCalled(); // zero anchors signed by the treasury, ever
  });

  it('returns error (never throws) on chain failure', async () => {
    sendMock.mockRejectedValue(new Error('blockhash expired'));
    const res = await anchorExportOnChain(input, {
      ANCHOR_EXPORTS_ON_CHAIN: 'true',
      ANCHOR_WALLET_PRIVATE_KEY: anchorB58,
    } as NodeJS.ProcessEnv);
    expect(res.status).toBe('error');
  });
});

describe('anchorExportBestEffort', () => {
  it('persists anchor_tx_sig + anchor_chain onto the artifact row after confirmation', async () => {
    sendMock.mockResolvedValue('tx-sig-77');
    await anchorExportBestEffort('pmp_9', 'a'.repeat(64), 'b'.repeat(64), {
      ANCHOR_EXPORTS_ON_CHAIN: 'true',
      ANCHOR_WALLET_PRIVATE_KEY: anchorB58,
    } as NodeJS.ProcessEnv);
    expect(updates).toEqual([
      { patch: { anchor_tx_sig: 'tx-sig-77', anchor_chain: 'solana' }, where: { artifact_id: 'pmp_9' } },
    ]);
  });

  it('writes nothing when anchoring is disabled', async () => {
    await anchorExportBestEffort('pmp_9', 'root', 'mh', {} as NodeJS.ProcessEnv);
    expect(updates).toHaveLength(0);
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('isExportAnchoringEnabled', () => {
  it('requires the exact value true', () => {
    expect(isExportAnchoringEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isExportAnchoringEnabled({ ANCHOR_EXPORTS_ON_CHAIN: '1' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isExportAnchoringEnabled({ ANCHOR_EXPORTS_ON_CHAIN: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('attestExport / verifyExportAttestation (B1.2b, one proof-plane identity)', () => {
  const INPUT = {
    artifactId: 'pmp_7',
    merkleRoot: 'a'.repeat(64),
    manifestHash: 'b'.repeat(64),
    createdAt: '2026-07-03T00:00:00.000Z',
  };
  const ENV = { ANCHOR_WALLET_PRIVATE_KEY: anchorB58, BOT_WALLET_PRIVATE_KEY: treasuryB58 } as NodeJS.ProcessEnv;

  it('signs the identity tuple with the anchor key and verifies OFFLINE', () => {
    const att = attestExport(INPUT, ENV);
    expect(att).not.toBeNull();
    expect(att!.pubkey_b58).toBe(anchorKp.publicKey.toBase58());
    expect(att!.message).toBe(`clude-attest|v1|pmp_7|${INPUT.merkleRoot}|${INPUT.manifestHash}|${INPUT.createdAt}`);
    expect(verifyExportAttestation(att!)).toBe(true);
  });

  it('a tampered message fails verification (this is what kills self-consistency-only verify)', () => {
    const att = attestExport(INPUT, ENV)!;
    expect(verifyExportAttestation({ ...att, message: att.message.replace('a', 'c') })).toBe(false);
    expect(verifyExportAttestation({ ...att, signature_b58: att.signature_b58.slice(0, -2) + 'zz' })).toBe(false);
  });

  it('returns null when no key is configured (pre-rollout exports carry no attestation)', () => {
    expect(attestExport(INPUT, {} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('REFUSES to attest with the treasury key (returns null, never signs)', () => {
    const att = attestExport(INPUT, {
      ANCHOR_WALLET_PRIVATE_KEY: treasuryB58,
      BOT_WALLET_PRIVATE_KEY: treasuryB58,
    } as NodeJS.ProcessEnv);
    expect(att).toBeNull();
  });
});
