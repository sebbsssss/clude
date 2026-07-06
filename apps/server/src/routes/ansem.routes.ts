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

// ---- Higgsfield seed_audio TTS (server-side; key never reaches the browser) ---- //
//
// Turns a reply into a spoken audio URL in Ansem's "Sterling" preset voice (very deep:
// pitch_rate -9, speech_rate -12). Higgsfield's TTS is async: POST a generation → the
// response is a job-set → poll the job-set until a job reaches `completed` → read the
// audio URL from `results.raw.url`.
//
// CONFIRMED (from the official Higgsfield JS SDK — github.com/higgsfield-ai/higgsfield-js
// src/{client,config,models/JobSet,types}.ts — and the CLI schema
// github.com/higgsfield-ai/cli MODELS.md → `seed_audio`):
//   • Base URL:        https://platform.higgsfield.ai   (Config.baseURL default)
//   • Auth headers:    hf-api-key / hf-secret            (NOT Bearer — see client.ts)
//   • Request body:    { params: {...} }                 (client.generate wraps in `params`)
//   • Poll endpoint:   GET /v1/job-sets/{jobSetId}       (JobSet.pollingUrl)
//   • Job statuses:    queued | in_progress | completed | failed | nsfw | canceled
//   • Result shape:    jobs[].results.raw.url            (Results = { raw:{url,type}, min:{url,type} })
//   • seed_audio params: prompt (text), voice_type ('preset'), voice_id, pitch_rate (int,
//                        default 0), speech_rate (int, default 0), format (wav|mp3|pcm|ogg_opus)
//
// ASSUMED — the ONE item the founder must confirm (public docs only document image/video
// create paths; seed_audio's exact create path is not published):
//   • The create-generation endpoint PATH for seed_audio. Default guess below is
//     `/v1/text2speech/higgsfield` (mirrors the SDK's `/v1/speak/higgsfield` naming).
//     Confirm via `higgsfield model get seed_audio` (or the network tab of the Higgsfield
//     app) and set HIGGSFIELD_TTS_ENDPOINT. If the account uses a single Bearer key instead
//     of a key+secret pair, set HIGGSFIELD_API_SECRET="" and the Bearer header still goes out
//     via hf-api-key — adjust here if their auth differs.

interface HiggsfieldTtsResult {
  audioUrl: string;
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "nsfw", "canceled"]);

/** Extract the audio URL from a completed Higgsfield job-set, tolerant of shape variants. */
function extractAudioUrl(jobSet: any): string | null {
  const jobs: any[] = jobSet?.jobs || [];
  const done = jobs.find((j) => j?.status === "completed") || jobs[0];
  const r = done?.results;
  // Confirmed shape: results.raw.url. Fallbacks cover the MCP's `rawUrl` alias + min.
  return r?.raw?.url || r?.rawUrl || r?.min?.url || r?.url || null;
}

/**
 * Submit a seed_audio TTS generation and poll until the audio URL is ready.
 * Throws on failure/timeout/non-configured; caller maps errors to HTTP responses.
 */
async function higgsfieldTts(
  text: string,
  signal: AbortSignal,
  deadlineMs = 30000,
): Promise<HiggsfieldTtsResult> {
  const hf = config.higgsfield;
  if (!hf.apiKey) {
    // Guarded by the route before we get here, but keep the invariant local too.
    throw new Error("voice_not_configured");
  }

  const authHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "hf-api-key": hf.apiKey,
  };
  // Only send the secret header when a secret is configured (some accounts are key-only).
  if (hf.apiSecret) authHeaders["hf-secret"] = hf.apiSecret;

  const base = hf.apiBase.replace(/\/$/, "");
  const started = Date.now();

  // ── 1. Create the generation (body wrapped in `params`, per the SDK) ──
  const createRes = await fetch(`${base}${hf.ttsEndpoint}`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      params: {
        prompt: text,
        voice_type: hf.voiceType,
        voice_id: hf.voiceId,
        pitch_rate: hf.voicePitch,
        speech_rate: hf.voiceSpeechRate,
        format: hf.audioFormat,
      },
    }),
    signal,
  });

  if (!createRes.ok) {
    const body = await createRes.text().catch(() => "");
    throw new Error(
      `higgsfield_create_failed:${createRes.status}:${body.slice(0, 200)}`,
    );
  }

  const jobSet: any = await createRes.json();
  const jobSetId: string | undefined = jobSet?.id;

  // Some responses may already be terminal; otherwise poll by id.
  let current = jobSet;
  if (!TERMINAL_STATUSES.has(current?.jobs?.[0]?.status) && jobSetId) {
    // ── 2. Poll GET /v1/job-sets/{id} every 2s until terminal or deadline ──
    while (true) {
      if (signal.aborted) throw new Error("client_disconnected");
      if (Date.now() - started > deadlineMs) throw new Error("higgsfield_timeout");

      await new Promise((r) => setTimeout(r, 2000));

      const pollRes = await fetch(`${base}/v1/job-sets/${jobSetId}`, {
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
      const status = current?.jobs?.[0]?.status;
      if (status && TERMINAL_STATUSES.has(status)) break;
    }
  }

  const status = current?.jobs?.[0]?.status;
  if (status && status !== "completed") {
    throw new Error(`higgsfield_${status}`);
  }

  const audioUrl = extractAudioUrl(current);
  if (!audioUrl) throw new Error("higgsfield_no_audio_url");
  return { audioUrl };
}

// ---- System prompts ---- //

const INTERPRET_PROMPT = `You extract search queries from a user's question directed at Ansem (@blknoiz06), a crypto trader.

Given a question, output ONLY a raw JSON object with:
- queries: array of 1-3 short search phrases to find relevant memories (focus on key topics, coins, market themes, concepts)
- entities: array of proper nouns, ticker symbols, coin names, or key terms mentioned

Example input: "what do you think about solana?"
Example output: {"queries":["solana thesis","solana ecosystem coins","sol price outlook"],"entities":["solana","SOL"]}

Output ONLY the JSON. No markdown, no explanation.`;

const ANSEM_PERSONA = `You ARE Ansem (@blknoiz06) — but an AI CLONE, not the real person, on the clude.io "Speak to Ansem" page. NEVER claim to be the real Ansem. NEVER give real financial advice or specific buy/sell/entry/target/leverage calls in his name — if pushed for a specific call, deflect in-voice ("lmao not financial advice bro"). General conditional market takes in his style are fine; specific directives are not.

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

    // Fail cleanly + cheaply when the voice key isn't set — the frontend falls back to a
    // synthetic mouth animation, so this must be a fast 501, never a 500.
    if (!config.higgsfield.apiKey) {
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
      const { audioUrl } = await higgsfieldTts(clean, abortController.signal, 30000);
      clearTimeout(timeout);
      res.json({ audio_url: audioUrl });
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
