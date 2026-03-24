import express, { Request, Response } from 'express';
import path from 'path';
import { config } from '../config';
import { verifyRoutes } from '../verify-app/routes';
import { getMarketSnapshot } from '../core/allium-client';
import { getMemoryStats, getRecentMemories, storeMemory, recallMemories } from '../core/memory';
import { getDb, checkRateLimit } from '../core/database';
import { writeMemo, solscanTxUrl } from '../core/solana-client';
import { createHash } from 'crypto';
import { agentRoutes } from './agent-routes';
import { cortexRoutes } from './cortex-routes';
import { graphRoutes } from './graph-routes';
import { campaignRoutes } from './campaign-routes';
import { chatRoutes } from './chat-routes';
import { topupWebhookRoutes, topupApiRoutes } from './topup-routes';
import { getOpenRouterStats } from '../core/openrouter-client';
import { isWebSearchEnabled } from '../core/web-search';
import { createChildLogger } from '../core/logger';
import { checkInputContent } from '../core/guardrails';
import { withOwnerWallet } from '../core/owner-context';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { requirePrivyAuth, optionalPrivyAuth } from './privy-auth';
import { traceMemory, explainMemory } from '../features/memory-trace';
import { dashboardRoutes, autoRegisterClude } from './dashboard-routes';
import { compoundRoutes } from './compound-routes';

const log = createChildLogger('server');

/**
 * Resolve owner scope from request: ?wallet= param preferred (Solana address).
 * Falls back to Privy user ID only if no wallet param.
 * The frontend MUST send ?wallet= for proper memory scoping.
 */
function getRequestOwner(req: Request): string | null {
  const wallet = req.query.wallet as string | undefined;
  if (wallet) return wallet;
  // Privy DID fallback — won't match owner_wallet in memories table,
  // but prevents unscoped data leaking. Frontend should always send ?wallet=.
  if (req.privyUser?.userId) {
    log.debug({ privyUserId: req.privyUser.userId }, 'No wallet param, falling back to Privy DID (memories will likely be empty)');
    return req.privyUser.userId;
  }
  return null;
}

/**
 * Run a function scoped to the request owner. Returns null if no owner (never unscoped).
 * All users (including bot owner) scope by their wallet address in owner_wallet column.
 */
async function withRequestScope<T>(req: Request, fn: () => Promise<T>): Promise<T | null> {
  const owner = getRequestOwner(req);
  if (!owner) return null;
  return withOwnerWallet(owner, fn);
}

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many API requests' },
});

export function createServer(): express.Application {
  const app = express();

  // Trust reverse proxy (Railway, etc.) for correct IP in rate limiting
  app.set('trust proxy', 1);

  app.use(express.json());

  // Gzip/Brotli compression — skip SSE streams (they flush per-chunk)
  app.use(compression({
    filter: (req, res) => {
      if (res.getHeader('Content-Type') === 'text/event-stream') return false;
      return compression.filter(req, res);
    },
  }));

  // CORS headers for Cortex SDK (browser-based consumers)
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Security headers
  app.use((_req, res, next) => {
    res.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('X-Frame-Options', 'SAMEORIGIN');
    res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // Health check — always return 200 so Railway marks the deploy healthy.
  // DB status is informational only.
  app.get('/health', async (_req: Request, res: Response) => {
    try {
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

  // Apply rate limiting to all API routes
  app.use('/api', apiLimiter);

  // Attach Privy user to all API requests (optional — doesn't block unauthenticated)
  app.use('/api', optionalPrivyAuth);

  // Prevent browser/CDN caching of API responses (data is user-scoped)
  app.use('/api', (_req: Request, res: Response, next: express.NextFunction) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
  });

  // Solana RPC proxy — keeps the Helius API key server-side.
  // The chat frontend uses this endpoint instead of calling Helius directly.
  app.post('/api/solana-rpc', async (req: Request, res: Response) => {
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

  // Inference stats (privacy dashboard) — intentionally unscoped/global
  const handleInferenceStats = async (_req: Request, res: Response) => {
    try {
      const inferenceStats = await getOpenRouterStats();
      const memoryStats = await getMemoryStats();
      res.json({
        inference: inferenceStats,
        webSearch: { provider: isWebSearchEnabled() ? 'tavily' : null },
        decentralization: {
          inference: 'OpenRouter (unified routing)',
          memory: 'Solana (on-chain, verifiable)',
          embeddings: 'Voyage AI (private indexing)',
          totalMemoriesOnChain: memoryStats.total,
          embeddedCount: memoryStats.embeddedCount,
        },
      });
    } catch (err) {
      log.error({ err }, 'Inference stats endpoint error');
      res.status(500).json({ error: 'Failed to fetch inference stats' });
    }
  };
  app.get('/api/inference-stats', handleInferenceStats);
  app.get('/api/venice-stats', handleInferenceStats); // backward compat

  // Memory stats API (for frontend cortex visualization)
  app.get('/api/memory-stats', async (req: Request, res: Response) => {
    try {
      const owner = getRequestOwner(req);
      const stats = await withRequestScope(req, () => getMemoryStats());
      if (!stats) {
        // No owner identity — return empty stats, never unscoped data
        res.json({ total: 0, byType: {}, embeddedCount: 0, avgDecay: 0, avgImportance: 0, uniqueUsers: 0, totalDreamSessions: 0, topTags: [], topConcepts: [], scoped_to: null });
        return;
      }
      res.json({ ...stats, scoped_to: owner });
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
      const owner = getRequestOwner(req);
      const memories = await withRequestScope(req, () => getRecentMemories(hours, undefined, limit));
      if (!memories) {
        // No owner identity — return empty, never unscoped data
        res.json({ memories: [], count: 0, scoped_to: null, lastUpdate: new Date().toISOString() });
        return;
      }
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
        scoped_to: owner,
        lastUpdate: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Memories endpoint error');
      res.status(500).json({ error: 'Failed to fetch memories' });
    }
  });

  // ── Memory Provenance API ──────────────────────────────────────────

  // Trace a memory's full ancestry, descendants, and related memories
  app.get('/api/memory/:id/trace', optionalPrivyAuth, async (req: Request, res: Response) => {
    try {
      const memoryId = parseInt(req.params.id);
      if (isNaN(memoryId)) {
        res.status(400).json({ error: 'Invalid memory ID' });
        return;
      }
      const maxDepth = Math.min(parseInt(req.query.depth as string) || 3, 5);

      // Verify the requesting user owns this memory
      const owner = getRequestOwner(req);
      if (!owner) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      const db = getDb();
      const { data: mem } = await db.from('memories').select('owner_wallet').eq('id', memoryId).single();
      if (!mem) {
        res.status(404).json({ error: 'Memory not found' });
        return;
      }
      if (mem.owner_wallet !== owner) {
        res.status(403).json({ error: 'Cannot trace this memory' });
        return;
      }

      const trace = await traceMemory(memoryId, maxDepth);
      if (!trace) {
        res.status(404).json({ error: 'Memory not found' });
        return;
      }
      res.json(trace);
    } catch (err) {
      log.error({ err }, 'Memory trace error');
      res.status(500).json({ error: 'Failed to trace memory' });
    }
  });

  // Explain a memory — "why did you think this?"
  app.post('/api/memory/:id/explain', optionalPrivyAuth, async (req: Request, res: Response) => {
    try {
      const memoryId = parseInt(req.params.id);
      if (isNaN(memoryId)) {
        res.status(400).json({ error: 'Invalid memory ID' });
        return;
      }
      const { question } = req.body;
      if (!question || typeof question !== 'string') {
        res.status(400).json({ error: 'Missing "question" in request body' });
        return;
      }

      // Verify the requesting user owns this memory
      const owner = getRequestOwner(req);
      if (!owner) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      const db = getDb();
      const { data: mem } = await db.from('memories').select('owner_wallet').eq('id', memoryId).single();
      if (!mem || mem.owner_wallet !== owner) {
        res.status(403).json({ error: 'Cannot explain this memory' });
        return;
      }

      const result = await explainMemory(memoryId, question);
      if (!result) {
        res.status(404).json({ error: 'Memory not found or explanation failed' });
        return;
      }
      res.json(result);
    } catch (err) {
      log.error({ err }, 'Memory explain error');
      res.status(500).json({ error: 'Failed to explain memory' });
    }
  });

  // Verify a memory's on-chain commitment
  app.get('/api/memory/:id/verify', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid memory ID' });
        return;
      }
      const db = getDb();
      const { data: mem, error } = await db.from('memories')
        .select('id, content, summary, memory_type, created_at, owner_wallet, onchain_tx, onchain_hash, onchain_committed_at')
        .eq('id', id)
        .single();

      if (error || !mem) {
        res.status(404).json({ error: 'Memory not found' });
        return;
      }

      // Only allow verifying memories owned by the requester
      const requestWallet = req.query.wallet as string;
      if (!requestWallet || mem.owner_wallet !== requestWallet) {
        res.status(403).json({ error: 'Not authorized to verify this memory' });
        return;
      }

      if (!mem.onchain_tx) {
        res.json({
          id: mem.id,
          committed: false,
          message: 'This memory has not been committed on-chain yet.',
        });
        return;
      }

      // Recompute hash to verify integrity
      const payload = [
        mem.id.toString(),
        mem.content || '',
        mem.summary || '',
        mem.memory_type || 'episodic',
        mem.created_at || '',
        mem.owner_wallet || 'public',
      ].join('|');
      const computedHash = createHash('sha256').update(payload).digest('hex');
      const verified = computedHash === mem.onchain_hash;

      res.json({
        id: mem.id,
        committed: true,
        verified,
        onchain_tx: mem.onchain_tx,
        onchain_hash: mem.onchain_hash,
        committed_at: mem.onchain_committed_at,
        explorer: `https://solscan.io/tx/${mem.onchain_tx}`,
        integrity: verified ? 'VERIFIED' : 'HASH_MISMATCH',
      });
    } catch (err) {
      log.error({ err }, 'Memory verify error');
      res.status(500).json({ error: 'Failed to verify memory' });
    }
  });

  // Brain visualization API (full graph data for neural network viz)
  // Falls back to OWNER_WALLET for unauthenticated public preview (brain.html)
  app.get('/api/brain', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 300, 500);
      if (!req.query.wallet && config.owner.wallet) {
        req.query.wallet = config.owner.wallet;
      }
      const result = await withRequestScope(req, () =>
        Promise.all([getRecentMemories(8760, undefined, limit), getMemoryStats()])
      );
      if (!result) {
        res.json({ memories: [], total: 0, timestamp: new Date().toISOString() });
        return;
      }
      const [memories, stats] = result;
      res.json({
        memories: memories.map(m => ({
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
  // Falls back to OWNER_WALLET for unauthenticated public preview
  app.get('/api/brain/consciousness', async (req: Request, res: Response) => {
    try {
      if (!req.query.wallet && config.owner.wallet) {
        req.query.wallet = config.owner.wallet;
      }
      const result = await withRequestScope(req, () =>
        Promise.all([
          getRecentMemories(8760, ['self_model'], 10),
          getRecentMemories(8760, ['self_model'], 20),
          getRecentMemories(8760, ['procedural'], 10),
          getRecentMemories(24, ['episodic'], 5),
          getMemoryStats(),
        ])
      );
      if (!result) {
        res.json({ selfModel: [], recentDreams: [], stats: { total: 0 } });
        return;
      }
      const [selfModel, emergence, procedural, recentEpisodic, stats] = result;

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

  // Agent Dashboard (orchestration & monitoring)
  app.use('/api/dashboard', dashboardRoutes());

  // Chat API (memory-augmented chat with OpenRouter inference)
  app.use('/api/chat', chatRoutes());

  // Chat billing: balance, top-up confirmation, history
  app.use('/api/chat', topupApiRoutes());

  // Helius webhook (USDC payment detection — outside /api to avoid API rate limiter)
  app.use('/webhook', topupWebhookRoutes());

  // Campaign: 10 Days of Growing a Blockchain Brain
  app.use('/api/campaign', apiLimiter, campaignRoutes());

  // Compound: Prediction Market Intelligence
  app.use('/api/compound', compoundRoutes());

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
      // Use withOwnerWallet to scope query to the requested wallet
      const result = await withOwnerWallet(wallet, async () => {
        return Promise.all([getRecentMemories(8760, undefined, limit), getMemoryStats()]);
      });
      const [walletMemories, stats] = result;

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

  // Export memory pack (paginated — handles 25K+ memories)
  app.post('/api/memory-packs/export', requirePrivyAuth, async (req: Request, res: Response) => {
    try {
      const { name, description, tags, types } = req.body;
      if (!name) { res.status(400).json({ error: 'name is required' }); return; }

      const owner = getRequestOwner(req);
      if (!owner) { res.json({ memories: [], memory_count: 0 }); return; }

      // Paginate through all memories (Supabase caps at 1000/query)
      const db = getDb();
      let allMemories: any[] = [];
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        let query = db.from('memories')
          .select('id, memory_type, content, summary, tags, concepts, importance, decay_factor, emotional_valence, access_count, source, source_id, created_at, last_accessed, solana_signature, evidence_ids')
          .eq('owner_wallet', owner)
          .order('importance', { ascending: false })
          .range(offset, offset + PAGE - 1);

        if (types && types.length > 0) {
          query = query.in('memory_type', types);
        }

        const { data, error } = await query;
        if (error) { log.error({ err: error }, 'Export pagination error'); break; }
        if (!data || data.length === 0) break;

        allMemories = allMemories.concat(data);
        offset += data.length;

        // Safety cap at 50K to prevent OOM
        if (allMemories.length >= 50000) break;
        if (data.length < PAGE) break;
      }

      let memories = allMemories;

      // Filter by tags if provided
      if (tags && tags.length > 0) {
        memories = memories.filter(m => m.tags.some((t: string) => tags.includes(t)));
      }

      // Build entities list (use first 1000 IDs to avoid query size limits)
      const memoryIds = memories.slice(0, 1000).map(m => m.id);
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

  // Smart export (AI-synthesized context brief)
  app.post('/api/memory-packs/smart-export', requirePrivyAuth, async (req: Request, res: Response) => {
    try {
      const { name, provider } = req.body;
      if (!name) { res.status(400).json({ error: 'name is required' }); return; }

      const validProviders = ['chatgpt', 'claude', 'gemini'];
      const targetProvider = validProviders.includes(provider) ? provider : 'claude';

      const owner = getRequestOwner(req);
      if (!owner) { res.status(401).json({ error: 'Authentication required' }); return; }

      const openrouterApiKey = process.env.OPENROUTER_API_KEY;
      if (!openrouterApiKey) { res.status(500).json({ error: 'OpenRouter API not configured' }); return; }

      // Paginate all memories
      const db = getDb();
      let allMemories: any[] = [];
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        const { data, error: dbErr } = await db.from('memories')
          .select('memory_type, summary, content, importance, tags, created_at')
          .eq('owner_wallet', owner)
          .order('importance', { ascending: false })
          .range(offset, offset + PAGE - 1);
        if (dbErr || !data || data.length === 0) break;
        allMemories = allMemories.concat(data);
        offset += data.length;
        if (allMemories.length >= 50000 || data.length < PAGE) break;
      }

      if (allMemories.length === 0) {
        res.status(404).json({ error: 'No memories found' });
        return;
      }

      // Build condensed input grouped by type
      const byType: Record<string, any[]> = {};
      for (const m of allMemories) {
        (byType[m.memory_type || 'episodic'] ??= []).push(m);
      }

      const sections: string[] = [];
      const allBullets: string[] = [];
      for (const [type, mems] of Object.entries(byType)) {
        const sorted = mems.sort((a: any, b: any) => (b.importance || 0) - (a.importance || 0));
        const forLLM = sorted.slice(0, type === 'episodic' ? 300 : 150);
        sections.push(`\n## ${type.toUpperCase()} (${mems.length} total, top ${forLLM.length} shown)\n`);
        for (const m of forLLM) {
          const date = m.created_at ? new Date(m.created_at).toISOString().slice(0, 10) : '';
          sections.push(`- [${date}] ${m.summary || m.content?.slice(0, 200)}`);
        }
        for (const m of sorted) {
          const date = m.created_at ? new Date(m.created_at).toISOString().slice(0, 10) : '';
          allBullets.push(`[${type}] - [${date}] ${m.summary || m.content?.slice(0, 200)}`);
        }
      }

      const typeCounts = Object.entries(byType).map(([t, arr]) => `${t}: ${arr.length}`).join(', ');

      const providerFormats: Record<string, string> = {
        claude: 'Format using XML tags: <user_profile>, <projects>, <decisions>, <knowledge>, <style>, <relationships>, <timeline>. Wrap in <context> tags.',
        chatgpt: 'Format using Markdown ## headers and bullets. Start with "# Memory Context". Add intro: "You are continuing a conversation with a user. Below is everything you know about them."',
        gemini: 'Format using Markdown ## headers and bullets. Start with "# Memory Context". Add intro: "You have persistent memory about this user from Clude. Use this context naturally."',
      };

      const targetName = targetProvider === 'chatgpt' ? 'ChatGPT' : targetProvider === 'gemini' ? 'Gemini' : 'Claude';

      const llmRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openrouterApiKey}`,
        },
        body: JSON.stringify({
          model: 'anthropic/claude-sonnet-4-6',
          messages: [
            { role: 'system', content: 'You are an expert at synthesizing information into structured context documents.' },
            { role: 'user', content: `Analyze this user's ${allMemories.length} memories (${typeCounts}) and create a comprehensive context document optimized for ${targetName}.

Sections needed:
1. **User Profile** — Who they are, role, background, expertise
2. **Active Projects** — Current work with status and details
3. **Key Decisions & Reasoning** — Important choices and WHY
4. **Technical Knowledge** — Tools, stack, preferences, lessons
5. **Working Style** — Communication preferences, work patterns
6. **Important Relationships** — People, teams, partners
7. **Recent Timeline** — Last 2 weeks chronologically

${providerFormats[targetProvider] || providerFormats.claude}

Rules: Third person, be specific (names, dates, numbers), explain relationships between facts, under 3000 words.

Memories:
${sections.join('\n')}` },
          ],
          max_tokens: 4096,
          temperature: 0.3,
        }),
      });

      if (!llmRes.ok) {
        log.error({ status: llmRes.status }, 'OpenRouter synthesis failed');
        res.status(500).json({ error: 'Synthesis failed' });
        return;
      }

      const llmData = await llmRes.json() as any;
      const synthesis = llmData.choices?.[0]?.message?.content;
      if (!synthesis) { res.status(500).json({ error: 'Empty synthesis' }); return; }

      res.json({
        name,
        format: 'smart',
        memory_count: allMemories.length,
        type_breakdown: Object.fromEntries(Object.entries(byType).map(([t, arr]) => [t, arr.length])),
        content: (targetProvider === 'claude'
          ? `<context>\nSynthesized from ${allMemories.length} memories by Clude. Generated: ${new Date().toISOString().slice(0, 10)}\n\n${synthesis}\n</context>`
          : `${synthesis}\n\n---\nSynthesized from ${allMemories.length} memories by Clude. Generated: ${new Date().toISOString().slice(0, 10)}`)
          + `\n\n---\n\n# Full Memory Log (${allMemories.length} memories)\n\n${allBullets.join('\n')}`,
        generated_at: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Smart export error');
      res.status(500).json({ error: 'Smart export failed' });
    }
  });

  // List memory packs (stub — packs aren't persisted yet, returns empty)
  app.get('/api/memory-packs', optionalPrivyAuth, async (_req: Request, res: Response) => {
    res.json([]);
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
        .is('owner_wallet', null)
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
        .gt('decay_factor', 0.01)
        .is('owner_wallet', null);

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
        res.status(429).json({ error: 'Rate limited. 10 stores per minute max.' });
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

      const memoryId = await withOwnerWallet('demo-namespace', async () => storeMemory({
        type: 'episodic',
        content: safeContent,
        summary: safeSummary,
        tags: ['demo', 'maas'],
        importance: 0.5,
        source: 'demo-maas',
        relatedUser: 'demo-visitor',
      }));

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
        res.status(429).json({ error: 'Rate limited. 30 recalls per minute max.' });
        return;
      }

      const { query, limit: rawLimit, memoryTypes } = req.body;
      const effectiveLimit = Math.min(Number(rawLimit) || 10, 20);
      const queryStr = query ? String(query) : undefined;
      
      let memories: any[];
      memories = await withOwnerWallet('demo-namespace', async () => {
        if (Array.isArray(memoryTypes)) {
          return recallMemories({
            query: queryStr,
            limit: effectiveLimit,
            memoryTypes,
            skipExpansion: true,
          });
        } else {
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
          const seen = new Set<number>();
          const merged: any[] = [];
          for (const m of knowledgeMemories) {
            if (!seen.has(m.id)) { merged.push(m); seen.add(m.id); }
          }
          for (const m of generalMemories) {
            if (!seen.has(m.id) && merged.length < effectiveLimit) { merged.push(m); seen.add(m.id); }
          }
          return merged;
        }
      });

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

  // Aliases: /api/memory/* → re-route through Express stack to /api/demo/*
  const reRoute = (target: string) => (req: Request, res: Response) => {
    req.url = target;
    req.originalUrl = target;
    app(req, res);
  };
  app.post('/api/memory/store', reRoute('/api/demo/store'));
  app.post('/api/memory/recall', reRoute('/api/demo/recall'));
  app.get('/api/memory/stats', reRoute('/api/demo/stats'));

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

  // Memory provenance at /trace
  app.get('/trace', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/trace.html';
    next();
  });

  // React dashboard at /dashboard (SPA with client-side routing)
  const dashboardDir = path.join(publicDir, 'dashboard');
  const distDashboardDir = path.join(distPublicDir, 'dashboard');
  app.use('/dashboard', express.static(dashboardDir, { maxAge: '1h', setHeaders: (res, filePath) => { if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); } }));
  app.use('/dashboard', express.static(distDashboardDir, { maxAge: '1h', setHeaders: (res, filePath) => { if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); } }));
  app.get('/dashboard/*', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const indexPath = path.join(dashboardDir, 'index.html');
    const distIndexPath = path.join(distDashboardDir, 'index.html');
    if (require('fs').existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.sendFile(distIndexPath);
    }
  });
  // Redirect bare /dashboard to /dashboard/
  app.get('/dashboard', (_req: Request, res: Response) => {
    res.redirect('/dashboard/');
  });

  // Chat interface at /chat (SPA with client-side routing)
  const chatDir = path.join(publicDir, 'chat');
  const distChatDir = path.join(distPublicDir, 'chat');
  // Serve chat SPA index.html with no-cache (prevents Railway edge from caching stale HTML)
  const serveChatIndex = (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    const indexPath = path.join(chatDir, 'index.html');
    const distIndexPath = path.join(distChatDir, 'index.html');
    if (require('fs').existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.sendFile(distIndexPath);
    }
  };
  // Catch /chat/ and all SPA routes BEFORE static middleware
  app.get('/chat/', serveChatIndex);
  app.get('/chat', (_req: Request, res: Response) => { res.redirect('/chat/'); });
  // Static assets (JS, CSS, images) — long cache is fine, filenames are hashed
  app.use('/chat', express.static(chatDir, { maxAge: '7d' }));
  app.use('/chat', express.static(distChatDir, { maxAge: '7d' }));
  // SPA fallback for client-side routes
  app.get('/chat/*', serveChatIndex);

  // Register page — Cortex API key registration
  app.get('/register', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/register.html';
    next();
  });

  // Install page — agent-facing pitch + instructions
  app.get('/install', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/install.html';
    next();
  });

  // Compare page — benchmark vs competitors
  app.get('/compare', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/compare.html';
    next();
  });

  // Agents page — alias for install
  app.get('/agents', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/install.html';
    next();
  });

  // Portability (export/import docs) at /portability
  app.get('/portability', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/portability.html';
    next();
  });

  // Journal (active reflection diary) at /journal
  app.get('/journal', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/journal.html';
    next();
  });

  // Journal API — fetch introspective + self_model + emergence memories
  app.get('/api/journal', async (req: Request, res: Response) => {
    try {
      const result = await withRequestScope(req, async () => {
        const db = getDb();

        // Fetch journal-worthy memories: introspective, self_model (reflections), emergence
        const { data, error } = await db
          .from('memories')
          .select('id, memory_type, content, summary, tags, importance, decay_factor, created_at, source')
          .in('source', ['active_reflection', 'reflection', 'emergence', 'consolidation'])
          .gte('decay_factor', 0.05)
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) throw error;
        return data || [];
      });

      const entries = result || [];

      // Count total reflection sessions (unique dates with reflection entries)
      const sessionDates = new Set(
        entries.map((m: any) => new Date(m.created_at).toISOString().slice(0, 10))
      );

      res.json({
        entries,
        sessionCount: sessionDates.size,
        total: entries.length,
      });
    } catch (err: any) {
      log.error({ err }, 'Journal API error');
      res.json({ entries: [], sessionCount: 0, total: 0 });
    }
  });

  // Brain visualization at /brain
  app.get('/brain', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/brain.html';
    next();
  });

  // Documentation at /docs
  app.get('/docs', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/docs.html';
    next();
  });

  // Memory explorer at /explore
  app.get('/explore', (req: Request, _res: Response, next: express.NextFunction) => {
    req.url = '/explore.html';
    next();
  });

  // Redirect /setup to dashboard setup page
  app.get('/setup', (_req: Request, res: Response) => {
    res.redirect('/dashboard/setup');
  });

  // Redirect old /dashboard-new to /dashboard
  app.get('/dashboard-new*', (_req: Request, res: Response) => {
    res.redirect('/dashboard/');
  });

  // Sample memory packs
  const samplesDir = path.join(__dirname, '..', 'verify-app', 'public', 'samples');
  app.use('/samples', express.static(samplesDir));

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
      // Auto-register Clude as the first dashboard agent
      autoRegisterClude().catch(err => log.warn({ err }, 'Auto-register Clude failed'));
      resolve();
    });
  });
}
