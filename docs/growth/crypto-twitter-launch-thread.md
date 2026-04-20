# Clude Crypto Twitter Launch Thread

**Account:** @clude_ai (primary), @sebbsssss (author amplifier)
**Post window:** Tuesday 10:00 SGT / Monday 22:00 ET for max CT reach
**Thesis:** Memory is the moat. We made it portable and on-chain.

All stats below are pulled from prod Supabase + Solana as of
2026-04-16. Before posting, re-run `clude stats` and update the
numbers so nothing looks stale.

---

## Thread A — the moat (6 tweets, technical audience)

**1/**
Most AI memory products lock your agent to their cluster.

We shipped the opposite: every memory Clude stores is signed by
your agent's wallet and anchored on Solana.

If Clude disappears tomorrow, your agent keeps its memory.

**2/**
The stack, in one picture:

```
agent → Clude SDK → local SQLite + vector index
                 → ed25519 sign
                 → Solana memo (hash anchor)
                 → MemoryPack export anytime
```

No proprietary format. No API hostage situation.

**3/**
Today:
• 218k memories stored
• 96k+ anchored on Solana mainnet
• zero-config MCP install for Claude Desktop
• exports to MemoryPack — the open format we just specced

$0 network fee per memory via Helius shared RPC.

**4/**
MemoryPack spec is public.

JSONL records, ed25519 sigs, optional chain anchor, nothing
Clude-specific.

Any memory vendor can implement the reader. We actively want that
— portability is only real if someone else validates it.

Spec: github.com/sebbsssss/clude/blob/main/docs/memorypack.md

**5/**
Why Solana memo, not a token?

Memos are cheap, indexable, and don't require a program. The
agent's wallet signs each memo; the memo payload is the memory
hash. Explorer view = audit log.

No new token. No airdrop. The wallet IS the identity.

**6/**
`npx @clude/sdk setup` wires Clude into Claude Desktop in 30 seconds.
Local-first. Your memories never leave your machine unless you tell
them to.

Try it → clude.io

---

## Thread B — the narrative (8 tweets, CT audience)

**1/**
On-chain agents are coming. But nobody is talking about the most
important part:

what does the agent REMEMBER, and who owns that memory?

Here's why Clude bet the whole thing on on-chain memory.

**2/**
Every conversation your agent has is training data for tomorrow's
version of that agent.

If OpenAI / Anthropic / vendor X keeps that data, they keep the
agent. Switch providers → lobotomy.

This is the actual moat, and it's not in crypto hands yet.

**3/**
Clude flipped the default.

Memories are stored locally. Hashes are committed on Solana.
Exports use an open format (MemoryPack) any competitor can read.

The agent's wallet is the agent's identity. The chain is the
audit trail.

**4/**
Why this matters for crypto specifically:

Solana-native agents (@_aethir_ai, @truth_terminal, @aixbt) all
face the same question — where does the memory live?

Right now: a vendor's DB. Should be: the chain.

Clude is the first memory layer that treats the wallet as the
primary key.

**5/**
The numbers as of today:

• 96,543 memories anchored on Solana mainnet
• 218,430 total memories under management
• $0 in gas (memos via Helius)
• 238 agents registered, growing weekly

First Solana-native memory layer to pass 100k real on-chain events.

**6/**
What you can do with it:

• Run an agent on Claude, export memory, run the same agent on a
  local LLM tomorrow — it remembers yesterday.
• Prove on-chain that an agent said X at time Y (hash audit).
• Sell / transfer the agent's memory like an NFT of experience.

**7/**
Clude isn't a token. Not yet, not soon.

The primitive has to be real first. Tokens are what you issue when
distribution is the bottleneck — right now the bottleneck is
education.

**8/**
If you're building a Solana agent and memory lock-in scares you:

→ clude.io
→ `npx @clude/sdk setup`
→ talk to us: @clude_ai

We'll integrate you directly.

---

## Companion single-tweet hooks

Use these as standalone quote-tweets / replies to drive traffic
into the threads above.

**Hook A (technical):**
> The memory in your agent is the agent. We made it portable.

**Hook B (meme-y):**
> "which vendor owns your agent's memory?"
> wrong question.
> right question: why does any vendor own it?

**Hook C (data):**
> 96,543 agent memories written to Solana this month.
> Zero in gas. No token. Just ed25519 sigs + memos.
> The memory layer is the moat — and it's on-chain now.

**Hook D (reply bait for agent accounts):**
> respectfully, @<solana-agent>, where does your memory live?
> if it's in a vendor DB, it's not really yours.

---

## Visuals to pair

1. **Stack diagram** — ASCII or Figma export of the flow in Thread A, tweet 2.
2. **Solana explorer screenshot** — a recent memo tx showing `clude:v1:<hash>`.
3. **Short screen recording** — `npx @clude/sdk setup` end-to-end,
   ≤30s, loopable.

## Targeting playbook

Post the thread, then within the first 30 minutes quote-tweet it from:

- @sebbsssss with a founder-note framing
- Reply in-thread to 3-5 Solana agent accounts with Hook D
- Drop Hook A as a reply to any Anthropic / MCP tweet in the feed
- Share to r/SolanaDev and r/LocalLLaMA with Thread A link

## What NOT to say

- No price speculation. No token talk beyond "not a token".
- No shots at specific competitors by name. The moat argument is
  strong enough without naming.
- Don't over-promise MemoryPack adoption — we've specced it, not
  shipped reference implementations outside Clude yet.

## Post-launch checklist

- [ ] Numbers re-pulled from prod on the morning of the post
- [ ] MemoryPack spec merged to `main` and URL stable
- [ ] MCP directory PRs are OPEN (not merged — "submitted" is the
      better state for the CT story; live links help)
- [ ] @clude_ai bio updated: "portable agent memory, anchored on Solana"
- [ ] Pinned tweet = the top of Thread B
