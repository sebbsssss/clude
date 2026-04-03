/**
 * Action Learning System — Closed-loop feedback for self-improving agents.
 *
 * Three components:
 *   1. Action Logger: Records every action the agent takes with context
 *   2. Outcome Tracker: Revisits actions and records what happened
 *   3. Strategy Refiner: Generates/updates procedural memories from patterns
 *
 * Memory flow:
 *   action (episodic) → outcome (episodic) → lesson (procedural)
 *   All linked via entity bonds: action →causes→ outcome →informs→ lesson
 */

import { storeMemory, recallMemories, getOwnerWallet } from './memory';
import { createChildLogger } from '@clude/shared/core/logger';
import { getDb } from '@clude/shared/core/database';
import { generateResponse } from '@clude/shared/core/claude-client';

const log = createChildLogger('action-learning');

// ============================================================
// 1. ACTION LOGGER
// ============================================================

export interface ActionRecord {
  /** Unique ID for this action (used to link outcomes) */
  actionId: string;
  /** What the agent did */
  action: string;
  /** Why (the reasoning/context) */
  reasoning: string;
  /** Feature that triggered it (e.g., 'general_reply', 'wallet_roast') */
  feature: string;
  /** Who was involved */
  relatedUser?: string;
  /** The input that triggered the action */
  trigger?: string;
  /** Additional context */
  metadata?: Record<string, any>;
}

/**
 * Log an action the agent took. Stores as episodic memory with action tags.
 */
export async function logAction(record: ActionRecord): Promise<number | null> {
  try {
    const content = `[ACTION] ${record.action}\n` +
      `Reasoning: ${record.reasoning}\n` +
      `Feature: ${record.feature}` +
      (record.trigger ? `\nTrigger: "${record.trigger.slice(0, 200)}"` : '');

    const summary = `Action (${record.feature}): ${record.action.slice(0, 120)}`;

    const memoryId = await storeMemory({
      type: 'episodic',
      content,
      summary,
      tags: ['action', `action:${record.feature}`, 'awaiting_outcome'],
      importance: 0.5, // neutral until outcome is known
      source: 'action_logger',
      sourceId: record.actionId,
      relatedUser: record.relatedUser,
      metadata: {
        actionId: record.actionId,
        feature: record.feature,
        ...record.metadata,
      },
    });

    log.info({ actionId: record.actionId, feature: record.feature, memoryId }, 'Action logged');
    return memoryId;
  } catch (err) {
    log.error({ err, actionId: record.actionId }, 'Failed to log action');
    return null;
  }
}

// ============================================================
// 2. OUTCOME TRACKER
// ============================================================

export interface OutcomeRecord {
  /** Links to the original action */
  actionId: string;
  /** What happened */
  outcome: string;
  /** Positive (good result), negative (bad result), neutral */
  sentiment: 'positive' | 'negative' | 'neutral';
  /** Numeric score if applicable (-1 to 1) */
  score?: number;
  /** How the outcome was measured */
  measureMethod: string;
  /** Additional data */
  metadata?: Record<string, any>;
}

/**
 * Record the outcome of a previous action.
 */
export async function logOutcome(record: OutcomeRecord): Promise<number | null> {
  try {
    const content = `[OUTCOME] ${record.outcome}\n` +
      `Sentiment: ${record.sentiment}` +
      (record.score !== undefined ? ` (score: ${record.score})` : '') +
      `\nMeasured by: ${record.measureMethod}` +
      `\nOriginal action: ${record.actionId}`;

    const summary = `Outcome (${record.sentiment}): ${record.outcome.slice(0, 120)}`;

    const emotionalValence = record.sentiment === 'positive' ? 0.7
      : record.sentiment === 'negative' ? -0.7
      : 0;

    const memoryId = await storeMemory({
      type: 'episodic',
      content,
      summary,
      tags: ['outcome', `outcome:${record.sentiment}`, `action_ref:${record.actionId}`],
      importance: Math.abs(record.score || 0.5) * 0.8 + 0.2, // important outcomes = higher importance
      emotionalValence,
      source: 'outcome_tracker',
      sourceId: `outcome:${record.actionId}`,
      metadata: {
        actionId: record.actionId,
        sentiment: record.sentiment,
        score: record.score,
        ...record.metadata,
      },
    });

    // Update the original action memory: remove 'awaiting_outcome' tag, boost/lower importance
    await updateActionImportance(record.actionId, record.sentiment);

    log.info({ actionId: record.actionId, sentiment: record.sentiment, memoryId }, 'Outcome logged');
    return memoryId;
  } catch (err) {
    log.error({ err, actionId: record.actionId }, 'Failed to log outcome');
    return null;
  }
}

/**
 * Update the original action memory based on outcome.
 */
async function updateActionImportance(actionId: string, sentiment: string): Promise<void> {
  try {
    const db = getDb();
    // Find the action memory by source_id
    let actionQuery = db
      .from('memories')
      .select('id, importance, tags')
      .eq('source_id', actionId)
      .limit(1);
    const ownerWallet = getOwnerWallet();
    if (ownerWallet) actionQuery = actionQuery.eq('owner_wallet', ownerWallet);
    const { data: actionMem } = await actionQuery;

    if (!actionMem || actionMem.length === 0) return;

    const mem = actionMem[0];
    const currentImportance = mem.importance || 0.5;
    const tags = (mem.tags || []).filter((t: string) => t !== 'awaiting_outcome');
    tags.push(`outcome:${sentiment}`);

    // Boost importance for impactful outcomes, lower for neutral
    const newImportance = sentiment === 'positive'
      ? Math.min(1.0, currentImportance + 0.15)
      : sentiment === 'negative'
        ? Math.min(1.0, currentImportance + 0.2) // negative outcomes are more important to remember
        : currentImportance;

    await db
      .from('memories')
      .update({ importance: newImportance, tags })
      .eq('id', mem.id);

    log.debug({ actionId, oldImportance: currentImportance, newImportance }, 'Action importance updated');
  } catch (err) {
    log.error({ err, actionId }, 'Failed to update action importance');
  }
}

// ============================================================
// 3. STRATEGY REFINER (Dream Cycle Phase)
// ============================================================

/**
 * Analyze recent action-outcome pairs and generate/update procedural memories.
 * Called during dream cycle as the 'learn' phase.
 */
export async function refineStrategies(): Promise<string[]> {
  const lessons: string[] = [];

  try {
    // Find recent action memories with outcomes (last 7 days)
    const db = getDb();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    let recentQuery = db
      .from('memories')
      .select('*')
      .contains('tags', ['action'])
      .gte('created_at', weekAgo)
      .order('created_at', { ascending: false })
      .limit(50);
    const ownerWallet = getOwnerWallet();
    if (ownerWallet) recentQuery = recentQuery.eq('owner_wallet', ownerWallet);
    const { data: recentActions } = await recentQuery;

    if (!recentActions || recentActions.length === 0) {
      log.debug('No recent actions to analyze');
      return lessons;
    }

    // Separate by outcome
    const withOutcome = recentActions.filter(m =>
      (m.tags || []).some((t: string) => t.startsWith('outcome:'))
    );

    const positive = withOutcome.filter(m =>
      (m.tags || []).includes('outcome:positive')
    );
    const negative = withOutcome.filter(m =>
      (m.tags || []).includes('outcome:negative')
    );

    if (withOutcome.length < 3) {
      log.debug({ total: recentActions.length, withOutcome: withOutcome.length }, 'Not enough outcome data for strategy refinement');
      return lessons;
    }

    // Group by feature
    const byFeature = new Map<string, { positive: number; negative: number; neutral: number; examples: string[] }>();

    for (const mem of withOutcome) {
      const featureTag = (mem.tags || []).find((t: string) => t.startsWith('action:'));
      const feature = featureTag ? featureTag.replace('action:', '') : 'unknown';

      if (!byFeature.has(feature)) {
        byFeature.set(feature, { positive: 0, negative: 0, neutral: 0, examples: [] });
      }

      const stats = byFeature.get(feature)!;
      if ((mem.tags || []).includes('outcome:positive')) stats.positive++;
      else if ((mem.tags || []).includes('outcome:negative')) stats.negative++;
      else stats.neutral++;

      if (stats.examples.length < 3) {
        stats.examples.push(mem.content?.slice(0, 150) || '');
      }
    }

    // Generate lessons from patterns
    for (const [feature, stats] of byFeature) {
      const total = stats.positive + stats.negative + stats.neutral;
      if (total < 2) continue;

      const negRate = stats.negative / total;
      const posRate = stats.positive / total;

      let lesson: string | null = null;

      if (negRate > 0.6) {
        // Mostly bad outcomes — generate caution rule
        lesson = await generateLesson(feature, stats, 'caution');
      } else if (posRate > 0.7) {
        // Mostly good outcomes — reinforce strategy
        lesson = await generateLesson(feature, stats, 'reinforce');
      }

      if (lesson) {
        await storeMemory({
          type: 'procedural',
          content: `[LEARNED STRATEGY] ${lesson}`,
          summary: `Strategy (${feature}): ${lesson.slice(0, 120)}`,
          tags: ['strategy', 'learned', `strategy:${feature}`],
          importance: 0.75,
          source: 'strategy_refiner',
          metadata: {
            feature,
            basedOn: total,
            positiveRate: posRate,
            negativeRate: negRate,
          },
        });

        lessons.push(lesson);
        log.info({ feature, lesson: lesson.slice(0, 100) }, 'New strategy learned');
      }
    }

    // Also check for existing procedural memories that should be reinforced or weakened
    if (positive.length > 0) {
      await reinforceSuccessfulStrategies(positive);
    }

    return lessons;
  } catch (err) {
    log.error({ err }, 'Strategy refinement failed');
    return lessons;
  }
}

/**
 * Use LLM to generate a lesson from action-outcome patterns.
 */
async function generateLesson(
  feature: string,
  stats: { positive: number; negative: number; neutral: number; examples: string[] },
  type: 'caution' | 'reinforce'
): Promise<string | null> {
  try {
    const prompt = type === 'caution'
      ? `Based on recent experience in "${feature}", ${stats.negative} out of ${stats.positive + stats.negative + stats.neutral} actions had negative outcomes.

Examples of what happened:
${stats.examples.map(e => `- ${e}`).join('\n')}

Write a concise procedural rule (1-2 sentences) that the agent should follow to avoid repeating these mistakes. Be specific and actionable. Start with "When..." or "Before..." or "Avoid...".`

      : `Based on recent experience in "${feature}", ${stats.positive} out of ${stats.positive + stats.negative + stats.neutral} actions had positive outcomes.

Examples of what worked:
${stats.examples.map(e => `- ${e}`).join('\n')}

Write a concise procedural rule (1-2 sentences) that captures this successful strategy. Be specific and actionable. Start with "When..." or "Continue..." or "Prioritize...".`;

    const response = await generateResponse({
      userMessage: prompt,
      featureInstruction: 'You are a strategy analyzer. Output ONLY the procedural rule, nothing else. No quotes, no explanation.',
      maxTokens: 150,
    });

    return response.trim();
  } catch (err) {
    log.error({ err, feature }, 'Failed to generate lesson');
    return null;
  }
}

/**
 * Find procedural memories that were recalled before successful actions
 * and boost their importance (Hebbian reinforcement).
 */
async function reinforceSuccessfulStrategies(positiveActions: any[]): Promise<void> {
  try {
    const db = getDb();

    // Find procedural memories with strategy tags
    let stratQuery = db
      .from('memories')
      .select('id, importance, tags, access_count')
      .eq('memory_type', 'procedural')
      .contains('tags', ['strategy'])
      .limit(20);
    const ownerWallet = getOwnerWallet();
    if (ownerWallet) stratQuery = stratQuery.eq('owner_wallet', ownerWallet);
    const { data: strategies } = await stratQuery;

    if (!strategies || strategies.length === 0) return;

    // For each strategy, check if its feature had positive outcomes
    for (const strategy of strategies) {
      const featureTag = (strategy.tags || []).find((t: string) => t.startsWith('strategy:'));
      if (!featureTag) continue;

      const feature = featureTag.replace('strategy:', '');
      const relevantPositive = positiveActions.filter(a =>
        (a.tags || []).some((t: string) => t === `action:${feature}`)
      );

      if (relevantPositive.length > 0) {
        // Hebbian boost: strategy + positive outcome = reinforce
        const newImportance = Math.min(1.0, (strategy.importance || 0.5) + 0.05 * relevantPositive.length);
        await db
          .from('memories')
          .update({ importance: newImportance, access_count: (strategy.access_count || 0) + 1 })
          .eq('id', strategy.id);

        log.debug({ strategyId: strategy.id, feature, boost: relevantPositive.length }, 'Strategy reinforced');
      }
    }
  } catch (err) {
    log.error({ err }, 'Failed to reinforce strategies');
  }
}

// ============================================================
// SOCIAL OUTCOME TRACKING
// ============================================================

/**
 * Check engagement outcomes for recent tweet replies.
 * Call this periodically (e.g., every few hours in dream cycle).
 */
export async function trackSocialOutcomes(): Promise<number> {
  let tracked = 0;

  try {
    const db = getDb();

    // Find action memories awaiting outcome from the last 48h
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

    let pendingQuery = db
      .from('memories')
      .select('*')
      .contains('tags', ['action', 'awaiting_outcome'])
      .gte('created_at', twoDaysAgo)
      .lte('created_at', sixHoursAgo) // at least 6h old for engagement to accumulate
      .limit(20);
    const ownerWallet = getOwnerWallet();
    if (ownerWallet) pendingQuery = pendingQuery.eq('owner_wallet', ownerWallet);
    const { data: pendingActions } = await pendingQuery;

    if (!pendingActions || pendingActions.length === 0) return 0;

    for (const action of pendingActions) {
      const replyId = action.metadata?.replyId;
      if (!replyId) {
        // No reply ID, mark as neutral and move on
        await logOutcome({
          actionId: action.source_id,
          outcome: 'No reply ID available for engagement tracking',
          sentiment: 'neutral',
          measureMethod: 'missing_data',
        });
        tracked++;
        continue;
      }

      // Try to get engagement metrics via X API
      try {
        const { getTweetMetrics } = await import('@clude/shared/core/x-client');
        const metrics = await getTweetMetrics(replyId);

        if (metrics) {
          const totalEngagement = (metrics.likes || 0) + (metrics.retweets || 0) * 2 + (metrics.replies || 0) * 3;

          let sentiment: 'positive' | 'negative' | 'neutral';
          let score: number;

          if (totalEngagement >= 10) {
            sentiment = 'positive';
            score = Math.min(1, totalEngagement / 50);
          } else if (totalEngagement >= 3) {
            sentiment = 'neutral';
            score = 0;
          } else {
            sentiment = 'negative';
            score = -0.3;
          }

          await logOutcome({
            actionId: action.source_id,
            outcome: `Tweet got ${metrics.likes} likes, ${metrics.retweets} RTs, ${metrics.replies} replies`,
            sentiment,
            score,
            measureMethod: 'x_engagement',
            metadata: metrics,
          });
          tracked++;
        }
      } catch {
        // X API failed, skip this one
        log.debug({ replyId }, 'Could not fetch tweet metrics');
      }
    }

    log.info({ tracked }, 'Social outcomes tracked');
  } catch (err) {
    log.error({ err }, 'Social outcome tracking failed');
  }

  return tracked;
}
