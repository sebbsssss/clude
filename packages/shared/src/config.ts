import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });
dotenv.config(); // also check cwd for standalone usage

const siteOnly = process.env.SITE_ONLY === "true";
const mcpMode =
  process.env.CLUDE_MCP === "true" || process.argv.includes("mcp-serve");

function isSDK(): boolean {
  return !!(globalThis as any).__CLUDE_SDK_MODE;
}

/** Returns true when running in a lightweight mode (SDK, MCP, site-only) */
function isLightweight(): boolean {
  return isSDK() || siteOnly || mcpMode;
}

function required(key: string): string {
  if (isLightweight()) return process.env[key] || "";
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function requiredUnlessSiteOnly(key: string): string {
  if (isLightweight()) return process.env[key] || "";
  return required(key);
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  x: {
    apiKey: requiredUnlessSiteOnly("X_API_KEY"),
    apiSecret: requiredUnlessSiteOnly("X_API_SECRET"),
    accessToken: requiredUnlessSiteOnly("X_ACCESS_TOKEN"),
    accessSecret: requiredUnlessSiteOnly("X_ACCESS_SECRET"),
    botUserId: requiredUnlessSiteOnly("X_BOT_USER_ID"),
    creatorUserId: optional("CREATOR_USER_ID", ""),
  },
  supabase: {
    url: requiredUnlessSiteOnly("SUPABASE_URL"),
    serviceKey: requiredUnlessSiteOnly("SUPABASE_SERVICE_KEY"),
  },
  anthropic: {
    apiKey: requiredUnlessSiteOnly("ANTHROPIC_API_KEY"),
    model: "claude-opus-4-6" as const,
  },
  solana: {
    /** 'mainnet-beta' | 'devnet' — controls RPC default, USDC mint, and Privy cluster */
    network: optional("SOLANA_NETWORK", "mainnet-beta") as
      | "mainnet-beta"
      | "devnet",
    rpcUrl: optional(
      "SOLANA_RPC_URL",
      optional("SOLANA_NETWORK", "mainnet-beta") === "devnet"
        ? "https://api.devnet.solana.com"
        : "https://api.mainnet-beta.solana.com",
    ),
    botWalletPrivateKey: optional("BOT_WALLET_PRIVATE_KEY", ""),
    cludeTokenMint: optional("CLUUDE_TOKEN_MINT", ""),
  },
  server: {
    port: parseInt(optional("PORT", "3000"), 10),
    baseUrl: optional("BASE_URL", "http://localhost:3000"),
  },
  intervals: {
    mentionPollMs: parseInt(optional("MENTION_POLL_INTERVAL_MS", "30000"), 10),
    pricePollMs: parseInt(optional("PRICE_POLL_INTERVAL_MS", "60000"), 10),
    moodTweetMs: parseInt(optional("MOOD_TWEET_INTERVAL_MS", "7200000"), 10),
    sentimentMonitorMs: parseInt(
      optional("SENTIMENT_MONITOR_INTERVAL_MS", "14400000"),
      10,
    ),
  },

  agent: {
    rateLimitPerMin: parseInt(optional("AGENT_RATE_LIMIT", "10"), 10),
  },
  owner: {
    wallet: optional("OWNER_WALLET", ""),
  },
  cortex: {
    apiKey: optional("CORTEX_API_KEY", ""),
    hostUrl: optional("CORTEX_HOST_URL", "https://clude.io"),
  },
  telegram: {
    botToken: optional("TELEGRAM_BOT_TOKEN", ""),
    channelId: optional("TELEGRAM_CHANNEL_ID", ""),
  },
  features: {
    showTxLinksInTweets: optional("SHOW_TX_LINKS_IN_TWEETS", "true") === "true",
    siteOnly: optional("SITE_ONLY", "false") === "true",
    campaignEnabled: optional("CAMPAIGN_ENABLED", "false") === "true",
    telegramEnabled: optional("TELEGRAM_ENABLED", "false") === "true",
    freePromoEnabled: optional("FREE_PROMO_ENABLED", "false") === "true",
    freePromoCreditUsdc: parseFloat(optional("FREE_PROMO_CREDIT_USDC", "1")),
    freePromoExpiry: optional("FREE_PROMO_EXPIRY", ""),
  },
  campaign: {
    startDate: optional("CAMPAIGN_START", ""),
  },
  embedding: {
    provider: optional("EMBEDDING_PROVIDER", "") as "" | "voyage" | "openai",
    apiKey: optional("EMBEDDING_API_KEY", ""),
    model: optional("EMBEDDING_MODEL", ""),
    dimensions: parseInt(optional("EMBEDDING_DIMENSIONS", "1024"), 10),
    // Optional: faster provider for query-time embeddings (recall)
    queryProvider: optional("EMBEDDING_QUERY_PROVIDER", "") as
      | ""
      | "voyage"
      | "openai",
    queryApiKey: optional("EMBEDDING_QUERY_API_KEY", ""),
    queryModel: optional("EMBEDDING_QUERY_MODEL", ""),
  },
  openrouter: {
    apiKey: optional("OPENROUTER_API_KEY", ""),
    model: optional("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct"),
  },
  inference: {
    /** Primary provider: 'anthropic' | 'openrouter' | 'auto' (default: auto) */
    primary: optional("INFERENCE_PRIMARY", "auto") as
      | "anthropic"
      | "openrouter"
      | "auto",
    /** Fallback provider if primary fails */
    fallback: optional("INFERENCE_FALLBACK", "anthropic") as
      | "anthropic"
      | "openrouter",
  },
  tavily: {
    apiKey: optional("TAVILY_API_KEY", ""),
  },
  privy: {
    appId: optional("PRIVY_APP_ID", ""),
    appSecret: optional("PRIVY_APP_SECRET", ""),
    jwksUrl: optional("PRIVY_JWKS_URL", ""),
  },
  oauth: {
    /** HMAC secret for signing OAuth access-token JWTs. Empty disables the OAuth AS — bearer API-key auth still works. */
    signingSecret: optional("OAUTH_SIGNING_SECRET", ""),
    /** Issuer/audience identifier baked into tokens. Falls back to the request origin when empty. */
    issuer: optional("OAUTH_ISSUER", ""),
    /** Access-token lifetime in seconds (default 1h). */
    accessTtlSec: parseInt(optional("OAUTH_ACCESS_TTL_SEC", "3600"), 10),
    /** Refresh-token lifetime in seconds (default 30d). */
    refreshTtlSec: parseInt(optional("OAUTH_REFRESH_TTL_SEC", "2592000"), 10),
    /** Authorization-code lifetime in seconds (default 60s). */
    codeTtlSec: parseInt(optional("OAUTH_CODE_TTL_SEC", "60"), 10),
  },
  executor: {
    pollMs: parseInt(optional("EXECUTOR_POLL_MS", "15000"), 10),
    maxConcurrent: parseInt(optional("EXECUTOR_MAX_CONCURRENT", "2"), 10),
    timeoutMs: parseInt(optional("EXECUTOR_TIMEOUT_MS", "300000"), 10),
  },
  chat: {
    /** LLM timeout in seconds for authenticated users (default 120s) */
    llmTimeoutSec: parseInt(optional("CHAT_LLM_TIMEOUT_SEC", "120"), 10),
    /** Max token budget for the entire context window sent to the LLM */
    maxContextTokens: parseInt(
      optional("CHAT_MAX_CONTEXT_TOKENS", "80000"),
      10,
    ),
  },
  helius: {
    webhookSecret: optional("HELIUS_WEBHOOK_SECRET", ""),
  },
  stripe: {
    /**
     * Stripe secret API key (sk_live_… / sk_test_…). Empty disables the
     * marketplace Stripe rail — the orchestrator/webhook fail closed without it.
     * SDK/MCP consumers never need this, so it stays optional() (not required()).
     */
    secretKey: optional("STRIPE_SECRET_KEY", ""),
    /**
     * Stripe webhook signing secret (whsec_…) used by stripe.webhooks.constructEvent
     * to verify the raw body BEFORE any DB write (Risk R6). Empty ⇒ every webhook is
     * rejected, so a misconfigured deploy can never process an unverified event.
     */
    webhookSecret: optional("STRIPE_WEBHOOK_SECRET", ""),
  },
  usdc: {
    /** Treasury wallet that receives USDC top-up payments */
    treasuryAddress: optional(
      "USDC_TREASURY_ADDRESS",
      "81MVTcY8iKQA3DMurbm8C3k8kCGySrsE575vyVVXiqFu",
    ),
    /** USDC mint — auto-selected by SOLANA_NETWORK */
    mint:
      optional("SOLANA_NETWORK", "mainnet-beta") === "devnet"
        ? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" // devnet USDC (Circle faucet)
        : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // mainnet USDC
  },
  memory: {
    /**
     * Memory 3.0 C2: route storeMemory enrichment (embed/link/extract) through the durable
     * memory_write_jobs outbox instead of fire-and-forget. Default OFF — fire-and-forget stays
     * the default until the worker is proven. Requires migrations 044 + 045; degrades gracefully
     * (falls back to fire-and-forget) if unapplied.
     */
    outboxEnabled: optional("MEMORY_OUTBOX", "false") === "true",
    /**
     * Memory 3.0 C1: write-time reconciliation, SHADOW slice (LLM-free). When on, each write records
     * a PROPOSED reconcile op (add / needs_router / skip) into memory_reconciliation_log WITHOUT
     * applying it — the labeled sample the enforce path must earn its turn-on from. Default OFF;
     * runs fully detached after embedMemory (zero write latency); degrades gracefully if migration
     * 046 is unapplied. Disabled under BENCH_MODE. The router is a later slice; only the cosine gate
     * runs here.
     */
    reconcileEnabled: optional("MEMORY_RECONCILE", "false") === "true",
    /** Screen floor passed to match_memories_temporal — LOW so max_cosine is captured for below-LO
     * writes (LO is tuned from the shadow data, not fixed up-front). */
    reconcileFloor: Number(optional("MEMORY_RECONCILE_FLOOR", "0.5")),
    /** "similar enough to reconcile" boundary → needs_router (vs add). A starting probe, not gospel. */
    reconcileLo: Number(optional("MEMORY_RECONCILE_LO", "0.85")),
    /** hi/mid band LABEL boundary for analysis (not a decision boundary). */
    reconcileHi: Number(optional("MEMORY_RECONCILE_HI", "0.95")),
  },
} as const;
