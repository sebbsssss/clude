/**
 * Hosted Dream Worker — runs dream cycles for all active cortex agents.
 *
 * On the hosted platform, agents using cortex API keys don't run their own
 * dream cycles. This worker periodically processes each agent's episodic
 * memories through consolidation + compaction + reflection, creating
 * semantic/procedural/self_model memories that make recall and exports richer.
 *
 * Runs every 6 hours via cron. Each agent's dream is scoped via
 * withOwnerWallet() so memories stay isolated.
 */
import { getDb } from '@clude/shared/core/database';
import { withOwnerWallet } from '@clude/shared/core/owner-context';
import {
  getRecentMemories,
  getMemoryStats,
  storeMemory,
  recallMemorySummaries,
  createMemoryLink,
  type MemoryType,
} from './memory';
import { isOpenRouterEnabled, generateOpenRouterResponse } from '@clude/shared/core/openrouter-client';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('hosted-dreams');

const MIN_EPISODIC_FOR_DREAM = 20; // Don't dream if agent has < 20 episodic memories
const MAX_AGENTS_PER_RUN = 50;     // Process at most 50 agents per cron run
const DREAM_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours between dreams per agent

/**
 * Run a lightweight dream cycle for a single agent (by owner_wallet).
 * Does consolidation (episodic → semantic) + procedural extraction.
 * Skips compaction, contradiction resolution, emergence (those are heavier).
 */
async function dreamForAgent(ownerWallet: string, agentName: string): Promise<{ consolidated: number; procedural: number }> {
  let consolidated = 0;
  let procedural = 0;

  await withOwnerWallet(ownerWallet, async () => {
    const stats = await getMemoryStats();
    const episodicCount = stats.byType?.episodic || 0;

    if (episodicCount < MIN_EPISODIC_FOR_DREAM) {
      log.debug({ agentName, episodicCount }, 'Skipping dream — too few episodic memories');
      return;
    }

    // Get recent episodic memories (last 7 days)
    const recentEpisodic = (await getRecentMemories(168, ['episodic' as any], 50))
      .filter(m => m.memory_type === 'episodic');

    if (recentEpisodic.length < 5) {
      log.debug({ agentName, recent: recentEpisodic.length }, 'Skipping dream — too few recent episodic memories');
      return;
    }

    // ── Phase 1: Consolidation (episodic → semantic) ──
    // Ask the LLM to extract key insights from recent episodes
    const episodicSummaries = recentEpisodic
      .slice(0, 30)
      .map(m => `- [${m.created_at?.slice(0, 10)}] ${m.summary}`)
      .join('\n');

    if (!isOpenRouterEnabled()) {
      log.warn({ agentName }, 'OpenRouter not enabled — cannot run dream cycle');
      return;
    }

    try {
      const consolidationResponse = await generateOpenRouterResponse({
        systemPrompt: 'You extract factual insights from data. Always respond with ONLY a JSON array of strings. No explanation, no markdown, no thinking process.',
        messages: [{
          role: 'user',
          content: `Extract 5-8 key factual insights from these agent memories. Facts, patterns, learned knowledge — not events.\n\n${episodicSummaries}`,
        }],
        model: 'meta-llama/llama-3.3-70b-instruct',
        maxTokens: 1000,
        temperature: 0.2,
      });

      // Parse insights
      const jsonMatch = consolidationResponse.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          const insights: string[] = JSON.parse(jsonMatch[0]);
          for (const insight of insights.slice(0, 5)) {
            if (insight && insight.length > 10 && insight.length < 500) {
              const id = await storeMemory({
                type: 'semantic' as MemoryType,
                content: insight,
                summary: insight.slice(0, 200),
                tags: ['dream', 'consolidation'],
                source: 'hosted-dream',
                importance: 0.6,
              });
              if (id) consolidated++;
            }
          }
        } catch (e) {
          log.debug({ agentName }, 'Failed to parse consolidation insights');
        }
      }
    } catch (err) {
      log.warn({ err, agentName }, 'Consolidation phase failed');
    }

    // ── Phase 2: Procedural extraction ──
    // Extract behavioral patterns / rules from episodes
    try {
      const proceduralResponse = await generateOpenRouterResponse({
        systemPrompt: 'You extract actionable rules from data. Always respond with ONLY a JSON array of strings. No explanation.',
        messages: [{
          role: 'user',
          content: `Extract 3-4 actionable rules/behaviors from these agent memories. Things to DO or AVOID.\n\n${episodicSummaries}`,
        }],
        model: 'meta-llama/llama-3.3-70b-instruct',
        maxTokens: 500,
        temperature: 0.2,
      });

      const jsonMatch = proceduralResponse.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          const rules: string[] = JSON.parse(jsonMatch[0]);
          for (const rule of rules.slice(0, 3)) {
            if (rule && rule.length > 10 && rule.length < 500) {
              const id = await storeMemory({
                type: 'procedural' as MemoryType,
                content: rule,
                summary: rule.slice(0, 200),
                tags: ['dream', 'procedural'],
                source: 'hosted-dream',
                importance: 0.65,
              });
              if (id) procedural++;
            }
          }
        } catch (e) {
          log.debug({ agentName }, 'Failed to parse procedural rules');
        }
      }
    } catch (err) {
      log.warn({ err, agentName }, 'Procedural extraction failed');
    }
  });

  return { consolidated, procedural };
}

/**
 * Run hosted dream cycles for all active agents.
 * Called by cron every 6 hours.
 */
export async function runHostedDreams(): Promise<void> {
  log.info('=== HOSTED DREAM WORKER STARTING ===');

  const db = getDb();

  // Get all active agents with an owner_wallet
  const { data: agents, error } = await db
    .from('agent_keys')
    .select('agent_id, agent_name, owner_wallet, last_used, metadata')
    .eq('is_active', true)
    .not('owner_wallet', 'is', null)
    .order('last_used', { ascending: false, nullsFirst: false })
    .limit(MAX_AGENTS_PER_RUN);

  if (error || !agents) {
    log.error({ error }, 'Failed to fetch agents for dream worker');
    return;
  }

  log.info({ agentCount: agents.length }, 'Processing agents for dream cycles');

  let totalConsolidated = 0;
  let totalProcedural = 0;
  let agentsProcessed = 0;
  let agentsSkipped = 0;

  for (const agent of agents) {
    try {
      // Check cooldown — don't dream if we dreamed recently
      const lastDream = (agent.metadata as any)?.lastHostedDream;
      if (lastDream && Date.now() - new Date(lastDream).getTime() < DREAM_COOLDOWN_MS) {
        agentsSkipped++;
        continue;
      }

      const { consolidated, procedural } = await dreamForAgent(
        agent.owner_wallet!,
        agent.agent_name || agent.agent_id,
      );

      // Update last dream timestamp
      const existingMeta = (agent.metadata as Record<string, unknown>) || {};
      await db.from('agent_keys')
        .update({
          metadata: { ...existingMeta, lastHostedDream: new Date().toISOString() },
        })
        .eq('agent_id', agent.agent_id);

      totalConsolidated += consolidated;
      totalProcedural += procedural;
      agentsProcessed++;

      if (consolidated > 0 || procedural > 0) {
        log.info({
          agentName: agent.agent_name,
          consolidated,
          procedural,
        }, 'Dream cycle complete for agent');
      }

      // Small delay between agents to avoid hammering OpenRouter
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      log.error({ err, agentId: agent.agent_id }, 'Dream failed for agent');
    }
  }

  log.info({
    agentsProcessed,
    agentsSkipped,
    totalConsolidated,
    totalProcedural,
  }, '=== HOSTED DREAM WORKER COMPLETE ===');
}

/**
 * Start the hosted dream cron job (every 6 hours).
 */
export function startHostedDreamSchedule(): void {
  const cron = require('node-cron');

  // Run every 6 hours: 0:00, 6:00, 12:00, 18:00 UTC
  cron.schedule('0 */6 * * *', () => {
    runHostedDreams().catch(err =>
      log.error({ err }, 'Hosted dream worker failed')
    );
  });

  log.info('Hosted dream schedule started (every 6 hours)');

  // Run once on startup after a delay (let DB init complete)
  setTimeout(() => {
    runHostedDreams().catch(err =>
      log.error({ err }, 'Initial hosted dream run failed')
    );
  }, 60000); // 1 minute after startup
}
