/**
 * Explore Agent — specialized LLM endpoint for memory graph exploration.
 *
 * Two-phase flow:
 *   1. Interpret: LLM extracts search queries from the user's question
 *   2. Respond: Recall memories, then LLM streams an answer with memory references
 *
 * Returns SSE: text chunks + final event with memory_ids for graph highlighting.
 */
import { Router, Request, Response } from "express";
import { withOwnerWallet } from "@clude/shared/core/owner-context";
import { recallMemories } from "@clude/brain/memory";
import { getDb } from "@clude/shared/core/database";
import { createChildLogger } from "@clude/shared/core/logger";
import { config } from "@clude/shared/config";
import { requirePrivyAuth } from "@clude/brain/auth/privy-auth";
import { requireOwnership } from "@clude/brain/auth/require-ownership";
import {
  generateOpenRouterResponse,
  OPENROUTER_MODELS,
} from "@clude/shared/core/openrouter-client";

const log = createChildLogger("explore-agent");

// ---- System prompts ---- //

const INTERPRET_PROMPT = `You extract search queries from a user's question about their memory graph.

Given a question, output ONLY a raw JSON object with:
- queries: array of 1-3 short search phrases to find relevant memories (focus on key entities, events, concepts)
- entities: array of proper nouns, character names, or key terms mentioned

Example input: "Why does Frodo need to destroy the ring?"
Example output: {"queries":["Frodo destroy ring","One Ring purpose Sauron","ring quest Mount Doom"],"entities":["Frodo","the Ring","Sauron","Mount Doom"]}

Example input: "What happened during the Council of Elrond?"
Example output: {"queries":["Council of Elrond meeting","Elrond council decisions fellowship"],"entities":["Elrond","the Council"]}

Output ONLY the JSON. No markdown, no explanation.`;

function buildExplorePrompt(
  memories: any[],
  totalCount: number,
): string {
  const memoryContext = memories
    .map(
      (m) =>
        `[Memory #${m.id}] (${m.memory_type}, importance: ${m.importance?.toFixed(2) || "?"}) ${m.summary || m.content?.slice(0, 300)}`,
    )
    .join("\n");

  return `You are the Memory Explorer — a specialized AI for navigating and explaining a user's memory graph. The user is looking at a 3D visualization of their memories as connected nodes.

Your role:
- Answer questions by referencing specific memories from the recalled context
- Explain connections, causality, and timelines between memories
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

export function exploreRoutes(): Router {
  const router = Router();

  // All explore routes require authentication + wallet ownership
  router.use(requirePrivyAuth);
  router.use(requireOwnership);

  router.post("/", async (req: Request, res: Response) => {
    const { content, history, wallet } = req.body;

    if (!content || typeof content !== "string") {
      res.status(400).json({ error: "content is required" });
      return;
    }

    if (!wallet) {
      res.status(400).json({ error: "wallet is required" });
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
      let queries: string[] = [content]; // fallback: use raw question
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
        log.warn({ err }, "Interpret phase failed, using raw query");
      }

      // ── Phase 2: Recall memories using interpreted queries ──
      const allMemories = new Map<number, any>();

      await withOwnerWallet(wallet, async () => {
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
        .slice(0, 25);

      // Get total count for context
      const db = getDb();
      const { count: totalCount } = await db
        .from("memories")
        .select("id", { count: "exact", head: true })
        .eq("owner_wallet", wallet);

      log.info(
        { queries, recalled: memories.length, total: totalCount },
        "Explore recall complete",
      );

      // ── Phase 3: Stream LLM response ──
      const systemPrompt = buildExplorePrompt(memories, totalCount || 0);
      const messages: Array<{ role: string; content: string }> = [
        { role: "system", content: systemPrompt },
      ];

      // Add conversation history (last 6 messages)
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

      // Send recalled memory IDs immediately so frontend can start dimming
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
            "X-Title": "Clude Explorer",
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
          "Explore LLM error",
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
          log.error({ err }, "Explore stream error");
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

      // Strip the MEMORY_IDS line from the content for clean display
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
      log.error({ err }, "Explore agent error");
      if (!res.headersSent) {
        res.status(500).json({ error: "Explore failed" });
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
