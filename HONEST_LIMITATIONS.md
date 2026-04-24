# Honest Limitations

> Where Clude underperforms, gets things wrong, or makes tradeoffs. We disclose these because hiding them would make the rest of our claims harder to trust.

## Latency

Graph traversal + dream cycle add latency vs. pure embedding RAG.

[FILL ON DAY 7 — measure p50/p95 of Clude.recall vs mem0.search vs Zep.search via `scripts/benchmark/latency-measure.ts`]

Expected directional finding: Clude is ~2-5× slower per query than pure embedding RAG, faster than agentic memory systems (Letta) due to single-shot recall, and comparable to graph systems (Cognee).

## Setup Complexity

Compared to `pip install mem0ai` and a single API call, Clude requires:
- A Supabase project (free tier works) with `pgvector` extension
- An Anthropic API key
- A Solana wallet (provisioned automatically via Privy on first sign-in for the consumer flow; manual for SDK use)
- (Optional) A Voyage AI or OpenAI key for embeddings

This is the cost of owner-scoping + verifiability. Documented onboarding is in [README.md](./README.md). We expect to lower this friction post-hackathon with a hosted offering.

## Devnet-Only Deployment

Real `$CLUDE` is a mainnet SPL token and cannot be deployed/used on devnet. For this submission:

- Mock SPL token labeled `$CLUDE-devnet` is minted on Solana devnet
- Mint address: [FILL ON DAY 4 — set during Task 4.2]
- Same 9-decimal structure as mainnet $CLUDE
- All economic flows in the demo use this devnet token

**Mainnet migration path:** replace mint address constant in `programs/memory-registry/src/state.rs`, redeploy the Anchor program to mainnet-beta, bridge or migrate the treasury PDA. Economic constants (write fee 0.001, citation royalty 0.0001) unchanged.

## Royalty Split Deviation from Spec

Spec [§5.3](./docs/superpowers/specs/2026-04-17-clude-hackathon-design.md) calls for 50/50 author/treasury royalty split on citations. **Submission ships 100% to author** as the hackathon MVP, because:
1. Single token transfer is simpler to test and demo
2. Video narration is consistent with 100%-to-author flow
3. Treasury payouts require additional CPI plumbing that didn't fit 10 days

**Migration:** add a second `token::transfer` for 50% to treasury ATA in `cite_memory.rs`. ~30 minutes of work post-hackathon.

## Test-Time Learning Competency Omitted

MemoryAgentBench has 4 competencies; we ran 3 (AR, LRU, CR). TTL was omitted to fit the 10-day timeline. Clude's TTL behavior is not yet measured against competitors. Roadmap item.

## Research-Grade Features

The following features are working but research-grade, not production-hardened:
- **Dream cycle** — runs on-demand, no backpressure / scheduling guarantees yet
- **Contradiction resolution** — depends on LLM judgment quality; can occasionally pick the wrong side
- **Entity coreference** — LLM-based, fails gracefully but isn't perfect for ambiguous cases
- **Temporal extraction** — Venice llama-3b accuracy on `event_date` is good but not 100%

These are working features that benefit our scores; we're flagging that they're not bulletproof.

## What We Did Not Build in 10 Days

Items deferred to post-hackathon:
- Slashing / validator staking (anti-Sybil for the protocol)
- Governance / DAO for pool parameters
- Full state compression for memory PDAs (we use one PDA per memory; works but not optimal at scale)
- Mainnet deployment
- Production tokenomics for $CLUDE
- A fully decentralized memory marketplace

## Sample Size Caveat (Consumer Side-by-Side)

The consumer side-by-side test is **n=10 hand-scripted journeys**. Labeled illustrative, not statistically rigorous. The MemoryAgentBench results carry the rigor.
