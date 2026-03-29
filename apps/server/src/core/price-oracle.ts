import { config } from '../config';
import { getDb } from './database';
import { createChildLogger } from './logger';
import { eventBus, type Mood } from '../events/event-bus';
import { percentChange } from '../utils/format';
import {
  JUPITER_PRICE_URL,
  PRICE_SNAPSHOT_RETENTION_HOURS,
  WHALE_SELL_COOLDOWN_MS,
  PUMP_DUMP_THRESHOLD_PERCENT,
  SIDEWAYS_THRESHOLD_PERCENT,
} from '../utils/constants';
import type { JupiterPriceResponse } from '../types/api';

const log = createChildLogger('price-oracle');

// Re-export Mood from event-bus (canonical source) for backwards compat
export type { Mood } from '../events/event-bus';

interface PriceState {
  currentPrice: number;
  change1h: number;
  change24h: number;
  mood: Mood;
  lastUpdate: Date;
}

let currentState: PriceState = {
  currentPrice: 0,
  change1h: 0,
  change24h: 0,
  mood: 'NEUTRAL',
  lastUpdate: new Date(0),
};

let allTimeHigh = 0;
let recentWhaleSell = false;

export function getCurrentMood(): Mood {
  return currentState.mood;
}

export function getPriceState(): PriceState {
  return { ...currentState };
}

export function flagWhaleSell(): void {
  recentWhaleSell = true;
  setTimeout(() => { recentWhaleSell = false; }, WHALE_SELL_COOLDOWN_MS);
}

async function fetchPrice(): Promise<{ price: number; volume24h: number } | null> {
  if (!config.solana.cludeTokenMint) return null;

  try {
    const url = `${JUPITER_PRICE_URL}?ids=${config.solana.cludeTokenMint}`;
    const res = await fetch(url);
    const data = await res.json() as JupiterPriceResponse;
    const tokenData = data.data?.[config.solana.cludeTokenMint];
    if (!tokenData) return null;

    return {
      price: parseFloat(tokenData.price),
      volume24h: 0,
    };
  } catch (err) {
    log.error({ err }, 'Failed to fetch price');
    return null;
  }
}

async function calculateMood(): Promise<Mood> {
  if (recentWhaleSell) return 'WHALE_SELL';
  if (currentState.currentPrice > 0 && currentState.currentPrice >= allTimeHigh) return 'NEW_ATH';
  if (currentState.change1h >= PUMP_DUMP_THRESHOLD_PERCENT) return 'PUMPING';
  if (currentState.change1h <= -PUMP_DUMP_THRESHOLD_PERCENT) return 'DUMPING';

  const db = getDb();
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data: oldSnapshot, error } = await db
    .from('price_snapshots')
    .select('price_usd')
    .lte('recorded_at', sixHoursAgo)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    log.debug({ error: error.message }, 'No 6h snapshot available for mood calculation');
  }

  if (oldSnapshot && currentState.currentPrice > 0) {
    const change6h = percentChange(oldSnapshot.price_usd, currentState.currentPrice);
    if (Math.abs(change6h) < SIDEWAYS_THRESHOLD_PERCENT) return 'SIDEWAYS';
  }

  return 'NEUTRAL';
}

export async function pollPrice(): Promise<void> {
  const priceData = await fetchPrice();
  if (!priceData) return;

  const db = getDb();

  const { error: insertError } = await db
    .from('price_snapshots')
    .insert({ price_usd: priceData.price, volume_24h: priceData.volume24h });

  if (insertError) {
    log.error({ error: insertError.message }, 'Failed to store price snapshot');
  }

  // Calculate 1h change
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: snapshot1h, error: err1h } = await db
    .from('price_snapshots')
    .select('price_usd')
    .lte('recorded_at', oneHourAgo)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .single();

  if (err1h) {
    log.debug({ error: err1h.message }, 'No 1h snapshot yet');
  }

  // Calculate 24h change
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: snapshot24h, error: err24h } = await db
    .from('price_snapshots')
    .select('price_usd')
    .lte('recorded_at', twentyFourHoursAgo)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .single();

  if (err24h) {
    log.debug({ error: err24h.message }, 'No 24h snapshot yet');
  }

  const change1h = snapshot1h ? percentChange(snapshot1h.price_usd, priceData.price) : 0;
  const change24h = snapshot24h ? percentChange(snapshot24h.price_usd, priceData.price) : 0;

  if (priceData.price > allTimeHigh) {
    allTimeHigh = priceData.price;
  }

  const previousMood = currentState.mood;

  currentState = {
    currentPrice: priceData.price,
    change1h,
    change24h,
    mood: 'NEUTRAL',
    lastUpdate: new Date(),
  };

  currentState.mood = await calculateMood();

  if (currentState.mood !== previousMood) {
    eventBus.emit('mood:changed', { previous: previousMood, current: currentState.mood });
  }

  log.debug({
    price: priceData.price,
    change1h: change1h.toFixed(2),
    mood: currentState.mood,
  }, 'Price updated');

  // Clean up old snapshots
  const cutoff = new Date(Date.now() - PRICE_SNAPSHOT_RETENTION_HOURS * 60 * 60 * 1000).toISOString();
  const { error: deleteError } = await db
    .from('price_snapshots')
    .delete()
    .lt('recorded_at', cutoff);

  if (deleteError) {
    log.error({ error: deleteError.message }, 'Failed to clean up old snapshots');
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

export function startPriceOracle(): void {
  log.info({ intervalMs: config.intervals.pricePollMs }, 'Starting price oracle');
  pollPrice();
  pollTimer = setInterval(pollPrice, config.intervals.pricePollMs);
}

export function stopPriceOracle(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
