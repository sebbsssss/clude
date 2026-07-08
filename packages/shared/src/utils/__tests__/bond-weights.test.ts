import { describe, it, expect } from 'vitest';
import { BOND_TYPE_WEIGHTS, type MemoryLinkType } from '../constants';

/**
 * Memory 3.0 Phase 1 (migration 044): the 'supersedes' bond type.
 *
 * BOND_TYPE_WEIGHTS is the runtime source of truth for the link-type set
 * (Record<MemoryLinkType, number>), so it pins that the SQL CHECK constraints
 * (supabase-schema.sql + the database.ts boot blob) and the code agree on the
 * relation existing. The weight places 'supersedes' just under 'supports' and
 * above 'resolves': a decisive replacement outranks a mere resolution.
 */

describe("BOND_TYPE_WEIGHTS: 'supersedes' (Memory 3.0 C1)", () => {
  it('includes supersedes at weight 0.85', () => {
    expect(BOND_TYPE_WEIGHTS.supersedes).toBe(0.85);
  });

  it('has all 11 link types (10 legacy + supersedes)', () => {
    expect(Object.keys(BOND_TYPE_WEIGHTS)).toHaveLength(11);
    expect(Object.keys(BOND_TYPE_WEIGHTS)).toContain('supersedes');
  });

  it('keeps the ladder ordered: causes > supports > supersedes > resolves', () => {
    const w = BOND_TYPE_WEIGHTS;
    expect(w.causes).toBeGreaterThan(w.supports);
    expect(w.supports).toBeGreaterThan(w.supersedes);
    expect(w.supersedes).toBeGreaterThan(w.resolves);
  });

  it('every weight is in (0, 1]', () => {
    for (const [type, weight] of Object.entries(BOND_TYPE_WEIGHTS)) {
      expect(weight, type).toBeGreaterThan(0);
      expect(weight, type).toBeLessThanOrEqual(1);
    }
  });

  it('the type union accepts supersedes at compile time', () => {
    const t: MemoryLinkType = 'supersedes';
    expect(t).toBe('supersedes');
  });
});
