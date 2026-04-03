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
}
