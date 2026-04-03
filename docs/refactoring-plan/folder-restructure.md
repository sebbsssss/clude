# Server Folder Restructure Plan

**Status**: Proposed — needs approval before execution

## Current vs Target Structure

### Static web assets → monorepo root `packages/static/`
These don't belong in the server source code.

```
packages/static/
├── landing/index.html        (was: apps/server/src/landing/)
├── logo/                     (was: apps/server/src/logo/)
│   ├── Clude-Icon-Black.svg
│   └── ...
└── verify-app/public/        (was: apps/server/src/verify-app/public/)
```

**Dockerfile changes**: Update COPY paths to `packages/static/`.
**Server changes**: Update `server.ts` static file paths.

---

### `apps/server/src/` target structure

```
src/
├── index.ts                      # Entry point (unchanged)
├── config.ts                     # Env config (unchanged)
│
├── auth/                         # Authentication & authorization
│   ├── privy-auth.ts             # JWT verification middleware ✅ done
│   ├── privy-wallet-resolver.ts  # DID → wallet lookup ✅ done
│   ├── require-ownership.ts      # Wallet ownership middleware ✅ done
│   └── agent-auth.ts             # API key auth (extract from features/agent-tier.ts)
│
├── memory/                       # Memory system ✅ done
│   ├── index.ts                  # Barrel export
│   ├── memory.ts                 # Core store/recall/decay
│   ├── memory.types.ts           # Memory, MemorySummary, StoreMemoryOptions, RecallOptions, MemoryStats
│   ├── graph.ts                  # Entity graph
│   ├── graph.types.ts            # EntityType, Entity, EntityMention, EntityRelation
│   ├── trace.ts                  # Memory provenance
│   ├── trace.types.ts            # TraceNode, TraceResult, TraceLink, ExplainResult
│   ├── clinamen.ts               # Anomaly retrieval
│   ├── clinamen.types.ts         # ClinamenMemory, ClinamenOptions
│   ├── action-learning.ts        # Self-learning
│   ├── action-learning.types.ts  # ActionRecord, OutcomeRecord
│   ├── active-reflection.ts      # Meditation cycle
│   ├── hosted-dreams.ts          # Hosted dream worker
│   └── dream/                    # Dream cycle
│       ├── index.ts              # Barrel
│       └── cycle.ts              # Full cycle (split phases later)
│
├── routes/                       # API routes (rename from webhook/)
│   ├── server.ts                 # Express app setup & route mounting
│   ├── chat.routes.ts            # Chat API
│   ├── cortex.routes.ts          # Cortex SDK API
│   ├── dashboard.routes.ts       # Dashboard UI API
│   ├── graph.routes.ts           # Knowledge graph API
│   ├── explore.routes.ts         # Memory graph chat
│   ├── agent.routes.ts           # External agent API
│   ├── campaign.routes.ts        # Campaign endpoints
│   ├── topup.routes.ts           # Billing/topup
│   ├── upload.routes.ts          # File upload pipeline
│   ├── lotr.routes.ts            # LOTR campaign (temporary)
│   ├── compound.routes.ts        # Prediction market
│   └── __tests__/                # Route tests
│
├── core/                         # Infrastructure services (no business logic)
│   ├── database.ts               # Supabase client
│   ├── logger.ts                 # Pino logger
│   ├── owner-context.ts          # AsyncLocalStorage wallet scope
│   ├── claude-client.ts          # Anthropic SDK wrapper
│   ├── openrouter-client.ts      # OpenRouter LLM wrapper
│   ├── inference.ts              # Unified LLM provider
│   ├── embeddings.ts             # Embedding providers
│   ├── encryption.ts             # Memory content encryption
│   ├── solana-client.ts          # Solana memo/registry
│   ├── x-client.ts               # Twitter API
│   ├── telegram-client.ts        # Telegram bot API
│   ├── web-search.ts             # Tavily search
│   ├── price-oracle.ts           # Price polling + mood events
│   └── guardrails.ts             # Output sanitization
│
├── background/                   # Background tasks & workers
│   ├── mentions/                 # Twitter mention pipeline
│   │   ├── poller.ts
│   │   ├── classifier.ts
│   │   └── dispatcher.ts
│   ├── campaign-tracker.ts       # Campaign tweet polling
│   ├── price-personality.ts      # Mood-based tweet generation
│   ├── x-sentiment-monitor.ts    # Sentiment digest
│   └── upload-processor.ts       # File chunk processor (was: batch/)
│
├── services/                     # Business logic services (unchanged)
│   ├── response.service.ts
│   ├── social.service.ts
│   └── telegram.service.ts
│
├── agents/                       # Task executor (unchanged)
│   ├── executor.ts
│   ├── tools.ts
│   ├── types.ts
│   └── index.ts
│
├── character/                    # Personality & modifiers (unchanged)
│   ├── base-prompt.ts
│   ├── mood-modifiers.ts
│   ├── tier-modifiers.ts
│   └── agent-tier-modifiers.ts
│
├── events/                       # Event bus (unchanged)
│   ├── event-bus.ts
│   └── handlers.ts
│
├── experimental/                 # Research code (unchanged)
│   └── (9 files)
│
├── sdk/                          # SDK mode (unchanged)
│   └── (6 files)
│
├── mcp/                          # Model Context Protocol (unchanged)
│   ├── server.ts
│   └── local-store.ts
│
├── cli/                          # CLI commands (unchanged)
│   └── (11 files)
│
├── knowledge/                    # Domain knowledge (unchanged)
│   └── tokenomics.ts
│
├── types/                        # Shared API types
│   └── api.ts                    # Jupiter, DexScreener interfaces
│
└── utils/                        # Pure utilities (unchanged)
    ├── constants.ts
    ├── text.ts
    ├── format.ts
    ├── env-persona.ts
    └── index.ts
```

## Changes Summary

| Change | Impact | Risk |
|--------|--------|------|
| Static assets → `packages/static/` | Dockerfile, server.ts | Medium — needs Dockerfile update |
| `webhook/` → `routes/` (rename) | All route imports in server.ts | Low — internal to server.ts |
| Route files renamed to `*.routes.ts` | Imports in server.ts | Low |
| Extract types into `.types.ts` files | Memory module internals | Low |
| `batch/` → `background/` | 1 import in server.ts | Low |
| `mentions/` → `background/mentions/` | 3 imports in index.ts | Low |
| `features/agent-tier.ts` auth → `auth/agent-auth.ts` | cortex-routes, chat-routes, agent-routes | Medium |
| `features/*.ts` deprecated stubs → DELETE | 7 files, update ~15 require() calls | Medium |
| Delete `core/memory.ts` and `core/memory-graph.ts` re-exports | ~29 import sites | High — biggest change |

## Execution Order

1. Extract `.types.ts` files from memory module
2. Rename `webhook/` → `routes/` and rename route files
3. Move `batch/` + `mentions/` + background features → `background/`
4. Move static assets to `packages/static/`, update Dockerfile
5. Delete deprecated re-export stubs, update all imports to direct paths
6. Scan and remove unused functions
7. Final typecheck + build
