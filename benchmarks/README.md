# Clude Memory Benchmarks

Reproducible evaluations of the Cortex memory system against academic benchmarks.

## Benchmarks

### LongMemEval (ICLR 2025)

- **Paper**: [Long-Term Memory Evaluation for LLM Agents](https://arxiv.org/abs/2410.10813)
- **Dataset**: [xiaowu0162/longmemeval-cleaned](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned)
- **500 questions**, 6 categories, 3 variants (Oracle, S, M)

```bash
# Full run (S variant — standard for comparison)
npx tsx benchmarks/longmemeval-benchmark.ts --variant s

# Quick test (10 questions)
npx tsx benchmarks/longmemeval-benchmark.ts --variant s --limit 10

# Specific categories only
npx tsx benchmarks/longmemeval-benchmark.ts --variant s --types multi-session,temporal-reasoning

# Options
#   --variant oracle|s|m     Dataset variant (default: oracle)
#   --limit N                Max questions (default: all)
#   --types type1,type2      Filter question types
#   --recall-limit N         Memories per query (default: 50)
#   --reader-model MODEL     Reader LLM (default: claude-sonnet-4-5-20250929)
#   --skip-cleanup           Keep benchmark data in DB
#   --skip-fact-extraction   Skip LLM fact extraction step
#   --oracle-bypass          Skip recall, pass raw sessions (upper bound test)
```

### LoCoMo (ACL 2024)

- **Paper**: [LoCoMo: Long-Context Conversation Memory](https://github.com/snap-research/locomo)
- **Dataset**: [locomo10.json](https://github.com/snap-research/locomo/blob/main/data/locomo10.json)
- **10 conversations**, ~1,540 QA pairs, 4 categories

```bash
# Full run
npx tsx benchmarks/locomo-benchmark.ts

# Quick test (2 conversations)
npx tsx benchmarks/locomo-benchmark.ts --conversations 2

# Options
#   --conversations N    Number of conversations (default: 10)
#   --categories 1,2,3   Filter categories (default: 1,2,3,4)
#   --limit N            Max QA per conversation (default: all)
#   --recall-limit N     Memories per query (default: 25)
#   --skip-cleanup       Keep benchmark data in DB
```

## Requirements

1. **Environment variables** in `.env`:
   ```
   SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_KEY=your_service_key
   ANTHROPIC_API_KEY=your_anthropic_key

   # Optional — enables vector search
   EMBEDDING_PROVIDER=voyage
   EMBEDDING_API_KEY=your_voyage_key
   ```

2. **Database**: Supabase PostgreSQL with pgvector extension and the schema from `supabase-schema.sql`

3. **Dependencies**: `npm install` from the project root

## Our Results (March 2026)

### LongMemEval S-variant

| Category | Accuracy |
|----------|----------|
| SS-Assistant | 96.4% |
| SS-User | 94.3% |
| Knowledge Update | 82.1% |
| Temporal | 72.2% |
| Multi-Session | 61.7% |
| SS-Preference | 46.7% |
| **Overall** | **74.8%** |

Config: Voyage-4-Large embeddings, Claude Sonnet 4.5 reader, Haiku 4.5 judge

### Competitive Comparison (LongMemEval S)

| System | Accuracy |
|--------|----------|
| EmergenceMem | 86.0% |
| EverMemOS | 83.0% |
| **Clude Cortex** | **74.8%** |
| Zep/Graphiti | 71.2% |
| Full-context GPT-4o | 60-64% |
| ChatGPT Memory | 57.7% |

### LoCoMo

| Category | Accuracy |
|----------|----------|
| Open-domain | 29.0% |
| Temporal | 28.1% |
| Single-hop | 21.6% |
| Multi-hop | 16.5% |
| **Overall** | **25.0%** |

Config: Voyage-4-Large embeddings, Haiku 4.5 reader+judge

## How It Works

The benchmarks test the full Cortex pipeline end-to-end:

1. **Seed** — Conversation data is stored as memories via the Cortex SDK
2. **Embed** — Voyage-4-Large generates vector embeddings for each memory
3. **Recall** — For each question, the hybrid retrieval pipeline (vector + keyword + graph) finds relevant memories
4. **Answer** — An LLM reader generates an answer from the recalled context
5. **Judge** — An LLM judge scores the answer against the gold reference

No benchmark data is modified. No questions or answers are changed. Results are fully reproducible.
