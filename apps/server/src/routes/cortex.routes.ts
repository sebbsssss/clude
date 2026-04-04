/**
 * Hosted Cortex API routes.
 *
 * Provides REST endpoints for SDK users in hosted mode.
 * Each request is scoped to the owner_wallet associated with the API key,
 * ensuring complete memory isolation between users on the same Supabase.
 *
 * Auth: Bearer token (same agent_keys table as agent-routes.ts).
 * Isolation: withOwnerWallet() sets per-request scope via AsyncLocalStorage.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { randomUUID, createHash } from 'crypto';
import { authenticateAgent, registerAgent, recordAgentInteraction, type AgentRegistration } from '@clude/brain/features/agent-tier';
import { withOwnerWallet } from '@clude/shared/core/owner-context';
import {
  storeMemory,
  recallMemories,
  recallMemorySummaries,
  hydrateMemories,
  getMemoryStats,
  getRecentMemories,
  getSelfModel,
  createMemoryLink,
  type MemoryType,
} from '@clude/brain/memory';
import { findClinamen } from '@clude/brain/memory/clinamen';
import type { MemoryLinkType } from '@clude/shared/utils/constants';
import { checkRateLimit } from '@clude/shared/utils/rate-limit';
import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('cortex-api');

// ---- Request types ---- //

interface CortexRequest extends Request {
  agent?: AgentRegistration;
  ownerWallet?: string;
}

// ---- Auth middleware ---- //

async function cortexAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization: Bearer <api_key> header' });
    return;
  }

  const apiKey = authHeader.slice(7);
  const agent = await authenticateAgent(apiKey);

  if (!agent) {
    res.status(401).json({ error: 'Invalid or inactive API key' });
    return;
  }

  // Resolve owner_wallet from the agent_keys row; auto-generate if missing
  let ownerWallet = agent.owner_wallet;
  if (!ownerWallet) {
    // Auto-assign a deterministic wallet-like ID so memories are scoped from the start
    ownerWallet = createHash('sha256').update(`cortex:${agent.agent_id}`).digest('hex').slice(0, 44);
    const db = getDb();
    await db.from('agent_keys').update({ owner_wallet: ownerWallet }).eq('id', agent.id);
    agent.owner_wallet = ownerWallet;
    log.info({ agentId: agent.agent_id, ownerWallet }, 'Auto-assigned owner_wallet for agent');
  }

  (req as CortexRequest).agent = agent;
  (req as CortexRequest).ownerWallet = ownerWallet ?? undefined;
  next();
}

// ---- Rate limiting ---- //

async function cortexRateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
  const cortexReq = req as CortexRequest;
  if (!cortexReq.agent) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const allowed = await checkRateLimit(
    `cortex:${cortexReq.agent.agent_id}`,
    120, // 120 requests per minute
    1,
  );

  if (!allowed) {
    res.status(429).json({ error: 'Rate limit exceeded', limit: 120, window: '1 minute' });
    return;
  }

  next();
}

// ---- Route factory ---- //

export function cortexRoutes(): Router {
  const router = Router();

  // Registration endpoint — NO auth required
  router.post('/register', async (req: Request, res: Response) => {
    try {
      const { name, wallet } = req.body;

      if (!name || typeof name !== 'string' || name.length < 2) {
        res.status(400).json({ error: 'name is required (2+ characters)' });
        return;
      }
      // Wallet is optional — validate format only if provided
      const validWallet = wallet && typeof wallet === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet) ? wallet : null;

      // Rate limit registrations: 3 per hour per IP
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const allowed = await checkRateLimit(`cortex:register:${ip}`, 10, 60);
      if (!allowed) {
        res.status(429).json({ error: 'Too many registration attempts. Try again in an hour.' });
        return;
      }

      const db = getDb();

      // Check if wallet already registered (only if wallet provided)
      if (validWallet) {
        const { data: existing } = await db
          .from('agent_keys')
          .select('id')
          .eq('owner_wallet', validWallet)
          .limit(1);

        if (existing && existing.length > 0) {
          res.status(409).json({ error: 'Wallet already registered. Contact support for key recovery.' });
          return;
        }
      }

      // Register using existing agent system
      const { agentId, apiKey } = await registerAgent(name, 'AGENT_VERIFIED');

      // Set owner_wallet on the agent_keys row (if provided)
      if (validWallet) {
        const { error: updateError } = await db
          .from('agent_keys')
          .update({ owner_wallet: validWallet })
          .eq('agent_id', agentId);

        if (updateError) {
          // Roll back: deactivate the key so it can't be used without a wallet
          await db.from('agent_keys').update({ is_active: false }).eq('agent_id', agentId);

          // Unique constraint violation = wallet was just claimed by another request
          if (updateError.code === '23505') {
            res.status(409).json({ error: 'Wallet already registered. Contact support for key recovery.' });
            return;
          }

          log.error({ err: updateError, agentId }, 'Failed to set owner_wallet');
          res.status(500).json({ error: 'Registration failed — could not link wallet' });
          return;
        }
      }

      log.info({ agentId, wallet: validWallet ? validWallet.slice(0, 8) + '...' : 'none' }, 'Cortex user registered');

      res.json({
        apiKey,
        agentId,
        wallet: validWallet,
        message: 'Save this API key — it will not be shown again.',
      });
    } catch (err) {
      log.error({ err }, 'Cortex registration error');
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  // All routes below require auth
  router.use(cortexAuth);
  router.use(cortexRateLimit);

  // POST /store — store a memory
  router.post('/store', async (req: Request, res: Response) => {
    try {
      const cortexReq = req as CortexRequest;
      const { content, summary, type, tags, concepts, importance, emotional_valence, source, source_id, related_user, related_wallet, metadata } = req.body;

      if (!content || typeof content !== 'string') {
        res.status(400).json({ error: 'content is required (string)' });
        return;
      }
      if (!summary || typeof summary !== 'string') {
        res.status(400).json({ error: 'summary is required (string)' });
        return;
      }

      // Sanitize HTML to prevent XSS when rendered in dashboards/explorers
      const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '').trim();

      const memoryType = (type || 'episodic') as MemoryType;
      const validTypes: MemoryType[] = ['episodic', 'semantic', 'procedural', 'self_model', 'introspective' as any];
      if (!validTypes.includes(memoryType)) {
        res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
        return;
      }

      const safeContent = stripHtml(content);
      const safeSummary = stripHtml(summary);

      const result = await withOwnerWallet(cortexReq.ownerWallet!, async () => {
        return storeMemory({
          type: memoryType,
          content: safeContent,
          summary: safeSummary,
          tags: tags || [],
          concepts: concepts || [],
          importance: importance ?? undefined,
          emotionalValence: emotional_valence ?? undefined,
          source: source || 'cortex-api',
          sourceId: source_id,
          relatedUser: related_user,
          relatedWallet: related_wallet,
          metadata: metadata || {},
        });
      });

      await recordAgentInteraction(cortexReq.agent!.agent_id);

      res.json({ stored: result !== null, memory_id: result });
    } catch (err) {
      log.error({ err }, 'Cortex store error');
      res.status(500).json({ error: 'Failed to store memory' });
    }
  });

  // POST /recall — recall memories
  router.post('/recall', async (req: Request, res: Response) => {
    try {
      const cortexReq = req as CortexRequest;
      const { query, tags, memory_types, limit, min_importance, min_decay, related_user, related_wallet, track_access, skip_expansion } = req.body;

      if (!query && !tags && !memory_types) {
        res.status(400).json({ error: 'At least one of query, tags, or memory_types is required' });
        return;
      }

      const memories = await withOwnerWallet(cortexReq.ownerWallet!, async () => {
        return recallMemories({
          query,
          tags,
          memoryTypes: memory_types,
          limit: Math.min(limit || 10, 50),
          minImportance: min_importance,
          minDecay: min_decay,
          relatedUser: related_user,
          relatedWallet: related_wallet,
          trackAccess: track_access,
          skipExpansion: skip_expansion,
        });
      });

      await recordAgentInteraction(cortexReq.agent!.agent_id);

      res.json({
        memories: memories.map((m: any) => ({
          id: m.id,
          type: m.memory_type,
          memory_type: m.memory_type,
          summary: m.summary,
          content: m.content,
          tags: m.tags,
          concepts: m.concepts || [],
          importance: m.importance,
          decay_factor: m.decay_factor,
          access_count: m.access_count,
          emotional_valence: m.emotional_valence,
          source: m.source,
          created_at: m.created_at,
          last_accessed: m.last_accessed,
          _score: (m as any)._score || null,
        })),
        count: memories.length,
      });
    } catch (err) {
      log.error({ err }, 'Cortex recall error');
      res.status(500).json({ error: 'Failed to recall memories' });
    }
  });

  // POST /recall/summaries — recall lightweight summaries
  router.post('/recall/summaries', async (req: Request, res: Response) => {
    try {
      const cortexReq = req as CortexRequest;
      const { query, tags, memory_types, limit, min_importance, min_decay } = req.body;

      const summaries = await withOwnerWallet(cortexReq.ownerWallet!, async () => {
        return recallMemorySummaries({
          query,
          tags,
          memoryTypes: memory_types,
          limit: Math.min(limit || 20, 100),
          minImportance: min_importance,
          minDecay: min_decay,
        });
      });

      await recordAgentInteraction(cortexReq.agent!.agent_id);
      res.json({ summaries, count: summaries.length });
    } catch (err) {
      log.error({ err }, 'Cortex recall summaries error');
      res.status(500).json({ error: 'Failed to recall summaries' });
    }
  });

  // POST /hydrate — fetch full content for memory IDs
  router.post('/hydrate', async (req: Request, res: Response) => {
    try {
      const cortexReq = req as CortexRequest;
      const { ids } = req.body;

      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: 'ids is required (number[])' });
        return;
      }
      if (ids.length > 100) {
        res.status(400).json({ error: 'Maximum 100 IDs per request' });
        return;
      }

      const memories = await withOwnerWallet(cortexReq.ownerWallet!, async () => {
        return hydrateMemories(ids);
      });

      await recordAgentInteraction(cortexReq.agent!.agent_id);
      res.json({ memories });
    } catch (err) {
      log.error({ err }, 'Cortex hydrate error');
      res.status(500).json({ error: 'Failed to hydrate memories' });
    }
  });

  // GET /stats — memory statistics
  router.get('/stats', async (req: Request, res: Response) => {
    try {
      const cortexReq = req as CortexRequest;

      const stats = await withOwnerWallet(cortexReq.ownerWallet!, async () => {
        return getMemoryStats();
      });

      await recordAgentInteraction(cortexReq.agent!.agent_id);
      res.json(stats);
    } catch (err) {
      log.error({ err }, 'Cortex stats error');
      res.status(500).json({ error: 'Failed to get stats' });
    }
  });

  // GET /recent — recent memories
  router.get('/recent', async (req: Request, res: Response) => {
    try {
      const cortexReq = req as CortexRequest;
      const hours = Math.min(parseInt(req.query.hours as string) || 6, 168); // max 7 days
      const types = req.query.types ? (req.query.types as string).split(',') as MemoryType[] : undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

      const memories = await withOwnerWallet(cortexReq.ownerWallet!, async () => {
        return getRecentMemories(hours, types, limit);
      });

      await recordAgentInteraction(cortexReq.agent!.agent_id);
      res.json({ memories, count: memories.length });
    } catch (err) {
      log.error({ err }, 'Cortex recent error');
      res.status(500).json({ error: 'Failed to get recent memories' });
    }
  });

  // GET /brain — brain visualization data (same format as /api/brain, wallet-scoped)
  router.get('/brain', async (req: Request, res: Response) => {
    try {
      const cortexReq = req as CortexRequest;
      const limit = Math.min(parseInt(req.query.limit as string) || 300, 500);

      const [memories, stats] = await withOwnerWallet(cortexReq.ownerWallet!, async () => {
        return Promise.all([
          getRecentMemories(8760, undefined, limit),
          getMemoryStats(),
        ]);
      });

      await recordAgentInteraction(cortexReq.agent!.agent_id);
      res.json({
        nodes: memories.map(m => ({
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
        total: stats.total,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Cortex brain endpoint error');
      res.status(500).json({ error: 'Failed to fetch brain data' });
    }
  });

  // GET /brain/graph — memories + memory_links for graph visualization
  router.get('/brain/graph', async (req: Request, res: Response) => {
    try {
      const cortexReq = req as CortexRequest;
      const limit = parseInt(req.query.limit as string) || 50000;

      const memories = await withOwnerWallet(cortexReq.ownerWallet!, async () => {
        return getRecentMemories(8760 * 10, undefined, limit);
      });

      const memoryIds = memories.map(m => m.id);

      // Fetch links — use RPC to avoid URL length limits with large .in() arrays
      let links: any[] = [];
      if (memoryIds.length > 0) {
        const db = getDb();
        const { data, error: linkErr } = await db.rpc('get_links_for_ids', {
          ids: memoryIds,
        });
        if (linkErr) {
          log.warn({ err: linkErr }, 'Failed to fetch links, falling back to empty');
        }
        links = data || [];
      }

      await recordAgentInteraction(cortexReq.agent!.agent_id);
      res.json({
        nodes: memories.map(m => ({
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
          createdAt: m.created_at,
        })),
        links,
        total: memories.length,
      });
    } catch (err) {
      log.error({ err }, 'Cortex brain/graph endpoint error');
      res.status(500).json({ error: 'Failed to fetch brain graph data' });
    }
  });

  // GET /self-model — self-model memories
  router.get('/self-model', async (req: Request, res: Response) => {
    try {
      const cortexReq = req as CortexRequest;

      const memories = await withOwnerWallet(cortexReq.ownerWallet!, async () => {
        return getSelfModel();
      });

      await recordAgentInteraction(cortexReq.agent!.agent_id);
      res.json({ memories });
    } catch (err) {
      log.error({ err }, 'Cortex self-model error');
      res.status(500).json({ error: 'Failed to get self model' });
    }
  });

  // POST /link — create a typed link between memories
  router.post('/link', async (req: Request, res: Response) => {
    try {
      const cortexReq = req as CortexRequest;
      const { source_id, target_id, link_type, strength } = req.body;

      if (!source_id || !target_id || !link_type) {
        res.status(400).json({ error: 'source_id, target_id, and link_type are required' });
        return;
      }

      const validTypes = ['supports', 'contradicts', 'elaborates', 'causes', 'follows', 'relates', 'resolves', 'happens_before', 'happens_after', 'concurrent_with'];
      if (!validTypes.includes(link_type)) {
        res.status(400).json({ error: `link_type must be one of: ${validTypes.join(', ')}` });
        return;
      }

      // Verify both memories belong to this owner
      const db = getDb();
      const { data: owned } = await db
        .from('memories')
        .select('id')
        .in('id', [source_id, target_id])
        .eq('owner_wallet', cortexReq.ownerWallet!);

      if (!owned || owned.length < 2) {
        res.status(403).json({ error: 'Both memories must belong to your account' });
        return;
      }

      await withOwnerWallet(cortexReq.ownerWallet!, async () => {
        await createMemoryLink(source_id, target_id, link_type as MemoryLinkType, strength);
      });

      await recordAgentInteraction(cortexReq.agent!.agent_id);
      res.json({ ok: true });
    } catch (err) {
      log.error({ err }, 'Cortex link error');
      res.status(500).json({ error: 'Failed to create link' });
    }
  });

  // POST /clinamen — anomaly retrieval (find unexpected connections)
  router.post('/clinamen', async (req: Request, res: Response) => {
    try {
      const cortexReq = req as CortexRequest;
      const { context, limit, memory_types, min_importance, max_relevance } = req.body;

      if (!context || typeof context !== 'string') {
        res.status(400).json({ error: 'context is required (string)' });
        return;
      }

      const memories = await withOwnerWallet(cortexReq.ownerWallet!, async () => {
        return findClinamen({
          context,
          limit: Math.min(limit || 3, 10),
          memoryTypes: memory_types,
          minImportance: min_importance,
          maxRelevance: max_relevance,
        });
      });

      await recordAgentInteraction(cortexReq.agent!.agent_id);

      res.json({
        memories: memories.map((m: any) => ({
          ...m,
          embedding: undefined,
          _divergence: m._divergence,
          _relevanceSim: m._relevanceSim,
        })),
        count: memories.length,
      });
    } catch (err) {
      log.error({ err }, 'Cortex clinamen error');
      res.status(500).json({ error: 'Failed to find clinamen memories' });
    }
  });

  // ── Memory Pack Export ────────────────────────────────
  router.post('/packs/export', async (req: Request, res: Response) => {
    try {
      const cortexReq = req as CortexRequest;
      const { name, description, memory_ids, types, query, limit, format } = req.body;

      if (!name) {
        res.status(400).json({ error: 'name is required' });
        return;
      }

      let memories: any[];
      if (memory_ids && Array.isArray(memory_ids)) {
        memories = await withOwnerWallet(cortexReq.ownerWallet!, async () => {
          return hydrateMemories(memory_ids);
        });
      } else {
        // Paginate through all memories (Supabase caps at 1000/query)
        const db = getDb();
        memories = [];
        const PAGE = 1000;
        let offset = 0;
        while (true) {
          let query = db.from('memories')
            .select('id, memory_type, content, summary, tags, concepts, importance, decay_factor, emotional_valence, access_count, source, created_at')
            .eq('owner_wallet', cortexReq.ownerWallet!)
            .order('importance', { ascending: false })
            .range(offset, offset + PAGE - 1);

          if (types && types.length > 0) {
            query = query.in('memory_type', types);
          }

          const { data, error: dbErr } = await query;
          if (dbErr) { log.error({ err: dbErr }, 'Export pagination error'); break; }
          if (!data || data.length === 0) break;

          memories = memories.concat(data);
          offset += data.length;
          if (memories.length >= 50000) break;
          if (data.length < PAGE) break;
        }
      }

      const pack = {
        id: randomUUID(),
        name,
        description: description || '',
        memories: (memories || []).map((m: any) => ({
          content: m.content,
          summary: m.summary,
          type: m.memory_type,
          importance: m.importance,
          tags: m.tags || [],
          concepts: m.concepts || [],
          created_at: m.created_at,
        })),
        created_at: new Date().toISOString(),
        created_by: cortexReq.ownerWallet || '',
        format_version: 1,
      };

      await recordAgentInteraction(cortexReq.agent!.agent_id);

      if (format === 'markdown') {
        const lines = [
          `# Memory Pack: ${pack.name}`,
          '', `> ${pack.description}`, '',
          `- **Memories**: ${pack.memories.length}`,
          `- **Created**: ${pack.created_at}`,
          '', '---', '',
        ];
        for (const mem of pack.memories) {
          lines.push(`## [${mem.type}] ${mem.summary}`, '', mem.content, '');
          if (mem.tags.length) lines.push(`Tags: ${mem.tags.join(', ')}`);
          lines.push(`Importance: ${mem.importance.toFixed(2)}`, '', '---', '');
        }
        res.type('text/markdown').send(lines.join('\n'));
      } else {
        res.json(pack);
      }
    } catch (err) {
      log.error({ err }, 'Pack export error');
      res.status(500).json({ error: 'Export failed' });
    }
  });

  // ── Memory Pack Import ────────────────────────────────
  router.post('/packs/import', async (req: Request, res: Response) => {
    try {
      const cortexReq = req as CortexRequest;
      const { pack, importance_multiplier, tag_prefix, types } = req.body;

      if (!pack || !pack.memories || !Array.isArray(pack.memories)) {
        res.status(400).json({ error: 'Valid memory pack required' });
        return;
      }

      let imported = 0;
      let skipped = 0;

      await withOwnerWallet(cortexReq.ownerWallet!, async () => {
        for (const mem of pack.memories) {
          if (types && !types.includes(mem.type)) {
            skipped++;
            continue;
          }
          await storeMemory({
            content: mem.content,
            summary: mem.summary,
            type: mem.type,
            importance: mem.importance * (importance_multiplier ?? 0.8),
            tags: [...(mem.tags || []), `pack:${pack.name || 'imported'}`],
            source: `pack:${pack.id || 'unknown'}`,
          });
          imported++;
        }
      });

      await recordAgentInteraction(cortexReq.agent!.agent_id);
      res.json({ imported, skipped, total: pack.memories.length });
    } catch (err) {
      log.error({ err }, 'Pack import error');
      res.status(500).json({ error: 'Import failed' });
    }
  });

  // ── Smart Export (AI-synthesized context brief) ────────────────────
  router.post('/packs/smart-export', async (req: Request, res: Response) => {
    try {
      const cortexReq = req as CortexRequest;
      const { name, provider } = req.body;

      if (!name) {
        res.status(400).json({ error: 'name is required' });
        return;
      }

      const validProviders = ['chatgpt', 'claude', 'gemini'];
      const targetProvider = validProviders.includes(provider) ? provider : 'claude';

      const openrouterApiKey = process.env.OPENROUTER_API_KEY;
      if (!openrouterApiKey) {
        res.status(500).json({ error: 'OpenRouter API not configured for synthesis' });
        return;
      }

      // Paginate all memories for this user
      const db = getDb();
      let allMemories: any[] = [];
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        const { data, error: dbErr } = await db.from('memories')
          .select('memory_type, summary, content, importance, tags, created_at')
          .eq('owner_wallet', cortexReq.ownerWallet!)
          .order('importance', { ascending: false })
          .range(offset, offset + PAGE - 1);
        if (dbErr || !data || data.length === 0) break;
        allMemories = allMemories.concat(data);
        offset += data.length;
        if (allMemories.length >= 50000 || data.length < PAGE) break;
      }

      if (allMemories.length === 0) {
        res.status(404).json({ error: 'No memories found to export' });
        return;
      }

      await recordAgentInteraction(cortexReq.agent!.agent_id);

      // Group by type and build a condensed input for synthesis
      const byType: Record<string, any[]> = {};
      for (const m of allMemories) {
        const t = m.memory_type || 'episodic';
        (byType[t] = byType[t] || []).push(m);
      }

      // Build two versions: condensed for LLM synthesis, full for appendix
      const sections: string[] = [];  // condensed (top per type, for LLM)
      const allBullets: string[] = []; // full (every memory, for appendix)
      for (const [type, mems] of Object.entries(byType)) {
        const sorted = mems.sort((a: any, b: any) => (b.importance || 0) - (a.importance || 0));
        // Condensed: top 300 episodic, 150 others (fits in LLM context)
        const forLLM = sorted.slice(0, type === 'episodic' ? 300 : 150);
        sections.push(`\n## ${type.toUpperCase()} (${mems.length} total, top ${forLLM.length} shown)\n`);
        for (const m of forLLM) {
          const date = m.created_at ? new Date(m.created_at).toISOString().slice(0, 10) : '';
          sections.push(`- [${date}] ${m.summary || m.content?.slice(0, 200)}`);
        }
        // Full: every memory for the raw appendix
        for (const m of sorted) {
          const date = m.created_at ? new Date(m.created_at).toISOString().slice(0, 10) : '';
          allBullets.push(`[${type}] - [${date}] ${m.summary || m.content?.slice(0, 200)}`);
        }
      }

      const memoryDump = sections.join('\n');
      const typeCounts = Object.entries(byType).map(([t, arr]) => `${t}: ${arr.length}`).join(', ');

      // Provider-specific formatting instructions
      const providerFormats: Record<string, string> = {
        claude: `Format the output using XML tags that Claude understands well:
<user_profile>, <projects>, <decisions>, <knowledge>, <style>, <relationships>, <timeline>
Wrap the entire output in <context> tags.`,
        chatgpt: `Format the output using Markdown headers (##) and bullet points.
Start with "# Memory Context" as the title.
Use clear section breaks. ChatGPT works best with structured Markdown.
At the top, add: "You are continuing a conversation with a user. Below is everything you know about them from previous interactions."`,
        gemini: `Format the output using Markdown with clear ## headers.
Start with "# Memory Context" as the title.
Use bullet points and bold for emphasis.
At the top, add: "You have persistent memory about this user from a system called Clude. Use this context naturally in your responses."`,
      };

      const formatInstruction = providerFormats[targetProvider] || providerFormats.claude;

      // Synthesize with Claude Sonnet via OpenRouter
      const synthesisPrompt = `You are analyzing a user's AI memory corpus to create a rich context document.
The document will be used to give ${targetProvider === 'claude' ? 'Claude' : targetProvider === 'chatgpt' ? 'ChatGPT' : 'Gemini'} full context about this user across conversations.

The user has ${allMemories.length} memories (${typeCounts}).

Create a comprehensive context document with these sections:
1. **User Profile** — Who they are, their role, background, expertise, contact info
2. **Active Projects** — Current work, with status and key details for each project
3. **Key Decisions & Reasoning** — Important choices made and WHY
4. **Technical Knowledge** — Tools, stack, technical preferences, lessons learned
5. **Working Style & Preferences** — Communication style, how they like to work
6. **Important Relationships** — People, teams, partners, collaborators
7. **Recent Timeline** — What's happened in the last 2 weeks, chronologically

${formatInstruction}

Rules:
- Write in third person ("The user..." or use their name if found)
- Be specific — include names, dates, numbers, URLs when available
- Focus on CONTEXT that would help another AI assist them effectively
- Don't just list facts — explain relationships between them
- If memories are mostly one type (e.g., all episodic), extract implicit knowledge from the events
- Keep it under 3000 words

Here are the memories:
${memoryDump}`;

      const llmRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openrouterApiKey}`,
          'HTTP-Referer': 'https://clude.fun',
          'X-Title': 'Clude Bot',
        },
        body: JSON.stringify({
          model: 'anthropic/claude-sonnet-4.6',
          messages: [
            { role: 'system', content: 'You are an expert at synthesizing information into structured context documents.' },
            { role: 'user', content: synthesisPrompt },
          ],
          max_tokens: 4096,
          temperature: 0.3,
        }),
      });

      if (!llmRes.ok) {
        const errBody = await llmRes.text().catch(() => 'Unknown error');
        log.error({ status: llmRes.status, body: errBody }, 'OpenRouter synthesis failed');
        res.status(500).json({ error: 'Synthesis failed' });
        return;
      }

      const llmData = await llmRes.json() as any;
      const synthesis = llmData.choices?.[0]?.message?.content;

      if (!synthesis) {
        res.status(500).json({ error: 'Empty synthesis response' });
        return;
      }

      // Build full export: synthesis + raw memories
      const rawSection = `\n\n---\n\n# Full Memory Log (${allMemories.length} memories)\n\n${allBullets.join('\n')}`;

      const contextBrief = targetProvider === 'claude'
        ? `<context>\nSynthesized from ${allMemories.length} memories by Clude. Generated: ${new Date().toISOString().slice(0, 10)}\n\n${synthesis}\n</context>\n${rawSection}`
        : `${synthesis}\n\n---\nSynthesized from ${allMemories.length} memories by Clude. Generated: ${new Date().toISOString().slice(0, 10)}\n${rawSection}`;

      res.json({
        name,
        format: 'smart',
        memory_count: allMemories.length,
        type_breakdown: Object.fromEntries(Object.entries(byType).map(([t, arr]) => [t, arr.length])),
        content: contextBrief,
        generated_at: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Smart export error');
      res.status(500).json({ error: 'Smart export failed' });
    }
  });

  return router;
}
