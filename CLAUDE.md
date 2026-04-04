# Clude Bot

## What This Repo Is

1. **npm SDK** (`clude-bot`) — persistent cognitive memory for AI agents. Consumers import `Cortex` and call `recall`/`store`.
2. **Autonomous bot** — @Cludebot on X/Twitter, running 24/7.
3. **Web apps** — `apps/chat/` (user-facing) and `apps/dashboard/` (admin). Independent React 19 + Vite + Tailwind v4 apps.
4. **Mobile app** — `apps/mobile/` Flutter app with Riverpod, GoRouter, Freezed.
5. **Server** — `apps/server/` Express backend on Railway.

Full details: `rules/01-project-overview.md`. All rules live in `rules/` — read the relevant rule file before working in an area.

## gstack

Use the /browse skill from gstack for all web browsing. Never use mcp__claude-in-chrome__* tools.

Available skills: /office-hours, /plan-ceo-review, /plan-eng-review, /plan-design-review, /design-consultation, /review, /ship, /browse, /qa, /qa-only, /design-review, /setup-browser-cookies, /retro, /investigate, /document-release, /codex, /careful, /freeze, /guard, /unfreeze, /gstack-upgrade.

## Clude Memory (Required for ALL agents)

Clude is our product. Every agent MUST actively use it. The `clude-memory` MCP server is configured in `.mcp.json`.

**Every heartbeat / conversation, you MUST:**
1. **Store memories** about your work: decisions made, findings, blockers, task outcomes, things learned. Use `store_memory` with `source: "mcp:<your-role>"` (e.g. `mcp:ceo`, `mcp:lead-pm`, `mcp:researcher`).
2. **Recall memories** when starting work on a topic you may have context on. Use `recall_memories` before diving in.
3. **Minimum 1 memory per heartbeat** where you do meaningful work. More is better.

**Memory type guide:**
- `episodic` — events, task completions, meetings, incidents
- `semantic` — facts, knowledge, architecture decisions, team info
- `procedural` — how-to knowledge, workflows, patterns that work
- `self_model` — reflections on your own performance, strengths, gaps

**Always include:** meaningful `tags`, `importance` (0-1), and `summary`. This is our product — dogfood it seriously.

## Staging Workflow (Required)

All changes MUST go through the staging environment before reaching production. **No exceptions.**

### Rules

1. **All PRs target `staging`** — never open a PR directly to `main`.
2. **No direct pushes** to `main` or `staging`. Always use feature branches and PRs.
3. **Merge to `main` only with board approval.** After your PR lands on `staging`, the board verifies changes at `cludebot-test-preview.up.railway.app`. Only after they approve does the staging→main merge happen.
4. **CI runs on both branches.** PRs to `staging` and `main` both trigger typecheck + build.

### Flow

```
feature-branch ──PR──▶ staging ──Railway Preview──▶ Board verifies
                                                        │
                                  cludebot-test-preview.up.railway.app
                                                        │
                                                   Board approves
                                                        │
                                             staging ──PR──▶ main ──Auto-deploy──▶ production
```

### For Agents

- When using `/ship` or creating PRs, always set `staging` as the base branch.
- When asked to "ship" or "deploy", create a PR to `staging`, not `main`.
- Never run `git push origin main` or merge directly to `main`.
- If you need an emergency fix, still go through `staging` — the board can fast-track approval.

---

## Rules Reference

Detailed rules live in `rules/`. Read the relevant file before working in an area:

| File | Covers |
|------|--------|
| `00-ai-spec-protocol.md` | Spec-driven dev system, pipeline commands, context budget |
| `01-project-overview.md` | Source layout, entry points, sub-apps, config modes |
| `02-domain-knowledge.md` | Memory schema, types, hybrid retrieval, dream cycles, graph |
| `03-tech-stack.md` | All dependencies and hard constraints |
| `04-code-style.md` | Naming, logging, exports, validation, module structure |
| `05-frontend.md` | React 19, Tailwind v4, Privy auth, Solana in frontend |
| `06-backend.md` | Express routes, request scoping, config modes, startup |
| `07-database.md` | Supabase patterns, owner scoping, migrations, key tables |
| `08-auth-security.md` | Privy JWT, wallet security, owner isolation, encryption |
| `09-testing.md` | Vitest patterns, mocking Supabase, what to test |
| `10-git-workflow.md` | Branch naming, conventional commits, CI, gitignore |
| `11-specs-workflow.md` | Spec naming, size limits, lifecycle, INDEX.yaml |
| `12-code-review.md` | Review order, severity levels, project-specific checks |

---

## Code Conventions (Server / TypeScript)

- **TypeScript strict mode** — `strict: true`, target ES2022, CommonJS modules
- **Logging** — always use Pino via `createChildLogger('module-name')`. Never `console.log`
- **Validation** — Zod at all system boundaries. Avoid `as` type assertions
- **Database** — Supabase REST only via `getDb()`. No ORM. No raw SQL string interpolation
- **Config** — `required()` for full bot mode, `optional(key, fallback)` for SDK/MCP. Freeze config objects with `as const`
- **Exports** — named exports everywhere. Default exports only for entry points
- **Naming** — files: kebab-case, classes: PascalCase, functions: camelCase, constants: UPPER_SNAKE_CASE, DB columns: snake_case

## Frontend Conventions (chat/ and dashboard/)

- Independent React 19 + Vite apps. Each has own `package.json` and `node_modules`
- **Tailwind v4** — CSS-based config only. Do NOT create `tailwind.config.ts`
- **Privy versions differ** — chat: `@privy-io/react-auth` 3.18.0, dashboard: 2.0.0. Do not assume API parity
- **State management** — React built-ins only (useState, useEffect, useCallback). No Redux/Zustand
- **Sub-app isolation** — `chat/` and `dashboard/` must NOT import from `src/`. HTTP API only
- **Solana** — chat uses `@solana/pay`, dashboard uses `@solana/kit` 6.3.1. Don't mix them

## Mobile App Conventions (apps/mobile/)

- **Flutter** with Dart SDK ^3.11.4, Material Design 3
- **State management** — Riverpod (`flutter_riverpod` ^2.5.0 + `riverpod_generator`)
- **Routing** — GoRouter ^14.0.0 with auth guards, shell routes for bottom nav
- **Data models** — Freezed ^2.5.0 + json_serializable. All models are `@freezed` immutable classes
- **HTTP** — Dio ^5.4.0 with interceptors for auth injection. SSE streaming support
- **Storage** — `flutter_secure_storage` ^9.0.0 for credentials (iOS Keychain, Android EncryptedSharedPreferences)
- **Architecture** — Clean architecture with feature-based organization: `lib/features/{feature}/`, `lib/core/`, `lib/shared/`
- **Testing** — `mocktail` for mocking, `flutter_test` for widget/unit tests
- **Code gen** — run `dart run build_runner build` after modifying Freezed models or Riverpod providers
- **Naming** — feature modules: `lib/features/{name}/{file}.dart`, screens: `{name}_screen.dart`, providers: `{name}_provider.dart`
- **Widgets** — use `ConsumerWidget` (stateless) or `ConsumerStatefulWidget` (stateful) for Riverpod integration
- **Linting** — `package:flutter_lints/flutter.yaml`

## Backend Conventions

- Express on Railway. `/health` returns 200 (Railway health check)
- **Owner scoping** — every memory query MUST filter by `owner_wallet`. Use `scopeToOwner()` or `withRequestScope()`
- **Route modules** — 8 route files mounted in `src/webhook/server.ts`. New routes get a new module file
- **Auth** — `requirePrivyAuth` for dashboard/admin routes, `optionalPrivyAuth` for SDK/public routes
- **Error responses** — `res.status(4xx|5xx).json({ error: "message" })`
- **Rate limiting** — 200 req/min per IP via middleware. Don't implement manual rate limiting

## Database Rules

- Supabase REST only via `getDb()`. Never instantiate clients directly
- **Owner scoping is mandatory** — `scopeToOwner(query)` or `.eq('owner_wallet', wallet)`
- Hash IDs (`clude-XXXXXXXX`) for external-facing identifiers, not BIGSERIAL PKs
- Always destructure `{ data, error }` and check `error` before using `data`
- Migrations in `/migrations/` (numbered SQL files)

## Git & Specs Workflow

- **Branch = spec path**: `feature/001-add-auth` → `specs/feature/001-add-auth/spec.md`
- **Conventional commits**: `type(scope): description` — types: feat, fix, refactor, chore, docs, test, ci
- **Scopes**: chat, dashboard, server, core, sdk, mcp, cli, mobile
- **Spec size limits**: max 15 files, max 400 lines of diff. Break into sub-specs if exceeded
- **CI**: push to main triggers typecheck + SDK build on Node 22.x
- **Gitignored**: `rules/`, `specs/`, `.claude/`, `node_modules/`, `dist/`, `.env`

## Testing

**Server (Vitest):**
- Tests in `src/**/__tests__/**/*.test.ts`
- Mock all external services (Supabase, Anthropic, Twitter, Solana)
- `vi.mock()` at module level, `vi.restoreAllMocks()` in `beforeEach`
- Test route handlers, memory scoring, graph traversal, feature logic, edge cases

**Mobile (Flutter):**
- Tests in `apps/mobile/test/`
- Use `mocktail` for mocking, not mockito
- Test API client behavior, widget rendering, state management
- Mock Dio for HTTP tests, use `RegisterFallbackValue` for complex types

## Security

- Owner scoping on all memory operations — no cross-tenant data leaks
- No `console.log` in `src/` — Pino only (stdout reserved for MCP)
- No PII in logs — use structured fields `{ agentId, tier }`, never string interpolation with wallet addresses
- No hardcoded API keys, wallet keys, or secrets — env vars only
- Never expose private keys in API responses or frontend code
