/**
 * mint-solana-title-on-export — the export-time orchestration (snapshot → mint).
 *
 * Unit-tests the orchestration in isolation: the snapshot + mint primitives are mocked (each is tested +
 * backtested on its own), so here we only assert the WIRING — that the title is minted against the
 * SNAPSHOT pack id (never the live source) to the creator's own wallet, and the combined result + the
 * idempotent re-export flow through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../snapshot-pack-for-title-solana.js', () => ({
  snapshotPackForTitleSolana: vi.fn(),
}));
vi.mock('../solana-title-record.js', () => ({
  mintSolanaTitleForPack: vi.fn(),
}));

import { mintSolanaTitleOnExport } from '../mint-solana-title-on-export.js';
import { snapshotPackForTitleSolana } from '../snapshot-pack-for-title-solana.js';
import { mintSolanaTitleForPack } from '../solana-title-record.js';

const SOURCE = 'clude-pack-src';
const SNAP = 'tsnap-sol-deadbeef';
const USER = 'User9osNw7d44tryaeaiZ5KScQckB83okeaB3UDLj8u';
const sol = { network: 'devnet' as const, mintTitle: vi.fn(), titleOwner: vi.fn() } as any;
const db = { from: vi.fn() } as any;

beforeEach(() => {
  vi.mocked(snapshotPackForTitleSolana).mockReset();
  vi.mocked(mintSolanaTitleForPack).mockReset();
});

describe('mintSolanaTitleOnExport', () => {
  it('snapshots the source, then mints the title against the SNAPSHOT to the creator wallet', async () => {
    vi.mocked(snapshotPackForTitleSolana).mockResolvedValue({ snapshotPackId: SNAP, merkleRoot: 'ROOT', manifestHash: 'M', memberCount: 2, reused: false });
    vi.mocked(mintSolanaTitleForPack).mockResolvedValue({ mintAddress: 'Mint1', txSig: 'sig-abc', alreadyMinted: false, chain: 'solana-devnet' });

    const res = await mintSolanaTitleOnExport(db, sol, { sourcePackId: SOURCE, creatorWallet: USER });

    // snapshot freezes the SOURCE pack for the creator
    expect(snapshotPackForTitleSolana).toHaveBeenCalledWith(db, SOURCE, USER);
    // the mint binds the SNAPSHOT pack id (never the live source) and goes to the creator's own wallet
    expect(mintSolanaTitleForPack).toHaveBeenCalledWith(db, sol, SNAP, USER);

    expect(res).toEqual({ snapshotPackId: SNAP, mintAddress: 'Mint1', txSig: 'sig-abc', alreadyMinted: false, chain: 'solana-devnet' });
  });

  it('flows an idempotent re-export through (alreadyMinted, no tx)', async () => {
    vi.mocked(snapshotPackForTitleSolana).mockResolvedValue({ snapshotPackId: SNAP, merkleRoot: 'ROOT', manifestHash: 'M', memberCount: 2, reused: true });
    vi.mocked(mintSolanaTitleForPack).mockResolvedValue({ mintAddress: 'Mint1', txSig: null, alreadyMinted: true, chain: 'solana-devnet' });

    const res = await mintSolanaTitleOnExport(db, sol, { sourcePackId: SOURCE, creatorWallet: USER });
    expect(res.alreadyMinted).toBe(true);
    expect(res.txSig).toBeNull();
    expect(res.snapshotPackId).toBe(SNAP);
  });

  it('propagates a snapshot failure without minting (never mint against an unfrozen pack)', async () => {
    vi.mocked(snapshotPackForTitleSolana).mockRejectedValue(new Error('not tokenised'));
    await expect(mintSolanaTitleOnExport(db, sol, { sourcePackId: SOURCE, creatorWallet: USER })).rejects.toThrow(/not tokenised/i);
    expect(mintSolanaTitleForPack).not.toHaveBeenCalled();
  });
});
