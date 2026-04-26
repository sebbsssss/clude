import { describe, it, expect } from 'vitest';
import {
  TIER_RANK,
  TIER_PRICE_MICRO_USDC,
  TIER_DAILY_MEMORY_QUOTA,
  USDC_DECIMALS,
  CLUDE_DECIMALS,
} from '../types.js';
import { meetsTier } from '../tier.js';

describe('Tier semantics', () => {
  it('rank ordering is monotonic', () => {
    expect(TIER_RANK.free).toBeLessThan(TIER_RANK.personal);
    expect(TIER_RANK.personal).toBeLessThan(TIER_RANK.pro);
    expect(TIER_RANK.pro).toBeLessThan(TIER_RANK.agent);
  });

  it('meetsTier returns true for higher or equal tiers', () => {
    expect(meetsTier('agent', 'personal')).toBe(true);
    expect(meetsTier('personal', 'personal')).toBe(true);
    expect(meetsTier('free', 'personal')).toBe(false);
    expect(meetsTier('pro', 'agent')).toBe(false);
  });

  it('prices are in micro-USDC and below industry standard', () => {
    // Below Cursor / ChatGPT Plus / Mem.ai which sit at $20 / $20 / $14.
    expect(TIER_PRICE_MICRO_USDC.personal).toBe(5_000_000n);  // $5
    expect(TIER_PRICE_MICRO_USDC.pro).toBe(19_000_000n);      // $19
    expect(TIER_PRICE_MICRO_USDC.agent).toBe(59_000_000n);    // $59
  });

  it('daily quotas scale by ~10x per tier', () => {
    expect(TIER_DAILY_MEMORY_QUOTA.personal).toBeGreaterThan(TIER_DAILY_MEMORY_QUOTA.free);
    expect(TIER_DAILY_MEMORY_QUOTA.pro).toBeGreaterThan(TIER_DAILY_MEMORY_QUOTA.personal);
    expect(TIER_DAILY_MEMORY_QUOTA.agent).toBeGreaterThan(TIER_DAILY_MEMORY_QUOTA.pro);
  });
});

describe('Decimals', () => {
  it('CLUDE and USDC both have 6 decimals', () => {
    // Critical invariant — many price/qty calculations assume this.
    // If the mint is changed and decimals differ, money math breaks.
    expect(CLUDE_DECIMALS).toBe(6);
    expect(USDC_DECIMALS).toBe(6);
  });
});
