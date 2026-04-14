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
import { migrateOwnerWallet } from '../agent-tier.js';

const mockGetDb = vi.mocked(getDb);

// Valid test fixtures
const SYNTHETIC_WALLET = 'a'.repeat(44); // 44-char hex string (synthetic)
const SOLANA_WALLET = 'So11111111111111111111111111111111111111112'; // valid base58

function makeUpdateChain() {
  return {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ error: null }),
  };
}

function makeCollisionCheck(hasCollision: boolean) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: hasCollision ? { agent_id: 'agent_other' } : null,
      error: hasCollision ? null : { code: 'PGRST116' },
    }),
  };
}

function makeBalanceSelect(balance: Record<string, unknown> | null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: balance,
      error: balance ? null : { code: 'PGRST116' },
    }),
  };
}

function makeDeleteChain() {
  return {
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ error: null }),
  };
}

function makeUpsertChain() {
  return {
    upsert: vi.fn().mockResolvedValue({ error: null }),
  };
}

describe('migrateOwnerWallet', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('updates all 7 tables when migrating from hex to base58', async () => {
    // chain order: collision check, agent_keys update, memories update,
    // chat_conversations update, chat_usage update, chat_topups update,
    // llm_outputs update, chat_balances select (null — no balance)
    const collisionChain = makeCollisionCheck(false);
    const agentKeysUpdate = makeUpdateChain();
    const memoriesUpdate = makeUpdateChain();
    const conversationsUpdate = makeUpdateChain();
    const usageUpdate = makeUpdateChain();
    const topupsUpdate = makeUpdateChain();
    const llmOutputsUpdate = makeUpdateChain();
    const balanceSelect = makeBalanceSelect(null); // no balance row

    const chains = [
      collisionChain,
      agentKeysUpdate,
      memoriesUpdate,
      conversationsUpdate,
      usageUpdate,
      topupsUpdate,
      llmOutputsUpdate,
      balanceSelect,
    ];

    let callIndex = 0;
    const db = {
      from: vi.fn(() => chains[callIndex++]),
    };
    mockGetDb.mockReturnValue(db as any);

    await migrateOwnerWallet(SYNTHETIC_WALLET, SOLANA_WALLET);

    expect(db.from).toHaveBeenCalledTimes(8);
    expect(db.from).toHaveBeenNthCalledWith(1, 'agent_keys');   // collision check
    expect(db.from).toHaveBeenNthCalledWith(2, 'agent_keys');   // update
    expect(db.from).toHaveBeenNthCalledWith(3, 'memories');
    expect(db.from).toHaveBeenNthCalledWith(4, 'chat_conversations');
    expect(db.from).toHaveBeenNthCalledWith(5, 'chat_usage');
    expect(db.from).toHaveBeenNthCalledWith(6, 'chat_topups');
    expect(db.from).toHaveBeenNthCalledWith(7, 'llm_outputs');
    expect(db.from).toHaveBeenNthCalledWith(8, 'chat_balances');

    // Verify each update chain got the right new wallet
    expect(agentKeysUpdate.update).toHaveBeenCalledWith({ owner_wallet: SOLANA_WALLET });
    expect(memoriesUpdate.update).toHaveBeenCalledWith({ owner_wallet: SOLANA_WALLET });
    expect(conversationsUpdate.update).toHaveBeenCalledWith({ owner_wallet: SOLANA_WALLET });
    expect(usageUpdate.update).toHaveBeenCalledWith({ wallet_address: SOLANA_WALLET });
    expect(topupsUpdate.update).toHaveBeenCalledWith({ wallet_address: SOLANA_WALLET });
    expect(llmOutputsUpdate.update).toHaveBeenCalledWith({ owner_wallet: SOLANA_WALLET });
  });

  it('handles chat_balances PK swap — reads balance, deletes old, upserts new', async () => {
    const existingBalance = {
      wallet_address: SYNTHETIC_WALLET,
      balance_usdc: 500,
      total_deposited: 1000,
      total_spent: 500,
    };

    const collisionChain = makeCollisionCheck(false);
    const agentKeysUpdate = makeUpdateChain();
    const memoriesUpdate = makeUpdateChain();
    const conversationsUpdate = makeUpdateChain();
    const usageUpdate = makeUpdateChain();
    const topupsUpdate = makeUpdateChain();
    const llmOutputsUpdate = makeUpdateChain();
    const balanceSelect = makeBalanceSelect(existingBalance);
    const balanceDelete = makeDeleteChain();
    const balanceUpsert = makeUpsertChain();

    const chains = [
      collisionChain,
      agentKeysUpdate,
      memoriesUpdate,
      conversationsUpdate,
      usageUpdate,
      topupsUpdate,
      llmOutputsUpdate,
      balanceSelect,
      balanceDelete,
      balanceUpsert,
    ];

    let callIndex = 0;
    const db = {
      from: vi.fn(() => chains[callIndex++]),
    };
    mockGetDb.mockReturnValue(db as any);

    await migrateOwnerWallet(SYNTHETIC_WALLET, SOLANA_WALLET);

    expect(db.from).toHaveBeenCalledTimes(10);
    expect(db.from).toHaveBeenNthCalledWith(9, 'chat_balances');  // delete
    expect(db.from).toHaveBeenNthCalledWith(10, 'chat_balances'); // upsert

    // Delete called on old wallet
    expect(balanceDelete.delete).toHaveBeenCalled();
    expect(balanceDelete.eq).toHaveBeenCalledWith('wallet_address', SYNTHETIC_WALLET);

    // Upsert called with new wallet and copied fields
    expect(balanceUpsert.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        wallet_address: SOLANA_WALLET,
        balance_usdc: 500,
        total_deposited: 1000,
        total_spent: 500,
      }),
      { onConflict: 'wallet_address', ignoreDuplicates: false },
    );
  });

  it('throws when oldWallet is not hex (base58 → base58 rejected)', async () => {
    // base58 → base58 should be rejected (source is not synthetic)
    await expect(
      migrateOwnerWallet(SOLANA_WALLET, SOLANA_WALLET)
    ).rejects.toThrow('Source wallet is not synthetic — refusing to migrate');
  });

  it('throws when newWallet is not a valid Solana address', async () => {
    const invalidTarget = 'not-a-valid-address!!';
    await expect(
      migrateOwnerWallet(SYNTHETIC_WALLET, invalidTarget)
    ).rejects.toThrow('Target wallet is not a valid Solana address');
  });

  it('throws when newWallet already belongs to another user (collision guard)', async () => {
    const collisionChain = makeCollisionCheck(true);

    const db = {
      from: vi.fn(() => collisionChain),
    };
    mockGetDb.mockReturnValue(db as any);

    await expect(
      migrateOwnerWallet(SYNTHETIC_WALLET, SOLANA_WALLET)
    ).rejects.toThrow('Target wallet already belongs to another user');

    // Only the collision check should have been called — no updates
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it('skips chat_balances gracefully when no balance row exists', async () => {
    const collisionChain = makeCollisionCheck(false);
    const agentKeysUpdate = makeUpdateChain();
    const memoriesUpdate = makeUpdateChain();
    const conversationsUpdate = makeUpdateChain();
    const usageUpdate = makeUpdateChain();
    const topupsUpdate = makeUpdateChain();
    const llmOutputsUpdate = makeUpdateChain();
    const balanceSelect = makeBalanceSelect(null);

    const chains = [
      collisionChain,
      agentKeysUpdate,
      memoriesUpdate,
      conversationsUpdate,
      usageUpdate,
      topupsUpdate,
      llmOutputsUpdate,
      balanceSelect,
    ];

    let callIndex = 0;
    const db = {
      from: vi.fn(() => chains[callIndex++]),
    };
    mockGetDb.mockReturnValue(db as any);

    // Should not throw
    await expect(migrateOwnerWallet(SYNTHETIC_WALLET, SOLANA_WALLET)).resolves.toBeUndefined();

    // Only 8 calls — no delete/upsert for chat_balances
    expect(db.from).toHaveBeenCalledTimes(8);
  });
});
