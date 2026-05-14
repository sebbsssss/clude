# PMP — Portable Memory Protocol

## Detailed Build & Roll-out Plan

**Status:** Pre-launch, decisions in final lock
**Started:** 2026-05-11
**Target launch:** 2026-05-25 (T+14d)
**Tagline:** *"MCP gave agents context. PMP gives them memory."*

---

## 0. What's locked, what's open

### Locked
- **Name:** PMP — Portable Memory Protocol
- **Architecture:** 3 layers (asset / commitment / proof)
- **Verbs:** DISCOVER, RETRIEVE, VERIFY, CONTRIBUTE (v0.1); ATTEST, SUBSCRIBE (v0.2)
- **Chains:** Solana primary (Clude as reference), Base secondary
- **Asset model:** memory cNFT soulbound, Pack token transferable
- **Commitment model:** content off-chain encrypted, hash + Merkle root on-chain
- **License:** Apache 2.0 for spec, MIT for SDKs
- **Section 4 schema:** `memory_packs` as content-bundle table (option i)

### Open (Day 0 decisions)
- **Domain:** `portablememoryprotocol.com` (canonical, $12/yr at Namecheap) + `pmp.dev` (short, $12/yr Google Domains). Recommend buy both same day.
- **GitHub org:** `portablememoryprotocol` — clean, create today
- **Solidity dev:** in-house if available, otherwise contract for ~10 days @ market rate (~$1k–2k/day). If neither path, defer Base to v0.2 and ship Solana-only.
- **Solana gas:** 0.1 SOL pre-loaded on bot wallet (~$15 at current price, covers ~100k cNFT mints).
- **Brand assets:** logo placeholder by Day 1, polished v1 by Week 3.

---

## 1. Pre-launch (Day 0, before clock starts)

| Task | Owner | Time | Output |
|---|---|---|---|
| Buy `portablememoryprotocol.com` + `pmp.dev` | Sebastien | 10 min | Domains registered, DNS pointed at Vercel placeholder |
| Create GitHub org `portablememoryprotocol` | Sebastien | 5 min | Org exists, MIT/Apache license templates configured |
| Create repos | Sebastien | 15 min | `spec`, `sdk-typescript`, `sdk-python`, `reference-solana`, `reference-evm`, `examples`, `registry`, `site` |
| Allocate Solana engineer | Sebastien | — | Calendar block: full-time wks 1–2, ~50% wks 3–8 |
| Confirm Solidity contractor | Sebastien | — | SOW signed: Base ERC-721 + ERC-1155 + minimal HTTP server, 10 days |
| Pre-fund mint wallet | Sebastien | 5 min | 0.1 SOL deposited |
| Lock Section 4 schema | Engineer | 30 min | Migration drafted: `memory_packs`, `memory_pack_contents`, `cnft_trees` |

**Acceptance:** all 7 tasks complete by EOD Day 0. If any blocked, the timeline slips proportionally.

---

## 2. Technical build plan — Week 1 (Days 1–7)

### Phase 1: Spec v0.1 frozen (Days 1–2)

**Goal:** Publish a spec an independent dev can implement without further clarification.

**Owner:** Sebastien (writing) + Solana engineer (review)

**Deliverables:**
- `spec/v0.1/README.md` — overview, design principles, governance
- `spec/v0.1/wire-format.md` — HTTP semantics for all 4 verbs
- `spec/v0.1/schemas/` — JSON Schema files for memory, pack, attestation, error responses
- `spec/v0.1/cross-chain.md` — chain-neutral attestation payload format
- `spec/v0.1/security.md` — signing, replay protection, rate-limit norms

**Concrete API surface:**

```
DISCOVER   GET  /v1/memories?query=&owner=&tags=&limit=&cursor=
RETRIEVE   GET  /v1/memories/:id           → 200 / 402 (gated) / 410 (revoked)
VERIFY     GET  /v1/memories/:id/verify    → returns attestation + proof
CONTRIBUTE POST /v1/memories               → returns id + receipt
```

**Memory object schema (v0.1):**

```json
{
  "id": "mem-abcd1234",
  "type": "episodic|semantic|procedural|self_model|introspective",
  "content": "...",
  "owner": "solana:GsbwXf...",
  "created_at": "2026-05-13T12:34:56Z",
  "tags": ["compliance"],
  "attestation": {
    "chain_id": "solana",
    "asset_id": "<cnft_address>",
    "content_hash": "sha256:...",
    "tx_sig": "...",
    "verifier_url": "https://api.portablememoryprotocol.com/v1/memories/mem-abcd1234/verify"
  }
}
```

**Acceptance:** an external dev (e.g. a friendly contact in MCP or x402 communities) reads the spec and produces a 100-line mock provider that passes our conformance test.

**Risk:** spec drift after freeze. Mitigation: hard freeze on EOD Day 2. Any new ideas → labelled `v0.2` issues.

### Phase 2: Solana reference impl (Days 3–4)

**Goal:** All 4 verbs live on `api.portablememoryprotocol.com`, backed by Clude's existing memory system.

**Owner:** Solana engineer

**Deliverables:**
- `apps/server/src/routes/pmp.routes.ts` — Express routes mounted at `/v1/memories`
- `packages/brain/src/pmp/discover.ts` — wraps existing `recallMemories()` with PMP wire format
- `packages/brain/src/pmp/retrieve.ts` — fetches by id, returns content or 402 if Pack-gated
- `packages/brain/src/pmp/verify.ts` — fetches cNFT or legacy registry PDA, returns attestation
- `packages/brain/src/pmp/contribute.ts` — wraps `storeMemory()` with PMP receipt + on-chain hook
- Conformance test: spin up local instance, run spec test suite, all pass

**Dependencies:**
- Section 4 schema migration applied
- Tokenisation cNFT minting from design sessions 1–3 in place (or at least the legacy `memory_registry` PDA path)
- Solana mint wallet funded

**Acceptance:** an external agent (we test with a LangChain example) can DISCOVER → RETRIEVE → VERIFY → CONTRIBUTE in a complete loop, end to end.

**Risk:** cNFT minting not ready in time. Mitigation: ship v0.1 against the legacy `memory_registry` PDA; cNFT migration ships in Phase 6.

### Phase 3: SDK skeleton + first framework adapter (Day 5)

**Goal:** Any TypeScript dev can `npm install @pmp/sdk` and use PMP in under 5 minutes.

**Owner:** Solana engineer (or TS dev if available)

**Deliverables:**
- `packages/sdk-typescript/src/client.ts` — thin wrappers over each verb
- `packages/sdk-typescript/src/verify.ts` — pure-function verifier (no network round-trip if proof bundled)
- `packages/sdk-typescript/src/adapters/langchain.ts` — drop-in memory adapter for LangChain
- `examples/langchain-agent/` — runnable example: a LangChain agent using PMP for memory
- Published to npm as `@pmp/sdk@0.1.0-alpha`

**Acceptance:** `npx degit portablememoryprotocol/examples/langchain-agent && npm i && npm start` runs an agent that DISCOVERs + CONTRIBUTEs against `api.portablememoryprotocol.com`.

**Risk:** LangChain memory API churn breaks adapter. Mitigation: pin LangChain version in `package.json`, document compatibility matrix.

### Phase 4: Base EVM contracts scaffolded (Days 5–7)

**Goal:** EVM contracts deployed to Base Sepolia, mint + read works end to end on-chain.

**Owner:** Solidity contractor

**Deliverables:**
- `contracts/MemoryRegistry.sol` — ERC-721 with `_transfer` disabled (soulbound)
- `contracts/PackRegistry.sol` — ERC-1155 with metadata pointing to off-chain URI + Merkle root
- `contracts/test/` — Hardhat tests for mint + read + transfer-revert
- Deployed to Base Sepolia with verified source on Basescan
- `reference-evm/README.md` — addresses, ABI, example tx

**Dependencies:** Spec v0.1 frozen (Phase 1)

**Acceptance:** mint a memory commitment via Hardhat script, query it back, transfer attempt reverts. All in CI on PR.

**Risk:** contractor availability. Mitigation: have backup Solidity dev on standby OR commit to "Solana-only at launch, Base in v0.2" by Day 5.

---

## 3. Technical build plan — Week 2 (Days 8–14)

### Phase 5: Cross-chain attestation (Days 8–9)

**Goal:** One VERIFY endpoint that works for memories minted on either chain.

**Owner:** Solana engineer

**Deliverables:**
- `packages/brain/src/pmp/verify.ts` extended: route by `chain_id` field on the memory
- Helper: `verifyFromSolana(asset_id)` and `verifyFromBase(asset_id)` returning the unified shape
- E2E test: VERIFY a Solana memory and a Base memory through the same endpoint, both return the same response shape

**Dependencies:** Phases 2 + 4 done

**Acceptance:** demo agent VERIFYs one memory from each chain in a single session without code branching.

**Risk:** RPC reliability on Base Sepolia. Mitigation: use Alchemy + QuickNode failover; cache verified attestations for 60 seconds.

### Phase 6: Base reference provider stub (Day 10)

**Goal:** A working (if minimal) PMP provider on Base, so the protocol is provably multi-chain at launch.

**Owner:** Solidity contractor + Solana engineer

**Deliverables:**
- `reference-evm/server/` — Express server speaking the 4 verbs against Base contracts
- Deployed to Vercel/Fly at `evm-ref.pmp.dev`
- Marked "Reference Implementation — Community Maintained" so we're not on the hook for production support
- README documenting how someone else can fork + run their own Base provider

**Dependencies:** Phase 4

**Acceptance:** SDK works against both `api.portablememoryprotocol.com` (Solana, Clude) and `evm-ref.pmp.dev` (Base, stub) with no code changes.

### Phase 7: Demo agent + launch materials (Days 11–12)

**Goal:** A 90-second demo + the launch post draft + 5 pre-briefed partners.

**Owner:** Sebastien

**Deliverables:**
- `examples/multi-chain-demo/` — LangChain agent that DISCOVERs across both providers, VERIFYs a memory from each, CONTRIBUTEs new ones
- 90-second screencap (recorded, edited)
- Launch post draft (X thread, HN submission, long-form blog post on `pmp.dev/blog`)
- FAQ with 10 anticipated objections + responses
- Pre-brief 5 partners: 1 from MCP ecosystem (Anthropic dev rel), 1 from x402 (Coinbase dev rel), 2 from agent frameworks (LangChain, Vercel), 1 from a memory competitor (Mem0 or Letta — friendly outreach to position as complementary)

**Acceptance:** demo recording is watchable, post draft is humanised (run through the humanizer principles), all 5 partners have read the spec privately and at least 2 confirm they'll quote-tweet.

### Phase 8: Launch (Day 13)

**Goal:** Spec public, repos open, agent dev community knows PMP exists.

**Owner:** Sebastien + DevRel/writer if available

**Channels:**
- X: thread from `@clude_io` or new `@pmp_protocol`
- HN: Show HN submission with title "Show HN: PMP — open standard for AI agent memory"
- Reddit: r/LocalLLaMA, r/MachineLearning (carefully — Show & Tell flair)
- Discord: agent-dev communities (LangChain, CrewAI, Vercel AI, Mastra)
- Direct: pre-briefed partners receive launch ping for quote-tweets
- Email: 50-person ecosystem list (if Clude has one)

**Content sequencing (launch day):**
1. 09:00 UTC: site goes live, repos public, post goes up on X
2. 09:30: HN submission
3. 10:00: pre-briefed partners notified, quote-tweets land
4. 11:00: long-form blog post if not already up
5. 14:00: Discord drops in the 4 agent-dev servers
6. 17:00: end-of-day recap thread, addressing top questions
7. 09:00 UTC Day 14: morning summary, second wave

**Metrics watched:**
- Unique landing visitors (target ≥1k Day 13, ≥3k Day 14)
- GitHub stars on `spec` repo (target ≥100 Day 13)
- npm installs of `@pmp/sdk` (target ≥50 Day 14)
- Quote-tweet and reshare count (target ≥10 from accounts with >1k followers)
- HN front-page (binary)

**Acceptance:** spec is public, ≥1 ecosystem partner publicly endorses, no major spec criticisms unaddressed.

### Phase 9: Buffer / firefight (Day 14)

**Goal:** Fix whatever broke. Don't promise new things.

**Owner:** Whoever's available

Reserved entirely for launch fallout — broken links, spec ambiguities surfaced by early implementers, comms cleanup, FAQ updates.

---

## 4. Technical build plan — Weeks 3–8 (Production single-chain)

### Phase 10: Tokenisation production (Week 3)

**Goal:** Every memory write mints a cNFT. Existing memories backfilled.

**Owner:** Solana engineer

**Deliverables:**
- All Section 1–4 work from the tokenisation design lands
- Backfill worker running at ~100 mints/min, ordered by importance DESC
- Killswitch + monitoring + alerting in place

**Acceptance:** new memories tokenised within 30s of `storeMemory()`; backfill completes for the most recent 50k memories within 1 week.

### Phase 11: Selective disclosure (Week 4)

**Goal:** Pack preview endpoint with Merkle inclusion proofs.

**Owner:** Solana engineer

**Deliverables:**
- `packages/tokenization/src/pack-proofs.ts` complete
- Preview API: `GET /v1/packs/:id/preview?count=1`
- Property proofs over unrevealed leaves (count, tag distribution, author identity)
- Spec section drafted for `v0.2` covering selective disclosure formally

**Acceptance:** buyer can preview 1 of 100 memories in a Pack, verify the other 99 exist with claimed properties, without seeing content.

### Phase 12: Token-gated decryption (Week 5)

**Goal:** Pack holders can decrypt; non-holders can't.

**Owner:** Solana engineer

**Deliverables:**
- `pack-gate.ts` server-side: verify holder via Solana RPC, release decryption keys
- v1 trusts our server; documented limitation
- Threshold encryption is Week 11

**Acceptance:** transfer a Pack token; new holder can decrypt; previous holder cannot (immediately, no race).

### Phase 13: SDK + framework adapter parity (Week 6)

**Goal:** Python SDK + 3 framework adapters merged.

**Owner:** TS/Python dev

**Deliverables:**
- `sdk-python/` to TS parity
- Adapters: CrewAI, Vercel AI SDK, Mastra (in that order)
- One PR open against each framework's upstream repo

**Acceptance:** all 4 framework adapters runnable from the `examples/` directory with one command each.

### Phase 14: Provider registry v1 (Week 7)

**Goal:** Discovery across providers without us being a centralised hub.

**Owner:** Sebastien or volunteer

**Deliverables:**
- `registry/providers.json` — static file in `portablememoryprotocol/registry`
- Schema: each entry has `{name, endpoint, chain_id, verbs_supported, contact}`
- SDK `discoverAcrossProviders()` helper that fans out
- Submission process: PR your manifest, get reviewed (security + spec conformance), merged

**Acceptance:** ≥3 providers in the registry (Clude on Solana, evm-ref on Base, one third party).

### Phase 15: Production milestone (Week 8)

**Goal:** v0.1 is real, not a demo.

**Deliverables:**
- API at full spec parity with 99% uptime over the prior 30 days
- ≥1k memories tokenised via PMP-shaped writes
- ≥3 independent agents using PMP non-trivially
- ≥1 framework adapter merged upstream
- Public retro post + v0.2 RFC draft published

---

## 5. Technical build plan — Weeks 9–16 (Multi-chain + enterprise)

### Phase 16: Base production (Weeks 9–10)

**Goal:** Real Base provider, not a stub.

**Owner:** Solidity dev (extended engagement) or partner

**Deliverables:**
- Production-grade Base contracts (audited or peer-reviewed)
- ERC-6551 token-bound accounts for agent identity
- Cross-chain VERIFY in production at scale (load-tested)
- Ideally hosted by a partner (Coinbase ecosystem, a Base-native team) — proves the standard isn't just us

### Phase 17: Threshold encryption (Weeks 11–12)

**Goal:** Server can't unilaterally read Pack content.

**Owner:** Solana engineer + cryptography review

**Deliverables:**
- Lit Protocol or Nucleus integration evaluated; one chosen and integrated
- Pack content encrypted to threshold of nodes
- Key rotation per transfer

**Acceptance:** force-disconnect Clude's server, confirm token holder can still decrypt via the threshold network.

### Phase 18: zkVM ATTEST verb (Weeks 13–14)

**Goal:** First compliance attestation live.

**Owner:** Solana engineer + cryptography contractor (SP1/Risc0 specialist)

**Deliverables:**
- SP1 or Risc0 circuit for one canonical attestation: *"this memory corpus contains no SSNs"*
- Off-chain proof generator
- On-chain verifier on both Solana and Base
- `ATTEST` verb live in v0.2 spec

**Acceptance:** generate a proof for Clude's own memory corpus, verify on-chain, attach to a Pack.

### Phase 19: First paying enterprise (Weeks 15–16)

**Goal:** One enterprise customer using ATTEST in production.

**Owner:** Sebastien (sales) + Solana engineer (integration support)

**Deliverables:**
- Customer signed (compliance vertical — likely Singapore or US regulated industry)
- Integration deployed
- Case study draft
- Pricing model validated

---

## 6. Roll-out plan

### Pre-launch (Days 0–12)
- Domain + GH org claimed Day 0
- Spec frozen by Day 2
- 5 ecosystem partners pre-briefed by Day 11
- Demo recorded, post drafted, FAQ ready by Day 12

### Launch (Day 13)
- See Phase 8 above for hour-by-hour content sequencing

### Post-launch 30 days
- **Week 3:** retro post, address top spec issues raised, publish v0.1.1 if needed (additive only — no breaking changes)
- **Week 4:** publish 2 long-form posts: "Why PMP" (positioning) and "Building on PMP" (technical, walk through the LangChain example)
- **Weeks 5–8:** weekly cadence — 1 framework adapter announcement per week, 1 partner provider announcement

### Post-launch 90 days
- v0.2 RFC public for comment
- ≥3 providers in production
- First enterprise case study
- Conference talk slot booked (target: AI Engineer Summit, MCP day at Anthropic dev event, or equivalent)

### Post-launch 180 days
- Standards-body submission OR de facto standard claim
- Foundation/governance decision (BDFL → community-elected steering committee)
- ≥10 providers, ≥3 paying enterprises

---

## 7. Resource plan

| Role | FTE | Weeks engaged | Critical path? |
|---|---|---|---|
| Sebastien (founder / spec / launch) | 100% | 0–16+ | Yes |
| Solana engineer | 100% | 1–2; 50% wks 3–8 | Yes |
| Solidity contractor | 100% | Days 5–10; on-call wks 9–10 | Yes (or accept Base slip) |
| TS/Python dev | 50% | Wks 6–8 | No |
| Designer (logo + brand) | Async | Wks 1–4 | No |
| DevRel / writer | 50% | Wks 2–16 | Soft yes |
| Cryptography contractor (SP1/Risc0) | 100% | Wks 13–14 | No (deferred v0.2) |

**Bus factor:** Sebastien is the only critical-path person in the first 4 weeks. Mitigation: write enough down in `docs/pmp/` that someone else could pick up the spec/comms work if needed.

---

## 8. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Spec drift after Day 2 freeze | Med | High | Hard process: new ideas → v0.2 issue, no exceptions |
| Cross-chain attestation slips Day 9 | Med | Med | Acceptable fallback: launch Solana-only, Base in v0.2 |
| Solidity contractor unavailable | Med | High | Accept Solana-only launch by Day 5 decision |
| Competitive announcement before us | Med | High | Ship spec publicly Day 2 even if impl partial — claim namespace |
| Mem0 / openmemoryprotocol issues legal | Low | Med | We're PMP, not OpenMemory; namespace is clean |
| Adoption inertia (no providers, no SDK pickups) | High | High | 5-partner pre-brief is non-negotiable; quote-tweets land Day 13 |
| RPC cost spike during launch traffic | Low | Low | Pre-fund 1 SOL extra, cache aggressively |
| Spec implementation reveals bugs | High | Med | Conformance test suite from Day 2; CI on every PR |

---

## 9. Success metrics (targets)

**T+2 weeks (launch):**
- Spec v0.1 public, repos open
- 2 reference impls (Solana + Base stub)
- 1 working multi-chain demo agent
- ≥1k unique landing visitors Day 13–14
- ≥100 spec repo stars
- ≥3 ecosystem partner quote-tweets

**T+8 weeks (production single-chain):**
- 99% uptime on `api.portablememoryprotocol.com`
- ≥1k memories tokenised via PMP
- ≥3 third-party agents using PMP
- ≥1 framework PR merged upstream

**T+16 weeks (multi-chain + first enterprise):**
- ≥3 independent providers
- ≥1 paying enterprise on ATTEST
- v0.2 spec public
- 100+ projects discoverable via registry

**T+6 months:**
- De facto standard claimed OR standards-body submission filed
- ≥10 providers
- ≥3 paying enterprises
- Foundation/governance model published

---

## 10. Governance (v0)

- **Steward:** Sebastien (BDFL during pre-launch and v0.x)
- **License:** Apache 2.0 (spec), MIT (SDKs + reference impls)
- **Versioning:** semver. v0.x while breaking changes are OK. v1.0 when API frozen.
- **RFC process:** post-launch, additive changes via GitHub Discussions → PRs on `portablememoryprotocol/spec`
- **Trademark:** "PMP" and "Portable Memory Protocol" reserved; usage policy published with v0.1
- **Foundation:** evaluated at T+6 months; default is stay community-stewarded until adoption justifies a formal entity

---

## 11. Open questions (resolve in Week 1)

- Funding: bootstrap, grants (Solana Foundation, Base ecosystem fund), or stay independent? Default: independent until T+8w.
- Trademark filing for "PMP / Portable Memory Protocol"? Default: file in Singapore (Sebastien's jurisdiction) within 30 days of launch.
- Should AMP / OpenMemory / x402 communities get co-announcement coordination? Probably yes — soft outreach, no formal coordination.
- Conference target for v0.2 launch? Likely AI Engineer Summit or Solana Breakpoint.

---

## Appendix: Cross-references

- Strategic v0 roadmap: `docs/pmp/roadmap-v0-strategic.md` (archived, OpenMemory naming)
- Tokenisation design (sections 1–4): in-session, pending formalisation as `docs/pmp/reference-solana-design.md`
- Spec v0.1: to be drafted as `docs/pmp/spec-v0.1.md`
- Conformance test suite: to be created at `portablememoryprotocol/spec/conformance/`
