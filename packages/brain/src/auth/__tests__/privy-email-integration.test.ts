// packages/brain/src/auth/__tests__/privy-email-integration.test.ts

import { describe, it, expect } from 'vitest';

const hasCredentials =
  !!process.env.PRIVY_TEST_APP_ID && !!process.env.PRIVY_TEST_APP_SECRET;

const describeIf = hasCredentials ? describe : describe.skip;

describeIf('Privy email integration (real API)', () => {
  // Use a unique throwaway email per test run
  const testEmail = `clude-test+${Date.now()}@example.com`;

  it('creates a real Privy user', async () => {
    // Set env vars before importing so getPrivyClient() picks them up
    process.env.PRIVY_APP_ID = process.env.PRIVY_TEST_APP_ID!;
    process.env.PRIVY_APP_SECRET = process.env.PRIVY_TEST_APP_SECRET!;

    // Import after setting env vars
    const { findOrCreatePrivyUserByEmail } = await import('../privy-wallet-resolver.js');

    const did = await findOrCreatePrivyUserByEmail(testEmail);
    expect(did).toMatch(/^did:privy:/);
    console.log(`[integration] Created Privy user: ${did}`);
  }, 15_000);

  it('returns the same DID on second call (idempotent)', async () => {
    const { findOrCreatePrivyUserByEmail } = await import('../privy-wallet-resolver.js');

    const did1 = await findOrCreatePrivyUserByEmail(testEmail);
    const did2 = await findOrCreatePrivyUserByEmail(testEmail);

    expect(did1).toBe(did2);
  }, 15_000);
});

if (!hasCredentials) {
  console.log(
    '[skipped] Privy integration tests: set PRIVY_TEST_APP_ID and PRIVY_TEST_APP_SECRET to run',
  );
}
