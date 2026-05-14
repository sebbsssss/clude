# PMP — Investor Brief

*Portable Memory Protocol. The open standard for AI agent memory.*

**Sebastien Sim · 2026-05-13**

---

## The one line

Every agent protocol so far has been claimed by a single corporate vendor. MCP by Anthropic. A2A by Google. x402 by Coinbase. **The memory layer is still open** — and we're 14 days from shipping the spec.

---

## What's missing in the agent stack

The agent protocol stack is settling fast. In 18 months we've gone from no shared primitives to four:

| Layer | Standard | Owner | Shipped |
|---|---|---|---|
| Context | MCP | Anthropic | Nov 2024 |
| Communication | A2A | Google | 2025 |
| Payments | x402 | Coinbase | Q1 2025 |
| **Memory** | **PMP** | **Open / community** | **2026-05-25** |

Three of those four are owned by a single trillion-dollar (or near-trillion) company. The fourth — memory — is up for grabs. Memory is also the one layer where vendor lock-in is most painful, because the data is the *user's*, not the model's.

Every agent framework today rolls its own memory (Letta, Mem0, Zep, LangGraph, OpenAI memory, our own Clude) and none of them interop. **An AI agent's memory is locked in a silo. It can't be ported. It can't be verified. It can't be sold.** That's the gap PMP closes.

*[VISUAL: agent stack diagram — three vendor logos on the upper layers, open icon on the memory layer]*

---

## Why now

Three things flipped in the last 12 months that make this the moment:

**1. The protocol pattern works.** MCP went from announcement to thousands of integrations in 6 months. x402 did similar in 4. Agent developers are starving for shared primitives and adopt them on day one. We have a template.

**2. Compressed NFTs made memory tokenisation economical.** Light Protocol's compressed accounts on Solana cost ~$0.0001 per mint. A year ago, putting one token per memory on-chain was prohibitive. Today it's a rounding error. The economics flipped.

**3. Compliance is the killer app.** The EU AI Act takes effect 2026. SEC, FCA, MAS are circling generative AI. Every regulated enterprise deploying agents needs to *prove* what their AI saw, deleted, attested to. Verifiable memory isn't a nice-to-have — it's a procurement requirement.

Memory is the layer at the intersection of all three trends.

---

## The insight

The companies racing to define agent infrastructure are model labs and frameworks. They think memory is a feature of their product.

It's not. **Memory is infrastructure.** It's the substrate that *belongs to the user*, not the model. Once you see that, the protocol is obvious — and so is the moat. Whoever owns the standard for portable, verifiable agent memory owns the foundation of the next generation of AI products. Not because they're the only implementer, but because they're the reference.

That's why MCP wins for Anthropic even though anyone can build an MCP server. It's also why PMP wins for us even though anyone can build a memory provider — because *somebody* has to define it, and we're the only team specifically focused on agent memory with a working product already in market.

---

## What we're building

Four verbs. Open spec. Reference implementation already 80% done.

| Verb | What it does |
|---|---|
| **DISCOVER** | Find memories matching a query across any compliant provider |
| **RETRIEVE** | Fetch memory content. Composes natively with x402 for pay-per-recall |
| **VERIFY** | Prove a memory is real, authored, timestamped, unchanged |
| **CONTRIBUTE** | Write a memory, get an on-chain receipt |

That's v0.1. v0.2 adds **ATTEST** (zero-knowledge compliance proofs) and **SUBSCRIBE** (push on match).

The architecture is three layers. Content stays off-chain in provider databases (fast, private, encrypted). On-chain commitments (one compressed NFT per memory, Merkle-rooted token per Pack) prove the rest. ZK proofs handle selective disclosure and compliance attestations. No bridge required for cross-chain — Solana memories are verifiable from Base via signed Merkle proofs.

*[VISUAL: 3-layer diagram — Asset (cNFT + Pack token), Commitment (hash + Merkle), Proof (ZK selective disclosure)]*

---

## We're not starting from zero

Clude — the company building the reference implementation of PMP — already ships the best agent memory system on the public benchmarks.

**LongMemEval-S (the public benchmark for long-term memory in agents):**

| System | Score |
|---|---|
| **Clude** | **80.4%** |
| Cognee | 30.6% |
| Reference baseline (Mem0/Zep range) | ~50–60% |
| Theoretical oracle ceiling | 76.4% |

We're **above the oracle ceiling** on the public benchmark. That's not a typo — it means our retrieval is more effective than perfect-recall + a base LLM, because we score better evidence than the oracle would surface. (The detailed methodology is in `MEMORY.md`.)

**What's already in production:**
- 5-tier typed memory architecture: episodic, semantic, procedural, self_model, introspective
- Hybrid retrieval: vector + keyword + tag + entity-graph traversal
- Stanford Generative Agents-inspired dream cycles (consolidation, reflection, contradiction resolution)
- Solana on-chain memory commitments (already live, ~hundreds of thousands of memories committed)
- Brain Wiki: visual memory explorer
- Memory Packs: composable, installable memory bundles with auto-categorisation
- Dashboard + API at scale, deployed on Railway

We don't have to invent the impl. We have to ship the spec around the impl that already exists and works better than the competition.

---

## The 14-day wedge

The compressed launch plan: spec public, two reference implementations, demo agent, ecosystem partners pre-briefed.

| Day | Output |
|---|---|
| 0 | Decisions locked: domain, GH org, engineer + Solidity contractor allocated |
| 1–2 | Spec v0.1 frozen, public on GitHub |
| 3–4 | All 4 verbs live on `api.pmp.dev` (Solana, backed by Clude) |
| 5 | TypeScript SDK published, LangChain adapter working |
| 5–10 | Base EVM contracts deployed to Base Sepolia |
| 8–9 | Cross-chain VERIFY: same endpoint returns the same shape whether asset is on Solana or Base |
| 11–12 | Demo agent recorded, post drafted, 5 ecosystem partners pre-briefed (Anthropic, Coinbase, framework maintainers) |
| 13 | **Public launch:** spec, repos, post, HN, X |
| 14 | Buffer for fallout |

This is fast because most of the work is the *spec* and the *positioning*. The reference implementation already exists.

---

## The 16-week path to revenue

| Phase | Weeks | Milestone |
|---|---|---|
| **Launch** | 0–2 | Spec public, Solana + Base reference impls, demo agent |
| **Production single-chain** | 3–8 | Full Solana tokenisation, selective disclosure proofs, token-gated decryption, 3+ framework SDK adapters merged upstream, provider registry v1 |
| **Multi-chain + first enterprise** | 9–16 | Base in production with a partner provider, threshold encryption, **zkVM compliance attestations live (ATTEST verb)**, first paying enterprise customer |

**The enterprise hook is ATTEST.** Compliance teams will pay to prove things like "this AI has never been trained on PII field X", "all of user Y's data was purged by date Z", "this model only accessed memories scoped to its authorization." Today that's a manual audit. With PMP and zkVM circuits, it's a cryptographic proof anyone can verify.

We expect the first enterprise customer at Week 16. We expect the price tag to be high — these are six-figure ACVs for verifiable compliance attestations.

---

## How PMP unlocks the intelligence economy

The phrase "agent economy" gets thrown around. Here's what it actually means once memory is portable:

- **Memory providers** (us, future competitors) earn on writes + reads. Per-CONTRIBUTE micro-fees via x402. Subscription tiers for high-volume agents.
- **Pack publishers** sell curated memory bundles peer-to-peer. *"The Solana DeFi expert pack — 10,000 memories from 50 traders, verified provenance, $99."* Pack tokens are transferable; secondary markets emerge naturally.
- **Agent builders** plug in once, get multi-chain memory + verifiability for free. Lower switching costs. Better products.
- **Enterprises** pay for ATTEST (compliance attestations) — six-figure ACVs, software-margins.
- **Solana + Base** get a real, non-financial use case that demands their chains. cNFTs at scale. Verifier programs.
- **The protocol** owns no token by default. We earn through Clude being the best implementation. Same model as Linux Foundation: standards stewards capture asymmetric value through expertise + trust, not rent.

*[VISUAL: economy diagram — memory providers earning fees, Pack publishers earning royalties, enterprises paying for ATTEST, all settled via x402]*

---

## Moat

Three layers of moat compound:

**1. Standard moat.** First-mover for the spec means we set the wire format, the JSON schemas, the error semantics. Every later implementer has to be compatible with us. That's not a defensive moat; it's an *attractive* moat — partners come to us because we're the canonical source.

**2. Implementation moat.** Clude is two years ahead on the memory algorithm. LongMemEval 80.4% is not a number competitors can match by reading our spec. They need the dream-cycle, the typed-tier scoring, the hybrid retrieval — and those take a year of research to replicate. The spec is the on-ramp; the implementation is the destination.

**3. Network effect.** Once 3+ agents use PMP, the 4th has no choice. Once 10 enterprises buy ATTEST attestations, the 11th gets pulled in by procurement. Every Pack published is content that lives in our ecosystem, not a competitor's.

The competitive landscape: Mem0 sunset their OpenMemory product. Letta is API-locked. Zep is a single-vendor product. LangGraph memory is framework-locked. None of them are positioning as the *standard*. We are.

---

## Risks (the ones that matter)

- **A trillion-dollar lab ships a competing memory protocol.** Anthropic, OpenAI, or Google could declare *their* memory format the standard. Mitigation: we ship in 14 days. Once the spec is live with ecosystem partners on board, displacing it is hard.
- **Adoption inertia.** Standards die from indifference. Mitigation: pre-launch outreach to 5 partners is non-negotiable; first 30 days post-launch is full-court press on framework adapters.
- **Crypto integration friction.** Some enterprises don't want any blockchain dependency. Mitigation: the spec is chain-neutral. We have a `chain_id: "none"` path for purely off-chain providers with traditional signed attestations.
- **Regulatory uncertainty around tokenised data.** Mitigation: we're putting *hashes* on-chain, not content. The legal posture is "we're publishing cryptographic receipts" — no different from a notary timestamp.

---

## Team

**Sebastien Sim.** Building Clude for 18 months. Two years of agent memory research before that. Submitted to Colosseum (Solana's hackathon program). Singapore-based. Solo founder so far; the company has a working bot, working SDK, working dashboard, working benchmarks. The reference implementation PMP needs already exists because I've already built it.

Hiring against the plan: one Solana engineer (allocated), one Solidity contractor (12-week engagement), one DevRel/writer (50% allocation post-launch), one cryptography contractor for zkVM phase (Weeks 13–14).

---

## The shape of this round

Not formally raising yet. The goal of this conversation is to find investors who:

1. **Get the protocol pattern.** You've seen MCP and x402 in the wild and you understand why owning a category-defining open standard is a generational outcome.
2. **Have Solana + AI + crypto-infrastructure thesis overlap.** This sits at the intersection.
3. **Can move in days, not months.** The 14-day launch window doesn't wait for diligence to slow it down.

What I'm looking for in the first 30 days:
- 2–3 ecosystem-validation investors who can intro to partners (Anthropic, Coinbase, framework maintainers)
- Cheque size $250k–1M each
- $1–3M seed to fund 12–18 months of building toward the enterprise revenue milestone
- One strategic from Solana or Base ecosystem fund for distribution

---

## The ask, plainly

If you've read this far, here's what I want from you:

1. **A 30-minute call** in the next 7 days. Not a pitch — a working session on the spec and the launch.
2. **One intro** to someone in the MCP, x402, or agent framework ecosystem who'd quote-tweet our launch.
3. **A decision in principle** within 14 days. Either you're in, or you're out, but I need to know which.

We're shipping on May 25 either way. The question is whether you're shipping with us.

---

## Appendix: what we already shipped

- Clude memory system v2.5 in production
- LongMemEval-S 80.4% (above oracle ceiling)
- 5-tier typed memory architecture
- Dream cycles (5 phases including contradiction resolution)
- Solana on-chain memory commitments (`memory_registry` PDA)
- Memory Packs system with auto-categorisation
- Brain Wiki dashboard
- TypeScript SDK and MCP server
- Chat + Dashboard web apps
- Flutter mobile app
- Express API on Railway

The PMP spec doesn't require us to build anything *new*. It requires us to wrap what already exists in a clean wire format and let the world plug in.

---

*Contact: sebastien@clude.io · clude.io · [GitHub TBA — `portablememoryprotocol/spec`]*
