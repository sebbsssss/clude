# Clude Local Memory Contract

**contractVersion: 1**
**Status:** stable for the v1 surface below. Changes follow the versioning policy at the end.

This document defines the stable interface between Clude's memory engine and an external host (the Clude desktop app, which lives in a separate repository, or any process embedding the `clude` SDK). It lets a host run Clude's memory operations on a **local model** (CludeMem, served by Ollama) with no frontier API key.

The host depends on this contract, not on Clude's internals. Anything not listed here may change without a version bump.

---

## 1. What "local memory mode" means

Clude splits LLM work into two classes:

- **Memory operations** (classification, importance, extraction, entity/relation, temporal, consolidation, compaction, contradiction verdicts, query understanding, reranking, grounded answer). These can run on a local model.
- **Personality generation** (chat replies, reflection journals, emergence). These stay on a frontier provider and are out of scope for local mode.

In local mode, memory operations route to a local Ollama model; if the local call fails, the router falls back to the configured frontier path (or surfaces the error when no frontier is configured).

---

## 2. Transport

- **Server:** Ollama, reachable at `OLLAMA_URL` (default `http://localhost:11434`).
- **Chat endpoint:** native `POST {OLLAMA_URL}/api/chat` with `stream: false`. Structured outputs use Ollama's `format` field (a JSON Schema). The OpenAI-compatible `POST {OLLAMA_URL}/v1/chat/completions` is also available.
- **Embedding endpoint:** `POST {OLLAMA_URL}/v1/embeddings` (OpenAI-compatible), used when `EMBEDDING_PROVIDER=ollama`.
- The host is responsible for installing Ollama and pulling the models (`ollama pull <model>`).

---

## 3. Models

| Role | Selector | v1 value(s) | Notes |
|------|----------|-------------|-------|
| Memory-ops chat | `MEMORY_MODEL` | any Ollama tag, e.g. `gemma3:4b` today; `cludemem-e4b` once published | The fine-tuned CludeMem model is a drop-in: set this tag. |
| Embeddings | `EMBEDDING_MODEL` | `nomic-embed-text` (or `mxbai-embed-large`) | Only when `EMBEDDING_PROVIDER=ollama`. |

---

## 4. Enabling local mode

### 4a. Environment variables (recommended for a separate-process host, e.g. the desktop app)

```bash
# Memory operations -> local model
MEMORY_MODEL_PROVIDER=ollama
MEMORY_MODEL=cludemem-e4b          # or gemma3:4b today
OLLAMA_URL=http://localhost:11434  # default; override if Ollama runs elsewhere
MEMORY_MODEL_TIMEOUT_MS=20000      # optional, per-request timeout

# Embeddings -> local (for a fully offline, zero-API-key setup)
EMBEDDING_PROVIDER=ollama
EMBEDDING_MODEL=nomic-embed-text
```

Memory operations are **opt-in**: with `MEMORY_MODEL_PROVIDER` unset, behavior is exactly as before (frontier path). A running Ollama server is never auto-detected into use.

### 4b. Programmatic (in-process `clude` SDK)

```ts
import { Cortex } from 'clude'; // @clude/brain

const cortex = new Cortex({
  supabase: { url, serviceKey },          // or your storage config
  localModel: { model: 'cludemem-e4b' },  // ollamaUrl optional (defaults to localhost:11434)
  embedding: { provider: 'ollama', apiKey: 'ollama', model: 'nomic-embed-text' },
});
```

`localModel` applies a runtime override equivalent to the env vars in 4a, after config has loaded.

---

## 5. Capability probes (stable exports from `@clude/shared`)

```ts
import { isMemoryModelEnabled, isOllamaEnabled, getMemoryModelConfig } from '@clude/shared';
import { pingOllama } from '@clude/shared/core/ollama-client';

isMemoryModelEnabled();            // boolean: any memory-model provider configured
isOllamaEnabled();                 // boolean: local Ollama memory model configured + model set
getMemoryModelConfig();            // { provider, model, ollamaUrl, timeoutMs } (effective)
await pingOllama('http://localhost:11434'); // boolean: server reachable (GET /api/tags)
```

A host should `pingOllama()` and confirm the configured `MEMORY_MODEL` is pulled before relying on local mode, and surface a remediation hint (`ollama pull <model>`) otherwise. The `clude doctor` CLI performs an equivalent check.

---

## 6. Memory-op output shape

Structured memory ops request a JSON Schema via `format`; the model returns JSON matching it (temperature 0). Schemas are intentionally flat. The set of locally-routed operations (by cognitive function) is: `classify`, `extract`, `entity`, `temporal`, `importance`, `summarize`, `reconcile`, `query`. The per-op JSON schemas are defined by the CludeMem model card and are additive within a contract major version.

---

## 7. Versioning policy

- `contractVersion` is an integer. The host pins the version it was built against.
- **Patch (no bump):** clarifications, new optional env vars with safe defaults, new probe helpers.
- **Minor (no bump within v1):** new locally-routed operations, additional model tags, additional optional schema fields.
- **Major (bump):** removing or renaming an env var, changing a default, removing a probe, or a breaking change to an op's output schema. Breaking changes are listed in the changelog below and announced before release.

### Changelog

| Version | Date | Change |
|---------|------|--------|
| 1 | 2026-06-13 | Initial contract: env + programmatic local mode, Ollama transport, capability probes, opt-in memory-op routing. |
