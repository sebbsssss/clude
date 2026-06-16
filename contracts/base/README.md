# PMP cross-chain — EVM (Base) side

The EVM half of the Portable Memory Protocol's chain-neutral commitment layer. A memory's
canonical `memory-hash-v1` fingerprint (a 32-byte SHA-256, the same one anchored on Solana)
is committed to, and verified against, the `MemoryCommitment` contract. One fingerprint,
verifiable on Solana and on Base. No bridge, same wire format both ways.

## What's here

| File | Purpose |
|---|---|
| `MemoryCommitment.sol` | Minimal commitment registry: `commit(bytes32)`, `isCommitted`, `committedAt`. Idempotent, first-commit-wins timestamp, no backdating. |
| `compile.mjs` | Compile the contract with solc → `out/MemoryCommitment.json` (ABI + bytecode). |
| `evm-commitment.mjs` | viem client: `deployCommitment` / `commitFingerprint` / `verifyFingerprint`. Chain-agnostic (pass chain + RPC + key). |
| `e2e-cross-chain.mjs` | Local proof: takes a fingerprint already live on Solana, anchors + verifies it on a local anvil EVM through the same code path. |
| `deploy-base-sepolia.mjs` | Deploy to Base Sepolia + anchor a real fingerprint. Needs `.deployer.env` funded. |

## Status

✅ Contract compiles (523 bytes).
✅ **Cross-chain round-trip proven locally** — `node e2e-cross-chain.mjs` takes the live Solana
fingerprint of `clude-11db4f18` and anchors + verifies it on EVM, with a negative control. The
EVM path is therefore real and tested; it is not yet deployed to a public testnet.

## Run the proof

```bash
cd contracts/base
npm install
node compile.mjs          # → out/MemoryCommitment.json
node e2e-cross-chain.mjs   # spins up local anvil, proves the round-trip
```

## Go live on Base Sepolia (one step pending: a funded wallet)

The deployer keypair is generated and gitignored (`.deployer.env`). Fund its address with
Base Sepolia testnet ETH from a faucet (Coinbase CDP / Alchemy / QuickNode), then:

```bash
node deploy-base-sepolia.mjs
```

That deploys the contract, anchors a real fingerprint on Base, prints the Basescan links, and
writes `deployed.json`. After that, the live VERIFY route can dispatch by chain_id: recompute the
fingerprint, check Solana OR Base, return the same response shape.

## Why minimal

v0.1 anchors a fingerprint (the proof), not a full ERC-721/1155 token — exactly mirroring the
Solana memo/registry path. The tokenized-asset wrapper (transferable memory NFTs, packs) is the
v0.2 layer; the commitment + verification primitive is what makes the protocol cross-chain today.
