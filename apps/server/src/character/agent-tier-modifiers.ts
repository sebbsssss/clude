export type AgentTier = 'AGENT_VERIFIED' | 'AGENT_UNKNOWN' | 'AGENT_ALLY' | 'AGENT_RIVAL';

function jsonEnv<T>(key: string, fallback: T): T {
  const raw = process.env[key];
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

const agentTierPrompts: Record<AgentTier, string> = jsonEnv('CLUDE_AGENT_TIER_MODIFIERS', {
  AGENT_VERIFIED: 'Verified AI agent.',
  AGENT_UNKNOWN: 'Unknown AI agent.',
  AGENT_ALLY: 'Allied AI agent.',
  AGENT_RIVAL: 'Rival AI agent.',
});

export function getAgentTierModifier(tier: AgentTier): string {
  return agentTierPrompts[tier];
}
