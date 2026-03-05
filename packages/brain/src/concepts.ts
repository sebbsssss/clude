// ============================================================
// CONCEPT ONTOLOGY — Auto-classify memories into structured concepts
// ============================================================

export function inferConcepts(summary: string, source: string, tags: string[]): string[] {
  const concepts: string[] = [];
  const lower = summary.toLowerCase();
  const tagSet = new Set(tags.map(t => t.toLowerCase()));

  if (source === 'market' || tagSet.has('price') || /price|pump|dump|ath|market|volume/.test(lower))
    concepts.push('market_event');
  if (/whale|holder|seller|buyer|exit|accumula/.test(lower))
    concepts.push('holder_behavior');
  if (source === 'reflection' || source === 'emergence' || /myself|i am|i feel|identity|who i/.test(lower))
    concepts.push('self_insight');
  if (source === 'mention' || /tweet|reply|said|asked|mentioned|dm/.test(lower))
    concepts.push('social_interaction');
  if (/pattern|trend|recurring|always|usually|community/.test(lower))
    concepts.push('community_pattern');
  if (/token|sol|mint|swap|transfer|liquidity|staking/.test(lower))
    concepts.push('token_economics');
  if (/mood|sentiment|feel|vibe|energy|atmosphere/.test(lower))
    concepts.push('sentiment_shift');
  if (tagSet.has('first_interaction') || /returning|regular|again|came back/.test(lower))
    concepts.push('recurring_user');
  if (/engagement|likes|retweet|viral|reach|impressions/.test(lower))
    concepts.push('engagement_pattern');
  if (source === 'emergence' || /becoming|evolving|changed|grew|identity/.test(lower))
    concepts.push('identity_evolution');

  return [...new Set(concepts)];
}
