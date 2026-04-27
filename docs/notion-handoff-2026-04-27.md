# Notion handoff — 2026-04-27 session

This file is a handoff for the agent currently managing the
`/cluude-bot` directory. The agent in `Seb-Agent-Orchestration` did
the work below and needs you to push a Notion update reflecting it.

If you have a Notion MCP wired (search for `notion` in the MCP server
list), use it to update the existing Clude project pages. If you
don't, please publish this content as a new Notion page under the
"Clude" workspace, then link it from the project root.

## What shipped this session

### 1. Token sink v0 (USDC → \$CLUDE auto-buy)

**Open PR:** https://github.com/sebbsssss/clude/pull/96 (branch `feat/token-sink-v0`)

The token sink turns every dollar of revenue into a \$CLUDE buy on
Jupiter. Tokens land in a treasury multisig at
`4GJXeBY3FHbeobLSr9rYz57efCvdoWGyEcdcxZ4kwLom`. Users never see the
token, never need a wallet for the token mechanics, never gated on
holdings. Token is a sink, not a key.

Components:

- `packages/database/migrations/019_token_sink.sql` — three new tables (`sink_events`, `user_tiers`, `sink_ledger`). Additive, no FK to existing tables. Not yet applied to prod Supabase.
- `packages/brain/src/sink/` — Jupiter quote/swap, SPL treasury transfer, ledger reads/writes, tier helpers. 5/5 tests pass.
- `apps/workers/src/jobs/usdc-sink-worker.ts` — hourly cron with random jitter. Slippage gates: 200bps in quote, 5% pre-execution price-impact abort. Self-disabled when env unset.
- `apps/server/src/routes/billing.routes.ts` — `POST /api/billing/upgrade` for direct USDC payment. Wallet signs canonical message, server verifies USDC transfer via Solana RPC (never trusts client amounts), upserts user tier, inserts pending ledger row. Tier becomes active immediately, decoupled from swap success.
- `apps/server/src/routes/treasury.routes.ts` — `GET /api/treasury/stats` for the public dashboard.
- `apps/web/public/pricing.html` — 3-tier pricing page with Phantom/Solflare-based USDC checkout. Lazy-loads Solana web3 from unpkg.
- `apps/web/public/treasury.html` — public dashboard, refreshes every 30s, Solscan-linked swap log.

Tier structure (final, after this session removed the \$59 Agent tier):

| Tier | Monthly | Daily memory quota | Includes |
|---|---|---|---|
| Free | \$0 | 200 | local-only mode, MemoryPack export |
| Personal | \$5 USDC | 5,000 | + cloud sync, hosted recall, dream cycles |
| Pro | \$19 USDC | 50,000 | + content anchoring (IPFS), email support |

Pricing rationale: below industry standard (Cursor / ChatGPT \$20, Mem.ai \$14). Marginal cost per Personal user is sub-dollar (local embeddings), leaving margin and a meaningful \$CLUDE buy-pressure stream.

### 2. MemoryPack v0.1 (already merged)

Spec: https://github.com/sebbsssss/clude/blob/main/docs/memorypack.md
Merged via PR #92 + #94 (npm bump to 3.0.4).

What's live:

- `packages/brain/src/memorypack/` — writer, reader, ed25519 signing, tamper rejection. 11/11 tests pass.
- `clude export --format memorypack <dir>` — emits manifest.json + records.jsonl + signatures.jsonl
- `clude import <dir>` — auto-detects MemoryPack directories, verifies signatures
- On-chain memo format flipped to `clude:v1:sha256:<hex>` (matches public spec)
- `@clude/sdk@3.0.4` shipped to npm + MCP Registry

Known v0.2 roadmap items (deferred):

- `.tar.zst` packing
- Reader's optional chain anchor verification
- `blobs/` binary attachments
- Daily auto-snapshot cron
- Standalone `clude verify <pack>` command
- Content anchoring (IPFS/Arweave)
- `@clude/memorypack` standalone npm package

### 3. Compliance product anchor evidence (already merged)

PR `clude-compliance#2` shipped:

- Migration 002 adds `memory_hash` + `solana_signature` columns to `compliance_alerts`
- Policy engine now enriches violations with hash + on-chain anchor in a single batch query
- HTML/PDF report generator gains an "Audit Trail" column with Solscan links
- Strategic claim now true at the artifact level: "When the regulator shows up in 2030, you don't need us to still exist — you need a wallet pubkey, a MemoryPack tarball, and a Solana RPC."

Migration 002 not yet applied to prod Supabase. (The Compliance product reads from the same shared Supabase project as Clude.)

### 4. X auto-reply bot safety gate (already merged)

PR #79 shipped a hard safety gate to prevent bot-tangle bans on cludebot:

- Kill switch via `X_REPLIES_PAUSED` env var
- Known-bot blocklist (configurable via `KNOWN_BOT_HANDLES`)
- Bot-tangle detection (skip if any bot is in the conversation)
- Multi-mention pile-on suppression (3+ tagged accounts → skip)
- Daily 50/24h cap, 90s pacing floor (persistent via `processed_mentions`)
- Tightened in-memory rate limits: 3→2 per-user hourly, 30→15 global hourly

## What's still pending

Operations work that requires the user's hands:

- [ ] Generate sink hot wallet keypair, store base58 in Railway secret
- [ ] Bootstrap \$CLUDE associated token account on the treasury multisig (one-time on-chain action)
- [ ] Set `SINK_HOT_PRIVATE_KEY`, `SINK_HOT_PUBKEY`, `SINK_TREASURY_PUBKEY` on Railway server + workers
- [ ] Apply migration `019_token_sink.sql` to prod Supabase
- [ ] Apply migration `002_compliance_alerts_anchor.sql` (Compliance side) to prod Supabase
- [ ] Merge PR #96
- [ ] Manual \$1 mainnet test swap end-to-end
- [ ] Top up X API credits for the growth swarm's Aria service (separate repo)

Ops runbook lives at `docs/token-sink-runbook.md`.

## Strategic narrative state

- "Memory is the moat. We made it portable." → MemoryPack v0.1 actually exists in code now (PR #92 merged, 3.0.4 on npm)
- "Token is a sink, not a key." → PR #96 implements this honestly. Treasury at `4GJXeBY3FHb…` is publicly auditable.
- "Compliance audit evidence survives the vendor." → True at the artifact level after Compliance PR #2 merged.
- "If Clude disappears tomorrow, your local mode + exported MemoryPack are everything you need." → Documented honestly in `docs/memorypack.md` recovery section.

## Suggested Notion update

Three pages to update / create in Notion:

**1. "Clude product status" (or whatever the master tracking page is called)**

Move these items from "in progress" to "shipped":

- MemoryPack v0.1 reference implementation
- Compliance alerts anchor evidence (Solscan links)
- X bot tangle safety gate

Add to "in progress":

- Token sink v0 (PR #96 awaiting merge + ops setup)

**2. "Token sink design" (new page if doesn't exist)**

Use the architecture summary from this file. Key bullet: "Users pay USDC, server auto-swaps to \$CLUDE on Jupiter, lands in 4GJX…wLom multisig. No gating, no per-action fees, transparent treasury dashboard at clude.io/treasury."

**3. "Pricing" (update existing page or create)**

Free / Personal \$5 / Pro \$19 USDC. Below industry standard. Quotas: 200 / 5,000 / 50,000 memories per day. No \$59 Agent tier (was scoped out for v0 — autonomous-agent use case folds into the future per-operation gas model when that's built).

## Where to find things

| What | Where |
|---|---|
| Token sink code | `packages/brain/src/sink/`, `apps/server/src/routes/billing.routes.ts`, `apps/workers/src/jobs/usdc-sink-worker.ts` |
| Pricing page | `apps/web/public/pricing.html` (also at `/pricing` route) |
| Treasury dashboard | `apps/web/public/treasury.html` (also at `/treasury` route) |
| Operations runbook | `docs/token-sink-runbook.md` |
| MemoryPack spec | `docs/memorypack.md` |
| Test helper | `scripts/sign-billing-upgrade.mjs` |
| Migrations | `packages/database/migrations/019_token_sink.sql` |

End of handoff.
