import express, { Request, Response } from 'express';
import { config } from '@clude/shared/config';
import { apiLimiter, corsMiddleware, securityHeaders, apiCacheControl, createCompression } from './middleware';
import { mountApiRoutes } from './routes';
import { staticRoutes } from './routes/static.routes';
import { optionalPrivyAuth } from '@clude/brain/auth/privy-auth';
import { createChildLogger } from '@clude/shared/core/logger';
import { initOpenRouter, isOpenRouterEnabled } from '@clude/shared/core/openrouter-client';
import { packMarketplaceStripeWebhookRoutes } from './routes/marketplace-payments.routes';

const log = createChildLogger('server');

export function createServer(): express.Application {
  const app = express();

  app.set('trust proxy', 1);

  // Initialize the shared OpenRouter client used by non-streaming helpers
  // (generateOpenRouterResponse — /api/proof/hallucination/ask, explore, lotr).
  // The streaming chat path builds its own client via @openrouter/ai-sdk-provider,
  // so this shared singleton was otherwise never initialized on the API server
  // and those helpers threw "OpenRouter client not initialized".
  if (!isOpenRouterEnabled() && config.openrouter.apiKey) {
    initOpenRouter({ apiKey: config.openrouter.apiKey });
  }

  // Stripe marketplace webhook — MUST be mounted BEFORE express.json(): Stripe signature
  // verification needs the EXACT raw bytes Stripe signed, which the json parser would consume.
  // This router applies its own express.raw() to that one path; all other routes still get JSON.
  app.use(packMarketplaceStripeWebhookRoutes());

  app.use(express.json());
  app.use(createCompression());
  app.use(corsMiddleware);
  app.use(securityHeaders);

  // ── MCP / OAuth discovery (RFC 8414 + RFC 9728) ─────────────────
  // These let Claude Desktop discover where to authenticate. v1 ships
  // with API-key bearer auth; these endpoints advertise the resource
  // and a future OAuth issuer so the discovery probe succeeds and the
  // upgrade to delegated OAuth is non-breaking.
  app.get('/.well-known/oauth-protected-resource', (req: Request, res: Response) => {
    const origin = `${req.protocol}://${req.get('host')}`;
    res.json({
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      scopes_supported: ['memory:read', 'memory:write'],
      bearer_methods_supported: ['header'],
      resource_documentation: 'https://clude.io',
    });
  });
  app.get('/.well-known/oauth-authorization-server', (req: Request, res: Response) => {
    const origin = `${req.protocol}://${req.get('host')}`;
    res.json({
      issuer: origin,
      authorization_endpoint: `${origin}/api/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      scopes_supported: ['memory:read', 'memory:write'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  });

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
