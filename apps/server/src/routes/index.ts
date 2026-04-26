import express, { Request, Response } from 'express';
import { config } from '@clude/shared/config';
import { requirePrivyAuth } from '@clude/brain/auth/privy-auth';
import { verifyRoutes } from '@clude/brain/verify-app/routes';
import { agentRoutes } from './agent.routes.js';
import { cortexRoutes } from './cortex.routes.js';
import { graphRoutes } from './graph.routes.js';
import { campaignRoutes } from './campaign.routes.js';
import { chatRoutes } from './chat.routes.js';
import { uploadRoutes } from './upload.routes.js';
import { exploreRoutes } from './explore.routes.js';
import { lotrRoutes } from './lotr.routes.js';
import { topupWebhookRoutes, topupApiRoutes } from './topup.routes.js';
import { dashboardRoutes } from './dashboard.routes.js';
import { compoundRoutes } from './compound.routes.js';
import { memoryRoutes } from './memory.routes.js';
import { memoryPacksRoutes } from './memory-packs.routes.js';
import { demoRoutes } from './demo.routes.js';
import { showcaseRoutes } from './showcase.routes.js';
import { walletAuthRoutes } from './wallet-auth.routes.js';
import { billingRoutes } from './billing.routes.js';
import { treasuryRoutes } from './treasury.routes.js';
import { createChildLogger } from '@clude/shared/core/logger';
import rateLimit from 'express-rate-limit';

const log = createChildLogger('api');

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many API requests' },
});

export function mountApiRoutes(app: express.Application): void {
  // Solana RPC proxy — keeps the Helius API key server-side
  app.post('/api/solana-rpc', requirePrivyAuth, async (req: Request, res: Response) => {
    const rpcUrl = config.solana.rpcUrl;
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (err) {
      log.error({ err }, 'Solana RPC proxy error');
      res.status(502).json({ error: 'RPC proxy error' });
    }
  });

  // Memory: stats, list, brain, consciousness, trace, explain, verify, owner, journal, docs-views
  app.use('/api', memoryRoutes());

  // Memory packs: export, import, smart-export
  app.use('/api/memory-packs', memoryPacksRoutes());

  // Demo: trigger, poll, stats, store, recall
  app.use('/api/demo', demoRoutes());

  // Public hackathon showcase endpoints (SSE + ingest). No auth, fixed
  // owner_wallet isolation inside the handler.
  app.use('/api/showcase', showcaseRoutes());

  // Aliases: /api/memory/* → /api/demo/*
  const reRoute = (target: string) => (req: Request, res: Response) => {
    req.url = target;
    req.originalUrl = target;
    app(req, res);
  };
  app.post('/api/memory/store', reRoute('/api/demo/store'));
  app.post('/api/memory/recall', reRoute('/api/demo/recall'));
  app.get('/api/memory/stats', reRoute('/api/demo/stats'));

  // Agent API (authenticated endpoints for other AI agents)
  app.use('/api/agent', agentRoutes());

  // Hosted Cortex API (memory-as-a-service for SDK users)
  app.use('/api/cortex', cortexRoutes());

  // Knowledge Graph API (entity-centric memory visualization)
  app.use('/api/graph', graphRoutes());

  // Agent Dashboard (orchestration & monitoring)
  app.use('/api/dashboard', dashboardRoutes());

  // File Upload → Scene Extraction → Memory pipeline (owner-gated)
  app.use('/api/upload', uploadRoutes());

  // Explore Agent (memory graph chat)
  app.use('/api/explore', exploreRoutes());

  // LOTR Guest Brain (campaign — temporary, no auth required)
  app.use('/api/lotr', lotrRoutes());

  // Chat API (memory-augmented chat with OpenRouter inference)
  app.use('/api/chat', chatRoutes());

  // Chat billing: balance, top-up confirmation, history
  app.use('/api/chat', topupApiRoutes());

  // Wallet auth (direct Phantom signature verification for mobile)
  app.use('/api/wallet-auth', walletAuthRoutes());

  // Token sink (v0): direct USDC tier upgrades + public treasury stats.
  app.use('/api/billing', billingRoutes());
  app.use('/api/treasury', treasuryRoutes());

  // Helius webhook (USDC payment detection — outside /api to avoid API rate limiter)
  app.use('/webhook', topupWebhookRoutes());

  // Campaign: 10 Days of Growing a Blockchain Brain
  app.use('/api/campaign', apiLimiter, campaignRoutes());

  // Compound: Prediction Market Intelligence (disabled by default)
  if (process.env.COMPOUND_ENABLED === 'true') {
    app.use('/api/compound', compoundRoutes());
  }

  // Verify routes
  app.use('/api', verifyRoutes());
}
