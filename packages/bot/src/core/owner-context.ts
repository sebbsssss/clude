/**
 * Request-scoped owner wallet context using AsyncLocalStorage.
 *
 * Solves the concurrent-request problem: when the hosted API serves
 * multiple users simultaneously, each request needs its own owner_wallet
 * scope without changing any function signatures.
 *
 * Usage in API middleware:
 *   await withOwnerWallet(wallet, async () => { ... handler ... })
 *
 * Usage in memory.ts:
 *   getOwnerWallet() checks async context first, falls back to module-level.
 */
import { AsyncLocalStorage } from 'async_hooks';

const ownerStorage = new AsyncLocalStorage<string | null>();

/** Run a callback with a specific owner wallet in scope. */
export function withOwnerWallet<T>(wallet: string | null, fn: () => T | Promise<T>): T | Promise<T> {
  return ownerStorage.run(wallet, fn);
}

/**
 * Get the owner wallet from async context.
 * Returns undefined if not inside a withOwnerWallet() call (use module-level fallback).
 */
export function getContextOwnerWallet(): string | null | undefined {
  return ownerStorage.getStore();
}
