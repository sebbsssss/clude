import { Router, Request, Response } from 'express';
import { getMemoryStats, getRecentMemories, storeMemory } from '@clude/brain/memory';
import { getDb } from '@clude/shared/core/database';
import { requirePrivyAuth, optionalPrivyAuth } from '@clude/brain/auth/privy-auth';
import { optionalOwnership } from '@clude/brain/auth/require-ownership';
import { withOwnerWallet } from '@clude/shared/core/owner-context';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('memory-packs-routes');

/**
 * Resolve owner scope from request.
 * Priority: req.verifiedWallet (set by requireOwnership/optionalOwnership) > ?wallet= param.
 * DID fallback is handled upstream by ownership middleware.
 */
function getRequestOwner(req: Request): string | null {
  if (req.verifiedWallet) return req.verifiedWallet;
  const wallet = req.query.wallet as string | undefined;
  if (wallet) return wallet;
  return null;
}

export function memoryPacksRoutes(): Router {
  const router = Router();

  // Export memory pack (paginated — handles 25K+ memories)
  router.post('/export', requirePrivyAuth, optionalOwnership, async (req: Request, res: Response) => {
    try {
      const { name, description, tags, types } = req.body;
      if (!name) { res.status(400).json({ error: 'name is required' }); return; }

      const owner = getRequestOwner(req);
      if (!owner) { res.json({ memories: [], memory_count: 0 }); return; }

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

        if (allMemories.length >= 50000) break;
        if (data.length < PAGE) break;
      }

      let memories = allMemories;

      if (tags && tags.length > 0) {
        memories = memories.filter(m => m.tags.some((t: string) => tags.includes(t)));
      }

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
  router.post('/import', requirePrivyAuth, optionalOwnership, async (req: Request, res: Response) => {
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
  router.post('/smart-export', requirePrivyAuth, optionalOwnership, async (req: Request, res: Response) => {
    try {
      const { name, provider } = req.body;
      if (!name) { res.status(400).json({ error: 'name is required' }); return; }

      const validProviders = ['chatgpt', 'claude', 'gemini'];
      const targetProvider = validProviders.includes(provider) ? provider : 'claude';

      const owner = getRequestOwner(req);
      if (!owner) { res.status(401).json({ error: 'Authentication required' }); return; }

      const openrouterApiKey = process.env.OPENROUTER_API_KEY;
      if (!openrouterApiKey) { res.status(500).json({ error: 'OpenRouter API not configured' }); return; }

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
          'HTTP-Referer': 'https://clude.fun',
          'X-Title': 'Clude Bot',
        },
        body: JSON.stringify({
          model: 'anthropic/claude-sonnet-4.6',
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
  router.get('/', optionalPrivyAuth, async (_req: Request, res: Response) => {
    res.json([]);
  });

  return router;
}
