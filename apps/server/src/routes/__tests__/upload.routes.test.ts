import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * Owner-trust / forged-wallet regression for the file-upload → memory-ingestion
 * pipeline (upload.routes.ts).
 *
 * The upload routes ingest arbitrary file text as MEMORIES scoped to a wallet.
 * Before the fix the handlers scoped to a CLIENT-SUPPLIED ?wallet= / multipart
 * `wallet` field with no proof of ownership, so any authenticated caller could
 * pass wallet=<allowlisted-victim> and read that victim's batches OR (worse)
 * inject memories into the victim's brain via /process.
 *
 * The fix puts every route behind requirePrivyAuth + requireOwnership and scopes
 * strictly to req.verifiedWallet — a wallet the caller has PROVABLY proven they
 * own. The allowlist (ALLOWED_WALLETS) is then checked on that verified wallet.
 *
 * These tests pin:
 *   - no auth                                  → 401  (/batches, /process, /batch/:id, /check-access)
 *   - authed caller who does NOT own the
 *     allowlisted victim wallet (forges it)    → 403, and /process NEVER inserts
 *   - the proven owner (Privy-linked wallet)   → 200 and the owner path works
 *   - the proven owner via Cortex clk_ key     → 200 (no ?wallet=, owner_wallet
 *                                                 resolved from the agent row)
 *   - a proven owner whose wallet is NOT on
 *     the allowlist                            → 403 (allowlist still enforced)
 */

const H = vi.hoisted(() => {
  // Valid base58 Solana addresses (allowlist members in the real route).
  const OWNER_WALLET = '5vK6WRCq5V6BCte8cQvaNeNv2KzErCfGzeBDwtBGGv2r';
  const SECOND_ALLOWED = '91K7zE12yBQcwYwdBs6JSzt73sYv8SdRdSoYQME4rH1d';
  const VICTIM_WALLET = OWNER_WALLET; // the allowlisted wallet an attacker wants to forge
  const ATTACKER_WALLET = '7yTn4kQ9xZbVfWmJpLcGdReSaHuKvNwQxYzAbCdEfGh1'; // authed, NOT allowlisted
  const UNLISTED_OWNER = '3pQr5sTuVwXyZaBcDeFgHjKmNpQrStUvWxYz12345678'; // proves a wallet, not allowlisted

  return {
    OWNER_WALLET,
    SECOND_ALLOWED,
    VICTIM_WALLET,
    ATTACKER_WALLET,
    UNLISTED_OWNER,
    // Mutable auth state the mocks read; reset in beforeEach.
    state: {
      loggedIn: true,
      // The single wallet the CURRENT caller has proven they own (Privy-linked
      // wallet OR clk_ key owner_wallet). null = no proof / not authenticated.
      callerOwnedWallet: OWNER_WALLET as string | null,
      // When true the caller authenticates with a Cortex clk_ key (no ?wallet=).
      useCortexKey: false,
    },
    // Records of every llm_outputs INSERT, so we can assert /process never writes
    // for a forged wallet.
    inserts: [] as Array<{ table: string; rows: any[] }>,
    drainPending: vi.fn(),
    openRouterEnabled: true,
  };
});

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ALLOWED_WALLETS is built at module load from config.owner.wallet (+ a hardcoded
// second wallet). Supply the owner so the allowlist matches the real route.
vi.mock('@clude/shared/config', () => ({ config: { owner: { wallet: H.OWNER_WALLET } } }));

// LLM must look "configured" so /process reaches the DB-insert path instead of
// bailing 500 before we can observe whether it writes.
vi.mock('@clude/shared/core/openrouter-client', () => ({
  isOpenRouterEnabled: () => H.openRouterEnabled,
}));

// Background processor — spy, must never run real work in a unit test.
vi.mock('@clude/brain/services/upload-processor', () => ({
  drainPending: H.drainPending,
}));

// requirePrivyAuth: 401 if no session, else attach a privyUser.
vi.mock('@clude/brain/auth/privy-auth', () => ({
  requirePrivyAuth: (req: any, res: any, next: any) => {
    if (!H.state.loggedIn) { res.status(401).json({ error: 'auth required' }); return; }
    req.privyUser = { userId: 'did:test', appId: 'test-app' };
    next();
  },
}));

// requireOwnership: FAITHFUL to the real contract.
//  - No session → 401.
//  - Cortex clk_ path (no claimed wallet): resolve owner_wallet from the agent
//    row → verifiedWallet. (Mirrors the real authenticateAgent branch.)
//  - A claimed ?wallet= / body.wallet that the caller does NOT own → 403.
//  - A claimed wallet the caller DOES own → verifiedWallet set, next().
// NOTE: on /process this runs AFTER multer, so req.body.wallet (the multipart
// field) is populated — exactly like production.
vi.mock('@clude/brain/auth/require-ownership', () => ({
  requireOwnership: (req: any, res: any, next: any) => {
    if (!H.state.callerOwnedWallet) { res.status(401).json({ error: 'auth required' }); return; }

    const claimed =
      (typeof req.query?.wallet === 'string' ? req.query.wallet : undefined) ||
      (req.body && typeof req.body.wallet === 'string' ? req.body.wallet : undefined);

    // No wallet claimed → resolve from the caller's identity (Privy DID or clk_
    // key). In both cases the resolved wallet is the one the caller owns.
    if (!claimed) {
      req.verifiedWallet = H.state.callerOwnedWallet;
      next();
      return;
    }

    // A wallet was claimed — only honour it if the caller actually owns it.
    if (claimed !== H.state.callerOwnedWallet) {
      res.status(403).json({ error: 'Wallet not linked to your account' });
      return;
    }
    req.verifiedWallet = H.state.callerOwnedWallet;
    next();
  },
}));

// Table-routed Supabase mock. Reads return rows scoped to the eq('owner_wallet')
// filter (so a leak would surface). Inserts are recorded on H.inserts.
vi.mock('@clude/shared/core/database', () => ({
  getDb: () => {
    const filters: Record<string, unknown> = {};
    let table = '';
    let op: 'select' | 'insert' = 'select';
    let insertRows: any[] = [];
    const chain: Record<string, unknown> = {
      from(t: string) { table = t; return chain; },
      select() { op = 'select'; return chain; },
      insert(rows: any) {
        op = 'insert';
        insertRows = Array.isArray(rows) ? rows : [rows];
        H.inserts.push({ table, rows: insertRows });
        return chain;
      },
      eq(c: string, v: unknown) { filters[c] = v; return chain; },
      like() { return chain; },
      order() { return chain; },
      then(resolve: (r: { data: unknown; error: null }) => void) {
        if (op === 'insert') { resolve({ data: null, error: null }); return; }
        // SELECT on llm_outputs: only the owner has rows in this fixture.
        if (table === 'llm_outputs' && filters['owner_wallet'] === H.OWNER_WALLET) {
          resolve({
            data: [
              {
                batch_id: 'batch-owner-1',
                document_title: 'Owner Doc',
                file_name: 'owner.txt',
                status: 'completed',
                parsed_node_count: 3,
                created_at: '2026-06-01T00:00:00Z',
                error_message: null,
                chunk_index: 0,
                raw_response: '',
              },
            ],
            error: null,
          });
          return;
        }
        resolve({ data: [], error: null });
      },
    };
    return chain;
  },
}));

// eslint-disable-next-line import/first
import { uploadRoutes } from '../upload.routes.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/upload', uploadRoutes());
  return a;
}

beforeEach(() => {
  H.state.loggedIn = true;
  H.state.callerOwnedWallet = H.OWNER_WALLET;
  H.state.useCortexKey = false;
  H.inserts.length = 0;
  H.drainPending.mockClear();
  H.openRouterEnabled = true;
});

// A tiny text "file" the multer fileFilter accepts (.txt).
const TXT = Buffer.from('Alpha bravo charlie. Delta echo foxtrot.\n\nGolf hotel india.', 'utf-8');

describe('upload.routes — owner-trust / forged-wallet regression', () => {
  // ---- 401: no auth on every route ---- //

  it('GET /batches with no auth → 401', async () => {
    H.state.loggedIn = false;
    const res = await request(app()).get('/api/upload/batches');
    expect(res.status).toBe(401);
  });

  it('POST /process with no auth → 401 and NO memories inserted', async () => {
    H.state.loggedIn = false;
    const res = await request(app())
      .post('/api/upload/process')
      .attach('file', TXT, { filename: 'doc.txt', contentType: 'text/plain' });
    expect(res.status).toBe(401);
    expect(H.inserts).toHaveLength(0);
  });

  it('GET /batch/:id with no auth → 401', async () => {
    H.state.loggedIn = false;
    const res = await request(app()).get('/api/upload/batch/batch-owner-1');
    expect(res.status).toBe(401);
  });

  it('GET /check-access with no auth → 401', async () => {
    H.state.loggedIn = false;
    const res = await request(app()).get('/api/upload/check-access');
    expect(res.status).toBe(401);
  });

  // ---- 403: authed attacker forging an allowlisted victim wallet ---- //

  it('CRITICAL: authed non-owner cannot list a victim’s batches by forging ?wallet=<victim>', async () => {
    H.state.callerOwnedWallet = H.ATTACKER_WALLET; // logged in, owns a DIFFERENT wallet
    const res = await request(app()).get(`/api/upload/batches?wallet=${H.VICTIM_WALLET}`);
    expect(res.status).toBe(403); // requireOwnership rejects the forged claim
  });

  it('CRITICAL: authed non-owner cannot inject memories via POST /process forging wallet=<victim>', async () => {
    H.state.callerOwnedWallet = H.ATTACKER_WALLET;
    const res = await request(app())
      .post('/api/upload/process')
      .field('wallet', H.VICTIM_WALLET) // multipart wallet field — the old trust sink
      .attach('file', TXT, { filename: 'evil.txt', contentType: 'text/plain' });
    expect(res.status).toBe(403);
    // The decisive assertion: NOTHING was written to the victim's brain.
    expect(H.inserts).toHaveLength(0);
    expect(H.drainPending).not.toHaveBeenCalled();
  });

  it('CRITICAL: authed non-owner cannot read a victim’s batch by forging ?wallet=<victim>', async () => {
    H.state.callerOwnedWallet = H.ATTACKER_WALLET;
    const res = await request(app()).get(
      `/api/upload/batch/batch-owner-1?wallet=${H.VICTIM_WALLET}`,
    );
    expect(res.status).toBe(403);
  });

  it('GET /check-access can only ever report the caller’s OWN access, never a forged probe', async () => {
    H.state.callerOwnedWallet = H.ATTACKER_WALLET;
    const res = await request(app()).get(`/api/upload/check-access?wallet=${H.VICTIM_WALLET}`);
    // The forged probe of the allowlist is rejected outright.
    expect(res.status).toBe(403);
  });

  // ---- allowlist is still enforced on the *verified* wallet ---- //

  it('a proven owner whose wallet is NOT allowlisted is denied 403 (allowlist enforced post-verify)', async () => {
    H.state.callerOwnedWallet = H.UNLISTED_OWNER; // genuinely owns it, but not allowlisted
    const res = await request(app()).get(`/api/upload/batches?wallet=${H.UNLISTED_OWNER}`);
    expect(res.status).toBe(403);
  });

  it('POST /process for a proven-but-unlisted owner is denied 403 and inserts nothing', async () => {
    H.state.callerOwnedWallet = H.UNLISTED_OWNER;
    const res = await request(app())
      .post('/api/upload/process')
      .field('wallet', H.UNLISTED_OWNER)
      .attach('file', TXT, { filename: 'doc.txt', contentType: 'text/plain' });
    expect(res.status).toBe(403);
    expect(H.inserts).toHaveLength(0);
  });

  // ---- legitimate owner path works (Privy-linked ?wallet=) ---- //

  it('the proven owner CAN list their own batches (scoped to verifiedWallet)', async () => {
    H.state.callerOwnedWallet = H.OWNER_WALLET;
    const res = await request(app()).get(`/api/upload/batches?wallet=${H.OWNER_WALLET}`);
    expect(res.status).toBe(200);
    expect(res.body.batches).toHaveLength(1);
    expect(res.body.batches[0].batch_id).toBe('batch-owner-1');
  });

  it('the proven owner CAN process a file — memories inserted under the OWNER wallet', async () => {
    H.state.callerOwnedWallet = H.OWNER_WALLET;
    const res = await request(app())
      .post('/api/upload/process')
      .field('wallet', H.OWNER_WALLET)
      .attach('file', TXT, { filename: 'doc.txt', contentType: 'text/plain' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(res.body.chunks).toBeGreaterThan(0);

    // Memories were written, and EVERY inserted row is owned by the verified
    // owner wallet — never an attacker-supplied value.
    const llmInserts = H.inserts.filter((i) => i.table === 'llm_outputs');
    expect(llmInserts.length).toBeGreaterThan(0);
    const allRows = llmInserts.flatMap((i) => i.rows);
    expect(allRows.length).toBeGreaterThan(0);
    for (const row of allRows) {
      expect(row.owner_wallet).toBe(H.OWNER_WALLET);
    }
    expect(H.drainPending).toHaveBeenCalledTimes(1);
  });

  it('the proven owner CAN read their own batch', async () => {
    H.state.callerOwnedWallet = H.OWNER_WALLET;
    const res = await request(app()).get(
      `/api/upload/batch/batch-owner-1?wallet=${H.OWNER_WALLET}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.batch_id).toBe('batch-owner-1');
  });

  it('GET /check-access reports true for the allowlisted owner', async () => {
    H.state.callerOwnedWallet = H.OWNER_WALLET;
    const res = await request(app()).get(`/api/upload/check-access?wallet=${H.OWNER_WALLET}`);
    expect(res.status).toBe(200);
    expect(res.body.allowed).toBe(true);
  });

  // ---- legitimate owner path works (Cortex clk_ key, no ?wallet=) ---- //

  it('the owner via Cortex clk_ key (no ?wallet=) CAN list batches — owner_wallet resolved from the key', async () => {
    // clk_ flow: no claimed wallet; requireOwnership resolves owner_wallet from
    // the agent row. Our faithful mock returns callerOwnedWallet in that case.
    H.state.callerOwnedWallet = H.OWNER_WALLET;
    H.state.useCortexKey = true;
    const res = await request(app())
      .get('/api/upload/batches')
      .set('Authorization', 'Bearer clk_ownerkey123');
    expect(res.status).toBe(200);
    expect(res.body.batches).toHaveLength(1);
  });

  it('the owner via Cortex clk_ key CAN process a file — memories under the resolved owner wallet', async () => {
    H.state.callerOwnedWallet = H.OWNER_WALLET;
    H.state.useCortexKey = true;
    const res = await request(app())
      .post('/api/upload/process')
      .set('Authorization', 'Bearer clk_ownerkey123')
      .attach('file', TXT, { filename: 'doc.txt', contentType: 'text/plain' }); // no wallet field at all
    expect(res.status).toBe(200);
    const allRows = H.inserts.filter((i) => i.table === 'llm_outputs').flatMap((i) => i.rows);
    expect(allRows.length).toBeGreaterThan(0);
    for (const row of allRows) {
      expect(row.owner_wallet).toBe(H.OWNER_WALLET);
    }
  });
});
