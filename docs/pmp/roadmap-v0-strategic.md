# OpenMemory — The Open Standard for Agent Memory

**Status:** Pre-launch planning
**Started:** 2026-05-11
**Owner:** Sebastien
**Target launch:** 2026-05-25 (2 weeks)

---

## Thesis

The agent-protocol stack is filling in fast — but every layer so far is owned by a single corporate vendor:

| Layer | Standard | Owner | Year |
|---|---|---|---|
| Context | MCP — Model Context Protocol | Anthropic | 2024 |
| Communication | A2A — Agent-to-Agent | Google | 2025 |
| Payments | x402 — HTTP 402 revived | Coinbase | 2025 |
| **Memory** | **OpenMemory** | **Open / community** | **2026** |

Memory is the missing layer, and it's the one layer no single vendor should own. Every agent framework rolls its own today (Letta, Mem0, Zep, LangGraph, OpenAI memory, Clude) and none of them interop. An agent's memory is locked in a silo, can't be ported, can't be verified, can't be sold. That's the gap OpenMemory closes.

**Why "OpenMemory" specifically:** the name puts open-standards positioning in the brand itself, the same way OAuth, OpenAPI, and OpenID did. We're not "Anthropic's protocol for memory" or "Coinbase's protocol for memory" — we're the open one, by definition.

**OpenMemory makes agent memory portable, verifiable, and chain-neutral** the same way x402 made payments portable and chain-neutral. The protocol is open. The reference implementation is Clude. The category is uncontested.

**Note on prior art:** Mem0 previously had a product called "OpenMemory" (a self-hosted MCP server with a dashboard) which they have officially sunset in favour of their hosted server. The protocol-vs-product distinction is clean — we're the standard, not a server — and we'll surface a one-line clarification on the landing page for anyone arriving from legacy Mem0 docs.

---

## The protocol — four verbs

The wire surface is intentionally small. Everything else is provider-defined behind these.

| Verb | What it does | HTTP status surface |
|---|---|---|
| **DISCOVER** | Find memories matching a query across one or many providers | `200` / `206` partial |
| **RETRIEVE** | Fetch memory content, possibly gated by token or payment | `200` / `402` gated / `403` forbidden |
| **VERIFY** | Prove a memory is real, authored, timestamped, unchanged | `200` / `410` revoked |
| **CONTRIBUTE** | Write a new memory to a provider, get a receipt + on-chain commitment | `201` |

**v0.2 verbs (post-launch):**
- **ATTEST** — zero-knowledge proofs over memory corpora. Compliance vertical.
- **SUBSCRIBE** — push notifications when new memories match a standing query.

**Composes natively with x402:** `RETRIEVE` returns `402` → x402 handshake → payment → memory unlocked. The killer demo is "pay 0.001 USDC, get the memory."

**Composes natively with MCP:** an MCP server can expose OpenMemory as a tool. The chain of `tool_use → OpenMemory.RETRIEVE → memory` is what makes an agent's memory queryable from inside any MCP-aware client.

---

## Reference architecture

Three layers. Same shape as the tokenisation design (see `docs/superpowers/specs/2026-05-tokenised-memory-design.md` once written).

**Asset layer**
- Memory = compressed NFT (cNFT) on Solana via Light Protocol, ~$0.0001/mint. Soulbound to author.
- Pack = transferable token (SPL NFT on Solana, ERC-1155 on EVM). Holding it gates content access.

**Commitment layer**
- Memory cNFT metadata commits to `sha256(canonicalised_content)`.
- Pack token metadata commits to a Merkle root over its memory hashes.
- Off-chain payload in Supabase / provider DB. On-chain side is proof only.

**Proof layer**
- v1: Merkle inclusion proofs over Pack contents (selective disclosure).
- v1.5: property proofs over committed metadata (count, tags, author, date range).
- v2: zkVM (SP1 / Risc0) for ATTEST verb — compliance attestations.

**Chain-neutral verification**
A memory minted on Solana is verifiable from a Base contract via signed Merkle proofs. No bridge. Same wire format both ways.

---

## 2-week launch plan

**Pre-condition (must be true before Day 1):**
- Tokenisation design (Sections 1–4) locked. Schema decision committed: `memory_packs` as content-bundle table, separate from `wiki_pack_installations`.
- One engineer allocated to Solana reference impl.
- One Solidity dev allocated for Days 5–10 (Base impl).
- Domain and GitHub org claimed.

### Week 1 — Spec + Solana reference

**Day 1 (Mon, 2026-05-12) — Decisions and scaffolding**
- Register `openmemory.org` (or `agentmemory.org` if .org taken).
- Create GitHub org `openmemory`, repos: `spec`, `sdk-typescript`, `sdk-python`, `reference-solana`, `reference-evm`, `examples`.
- Draft v0.1 spec outline: 4 verbs, JSON schemas, error semantics. No code yet.
- One-page README with brand sketch, logo placeholder.

**Day 2 (Tue) — Spec v0.1 frozen**
- Finalise wire format for `DISCOVER`, `RETRIEVE`, `VERIFY`, `CONTRIBUTE`.
- Cross-chain attestation payload locked: `{merkle_root, author_pubkey, chain_id, signature}`.
- Publish spec doc to public repo. Open for issues but **stop changing it.** Anything new → v0.2.
- Domain DNS pointed at landing-page placeholder.

**Day 3 (Wed) — Solana endpoints, read path**
- Implement `DISCOVER` over existing memories table (owner-scoped, tag-filtered, hybrid retrieval).
- Implement `VERIFY` over `memory_registry` PDA today, cNFTs once those exist.
- Deploy at `api.openmemory.org`. CORS open.
- One self-hosted test agent calling these endpoints end-to-end.

**Day 4 (Thu) — Solana endpoints, write path**
- Implement `CONTRIBUTE`: agent posts a memory → receipt + on-chain commitment via existing `storeMemory()` + `tokenizeMemory()` (Section 3 of design).
- Verify full loop: agent CONTRIBUTE → DISCOVER returns the new memory → VERIFY confirms it.

**Day 5 (Fri) — SDK + EVM scaffold**
- Publish `@openmemory/sdk` to npm. Thin wrappers over the four verbs + `verifyMemory()` helper.
- One LangChain memory adapter (~100 lines).
- Solidity dev starts: scaffold EVM registry contract on Base Sepolia.

### Week 2 — Base reference + launch

**Day 8 (Mon) — Base contracts**
- Deploy `MemoryRegistry` (ERC-721 soulbound) + `PackRegistry` (ERC-1155) to Base Sepolia.
- One test: mint a memory commitment, query it back. Same content-hash format as Solana.

**Day 9 (Tue) — Cross-chain attestation**
- Verifier endpoint dispatches by `chain_id`: routes to Solana cNFT RPC or Base contract.
- Returns the unified `VERIFY` response shape regardless of source chain.
- **This is the technically risky day** — buffer accordingly.

**Day 10 (Wed) — Base provider stub**
- Minimal HTTP server implementing the four verbs against Base contracts.
- Doesn't need to be production. Existence proves multi-chain.
- Mark as "Reference Implementation — Maintained by Community" so we're not on the hook for production support.

**Day 11 (Thu) — Demo agent across chains**
- One LangChain agent that:
  - `DISCOVER`s across Solana (Clude provider) and Base (stub provider).
  - `VERIFY`s memories from each.
  - `CONTRIBUTE`s a new memory to Clude.
- Record a 90-second screencap.
- Write the launch post (use the humanised voice — direct, specific, no "revolutionary").

**Day 12 (Fri) — Launch prep**
- Landing page live: spec link, SDK install, demo video, GitHub.
- Brief 3–5 ecosystem people (Anthropic MCP folks, Coinbase x402 folks, agent framework maintainers) — let them quote-tweet on launch.
- Pre-write FAQ for objections we'll get.

**Day 13 (Sat/Mon) — Launch**
- Post on X, Hacker News, agent-dev communities.
- Open-source repos public.
- Office hours / DMs open for 48h.

**Day 14 (Sun/Tue) — Buffer / firefight**
- Reserved for whatever breaks during launch. Don't promise new things.

---

## Weeks 3–8 — Production single-chain

**Goal:** Solana reference impl is production-grade. Clude is a real OpenMemory provider, not a launch demo.

### Week 3 — Tokenisation production
- Finish all Section 1–4 tokenisation work: cNFT mints on every memory write, Pack tokens, Merkle commitments, kill switch, backfill worker for existing memories.
- `memory_packs` table live, first published Pack tokenised.

### Week 4 — Selective disclosure (v1.5)
- Pack preview endpoint with Merkle inclusion proofs.
- Property proofs over unrevealed leaves (count, tag distribution, author identity).
- This is real ZK — implement carefully.

### Week 5 — Token-gated decryption
- `pack-gate.ts`: server-side ownership verification + key release.
- v1 trusts our server. Threshold encryption is week-12 work.

### Week 6 — SDK polish + framework adapters
- Python SDK to parity with TS.
- Adapters for: CrewAI, Vercel AI SDK, Mastra. Three more after LangChain.
- Each adapter ~100 lines + tests.

### Week 7 — Provider directory v1
- Static JSON registry in the `openmemory/registry` repo.
- Discovery client: agents query the static file, fan out to providers.
- Submission process: PR your provider's manifest, get reviewed, merged.

### Week 8 — Production milestone
- Clude API at parity with v0.1 spec. Public.
- 2+ third-party agents using OpenMemory in non-trivial demos.
- v0.2 spec drafted (ATTEST, SUBSCRIBE).
- Public retro + roadmap update.

---

## Weeks 9–16 — Multi-chain + first enterprise

### Weeks 9–10 — Base production
- Real Base provider, not stub. Anchored to a partner if possible (Coinbase ecosystem, ideally).
- ERC-6551 (token-bound accounts) for agent identity on Base.
- Cross-chain VERIFY in production.

### Weeks 11–12 — Threshold encryption
- Pack content encrypted to a threshold of nodes (Lit Protocol, Nucleus, or our own).
- Server can't decrypt unilaterally. Token holders coordinate decryption.
- This is the enterprise trust story.

### Weeks 13–14 — Compliance zkVM (ATTEST)
- SP1 or Risc0 circuit for one canonical attestation: "this memory corpus contains no SSNs."
- Verifier on Solana + Base. Same proof, two chains.
- This is the v0.2 launch.

### Weeks 15–16 — First paying enterprise
- One compliance customer using ATTEST in production.
- v0.2 spec public.
- 3+ independent OpenMemory providers live.
- Submit to a standards body OR publish as de facto open standard. Decide based on adoption.

---

## Open decisions blocking Day 1

These need to be locked before the launch clock starts:

1. **Section 4 schema decision.** Going with option (i) from the design session: `memory_packs` as content-bundle table, separate from `wiki_pack_installations`. Document and ship the migration.
2. **Domain.** `openmemory.org` vs `openmemory.dev` vs `openmem.io`. Buy whichever is available today — `.org` carries the strongest open-standard signal.
3. **GitHub org name.** Likely `openmemory`. Reserve before announcement.
4. **Solidity dev.** Confirm allocation (in-house or contractor) by EOD 2026-05-11. Without this, Base impl slips and launch is Solana-only with "EVM coming."
5. **Brand assets.** Logo placeholder is fine for launch; final design within 2 weeks post-launch.
6. **Funding for mint gas.** Bot wallet pays for cNFT mints today (~$0.0001 each). Confirm there's enough SOL pre-loaded for ~50k mints during launch.
7. **Whether $CLUDE the token is mentioned in OpenMemory positioning.** Recommend **no** — keep OpenMemory standard-neutral, $CLUDE is a Clude-product concern. OpenMemory is the protocol; Clude is one implementation.

---

## Resource asks

| Role | Time | Phase |
|---|---|---|
| Solana engineer (tokenisation + OpenMemory endpoints) | Full-time, 2 weeks intense + ongoing | All phases |
| Solidity dev | ~10 days across Weeks 1–10 | Launch + Base production |
| Frontend (landing page, docs site) | ~5 days | Week 1–2 |
| DevRel / writer (post, threads, framework outreach) | ~50% time, ongoing | Week 2 onward |
| Designer (logo, brand, site polish) | ~10 days, async | Week 2–4 |

If the team is just you + AI agents for Week 1–2, the constraint is human review bandwidth, not engineering. Prioritise: spec → Solana endpoints → SDK → landing. Cut Base from v0.1 if forced.

---

## Risks

**Spec drift.** Day 2 is the freeze day. If the spec keeps changing into Week 2, the timeline collapses and we ship something incoherent. Hard freeze. Everything new goes to v0.2.

**Cross-chain attestation complexity.** Day 9 is technically the riskiest. If it slips, launch becomes "Solana-only with EVM in v0.2" — fine but smaller story.

**Solidity dev availability.** External dependency. If we can't get one, Base drops to v0.2.

**Competitive timing.** OpenAI, Coinbase, Anthropic, or a YC-funded memory company could ship an equivalent standard before us. Hedge: ship the spec publicly Day 2 even if impl isn't live yet — claim the namespace.

**Adoption inertia.** Standards die from indifference. Pre-launch outreach to 3–5 ecosystem partners is non-negotiable. Quote tweets, not silence.

**Clude credibility carry-over.** If Clude's memory benchmarks (LongMemEval 80.4%) get cited in the launch, OpenMemory gets credibility. If they get challenged, OpenMemory gets dragged. Be ready for benchmark fights.

---

## Success metrics

**T+2 weeks (launch):**
- Spec v0.1 public.
- 2 reference implementations (Solana, Base stub).
- 1 working demo agent across chains.
- ≥1k unique visitors to landing page.
- ≥3 ecosystem partners quote-tweeting.

**T+8 weeks (production single-chain):**
- Clude API at spec parity. 99%+ uptime.
- ≥1k memories tokenised through OpenMemory-shaped endpoints.
- ≥3 independent agents using OpenMemory in non-trivial flows.
- ≥1 framework adapter merged into framework's own repo (LangChain ideally).

**T+16 weeks (multi-chain + enterprise):**
- ≥3 independent OpenMemory providers (us + Base partner + one other).
- ≥1 paying enterprise customer using ATTEST verb.
- v0.2 spec public.
- 100+ projects discoverable in the registry.

**T+6 months (de facto standard or not):**
- Either: OpenMemory referenced in MCP/A2A/x402 ecosystem docs as the memory layer → standard adopted.
- Or: someone else's memory protocol wins → we pivot Clude to be the best implementation of whatever stuck.

---

## Public artifacts checklist

- [ ] `openmemory.org` (or equivalent) live
- [ ] GitHub org `openmemory` with: `spec`, `sdk-typescript`, `sdk-python`, `reference-solana`, `reference-evm`, `examples`, `registry`
- [ ] `docs/openmemory/spec-v0.1.md` — the actual spec
- [ ] `@openmemory/sdk` published to npm
- [ ] `openmemory-python` published to PyPI
- [ ] LangChain adapter PR open against `langchain-ai/langchain`
- [ ] Demo screencap (90 seconds)
- [ ] Launch post (long form, X thread, HN submission)
- [ ] FAQ + objection responses
- [ ] Logo and visual identity (v0 placeholder, v1 final by Week 4)

---

## Open questions to resolve in week 1

- Should OpenMemory have its own foundation/entity, or stay under Clude for now?
- License: MIT vs Apache 2.0 vs custom permissive? Default Apache 2.0.
- Spec versioning: semver or date-based? Default semver (v0.1, v0.2, v1.0).
- Should we coordinate launch timing with Anthropic / Coinbase / a major framework release? Probably no — clean launch, no dependency on anyone else's calendar.
- Funding model: do we accept grants (Solana Foundation, Base ecosystem fund) or stay independent for now? Lean independent for launch, revisit at Week 8.
