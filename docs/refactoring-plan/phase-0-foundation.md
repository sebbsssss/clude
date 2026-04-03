# Phase 0: Foundation (Pre-requisite for Auth Hardening)

## 0.1 -- Privy User-to-Wallet Resolution Layer

**Problem**: `req.privyUser` contains only a Privy DID (`did:privy:...`), not a Solana wallet address. There is no way to verify that `?wallet=X` actually belongs to the authenticated user. The `getRequestOwner()` function at `server.ts:38` trusts the `?wallet=` param blindly.

**Solution**: Create a wallet verification middleware that uses the Privy Server SDK to fetch linked accounts for the authenticated user.

**Implementation**:
- New file: `apps/server/src/webhook/privy-wallet-resolver.ts`
- Install `@privy-io/server-auth` (Privy server SDK) to call `privy.getUser(userId)` which returns `user.linkedAccounts` including Solana wallets
- Cache the DID-to-wallets mapping in-memory (5 min TTL, same pattern as the embedding cache) to avoid per-request Privy API calls
- Extend the `PrivyUser` interface in `privy-auth.ts` to include `wallets?: string[]`

**Complexity**: M  
**Risk**: Requires `PRIVY_APP_SECRET` to be set (already in config). If Privy API is slow or down, this blocks auth. Mitigate with cache and 3-second timeout.

---

## 0.2 -- `requireOwnership` Reusable Middleware

**New file**: `apps/server/src/webhook/require-ownership.ts`

**Pattern**:
```
1. Check req.privyUser exists (from requirePrivyAuth upstream)
2. Extract wallet from ?wallet= or req.body.wallet
3. Call privy-wallet-resolver to get user's linked wallets
4. Verify the requested wallet is in the linked wallets list
5. If not: 403 Forbidden
6. If yes: attach req.verifiedWallet = wallet, call next()
```

Also support an API-key path: check if the API key in `cortex_api_keys` table maps to the requested wallet.

**Complexity**: M  
**Risk**: Breaking change for any client that sends `?wallet=` without a JWT. Requires coordinated frontend update. The existing `optionalPrivyAuth` on line 126 means unauthenticated requests currently work -- stage carefully.

---

## Key Files
- `apps/server/src/webhook/privy-auth.ts` (existing middleware)
- `apps/server/src/webhook/server.ts:38` (getRequestOwner - currently trusts ?wallet= blindly)
- `apps/server/src/utils/config.ts:139` (PRIVY_APP_SECRET already configured)
