import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clude/shared/core/database', () => ({
  getDb: vi.fn(),
}));

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../auth/privy-wallet-resolver', () => ({
  resolveWalletsForDid: vi.fn().mockResolvedValue([]),
}));

import { getDb } from '@clude/shared/core/database';
import { resolveWalletsForDid } from '../../auth/privy-wallet-resolver';
import { findOrCreateAgentForDid } from '../agent-tier.js';

const mockGetDb = vi.mocked(getDb);
const mockResolveWallets = vi.mocked(resolveWalletsForDid);

function makeChain(terminalValue: any) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(terminalValue),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ error: null }),
  };
  return chain;
}

function makeDb(chains: any[]) {
  let callIndex = 0;
  return {
    from: vi.fn(() => {
      const chain = chains[callIndex] ?? chains[chains.length - 1];
      callIndex++;
      return chain;
    }),
  };
}

describe('findOrCreateAgentForDid', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockResolveWallets.mockResolvedValue([]);
  });

  it('returns existing agent when DID is already registered', async () => {
    const existingData = {
      agent_id: 'agent_existing123',
      api_key: 'clk_existingkey',
      owner_wallet: 'wallet_existing',
    };

    const lookupChain = makeChain({ data: existingData, error: null });
    const db = makeDb([lookupChain]);
    mockGetDb.mockReturnValue(db as any);

    const result = await findOrCreateAgentForDid('did:privy:abc123');

    expect(result).toEqual({
      apiKey: 'clk_existingkey',
      agentId: 'agent_existing123',
      isNew: false,
      ownerWallet: 'wallet_existing',
    });
    expect(lookupChain.eq).toHaveBeenCalledWith('privy_did', 'did:privy:abc123');
    expect(lookupChain.eq).toHaveBeenCalledWith('is_active', true);
  });

  it('calls findOrCreateAgentForWallet and backfills privy_did when wallet is provided', async () => {
    const wallet = 'wallet_addr_xyz';
    const did = 'did:privy:newdid456';

    // First call: DID lookup returns nothing
    const didLookupChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
    };

    // Second call: wallet lookup finds existing agent
    const walletLookupChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { agent_id: 'agent_wallet99', api_key: 'clk_walletkey99' },
        error: null,
      }),
    };

    // Third call: backfill update
    const updateChain: any = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };

    let callIndex = 0;
    const allChains = [didLookupChain, walletLookupChain, updateChain];
    const db = {
      from: vi.fn(() => allChains[callIndex++] ?? updateChain),
    };
    mockGetDb.mockReturnValue(db as any);

    const result = await findOrCreateAgentForDid(did, wallet);

    expect(result.apiKey).toBe('clk_walletkey99');
    expect(result.agentId).toBe('agent_wallet99');
    expect(result.isNew).toBe(false);
    expect(result.ownerWallet).toBe(wallet);
    expect(updateChain.update).toHaveBeenCalledWith({ privy_did: did });
  });

  it('creates agent with synthetic owner_wallet when no wallet is provided', async () => {
    const did = 'did:privy:emailonly789';

    // DID lookup returns nothing
    const didLookupChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
    };

    // registerAgent insert
    const insertChain: any = {
      insert: vi.fn().mockResolvedValue({ error: null }),
    };

    // update for synthetic wallet + privy_did backfill
    const updateChain: any = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };

    let callIndex = 0;
    const allChains = [didLookupChain, insertChain, updateChain];
    const db = {
      from: vi.fn(() => allChains[callIndex++] ?? updateChain),
    };
    mockGetDb.mockReturnValue(db as any);

    const result = await findOrCreateAgentForDid(did);

    expect(result.isNew).toBe(true);
    expect(result.ownerWallet).toBeTruthy();
    expect(result.agentId).toMatch(/^agent_/);
    expect(result.apiKey).toMatch(/^clk_/);
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ privy_did: did }),
    );
  });

  it('generates a 44-character hex synthetic wallet for email-only users', async () => {
    const did = 'did:privy:hexcheck999';

    const didLookupChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
    };
    const insertChain: any = {
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
    const updateChain: any = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };

    let callIndex = 0;
    const allChains = [didLookupChain, insertChain, updateChain];
    const db = {
      from: vi.fn(() => allChains[callIndex++] ?? updateChain),
    };
    mockGetDb.mockReturnValue(db as any);

    const result = await findOrCreateAgentForDid(did);

    expect(result.ownerWallet).toHaveLength(44);
    expect(result.ownerWallet).toMatch(/^[0-9a-f]+$/);
  });

  it('returns cached agent on second call for same DID', async () => {
    const did = 'did:privy:repeat111';
    const existingData = {
      agent_id: 'agent_repeat111',
      api_key: 'clk_repeatkey',
      owner_wallet: 'wallet_repeat',
    };

    const makeExistingChain = () => makeChain({ data: existingData, error: null });

    let callIndex = 0;
    const chains = [makeExistingChain(), makeExistingChain()];
    const db = {
      from: vi.fn(() => chains[callIndex++] ?? chains[chains.length - 1]),
    };
    mockGetDb.mockReturnValue(db as any);

    const first = await findOrCreateAgentForDid(did);
    const second = await findOrCreateAgentForDid(did);

    expect(first.agentId).toBe('agent_repeat111');
    expect(second.agentId).toBe('agent_repeat111');
    expect(first.isNew).toBe(false);
    expect(second.isNew).toBe(false);
  });

  it('adopts an existing unclaimed wallet agent when Privy reports a linked wallet', async () => {
    const did = 'did:privy:emailuser_adopt';
    const linkedWallet = 'SoL1111111111111111111111111111111111111111';
    mockResolveWallets.mockResolvedValue([linkedWallet]);

    // 1. DID lookup misses
    const didLookupChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
    };
    // 2. Linked-wallet adoption lookup — finds an orphan agent
    const adoptLookupChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { agent_id: 'agent_existing_wallet', api_key: 'clk_wallet_preexisting' },
        error: null,
      }),
    };
    // 3. Backfill privy_did on the adopted row
    const backfillChain: any = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };

    let callIndex = 0;
    const chains = [didLookupChain, adoptLookupChain, backfillChain];
    const db = { from: vi.fn(() => chains[callIndex++] ?? backfillChain) };
    mockGetDb.mockReturnValue(db as any);

    const result = await findOrCreateAgentForDid(did);

    expect(result).toEqual({
      apiKey: 'clk_wallet_preexisting',
      agentId: 'agent_existing_wallet',
      isNew: false,
      ownerWallet: linkedWallet,
    });
    expect(adoptLookupChain.eq).toHaveBeenCalledWith('owner_wallet', linkedWallet);
    expect(adoptLookupChain.is).toHaveBeenCalledWith('privy_did', null);
    expect(backfillChain.update).toHaveBeenCalledWith({ privy_did: did });
  });

  it('does not adopt when the linked wallet agent is already claimed by another DID', async () => {
    const did = 'did:privy:emailuser_noclaim';
    const linkedWallet = 'SoL2222222222222222222222222222222222222222';
    mockResolveWallets.mockResolvedValue([linkedWallet]);

    // 1. DID lookup misses
    const didLookupChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
    };
    // 2. Adoption lookup — row exists but is_active+privy_did=null filter excludes it,
    //    so .single() returns no data (simulating already-claimed agent)
    const adoptLookupChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
    };
    // 3. Falls through to synthetic-wallet registerAgent insert
    const insertChain: any = {
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
    // 4. Update synthetic wallet + privy_did on newly-created row
    const updateChain: any = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };

    let callIndex = 0;
    const chains = [didLookupChain, adoptLookupChain, insertChain, updateChain];
    const db = { from: vi.fn(() => chains[callIndex++] ?? updateChain) };
    mockGetDb.mockReturnValue(db as any);

    const result = await findOrCreateAgentForDid(did);

    // Got a brand-new synthetic-wallet agent, not the claimed one
    expect(result.isNew).toBe(true);
    expect(result.ownerWallet).toHaveLength(44);
    expect(result.ownerWallet).toMatch(/^[0-9a-f]+$/);
    expect(result.agentId).not.toBe('agent_existing_wallet');
  });

  it('falls through to synthetic wallet when Privy linked-wallet lookup throws', async () => {
    const did = 'did:privy:emailuser_privydown';
    mockResolveWallets.mockRejectedValue(new Error('Privy API 500'));

    const didLookupChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
    };
    const insertChain: any = {
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
    const updateChain: any = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };

    let callIndex = 0;
    const chains = [didLookupChain, insertChain, updateChain];
    const db = { from: vi.fn(() => chains[callIndex++] ?? updateChain) };
    mockGetDb.mockReturnValue(db as any);

    const result = await findOrCreateAgentForDid(did);

    expect(result.isNew).toBe(true);
    expect(result.ownerWallet).toHaveLength(44);
  });
});
