import express, { Request, Response } from 'express';
import { config } from '@clude/shared/config';
import { apiLimiter, corsMiddleware, securityHeaders, apiCacheControl, createCompression } from './middleware';
import { mountApiRoutes } from './routes';
import { staticRoutes } from './routes/static.routes';
import { optionalPrivyAuth } from '@clude/brain/auth/privy-auth';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('server');

export function createServer(): express.Application {
  const app = express();

  app.set('trust proxy', 1);

  app.use(express.json());
  app.use(createCompression());
  app.use(corsMiddleware);
  app.use(securityHeaders);

  // Health check — always return 200 so Railway marks the deploy healthy
  app.get('/health', async (_req: Request, res: Response) => {
    try {
      const { getDb } = require('@clude/shared/core/database');
      const db = getDb();
      const { error } = await db.from('memories').select('id').limit(1);
      res.json({
        status: error ? 'degraded' : 'ok',
        timestamp: new Date().toISOString(),
        database: error ? 'unreachable' : 'connected',
      });
    } catch {
      res.json({ status: 'starting', timestamp: new Date().toISOString(), database: 'not initialized' });
    }
  });

  // API middleware
  app.use('/api', apiLimiter);
  app.use('/api', optionalPrivyAuth);
  app.use('/api', apiCacheControl);

  // Mount all API routes
  mountApiRoutes(app);

  // Dev proxy for Vite dev servers
  if (process.env.NODE_ENV !== 'production') {
    // @ts-ignore — dev-proxy.ts is local-only, not committed
    import('./routes/dev-proxy').then(({ setupDevProxy }: any) => setupDevProxy(app))
      .catch((err: any) => log.warn({ err }, 'Dev proxy not available'));
  }

  // Static files and SPA routing (must be last — catch-all)
  app.use(staticRoutes());

  return app;
}

export function startServer(): Promise<void> {
  return new Promise((resolve) => {
    const app = createServer();
    app.listen(config.server.port, () => {
      log.info({ port: config.server.port }, 'Server started');
      resolve();
    });
  });
}
