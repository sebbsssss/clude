/**
 * File Upload → Scene Extraction → Memory Ingestion pipeline.
 *
 * Flow:
 *   1. User uploads a file (PDF, TXT, MD)
 *   2. Text extracted (unpdf for PDF, raw for text)
 *   3. Text split into chunks, inserted as 'pending' rows in llm_outputs
 *   4. Background processor (batch/upload-processor) drains pending chunks
 *   5. Each scene stored as a memory (episodic, source='file-upload')
 *
 * Auth: Owner wallet only (ALLOWED_WALLETS).
 * Tables: llm_outputs (processing log + chunk text), memories (scene storage).
 */
import { Router, Request, Response } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { getDb } from "../core/database";
import { createChildLogger } from "../core/logger";
import { config } from "../config";
import { isOpenRouterEnabled } from "../core/openrouter-client";
import { drainPending } from "../workers/upload-processor";

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

/** Max chars per chunk — ~2000 tokens, keeps extraction thorough (~5 nodes per chunk) */
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
            chunk_text: "",
            raw_response: "",
            parsed_node_count: 0,
            owner_wallet: wallet,
            file_name: file.originalname,
            file_size_bytes: file.size,
            status: "failed",
            error_message: "No text content extracted from file",
          });
          res.json({ batch_id: batchId, status: "failed", file_name: file.originalname, document_title: docTitle });
          return;
        }

        // 2. Chunk the text
        const chunks = chunkText(fullText);
        log.info(
          { batchId, chunks: chunks.length, totalChars: fullText.length },
          "Text chunked",
        );

        // 3. Insert ALL chunk rows as 'pending' with chunk text for the background processor
        await db.from("llm_outputs").insert(
          chunks.map((text, i) => ({
            batch_id: batchId,
            document_title: docTitle,
            chunk_index: i,
            chunk_text: text,
            raw_response: "",
            parsed_node_count: 0,
            owner_wallet: wallet,
            file_name: file.originalname,
            file_size_bytes: file.size,
            status: "pending",
          })),
        );

        // 4. Respond and kick the background processor
        res.json({
          batch_id: batchId,
          status: "pending",
          chunks: chunks.length,
          file_name: file.originalname,
          document_title: docTitle,
        });

        drainPending();
      } catch (err) {
        log.error({ err, batchId }, "File upload failed");
        res.status(500).json({ error: "File processing failed" });
      }
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

      // Fetch memories created by this batch (source_id is "batchId:chunkIndex:nodeIndex")
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
