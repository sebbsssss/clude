# Clude Base contracts

`CludePackTitle` — the 1-of-1 transferable on-chain ownership of a Clude memory pack, on Base.

## What it is
An ERC-721 where `ownerOf(tokenId)` is the single source of truth for "who owns this pack"
(no balance checks anywhere, so the double-spend is structurally impossible). Each token binds
the pack's `.pmp` content commitment (Merkle root + manifest hash) on-chain, so ownership and
verifiable content are one asset.

Full design + the adversarial (staff-eng + counsel) review:
`docs/superpowers/specs/2026-06-21-base-pack-titles-design.md`.

Decisions baked in:
- **Immutable** (no proxy/upgrade) — max trust for a money contract; policy changes ship as a v2.
- **No resale royalty** (ERC-2981 omitted) — removes the Howey "profit on resale" factor. A flat
  `$CLUDE` service fee is charged off-chain on the Solana rail, never as a % cut here.
- **No operator god-transfer** — there is no role that can move someone else's title. Transfers
  require the owner's key (custodial = Clude signs as the custodial owner via the user's embedded
  wallet; non-custodial = user signs).

## Setup
Dependencies are gitignored (Foundry convention); restore them with:
```
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git
forge install foundry-rs/forge-std --no-git
```

## Test
```
forge test
```
12 tests cover: single-owner transfer, the 1-of-1 supply guard (duplicate mint reverts),
minter-only mint, owner-only transfer (no operator move), pause-blocks-mint-not-transfer,
degenerate-binding rejection, and the content commitment.

## Spike (end-to-end, in-memory, no key/network)
```
forge script script/Spike.s.sol -vvv
```
Deploys, mints a title to a buyer, reads `ownerOf` + the content binding, resells via transfer,
then proves the supply guard.

## Deploy to Base Sepolia
The deployer key lives in `contracts/base/.deployer.env` (gitignored; only the address is shared).
```
set -a; . ./.deployer.env; set +a            # DEPLOYER_PRIVATE_KEY
export TITLE_ADMIN=0x...                      # a multisig on mainnet
export TITLE_MINTER=0x...                     # the Clude server signer
export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
```

## Next (off-chain integration)
- `EvmMintClient` (viem) in the server: `mintTitle` / `transferTitle` / `fetchTitleOwner` / `getBinding`.
- The title purchase/transfer saga: re-wrap the pack DEK to the buyer -> capture payment ->
  on-chain transfer LAST -> revoke the seller. Per the design §00 corrections this needs a
  `memory_dek_wraps` schema change to allow a buyer recipient (RT2), its own orchestrator (RT1),
  and a refund-before-move boundary (RT3, refunds are impossible once the NFT has moved).
