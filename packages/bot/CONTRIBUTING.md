# Contributing to Clude Bot

Thanks for your interest in contributing. This guide covers the basics.

## Prerequisites

- **Node.js >= 22.0.0**
- **Supabase project** (free tier works) with `vector` and `pg_trgm` extensions enabled
- **API keys**: Supabase URL + service key (required), Anthropic / Voyage AI / OpenAI (optional)

## Getting started

```bash
git clone https://github.com/sebbsssss/cludebot.git
cd cludebot
npm install
cp .env.example .env  # Fill in your API keys
npm run dev
```

## Project structure

```
src/
  core/        — Memory system, embeddings, database, Solana client
  sdk/         — Public SDK (what npm users import)
  features/    — Dream cycle, shift reports, market monitor
  services/    — Response pipeline
  webhook/     — Express server + route handlers
  character/   — Bot personality and voice
  mentions/    — X/Twitter mention processing
  mcp/         — Model Context Protocol server
  types/       — Shared TypeScript types
  utils/       — Helpers and constants
```

Key entry points:
- `src/sdk/cortex.ts` — The public `Cortex` class
- `src/core/memory.ts` — Memory storage, recall, scoring, decay
- `src/features/dream-cycle.ts` — Dream cycle (consolidation, reflection, emergence)

## Making changes

1. Create a branch from `main`
2. Make your changes
3. Verify TypeScript compiles: `npx tsc --noEmit`
4. Verify SDK builds: `npm run build:sdk`
5. Open a PR with a clear description of what changed and why

## Code style

- **Strict TypeScript** — the project uses `strict: true`
- **CommonJS** — module system is CommonJS (not ESM)
- **Pino logger** — use the shared logger from `src/utils/logger.ts`, not `console.log`

## Tests

The project doesn't have a test suite yet. If you'd like to add one, that's a great first contribution — open an issue to discuss the approach.

## Good first issues

Look for issues labeled [`good first issue`](https://github.com/sebbsssss/cludebot/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) for beginner-friendly tasks.

## Questions?

Open an issue or reach out on X ([@Cludebot](https://x.com/Cludebot)).
