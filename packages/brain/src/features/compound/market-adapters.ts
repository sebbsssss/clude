/**
 * Compound — Market Adapters
 * Fetch and normalize prediction market data from Polymarket and Manifold Markets.
 */

import { createChildLogger } from '@clude/shared/core/logger';
import type { Market, MarketAdapter, MarketResolution, FetchMarketsOptions } from './types';

const log = createChildLogger('compound:adapters');

// ---- POLYMARKET ADAPTER ---- //

const POLYMARKET_GAMMA_API = 'https://gamma-api.polymarket.com';

/** Infer category from Polymarket tags */
function inferPolymarketCategory(tags: string[]): string {
  const tagSet = new Set((tags || []).map(t => t.toLowerCase()));
  if (tagSet.has('politics') || tagSet.has('elections')) return 'politics';
  if (tagSet.has('crypto') || tagSet.has('bitcoin') || tagSet.has('ethereum')) return 'crypto';
  if (tagSet.has('sports') || tagSet.has('nba') || tagSet.has('nfl')) return 'sports';
  if (tagSet.has('science') || tagSet.has('climate')) return 'science';
  if (tagSet.has('tech') || tagSet.has('ai')) return 'tech';
  if (tagSet.has('entertainment') || tagSet.has('culture')) return 'entertainment';
  return 'other';
}

function normalizePolymarket(raw: any): Market | null {
  try {
    const closeDate = raw.endDate ? new Date(raw.endDate) : raw.end_date_iso ? new Date(raw.end_date_iso) : null;
    if (!closeDate || isNaN(closeDate.getTime())) return null;
    if (!raw.question) return null;

    // Gamma API provides outcomePrices as JSON string "[\"0.65\",\"0.35\"]"
    let currentOdds = 0.5;
    if (raw.outcomePrices) {
      try {
        const prices = typeof raw.outcomePrices === 'string'
          ? JSON.parse(raw.outcomePrices)
          : raw.outcomePrices;
        currentOdds = parseFloat(prices[0]) || 0.5;
      } catch {
        currentOdds = 0.5;
      }
    }

    return {
      sourceId: String(raw.id || raw.condition_id),
      source: 'polymarket',
      question: raw.question || raw.title,
      currentOdds,
      volume: parseFloat(raw.volume || raw.volumeNum || '0'),
      liquidity: parseFloat(raw.liquidity || raw.liquidityNum || '0'),
      closeDate,
      category: inferPolymarketCategory(raw.tags || []),
      active: raw.active !== false && raw.closed !== true,
      url: `https://polymarket.com/event/${raw.slug || raw.id}`,
      raw,
    };
  } catch (err) {
    log.warn({ err, rawId: raw?.id }, 'Failed to normalize Polymarket market');
    return null;
  }
}

export class PolymarketAdapter implements MarketAdapter {
  readonly source = 'polymarket' as const;

  async fetchMarkets(opts: FetchMarketsOptions = {}): Promise<Market[]> {
    const { limit = 50, minVolume = 0, activeOnly = true } = opts;

    try {
      const params = new URLSearchParams({
        limit: String(limit),
        active: String(activeOnly),
        closed: 'false',
        order: 'volume',
        ascending: 'false',
      });

      const res = await fetch(`${POLYMARKET_GAMMA_API}/markets?${params}`);
      if (!res.ok) {
        log.error({ status: res.status }, 'Polymarket API error');
        return [];
      }

      const data = (await res.json()) as any[];
      const markets: Market[] = [];

      for (const raw of data) {
        const market = normalizePolymarket(raw);
        if (market && market.volume >= minVolume) {
          markets.push(market);
        }
      }

      log.info({ count: markets.length }, 'Fetched Polymarket markets');
      return markets;
    } catch (err) {
      log.error({ err }, 'Failed to fetch Polymarket markets');
      return [];
    }
  }

  async fetchMarket(sourceId: string): Promise<Market | null> {
    try {
      const res = await fetch(`${POLYMARKET_GAMMA_API}/markets/${sourceId}`);
      if (!res.ok) return null;
      const raw = await res.json();
      return normalizePolymarket(raw);
    } catch (err) {
      log.error({ err, sourceId }, 'Failed to fetch Polymarket market');
      return null;
    }
  }

  async fetchResolutions(since: Date): Promise<MarketResolution[]> {
    try {
      const params = new URLSearchParams({
        closed: 'true',
        limit: '50',
        order: 'end_date_iso',
        ascending: 'false',
      });

      const res = await fetch(`${POLYMARKET_GAMMA_API}/markets?${params}`);
      if (!res.ok) return [];
      const data = (await res.json()) as any[];

      const resolutions: MarketResolution[] = [];
      for (const raw of data) {
        const endDate = raw.endDate ? new Date(raw.endDate) : raw.end_date_iso ? new Date(raw.end_date_iso) : null;
        if (!endDate || endDate < since) continue;

        // Resolved markets have resolvedBy and outcomePrices settled to 1/0
        if (!raw.question) continue;

        let outcome = 0;
        if (raw.outcomePrices) {
          try {
            const prices = typeof raw.outcomePrices === 'string'
              ? JSON.parse(raw.outcomePrices)
              : raw.outcomePrices;
            outcome = parseFloat(prices[0]) >= 0.99 ? 1.0 : 0.0;
          } catch {
            continue;
          }
        }

        resolutions.push({
          sourceId: String(raw.id || raw.condition_id),
          source: 'polymarket',
          question: raw.question,
          outcome,
          resolvedAt: endDate,
        });
      }

      log.info({ count: resolutions.length, since: since.toISOString() }, 'Fetched Polymarket resolutions');
      return resolutions;
    } catch (err) {
      log.error({ err }, 'Failed to fetch Polymarket resolutions');
      return [];
    }
  }
}

// ---- MANIFOLD MARKETS ADAPTER ---- //

const MANIFOLD_API = 'https://api.manifold.markets/v0';

function inferManifoldCategory(groupSlugs: string[]): string {
  const slugSet = new Set((groupSlugs || []).map(s => s.toLowerCase()));
  if (slugSet.has('politics') || slugSet.has('us-politics') || slugSet.has('elections')) return 'politics';
  if (slugSet.has('crypto') || slugSet.has('cryptocurrency') || slugSet.has('bitcoin')) return 'crypto';
  if (slugSet.has('sports') || slugSet.has('nba') || slugSet.has('soccer')) return 'sports';
  if (slugSet.has('science') || slugSet.has('technology')) return 'science';
  if (slugSet.has('ai') || slugSet.has('artificial-intelligence') || slugSet.has('tech')) return 'tech';
  return 'other';
}

function normalizeManifold(raw: any): Market | null {
  try {
    if (!raw.question) return null;
    // Only handle binary markets (YES/NO)
    if (raw.outcomeType !== 'BINARY') return null;

    const closeDate = raw.closeTime ? new Date(raw.closeTime) : null;
    if (!closeDate || isNaN(closeDate.getTime())) return null;

    return {
      sourceId: raw.id,
      source: 'manifold',
      question: raw.question,
      currentOdds: raw.probability ?? 0.5,
      volume: raw.volume ?? 0,
      liquidity: raw.totalLiquidity ?? 0,
      closeDate,
      category: inferManifoldCategory(raw.groupSlugs || []),
      active: !raw.isResolved && (closeDate > new Date()),
      url: `https://manifold.markets/${raw.creatorUsername}/${raw.slug}`,
      raw,
    };
  } catch (err) {
    log.warn({ err, rawId: raw?.id }, 'Failed to normalize Manifold market');
    return null;
  }
}

export class ManifoldAdapter implements MarketAdapter {
  readonly source = 'manifold' as const;

  async fetchMarkets(opts: FetchMarketsOptions = {}): Promise<Market[]> {
    const { limit = 50, minVolume = 0 } = opts;

    try {
      const params = new URLSearchParams({
        limit: String(limit),
        sort: 'liquidity',
        order: 'desc',
      });
      if (opts.category) {
        params.set('topicSlug', opts.category);
      }

      const res = await fetch(`${MANIFOLD_API}/search-markets?${params}`);
      if (!res.ok) {
        log.error({ status: res.status }, 'Manifold API error');
        return [];
      }

      const data = (await res.json()) as any[];
      const markets: Market[] = [];

      for (const raw of data) {
        const market = normalizeManifold(raw);
        if (market && market.active && market.volume >= minVolume) {
          markets.push(market);
        }
      }

      log.info({ count: markets.length }, 'Fetched Manifold markets');
      return markets;
    } catch (err) {
      log.error({ err }, 'Failed to fetch Manifold markets');
      return [];
    }
  }

  async fetchMarket(sourceId: string): Promise<Market | null> {
    try {
      const res = await fetch(`${MANIFOLD_API}/market/${sourceId}`);
      if (!res.ok) return null;
      const raw = await res.json();
      return normalizeManifold(raw);
    } catch (err) {
      log.error({ err, sourceId }, 'Failed to fetch Manifold market');
      return null;
    }
  }

  async fetchResolutions(since: Date): Promise<MarketResolution[]> {
    try {
      const params = new URLSearchParams({
        limit: '50',
        sort: 'close-date',
        order: 'desc',
        filter: 'resolved',
      });

      const res = await fetch(`${MANIFOLD_API}/search-markets?${params}`);
      if (!res.ok) return [];
      const data = (await res.json()) as any[];

      const resolutions: MarketResolution[] = [];
      for (const raw of data) {
        if (raw.outcomeType !== 'BINARY') continue;
        const resolvedAt = raw.resolutionTime ? new Date(raw.resolutionTime) : null;
        if (!resolvedAt || resolvedAt < since) continue;

        const outcome = raw.resolution === 'YES' ? 1.0 : raw.resolution === 'NO' ? 0.0 : null;
        if (outcome === null) continue; // Skip CANCEL, MKT, etc.

        resolutions.push({
          sourceId: raw.id,
          source: 'manifold',
          question: raw.question,
          outcome,
          resolvedAt,
        });
      }

      log.info({ count: resolutions.length, since: since.toISOString() }, 'Fetched Manifold resolutions');
      return resolutions;
    } catch (err) {
      log.error({ err }, 'Failed to fetch Manifold resolutions');
      return [];
    }
  }
}

// ---- AGGREGATE ---- //

/** Create adapters based on config */
export function createAdapters(config: { polymarketEnabled: boolean; manifoldEnabled: boolean }): MarketAdapter[] {
  const adapters: MarketAdapter[] = [];
  if (config.polymarketEnabled) adapters.push(new PolymarketAdapter());
  if (config.manifoldEnabled) adapters.push(new ManifoldAdapter());
  return adapters;
}

/** Fetch markets from all enabled adapters */
export async function fetchAllMarkets(
  adapters: MarketAdapter[],
  opts: FetchMarketsOptions = {},
): Promise<Market[]> {
  const results = await Promise.allSettled(
    adapters.map(a => a.fetchMarkets(opts)),
  );

  const markets: Market[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      markets.push(...result.value);
    }
  }

  // Sort by volume descending
  markets.sort((a, b) => b.volume - a.volume);
  return markets;
}

/** Fetch resolutions from all enabled adapters */
export async function fetchAllResolutions(
  adapters: MarketAdapter[],
  since: Date,
): Promise<MarketResolution[]> {
  const results = await Promise.allSettled(
    adapters.map(a => a.fetchResolutions(since)),
  );

  const resolutions: MarketResolution[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      resolutions.push(...result.value);
    }
  }

  return resolutions;
}
