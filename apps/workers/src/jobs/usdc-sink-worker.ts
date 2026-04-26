// USDC sink worker. Runs hourly with random jitter. Reads pending
// sink_ledger entries, executes Jupiter swaps against the hot wallet's
// USDC balance, transfers received $CLUDE to the treasury multisig,
// and updates the ledger. Designed to be safe to run repeatedly:
// failures leave USDC in the hot wallet; the next tick picks them up.

import { Connection, Keypair } from '@solana/web3.js';
// @ts-ignore — bs58 is ESM-only, works at runtime via Node CJS/ESM interop
import * as bs58Module from 'bs58';
const bs58: { encode: (b: Uint8Array) => string; decode: (s: string) => Uint8Array } =
  (bs58Module as any).default || bs58Module;

import {
  getQuote,
  executeSwap,
  transferToTreasury,
  listPending,
  updateLedger,
  USDC_MINT,
} from '@clude/brain/sink';
// @ts-ignore — @solana/spl-token is ESM-only, works via CJS/ESM interop
import * as splToken from '@solana/spl-token';
const { getAssociatedTokenAddress, getAccount } = splToken;
import { PublicKey } from '@solana/web3.js';
import { config } from '@clude/shared/config';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('usdc-sink');

// All operational tunables in one place.
const MIN_SWAP_USDC_MICRO = 50_000_000n;        // $50 — wait until ≥ before tickling Jupiter
const MAX_SWAP_USDC_MICRO = 5_000_000_000n;     // $5k — single-tick cap
const SLIPPAGE_BPS = 200;                       // 2% in quote
const MAX_PRICE_IMPACT_PCT = 5;                 // 5% pre-execution gate
const HOUR_MS = 60 * 60 * 1000;
const JITTER_MS = 30 * 60 * 1000;               // up to 30 min random offset

let timer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;

function loadHotWallet(): Keypair | null {
  const raw = process.env.SINK_HOT_PRIVATE_KEY;
  if (!raw) {
    log.warn('SINK_HOT_PRIVATE_KEY not set — sink worker disabled');
    return null;
  }
  try {
    const bytes = raw.trim().startsWith('[')
      ? Uint8Array.from(JSON.parse(raw))
      : bs58.decode(raw.trim());
    return Keypair.fromSecretKey(bytes);
  } catch (err) {
    log.error({ err }, 'Failed to parse SINK_HOT_PRIVATE_KEY — sink disabled');
    return null;
  }
}

function loadTreasuryPubkey(): string | null {
  const raw = process.env.SINK_TREASURY_PUBKEY;
  if (!raw) {
    log.warn('SINK_TREASURY_PUBKEY not set — sink worker disabled');
    return null;
  }
  try {
    new PublicKey(raw); // validate
    return raw;
  } catch {
    log.error({ raw }, 'SINK_TREASURY_PUBKEY is not a valid base58 pubkey — sink disabled');
    return null;
  }
}

async function getUsdcBalance(conn: Connection, owner: PublicKey): Promise<bigint> {
  try {
    const ata = await getAssociatedTokenAddress(new PublicKey(USDC_MINT), owner);
    const acc = await getAccount(conn, ata);
    return acc.amount;
  } catch {
    // ATA may not exist yet (no USDC ever received). Treat as zero.
    return 0n;
  }
}

async function tick(opts: {
  hotWallet: Keypair;
  treasury: string;
  connection: Connection;
}): Promise<void> {
  const { hotWallet, treasury, connection } = opts;

  // Reconcile pending ledger rows up front. listPending returns rows
  // that need attention (pending / failed / skipped) — we do not
  // attempt to retry stuck 'swapping' rows here because they may be
  // mid-confirmation; an operator should resolve those manually.
  const pending = await listPending(50);
  if (pending.length === 0) {
    log.debug('No pending ledger rows; skipping tick');
    return;
  }

  const balance = await getUsdcBalance(connection, hotWallet.publicKey);
  if (balance < MIN_SWAP_USDC_MICRO) {
    log.info(
      { balance: String(balance), min: String(MIN_SWAP_USDC_MICRO), pending: pending.length },
      'Hot wallet USDC below MIN_SWAP — waiting',
    );
    return;
  }

  // We deliberately swap in one shot per tick rather than per-ledger-row.
  // The ledger row we attribute the swap to is the oldest pending row;
  // any extra USDC in the wallet (e.g., from sources we didn't track)
  // gets swept along with it. This is fine: every dollar that lands in
  // the hot wallet is destined for the same place.
  const target = pending[0];

  const swapAmount = balance > MAX_SWAP_USDC_MICRO ? MAX_SWAP_USDC_MICRO : balance;

  let ledgerId: number = Number(target.id ?? 0);
  if (!ledgerId) {
    log.error({ target }, 'pending row missing id — aborting tick');
    return;
  }

  await updateLedger(ledgerId, { status: 'swapping' });

  let quote;
  try {
    quote = await getQuote({
      inputMicroUsdc: swapAmount,
      slippageBps: SLIPPAGE_BPS,
    });
  } catch (err) {
    await updateLedger(ledgerId, {
      status: 'failed',
      error: `quote: ${(err as Error).message}`,
    });
    log.error({ err }, 'Jupiter quote failed');
    return;
  }

  const impact = parseFloat(quote.priceImpactPct) * 100;
  if (impact > MAX_PRICE_IMPACT_PCT) {
    await updateLedger(ledgerId, {
      status: 'skipped',
      jupiter_route: quote.raw,
      error: `priceImpact ${impact.toFixed(2)}% > ${MAX_PRICE_IMPACT_PCT}%`,
    });
    log.warn({ impact }, 'Skipped — price impact too high');
    return;
  }

  let swapResult;
  try {
    swapResult = await executeSwap({
      quote,
      hotWallet,
      connection,
      maxPriceImpactPct: MAX_PRICE_IMPACT_PCT,
    });
  } catch (err) {
    await updateLedger(ledgerId, {
      status: 'failed',
      jupiter_route: quote.raw,
      error: `swap: ${(err as Error).message}`,
    });
    log.error({ err }, 'Swap execution failed');
    return;
  }

  // Transfer received CLUDE to treasury. If this fails, leave the
  // ledger row in 'failed' state — the CLUDE sits safe in the hot
  // wallet and an operator can re-run a one-shot transfer.
  let transferSig: string | null = null;
  try {
    const transfer = await transferToTreasury({
      hotWallet,
      treasuryPubkey: treasury,
      connection,
      amountLamports: swapResult.outAmount,
    });
    transferSig = transfer.txSig;
  } catch (err) {
    await updateLedger(ledgerId, {
      status: 'failed',
      jupiter_route: quote.raw,
      usdc_swapped_micro: swapResult.inAmount,
      clude_out_lamports: swapResult.outAmount,
      realised_slippage_bps: Math.round(swapResult.priceImpactPct * 100),
      swap_tx_sig: swapResult.txSig,
      error: `treasury transfer: ${(err as Error).message}`,
    });
    log.error({ err }, 'Treasury transfer failed — CLUDE stuck in hot wallet');
    return;
  }

  await updateLedger(ledgerId, {
    status: 'completed',
    jupiter_route: quote.raw,
    usdc_swapped_micro: swapResult.inAmount,
    clude_out_lamports: swapResult.outAmount,
    realised_slippage_bps: Math.round(swapResult.priceImpactPct * 100),
    swap_tx_sig: swapResult.txSig,
    treasury_transfer_tx_sig: transferSig,
  });

  log.info(
    {
      ledgerId,
      usdcSwappedMicro: String(swapResult.inAmount),
      cludeOutLamports: String(swapResult.outAmount),
      swap: swapResult.txSig,
      transfer: transferSig,
    },
    'Tick complete — sink ledger row marked completed',
  );
}

function scheduleNext(runner: () => void): void {
  if (stopped) return;
  const jitter = Math.floor(Math.random() * JITTER_MS);
  timer = setTimeout(runner, HOUR_MS + jitter);
}

export function start(): void {
  const hotWallet = loadHotWallet();
  const treasury = loadTreasuryPubkey();
  if (!hotWallet || !treasury) return; // disabled

  const connection = new Connection(config.solana.rpcUrl, 'confirmed');
  log.info(
    { hotWallet: hotWallet.publicKey.toBase58(), treasury },
    'USDC sink worker starting',
  );

  const runner = async () => {
    try {
      await tick({ hotWallet, treasury, connection });
    } catch (err) {
      log.error({ err }, 'Sink tick raised — sleeping until next interval');
    } finally {
      scheduleNext(runner);
    }
  };
  // Run once on boot, then schedule.
  runner().catch(() => undefined);
}

export function stop(): void {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}
