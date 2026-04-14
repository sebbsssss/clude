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

import { getDb } from '@clude/shared/core/database';
import { findOrCreateAgentForDid } from '../agent-tier.js';

const mockGetDb = vi.mocked(getDb);

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
});
