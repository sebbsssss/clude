/**
 * Compound — Prediction Market Intelligence Engine
 * Common types and schemas for market data, analysis, and predictions.
 */

/** Normalized market data from any prediction market source */
export interface Market {
  /** Unique identifier from the source platform */
  sourceId: string;
  /** Source platform name */
  source: 'polymarket' | 'manifold';
  /** The market question */
  question: string;
  /** Current probability (0-1) for the primary outcome */
  currentOdds: number;
  /** 24h trading volume in USD */
  volume: number;
  /** Total liquidity in USD */
  liquidity: number;
  /** Market close/resolution date */
  closeDate: Date;
  /** Category (e.g., politics, crypto, sports, science, tech) */
  category: string;
  /** Whether the market is currently active */
  active: boolean;
  /** URL to the market on the source platform */
  url: string;
  /** Raw data from the source API (for debugging) */
  raw?: unknown;
}

/** Market resolution outcome */
export interface MarketResolution {
  sourceId: string;
  source: 'polymarket' | 'manifold';
  question: string;
  /** Resolved outcome probability (1.0 = YES, 0.0 = NO) */
  outcome: number;
  resolvedAt: Date;
}

/** Compound's analysis of a market */
export interface CompoundAnalysis {
  market: Market;
  /** Compound's estimated probability (0-1) */
  estimatedProbability: number;
  /** Confidence in the estimate (0-1) */
  confidence: number;
  /** LLM-generated reasoning */
  reasoning: string;
  /** Absolute difference: |estimate - market odds| */
  edge: number;
  /** Whether this meets the value threshold */
  isValue: boolean;
  /** Key evidence points used */
  evidence: string[];
  /** Timestamp of analysis */
  analyzedAt: Date;
}

/** Prediction record stored in memory */
export interface PredictionRecord {
  /** Clude memory ID of the prediction */
  memoryId: number | null;
  market: Market;
  estimatedProbability: number;
  confidence: number;
  reasoning: string;
  edge: number;
  analyzedAt: Date;
  /** Resolution data (populated when market resolves) */
  resolution?: {
    outcome: number;
    resolvedAt: Date;
    /** Brier score: (estimate - outcome)^2, lower is better */
    brierScore: number;
    /** Whether Compound's directional call was correct */
    correct: boolean;
  };
}

/** Adapter interface — all market sources implement this */
export interface MarketAdapter {
  /** Source platform name */
  readonly source: 'polymarket' | 'manifold';
  /** Fetch active markets, optionally filtered */
  fetchMarkets(opts?: FetchMarketsOptions): Promise<Market[]>;
  /** Fetch a single market by source ID */
  fetchMarket(sourceId: string): Promise<Market | null>;
  /** Check for recently resolved markets */
  fetchResolutions(since: Date): Promise<MarketResolution[]>;
}

export interface FetchMarketsOptions {
  /** Max number of markets to return */
  limit?: number;
  /** Filter by category */
  category?: string;
  /** Minimum volume (USD) */
  minVolume?: number;
  /** Only active markets */
  activeOnly?: boolean;
}

/** Compound configuration */
export interface CompoundConfig {
  /** Minimum edge (|estimate - odds|) to flag as value */
  valueThreshold: number;
  /** How often to scan markets (ms) */
  scanIntervalMs: number;
  /** How often to check for resolutions (ms) */
  resolutionCheckIntervalMs: number;
  /** Max markets to analyze per scan */
  maxMarketsPerScan: number;
  /** Min volume (USD) to consider a market */
  minVolume: number;
  /** Whether to enable Polymarket adapter */
  polymarketEnabled: boolean;
  /** Whether to enable Manifold adapter */
  manifoldEnabled: boolean;
}
