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
import { authenticateAgent, registerAgent, recordAgentInteraction, type AgentRegistration } from '../features/agent-tier';
import { withOwnerWallet } from '../core/owner-context';
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
} from '../core/memory';
import type { MemoryLinkType } from '../utils/constants';
import { checkRateLimit, getDb } from '../core/database';
import { createChildLogger } from '../core/logger';

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

  // Resolve owner_wallet from the agent_keys row
  const ownerWallet = agent.owner_wallet;
  if (!ownerWallet) {
    res.status(403).json({ error: 'API key not configured for hosted Cortex. Register with a wallet address first.' });
    return;
  }

  (req as CortexRequest).agent = agent;
  (req as CortexRequest).ownerWallet = ownerWallet;
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
      if (!wallet || typeof wallet !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
        res.status(400).json({ error: 'Valid Solana wallet address required' });
        return;
      }

      // Rate limit registrations: 3 per hour per IP
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const allowed = await checkRateLimit(`cortex:register:${ip}`, 3, 60);
      if (!allowed) {
        res.status(429).json({ error: 'Too many registration attempts. Try again in an hour.' });
        return;
      }

      // Check if wallet already registered
      const db = getDb();
      const { data: existing } = await db
        .from('agent_keys')
        .select('id')
        .eq('owner_wallet', wallet)
        .limit(1);

      if (existing && existing.length > 0) {
        res.status(409).json({ error: 'Wallet already registered. Contact support for key recovery.' });
        return;
      }

      // Register using existing agent system
      const { agentId, apiKey } = await registerAgent(name, 'AGENT_VERIFIED');

      // Set owner_wallet on the agent_keys row
      await db
        .from('agent_keys')
        .update({ owner_wallet: wallet })
        .eq('agent_id', agentId);

      log.info({ agentId, wallet: wallet.slice(0, 8) + '...' }, 'Cortex user registered');

      res.json({
        apiKey,
        agentId,
        wallet,
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
      const { content, summary, type, tags, concepts, importance, emotional_valence, source, source_id, metadata } = req.body;

      if (!content || typeof content !== 'string') {
        res.status(400).json({ error: 'content is required (string)' });
        return;
      }
      if (!summary || typeof summary !== 'string') {
        res.status(400).json({ error: 'summary is required (string)' });
        return;
      }

      const memoryType = (type || 'episodic') as MemoryType;
      const validTypes: MemoryType[] = ['episodic', 'semantic', 'procedural', 'self_model'];
      if (!validTypes.includes(memoryType)) {
        res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
        return;
      }

      const result = await withOwnerWallet(cortexReq.ownerWallet!, async () => {
        return storeMemory({
          type: memoryType,
          content,
          summary,
          tags: tags || [],
          concepts: concepts || [],
          importance: importance ?? undefined,
          emotionalValence: emotional_valence ?? undefined,
          source: source || 'cortex-api',
          sourceId: source_id,
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
      const { query, tags, memory_types, limit, min_importance, min_decay } = req.body;

      const memories = await withOwnerWallet(cortexReq.ownerWallet!, async () => {
        return recallMemories({
          query,
          tags,
          memoryTypes: memory_types,
          limit: Math.min(limit || 10, 50),
          minImportance: min_importance,
          minDecay: min_decay,
        });
      });

      await recordAgentInteraction(cortexReq.agent!.agent_id);

      res.json({ memories, count: memories.length });
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

      res.json({ memories, count: memories.length });
    } catch (err) {
      log.error({ err }, 'Cortex recent error');
      res.status(500).json({ error: 'Failed to get recent memories' });
    }
  });

  // GET /self-model — self-model memories
  router.get('/self-model', async (req: Request, res: Response) => {
    try {
      const cortexReq = req as CortexRequest;

      const memories = await withOwnerWallet(cortexReq.ownerWallet!, async () => {
        return getSelfModel();
      });

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

      const validTypes = ['supports', 'contradicts', 'elaborates', 'causes', 'follows', 'relates', 'resolves'];
      if (!validTypes.includes(link_type)) {
        res.status(400).json({ error: `link_type must be one of: ${validTypes.join(', ')}` });
        return;
      }

      await withOwnerWallet(cortexReq.ownerWallet!, async () => {
        await createMemoryLink(source_id, target_id, link_type as MemoryLinkType, strength);
      });

      res.json({ ok: true });
    } catch (err) {
      log.error({ err }, 'Cortex link error');
      res.status(500).json({ error: 'Failed to create link' });
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
      await withOwnerWallet(cortexReq.ownerWallet!, async () => {
        if (memory_ids && Array.isArray(memory_ids)) {
          const { hydrateMemories } = require('../core/memory');
          memories = await hydrateMemories(memory_ids);
        } else {
          const { recallMemories } = require('../core/memory');
          memories = await recallMemories({
            query,
            memoryTypes: types,
            limit: limit || 50,
          });
        }
      });

      const pack = {
        id: require('crypto').randomUUID(),
        name,
        description: description || '',
        memories: (memories! || []).map((m: any) => ({
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
        const { storeMemory } = require('../core/memory');
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

      res.json({ imported, skipped, total: pack.memories.length });
    } catch (err) {
      log.error({ err }, 'Pack import error');
      res.status(500).json({ error: 'Import failed' });
    }
  });

  return router;
}
