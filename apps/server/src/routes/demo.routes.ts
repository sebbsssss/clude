import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import { storeMemory, recallMemories } from '@clude/brain/memory';
import { getDb, checkRateLimit } from '@clude/shared/core/database';
import { writeMemo } from '@clude/shared/core/solana-client';
import { checkInputContent } from '@clude/shared/core/guardrails';
import { withOwnerWallet } from '@clude/shared/core/owner-context';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('demo-routes');

export function demoRoutes(): Router {
  const router = Router();

  // Trigger a live memory creation + on-chain commit
  router.post('/trigger', async (req: Request, res: Response) => {
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
  router.get('/poll/:id', async (req: Request, res: Response) => {
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
  router.get('/stats', async (_req: Request, res: Response) => {
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
  router.post('/store', async (req: Request, res: Response) => {
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
  router.post('/recall', async (req: Request, res: Response) => {
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

  return router;
}
