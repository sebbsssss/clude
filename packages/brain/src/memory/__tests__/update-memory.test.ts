/**
 * updateMemory / deleteMemory — the shared write path behind the MCP
 * update_memory / delete_memory tools (self-hosted) and PATCH / DELETE
 * /api/cortex/memories/:id (hosted).
 *
 * Guarantees under test:
 *  - Both writes carry the owner_wallet filter from the async owner context.
 *  - updateMemory reports false when the scoped UPDATE matched no row, and in
 *    that case never touches memory_dek_wraps or the lexical index (both are
 *    keyed by memory_id alone, so touching them for a foreign id would corrupt
 *    another tenant's row).
 *  - A content edit goes through the same at-rest encryption as storeMemory:
 *    plaintext when encryption is off (flags cleared), envelope ciphertext +
 *    replaced DEK wraps when it is on, and the lexical index is refreshed from
 *    the plaintext either way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.SITE_ONLY = 'true';
});

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ---- Recording Supabase double ----------------------------------------------
type DbResult = { data?: any; error?: any };
const dbQueue: DbResult[] = [];
const dbCalls: Array<{ method: string; args: unknown[] }> = [];

function chain(): any {
  const terminal = {
    then: (ok: any, ko: any) =>
      Promise.resolve(dbQueue.shift() ?? { data: null, error: null }).then(ok, ko),
  };
  return new Proxy(terminal, {
    get(target, prop: string | symbol) {
      if (prop in target || typeof prop === 'symbol') return (target as any)[prop];
      return (...args: unknown[]) => {
        dbCalls.push({ method: prop, args });
        return chain();
      };
    },
  });
}

const mockDb = {
  from: (table: string) => {
    dbCalls.push({ method: 'from', args: [table] });
    return chain();
  },
  rpc: vi.fn(async () => ({ error: null })),
};
vi.mock('@clude/shared/core/database', () => ({ getDb: () => mockDb }));

// Keep the fire-and-forget collaborators imported by memory.ts inert.
vi.mock('@clude/shared/core/embeddings', () => ({
  generateEmbedding: vi.fn(async () => null),
  generateQueryEmbedding: vi.fn(async () => null),
  generateEmbeddings: vi.fn(async () => []),
  isEmbeddingEnabled: () => false,
}));
vi.mock('@clude/shared/core/solana-client', () => ({
  writeMemo: vi.fn(async () => null),
  isRegistryEnabled: () => false,
  registerMemoryOnChain: vi.fn(async () => null),
}));
vi.mock('../graph', () => ({
  extractAndLinkEntities: vi.fn(async () => undefined),
  findSimilarEntities: vi.fn(async () => []),
  getMemoriesByEntity: vi.fn(async () => []),
  getEntityCooccurrences: vi.fn(async () => []),
}));

const mockSetContentTokens = vi.fn(async (..._args: any[]) => undefined);
vi.mock('../content-tokens', () => ({
  setContentTokens: (...args: any[]) => mockSetContentTokens(...args),
}));

// Encryption seams: envelope (PMP §5) and the legacy SDK scheme.
const mockEncryptForStorage = vi.fn();
vi.mock('../memory-encryption', () => ({
  encryptForStorage: (...args: any[]) => mockEncryptForStorage(...args),
  delegationStateForWrite: (hasEnvelope: boolean) => (hasEnvelope ? true : null),
}));
const mockIsEncryptionEnabled = vi.fn(() => false);
vi.mock('@clude/shared/core/encryption', () => ({
  isEncryptionEnabled: () => mockIsEncryptionEnabled(),
  getEncryptionPubkey: () => null,
  encryptContent: (s: string) => `legacy(${s})`,
  decryptMemoryBatch: (rows: unknown[]) => rows,
}));

import { withOwnerWallet } from '@clude/shared/core/owner-context';
import { updateMemory, deleteMemory } from '../memory';

const WALLET = 'OwnerWallet11111111111111111111111111111111';
const ENVELOPE = {
  ciphertext: 'CIPHERTEXT',
  ownerPubkey: 'OWNER_PUBKEY',
  wraps: [
    { recipient: 'owner', wrapped_dek: 'wo', wrap_pubkey: 'po' },
    { recipient: 'provider', wrapped_dek: 'wp', wrap_pubkey: 'pp' },
  ],
};

function callsFor(method: string) {
  return dbCalls.filter(c => c.method === method);
}
function tablesOpened() {
  return callsFor('from').map(c => c.args[0]);
}

beforeEach(() => {
  dbQueue.length = 0;
  dbCalls.length = 0;
  mockSetContentTokens.mockClear();
  mockEncryptForStorage.mockReset().mockResolvedValue(null);
  mockIsEncryptionEnabled.mockReset().mockReturnValue(false);
});

describe('updateMemory', () => {
  it('scopes the UPDATE to the owner in context and returns true when a row matched', async () => {
    dbQueue.push({ data: [{ id: 5 }], error: null });

    const ok = await withOwnerWallet(WALLET, () => updateMemory(5, { summary: 'S', importance: 2 }));

    expect(ok).toBe(true);
    expect(dbCalls).toEqual(expect.arrayContaining([
      { method: 'from', args: ['memories'] },
      { method: 'update', args: [{ summary: 'S', importance: 1 }] }, // importance clamped to [0, 1]
      { method: 'eq', args: ['id', 5] },
      { method: 'eq', args: ['owner_wallet', WALLET] },
      { method: 'select', args: ['id'] },
    ]));
  });

  it('returns true without touching the DB for an empty patch', async () => {
    const ok = await withOwnerWallet(WALLET, () => updateMemory(5, {}));
    expect(ok).toBe(true);
    expect(dbCalls).toHaveLength(0);
  });

  it('returns false when the scoped UPDATE matched no row, and never touches wraps or the lexical index', async () => {
    dbQueue.push({ data: [], error: null }); // row exists for another tenant (or not at all)

    const ok = await withOwnerWallet(WALLET, () => updateMemory(5, { content: 'new body' }));

    expect(ok).toBe(false);
    expect(tablesOpened()).toEqual(['memories']);
    expect(mockSetContentTokens).not.toHaveBeenCalled();
  });

  it('returns false on a DB error', async () => {
    dbQueue.push({ data: null, error: { message: 'db down' } });

    const ok = await withOwnerWallet(WALLET, () => updateMemory(5, { summary: 'x' }));

    expect(ok).toBe(false);
    expect(mockSetContentTokens).not.toHaveBeenCalled();
  });

  it('content edit with encryption off: writes plaintext, clears the encryption flags, refreshes the lexical index', async () => {
    dbQueue.push({ data: [{ id: 5 }], error: null }); // UPDATE memories
    dbQueue.push({ error: null });                     // DELETE stale memory_dek_wraps

    const ok = await withOwnerWallet(WALLET, () => updateMemory(5, { content: 'new body' }));

    expect(ok).toBe(true);
    expect(mockEncryptForStorage).toHaveBeenCalledWith('new body', WALLET);
    expect(callsFor('update')[0].args[0]).toEqual({
      content: 'new body',
      encrypted: false,
      encryption_pubkey: null,
      provider_delegated: null,
    });
    expect(tablesOpened()).toEqual(['memories', 'memory_dek_wraps']);
    expect(callsFor('delete')).toHaveLength(1);
    expect(callsFor('insert')).toHaveLength(0);
    expect(mockSetContentTokens).toHaveBeenCalledWith(mockDb, 5, 'new body');
  });

  it('content edit with envelope encryption on: writes ciphertext + flags and replaces the DEK wraps', async () => {
    mockEncryptForStorage.mockResolvedValue(ENVELOPE);
    dbQueue.push({ data: [{ id: 5 }], error: null }); // UPDATE memories
    dbQueue.push({ error: null });                     // DELETE old wraps
    dbQueue.push({ error: null });                     // INSERT new wraps

    const ok = await withOwnerWallet(WALLET, () => updateMemory(5, { content: 'new secret' }));

    expect(ok).toBe(true);
    expect(callsFor('update')[0].args[0]).toEqual({
      content: 'CIPHERTEXT',
      encrypted: true,
      encryption_pubkey: 'OWNER_PUBKEY',
      provider_delegated: true,
    });
    expect(tablesOpened()).toEqual(['memories', 'memory_dek_wraps', 'memory_dek_wraps']);
    expect(callsFor('eq')).toContainEqual({ method: 'eq', args: ['memory_id', 5] });
    expect(callsFor('insert')[0].args[0]).toEqual(
      ENVELOPE.wraps.map(w => ({ memory_id: 5, ...w })),
    );
    // Lexical index is built from the PLAINTEXT, never the ciphertext.
    expect(mockSetContentTokens).toHaveBeenCalledWith(mockDb, 5, 'new secret');
  });

  it('content edit with the legacy SDK scheme on: writes legacy ciphertext with encrypted:true', async () => {
    mockIsEncryptionEnabled.mockReturnValue(true);
    dbQueue.push({ data: [{ id: 5 }], error: null });
    dbQueue.push({ error: null });

    const ok = await withOwnerWallet(WALLET, () => updateMemory(5, { content: 'new body' }));

    expect(ok).toBe(true);
    expect(callsFor('update')[0].args[0]).toMatchObject({
      content: 'legacy(new body)',
      encrypted: true,
      provider_delegated: null,
    });
    expect(mockSetContentTokens).toHaveBeenCalledWith(mockDb, 5, 'new body');
  });

  it('reverts the row to plaintext-at-rest when the DEK wrap write fails (same rule as storeMemory)', async () => {
    mockEncryptForStorage.mockResolvedValue(ENVELOPE);
    dbQueue.push({ data: [{ id: 5 }], error: null });         // UPDATE memories (ciphertext)
    dbQueue.push({ error: null });                             // DELETE old wraps
    dbQueue.push({ error: { message: 'wrap insert failed' } }); // INSERT new wraps → fails
    dbQueue.push({ error: null });                             // revert UPDATE

    const ok = await withOwnerWallet(WALLET, () => updateMemory(5, { content: 'new secret' }));

    expect(ok).toBe(true);
    const updates = callsFor('update').map(c => c.args[0]);
    expect(updates).toHaveLength(2);
    expect(updates[1]).toEqual({
      content: 'new secret',
      encrypted: false,
      encryption_pubkey: null,
      provider_delegated: null,
    });
  });
});

describe('deleteMemory', () => {
  it('scopes the DELETE to the owner in context', async () => {
    dbQueue.push({ error: null });

    const ok = await withOwnerWallet(WALLET, () => deleteMemory(9));

    expect(ok).toBe(true);
    expect(dbCalls).toEqual(expect.arrayContaining([
      { method: 'from', args: ['memories'] },
      { method: 'delete', args: [] },
      { method: 'eq', args: ['id', 9] },
      { method: 'eq', args: ['owner_wallet', WALLET] },
    ]));
  });

  it('returns false on a DB error', async () => {
    dbQueue.push({ error: { message: 'db down' } });
    const ok = await withOwnerWallet(WALLET, () => deleteMemory(9));
    expect(ok).toBe(false);
  });
});
