/**
 * Token-savings accounting for the proof counter (proof-features §7.1).
 *
 * frontierTokens = the full transcript a memoryless agent carries into this turn
 *                  (all prior turns it must re-send + this turn's actual prompt).
 * tokensSaved    = frontierTokens − cludeContext, where cludeContext is this turn's
 *                  actual prompt (completion is equal across both scenarios, so it
 *                  cancels). This reduces to priorTurnsTokens and grows with the
 *                  conversation — ~82% on high-usage sessions.
 */
export function computeSavings(input: {
  priorTurnsTokens: number;
  tokensPrompt: number;
}): { frontierTokens: number; tokensSaved: number } {
  const prior = Math.max(0, Number.isFinite(input.priorTurnsTokens) ? input.priorTurnsTokens : 0);
  const prompt = Math.max(0, Number.isFinite(input.tokensPrompt) ? input.tokensPrompt : 0);
  const frontierTokens = prior + prompt;
  const tokensSaved = Math.max(0, frontierTokens - prompt);
  return { frontierTokens, tokensSaved };
}
