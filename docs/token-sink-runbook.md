# Token Sink — Operations Runbook

This is the step-by-step for taking the token sink from "code merged" to
"first dollar landing in treasury." Everything below is one-time setup
or once-per-environment.

If you got here from the PR description and don't know what the token
sink is, read `docs/memorypack.md` and PR #96 first. TLDR: every dollar
of revenue auto-buys $CLUDE on Jupiter and lands in a multisig
treasury. Users never see the token.

## Architecture recap

| Wallet | Purpose | Custody | Where the key lives |
|---|---|---|---|
| Bot wallet (existing) | Memo writes for memory anchors | Backend env | `SOLANA_BOT_PRIVATE_KEY` |
| Sink hot wallet (new) | Receives USDC, executes Jupiter swaps | Backend env | `SINK_HOT_PRIVATE_KEY` |
| Treasury (new) | Final destination for all $CLUDE | Squads multisig | No private key — multisig PDA |

Treasury address is `4GJXeBY3FHbeobLSr9rYz57efCvdoWGyEcdcxZ4kwLom`.

## One-time setup

### 1. Generate the sink hot wallet

```bash
solana-keygen new --no-bip39-passphrase --outfile ~/sink-hot.json
solana-keygen pubkey ~/sink-hot.json   # base58 public key
cat ~/sink-hot.json                    # raw byte array (will become SINK_HOT_PRIVATE_KEY)
```

Or convert the byte array to base58 (more compact, what the codebase prefers):

```bash
node -e "
const bs58 = require('bs58').default || require('bs58');
const arr = require(require('os').homedir() + '/sink-hot.json');
console.log(bs58.encode(Uint8Array.from(arr)));
"
```

Save both the public key and the base58 secret somewhere safe.

### 2. Bootstrap the treasury's $CLUDE associated token account

The hot wallet will SPL-transfer $CLUDE to the treasury's associated
token account (ATA) for the $CLUDE mint. That ATA must exist before
the first transfer.

Easiest path: send a tiny amount of $CLUDE to the treasury from any
wallet that already holds some. Solana auto-creates the ATA on first
receive.

```bash
# Replace --from with a wallet that holds $CLUDE
spl-token transfer \
  AWGCDT2gd8JadbYbYyZy1iKxfWokPNgrEQoU24zUpump \
  0.000001 \
  4GJXeBY3FHbeobLSr9rYz57efCvdoWGyEcdcxZ4kwLom \
  --fund-recipient \
  --allow-unfunded-recipient \
  --owner /path/to/your/wallet.json
```

Verify the ATA exists:

```bash
spl-token accounts \
  --owner 4GJXeBY3FHbeobLSr9rYz57efCvdoWGyEcdcxZ4kwLom \
  | grep AWGCDT2gd8JadbYbYyZy1iKxfWokPNgrEQoU24zUpump
```

### 3. Fund the hot wallet with SOL for transaction fees

Each Jupiter swap + treasury transfer needs ~0.0001 SOL in fees.
Send 0.05 SOL (≈ $7) to the hot wallet to cover the first ~500
transactions.

```bash
solana transfer <SINK_HOT_PUBKEY> 0.05 --keypair /path/to/funded/wallet.json --allow-unfunded-recipient
```

### 4. Apply migration 019

In the Supabase SQL editor for project `ilmkakcqakvwtfrsabrd`, paste
and run the contents of `packages/database/migrations/019_token_sink.sql`.

Verify:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('sink_events', 'user_tiers', 'sink_ledger');
-- Expect 3 rows.
```

### 5. Set environment variables on Railway

Both the `cludebot-prod` server service AND the workers service need:

```
SINK_HOT_PRIVATE_KEY=<base58 from step 1>
SINK_HOT_PUBKEY=<base58 public key from step 1>
SINK_TREASURY_PUBKEY=4GJXeBY3FHbeobLSr9rYz57efCvdoWGyEcdcxZ4kwLom
```

Server uses `SINK_HOT_PUBKEY` (so the billing route knows where to
expect the USDC transfer to land) and `SINK_TREASURY_PUBKEY` (for the
public stats endpoint).

Workers use `SINK_HOT_PRIVATE_KEY` + `SINK_TREASURY_PUBKEY` to actually
execute swaps.

Verify in Railway logs — workers service on next deploy should print:

```
USDC sink worker starting hotWallet=<...> treasury=4GJXeBY3...
```

If you see "SINK_HOT_PRIVATE_KEY not set — sink worker disabled", the
env var didn't propagate.

## First mainnet test

### 6. Send a $1 USDC test transfer end-to-end

Use the helper script:

```bash
node scripts/sign-billing-upgrade.mjs \
  --keypair /path/to/test-buyer-wallet.json \
  --tier personal \
  --amount-usdc 5 \
  --hot <SINK_HOT_PUBKEY> \
  --rpc https://api.mainnet-beta.solana.com
```

The script:
1. Builds + signs + submits a USDC transferChecked from your wallet
   to the hot wallet
2. Waits for confirmation
3. Signs the canonical message
4. POSTs to `https://clude.io/api/billing/upgrade`
5. Prints the response

Expected output: `{ tier: "personal", active_until: "...", ledger_id: 1 }`.

Confirm:

```sql
-- New row in sink_ledger
SELECT id, status, source, source_ref, usdc_in_micro
FROM sink_ledger
ORDER BY created_at DESC LIMIT 1;
-- Expect status='pending', source='direct_usdc', usdc_in_micro=5000000

-- New row in user_tiers
SELECT identity_value, tier, active_until
FROM user_tiers
ORDER BY updated_at DESC LIMIT 1;
-- Expect tier='personal', active_until=now()+30 days
```

### 7. Wait for the cron to swap

Within an hour, the worker will:
1. Read pending ledger row
2. Quote USDC → $CLUDE on Jupiter
3. Execute swap if price impact < 5%
4. Transfer received $CLUDE to treasury
5. Update sink_ledger to status='completed' with tx signatures

Watch the logs:

```
railway logs --service cludebot-workers | grep usdc-sink
```

Or watch the public dashboard refresh: https://clude.io/treasury

### 8. Verify on Solscan

Click any transaction signature in the treasury dashboard. You should
see:
- Swap tx: input USDC from hot wallet → output $CLUDE
- Transfer tx: $CLUDE from hot wallet → treasury

## Failure recovery

### Cron is logging "skipped" with priceImpact > 5%

Liquidity is too thin for the swap size we're attempting. Options:

1. Wait — if MIN_SWAP_USDC ($50) is the floor, single-tick volume
   should usually fit. If not, the floor is too low for current
   liquidity.
2. Tune MIN_SWAP_USDC and MAX_SWAP_USDC in
   `apps/workers/src/jobs/usdc-sink-worker.ts` and redeploy.
3. Increase MAX_PRICE_IMPACT_PCT temporarily (5 → 10) if you'd rather
   accept more slippage than miss the swap.

### Cron is logging "swap failed" repeatedly

Likely a Solana network issue or RPC outage. The USDC stays in the hot
wallet; nothing is lost. Investigate via:

```bash
railway logs --service cludebot-workers | grep -E 'usdc-sink|swap|Jupiter'
```

If RPC is the issue, set `SOLANA_RPC_URL` to a different provider and
redeploy.

### A user paid but their tier didn't activate

The billing endpoint and the swap are decoupled. Check:

```sql
SELECT * FROM user_tiers WHERE identity_value = '<wallet>';
SELECT * FROM sink_ledger WHERE source_ref = '<tx_sig>';
```

If the user_tiers row exists but tier is wrong, the request body had a
bug. If the row doesn't exist, the billing endpoint rejected — check
server logs for the upgrade attempt.

### CLUDE stuck in hot wallet (treasury transfer failed)

Look at the failed ledger row:

```sql
SELECT id, error, swap_tx_sig FROM sink_ledger WHERE status = 'failed';
```

If `swap_tx_sig` is set but `treasury_transfer_tx_sig` is null, the
swap succeeded but the transfer to treasury failed. Most likely cause:
the treasury ATA doesn't exist yet (skipped step 2 above).

Recovery: bootstrap the ATA, then run a one-shot transfer manually:

```bash
node scripts/manual-treasury-transfer.mjs --amount-lamports <X>
```

(Script not yet in repo — write one if this happens.)

### I want to pause the sink

Set `SINK_HOT_PRIVATE_KEY=` (empty) on Railway and redeploy. Worker
self-disables. Subscriptions still work — pending ledger rows just sit
there until the var is restored.

## Going-live checklist

Hard gate. Don't skip:

- [ ] Squads multisig deployed at `4GJXeBY3...`
- [ ] $CLUDE ATA on treasury bootstrapped (step 2)
- [ ] Hot wallet generated, base58 secret in Railway (step 1, 5)
- [ ] Hot wallet has ≥ 0.05 SOL for tx fees (step 3)
- [ ] Migration 019 applied (step 4)
- [ ] Pricing page live at `/pricing`
- [ ] Treasury dashboard live at `/treasury`
- [ ] First manual test swap succeeded end-to-end (steps 6-8)
- [ ] Treasury dashboard shows the swap with non-zero $CLUDE balance
- [ ] Hot wallet is monitored — alert if balance > $10k (it shouldn't accumulate; cron should drain hourly)

## What's not in scope

- Stripe / fiat checkout (USDC-only for v0)
- Refunds / pro-rated downgrades (no API today, would need contract or manual ops)
- Usage tracking against tier quotas (memory store is still free for everyone in v0)
- Yield strategy on hot-wallet float (kept simple; small balances)
