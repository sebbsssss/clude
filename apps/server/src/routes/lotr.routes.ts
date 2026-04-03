/**
 * LOTR Guest Brain — public, read-only endpoints for the Lord of the Rings memory library.
 * Campaign/temporary — delete this file when the campaign ends.
 *
 * Two endpoints:
 *   GET  /api/lotr/graph   — memory graph for 3D visualization
 *   POST /api/lotr/explore — SSE chat scoped to LOTR memories
 */
import { Router, Request, Response } from "express";
import { withOwnerWallet } from "../core/owner-context";
import { recallMemories } from "../memory";
import { getDb, checkRateLimit } from "../core/database";
import { createChildLogger } from "../core/logger";
import { config } from "../config";
import {
  generateOpenRouterResponse,
  OPENROUTER_MODELS,
} from "../core/openrouter-client";

const log = createChildLogger("lotr-routes");

const LOTR_WALLET = "91K7zE12yBQcwYwdBs6JSzt73sYv8SdRdSoYQME4rH1d";
const LOTR_BATCH_IDS = [
  "dba659ac-d32a-41b4-af5b-dfc3674599dc",
  "56cf39f0-db0b-4646-b5bb-c0d2b54b8bce",
  "28b4735e-ba1c-4cd6-b0dd-6f5da2571537",
];

function isLotrMemory(sourceId: string | null): boolean {
  if (!sourceId) return false;
  return LOTR_BATCH_IDS.some((id) => sourceId.startsWith(id));
}

function getClientIp(req: Request): string {
  return (req.ip || req.socket.remoteAddress || "unknown").replace(/^::ffff:/, "");
}

// ---- System prompts ---- //

const INTERPRET_PROMPT = `You extract search queries from a user's question about the Lord of the Rings.

Given a question, output ONLY a raw JSON object with:
- queries: array of 1-3 short search phrases to find relevant memories (focus on key entities, events, concepts)
- entities: array of proper nouns, character names, or key terms mentioned

Example input: "Why does Frodo need to destroy the ring?"
Example output: {"queries":["Frodo destroy ring","One Ring purpose Sauron","ring quest Mount Doom"],"entities":["Frodo","the Ring","Sauron","Mount Doom"]}

Output ONLY the JSON. No markdown, no explanation.`;

function buildExplorePrompt(memories: any[], totalCount: number): string {
  const memoryContext = memories
    .map(
      (m) =>
        `[Memory #${m.id}] (${m.memory_type}, importance: ${m.importance?.toFixed(2) || "?"}) ${m.summary || m.content?.slice(0, 300)}`,
    )
    .join("\n");

  return `You are the Lord of the Rings Memory Explorer — a specialized AI for navigating and explaining a memory library built from the Lord of the Rings trilogy.

Your role:
- Answer questions by referencing specific memories from the recalled context
- Explain connections, characters, events, and themes from the books
- When referencing a memory, use the format [Memory #ID] so the UI can make it clickable
- Be concise — the 3D graph visualization tells the main story, you provide the narrative thread
- If you find a chain of connected events, describe them in order
- If you can't find relevant memories, say so honestly

You have access to ${memories.length} recalled memories (out of ${totalCount} total):

<recalled_memories>
${memoryContext}
</recalled_memories>

IMPORTANT: At the very end of your response, on a new line, output a JSON line starting with MEMORY_IDS: followed by an array of the memory IDs you referenced or found most relevant. Example:
MEMORY_IDS: [123, 456, 789]

This line will be parsed by the UI to highlight nodes in the graph. Always include it.`;
}

// ---- Route factory ---- //

export function lotrRoutes(): Router {
  const router = Router();

  // ── GET /graph — LOTR memory graph for 3D visualization ──
  router.get("/graph", async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(`lotr-graph:${ip}`, 10, 1);
    if (!allowed) {
      res.status(429).json({ error: "Rate limited. 10 requests per minute max." });
      return;
    }

    try {
      const db = getDb();

      const { data: memories, error: memErr } = await db
        .from("memories")
        .select(
          "id, memory_type, summary, content, tags, importance, decay_factor, emotional_valence, access_count, source, source_id, created_at",
        )
        .eq("owner_wallet", LOTR_WALLET)
        .eq("source", "file-upload")
        .order("importance", { ascending: false })
        .limit(50000);

      if (memErr) {
        log.error({ err: memErr }, "Failed to fetch LOTR memories for graph");
        res.status(500).json({ error: "Failed to fetch memories" });
        return;
      }

      // Post-filter to only LOTR batch IDs
      const lotrMemories = (memories || []).filter((m) => isLotrMemory(m.source_id));
      const memoryIds = lotrMemories.map((m) => m.id);

      // Fetch links between these memories
      let links: any[] = [];
      if (memoryIds.length > 0) {
        const { data, error: linkErr } = await db.rpc("get_links_for_ids", {
          ids: memoryIds,
        });
        if (linkErr) {
          log.warn({ err: linkErr }, "Failed to fetch LOTR links, falling back to empty");
        }
        links = data || [];
      }

      res.json({
        nodes: lotrMemories.map((m) => ({
          id: m.id,
          type: m.memory_type,
          summary: m.summary,
          content: m.content,
          tags: m.tags || [],
          importance: m.importance,
          decay: m.decay_factor,
          valence: m.emotional_valence,
          accessCount: m.access_count,
          source: m.source,
          createdAt: m.created_at,
        })),
        links,
        total: lotrMemories.length,
      });
    } catch (err) {
      log.error({ err }, "LOTR graph endpoint error");
      res.status(500).json({ error: "Failed to fetch LOTR graph" });
    }
  });

  // ── POST /explore — SSE chat scoped to LOTR memories ──
  router.post("/explore", async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(`lotr-explore:${ip}`, 5, 1);
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
        log.warn({ err }, "LOTR interpret phase failed, using raw query");
      }

      // ── Phase 2: Recall memories, post-filter to LOTR only ──
      const allMemories = new Map<number, any>();

      await withOwnerWallet(LOTR_WALLET, async () => {
        const recallPromises = queries.map((q) =>
          recallMemories({ query: q, limit: 15, skipExpansion: true }).catch(
            () => [],
          ),
        );
        const results = await Promise.all(recallPromises);
        for (const memories of results) {
          for (const m of memories) {
            if (!allMemories.has(m.id) && isLotrMemory(m.source_id)) {
              allMemories.set(m.id, m);
            }
          }
        }
      });

      const memories = Array.from(allMemories.values())
        .sort((a, b) => (b._score || 0) - (a._score || 0))
        .slice(0, 25);

      // Get total LOTR memory count for context
      const db = getDb();
      const { count: totalCount } = await db
        .from("memories")
        .select("id", { count: "exact", head: true })
        .eq("owner_wallet", LOTR_WALLET)
        .eq("source", "file-upload");

      log.info(
        { queries, recalled: memories.length, total: totalCount },
        "LOTR explore recall complete",
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

      // Stream from OpenRouter
      const llmRes = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openrouterApiKey}`,
            "HTTP-Referer": "https://clude.fun",
            "X-Title": "Clude LOTR Explorer",
          },
          body: JSON.stringify({
            model: OPENROUTER_MODELS["llama-70b"],
            messages,
            max_tokens: 2048,
            temperature: 0.5,
            stream: true,
          }),
          signal: abortController.signal,
        },
      );

      if (!llmRes.ok) {
        const errBody = await llmRes.text().catch(() => "");
        log.error(
          { status: llmRes.status, body: errBody },
          "LOTR explore LLM error",
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
          log.error({ err }, "LOTR explore stream error");
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
      log.error({ err }, "LOTR explore agent error");
      if (!res.headersSent) {
        res.status(500).json({ error: "LOTR explore failed" });
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
