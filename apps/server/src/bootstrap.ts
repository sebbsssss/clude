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
}
