/**
 * File Upload → Scene Extraction → Memory Ingestion pipeline.
 *
 * Flow:
 *   1. User uploads a file (PDF, TXT, MD)
 *   2. Text extracted (unpdf for PDF, raw for text)
 *   3. Text split into chunks → LLM extracts scenes + characters per chunk
 *   4. Each scene stored as a memory (episodic, source='file-upload')
 *   5. Memories embedded by Voyage AI (async, handled by storeMemory pipeline)
 *
 * Auth: Owner wallet only (ALLOWED_WALLETS).
 * Tables: llm_outputs (processing log), memories (scene storage).
 */
import { Router, Request, Response } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { withOwnerWallet } from "../core/owner-context";
import { storeMemory } from "../core/memory";
import { getDb } from "../core/database";
import { createChildLogger } from "../core/logger";
import { config } from "../config";
import {
  generateOpenRouterResponse,
  isOpenRouterEnabled,
  OPENROUTER_MODELS,
} from "../core/openrouter-client";

const log = createChildLogger("upload");

// ---- Access control ---- //

const OWNER_WALLET =
  config.owner.wallet || "5vK6WRCq5V6BCte8cQvaNeNv2KzErCfGzeBDwtBGGv2r";

/** Wallets that can access the file upload feature */
const ALLOWED_WALLETS = new Set([
  OWNER_WALLET,
  "91K7zE12yBQcwYwdBs6JSzt73sYv8SdRdSoYQME4rH1d",
]);

/** Multer config: 20MB max, memory storage (no disk) */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "text/plain",
      "text/markdown",
      "application/octet-stream",
    ];
    const ext = file.originalname.toLowerCase();
    if (
      allowed.includes(file.mimetype) ||
      ext.endsWith(".pdf") ||
      ext.endsWith(".txt") ||
      ext.endsWith(".md")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, TXT, and MD files are supported"));
    }
  },
});

// ---- Text extraction ---- //

async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) {
    const { extractText: extractPdfText } = await import("unpdf");
    const result = await extractPdfText(new Uint8Array(buffer), {
      mergePages: true,
    });
    return result.text;
  }
  // TXT / MD — just decode
  return buffer.toString("utf-8");
}

// ---- Text chunking ---- //

/** Max chars per chunk — ~2000 tokens, well within any model's context */
const CHUNK_MAX_CHARS = 8000;

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  // Try paragraph boundaries first
  const paragraphs = text.split(/\n\s*\n/);
  let current = "";

  for (const para of paragraphs) {
    // If a single paragraph exceeds the limit, force-split it by sentences
    if (para.length > CHUNK_MAX_CHARS) {
      if (current.trim()) {
        chunks.push(current.trim());
        current = "";
      }
      const sentences = para.match(/[^.!?]+[.!?]+\s*/g) || [para];
      let sentBuf = "";
      for (const sent of sentences) {
        if ((sentBuf + sent).length > CHUNK_MAX_CHARS && sentBuf.length > 0) {
          chunks.push(sentBuf.trim());
          sentBuf = sent;
        } else {
          sentBuf += sent;
        }
      }
      if (sentBuf.trim()) {
        current = sentBuf;
      }
      continue;
    }

    if ((current + "\n\n" + para).length > CHUNK_MAX_CHARS && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

// ---- LLM memory node extraction ---- //

const EXTRACTION_PROMPT = `You are a knowledge extractor. Given a text chunk from a document, extract distinct memory nodes. Each node should be a self-contained piece of knowledge important enough to remember on its own.

For narratives: each node is a distinct event, scene, or turning point.
For technical content: each node is a distinct concept, process, or decision.
For conversations/interviews: each node is a distinct topic or exchange.

For each memory node, provide:
- title: short descriptive title (max 60 chars)
- content: A faithful summary of what the source text says. Do NOT invent details, embellish, or add information not present in the original. Always name people/characters explicitly — never use pronouns without naming who. Keep it as long or short as the source material warrants.
- entities: array of ALL people, characters, organizations, or key concepts involved
- original_text: the COMPLETE original text from the source that this node covers. Copy it verbatim — do not truncate, summarize, or paraphrase. This should be the full passage, not just a highlight.

CRITICAL: Output ONLY a raw JSON array. No markdown, no code fences, no explanation text before or after. Start your response with [ and end with ].

Example:
[
  {
    "title": "Elena and Marcus discover the assassination plot",
    "content": "Elena encounters Marcus at the crossroads at dawn. Marcus, a former soldier, recognizes the Order's sigil on Elena's cloak and reveals he intercepted a coded message about an assassination plot against the Council. Elena agrees to collaborate after Marcus produces a sealed letter in Aldric's handwriting.",
    "entities": ["Elena", "Marcus", "Aldric", "the Council", "the Order"],
    "original_text": "The sun had barely risen when Elena spotted the tall figure waiting by the stone marker. His hand rested on the pommel of a short sword, but his posture spoke of weariness, not aggression. 'You bear the sigil of the Order,' he said without preamble. 'My name is Marcus. I was a soldier once, before I turned to trade.' He reached into his coat and produced a sealed letter. 'I intercepted a coded message three days ago — an assassination plot against the Council. This letter is from Aldric. He sent me to find you.'"
  }
]

If the text is too short or has no meaningful content, return an empty array [].`;

interface ExtractedNode {
  title: string;
  content: string;
  entities: string[];
  original_text: string;
}

async function extractNodes(
  chunk: string,
  chunkIndex: number,
  nodeOffset: number,
): Promise<{ nodes: ExtractedNode[]; rawResponse: string }> {
  const rawResponse = await generateOpenRouterResponse({
    systemPrompt: EXTRACTION_PROMPT,
    messages: [
      {
        role: "user",
        content: `Extract memory nodes from this text chunk (#${chunkIndex + 1}, start numbering from ${nodeOffset + 1}):\n\n${chunk}`,
      },
    ],
    model: OPENROUTER_MODELS["llama-70b"],
    maxTokens: 4096,
    temperature: 0.2,
  });

  let nodes: ExtractedNode[] = [];
  try {
    const jsonMatch = rawResponse.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      nodes = JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    log.warn({ err, chunkIndex }, "Failed to parse node extraction response");
  }

  return { nodes, rawResponse };
}

// ---- Route factory ---- //

export function uploadRoutes(): Router {
  const router = Router();

  // GET /check-access — verify if wallet has access
  router.get("/check-access", (req: Request, res: Response) => {
    const wallet = req.query.wallet as string;
    res.json({ allowed: wallet ? ALLOWED_WALLETS.has(wallet) : false });
  });

  // GET /batches — list upload batches for this wallet
  router.get("/batches", async (req: Request, res: Response) => {
    try {
      const wallet = req.query.wallet as string;
      if (!wallet || !ALLOWED_WALLETS.has(wallet)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      const db = getDb();
      const { data, error } = await db
        .from("llm_outputs")
        .select(
          "batch_id, document_title, file_name, status, parsed_node_count, created_at, error_message",
        )
        .eq("owner_wallet", wallet)
        .order("created_at", { ascending: false });

      if (error) {
        log.error({ err: error }, "Failed to list batches");
        res.status(500).json({ error: "Failed to list batches" });
        return;
      }

      // Group by batch_id with progress tracking
      const batches = new Map<string, any>();
      for (const row of data || []) {
        if (!batches.has(row.batch_id)) {
          batches.set(row.batch_id, {
            batch_id: row.batch_id,
            document_title: row.document_title,
            file_name: row.file_name,
            status: row.status,
            total_nodes: 0,
            total_chunks: 0,
            chunks_completed: 0,
            chunks_failed: 0,
            chunks_pending: 0,
            chunks_processing: 0,
            created_at: row.created_at,
            error_message: row.error_message,
          });
        }
        const batch = batches.get(row.batch_id)!;
        batch.total_nodes += row.parsed_node_count || 0;
        batch.total_chunks += 1;
        if (row.status === "completed") batch.chunks_completed += 1;
        else if (row.status === "failed") batch.chunks_failed += 1;
        else if (row.status === "processing") batch.chunks_processing += 1;
        else batch.chunks_pending += 1;
        // Derive overall status
        if (batch.chunks_failed > 0) batch.status = "failed";
        else if (batch.chunks_processing > 0 || batch.chunks_pending > 0) batch.status = "processing";
        else batch.status = "completed";
        if (row.error_message && !batch.error_message)
          batch.error_message = row.error_message;
      }

      res.json({ batches: Array.from(batches.values()) });
    } catch (err) {
      log.error({ err }, "List batches error");
      res.status(500).json({ error: "Failed to list batches" });
    }
  });

  // POST /process — upload file, extract text, run LLM, store memories
  router.post(
    "/process",
    upload.single("file"),
    async (req: Request, res: Response) => {
      const file = req.file;
      const wallet = req.body.wallet || (req.query.wallet as string);
      const docTitle = req.body.title || file?.originalname || "Untitled";

      if (!wallet || !ALLOWED_WALLETS.has(wallet)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      if (!file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      if (!isOpenRouterEnabled()) {
        res.status(500).json({ error: "LLM not configured" });
        return;
      }

      const batchId = randomUUID();
      const db = getDb();

      // Respond immediately with batch_id, process in background
      res.json({
        batch_id: batchId,
        status: "processing",
        file_name: file.originalname,
        document_title: docTitle,
      });

      // Background processing
      (async () => {
        try {
          // 1. Extract text from file
          log.info(
            { batchId, file: file.originalname, size: file.size },
            "Starting file processing",
          );
          const fullText = await extractText(file.buffer, file.originalname);

          if (!fullText.trim()) {
            await db.from("llm_outputs").insert({
              batch_id: batchId,
              document_title: docTitle,
              chunk_index: 0,
              raw_response: "",
              parsed_node_count: 0,
              owner_wallet: wallet,
              file_name: file.originalname,
              file_size_bytes: file.size,
              status: "failed",
              error_message: "No text content extracted from file",
            });
            return;
          }

          // 2. Chunk the text
          const chunks = chunkText(fullText);
          log.info(
            { batchId, chunks: chunks.length, totalChars: fullText.length },
            "Text chunked",
          );

          // 3. Insert ALL chunk rows upfront as 'pending' so frontend can track progress
          await db.from("llm_outputs").insert(
            chunks.map((_, i) => ({
              batch_id: batchId,
              document_title: docTitle,
              chunk_index: i,
              raw_response: "",
              parsed_node_count: 0,
              owner_wallet: wallet,
              file_name: file.originalname,
              file_size_bytes: file.size,
              status: "pending",
            })),
          );

          // 4. Process each chunk through LLM
          let globalNodeCounter = 0;

          for (let i = 0; i < chunks.length; i++) {
            try {
              // Mark chunk as processing
              await db
                .from("llm_outputs")
                .update({ status: "processing" })
                .eq("batch_id", batchId)
                .eq("chunk_index", i);

              // Run LLM node extraction
              const { nodes, rawResponse } = await extractNodes(chunks[i], i, globalNodeCounter);

              // 4. Store each node as a memory
              const memoryIds: number[] = [];
              for (const node of nodes) {
                globalNodeCounter++;
                const memoryId = await withOwnerWallet(wallet, () =>
                  storeMemory({
                    type: "episodic",
                    content: `${node.title}\n\n${node.content}\n\nEntities: ${node.entities.join(", ") || "None"}\n\nOriginal text: ${node.original_text}`,
                    summary: node.content,
                    tags: [
                      "file-upload",
                      `doc:${docTitle}`,
                      ...node.entities.map((e: string) => `entity:${e}`),
                    ],
                    importance: 0.6,
                    source: "file-upload",
                    sourceId: `${batchId}:${globalNodeCounter}`,
                    metadata: {
                      batch_id: batchId,
                      node_index: globalNodeCounter,
                      chunk_index: i,
                      entities: node.entities,
                      document_title: docTitle,
                      original_text: node.original_text,
                    },
                  }),
                );
                if (memoryId)
                  memoryIds.push(
                    typeof memoryId === "number"
                      ? memoryId
                      : parseInt(String(memoryId)),
                  );
              }

              // Update llm_output row with results
              await db
                .from("llm_outputs")
                .update({
                  raw_response: rawResponse,
                  parsed_node_count: nodes.length,
                  status: "completed",
                })
                .eq("batch_id", batchId)
                .eq("chunk_index", i);

              log.info(
                {
                  batchId,
                  chunk: i,
                  nodes: nodes.length,
                  memories: memoryIds.length,
                },
                "Chunk processed",
              );
            } catch (chunkErr) {
              log.error(
                { err: chunkErr, batchId, chunk: i },
                "Chunk processing failed",
              );
              await db
                .from("llm_outputs")
                .update({
                  status: "failed",
                  error_message:
                    chunkErr instanceof Error
                      ? chunkErr.message
                      : "Unknown error",
                })
                .eq("batch_id", batchId)
                .eq("chunk_index", i);
            }
          }

          log.info(
            { batchId, totalNodes: globalNodeCounter, chunks: chunks.length },
            "File processing complete",
          );
        } catch (err) {
          log.error({ err, batchId }, "File processing pipeline failed");
          await db
            .from("llm_outputs")
            .update({
              status: "failed",
              error_message:
                err instanceof Error ? err.message : "Pipeline failed",
            })
            .eq("batch_id", batchId);
        }
      })();
    },
  );

  // GET /batch/:id — get status of a specific batch
  router.get("/batch/:id", async (req: Request, res: Response) => {
    try {
      const wallet = req.query.wallet as string;
      if (!wallet || !ALLOWED_WALLETS.has(wallet)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      const batchId = req.params.id;
      const db = getDb();

      const { data: outputs, error: outputErr } = await db
        .from("llm_outputs")
        .select("*")
        .eq("batch_id", batchId)
        .eq("owner_wallet", wallet)
        .order("chunk_index", { ascending: true });

      if (outputErr || !outputs?.length) {
        res.status(404).json({ error: "Batch not found" });
        return;
      }

      // Fetch memories created by this batch (source_id is "batchId:nodeIndex")
      const { data: memories } = await db
        .from("memories")
        .select("id, summary, tags, importance, created_at, metadata")
        .eq("source", "file-upload")
        .like("source_id", `${batchId}:%`)
        .eq("owner_wallet", wallet)
        .order("created_at", { ascending: true });

      const totalNodes = outputs.reduce(
        (sum, o) => sum + (o.parsed_node_count || 0),
        0,
      );
      const allCompleted = outputs.every((o) => o.status === "completed");
      const anyFailed = outputs.some((o) => o.status === "failed");

      res.json({
        batch_id: batchId,
        document_title: outputs[0].document_title,
        file_name: outputs[0].file_name,
        status: anyFailed
          ? "failed"
          : allCompleted
            ? "completed"
            : "processing",
        chunks: outputs.map((o) => ({
          chunk_index: o.chunk_index,
          status: o.status,
          parsed_node_count: o.parsed_node_count,
          raw_response: o.raw_response,
          error_message: o.error_message,
        })),
        total_nodes: totalNodes,
        memories: memories || [],
      });
    } catch (err) {
      log.error({ err }, "Get batch error");
      res.status(500).json({ error: "Failed to get batch" });
    }
  });

  return router;
}
