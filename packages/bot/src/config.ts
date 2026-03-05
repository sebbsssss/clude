import dotenv from 'dotenv';
dotenv.config();

const siteOnly = process.env.SITE_ONLY === 'true';

function isSDK(): boolean {
  return !!(globalThis as any).__CLUDE_SDK_MODE;
}

function required(key: string): string {
  if (isSDK()) return process.env[key] || '';
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function requiredUnlessSiteOnly(key: string): string {
  if (isSDK() || siteOnly) return process.env[key] || '';
  return required(key);
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  x: {
    apiKey: requiredUnlessSiteOnly('X_API_KEY'),
    apiSecret: requiredUnlessSiteOnly('X_API_SECRET'),
    accessToken: requiredUnlessSiteOnly('X_ACCESS_TOKEN'),
    accessSecret: requiredUnlessSiteOnly('X_ACCESS_SECRET'),
    botUserId: requiredUnlessSiteOnly('X_BOT_USER_ID'),
    creatorUserId: optional('CREATOR_USER_ID', ''),
  },
  supabase: {
    url: requiredUnlessSiteOnly('SUPABASE_URL'),
    serviceKey: requiredUnlessSiteOnly('SUPABASE_SERVICE_KEY'),
  },
  anthropic: {
    apiKey: requiredUnlessSiteOnly('ANTHROPIC_API_KEY'),
    model: 'claude-opus-4-6' as const,
  },
  helius: {
    apiKey: optional('HELIUS_API_KEY', ''),
    webhookSecret: optional('HELIUS_WEBHOOK_SECRET', ''),
  },
  solana: {
    rpcUrl: optional('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com'),
    botWalletPrivateKey: optional('BOT_WALLET_PRIVATE_KEY', ''),
    cludeTokenMint: optional('CLUUDE_TOKEN_MINT', ''),
  },
  server: {
    port: parseInt(optional('PORT', '3000'), 10),
    baseUrl: optional('BASE_URL', 'http://localhost:3000'),
  },
  intervals: {
    mentionPollMs: parseInt(optional('MENTION_POLL_INTERVAL_MS', '30000'), 10),
    pricePollMs: parseInt(optional('PRICE_POLL_INTERVAL_MS', '60000'), 10),
    shiftReportCron: optional('SHIFT_REPORT_CRON', '0 */12 * * *'),
    moodTweetMs: parseInt(optional('MOOD_TWEET_INTERVAL_MS', '7200000'), 10),
  },
  allium: {
    apiKey: optional('ALLIUM_API_KEY', ''),
    pollIntervalMs: parseInt(optional('MARKET_MONITOR_POLL_MS', '300000'), 10),
  },
  tiers: {
    whaleThreshold: parseInt(optional('TIER_WHALE_THRESHOLD', '1000000'), 10),
    smallThreshold: parseInt(optional('TIER_SMALL_THRESHOLD', '1'), 10),
  },
  agent: {
    rateLimitPerMin: parseInt(optional('AGENT_RATE_LIMIT', '10'), 10),
  },
  owner: {
    wallet: optional('OWNER_WALLET', ''),
  },
  cortex: {
    apiKey: optional('CORTEX_API_KEY', ''),
    hostUrl: optional('CORTEX_HOST_URL', 'https://cluude.ai'),
  },
  features: {
    showTxLinksInTweets: optional('SHOW_TX_LINKS_IN_TWEETS', 'true') === 'true',
    siteOnly: optional('SITE_ONLY', 'false') === 'true',
    campaignEnabled: optional('CAMPAIGN_ENABLED', 'false') === 'true',
  },
  campaign: {
    startDate: optional('CAMPAIGN_START', ''),
  },
  embedding: {
    provider: optional('EMBEDDING_PROVIDER', '') as '' | 'voyage' | 'openai' | 'venice',
    apiKey: optional('EMBEDDING_API_KEY', ''),
    model: optional('EMBEDDING_MODEL', ''),
    dimensions: parseInt(optional('EMBEDDING_DIMENSIONS', '1024'), 10),
    // Optional: faster provider for query-time embeddings (recall)
    queryProvider: optional('EMBEDDING_QUERY_PROVIDER', '') as '' | 'voyage' | 'openai' | 'venice',
    queryApiKey: optional('EMBEDDING_QUERY_API_KEY', ''),
    queryModel: optional('EMBEDDING_QUERY_MODEL', ''),
  },
  venice: {
    apiKey: optional('VENICE_API_KEY', ''),
    model: optional('VENICE_MODEL', 'llama-3.3-70b'),
  },
  inference: {
    /** Primary provider: 'anthropic' | 'venice' | 'auto' (default: auto) */
    primary: optional('INFERENCE_PRIMARY', 'auto') as 'anthropic' | 'venice' | 'auto',
    /** Fallback provider if primary fails */
    fallback: optional('INFERENCE_FALLBACK', 'anthropic') as 'anthropic' | 'venice',
  },
  privy: {
    appId: optional('PRIVY_APP_ID', ''),
    appSecret: optional('PRIVY_APP_SECRET', ''),
    jwksUrl: optional('PRIVY_JWKS_URL', ''),
  },
  activity: {
    minSolValue: parseFloat(optional('ACTIVITY_MIN_SOL', '5.0')),
    minEthValue: parseFloat(optional('ACTIVITY_MIN_ETH', '0.1')), // legacy, kept for schema compat
    whaleThreshold: parseFloat(optional('ACTIVITY_WHALE_SOL', '50.0')),
    maxEvents: parseInt(optional('ACTIVITY_MAX_EVENTS', '20'), 10),
  },
} as const;
