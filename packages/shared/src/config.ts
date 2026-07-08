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
    /**
     * Bearer token for the public "$ANSEM LIVE" feed (GET /api/ansem/feed).
     * Reads-only X app bearer — used server-side for GET /2/tweets/search/recent.
     * Empty → the feed endpoint returns { enabled:false } and the frontend panel hides.
     * NEVER sent to the browser.
     */
    searchBearer: optional("X_SEARCH_BEARER", ""),
    /** Min poll gap for the on-demand $ANSEM feed (ms). Idle → no polling → $0. */
    ansemFeedIntervalMs: parseInt(optional("ANSEM_FEED_INTERVAL_MS", "90000"), 10),
    /** Posts older than ~15min must clear this like floor (fresh posts are exempt). */
    ansemFeedMinLikes: parseInt(optional("ANSEM_FEED_MIN_LIKES", "3"), 10),
    /** Hard daily read-cap: once exceeded, serve the stale buffer (cost stop-loss). */
    ansemFeedDailyReadCap: parseInt(optional("ANSEM_FEED_DAILY_READ_CAP", "40000"), 10),
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
    /** Deployed memory-registry Anchor program ID. Empty → on-chain registration disabled. */
    memoryRegistryProgramId: optional("CLUDE_PROGRAM_ID", ""),
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
    /**
     * C1 slice 1.5: the LLM router. Its own sub-flag (default OFF, independent of reconcileEnabled)
     * so gate-only instrumentation runs first and LO is calibrated from that data before any LLM
     * spend. When on, a >= LO write is classified add/update/noop by reconcileModel (still SHADOW —
     * the op is logged, never applied). Requires OpenRouter configured.
     */
    reconcileRouter: optional("MEMORY_RECONCILE_ROUTER", "false") === "true",
    /** Router model — an explicit id (NEVER a cognitiveFunction, which would silently override it
     * with the fast llama slot). Haiku-class default: capable enough for dup-vs-update, cheap. */
    reconcileModel: optional("MEMORY_RECONCILE_MODEL", "anthropic/claude-haiku-4.5"),
    /** Per-owner soft daily cap on router calls (approximate, per-process) — bounds LLM spend. */
    reconcileBudget: Number(optional("MEMORY_RECONCILE_BUDGET", "200")),
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
  migration: {
    /**
     * Database backend that getDb() targets during the GCP parallel-run.
     * 'supabase' (default, current live infra) | 'cloudsql' (PostgREST /
     * self-hosted Supabase in front of Cloud SQL). Flip per-layer for the
     * shadow-stack cutover; Supabase stays the source of truth until sunset.
     */
    dbTarget: optional("DB_TARGET", "supabase") as "supabase" | "cloudsql",
    /** PostgREST endpoint for the Cloud SQL backend (used only when DB_TARGET=cloudsql). */
    cloudsqlUrl: optional("CLOUDSQL_PGREST_URL", ""),
    /** Service key for the Cloud SQL PostgREST backend (used only when DB_TARGET=cloudsql). */
    cloudsqlServiceKey: optional("CLOUDSQL_SERVICE_KEY", ""),
    /**
     * Active embedding vector space for ingest + recall. 'voyage' (default,
     * current corpus) | 'vertex' (shadow column, only after the LongMemEval gate
     * passes). Separate from EMBEDDING_PROVIDER so the swap is A/B, not one-way.
     */
    embeddingActive: optional("EMBEDDING_ACTIVE", "voyage") as "voyage" | "vertex",
    /**
     * Whether THIS process runs the in-server singleton timers (recall canary,
     * marketplace delivery poller, title-mint reconciliation). Default true =
     * current Railway behavior. Set false on the Cloud Run server so exactly one
     * owner (the worker) runs them and autoscaling never duplicates them.
     */
    runInProcessTimers: optional("RUN_INPROCESS_TIMERS", "true") === "true",
  },
  vertex: {
    /**
     * Vertex AI embedding backend (the GCP replacement for Voyage), used only when
     * ingest/backfill/recall target the 'vertex' space (EMBEDDING_ACTIVE=vertex or an
     * explicit generateEmbeddingForSpace('vertex') call). Separate from config.embedding
     * so the Vertex space can be backfilled + A/B-gated while Voyage stays live.
     */
    project: optional("VERTEX_PROJECT", optional("GCP_PROJECT", "")),
    location: optional("VERTEX_LOCATION", "us-central1"),
    model: optional("VERTEX_EMBEDDING_MODEL", "gemini-embedding-001"),
    /** Output dims — MRL-truncated to 1024 so vector(1024) columns + HNSW + match_* RPCs are unchanged. */
    dimensions: parseInt(optional("VERTEX_EMBEDDING_DIMENSIONS", "1024"), 10),
    /**
     * Optional static OAuth token override (from `gcloud auth print-access-token`) for
     * local dev / smoke tests. Empty in prod: Cloud Run mints a token from the attached
     * service account via the metadata server (SDK-free), no static key stored.
     */
    accessToken: optional("VERTEX_ACCESS_TOKEN", ""),
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
  higgsfield: {
    /** Higgsfield API key ID — first half of the V2 `Authorization: Key <id>:<secret>` pair (server-only). Empty → /api/ansem/speak returns 501. */
    apiKey: optional("HIGGSFIELD_API_KEY", ""),
    /** Higgsfield API key SECRET — second half of the V2 `Key <id>:<secret>` pair. */
    apiSecret: optional("HIGGSFIELD_API_SECRET", ""),
    /** REST base URL (Higgsfield V2 API). */
    apiBase: optional("HIGGSFIELD_API_BASE", "https://platform.higgsfield.ai"),
    /**
     * V2 model path for the seed_audio TTS model: create is POST {apiBase}/{ttsEndpoint}.
     * Verified live against the Higgsfield V2 API — bytedance/seed-audio-1.0.
     */
    ttsEndpoint: optional("HIGGSFIELD_TTS_ENDPOINT", "bytedance/seed-audio-1.0"),
    /** Ansem voice — Higgsfield "Sterling" preset (founder's choice). */
    voiceId: optional("ANSEM_VOICE_ID", "dc382508-c8bd-443c-8cb2-46e57b8d2e6f"),
    voiceType: optional("ANSEM_VOICE_TYPE", "preset"),
    /** Deep-voice tuning: seed_audio pitch_rate / speech_rate (integers, default 0). */
    voicePitch: parseInt(optional("ANSEM_VOICE_PITCH", "-9"), 10),
    voiceSpeechRate: parseInt(optional("ANSEM_VOICE_SPEECH_RATE", "-12"), 10),
    /** Output audio format (seed_audio supports wav|mp3|pcm|ogg_opus). */
    audioFormat: optional("ANSEM_VOICE_FORMAT", "mp3"),
  },
  elevenlabs: {
    /** ElevenLabs API key (server-only). Set → PRIMARY TTS (~1-3s, no lag); empty → falls back to Higgsfield. */
    apiKey: optional("ELEVENLABS_API_KEY", ""),
    /** Voice id — default "Brian" (deep, resonant, american). Swap via ELEVENLABS_VOICE_ID. */
    voiceId: optional("ELEVENLABS_VOICE_ID", "nPczCjzI2devNBz1zQrb"),
    /** Model — turbo for lowest latency. */
    model: optional("ELEVENLABS_MODEL", "eleven_turbo_v2_5"),
  },
  privy: {
    appId: optional("PRIVY_APP_ID", ""),
    appSecret: optional("PRIVY_APP_SECRET", ""),
    jwksUrl: optional("PRIVY_JWKS_URL", ""),
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
} as const;
