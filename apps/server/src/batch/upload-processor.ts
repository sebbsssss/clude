/**
 * Background processor for file upload chunks.
 *
 * The database is the queue: upload-routes inserts rows as 'pending',
 * this module claims and processes them with bounded concurrency.
 */
import { getDb } from "../core/database";
import { withOwnerWallet } from "../core/owner-context";
import { storeMemory } from "../core/memory";
import { createChildLogger } from "../core/logger";
import {
  generateOpenRouterResponse,
  OPENROUTER_MODELS,
} from "../core/openrouter-client";
import { z } from "zod";

const log = createChildLogger("batch-upload");

const MAX_CONCURRENT = 10;
let active = 0;
let draining = false;

// ---- LLM extraction (moved from upload-routes) ---- //

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

const ExtractedNodeSchema = z.object({
  title: z.string(),
  content: z.string(),
  entities: z.array(z.string()),
  original_text: z.string(),
});

type ExtractedNode = z.infer<typeof ExtractedNodeSchema>;

interface ChunkRow {
  batch_id: string;
  chunk_index: number;
  chunk_text: string;
  document_title: string;
  owner_wallet: string;
  file_name: string;
}

async function extractNodes(
  chunk: string,
  chunkIndex: number,
): Promise<{ nodes: ExtractedNode[]; rawResponse: string }> {
  const rawResponse = await generateOpenRouterResponse({
    systemPrompt: EXTRACTION_PROMPT,
    messages: [
      {
        role: "user",
        content: `Extract memory nodes from this text chunk (#${chunkIndex + 1}):\n\n${chunk}`,
      },
    ],
    model: OPENROUTER_MODELS["claude-haiku-4.5"],
    maxTokens: 4096,
    temperature: 0.2,
  });

  let nodes: ExtractedNode[] = [];
  try {
    const jsonMatch = rawResponse.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      nodes = z.array(ExtractedNodeSchema).parse(JSON.parse(jsonMatch[0]));
    }
  } catch (err) {
    log.warn({ err, chunkIndex }, "Failed to parse node extraction response");
  }

  return { nodes, rawResponse };
}

// ---- Claim & process ---- //

async function claimNextPending(): Promise<ChunkRow | null> {
  const db = getDb();

  // Find oldest pending row
  const { data: rows } = await db
    .from("llm_outputs")
    .select("batch_id, chunk_index, chunk_text, document_title, owner_wallet, file_name")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);

  if (!rows?.length) return null;

  const row = rows[0];

  // Claim it — single drain loop (guarded by `draining` flag) prevents races
  await db
    .from("llm_outputs")
    .update({ status: "processing" })
    .eq("batch_id", row.batch_id)
    .eq("chunk_index", row.chunk_index)
    .eq("status", "pending");

  return row as ChunkRow;
}

async function processChunk(job: ChunkRow): Promise<void> {
  const { batch_id, chunk_index, chunk_text, document_title, owner_wallet, file_name } = job;
  const db = getDb();

  try {
    const { nodes, rawResponse } = await extractNodes(chunk_text, chunk_index);

    // Store all nodes in parallel — they're independent
    const memoryResults = await Promise.all(
      nodes.map((node, nodeIdx) =>
        withOwnerWallet(owner_wallet, () =>
          storeMemory({
            type: "episodic",
            content: `${node.title}\n\n${node.content}\n\nEntities: ${node.entities.join(", ") || "None"}\n\nOriginal text: ${node.original_text}`,
            summary: node.content,
            tags: [
              "file-upload",
              `doc:${document_title}`,
              ...node.entities.map((e: string) => `entity:${e}`),
            ],
            importance: 0.6,
            source: "file-upload",
            sourceId: `${batch_id}:${chunk_index}:${nodeIdx}`,
            metadata: {
              batch_id,
              chunk_index,
              node_index: nodeIdx,
              entities: node.entities,
              document_title,
              original_text: node.original_text,
            },
          }),
        ),
      ),
    );

    const storedCount = memoryResults.filter(Boolean).length;

    await db
      .from("llm_outputs")
      .update({
        raw_response: rawResponse,
        parsed_node_count: nodes.length,
        status: "completed",
        chunk_text: "",
      })
      .eq("batch_id", batch_id)
      .eq("chunk_index", chunk_index);

    log.info(
      { batch_id, chunk: chunk_index, nodes: nodes.length, memories: storedCount },
      "Chunk processed",
    );
  } catch (err) {
    log.error({ err, batch_id, chunk: chunk_index }, "Chunk processing failed");
    await db
      .from("llm_outputs")
      .update({
        status: "failed",
        error_message: err instanceof Error ? err.message : "Unknown error",
      })
      .eq("batch_id", batch_id)
      .eq("chunk_index", chunk_index);
  }
}

// ---- Public API ---- //

export function drainPending(): void {
  if (draining) return;
  draining = true;

  const drain = async () => {
    while (active < MAX_CONCURRENT) {
      const job = await claimNextPending();
      if (!job) break;
      active++;
      processChunk(job).finally(() => {
        active--;
        drain();
      });
    }
    if (active === 0) draining = false;
  };
  drain().catch((err) => {
    draining = false;
    log.error({ err }, "Drain loop failed");
  });
}

export async function recoverStalled(): Promise<void> {
  const db = getDb();
  const { data, error } = await db
    .from("llm_outputs")
    .update({ status: "pending" })
    .eq("status", "processing")
    .select("batch_id, chunk_index");

  if (error) {
    log.error({ err: error }, "Failed to recover stalled jobs");
    return;
  }

  if (data?.length) {
    log.info({ count: data.length }, "Recovered stalled upload jobs");
  }
}
