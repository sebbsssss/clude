import { randomBytes } from 'crypto';
import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';
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

  if (error) {
    log.warn({ error: error.message, code: error.code }, 'agent auth query failed');
    return null;
  }
  if (!data) return null;

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

/**
 * Find existing agent key for a wallet, or create one.
 * Returns the plaintext API key.
 */
export async function findOrCreateAgentForWallet(wallet: string): Promise<{ apiKey: string; agentId: string; isNew: boolean }> {
  const db = getDb();

  // Check if wallet already has an agent
  const { data: existing } = await db
    .from('agent_keys')
    .select('agent_id, api_key')
    .eq('owner_wallet', wallet)
    .eq('is_active', true)
    .limit(1)
    .single();

  if (existing) {
    return { apiKey: existing.api_key, agentId: existing.agent_id, isNew: false };
  }

  // Create new agent for this wallet
  const name = `chat-${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
  const { agentId, apiKey } = await registerAgent(name, 'AGENT_VERIFIED');

  // Set the owner_wallet
  await db
    .from('agent_keys')
    .update({ owner_wallet: wallet })
    .eq('agent_id', agentId);

  return { apiKey, agentId, isNew: true };
}
