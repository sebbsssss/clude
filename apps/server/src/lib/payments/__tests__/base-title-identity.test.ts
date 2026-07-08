import { describe, it, expect, beforeEach } from 'vitest';
import { createCustodialBaseResolver } from '../base-identity.js';
import { ensureCustodialTitleIdentity, CUSTODIAL_VERIFIER, type DbLike } from '../base-title-identity.js';

const SEED = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // 64-hex = 32 bytes
const ALICE = 'AliceSolanaWa11et1111111111111111111111111';
const resolver = createCustodialBaseResolver(SEED);

/** Supabase mock backing one `tables` store, honouring select().eq().maybeSingle() + upsert(onConflict). */
function makeDb(opts: { failUpsert?: boolean; failSelect?: boolean; seed?: any[] } = {}) {
  const tables: Record<string, any[]> = { encryption_keys: opts.seed ? [...opts.seed] : [] };
  const db: DbLike & { tables: Record<string, any[]> } = {
    tables,
    from(table: string) {
      tables[table] = tables[table] ?? [];
      return {
        select(_cols: string) {
          let rows = tables[table];
          const api: any = {
            eq(col: string, val: any) {
              rows = rows.filter((r) => r[col] === val);
              return api;
            },
            async maybeSingle() {
              if (opts.failSelect) return { data: null, error: { message: 'sel boom' } };
              return { data: rows[0] ?? null, error: null };
            },
          };
          return api;
        },
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

  it('is idempotent — re-publishing keeps exactly one row and skips the write when unchanged', async () => {
    await ensureCustodialTitleIdentity(db, resolver, ALICE);
    await ensureCustodialTitleIdentity(db, resolver, ALICE);
    expect(db.tables.encryption_keys).toHaveLength(1);
  });

  it('REFUSES to overwrite a non-custodial (real user) owner key at the same address', async () => {
    const baseAddr = resolver.addressFor(ALICE);
    const seeded = makeDb({
      seed: [{ owner_wallet: baseAddr, x25519_pubkey: 'USER-REAL-KEY', verifier_ct: 'real-verifier-token' }],
    });
    await expect(ensureCustodialTitleIdentity(seeded, resolver, ALICE)).rejects.toThrow(
      /refusing to overwrite a non-custodial owner key/,
    );
    // the user's key is untouched
    expect(seeded.tables.encryption_keys[0].x25519_pubkey).toBe('USER-REAL-KEY');
  });

  it('throws (fail closed) if the existing-key lookup errors', async () => {
    const failing = makeDb({ failSelect: true });
    await expect(ensureCustodialTitleIdentity(failing, resolver, ALICE)).rejects.toThrow(
      /failed to read existing encryption key/,
    );
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
