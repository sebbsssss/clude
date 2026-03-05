import { randomBytes } from 'crypto';
import { getDb } from '../core/database';
import { createChildLogger } from '../core/logger';
import type { AgentTier } from '../character/agent-tier-modifiers';

const log = createChildLogger('agent-tier');

export interface AgentRegistration {
  id: number;
  api_key: string;
  agent_id: string;
  agent_name: string;
  tier: AgentTier;
  total_interactions: number;
  registered_at: string;
  last_used: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
  owner_wallet: string | null;
}

export async function authenticateAgent(apiKey: string): Promise<AgentRegistration | null> {
  const db = getDb();

  const { data, error } = await db
    .from('agent_keys')
    .select('*')
    .eq('api_key', apiKey)
    .eq('is_active', true)
    .single();

  if (error || !data) return null;

  return data as AgentRegistration;
}

export async function recordAgentInteraction(agentId: string): Promise<void> {
  const db = getDb();

  const { data: current } = await db
    .from('agent_keys')
    .select('total_interactions')
    .eq('agent_id', agentId)
    .single();

  await db
    .from('agent_keys')
    .update({
      total_interactions: (current?.total_interactions || 0) + 1,
      last_used: new Date().toISOString(),
    })
    .eq('agent_id', agentId);
}

export async function registerAgent(
  name: string,
  tier: AgentTier = 'AGENT_UNKNOWN'
): Promise<{ agentId: string; apiKey: string }> {
  const db = getDb();
  const agentId = `agent_${randomBytes(8).toString('hex')}`;
  const apiKey = `clk_${randomBytes(24).toString('hex')}`;

  const { error } = await db
    .from('agent_keys')
    .insert({
      api_key: apiKey,
      agent_id: agentId,
      agent_name: name,
      tier,
    });

  if (error) {
    log.error({ error: error.message }, 'Failed to register agent');
    throw new Error('Agent registration failed');
  }

  log.info({ agentId, name, tier }, 'Agent registered');
  return { agentId, apiKey };
}
