import { config } from '@clude/shared/config';
import { startServer } from './app';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('server');

export async function bootstrap(): Promise<void> {
  log.info('=== CLUDE SERVER ===');

  // Initialize database (needed for API routes)
  const { initDatabase } = require('@clude/shared/core/database');
  await initDatabase();
  log.info('Database initialized');

  // Start HTTP server
  await startServer();
  log.info({ port: config.server.port }, 'Server listening');

  // Recall canary (Memory 3.0 C0) — probes every recall RPC lane with an owner-scoped
  // sentinel on deploy + hourly, and logs at ERROR when a lane silently dies (the
  // migration-028 class: vector recall broken for weeks with keyword fallback masking it).
  // Gated on Supabase creds; RECALL_CANARY=false opts out.
  if (process.env.SUPABASE_URL && process.env.RECALL_CANARY !== 'false') {
    const { startRecallCanary } = require('./workers/recall-canary');
    startRecallCanary();
  }

  // Memory 3.0 C2 durable enrichment outbox. Drains the single 'enrich' job storeMemory enqueues
  // when MEMORY_OUTBOX is on (embed → link → extract, owner-scoped, crash-safe via stale-'running'
  // reclaim; degrades silently to a no-op if migrations 044/045 are unapplied). Gated on the flag
  // AND Supabase creds — flag off means nothing enqueues, so the drain would be a pointless empty
  // RPC every tick.
  if (process.env.SUPABASE_URL && config.memory.outboxEnabled) {
    const { startOutboxWorkerPoller } = require('./workers/outbox-worker-poller');
    startOutboxWorkerPoller();
    log.info('Memory outbox worker started');
  }

  // Durable marketplace delivery poller (§00 M6) — the backstop that drives paid copy orders to
  // 'delivered' even if the post-webhook delivery nudge is lost to a crash. Only run it when the
  // Stripe rail is configured (no paid orders exist otherwise); harmless either way (it no-ops).
  if (config.stripe.secretKey) {
    const { startMarketplaceDeliveryPoller } = require('./lib/payments/marketplace-delivery-poller');
    startMarketplaceDeliveryPoller();
    log.info('Marketplace delivery poller started');
  }

  // Title-mint reconciliation backstop (Base) — guarantees "a title pack exists on Base once exported"
  // by re-minting any export whose best-effort detached mint was missed. Runs on its OWN timer,
  // DELIBERATELY decoupled from the copy-delivery poller (a 4-agent backtest showed a hung Base RPC in
  // a shared sweep would block M6 copy delivery). Gate on the FULL Base mint env — the address alone is
  // not enough (the mint also needs the minter key + the custodial seed); starting it with a partial
  // config would silently no-op every interval (the "guarantee" off with no alert). Idempotent + cheap.
  if (process.env.CLUDE_PACK_TITLE_ADDRESS && process.env.BASE_MINTER_KEY && process.env.BASE_CUSTODIAL_SEED) {
    const { startTitleReconciliationPoller } = require('./lib/payments/reconcile-title-mints');
    startTitleReconciliationPoller();
    log.info('Title-mint reconciliation poller started');
  } else if (process.env.CLUDE_PACK_TITLE_ADDRESS) {
    // Partial Base config — surface loudly rather than starting a silently-inert backstop.
    log.warn('Title reconciliation NOT started: CLUDE_PACK_TITLE_ADDRESS set but BASE_MINTER_KEY / BASE_CUSTODIAL_SEED missing');
  }
}
