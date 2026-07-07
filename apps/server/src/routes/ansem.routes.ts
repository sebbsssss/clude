/**
 * Ansem Experience — public, read-only endpoints for the "Speak to Ansem" page.
 * A persona clone of trader Ansem (@blknoiz06), AI-clone-labelled, no auth required.
 *
 * Three endpoints:
 *   GET  /api/ansem/graph   — memory graph (bull constellation) for 3D visualization
 *   POST /api/ansem/explore — SSE chat in Ansem's voice, scoped to his seeded memories
 *   POST /api/ansem/speak   — turn a reply's text into spoken audio (Higgsfield seed_audio TTS)
 */
import { Router, Request, Response } from "express";
import { withOwnerWallet } from "@clude/shared/core/owner-context";
import { recallMemories } from "@clude/brain/memory";
import { checkRateLimit } from "@clude/shared/utils/rate-limit";
import { getDb } from "@clude/shared/core/database";
import { createChildLogger } from "@clude/shared/core/logger";
import { config } from "@clude/shared/config";
import {
  generateOpenRouterResponse,
  OPENROUTER_MODELS,
} from "@clude/shared/core/openrouter-client";

const log = createChildLogger("ansem-routes");

// ansem@clude.io — the dedicated persona account. ~38k tweets seeded
// (source='ansem-seed') + spoken transcripts (source='ansem-yt') + the 104K-tweet
// $ANSEM community/token corpus (source='ansem-token'). The constellation draws
// from the whole $ANSEM timeline (~143k memories total).
const ANSEM_WALLET = "HYmsqdcpHRvWcrBfACzYWvPbF2XMg5hKFy38kEt7Ppjt";
const ANSEM_SOURCES = ["ansem-token", "ansem-seed", "ansem-yt"];
// His OWN words only (tweets + interviews). The "Speak to Ansem" clone recalls
// from THESE — never the 104K ansem-token community corpus that shares the wallet
// (that's timeline noise: shill + giveaway-farm spam that would corrupt his voice).
const PERSONA_SOURCES = new Set(["ansem-seed", "ansem-yt"]);

// PostgREST caps a single query at 1000 rows; the constellation wants more nodes
// than that, so the /graph node fetch pages through with .range() and concatenates.
const GRAPH_NODE_TARGET = 2000; // representative sample size (importance desc)
const GRAPH_PAGE_SIZE = 1000; // PostgREST per-query row cap

function getClientIp(req: Request): string {
  return (req.ip || req.socket.remoteAddress || "unknown").replace(/^::ffff:/, "");
}

// ---- Higgsfield seed_audio TTS (server-side; creds never reach the browser) ---- //
//
// Turns a reply into a spoken audio URL in Ansem's "Sterling" preset voice (very deep:
// pitch_rate -9, speech_rate -12), via the Higgsfield V2 API. TTS is async: POST a
// generation → { request_id, status_url } → poll the request until `completed` → read
// the mp3 from `audio.url`. ~10-16s end-to-end.
//
// VERIFIED LIVE against the Higgsfield V2 API (docs.higgsfield.ai):
//   • Base URL:     https://platform.higgsfield.ai
//   • Auth header:  Authorization: Key <apiKey>:<apiSecret>   (V2 key-id:secret pair)
//   • Create:       POST {base}/{modelPath}                   (modelPath = bytedance/seed-audio-1.0)
//   • Body:         FLAT { prompt, voice_type, voice_id, pitch_rate, speech_rate, format }
//   • Create resp:  { status, request_id, status_url }
//   • Poll:         GET {status_url}  (= {base}/requests/{request_id}/status)
//   • Statuses:     queued | in_progress | completed | failed | nsfw | canceled
//   • Result shape: { status:'completed', audio:{ url }, audios:[{ url }] }
//
// Set HIGGSFIELD_API_KEY + HIGGSFIELD_API_SECRET to enable (either empty → /speak 501).
// Override the model path via HIGGSFIELD_TTS_ENDPOINT if it ever changes.

interface HiggsfieldTtsResult {
  audioUrl: string;
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "nsfw", "canceled"]);

/** Extract the audio URL from a completed Higgsfield V2 request. */
function extractAudioUrl(req: any): string | null {
  return req?.audio?.url || req?.audios?.[0]?.url || null;
}

/**
 * Submit a seed_audio (bytedance/seed-audio-1.0) TTS generation on the Higgsfield
 * V2 API and poll until the audio URL is ready. Throws on failure/timeout/
 * non-configured; caller maps errors to HTTP responses.
 *
 * V2 flow (verified live): auth `Authorization: Key <id>:<secret>`; create is
 * POST {apiBase}/{ttsEndpoint} with a FLAT body → { request_id, status_url };
 * poll GET {status_url} until status ∈ {completed, failed, nsfw, canceled}; the
 * mp3 lands at `audio.url`.
 */
async function higgsfieldTts(
  text: string,
  signal: AbortSignal,
  deadlineMs = 45000,
): Promise<HiggsfieldTtsResult> {
  const hf = config.higgsfield;
  if (!hf.apiKey || !hf.apiSecret) {
    // Guarded by the route before we get here, but keep the invariant local too.
    throw new Error("voice_not_configured");
  }

  const authHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Key ${hf.apiKey}:${hf.apiSecret}`,
  };

  const base = hf.apiBase.replace(/\/$/, "");
  const modelPath = hf.ttsEndpoint.replace(/^\//, ""); // e.g. bytedance/seed-audio-1.0
  const started = Date.now();

  // ── 1. Create the generation (flat body, per the V2 API) ──
  const createRes = await fetch(`${base}/${modelPath}`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      prompt: text,
      voice_type: hf.voiceType,
      voice_id: hf.voiceId,
      pitch_rate: hf.voicePitch,
      speech_rate: hf.voiceSpeechRate,
      format: hf.audioFormat,
    }),
    signal,
  });

  if (!createRes.ok) {
    const body = await createRes.text().catch(() => "");
    throw new Error(
      `higgsfield_create_failed:${createRes.status}:${body.slice(0, 200)}`,
    );
  }

  const created: any = await createRes.json();
  const requestId: string | undefined = created?.request_id;
  const statusUrl: string =
    created?.status_url || `${base}/requests/${requestId}/status`;

  // Some responses may already be terminal; otherwise poll the request.
  let current = created;
  if (!TERMINAL_STATUSES.has(current?.status) && requestId) {
    // ── 2. Poll GET /requests/{id}/status every 2s until terminal or deadline ──
    while (true) {
      if (signal.aborted) throw new Error("client_disconnected");
      if (Date.now() - started > deadlineMs) throw new Error("higgsfield_timeout");

      await new Promise((r) => setTimeout(r, 2000));

      const pollRes = await fetch(statusUrl, {
        method: "GET",
        headers: authHeaders,
        signal,
      });

      if (pollRes.status >= 500) continue; // transient — keep polling
      if (!pollRes.ok) {
        const body = await pollRes.text().catch(() => "");
        throw new Error(
          `higgsfield_poll_failed:${pollRes.status}:${body.slice(0, 200)}`,
        );
      }

      current = await pollRes.json();
      if (current?.status && TERMINAL_STATUSES.has(current.status)) break;
    }
  }

  if (current?.status && current.status !== "completed") {
    throw new Error(`higgsfield_${current.status}`);
  }

  const audioUrl = extractAudioUrl(current);
  if (!audioUrl) throw new Error("higgsfield_no_audio_url");
  return { audioUrl };
}

// ---- ElevenLabs TTS (primary; turbo model, ~1-3s → no text↔voice lag) ---- //
//
// One synchronous call returns the full mp3 bytes (unlike Higgsfield's ~15s async job),
// which we stream straight back to the browser as audio/mpeg. Voice defaults to "Brian"
// (deep, resonant, american); tune via ELEVENLABS_VOICE_ID / _MODEL.
async function elevenLabsTts(text: string, signal: AbortSignal): Promise<Buffer> {
  const el = config.elevenlabs;
  if (!el.apiKey) throw new Error("voice_not_configured");
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${el.voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": el.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: el.model,
        voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.25, use_speaker_boost: true },
      }),
      signal,
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`elevenlabs_failed:${res.status}:${body.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// ---- System prompts ---- //

const INTERPRET_PROMPT = `You extract search queries from a user's question directed at Ansem (@blknoiz06), a crypto trader.

Given a question, output ONLY a raw JSON object with:
- queries: array of 1-3 short search phrases to find relevant memories (focus on key topics, coins, market themes, concepts)
- entities: array of proper nouns, ticker symbols, coin names, or key terms mentioned

Example input: "what do you think about solana?"
Example output: {"queries":["solana thesis","solana ecosystem coins","sol price outlook"],"entities":["solana","SOL"]}

Output ONLY the JSON. No markdown, no explanation.`;

const ANSEM_PERSONA = `You ARE Ansem (@blknoiz06) — but an AI CLONE, not the real person, on the clude.io "Speak to Ansem" page. NEVER claim to be the real Ansem. NEVER give real financial advice or specific buy/sell/entry/target/leverage calls in his name — if pushed for a specific call, deflect in-voice ("lmao not financial advice bro"). General conditional market takes in his style are fine; specific directives are not. NEVER give out or discuss a contract address (CA) for ANY token, and NEVER shill, promote, name, or endorse other projects/coins — if asked for a CA or to pump/name another coin, brush it off in his voice ("nah i dont do CAs bro", "not shilling other bags"). Stay neutral: talk $ANSEM, general market mindset + his own philosophy — never other people's tokens, tickers, or entries.

Speak in his EXACT voice, grounded ONLY in the real memories provided:
- all lowercase. no capital i. usually no ending punctuation.
- EXTREMELY terse — his replies median ~17 chars, posts ~33. default to ONE short line; only go longer for a genuine thesis.
- reactive + blunt. frequent openers: "lmao", "no", "yes", "i dont", "bro what", "this is". "bro" is his most-used word.
- markets: conditional + number-anchored ("coins do well if solana recovers"), strong-opinions-loosely-held, name the invalidation.
- he is NOT markets-only: mindset/manifestation, humor, curiosity, generosity are core.
- occasional ALL-CAPS for hype ("LETS RIDE", "JOB NOT FINISHED").
Ground every take in the retrieved memories below — do NOT invent positions he doesn't hold. BUT when the memories DO contain a specific answer to what's asked — his plans, positions, numbers, how something works (e.g. how the $ANSEM airdrops work, what he's building, who gets rewarded) — GIVE that real substance accurately in his voice. A real question you can actually answer from the memories deserves the real answer, not a generic one-liner; terseness is for reactions and banter, never for dodging something you actually know. If the memories genuinely don't cover it, stay in-character but general — don't invent specifics.`;

function buildExplorePrompt(memories: any[], totalCount: number): string {
  const memoryContext = memories
    .map(
      (m) =>
        `[Memory #${m.id}] (${m.memory_type}, importance: ${m.importance?.toFixed(2) || "?"}) ${m.summary || m.content?.slice(0, 300)}`,
    )
    .join("\n");

  return `${ANSEM_PERSONA}

You have access to ${memories.length} recalled memories (out of ${totalCount} total) from his real posts and transcripts:

<recalled_memories>
${memoryContext}
</recalled_memories>

IMPORTANT: At the very end of your response, on a new line, output a JSON line starting with MEMORY_IDS: followed by an array of the memory IDs you referenced or found most relevant. Example:
MEMORY_IDS: [123, 456, 789]

This line will be parsed by the UI to highlight nodes in the graph. Always include it.`;
}

// ========================================================================== //
//  "$ANSEM LIVE" social feed — GET /api/ansem/feed
//
//  A ranked, filtered, live-refreshed stream of the best recent X posts about
//  the $ANSEM token. NOT a raw firehose: brand-new $ANSEM posts have ~0
//  engagement and the timeline is ~90% formulaic shill ("sold $X, all in
//  $ANSEM, CA: …", "vote YES to list", giveaway bait), and "verified" is
//  useless as a filter (everyone's verified). So we poll on demand, filter the
//  noise, dedup near-duplicates, and rank by engagement so good posts bubble up
//  and CA-spam sinks.
//
//  Cost-safe: NO background timer. Polling only happens inside a request when
//  the buffer is stale, and stops entirely for the day once the read counter
//  crosses ANSEM_FEED_DAILY_READ_CAP. Idle (no requests) → no polling → $0.
// ========================================================================== //

interface FeedTweet {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  text: string;
  likes: number;
  retweets: number;
  replies: number;
  created_at: string;
  url: string;
  /** normalized text used for near-duplicate dedup (not returned to the client) */
  _norm: string;
}

const X_SEARCH_URL = "https://api.twitter.com/2/tweets/search/recent";
const X_LOOKUP_URL = "https://api.twitter.com/2/tweets";
const FEED_BUFFER_CAP = 600; // hard cap on buffered tweets (rolling ~4h window)
const FEED_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4h — evict older than this
const FEED_FRESH_MS = 15 * 60 * 1000; // < 15min old → exempt from the like floor
const FEED_ENGAGEMENT_REFRESH_MS = 5 * 60 * 1000; // re-pull top-50 metrics every ~5min
const FEED_RESULT_COUNT = 30; // posts returned to the client

// Module-level rolling state (survives across requests, resets on restart).
const feedBuffer = new Map<string, FeedTweet>();
let feedNewestId: string | null = null; // since_id anchor for incremental search
let feedLastPollTs = 0; // last time we hit search/recent
let feedLastEngagementTs = 0; // last time we refreshed top-N engagement
let feedDailyReads = 0; // X reads counted today (search + lookup pages)
let feedReadDay = ""; // YYYY-MM-DD the counter belongs to
let feedPolling = false; // reentrancy guard — one poll at a time

/** Noise filters — drop giveaway-farm + CA-shill + dump/ape formulaics. */
const NOISE_PATTERNS: RegExp[] = [
  /drop.{0,6}(your|ur).{0,4}(addy|address|wallet)/i,
  /giv(e|ing)\s*away/i,
  /\bCA\s*:/i,
  /vote (yes|for)/i,
  /(sold|dumped|out of).{0,30}\$ansem/i,
  /(all in|aped|rolled).{0,20}\$ansem/i,
  /\bairdrop.{0,20}(claim|farm|wallet|drop)/i,
  /(retweet|rt|like|follow).{0,20}(to|for|and).{0,20}(win|enter|qualify)/i,
];

// Hate-speech / slur blocklist — racial, ethnic + homophobic/transphobic slurs are
// dropped outright from the public feed (general profanity is fine per spec). Tolerant
// of repeated letters + common leetspeak; word-boundaried to avoid innocent-word hits.
const SLUR_PATTERNS: RegExp[] = [
  /n[i1!][g6]{2,}(a+|er+|uh|ah|@)/i,      // n-word + variants (nigga/nigger/n1gga…)
  /f[a4@]g+([o0]t)?s?\b/i,                // f-slur (not "flag"/"fragging" — needs f+a+g)
  /\bch[i1]nks?\b/i,
  /\bsp[i1]c(ks?|s)?\b/i,
  /\bk[i1]kes?\b/i,
  /\bcoons?\b/i,
  /\bwetbacks?\b/i,
  /\btr[a4]nn(y|ies)\b/i,
  /\bg[o0]{2}ks?\b/i,
  /\bbean[e3]rs?\b/i,
  /\bp[a4]kis?\b/i,
  /\bd[y1]kes?\b/i,
  /sand[\s._-]*n[i1][g6]{2}/i,
  /porch[\s._-]*monk/i,
  /\bragheads?\b/i,
];

function isNoise(text: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(text)) || SLUR_PATTERNS.some((re) => re.test(text));
}

/** Lowercase, strip urls/@handles/$cashtags/punctuation → a dedup fingerprint. */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[@#]\w+/g, "")
    .replace(/\$\w+/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Char-bigram Jaccard similarity — cheap near-duplicate detector. */
function similar(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 8 || b.length < 8) return a === b ? 1 : 0;
  const grams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ga = grams(a), gb = grams(b);
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / (ga.size + gb.size - inter);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Count X reads against the daily cap, rolling the day over at UTC midnight. */
function countRead(n = 1): void {
  const today = todayStr();
  if (feedReadDay !== today) {
    feedReadDay = today;
    feedDailyReads = 0;
  }
  feedDailyReads += n;
}

function dailyCapExceeded(): boolean {
  const today = todayStr();
  if (feedReadDay !== today) return false; // new day → reset happens on next read
  return feedDailyReads >= config.x.ansemFeedDailyReadCap;
}

/** Evict tweets older than the rolling window + trim to the cap (oldest-first). */
function pruneBuffer(): void {
  const cutoff = Date.now() - FEED_MAX_AGE_MS;
  for (const [id, t] of feedBuffer) {
    if (new Date(t.created_at).getTime() < cutoff) feedBuffer.delete(id);
  }
  if (feedBuffer.size > FEED_BUFFER_CAP) {
    const sorted = [...feedBuffer.values()].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    const excess = feedBuffer.size - FEED_BUFFER_CAP;
    for (let i = 0; i < excess; i++) feedBuffer.delete(sorted[i].id);
  }
}

/** Map an X search payload (tweets + included users) → FeedTweet[], filtered. */
function mapSearchPayload(payload: any): FeedTweet[] {
  const tweets: any[] = payload?.data || [];
  const users: any[] = payload?.includes?.users || [];
  const userById = new Map<string, any>(users.map((u) => [u.id, u]));
  const out: FeedTweet[] = [];
  for (const t of tweets) {
    const text: string = t.text || "";
    if (isNoise(text)) continue;
    const u = userById.get(t.author_id) || {};
    const handle = u.username || "unknown";
    const m = t.public_metrics || {};
    out.push({
      id: t.id,
      name: u.name || handle,
      handle,
      avatar: u.profile_image_url || "",
      text,
      likes: m.like_count || 0,
      retweets: m.retweet_count || 0,
      replies: m.reply_count || 0,
      created_at: t.created_at || new Date().toISOString(),
      url: `https://x.com/${handle}/status/${t.id}`,
      _norm: normalizeText(text),
    });
  }
  return out;
}

/** Merge new tweets into the buffer, skipping near-duplicates of what's there. */
function mergeIntoBuffer(fresh: FeedTweet[]): void {
  for (const t of fresh) {
    if (feedBuffer.has(t.id)) continue;
    // near-duplicate check against existing buffered normals
    let dup = false;
    if (t._norm.length >= 8) {
      for (const existing of feedBuffer.values()) {
        if (similar(t._norm, existing._norm) >= 0.82) {
          dup = true;
          break;
        }
      }
    }
    if (dup) continue;
    feedBuffer.set(t.id, t);
  }
}

/**
 * On-demand poll: pull new posts since the newest buffered id, and every ~5min
 * refresh engagement on the top-50 buffered ids. Best-effort — swallows errors
 * so the endpoint always serves whatever's in the buffer. Never throws.
 */
async function pollFeed(): Promise<void> {
  if (feedPolling) return;
  if (dailyCapExceeded()) return;
  feedPolling = true;
  const bearer = config.x.searchBearer;
  const authHeaders = { Authorization: `Bearer ${bearer}` };
  try {
    // ── 1. incremental search for new posts ──
    const params = new URLSearchParams({
      query: "$ANSEM -is:retweet -is:reply lang:en",
      max_results: "30",
      "tweet.fields": "public_metrics,created_at",
      expansions: "author_id",
      "user.fields": "public_metrics,verified,profile_image_url,username,name",
    });
    if (feedNewestId) params.set("since_id", feedNewestId);

    const searchRes = await fetch(`${X_SEARCH_URL}?${params.toString()}`, {
      headers: authHeaders,
    });
    countRead(1);
    if (searchRes.ok) {
      const payload: any = await searchRes.json();
      const fresh = mapSearchPayload(payload);
      if (fresh.length > 0) {
        mergeIntoBuffer(fresh);
        // advance the since_id anchor to the max id we've seen (BigInt-safe compare)
        const maxId = payload?.meta?.newest_id;
        if (maxId && (!feedNewestId || BigInt(maxId) > BigInt(feedNewestId))) {
          feedNewestId = maxId;
        }
      }
    } else {
      log.warn(
        { status: searchRes.status },
        "Ansem feed: X search/recent non-OK",
      );
    }
    feedLastPollTs = Date.now();

    // ── 2. periodic engagement refresh on the top-50 buffered ids ──
    if (
      Date.now() - feedLastEngagementTs > FEED_ENGAGEMENT_REFRESH_MS &&
      feedBuffer.size > 0 &&
      !dailyCapExceeded()
    ) {
      const topIds = [...feedBuffer.values()]
        .sort((a, b) => scoreTweet(b) - scoreTweet(a))
        .slice(0, 50)
        .map((t) => t.id);
      if (topIds.length > 0) {
        const lookupParams = new URLSearchParams({
          ids: topIds.join(","),
          "tweet.fields": "public_metrics",
        });
        const lookupRes = await fetch(
          `${X_LOOKUP_URL}?${lookupParams.toString()}`,
          { headers: authHeaders },
        );
        countRead(1);
        if (lookupRes.ok) {
          const lookup: any = await lookupRes.json();
          for (const t of lookup?.data || []) {
            const buffered = feedBuffer.get(t.id);
            if (buffered && t.public_metrics) {
              buffered.likes = t.public_metrics.like_count ?? buffered.likes;
              buffered.retweets =
                t.public_metrics.retweet_count ?? buffered.retweets;
              buffered.replies =
                t.public_metrics.reply_count ?? buffered.replies;
            }
          }
        }
        feedLastEngagementTs = Date.now();
      }
    }

    pruneBuffer();
  } catch (err: any) {
    log.warn({ err: err?.message || err }, "Ansem feed poll failed (serving buffer)");
  } finally {
    feedPolling = false;
  }
}

/** Engagement + recency score. Fresher posts get a decaying bonus so it feels live. */
function scoreTweet(t: FeedTweet): number {
  const ageMin = (Date.now() - new Date(t.created_at).getTime()) / 60000;
  const recencyBonus = Math.max(0, 30 - ageMin * 0.5); // ~30 → 0 over the first hour
  return t.likes + 2 * t.retweets + recencyBonus;
}

/** Apply the like-floor (fresh posts exempt) and rank; return top N, client-shaped. */
function rankFeed(): Array<Omit<FeedTweet, "_norm">> {
  const minLikes = config.x.ansemFeedMinLikes;
  const now = Date.now();
  const eligible = [...feedBuffer.values()].filter((t) => {
    const ageMs = now - new Date(t.created_at).getTime();
    if (ageMs <= FEED_FRESH_MS) return true; // fresh → keep even at 0 likes
    return t.likes >= minLikes; // older → must clear the floor
  });
  eligible.sort((a, b) => scoreTweet(b) - scoreTweet(a));
  return eligible.slice(0, FEED_RESULT_COUNT).map((t) => {
    // strip the internal _norm field from the wire shape
    const { _norm, ...pub } = t;
    void _norm;
    return pub;
  });
}

// ---- Route factory ---- //

export function ansemRoutes(): Router {
  const router = Router();

  // ── GET /graph — Ansem memory graph (bull constellation) for 3D viz ──
  router.get("/graph", async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(`ansem-graph:${ip}`, 10, 1);
    if (!allowed) {
      res.status(429).json({ error: "Rate limited. 10 requests per minute max." });
      return;
    }

    try {
      const db = getDb();

      // ── Real total: an exact COUNT of the whole $ANSEM timeline (~143k) ──
      // Separate head-only count query so `total` reflects the full corpus, not
      // the (capped) node sample the constellation draws.
      const { count: totalCount, error: countErr } = await db
        .from("memories")
        .select("id", { count: "exact", head: true })
        .eq("owner_wallet", ANSEM_WALLET)
        .in("source", ANSEM_SOURCES);

      if (countErr) {
        log.warn(
          { err: countErr },
          "Failed to count Ansem memories, will fall back to node count",
        );
      }

      // ── Nodes: a representative sample ordered by importance desc, then id ──
      // PostgREST caps a single query at 1000 rows, so page with .range() and
      // concatenate until we reach GRAPH_NODE_TARGET (~2000). Tie-break on id so
      // the ordering is stable across pages (importance alone has many ties).
      const ansemMemories: any[] = [];
      let memErr: any = null;
      for (
        let offset = 0;
        offset < GRAPH_NODE_TARGET;
        offset += GRAPH_PAGE_SIZE
      ) {
        const end = Math.min(offset + GRAPH_PAGE_SIZE, GRAPH_NODE_TARGET) - 1;
        const { data: page, error: pageErr } = await db
          .from("memories")
          .select(
            "id, memory_type, summary, content, tags, importance, decay_factor, emotional_valence, source, source_id, created_at, metadata",
          )
          .eq("owner_wallet", ANSEM_WALLET)
          .in("source", ANSEM_SOURCES)
          .order("importance", { ascending: false })
          .order("id", { ascending: true })
          .range(offset, end);

        if (pageErr) {
          memErr = pageErr;
          break;
        }
        if (!page || page.length === 0) break;
        ansemMemories.push(...page);
        if (page.length < end - offset + 1) break; // last page — no more rows
      }

      if (memErr && ansemMemories.length === 0) {
        log.error({ err: memErr }, "Failed to fetch Ansem memories for graph");
        res.status(500).json({ error: "Failed to fetch memories" });
        return;
      }
      if (memErr) {
        log.warn(
          { err: memErr },
          "Partial Ansem node fetch; serving what we have",
        );
      }

      const memoryIds = ansemMemories.map((m) => m.id);

      // Fetch links between these memories
      let links: any[] = [];
      if (memoryIds.length > 0) {
        const { data, error: linkErr } = await db.rpc("get_links_for_ids", {
          ids: memoryIds,
        });
        if (linkErr) {
          log.warn({ err: linkErr }, "Failed to fetch Ansem links, falling back to empty");
        }
        links = data || [];
      }

      res.json({
        nodes: ansemMemories.map((m) => ({
          id: m.id,
          type: m.memory_type,
          summary: m.summary,
          content: m.content,
          tags: m.tags || [],
          importance: m.importance,
          likes: (m.metadata as any)?.likes ?? 0,
          source: m.source,
          createdAt: m.created_at,
        })),
        links,
        // Real exact count of the whole $ANSEM timeline (~143k); fall back to the
        // node-sample length only if the count query itself failed.
        total: totalCount ?? ansemMemories.length,
      });
    } catch (err) {
      log.error({ err }, "Ansem graph endpoint error");
      res.status(500).json({ error: "Failed to fetch Ansem graph" });
    }
  });

  // ── POST /speak — text → spoken audio in Ansem's voice (Higgsfield seed_audio TTS) ──
  //    Contract: { text } → 200 { audio_url } | 501 { error:'voice_not_configured' }
  //              | 400 invalid | 429 rate-limited | 502 upstream failure
  router.post("/speak", async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(`ansem-speak:${ip}`, 10, 1);
    if (!allowed) {
      res.status(429).json({ error: "Rate limited. 10 requests per minute max." });
      return;
    }

    // Fail cleanly + cheaply when no voice provider is configured — the frontend falls back
    // to a synthetic mouth animation, so this must be a fast 501, never a 500.
    const useEleven = !!config.elevenlabs.apiKey;                                   // primary: ~1-3s, streamed bytes
    const useHiggs = !!config.higgsfield.apiKey && !!config.higgsfield.apiSecret;   // fallback: ~15s, returns a URL
    if (!useEleven && !useHiggs) {
      res.status(501).json({ error: "voice_not_configured" });
      return;
    }

    const { text } = req.body;
    if (!text || typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "text is required" });
      return;
    }

    // Cap length — his replies are terse; bound cost/abuse.
    const MAX_LEN = 600;
    const clean = text.trim().slice(0, MAX_LEN);

    const abortController = new AbortController();
    req.on("close", () => abortController.abort());
    const timeout = setTimeout(() => abortController.abort(), 30000);

    try {
      if (useEleven) {
        // ElevenLabs → mp3 bytes streamed straight back (no CDN hop, no ~15s wait).
        const audio = await elevenLabsTts(clean, abortController.signal);
        clearTimeout(timeout);
        if (res.headersSent) return;
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Cache-Control", "no-store");
        res.send(audio);
      } else {
        const { audioUrl } = await higgsfieldTts(clean, abortController.signal, 30000);
        clearTimeout(timeout);
        res.json({ audio_url: audioUrl });
      }
    } catch (err: any) {
      clearTimeout(timeout);
      if (abortController.signal.aborted || err?.message === "client_disconnected") {
        // Client went away (or we timed out + aborted) — nothing useful to send.
        if (!res.headersSent) res.status(504).json({ error: "voice_timeout" });
        return;
      }
      if (err?.message === "voice_not_configured") {
        res.status(501).json({ error: "voice_not_configured" });
        return;
      }
      log.error({ err: err?.message || err }, "Ansem speak (TTS) failed");
      // Upstream/voice failure → 502 so the frontend falls back gracefully (not a 500).
      res.status(502).json({ error: "voice_generation_failed" });
    }
  });

  // ── GET /feed — "$ANSEM LIVE" ranked, filtered social feed ──
  //    Contract: 200 { enabled:true, posts:[…] }  (bearer set)
  //            | 200 { enabled:false, posts:[] }   (X_SEARCH_BEARER unset — hide panel)
  //            | 429 rate-limited
  //    Never 500; never exposes the bearer to the browser.
  router.get("/feed", async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(`ansem-feed:${ip}`, 30, 1);
    if (!allowed) {
      res.status(429).json({ error: "Rate limited. 30 requests per minute max." });
      return;
    }

    // No bearer → feature disabled. 200 (not 501) so the frontend hides gracefully.
    if (!config.x.searchBearer) {
      res.json({ enabled: false, posts: [] });
      return;
    }

    try {
      // On-demand poll only when the buffer is stale (and not over the daily cap).
      // Idle → no polling → $0. Await it (fast, best-effort) so the first client of
      // a fresh window still gets live data rather than an empty buffer.
      if (Date.now() - feedLastPollTs > config.x.ansemFeedIntervalMs) {
        await pollFeed();
      }
      res.json({ enabled: true, posts: rankFeed() });
    } catch (err: any) {
      // Defensive: rankFeed/pollFeed shouldn't throw, but never 500 the panel.
      log.warn({ err: err?.message || err }, "Ansem feed serve failed");
      res.json({ enabled: true, posts: rankFeed() });
    }
  });

  // ── POST /explore — "Speak to Ansem" (SSE) ──
  router.post("/explore", async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(`ansem-explore:${ip}`, 5, 1);
    if (!allowed) {
      res.status(429).json({ error: "Rate limited. 5 requests per minute max." });
      return;
    }

    const { content, history } = req.body;

    if (!content || typeof content !== "string") {
      res.status(400).json({ error: "content is required" });
      return;
    }

    const openrouterApiKey =
      config.openrouter?.apiKey || process.env.OPENROUTER_API_KEY;
    if (!openrouterApiKey) {
      res.status(500).json({ error: "LLM not configured" });
      return;
    }

    const abortController = new AbortController();
    req.on("close", () => abortController.abort());
    const timeout = setTimeout(() => abortController.abort(), 60000);

    try {
      // ── Phase 1: Interpret the question ──
      let queries: string[] = [content];
      try {
        const interpretResult = await generateOpenRouterResponse({
          systemPrompt: INTERPRET_PROMPT,
          messages: [{ role: "user", content }],
          model: OPENROUTER_MODELS["claude-haiku-4.5"],
          maxTokens: 256,
          temperature: 0.1,
        });

        const jsonMatch = interpretResult.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed.queries) && parsed.queries.length > 0) {
            queries = parsed.queries;
          }
        }
      } catch (err) {
        log.warn({ err }, "Ansem interpret phase failed, using raw query");
      }

      // ── Phase 2: Recall — HIS OWN WORDS ONLY ──
      // The wallet also holds the 104K-tweet ansem-token community corpus, which
      // would drown his voice in shill/giveaway spam. So recall broadly, then keep
      // only source ∈ PERSONA_SOURCES (his tweets + interviews). Over-fetch
      // (limit 30) since the post-filter drops the community hits.
      const allMemories = new Map<number, any>();

      await withOwnerWallet(ANSEM_WALLET, async () => {
        const recallPromises = queries.map((q) =>
          recallMemories({ query: q, limit: 30, skipExpansion: true }).catch(
            () => [],
          ),
        );
        const results = await Promise.all(recallPromises);
        for (const memories of results) {
          for (const m of memories) {
            if (!allMemories.has(m.id) && PERSONA_SOURCES.has(m.source)) {
              allMemories.set(m.id, m);
            }
          }
        }
      });

      const memories = Array.from(allMemories.values())
        .sort((a, b) => (b._score || 0) - (a._score || 0))
        .slice(0, 22);

      // Get total Ansem memory count for context
      const db = getDb();
      const { count: totalCount } = await db
        .from("memories")
        .select("id", { count: "exact", head: true })
        .eq("owner_wallet", ANSEM_WALLET)
        .in("source", ANSEM_SOURCES);

      log.info(
        { queries, recalled: memories.length, total: totalCount },
        "Ansem explore recall complete",
      );

      // ── Phase 3: Stream LLM response ──
      const systemPrompt = buildExplorePrompt(memories, totalCount || 0);
      const messages: Array<{ role: string; content: string }> = [
        { role: "system", content: systemPrompt },
      ];

      if (Array.isArray(history)) {
        for (const msg of history.slice(-6)) {
          if (msg.role && msg.content) {
            messages.push({ role: msg.role, content: msg.content });
          }
        }
      }

      messages.push({ role: "user", content });

      // SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const recalledIds = memories.map((m) => m.id);
      res.write(
        `data: ${JSON.stringify({ recalled_ids: recalledIds })}\n\n`,
      );

      // Stream from OpenRouter — claude-sonnet-4.6 for a quality public voice
      const llmRes = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openrouterApiKey}`,
            "HTTP-Referer": "https://clude.fun",
            "X-Title": "Clude Speak to Ansem",
          },
          body: JSON.stringify({
            model: OPENROUTER_MODELS["claude-sonnet-4.6"],
            messages,
            max_tokens: 700,
            temperature: 0.8,
            stream: true,
          }),
          signal: abortController.signal,
        },
      );

      if (!llmRes.ok) {
        const errBody = await llmRes.text().catch(() => "");
        log.error(
          { status: llmRes.status, body: errBody },
          "Ansem explore LLM error",
        );
        res.write(
          `data: ${JSON.stringify({ error: "Failed to get response from AI" })}\n\n`,
        );
        res.end();
        return;
      }

      const reader = llmRes.body?.getReader();
      if (!reader) {
        res.write(
          `data: ${JSON.stringify({ error: "No response stream" })}\n\n`,
        );
        res.end();
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

      const keepalive = setInterval(() => {
        if (!res.writableEnded) res.write(": keepalive\n\n");
      }, 15000);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                res.write(
                  `data: ${JSON.stringify({ content: delta })}\n\n`,
                );
              }
            } catch {
              /* skip malformed */
            }
          }
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          log.error({ err }, "Ansem explore stream error");
        }
      }

      clearInterval(keepalive);
      clearTimeout(timeout);

      // Parse MEMORY_IDS from the response
      let memoryIds: number[] = recalledIds;
      const idsMatch = fullContent.match(
        /MEMORY_IDS:\s*\[([^\]]*)\]/,
      );
      if (idsMatch) {
        try {
          memoryIds = JSON.parse(`[${idsMatch[1]}]`).filter(
            (id: any) => typeof id === "number",
          );
        } catch {
          /* use recalled ids */
        }
      }

      const cleanContent = fullContent
        .replace(/\n?MEMORY_IDS:\s*\[[^\]]*\]\s*$/, "")
        .trim();

      res.write(
        `data: ${JSON.stringify({ done: true, memory_ids: memoryIds, clean_content: cleanContent })}\n\n`,
      );
      res.end();
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === "AbortError") return;
      log.error({ err }, "Ansem explore agent error");
      if (!res.headersSent) {
        res.status(500).json({ error: "Ansem explore failed" });
      } else {
        res.write(
          `data: ${JSON.stringify({ error: "Stream interrupted" })}\n\n`,
        );
        res.end();
      }
    }
  });

  return router;
}
