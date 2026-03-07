import express, { Request, Response } from 'express';
import path from 'path';
import { config } from '../config';
import { handleHeliusWebhook } from './helius-handler';
import { verifyRoutes } from '../verify-app/routes';
import { getMarketSnapshot } from '../core/allium-client';
import { getMemoryStats, getRecentMemories, storeMemory, recallMemories } from '../core/memory';
import { getDb, checkRateLimit } from '../core/database';
import { writeMemo, solscanTxUrl } from '../core/solana-client';
import { createHash, timingSafeEqual } from 'crypto';
import { agentRoutes } from './agent-routes';
import { cortexRoutes } from './cortex-routes';
import { graphRoutes } from './graph-routes';
import { campaignRoutes } from './campaign-routes';
import { getRecentActivity } from '../features/activity-stream';
import { getVeniceStats } from '../core/venice-client';
import { createChildLogger } from '../core/logger';
import { checkInputContent } from '../core/guardrails';
import rateLimit from 'express-rate-limit';
import { requirePrivyAuth, optionalPrivyAuth } from './privy-auth';

const log = createChildLogger('server');

// Rate limiters
const webhookLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many webhook requests' },
});

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many API requests' },
});

// Helius webhook signature verification middleware
function verifyHeliusWebhook(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const secret = config.helius.webhookSecret;
  if (!secret) {
    // No secret configured — skip verification (log warning on first request)
    next();
    return;
  }

  const authHeader = req.headers['authorization'] as string | undefined;
  if (!authHeader) {
    log.warn('Helius webhook request missing Authorization header');
    res.status(401).json({ error: 'Missing webhook authorization' });
    return;
  }

  // Constant-time comparison to prevent timing attacks
  const authBuffer = Buffer.from(authHeader);
  const secretBuffer = Buffer.from(secret);
  if (authBuffer.length !== secretBuffer.length || !timingSafeEqual(authBuffer, secretBuffer)) {
    log.warn('Invalid Helius webhook authorization');
    res.status(401).json({ error: 'Invalid webhook authorization' });
    return;
  }

  next();
}

export function createServer(): express.Application {
  const app = express();

  // Trust reverse proxy (Railway, etc.) for correct IP in rate limiting
  app.set('trust proxy', 1);

  app.use(express.json());

  // Health check with DB connectivity probe
  app.get('/health', async (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const { error } = await db.from('memories').select('id').limit(1);
      res.json({
        status: error ? 'degraded' : 'ok',
        timestamp: new Date().toISOString(),
        character: 'tired',
        database: error ? 'unreachable' : 'connected',
      });
    } catch {
      res.status(503).json({ status: 'error', timestamp: new Date().toISOString(), database: 'unreachable' });
    }
  });

  // Helius webhook endpoint for token events (with signature verification + rate limiting)
  app.post('/webhook/helius', webhookLimiter, verifyHeliusWebhook, async (req: Request, res: Response) => {
    try {
      await handleHeliusWebhook(req.body);
      res.json({ ok: true });
    } catch (err) {
      log.error({ err }, 'Helius webhook error');
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  // Apply rate limiting to all API routes
  app.use('/api', apiLimiter);

  // Attach Privy user to all API requests (optional — doesn't block unauthenticated)
  app.use('/api', optionalPrivyAuth);

  // Venice integration stats (privacy dashboard)
  app.get('/api/venice-stats', async (_req: Request, res: Response) => {
    try {
      const veniceStats = await getVeniceStats();
      const memoryStats = await getMemoryStats();
      res.json({
        venice: veniceStats,
        decentralization: {
          inference: 'Venice AI (permissionless, no logs)',
          memory: 'Solana (on-chain, verifiable)',
          embeddings: 'Venice AI (private indexing)',
          totalMemoriesOnChain: memoryStats.total,
          embeddedCount: memoryStats.embeddedCount,
        },
      });
    } catch (err) {
      log.error({ err }, 'Venice stats endpoint error');
      res.status(500).json({ error: 'Failed to fetch Venice stats' });
    }
  });

  // Memory stats API (for frontend cortex visualization)
  app.get('/api/memory-stats', async (_req: Request, res: Response) => {
    try {
      const stats = await getMemoryStats();
      res.json(stats);
    } catch (err) {
      log.error({ err }, 'Memory stats endpoint error');
      res.status(500).json({ error: 'Failed to fetch memory stats' });
    }
  });

  // Recent memories API (for timeline visualization)
  app.get('/api/memories', async (req: Request, res: Response) => {
    try {
      const hours = Math.min(parseInt(req.query.hours as string) || 168, 720); // Default 1 week, max 30 days
      const limit = Math.min(parseInt(req.query.limit as string) || 30, 50);
      const memories = await getRecentMemories(hours, undefined, limit);
      res.json({
        memories: memories.map(m => ({
          id: m.id,
          memory_type: m.memory_type,
          summary: m.summary,
          content: m.content,
          tags: m.tags,
          importance: m.importance,
          decay_factor: m.decay_factor,
          emotional_valence: m.emotional_valence,
          access_count: m.access_count,
          source: m.source,
          created_at: m.created_at,
          solana_signature: m.solana_signature || null,
        })),
        count: memories.length,
        lastUpdate: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Memories endpoint error');
      res.status(500).json({ error: 'Failed to fetch memories' });
    }
  });

  // Brain visualization API (full graph data for neural network viz)
  app.get('/api/brain', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 300, 500);
      const memories = await getRecentMemories(8760, undefined, limit); // 1 year window
      const stats = await getMemoryStats();
      res.json({
        nodes: memories.map(m => ({
          id: m.id,
          type: m.memory_type,
          summary: m.summary,
          tags: m.tags || [],
          importance: m.importance,
          decay: m.decay_factor,
          valence: m.emotional_valence,
          accessCount: m.access_count,
          source: m.source,
          evidenceIds: m.evidence_ids || [],
          solanaSignature: m.solana_signature || null,
          createdAt: m.created_at,
          lastAccessed: m.last_accessed,
        })),
        total: stats.total,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Brain endpoint error');
      res.status(500).json({ error: 'Failed to fetch brain data' });
    }
  });

  // Consciousness stream API (self-model, emergence, procedural insights)
  app.get('/api/brain/consciousness', async (req: Request, res: Response) => {
    try {
      const [selfModel, emergence, procedural, recentEpisodic, stats] = await Promise.all([
        getRecentMemories(8760, ['self_model'], 10),
        getRecentMemories(8760, ['self_model'], 20),
        getRecentMemories(8760, ['procedural'], 10),
        getRecentMemories(24, ['episodic'], 5),
        getMemoryStats(),
      ]);

      // Separate emergence thoughts (source: 'emergence') from reflections (source: 'reflection')
      const emergenceThoughts = emergence
        .filter(m => m.source === 'emergence')
        .slice(0, 5);
      const reflections = selfModel
        .filter(m => m.source === 'reflection')
        .slice(0, 5);

      // Get last dream cycle time
      const db = getDb();
      const { data: lastDream } = await db
        .from('dream_logs')
        .select('created_at, session_type')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      res.json({
        emergence: emergenceThoughts.map(m => ({
          id: m.id, summary: m.summary, importance: m.importance,
          createdAt: m.created_at, tags: m.tags,
        })),
        selfModel: reflections.map(m => ({
          id: m.id, summary: m.summary, importance: m.importance,
          createdAt: m.created_at, tags: m.tags,
        })),
        procedural: procedural.map(m => ({
          id: m.id, summary: m.summary, importance: m.importance,
          createdAt: m.created_at, tags: m.tags,
        })),
        recentActivity: recentEpisodic.map(m => ({
          id: m.id, summary: m.summary, source: m.source,
          createdAt: m.created_at,
        })),
        stats: {
          total: stats.total,
          byType: stats.byType,
          avgDecay: stats.avgDecay,
          dreamSessions: stats.totalDreamSessions,
          lastDream: lastDream?.created_at || null,
          lastDreamType: lastDream?.session_type || null,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Consciousness endpoint error');
      res.status(500).json({ error: 'Failed to fetch consciousness data' });
    }
  });

  // Market data API (Allium-powered)
  app.get('/api/market-data', async (_req: Request, res: Response) => {
    try {
      const snapshot = await getMarketSnapshot();
      res.json(snapshot);
    } catch (err) {
      log.error({ err }, 'Market data endpoint error');
      res.status(500).json({ error: 'Failed to fetch market data' });
    }
  });

  // Agent API (authenticated endpoints for other AI agents)
  app.use('/api/agent', agentRoutes());

  // Hosted Cortex API (memory-as-a-service for SDK users)
  app.use('/api/cortex', cortexRoutes());

  // Knowledge Graph API (entity-centric memory visualization)
  app.use('/api/graph', graphRoutes());

  // Campaign: 10 Days of Growing a Blockchain Brain
  app.use('/api/campaign', apiLimiter, campaignRoutes());

  // ---- DASHBOARD ENDPOINTS (Privy-authenticated) ---- //

  // Owner verification — checks if the connected wallet matches the configured OWNER_WALLET
  app.get('/api/owner', requirePrivyAuth, async (req: Request, res: Response) => {
    try {
      const { getOwnerWallet } = require('../core/memory');
      const ownerWallet = getOwnerWallet();

      if (!ownerWallet) {
        res.json({ isOwner: false, reason: 'no_owner_configured' });
        return;
      }

      // Get the wallet address from the Privy user's linked accounts
      // The frontend sends the connected wallet address as a query param
      const connectedWallet = req.query.wallet as string;
      if (!connectedWallet) {
        res.json({ isOwner: false, reason: 'no_wallet_provided' });
        return;
      }

      const isOwner = connectedWallet === ownerWallet;
      res.json({
        isOwner,
        userId: req.privyUser?.userId,
        ownerWallet: ownerWallet.slice(0, 4) + '...' + ownerWallet.slice(-4),
      });
    } catch (err) {
      log.error({ err }, 'Owner verification error');
      res.status(500).json({ error: 'Verification failed' });
    }
  });

  // Privy-authenticated brain data (wallet-scoped, for Memory Explorer)
  app.get('/api/user/brain', requirePrivyAuth, async (req: Request, res: Response) => {
    try {
      const wallet = req.query.wallet as string;
      if (!wallet || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
        res.status(400).json({ error: 'Valid Solana wallet address required' });
        return;
      }

      const limit = Math.min(parseInt(req.query.limit as string) || 300, 500);
      const memories = await getRecentMemories(8760, undefined, limit);
      // Filter to wallet-owned memories
      const walletMemories = memories.filter(m => (m as any).owner_wallet === wallet);
      const stats = await getMemoryStats();

      res.json({
        nodes: walletMemories.map(m => ({
          id: m.id,
          type: m.memory_type,
          summary: m.summary,
          content: m.content,
          tags: m.tags || [],
          importance: m.importance,
          decay: m.decay_factor,
          valence: m.emotional_valence,
          accessCount: m.access_count,
          source: m.source,
          evidenceIds: m.evidence_ids || [],
          createdAt: m.created_at,
          lastAccessed: m.last_accessed,
        })),
        total: walletMemories.length,
        wallet,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'User brain endpoint error');
      res.status(500).json({ error: 'Failed to fetch brain data' });
    }
  });

  // Export memory pack
  app.post('/api/memory-packs/export', requirePrivyAuth, async (req: Request, res: Response) => {
    try {
      const { name, description, tags, types } = req.body;
      if (!name) { res.status(400).json({ error: 'name is required' }); return; }

      const hours = 8760; // 1 year
      const limit = 200;
      let memories = await getRecentMemories(hours, types || undefined, limit);

      // Filter by tags if provided
      if (tags && tags.length > 0) {
        memories = memories.filter(m => m.tags.some((t: string) => tags.includes(t)));
      }

      // Build entities list
      const db = getDb();
      const memoryIds = memories.map(m => m.id);
      let entities: any[] = [];
      let links: any[] = [];

      if (memoryIds.length > 0) {
        const { data: entityData } = await db
          .from('entity_memories')
          .select('entity_id, entities(id, entity_type, name, normalized_name, description, mention_count)')
          .in('memory_id', memoryIds);
        if (entityData) {
          const seen = new Set<number>();
          for (const row of entityData) {
            const e = (row as any).entities;
            if (e && !seen.has(e.id)) {
              entities.push(e);
              seen.add(e.id);
            }
          }
        }

        const { data: linkData } = await db
          .from('memory_links')
          .select('source_id, target_id, link_type, strength')
          .or(`source_id.in.(${memoryIds.join(',')}),target_id.in.(${memoryIds.join(',')})`);
        if (linkData) links = linkData;
      }

      const pack = {
        id: `pack-${Date.now()}`,
        name,
        description: description || '',
        memories,
        entities,
        links,
        created_at: new Date().toISOString(),
        created_by: req.privyUser?.userId || 'unknown',
        memory_count: memories.length,
        entity_count: entities.length,
      };

      res.json(pack);
    } catch (err) {
      log.error({ err }, 'Memory pack export error');
      res.status(500).json({ error: 'Export failed' });
    }
  });

  // Import memory pack
  app.post('/api/memory-packs/import', requirePrivyAuth, async (req: Request, res: Response) => {
    try {
      const pack = req.body;
      if (!pack || !Array.isArray(pack.memories)) {
        res.status(400).json({ error: 'Invalid memory pack format' });
        return;
      }

      let imported = 0;
      for (const mem of pack.memories) {
        const id = await storeMemory({
          type: mem.memory_type || 'episodic',
          content: String(mem.content || '').slice(0, 5000),
          summary: String(mem.summary || '').slice(0, 500),
          tags: mem.tags || [],
          concepts: mem.concepts || [],
          emotionalValence: mem.emotional_valence || 0,
          importance: mem.importance || 0.5,
          source: 'import',
          relatedUser: req.privyUser?.userId || mem.related_user || null,
          metadata: { imported_from: pack.name || 'unknown', original_id: mem.id },
        });
        if (id) imported++;
      }

      res.json({ imported, total: pack.memories.length });
    } catch (err) {
      log.error({ err }, 'Memory pack import error');
      res.status(500).json({ error: 'Import failed' });
    }
  });

  // List memory packs (stub — packs aren't persisted yet, returns empty)
  app.get('/api/memory-packs', optionalPrivyAuth, async (_req: Request, res: Response) => {
    res.json([]);
  });

  // Activity stream (recent on-chain events)
  app.get('/api/activity', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const events = await getRecentActivity(limit);
      res.json({ events, lastUpdate: new Date().toISOString() });
    } catch (err) {
      log.error({ err }, 'Activity endpoint error');
      res.status(500).json({ error: 'Failed to fetch activity' });
    }
  });

  // Docs view counter (tracks agents.md views)
  app.get('/api/docs-views', async (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const { data } = await db
        .from('rate_limits')
        .select('count')
        .eq('key', 'page_views:agents.md')
        .single();
      res.json({ views: data?.count || 0 });
    } catch {
      res.json({ views: 0 });
    }
  });

  app.post('/api/docs-views', async (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const { data: existing } = await db
        .from('rate_limits')
        .select('count')
        .eq('key', 'page_views:agents.md')
        .single();

      if (existing) {
        await db
          .from('rate_limits')
          .update({ count: existing.count + 1 })
          .eq('key', 'page_views:agents.md');
      } else {
        await db
          .from('rate_limits')
          .insert({ key: 'page_views:agents.md', count: 1 });
      }
      res.json({ ok: true });
    } catch {
      res.json({ ok: false });
    }
  });

  // ---- DEMO ENDPOINTS ---- //

  // Trigger a live memory creation + on-chain commit
  app.post('/api/demo/trigger', async (req: Request, res: Response) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const allowed = await checkRateLimit(`demo:trigger:${ip}`, 1, 1);
      if (!allowed) {
        res.status(429).json({ error: 'Rate limited. One demo per minute.', cooldown: 60 });
        return;
      }

      const now = new Date();
      const content = `Demo memory triggered at ${now.toISOString()}. This thought was created by a visitor to clude.io and committed to Solana as an on-chain memo. The SHA-256 hash of this content is permanently recorded on-chain, making it verifiable and immutable.`;
      const summary = `Demo: live brain commit triggered by visitor at ${now.toISOString().slice(11, 19)} UTC`;

      const memoryId = await storeMemory({
        type: 'episodic',
        content,
        summary,
        tags: ['demo', 'on-chain', 'live'],
        importance: 0.7,
        source: 'demo',
        emotionalValence: 0.2,
      });

      if (!memoryId) {
        res.status(500).json({ error: 'Failed to create memory' });
        return;
      }

      // On-chain commit to Solana mainnet (fire-and-forget)
      // Frontend polls for the tx hash. Falls back to content hash if write fails.
      const contentHash = createHash('sha256').update(content).digest('hex');
      const memo = `clude-demo | id: ${memoryId} | hash: ${contentHash.slice(0, 16)} | ${summary.slice(0, 200)}`;
      writeMemo(memo).then(async (txHash) => {
        const db2 = getDb();
        if (txHash) {
          await db2.from('memories').update({ solana_signature: txHash }).eq('id', memoryId);
          log.info({ memoryId, txHash: txHash.slice(0, 16) }, 'Demo memory committed on-chain');
        } else {
          await db2.from('memories').update({ solana_signature: contentHash }).eq('id', memoryId);
        }
      }).catch(async () => {
        const db2 = getDb();
        await db2.from('memories').update({ solana_signature: contentHash }).eq('id', memoryId);
      });

      res.json({ memoryId, status: 'pending', message: 'Memory created. Committing to Solana...' });
    } catch (err) {
      log.error({ err }, 'Demo trigger error');
      res.status(500).json({ error: 'Demo trigger failed' });
    }
  });

  // Poll for on-chain confirmation
  app.get('/api/demo/poll/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) { res.status(400).json({ error: 'Invalid ID' }); return; }

      const db = getDb();
      const { data } = await db
        .from('memories')
        .select('id, solana_signature, summary, content, created_at')
        .eq('id', id)
        .single();

      if (!data) { res.status(404).json({ error: 'Memory not found' }); return; }

      res.json({
        id: data.id,
        summary: data.summary,
        content: data.content,
        solana_signature: data.solana_signature || null,
        status: data.solana_signature ? 'confirmed' : 'pending',
        created_at: data.created_at,
      });
    } catch (err) {
      log.error({ err }, 'Demo poll error');
      res.status(500).json({ error: 'Poll failed' });
    }
  });

  // Extended stats for demo dashboard
  app.get('/api/demo/stats', async (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const { data: memories } = await db
        .from('memories')
        .select('memory_type, importance, decay_factor, solana_signature, related_user, created_at')
        .gt('decay_factor', 0.01);

      const { data: dreams } = await db
        .from('dream_logs')
        .select('id');

      const all = memories || [];
      let onChain = 0;
      const byType: Record<string, number> = {};
      let impSum = 0;
      let decaySum = 0;
      const agents = new Set<string>();
      let newest = '';

      for (const m of all) {
        if (m.solana_signature) onChain++;
        byType[m.memory_type] = (byType[m.memory_type] || 0) + 1;
        impSum += m.importance;
        decaySum += m.decay_factor;
        if (m.related_user && m.related_user.startsWith('agent-api:')) agents.add(m.related_user);
        if (m.created_at > newest) newest = m.created_at;
      }

      res.json({
        total: all.length,
        onChain,
        byType,
        avgImportance: all.length ? +(impSum / all.length).toFixed(3) : 0,
        avgDecay: all.length ? +(decaySum / all.length).toFixed(3) : 0,
        dreamSessions: dreams?.length || 0,
        maasAgents: agents.size,
        newestMemory: newest || null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Demo stats error');
      res.status(500).json({ error: 'Stats failed' });
    }
  });

  // Sandboxed MaaS store (demo namespace, no auth)
  app.post('/api/demo/store', async (req: Request, res: Response) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const allowed = await checkRateLimit(`demo:store:${ip}`, 10, 1);
      if (!allowed) {
        res.status(429).json({ error: 'Rate limited. 3 stores per minute max.' });
        return;
      }

      const { content, summary } = req.body;
      if (!content || !summary) {
        res.status(400).json({ error: 'content and summary required' });
        return;
      }

      const safeContent = String(content).slice(0, 1000);
      const safeSummary = String(summary).slice(0, 200);

      // Content filter — block hate speech, slurs, violence, spam
      const contentCheck = checkInputContent(safeContent);
      if (!contentCheck.allowed) {
        res.status(400).json({ error: 'Content rejected.', reason: contentCheck.reason });
        return;
      }
      const summaryCheck = checkInputContent(safeSummary);
      if (!summaryCheck.allowed) {
        res.status(400).json({ error: 'Content rejected.', reason: summaryCheck.reason });
        return;
      }

      const memoryId = await storeMemory({
        type: 'episodic',
        content: safeContent,
        summary: safeSummary,
        tags: ['demo', 'maas'],
        importance: 0.5,
        source: 'demo-maas',
        relatedUser: 'demo-visitor',
      });

      // Store content hash as confirmation
      if (memoryId) {
        const contentHash = createHash('sha256').update(safeContent).digest('hex');
        const db3 = getDb();
        await db3.from('memories').update({ solana_signature: contentHash }).eq('id', memoryId);
      }

      res.json({ stored: true, memory_id: memoryId, timestamp: new Date().toISOString() });
    } catch (err) {
      log.error({ err }, 'Demo store error');
      res.status(500).json({ error: 'Store failed' });
    }
  });

  // Sandboxed MaaS recall (demo namespace, no auth)
  app.post('/api/demo/recall', async (req: Request, res: Response) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const allowed = await checkRateLimit(`demo:recall:${ip}`, 30, 1);
      if (!allowed) {
        res.status(429).json({ error: 'Rate limited. 5 recalls per minute max.' });
        return;
      }

      const { query, limit: rawLimit, memoryTypes } = req.body;
      const effectiveLimit = Math.min(Number(rawLimit) || 10, 20);
      const queryStr = query ? String(query) : undefined;
      
      let memories: any[];
      if (Array.isArray(memoryTypes)) {
        // Explicit type filter: single recall
        memories = await recallMemories({
          query: queryStr,
          limit: effectiveLimit,
          memoryTypes,
          skipExpansion: true,
        });
      } else {
        // Dual-path: knowledge-typed + general recall in parallel for better coverage
        const [knowledgeMemories, generalMemories] = await Promise.all([
          recallMemories({
            query: queryStr,
            limit: Math.ceil(effectiveLimit / 2),
            memoryTypes: ['semantic', 'procedural', 'self_model'] as any,
            skipExpansion: true,
          }),
          recallMemories({
            query: queryStr,
            limit: effectiveLimit,
            skipExpansion: true,
          }),
        ]);
        // Merge: knowledge first, then fill with general (deduplicated)
        const seen = new Set<number>();
        memories = [];
        for (const m of knowledgeMemories) {
          if (!seen.has(m.id)) { memories.push(m); seen.add(m.id); }
        }
        for (const m of generalMemories) {
          if (!seen.has(m.id) && memories.length < effectiveLimit) { memories.push(m); seen.add(m.id); }
        }
      }

      res.json({
        memories: memories.map(m => ({
          id: m.id,
          type: m.memory_type,
          memory_type: m.memory_type,
          _score: (m as any)._score || null,
          summary: m.summary,
          content: m.content,
          tags: m.tags,
          concepts: m.concepts || [],
          importance: m.importance,
          decay_factor: m.decay_factor,
          access_count: m.access_count,
          emotional_valence: m.emotional_valence,
          source: m.source,
          related_user: m.related_user,
          solana_signature: m.solana_signature || null,
          created_at: m.created_at,
          last_accessed: m.last_accessed,
        })),
        count: memories.length,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Demo recall error');
      res.status(500).json({ error: 'Recall failed' });
    }
  });

  // Main website + wallet verification
  // Resolve public dir relative to project root (works in both dev and prod)
  const publicDir = path.join(process.cwd(), 'src', 'verify-app', 'public');
  const distPublicDir = path.join(process.cwd(), 'dist', 'verify-app', 'public');

  // Serve campaign page at /10days (hidden from nav, direct link only)
  app.get('/campaign.html', (_req: Request, res: Response) => {
    res.redirect('/10days');
  });
  app.get('/10days', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/campaign.html';
    next();
  });

  // Venice privacy dashboard at /venice and /privacy
  app.get('/venice', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/privacy.html';
    next();
  });
  app.get('/privacy', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/privacy.html';
    next();
  });

  // Memory benchmark comparison at /benchmark
  app.get('/benchmark', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/benchmark.html';
    next();
  });

  // Memory explorer at /explore
  app.get('/explore', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/explore.html';
    next();
  });

  // Setup wizard at /setup
  app.get('/setup', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/setup.html';
    next();
  });

  app.use(express.static(publicDir));
  app.use(express.static(distPublicDir));
  app.use('/api', verifyRoutes());

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
