import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import { getMemoryStats, getRecentMemories } from '@clude/brain/memory';
import { getDb } from '@clude/shared/core/database';
import { verifyMemoTransaction } from '@clude/shared/core/solana-client';
import { getOpenRouterStats } from '@clude/shared/core/openrouter-client';
import { isWebSearchEnabled } from '@clude/shared/core/web-search';
import { requirePrivyAuth, optionalPrivyAuth } from '@clude/brain/auth/privy-auth';
import { requireOwnership, optionalOwnership } from '@clude/brain/auth/require-ownership';
import { traceMemory, explainMemory } from '@clude/brain/memory/trace';
import { withOwnerWallet } from '@clude/shared/core/owner-context';
import { createChildLogger } from '@clude/shared/core/logger';
import { checkRateLimit } from '@clude/shared/utils/rate-limit';

const log = createChildLogger('memory-routes');

/**
 * Resolve owner scope from request: ?wallet= param preferred (Solana address).
 * Falls back to Privy user ID only if no wallet param.
 */
function getRequestOwner(req: Request): string | null {
  const wallet = req.query.wallet as string | undefined;
  if (wallet) return wallet;
  if (req.privyUser?.userId) {
    log.debug({ privyUserId: req.privyUser.userId }, 'No wallet param, falling back to Privy DID');
    return req.privyUser.userId;
  }
  return null;
}

async function withRequestScope<T>(req: Request, fn: () => Promise<T>): Promise<T | null> {
  const owner = getRequestOwner(req);
  if (!owner) return null;
  return withOwnerWallet(owner, fn);
}

export function memoryRoutes(): Router {
  const router = Router();

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
  router.get('/inference-stats', handleInferenceStats);
  router.get('/venice-stats', handleInferenceStats); // backward compat

  // Memory stats API (for frontend cortex visualization)
  router.get('/memory-stats', requirePrivyAuth, requireOwnership, async (req: Request, res: Response) => {
    try {
      const owner = getRequestOwner(req);
      const stats = await withRequestScope(req, () => getMemoryStats());
      if (!stats) {
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
  router.get('/memories', requirePrivyAuth, requireOwnership, async (req: Request, res: Response) => {
    try {
      const hours = Math.min(parseInt(req.query.hours as string) || 168, 720);
      const limit = Math.min(parseInt(req.query.limit as string) || 30, 50);
      const owner = getRequestOwner(req);
      const memories = await withRequestScope(req, () => getRecentMemories(hours, undefined, limit));
      if (!memories) {
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

  // Trace a memory's full ancestry, descendants, and related memories
  router.get('/memory/:id/trace', requirePrivyAuth, optionalOwnership, async (req: Request, res: Response) => {
    try {
      const memoryId = parseInt(req.params.id);
      if (isNaN(memoryId)) {
        res.status(400).json({ error: 'Invalid memory ID' });
        return;
      }
      const maxDepth = Math.min(parseInt(req.query.depth as string) || 3, 5);

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
  router.post('/memory/:id/explain', requirePrivyAuth, optionalOwnership, async (req: Request, res: Response) => {
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
  router.get('/memory/:id/verify', async (req: Request, res: Response) => {
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

  // Verify a memory by its Solana transaction signature
  router.get('/memories/verify', async (req: Request, res: Response) => {
    try {
      const tx = req.query.tx as string;
      const wallet = req.query.wallet as string;

      if (!tx || !wallet) {
        res.status(400).json({ error: 'Both tx and wallet query params are required' });
        return;
      }

      const allowed = await checkRateLimit(`verify:${wallet}`, 20, 1);
      if (!allowed) {
        res.status(429).json({ error: 'Rate limited. 20 verifications per minute max.' });
        return;
      }

      const db = getDb();
      const { data: mem, error } = await db.from('memories')
        .select('id, content, summary, memory_type, tags, created_at, owner_wallet, solana_signature')
        .eq('solana_signature', tx)
        .single();

      if (error || !mem) {
        res.status(404).json({ error: 'No memory found for this transaction signature' });
        return;
      }

      if (mem.owner_wallet !== wallet) {
        res.status(403).json({ error: 'Not authorized — wallet does not own this memory' });
        return;
      }

      const contentHashBuf = createHash('sha256').update(mem.content || '').digest();
      const computedHash = contentHashBuf.toString('hex');

      let onChainVerified = false;
      try {
        onChainVerified = await verifyMemoTransaction(tx, contentHashBuf);
      } catch {
        // Solana RPC may be unavailable
      }

      res.json({
        verified: onChainVerified,
        memory: {
          id: mem.id,
          type: mem.memory_type,
          summary: mem.summary,
          content: mem.content,
          tags: mem.tags || [],
          created_at: mem.created_at,
        },
        onChainHash: onChainVerified ? computedHash : null,
        computedHash,
        transactionSignature: tx,
        explorer: `https://solscan.io/tx/${tx}`,
      });
    } catch (err) {
      log.error({ err }, 'Memory verify-by-tx error');
      res.status(500).json({ error: 'Failed to verify memory' });
    }
  });

  // Brain visualization API (full graph data for neural network viz)
  router.get('/brain', requirePrivyAuth, requireOwnership, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 300, 500);
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
  router.get('/brain/consciousness', requirePrivyAuth, requireOwnership, async (req: Request, res: Response) => {
    try {
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

      const emergenceThoughts = emergence
        .filter(m => m.source === 'emergence')
        .slice(0, 5);
      const reflections = selfModel
        .filter(m => m.source === 'reflection')
        .slice(0, 5);

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

  // Owner verification
  router.get('/owner', requirePrivyAuth, async (req: Request, res: Response) => {
    try {
      const { getOwnerWallet } = require('@clude/brain/memory');
      const ownerWallet = getOwnerWallet();

      if (!ownerWallet) {
        res.json({ isOwner: false, reason: 'no_owner_configured' });
        return;
      }

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
  router.get('/user/brain', requirePrivyAuth, requireOwnership, async (req: Request, res: Response) => {
    try {
      const wallet = req.query.wallet as string;
      if (!wallet || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
        res.status(400).json({ error: 'Valid Solana wallet address required' });
        return;
      }

      const limit = Math.min(parseInt(req.query.limit as string) || 300, 500);
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

  // Journal API — fetch introspective + self_model + emergence memories
  router.get('/journal', requirePrivyAuth, requireOwnership, async (req: Request, res: Response) => {
    try {
      const result = await withRequestScope(req, async () => {
        const db = getDb();
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

  // Docs view counter
  router.get('/docs-views', async (_req: Request, res: Response) => {
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

  router.post('/docs-views', async (_req: Request, res: Response) => {
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

  return router;
}
