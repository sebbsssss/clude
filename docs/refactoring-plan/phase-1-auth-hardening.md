# Phase 1: Auth Hardening

**Dependency**: Phase 0 must land first.  
**All changes in**: `apps/server/src/webhook/server.ts` unless otherwise noted.

---

## 1.1 -- Protect Memory Read Endpoints (S)

**Endpoints**:
- `GET /api/memories` (server.ts ~line 194) -- add `requirePrivyAuth` + `requireOwnership`
- `GET /api/memory-stats` (server.ts ~line 177) -- add `requirePrivyAuth` + `requireOwnership`

These already use `withRequestScope` and `getRequestOwner`, but currently anyone can pass any `?wallet=` value. After Phase 0, the ownership middleware ensures the wallet param matches the authenticated user.

**Migration**: Frontend apps must send `Authorization: Bearer <privy-token>` on these calls (likely already do since `optionalPrivyAuth` is global on `/api`).

**Risk**: Low.

---

## 1.2 -- Protect Brain Endpoints (S)

**Endpoints**:
- `GET /api/brain` (server.ts ~line 441) -- add `requirePrivyAuth` + `requireOwnership`
- `GET /api/brain/consciousness` (server.ts ~line 478) -- add `requirePrivyAuth` + `requireOwnership`
- `GET /api/user/brain` (server.ts ~line 618) -- already has `requirePrivyAuth`, add `requireOwnership`

**Risk**: Low.

---

## 1.3 -- Protect Explore Route (S)

**File**: `apps/server/src/webhook/explore-routes.ts`
- Line 77: `router.post("/")` accepts `wallet` in body, no auth
- Add `requirePrivyAuth` middleware to the router
- Add ownership check: verify `req.body.wallet` matches authenticated user's wallets
- Keep LOTR explore route public (campaign feature)

**Risk**: Low.

---

## 1.4 -- Protect Graph Routes (M)

**File**: `apps/server/src/webhook/graph-routes.ts`

All routes currently unscoped:
- `GET /` (line 20) -- no wallet param at all
- `GET /stats` (line 47) -- no scoping
- `GET /search` (line 62) -- no scoping
- `GET /entity/:id` (line 99) -- no scoping
- `GET /neighborhood/:id` (line 202) -- no scoping
- `POST /recall` (line 262) -- takes wallet param, no auth
- `GET /memory-graph` (line 305) -- takes wallet param, no ownership check

**Plan**:
1. Add `requirePrivyAuth` to the graph router
2. For routes with `?wallet=`, add `requireOwnership`
3. For routes without wallet param, scope using `getRequestOwner(req)` + `withRequestScope`
4. `getKnowledgeGraph()` and `getGraphStats()` in `memory-graph.ts` need to accept `ownerWallet` param

**Risk**: Medium. Currently returns global data -- scoping changes behavior. Verify dashboard/chat apps pass wallet params.

---

## 1.5 -- Lock Down Solana RPC Proxy (S)

**Endpoint**: `POST /api/solana-rpc` (server.ts ~line 136)
- Currently an open proxy exposing the Helius API key
- Add `requirePrivyAuth`
- Add method allowlisting: `getBalance`, `getTokenAccountsByOwner`, `getSignaturesForAddress`, `getTransaction`
- Block write methods like `sendTransaction`
- Add per-user rate limiting

**Risk**: Medium. Check if frontend uses this without auth first.

---

## 1.6 -- Replace Upload Hardcoded Whitelist (M)

**File**: `apps/server/src/webhook/upload-routes.ts` (lines 27-34)
- Hardcoded `ALLOWED_WALLETS` set with two wallet addresses
- Replace with `requirePrivyAuth` + `requireOwnership`
- Optionally add an `upload_access` table for granular control
- Remove hardcoded wallet addresses from source code

**Risk**: Medium. Migration path: seed access table with current hardcoded wallets.

---

## 1.7 -- Protect Journal Endpoint (S)

**Endpoint**: `GET /api/journal` (server.ts ~line 1376)
- Uses `withRequestScope` but no auth
- Add `requirePrivyAuth` + `requireOwnership`

**Risk**: Low.

---

## 1.8 -- Rate Limit Docs-Views (S)

**Endpoints**: `GET /api/docs-views` (line 921), `POST /api/docs-views` (line 935)
- Not user-scoped (just counters), no ownership needed
- Add IP-based rate limiting: POST limited to 1 increment/IP/minute

**Risk**: Low.

---

## 1.9 -- Auth Integration Tests (M)

**New file**: `apps/server/src/webhook/__tests__/auth-ownership.test.ts`

Test matrix:
| Scenario | Expected |
|----------|----------|
| No token | 401 |
| Invalid token | 401 |
| Valid token, wrong wallet | 403 |
| Valid token, correct wallet | 200 |
| API key, matching wallet | 200 |
| API key, wrong wallet | 403 |

Mock the Privy JWKS verification. Test each protected endpoint.
