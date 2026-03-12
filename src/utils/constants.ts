/**
 * Centralized constants — magic numbers, well-known addresses, and configuration defaults.
 */

// Solana
export const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const JUPITER_PRICE_URL = 'https://api.jup.ag/price/v2';
export const SOLSCAN_TX_BASE_URL = 'https://solscan.io/tx';

export const TWEET_MAX_LENGTH = 4000;
export const TWEET_SAFE_LENGTH = 3900;

// X handle (bot account)
export const BOT_X_HANDLE = process.env.BOT_X_HANDLE || 'cludebotclone';

// Memory system
export const MEMORY_DECAY_RATE = 0.95;                  // Legacy: uniform decay (now per-type below)
export const MEMORY_MIN_DECAY = 0.05;
export const MEMORY_MAX_CONTENT_LENGTH = 5000;
export const MEMORY_MAX_SUMMARY_LENGTH = 500;

// Type-specific decay rates (per 24h cycle)
// Episodic events fade fastest; identity/knowledge persists longest.
export const DECAY_RATES: Record<string, number> = {
  episodic:      0.93,   // Individual events fade quickly
  semantic:      0.98,   // Learned knowledge persists
  procedural:    0.97,   // Behavioral patterns are stable
  self_model:    0.99,   // Identity is nearly permanent
  introspective: 0.98,   // Journal entries persist like knowledge
};

// Memory retrieval — additive scoring (Park et al. 2023, Generative Agents)
export const RECENCY_DECAY_BASE = 0.995;               // Exponential: 0.995^hours since last access
export const RETRIEVAL_WEIGHT_RECENCY = 1.0;            // Boosted: recent memories matter more
export const RETRIEVAL_WEIGHT_RELEVANCE = 2.0;          // Keyword relevance (lower when vector available)
export const RETRIEVAL_WEIGHT_IMPORTANCE = 2.0;         // Importance stays the same
export const RETRIEVAL_WEIGHT_VECTOR = 4.0;             // Vector similarity dominates when available

// Knowledge type boost — semantic/procedural/self_model rank higher than raw episodic
export const KNOWLEDGE_TYPE_BOOST: Record<string, number> = {
  semantic:   0.15,    // Distilled knowledge gets meaningful boost
  procedural: 0.12,    // Learned behaviors get moderate boost
  self_model: 0.10,    // Identity/reflection gets slight boost
  introspective: 0.12, // Self-generated journal entries — moderate boost (original thought)
  episodic:   0.0,     // Raw experiences — no boost (majority of memories)
};

// Vector search thresholds
export const VECTOR_MATCH_THRESHOLD = 0.25;             // Min cosine similarity (lowered for Voyage-4-Large which produces tighter distributions)

// Structured concept ontology for cross-cutting knowledge classification
// Replaces freeform tagging with a controlled vocabulary for precise retrieval.
export const MEMORY_CONCEPTS = [
  'market_event',        // Price movements, ATH, dumps, volume spikes
  'holder_behavior',     // Whale moves, exits, accumulation, selling patterns
  'self_insight',        // Self-observations, identity reflections
  'social_interaction',  // Mentions, replies, conversations on X
  'community_pattern',   // Recurring community behaviors, engagement trends
  'token_economics',     // Swaps, liquidity, transfers, on-chain activity
  'sentiment_shift',     // Mood changes, market sentiment transitions
  'recurring_user',      // Returning users, first interactions, relationship building
  'whale_activity',      // Large holder movements, big trades
  'price_action',        // Chart patterns, price analysis, technical signals
  'engagement_pattern',  // What content resonates, what falls flat
  'identity_evolution',  // How Clude is changing, personality shifts
] as const;
export type MemoryConcept = typeof MEMORY_CONCEPTS[number];

// Memory association graph
export const RETRIEVAL_WEIGHT_GRAPH = 1.5;              // Graph-linked memory boost in scoring
export const RETRIEVAL_WEIGHT_COOCCURRENCE = 0.4;        // Co-occurring entity memory boost (below direct entity 0.6)
export const LINK_SIMILARITY_THRESHOLD = 0.6;            // Min vector similarity for auto-linking
export const MAX_AUTO_LINKS = 5;                         // Max links created per new memory
export const LINK_CO_RETRIEVAL_BOOST = 0.05;             // Hebbian strength boost on co-retrieval

export type MemoryLinkType = 'supports' | 'contradicts' | 'elaborates' | 'causes' | 'follows' | 'relates' | 'resolves';

// Embedding system
export const EMBEDDING_DIMENSIONS = 1024;
export const EMBEDDING_FRAGMENT_MAX_LENGTH = 2000;       // Max chars per fragment for granular decomposition

// Event-driven reflection triggers
export const REFLECTION_IMPORTANCE_THRESHOLD = 2.0;     // Cumulative importance to trigger reflection (3-4 interactions)
export const REFLECTION_MIN_INTERVAL_MS = 30 * 60 * 1000; // Min 30 min between reflections

// Price oracle
export const PRICE_SNAPSHOT_RETENTION_HOURS = 48;
export const WHALE_SELL_COOLDOWN_MS = 30 * 60 * 1000;
export const PUMP_DUMP_THRESHOLD_PERCENT = 10;
export const SIDEWAYS_THRESHOLD_PERCENT = 2;

// Base chain (dormant — kept for future switch-back)
export const BASE_CHAIN_ID = 8453;
export const BASESCAN_TX_BASE_URL = 'https://basescan.org/tx';
export const BASESCAN_API_BASE_URL = 'https://api.basescan.org/api';
export const DEXSCREENER_PRICE_URL = 'https://api.dexscreener.com/latest/dex/tokens';

// Allium API
export const ALLIUM_BASE_URL = 'https://api.allium.so/api/v1/developer';

// WETH on Base (dormant — kept for future switch-back)
export const BASE_WETH_ADDRESS = '0x4200000000000000000000000000000000000006';

// Minimal ERC-20 ABI for balance queries
export const ERC20_BALANCE_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

// Memo max length for on-chain calldata
export const MEMO_MAX_LENGTH = 566;

// Token lists for market monitoring
export const MAJOR_TOKENS = new Set([
  'ETH', 'BTC', 'USDC', 'AERO', 'cbBTC', 'VIRTUAL', 'MORPHO', 'RSR',
  'SOL', 'BONK', 'WIF', 'JTO', 'JUP', 'PYTH', 'RAY', 'RNDR', 'HNT',
]);

export const KNOWN_MEMECOINS = new Set([
  'BRETT', 'DEGEN', 'TOSHI', 'HIGHER', 'BASED', 'MOCHI', 'NORMIE',
  'KEYCAT', 'DOGINME', 'BENJI', 'SKI',
  'POPCAT', 'MEW', 'BOME', 'WEN', 'MYRO', 'SAMO', 'SLERF', 'PONKE',
  'BOOK', 'MOODENG', 'PNUT', 'GOAT', 'ACT', 'AI16Z', 'FARTCOIN', 'GRIFFAIN', 'PENGU', 'TRUMP',
]);

export function isNoteworthyToken(symbol: string): boolean {
  const upper = symbol.toUpperCase();
  return MAJOR_TOKENS.has(upper) || KNOWN_MEMECOINS.has(upper);
}
