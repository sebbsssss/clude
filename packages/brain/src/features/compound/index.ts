/**
 * Compound — Prediction Market Intelligence Engine
 * Orchestrator: periodic market scanning, analysis, memory loop, and resolution tracking.
 *
 * Usage:
 *   import { startCompound, stopCompound } from './features/compound';
 *   startCompound();  // Begin periodic scanning
 *   stopCompound();   // Clean shutdown
 */

import { createChildLogger } from '@clude/shared/core/logger';
import { createAdapters, fetchAllMarkets, fetchAllResolutions } from './market-adapters';
import { analyzeMarkets } from './analysis';
import { storePrediction, storeResolution, getAccuracyStats } from './memory-loop';
import type { MarketAdapter, CompoundAnalysis, CompoundConfig, Market } from './types';

export type { Market, CompoundAnalysis, CompoundConfig } from './types';
export { getAccuracyStats } from './memory-loop';
export { analyzeMarket } from './analysis';
export { PolymarketAdapter, ManifoldAdapter } from './market-adapters';

const log = createChildLogger('compound');

// ---- DEFAULT CONFIG ---- //

const DEFAULT_CONFIG: CompoundConfig = {
  valueThreshold: parseFloat(process.env.COMPOUND_VALUE_THRESHOLD || '0.10'),
  scanIntervalMs: parseInt(process.env.COMPOUND_SCAN_INTERVAL_MS || '3600000', 10), // 1 hour
  resolutionCheckIntervalMs: parseInt(process.env.COMPOUND_RESOLUTION_CHECK_MS || '14400000', 10), // 4 hours
  maxMarketsPerScan: parseInt(process.env.COMPOUND_MAX_MARKETS_PER_SCAN || '20', 10),
  minVolume: parseInt(process.env.COMPOUND_MIN_VOLUME || '10000', 10), // $10k
  polymarketEnabled: process.env.COMPOUND_POLYMARKET !== 'false',
  manifoldEnabled: process.env.COMPOUND_MANIFOLD !== 'false',
};

// ---- STATE ---- //

let adapters: MarketAdapter[] = [];
let scanTimer: ReturnType<typeof setInterval> | null = null;
let resolutionTimer: ReturnType<typeof setInterval> | null = null;
let lastResolutionCheck = new Date(Date.now() - 24 * 60 * 60 * 1000); // Start looking back 24h
let running = false;

// ---- SCAN CYCLE ---- //

/**
 * Run one market scan cycle:
 * 1. Fetch markets from all adapters
 * 2. Analyze top markets by volume
 * 3. Store predictions in memory
 */
export async function runScanCycle(config: CompoundConfig = DEFAULT_CONFIG): Promise<CompoundAnalysis[]> {
  if (!adapters.length) {
    log.warn('No adapters configured — skipping scan');
    return [];
  }

  log.info('Starting market scan cycle');

  try {
    // 1. Fetch markets
    const markets = await fetchAllMarkets(adapters, {
      limit: config.maxMarketsPerScan * 2, // Fetch more to filter
      minVolume: config.minVolume,
      activeOnly: true,
    });

    if (markets.length === 0) {
      log.info('No markets found matching criteria');
      return [];
    }

    // 2. Take top N by volume
    const toAnalyze = markets.slice(0, config.maxMarketsPerScan);
    log.info({ count: toAnalyze.length, totalAvailable: markets.length }, 'Markets selected for analysis');

    // 3. Analyze
    const analyses = await analyzeMarkets(toAnalyze, config);

    // 4. Store predictions in memory
    for (const analysis of analyses) {
      await storePrediction(analysis).catch(err =>
        log.error({ err, question: analysis.market.question }, 'Failed to store prediction'),
      );
    }

    const valueCount = analyses.filter(a => a.isValue).length;
    log.info({
      analyzed: analyses.length,
      valueOpportunities: valueCount,
      avgEdge: analyses.length > 0
        ? (analyses.reduce((s, a) => s + a.edge, 0) / analyses.length).toFixed(3)
        : '0',
    }, 'Scan cycle complete');

    return analyses;
  } catch (err) {
    log.error({ err }, 'Scan cycle failed');
    return [];
  }
}

// ---- RESOLUTION CHECK ---- //

/**
 * Check for recently resolved markets and update accuracy tracking.
 */
export async function runResolutionCheck(): Promise<void> {
  if (!adapters.length) return;

  log.info({ since: lastResolutionCheck.toISOString() }, 'Checking for resolved markets');

  try {
    const resolutions = await fetchAllResolutions(adapters, lastResolutionCheck);

    if (resolutions.length === 0) {
      log.info('No new resolutions found');
      lastResolutionCheck = new Date();
      return;
    }

    let stored = 0;
    for (const resolution of resolutions) {
      const result = await storeResolution(resolution).catch(err => {
        log.error({ err, sourceId: resolution.sourceId }, 'Failed to store resolution');
        return null;
      });
      if (result) stored++;
    }

    log.info({ total: resolutions.length, stored }, 'Resolution check complete');
    lastResolutionCheck = new Date();
  } catch (err) {
    log.error({ err }, 'Resolution check failed');
  }
}

// ---- LIFECYCLE ---- //

/**
 * Start the Compound engine: initialize adapters and begin periodic scanning.
 */
export function startCompound(config: CompoundConfig = DEFAULT_CONFIG): void {
  if (running) {
    log.warn('Compound already running');
    return;
  }

  adapters = createAdapters(config);
  if (adapters.length === 0) {
    log.warn('No market adapters enabled — Compound not starting');
    return;
  }

  running = true;
  log.info({
    adapters: adapters.map(a => a.source),
    scanIntervalMs: config.scanIntervalMs,
    valueThreshold: config.valueThreshold,
    maxMarketsPerScan: config.maxMarketsPerScan,
    minVolume: config.minVolume,
  }, 'Compound starting');

  // Initial scan after 30s delay (let other systems initialize)
  setTimeout(() => runScanCycle(config).catch(() => {}), 30_000);

  // Periodic scan
  scanTimer = setInterval(() => {
    runScanCycle(config).catch(err => log.error({ err }, 'Periodic scan failed'));
  }, config.scanIntervalMs);

  // Resolution check (less frequent)
  resolutionTimer = setInterval(() => {
    runResolutionCheck().catch(err => log.error({ err }, 'Periodic resolution check failed'));
  }, config.resolutionCheckIntervalMs);
}

/**
 * Stop the Compound engine.
 */
export function stopCompound(): void {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  if (resolutionTimer) {
    clearInterval(resolutionTimer);
    resolutionTimer = null;
  }
  adapters = [];
  running = false;
  log.info('Compound stopped');
}

/**
 * Check if Compound is running.
 */
export function isCompoundRunning(): boolean {
  return running;
}
