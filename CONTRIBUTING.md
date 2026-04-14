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
apps/
  server/      — Cortex API (Express)
  chat/        — Web chat UI (React)
  dashboard/   — Memory visualization (3D graph, entities)
  mobile/      — Mobile app (Flutter)
  workers/     — Background jobs (Twitter monitor)

packages/
  brain/       — Memory system, dream cycle, SDK, agents
  shared/      — Config, database, logger, utilities
  database/    — Supabase migrations
  tsconfig/    — Shared TypeScript configs
```

Key entry points:
- `packages/brain/src/memory/memory.ts` — Memory storage, recall, scoring, decay
- `packages/brain/src/memory/dream/cycle.ts` — Dream cycle (consolidation, reflection, emergence)
- `apps/server/src/routes/` — API routes

## Making changes

1. Create a branch from `staging`
2. Make your changes
3. Verify TypeScript compiles: `pnpm --filter @clude/server typecheck`
4. Verify SDK builds: `pnpm --filter @clude/server build:sdk`
5. Run tests: `pnpm --filter brain test`
6. Open a PR targeting `staging` with a clear description

## Code style

- **Strict TypeScript** — the project uses `strict: true`
- **CommonJS** — module system is CommonJS (not ESM)
- **Pino logger** — use `createChildLogger()` from `@clude/shared/core/logger`, not `console.log`
- **Conventional commits** — `feat:`, `fix:`, `chore:`, `docs:` prefixes

## Tests

Tests use Vitest. Run with `pnpm --filter brain test`. Core memory and dream cycle modules have test coverage. New features should include tests.

## Good first issues

Look for issues labeled [`good first issue`](https://github.com/sebbsssss/cludebot/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) for beginner-friendly tasks.

## Questions?

Open an issue or reach out on X ([@Cludebot](https://x.com/Cludebot)).
