import { describe, it, expect } from 'vitest';
import { computeSavings } from '../proof-savings.js';

describe('computeSavings', () => {
  it('first turn (no prior history) saves nothing', () => {
    expect(computeSavings({ priorTurnsTokens: 0, tokensPrompt: 1800 }))
      .toEqual({ frontierTokens: 1800, tokensSaved: 0 });
  });

  it('high-usage turn: saved equals the prior transcript a memoryless agent re-sends', () => {
    expect(computeSavings({ priorTurnsTokens: 50000, tokensPrompt: 2000 }))
      .toEqual({ frontierTokens: 52000, tokensSaved: 50000 });
  });

  it('never returns negative and coerces missing/garbage inputs to 0', () => {
    expect(computeSavings({ priorTurnsTokens: -5, tokensPrompt: NaN }))
      .toEqual({ frontierTokens: 0, tokensSaved: 0 });
  });
});
