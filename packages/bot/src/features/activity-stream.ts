import { getDb } from '../core/database';
import { getCurrentMood } from '../core/price-oracle';
import { getMoodModifier } from '../character/mood-modifiers';
import { config } from '../config';
import { createChildLogger } from '../core/logger';
import { truncateWallet } from '../utils/format';
import { buildAndGenerate } from '../services/response.service';

const log = createChildLogger('activity-stream');

export interface ActivityEvent {
  signature: string;
  type: string;
  wallet: string;
  amount: number;
  solValue: number;
  timestamp: string;
  isWhale: boolean;
  commentary?: string;
}

// Cache for whale commentary to avoid duplicate Claude calls
const commentaryCache = new Map<string, string>();

export async function getRecentActivity(
  limit?: number,
  minSol?: number
): Promise<ActivityEvent[]> {
  const db = getDb();
  const maxEvents = Math.min(limit || config.activity.maxEvents, 50);
  const minSolValue = minSol ?? config.activity.minSolValue;

  const { data, error } = await db
    .from('token_events')
    .select('signature, event_type, wallet_address, amount, sol_value, timestamp')
    .gte('sol_value', minSolValue)
    .order('timestamp', { ascending: false })
    .limit(maxEvents);

  if (error || !data) {
    log.error({ error: error?.message }, 'Failed to fetch activity');
    return [];
  }

  const events: ActivityEvent[] = data.map((row) => {
    const isWhale = (row.sol_value || 0) >= config.activity.whaleThreshold;
    const wallet = row.wallet_address || '';

    return {
      signature: row.signature,
      type: row.event_type || 'unknown',
      wallet: wallet.length > 8
        ? truncateWallet(wallet)
        : wallet,
      amount: row.amount || 0,
      solValue: row.sol_value || 0,
      timestamp: row.timestamp,
      isWhale,
      commentary: commentaryCache.get(row.signature),
    };
  });

  // Generate commentary for whale events that don't have one yet (async, limited)
  const whalesWithoutCommentary = events
    .filter(e => e.isWhale && !e.commentary)
    .slice(0, 2); // Max 2 per request

  for (const whale of whalesWithoutCommentary) {
    generateEventCommentary(whale).catch(err => log.error({ err }, 'Commentary generation failed'));
  }

  return events;
}

export async function generateEventCommentary(event: ActivityEvent): Promise<string | null> {
  if (commentaryCache.has(event.signature)) {
    return commentaryCache.get(event.signature)!;
  }

  try {
    const action = event.type.includes('buy') ? 'bought' : 'sold';

    const commentary = await buildAndGenerate({
      message: `A wallet ${action} ${event.solValue.toFixed(4)} SOL worth of tokens.`,
      forTwitter: true,  // Enforce char limit
      instruction:
        `A ${event.isWhale ? 'whale' : 'notable'} ${action} just happened. ` +
        `Wallet ${event.wallet} ${action} ${event.solValue.toFixed(4)} SOL worth. ` +
        'Give a one-liner reaction. Be sharp.',
      maxTokens: 60,
    });

    commentaryCache.set(event.signature, commentary);

    // Evict old cache entries (keep last 50)
    if (commentaryCache.size > 50) {
      const firstKey = commentaryCache.keys().next().value;
      if (firstKey) commentaryCache.delete(firstKey);
    }

    return commentary;
  } catch (err) {
    log.error({ err }, 'Failed to generate event commentary');
    return null;
  }
}
