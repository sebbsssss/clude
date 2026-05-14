# X article: PMP launch

Three artifacts in this doc, in increasing length:

1. **Hook tweet** — single post to test resonance before committing the full essay
2. **Full X Article** — long-form essay (~1,500 words), the main artifact
3. **Thread version** — 14 tweets, for if you'd rather seed the audience in a thread than an article

Choose based on your read of the audience that morning. Article = depth, signals seriousness. Thread = velocity, easier to amplify. Hook = de-risk; if it lands, commit to the longer form.

---

## 1. Hook tweet (test reach first)

> Anthropic owns MCP.
> Google owns A2A.
> Coinbase owns x402.
>
> There's one layer of the agent stack still open.
> I'm shipping it in 14 days.

That's the whole hook. Don't add a thread to this one — let it earn replies and quote-tweets first. Reply to the strong replies with the longer thread or the article link.

---

## 2. Full X Article

**Title:** I'm shipping the memory layer of the agent stack in 14 days.

---

The agent protocol stack has been settling fast.

Anthropic shipped MCP in late 2024. Google shipped A2A in 2025. Coinbase shipped x402 the same year. Each became the default standard for its layer of the stack — context, communication, payments. Each is owned by a single trillion-dollar (or near-trillion) vendor.

There's one layer missing. Memory.

If you've built with agents in production, you know this gap. Every framework rolls its own memory — Letta, Mem0, Zep, LangGraph, OpenAI's, our own. None of them interop. Your agent's memory is locked in whoever you happened to pick, and the second you switch tools or models or chains, that memory is gone. You don't own it. You can't take it with you. You can't sell it. You can't even verify the agent actually remembered what it claims.

That's the gap we're closing.

We're calling it **PMP — Portable Memory Protocol**. Same family as MCP. Same shape. Same pattern. But for memory instead of context. And because memory is the one layer where the data is the user's — not the model's — PMP has to be open. No single vendor should own it.

This isn't theoretical. We've been building the reference implementation for 18 months.

### What's already real

Clude (the company) makes agent memory infrastructure. We hit **80.4% on LongMemEval-S** — the public benchmark for long-term memory in agents.

That's higher than the *oracle ceiling* (76.4%) and ~50 percentage points higher than Cognee (30.6%) in a head-to-head we ran last month.

Above-oracle isn't a typo. It means our retrieval surfaces better evidence than perfect-recall + a base LLM. The architecture is 5-tier typed memory (episodic, semantic, procedural, self-model, introspective), with hybrid retrieval combining vector similarity, keyword scoring, entity-graph traversal, and Stanford-Generative-Agents-style dream cycles.

The numbers work. The system works. What's been missing is the *protocol* — the open wire format that lets any agent talk to any provider without lock-in.

So we're shipping it.

### Four verbs

PMP is intentionally small. Four HTTP verbs:

- **DISCOVER** — find memories matching a query, across one or many providers
- **RETRIEVE** — fetch a memory, possibly token- or payment-gated (composes with x402)
- **VERIFY** — prove a memory is real, authored, timestamped, unchanged
- **CONTRIBUTE** — write a new memory, get an on-chain receipt

That's v0.1. v0.2 adds ATTEST (zero-knowledge proofs over memory corpora — the compliance vertical) and SUBSCRIBE (push when new memories match a standing query).

Everything else — payment, encryption, gating, chain choice — is provider-defined behind these verbs. Same way x402 doesn't dictate the payment chain. The protocol dictates the handshake.

### Three layers, no bridges

We make agent memory portable, verifiable, and chain-neutral.

Each memory becomes a compressed NFT on Solana via Light Protocol — costs ~$0.0001 per mint. The cNFT is soulbound (you can't sell individual memories — that has privacy pathologies), but its metadata commits to a content hash. The actual content stays encrypted in the provider's database. The on-chain side is proof. The off-chain side is data. Both reference each other.

Memory Packs — curated bundles of memories — become regular transferable NFTs. The Pack token's metadata commits to a Merkle root over its constituent memories. If you own the Pack token, you can decrypt the content. If you want to preview before buying, the server reveals one entry with a Merkle inclusion proof showing the others exist with claimed properties (count, tags, author) without revealing them.

That's where ZK actually earns its keep. Not flashy. Useful.

On the EVM side: ERC-721 (soulbound) for memories, ERC-1155 for Packs. Cross-chain VERIFY works because both sides commit to the same content-hash format. A memory minted on Solana is verifiable from a Base contract without a bridge — just signed Merkle proofs.

### The 14 days

I'm two weeks from launching this publicly. Here's the cadence:

- **Days 1–2:** spec frozen. Public on GitHub.
- **Days 3–4:** all four verbs live on Solana. Clude is the reference provider.
- **Day 5:** TypeScript SDK + LangChain adapter on npm.
- **Days 5–10:** Base EVM contracts deployed to Sepolia.
- **Day 9:** cross-chain VERIFY in production.
- **Days 11–12:** demo agent recorded, post drafted, ecosystem partners pre-briefed.
- **Day 13:** public launch.
- **Day 14:** buffer / firefight.

This is fast because most of the work isn't *new building* — it's wrapping what already exists in a clean wire format and pre-briefing the people who matter.

### Why this matters

There's a phrase that gets thrown around — *the agent economy*. I'll tell you what it actually means once memory is portable.

Memory providers earn on writes and reads. Pack publishers sell curated bundles peer-to-peer. ("The Solana DeFi expert pack — 10,000 memories from 50 traders, verified provenance, $99.") Agent builders plug in once and get multi-chain memory plus verifiability for free. Enterprises pay for ATTEST — six-figure ACVs for compliance attestations like *"this AI never trained on PII field X."*

Solana and Base get a real, non-financial use case. Verifiable cognition at scale. Not another collectible.

And the protocol owns no token by default. The reference implementer earns by being the best implementation. Same model as the Linux Foundation: standards stewards capture asymmetric value through expertise and trust, not rent.

### Who I'm looking for

If you're building an agent, PMP gives you memory that works across providers, chains, and frameworks. The SDK ships May 25.

If you maintain a framework — LangChain, CrewAI, Vercel AI, Mastra — DM me before launch. I want your adapter merged upstream in week 3, and I want your input on the spec before it freezes.

If you're working on agent memory at one of the labs — let's coordinate. I'd rather have MCP and PMP land as siblings than competitors.

If you're an enterprise wrestling with AI compliance — ATTEST is for you. We'll be ready for first customers at week 16.

### What you can do today

Three things.

1. **Watch May 25.** Follow the launch. The spec goes live at 09:00 UTC.
2. **If you build agents, tell me what's missing from your current memory stack.** I want v0.1 shaped by what you hit when you try to build — not by what I think the answer is.
3. **If you have a stake in MCP, A2A, or x402 — share this.** The agent stack is filling in, and the memory layer should be open. Help me make sure it is.

The window for "the open standard for agent memory" is open right now. By EOY 2026 it'll be closed — either by us, or by whoever ships first.

I'd rather it be open.

Let's go.

---

## 3. Thread version (14 tweets)

If you'd rather seed in thread form, here it is. Each tweet hand-tuned for the X reading rhythm.

**1/**
Anthropic owns MCP.
Google owns A2A.
Coinbase owns x402.

There's one layer of the agent stack still open.

I'm shipping it in 14 days.

**2/**
If you've built agents in production you know the gap.

Every framework rolls its own memory. Letta. Mem0. Zep. LangGraph. OpenAI's. Ours.

None of them interop. Your agent's memory is locked in whoever you happened to pick.

The second you switch tools, it's gone.

**3/**
That's the gap we're closing.

It's called PMP — Portable Memory Protocol.

Same family as MCP. Same shape. Same pattern. For memory instead of context.

Memory is the one layer where the data is the *user's*, not the model's. It has to be open. No vendor should own it.

**4/**
This isn't theoretical.

We've been building the reference implementation for 18 months.

LongMemEval-S — the public benchmark for long-term memory in agents:

→ Clude: 80.4%
→ Oracle ceiling: 76.4%
→ Cognee: 30.6%

Above oracle isn't a typo.

**5/**
PMP is small. Four verbs.

DISCOVER — find memories
RETRIEVE — fetch (composes with x402)
VERIFY — prove provenance
CONTRIBUTE — write a memory

v0.2 adds ATTEST (ZK compliance proofs) and SUBSCRIBE (push on match).

Everything else is provider-defined.

**6/**
Architecture: portable, verifiable, chain-neutral.

Each memory → compressed NFT on Solana (~$0.0001/mint, Light Protocol).

Soulbound. Author-bonded. Not for sale.

The cNFT is proof; the content stays encrypted off-chain.

**7/**
Memory Packs — curated bundles — become transferable NFTs.

Pack token commits to a Merkle root over its memories.

Hold the token → decrypt the content.

Want to preview before buying? Server reveals one memory + a ZK proof the others exist with claimed properties.

**8/**
That's where ZK actually earns its keep.

Not flashy. Useful.

Cross-chain VERIFY works because Solana cNFTs and Base ERC-721s commit to the same content-hash format.

No bridge. Just signed Merkle proofs.

**9/**
The 14 days:

D1–2: Spec frozen, public on GitHub.
D3–4: 4 verbs live on Solana.
D5: TS SDK + LangChain adapter on npm.
D5–10: Base contracts deployed.
D9: Cross-chain VERIFY in production.
D13: Public launch.
D14: Buffer.

**10/**
This is fast because most of the work isn't *new building*.

It's wrapping what already exists in a clean wire format.

The reference impl already beats every public competitor on the benchmark. We just need the protocol.

**11/**
What "the agent economy" actually means once memory is portable:

— Memory providers earn on writes + reads.
— Pack publishers sell curated bundles peer-to-peer.
— Agent builders plug in once, get multi-chain memory free.
— Enterprises pay six figures for ATTEST.

**12/**
The protocol owns no token by default.

The reference implementer earns by being the best implementation.

Same model as Linux Foundation. Standards stewards capture asymmetric value through expertise + trust, not rent.

**13/**
What to do today:

→ Watch May 25. Spec goes live 09:00 UTC.
→ Build agents? Tell me what's missing from your memory stack.
→ Stake in MCP / A2A / x402? Share this.

The agent stack is filling in. The memory layer should be open.

**14/**
The window for "the open standard for agent memory" is open right now.

By EOY 2026 it'll be closed — either by us, or by whoever ships first.

I'd rather it be open.

Let's go.

[link to pmp.dev / GitHub on launch day]

---

## Production notes

- **Pin the hook tweet** an hour before the full essay/thread drops. Gives the algorithm time to surface it before the deeper content hits.
- **Don't lead with the article.** Lead with the hook, watch 2–3 hours of reply quality, then ship the article in reply to your own hook ("the full essay is here →"). Both posts get amplified.
- **Schedule the launch tweet at 09:00 UTC May 25** to align with the spec going live. Builds the moment.
- **Tag carefully.** Don't @-spam framework maintainers in the body — DM them privately the day before. The mention should be invited.
- **Numbers in the body, not headers.** "80.4%" in flowing prose hits harder than a bolded stat block. Headers feel slide-y on X.
- **Reply game matters more than the original post.** The first 30 min of replies is where the conversation forms. Be there, be specific, be human.
