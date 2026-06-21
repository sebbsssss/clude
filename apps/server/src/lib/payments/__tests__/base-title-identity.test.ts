import { describe, it, expect, beforeEach } from 'vitest';
import { createCustodialBaseResolver } from '../base-identity.js';
import { ensureCustodialTitleIdentity, CUSTODIAL_VERIFIER, type DbLike } from '../base-title-identity.js';

const SEED = 'test-seed-0123456789abcdef';
const ALICE = 'AliceSolanaWa11et1111111111111111111111111';
const resolver = createCustodialBaseResolver(SEED);

/** Tiny upsert-capturing Supabase mock honouring onConflict: 'owner_wallet'. */
function makeDb(opts: { failUpsert?: boolean } = {}) {
  const tables: Record<string, any[]> = {};
  const db: DbLike & { tables: Record<string, any[]> } = {
    tables,
    from(table: string) {
      tables[table] = tables[table] ?? [];
      return {
        async upsert(row: any, conf: { onConflict?: string }) {
          if (opts.failUpsert) return { error: { message: 'boom' } };
          const key = conf?.onConflict ?? 'id';
          const i = tables[table].findIndex((r) => r[key] === row[key]);
          if (i >= 0) tables[table][i] = row;
          else tables[table].push(row);
          return { error: null };
        },
      };
    },
  };
  return db;
}

describe('ensureCustodialTitleIdentity', () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => {
    db = makeDb();
  });

  it('publishes the derived custodial X25519 key under the user Base address', async () => {
    const id = await ensureCustodialTitleIdentity(db, resolver, ALICE);

    expect(id.baseAddress).toBe(resolver.addressFor(ALICE));
    const keys = resolver.keysFor(ALICE);
    expect(id.x25519PublicKeyB64).toBe(keys.x25519PublicKeyB64);

    const rows = db.tables.encryption_keys ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      owner_wallet: keys.address,
      x25519_pubkey: keys.x25519PublicKeyB64,
      verifier_ct: CUSTODIAL_VERIFIER,
    });
  });

  it('is idempotent — re-publishing keeps exactly one row (PK owner_wallet)', async () => {
    await ensureCustodialTitleIdentity(db, resolver, ALICE);
    await ensureCustodialTitleIdentity(db, resolver, ALICE);
    expect(db.tables.encryption_keys).toHaveLength(1);
  });

  it('throws (fail closed) if the key publish errors', async () => {
    const failing = makeDb({ failUpsert: true });
    await expect(ensureCustodialTitleIdentity(failing, resolver, ALICE)).rejects.toThrow(
      /failed to publish custodial encryption key/,
    );
  });

  it('rejects an empty app wallet (propagated from the resolver)', async () => {
    await expect(ensureCustodialTitleIdentity(db, resolver, '')).rejects.toThrow(/appWallet is required/);
  });
});
