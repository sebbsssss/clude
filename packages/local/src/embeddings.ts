/**
 * Local embedding engine using Xenova/transformers (ONNX runtime).
 * Downloads model on first use (~30MB), then runs locally forever.
 * No API keys needed.
 */

let pipeline: any = null;
let modelReady: Promise<void> | null = null;

const DEFAULT_MODEL = 'Xenova/gte-small'; // 384 dims, best quality among small models

export function getEmbeddingDims(): number {
  return 384;
}

async function ensureModel(): Promise<void> {
  if (pipeline) return;
  if (modelReady) return modelReady;

  modelReady = (async () => {
    const { pipeline: createPipeline } = await import('@xenova/transformers');
    pipeline = await createPipeline('feature-extraction', DEFAULT_MODEL, {
      quantized: true, // Use quantized model for speed
    });
  })();

  return modelReady;
}

export async function embed(text: string): Promise<number[]> {
  await ensureModel();
  const output = await pipeline(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  await ensureModel();
  const results: number[][] = [];
  // Process individually to avoid OOM on large batches
  for (const text of texts) {
    const output = await pipeline(text, { pooling: 'mean', normalize: true });
    results.push(Array.from(output.data));
  }
  return results;
}

export function cosineSim(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return magA > 0 && magB > 0 ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}
