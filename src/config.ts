import dotenv from 'dotenv';
dotenv.config();

const siteOnly = process.env.SITE_ONLY === 'true';
const mcpMode = process.env.CLUDE_MCP === 'true' || process.argv.includes('mcp-serve');

function isSDK(): boolean {
  return !!(globalThis as any).__CLUDE_SDK_MODE;
}

/** Returns true when running in a lightweight mode (SDK, MCP, site-only) */
function isLightweight(): boolean {
  return isSDK() || siteOnly || mcpMode;
}

function required(key: string): string {
  if (isLightweight()) return process.env[key] || '';
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function requiredUnlessSiteOnly(key: string): string {
  if (isLightweight()) return process.env[key] || '';
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
    moodTweetMs: parseInt(optional('MOOD_TWEET_INTERVAL_MS', '7200000'), 10),
    sentimentMonitorMs: parseInt(optional('SENTIMENT_MONITOR_INTERVAL_MS', '14400000'), 10),
  },
  allium: {
    apiKey: optional('ALLIUM_API_KEY', ''),
    pollIntervalMs: parseInt(optional('MARKET_MONITOR_POLL_MS', '300000'), 10),
  },
  agent: {
    rateLimitPerMin: parseInt(optional('AGENT_RATE_LIMIT', '10'), 10),
  },
  owner: {
    wallet: optional('OWNER_WALLET', ''),
  },
  cortex: {
    apiKey: optional('CORTEX_API_KEY', ''),
    hostUrl: optional('CORTEX_HOST_URL', 'https://clude.io'),
  },
  telegram: {
    botToken: optional('TELEGRAM_BOT_TOKEN', ''),
    channelId: optional('TELEGRAM_CHANNEL_ID', ''),
  },
  features: {
    showTxLinksInTweets: optional('SHOW_TX_LINKS_IN_TWEETS', 'true') === 'true',
    siteOnly: optional('SITE_ONLY', 'false') === 'true',
    campaignEnabled: optional('CAMPAIGN_ENABLED', 'false') === 'true',
    telegramEnabled: optional('TELEGRAM_ENABLED', 'false') === 'true',
    freePromoEnabled: optional('FREE_PROMO_ENABLED', 'false') === 'true',
    freePromoCreditUsdc: parseFloat(optional('FREE_PROMO_CREDIT_USDC', '5')),
  },
  campaign: {
    startDate: optional('CAMPAIGN_START', ''),
  },
  embedding: {
    provider: optional('EMBEDDING_PROVIDER', '') as '' | 'voyage' | 'openai',
    apiKey: optional('EMBEDDING_API_KEY', ''),
    model: optional('EMBEDDING_MODEL', ''),
    dimensions: parseInt(optional('EMBEDDING_DIMENSIONS', '1024'), 10),
    // Optional: faster provider for query-time embeddings (recall)
    queryProvider: optional('EMBEDDING_QUERY_PROVIDER', '') as '' | 'voyage' | 'openai',
    queryApiKey: optional('EMBEDDING_QUERY_API_KEY', ''),
    queryModel: optional('EMBEDDING_QUERY_MODEL', ''),
  },
  openrouter: {
    apiKey: optional('OPENROUTER_API_KEY', ''),
    model: optional('OPENROUTER_MODEL', 'meta-llama/llama-3.3-70b-instruct'),
  },
  inference: {
    /** Primary provider: 'anthropic' | 'openrouter' | 'auto' (default: auto) */
    primary: optional('INFERENCE_PRIMARY', 'auto') as 'anthropic' | 'openrouter' | 'auto',
    /** Fallback provider if primary fails */
    fallback: optional('INFERENCE_FALLBACK', 'anthropic') as 'anthropic' | 'openrouter',
  },
  tavily: {
    apiKey: optional('TAVILY_API_KEY', ''),
  },
  privy: {
    appId: optional('PRIVY_APP_ID', ''),
    appSecret: optional('PRIVY_APP_SECRET', ''),
    jwksUrl: optional('PRIVY_JWKS_URL', ''),
  },
  executor: {
    pollMs: parseInt(optional('EXECUTOR_POLL_MS', '15000'), 10),
    maxConcurrent: parseInt(optional('EXECUTOR_MAX_CONCURRENT', '2'), 10),
    timeoutMs: parseInt(optional('EXECUTOR_TIMEOUT_MS', '300000'), 10),
  },
  chat: {
    /** LLM timeout in seconds for authenticated users (default 120s) */
    llmTimeoutSec: parseInt(optional('CHAT_LLM_TIMEOUT_SEC', '120'), 10),
    /** Max token budget for the entire context window sent to the LLM */
    maxContextTokens: parseInt(optional('CHAT_MAX_CONTEXT_TOKENS', '80000'), 10),
  },
  helius: {
    webhookSecret: optional('HELIUS_WEBHOOK_SECRET', ''),
  },
  usdc: {
    /** Treasury wallet that receives USDC top-up payments */
    treasuryAddress: optional('USDC_TREASURY_ADDRESS', '81MVTcY8iKQA3DMurbm8C3k8kCGySrsE575vyVVXiqFu'),
    /** Native Circle USDC mint on Solana */
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  },
} as const;
