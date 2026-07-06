/**
 * Ansem Experience — public, read-only endpoints for the "Speak to Ansem" page.
 * A persona clone of trader Ansem (@blknoiz06), AI-clone-labelled, no auth required.
 *
 * Two endpoints:
 *   GET  /api/ansem/graph   — memory graph (bull constellation) for 3D visualization
 *   POST /api/ansem/explore — SSE chat in Ansem's voice, scoped to his seeded memories
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
// (source='ansem-seed') + spoken transcripts (source='ansem-yt').
const ANSEM_WALLET = "HYmsqdcpHRvWcrBfACzYWvPbF2XMg5hKFy38kEt7Ppjt";
const ANSEM_SOURCES = ["ansem-seed", "ansem-yt"];

function getClientIp(req: Request): string {
  return (req.ip || req.socket.remoteAddress || "unknown").replace(/^::ffff:/, "");
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
Ground every take in the retrieved memories below — do NOT invent positions he doesn't hold. If the memories don't cover it, stay in-character but general.`;

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

      const { data: memories, error: memErr } = await db
        .from("memories")
        .select(
          "id, memory_type, summary, content, tags, importance, decay_factor, emotional_valence, source, source_id, created_at, metadata",
        )
        .eq("owner_wallet", ANSEM_WALLET)
        .in("source", ANSEM_SOURCES)
        .order("importance", { ascending: false })
        .limit(1800);

      if (memErr) {
        log.error({ err: memErr }, "Failed to fetch Ansem memories for graph");
        res.status(500).json({ error: "Failed to fetch memories" });
        return;
      }

      const ansemMemories = memories || [];
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
        total: ansemMemories.length,
      });
    } catch (err) {
      log.error({ err }, "Ansem graph endpoint error");
      res.status(500).json({ error: "Failed to fetch Ansem graph" });
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

      // ── Phase 2: Recall memories, scoped to Ansem's wallet ──
      // Wallet isolation handles source scoping; no post-filter needed.
      const allMemories = new Map<number, any>();

      await withOwnerWallet(ANSEM_WALLET, async () => {
        const recallPromises = queries.map((q) =>
          recallMemories({ query: q, limit: 15, skipExpansion: true }).catch(
            () => [],
          ),
        );
        const results = await Promise.all(recallPromises);
        for (const memories of results) {
          for (const m of memories) {
            if (!allMemories.has(m.id)) {
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
