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
