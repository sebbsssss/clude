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
  // Step 2.6 in agent-tier provisions an embedded wallet via Privy. In tests
  // we make this throw by default so the flow falls through to step 3
  // (synthetic wallet). Individual tests can override via mockEnsurePrivyWallet.
  ensurePrivySolanaWalletForDid: vi.fn().mockRejectedValue(new Error('test: privy provisioning disabled')),
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

  // Removed: two tests for the auto-adoption of "linked" wallets in step 2.5
  // of findOrCreateAgentForDid. That behavior was removed because Privy's
  // `linked_accounts` is not proof of ownership — it just reports any wallet
  // active in the browser session at signup, which let unrelated history
  // get attached to brand-new email accounts. New email signups now go
  // straight to step 2.6 (provision an embedded Privy wallet) and historical
  // wallet imports happen via an explicit signed-message flow (Phase 2).

  it('falls through to synthetic wallet when Privy embedded-wallet provisioning fails', async () => {
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

  // ---- migrateOwnerWallet collision → adoption branch ----
  // Context: email-only user with synthetic wallet later provides a real
  // wallet. migrateOwnerWallet collides (real wallet already has an agent).
  // The fix adopts the orphan real-wallet agent instead of leaving the user
  // stranded on the synthetic row.
  describe('collision adoption', () => {
    const SYNTHETIC_WALLET = 'a'.repeat(44); // 44-char hex, matches HEX_WALLET_RE
    const REAL_WALLET = 'SoL3333333333333333333333333333333333333333'; // 43-char base58
    const DID = 'did:privy:collision_user';

    function syntheticDidLookup() {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            agent_id: 'agent_synthetic_existing',
            api_key: 'clk_synthetic_key',
            owner_wallet: SYNTHETIC_WALLET,
          },
          error: null,
        }),
      };
    }

    function collisionCheck() {
      // migrateOwnerWallet's collision check: real wallet already has an
      // active agent → triggers throw inside migrateOwnerWallet.
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { agent_id: 'agent_real_wallet' },
          error: null,
        }),
      };
    }

    it('adopts orphan real-wallet agent when wallet is in linked_accounts', async () => {
      mockResolveWallets.mockResolvedValue([REAL_WALLET]);

      const didLookupChain = syntheticDidLookup();
      const collisionChain = collisionCheck();
      // Adoption lookup: real-wallet agent exists AND is orphan (privy_did null)
      const adoptLookupChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { agent_id: 'agent_real_wallet', api_key: 'clk_real_wallet_key' },
          error: null,
        }),
      };
      // Retire synthetic
      const retireChain: any = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
      // Claim real-wallet
      const claimChain: any = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      };

      let callIndex = 0;
      const chains = [didLookupChain, collisionChain, adoptLookupChain, retireChain, claimChain];
      const db = { from: vi.fn(() => chains[callIndex++] ?? claimChain) };
      mockGetDb.mockReturnValue(db as any);

      const result = await findOrCreateAgentForDid(DID, REAL_WALLET);

      expect(result).toEqual({
        apiKey: 'clk_real_wallet_key',
        agentId: 'agent_real_wallet',
        isNew: false,
        ownerWallet: REAL_WALLET,
      });

      // Retire synthetic: privy_did cleared AND is_active=false
      expect(retireChain.update).toHaveBeenCalledWith({ privy_did: null, is_active: false });
      expect(retireChain.eq).toHaveBeenCalledWith('agent_id', 'agent_synthetic_existing');

      // Claim real-wallet agent for the DID
      expect(claimChain.update).toHaveBeenCalledWith({ privy_did: DID });
      expect(claimChain.eq).toHaveBeenCalledWith('agent_id', 'agent_real_wallet');

      // Adoption lookup scoped to orphan rows only
      expect(adoptLookupChain.is).toHaveBeenCalledWith('privy_did', null);
    });

    it('does NOT adopt when wallet is not in Privy linked_accounts (prevents account takeover)', async () => {
      // Privy says this DID does not own the wallet — refuse adoption
      mockResolveWallets.mockResolvedValue([]);

      const didLookupChain = syntheticDidLookup();
      const collisionChain = collisionCheck();
      // No adoption queries should run. Only the above two chains should fire.
      // Any further .from call returns a terminal no-op chain.
      const noopChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        update: vi.fn().mockReturnThis(),
      };

      let callIndex = 0;
      const chains = [didLookupChain, collisionChain];
      const db = { from: vi.fn(() => chains[callIndex++] ?? noopChain) };
      mockGetDb.mockReturnValue(db as any);

      const result = await findOrCreateAgentForDid(DID, REAL_WALLET);

      // Fell through — returned the synthetic agent untouched
      expect(result).toEqual({
        apiKey: 'clk_synthetic_key',
        agentId: 'agent_synthetic_existing',
        isNew: false,
        ownerWallet: SYNTHETIC_WALLET,
      });
    });

    it('does NOT adopt when the real-wallet agent is already claimed by another DID', async () => {
      // Privy confirms ownership, BUT the real-wallet row already has a DID —
      // orphan-only filter excludes it. Refuse to steal another user's claim.
      mockResolveWallets.mockResolvedValue([REAL_WALLET]);

      const didLookupChain = syntheticDidLookup();
      const collisionChain = collisionCheck();
      // Adoption lookup with .is('privy_did', null) finds nothing
      const adoptLookupChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
      };

      let callIndex = 0;
      const chains = [didLookupChain, collisionChain, adoptLookupChain];
      const db = { from: vi.fn(() => chains[callIndex++] ?? adoptLookupChain) };
      mockGetDb.mockReturnValue(db as any);

      const result = await findOrCreateAgentForDid(DID, REAL_WALLET);

      // Fell through — returned synthetic agent, didn't touch the claimed row
      expect(result).toEqual({
        apiKey: 'clk_synthetic_key',
        agentId: 'agent_synthetic_existing',
        isNew: false,
        ownerWallet: SYNTHETIC_WALLET,
      });
    });
  });
});
