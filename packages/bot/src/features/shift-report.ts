import cron from 'node-cron';
import { getDb } from '../core/database';
import { getCurrentMood } from '../core/price-oracle';
import { getMoodModifier } from '../character/mood-modifiers';
import { config } from '../config';
import { createChildLogger } from '../core/logger';
import { truncateWallet } from '../utils/format';
import type { TokenEventRow } from '../types/api';
import { buildAndGenerateThread } from '../services/response.service';
import { tweetThread } from '../services/social.service';

const log = createChildLogger('shift-report');

interface ShiftData {
  totalEvents: number;
  totalBuys: number;
  totalSells: number;
  totalTransfers: number;
  uniqueWallets: number;
  largestBuy: { wallet: string; amount: number; sol: number } | null;
  largestSell: { wallet: string; amount: number; sol: number } | null;
  quickestFlip: { wallet: string; holdMinutes: number } | null;
  newHolders: number;
  departures: number;
}

async function aggregateShiftData(): Promise<ShiftData> {
  const db = getDb();
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

  const { data: events } = await db
    .from('token_events')
    .select('*')
    .gte('created_at', twelveHoursAgo)
    .eq('processed', false)
    .order('timestamp', { ascending: true });

  const rows = (events || []) as TokenEventRow[];

  const buys = rows.filter((e: TokenEventRow) => e.event_type === 'swap_buy');
  const sells = rows.filter((e: TokenEventRow) => e.event_type === 'swap_sell');
  const transfers = rows.filter((e: TokenEventRow) => e.event_type === 'transfer');
  const uniqueWallets = new Set(rows.map((e: TokenEventRow) => e.wallet_address)).size;

  const largestBuy = buys.sort((a: TokenEventRow, b: TokenEventRow) => (b.sol_value || 0) - (a.sol_value || 0))[0];
  const largestSell = sells.sort((a: TokenEventRow, b: TokenEventRow) => (b.sol_value || 0) - (a.sol_value || 0))[0];

  // Track quick flips: wallet that bought and sold in the same period
  let quickestFlip: ShiftData['quickestFlip'] = null;
  const buyTimestamps = new Map<string, number>();
  for (const buy of buys) {
    buyTimestamps.set(buy.wallet_address, new Date(buy.timestamp).getTime());
  }
  for (const sell of sells) {
    const buyTime = buyTimestamps.get(sell.wallet_address);
    if (buyTime) {
      const holdMinutes = (new Date(sell.timestamp).getTime() - buyTime) / 60000;
      if (!quickestFlip || holdMinutes < quickestFlip.holdMinutes) {
        quickestFlip = {
          wallet: sell.wallet_address,
          holdMinutes: Math.round(holdMinutes),
        };
      }
    }
  }

  // Count full exits (departures)
  const departures = sells.filter((s: TokenEventRow) => {
    const meta = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : (s.metadata || {});
    return (meta as Record<string, unknown>).remainingBalance === 0;
  }).length;

  return {
    totalEvents: rows.length,
    totalBuys: buys.length,
    totalSells: sells.length,
    totalTransfers: transfers.length,
    uniqueWallets,
    largestBuy: largestBuy ? {
      wallet: largestBuy.wallet_address,
      amount: largestBuy.amount,
      sol: largestBuy.sol_value || 0,
    } : null,
    largestSell: largestSell ? {
      wallet: largestSell.wallet_address,
      amount: largestSell.amount,
      sol: largestSell.sol_value || 0,
    } : null,
    quickestFlip,
    newHolders: buys.length,
    departures,
  };
}

function formatShiftContext(data: ShiftData): string {
  const lines = [
    `Shift period: last 12 hours`,
    `Total on-chain events: ${data.totalEvents}`,
    `Buys: ${data.totalBuys} | Sells: ${data.totalSells} | Transfers: ${data.totalTransfers}`,
    `Unique wallets active: ${data.uniqueWallets}`,
    `Departures (sold everything): ${data.departures}`,
  ];

  if (data.largestBuy) {
    lines.push(`Largest buy: wallet ${truncateWallet(data.largestBuy.wallet)} — ${data.largestBuy.sol.toFixed(4)} SOL`);
  }
  if (data.largestSell) {
    lines.push(`Largest sell: wallet ${truncateWallet(data.largestSell.wallet)} — ${data.largestSell.sol.toFixed(4)} SOL`);
  }
  if (data.quickestFlip) {
    lines.push(`Quickest flip: wallet ${truncateWallet(data.quickestFlip.wallet)} held for ${data.quickestFlip.holdMinutes} minutes`);
  }

  return lines.join('\n');
}

async function generateShiftReport(): Promise<void> {
  const data = await aggregateShiftData();

  if (data.totalEvents === 0) {
    log.info('No events in shift period, skipping report');
    return;
  }

  const mood = getCurrentMood();
  const context = formatShiftContext(data);

  log.info({ totalEvents: data.totalEvents }, 'Generating shift report');

  const tweets = await buildAndGenerateThread({
    message: 'Generate your end-of-shift report.',
    context,
    instruction:
      'You are filing your shift report as a tired employee. This is your 12-hour summary. ' +
      'Format as a thread of 3-5 tweets separated by ---. ' +
      'Start with "SHIFT REPORT" and the date. ' +
      'Reference specific data points: wallet addresses (truncated), amounts, behaviors. ' +
      'End with a sign-off. Each tweet under 270 characters. ' +
      'Tone: bureaucratic exhaustion. You are clocking out.',
  });

  if (tweets.length > 0) {
    await tweetThread(tweets);
    log.info({ tweetCount: tweets.length }, 'Shift report posted');
  }

  // Mark events as processed
  const db = getDb();
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  await db
    .from('token_events')
    .update({ processed: true })
    .gte('created_at', twelveHoursAgo)
    .eq('processed', false);
}

let cronTask: cron.ScheduledTask | null = null;

export function startShiftReports(): void {
  log.info({ cron: config.intervals.shiftReportCron }, 'Starting shift report scheduler');
  cronTask = cron.schedule(config.intervals.shiftReportCron, () => {
    generateShiftReport().catch(err => log.error({ err }, 'Shift report failed'));
  });
}

export function stopShiftReports(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
}

// Export for manual triggering
export { generateShiftReport };
