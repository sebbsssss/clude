/**
 * Persistent Memory routes — user-facing "remember this always" preferences.
 *
 * These are semantic memories tagged `persistent_instruction`, scoped to owner_wallet.
 * They are injected into the chat system prompt on every turn so the model follows
 * them persistently across conversations.
 *
 * Delete is a hard delete — row is removed entirely. FK constraints on
 * entity_mentions / memory_links / jepa refs cascade, so nothing dangles.
 * `ARCHIVED_TAG` is retained only to filter legacy soft-archived rows that
 * may still exist from before this change.
 *
 * Auth: reuses the chat API's dual auth (Cortex key or Privy JWT) via chatAuth
 * middleware — the client already authenticates with the same Bearer token.
 */
import { Router, Request, Response } from 'express';
import { withOwnerWallet } from '@clude/shared/core/owner-context';
import { storeMemory } from '@clude/brain/memory';
import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';
import { chatAuth } from './chat.routes.js';

const log = createChildLogger('persistent-memory');

export const PERSISTENT_TAG = 'persistent_instruction';
export const ARCHIVED_TAG = 'archived_preference';
export const PERSISTENT_MAX_ENTRIES = 20;
export const PERSISTENT_SUMMARY_MAX = 280;

interface AuthedRequest extends Request {
  ownerWallet?: string;
}

/** Active persistent memories for this owner — NOT archived. */
export async function fetchActivePersistentMemories(ownerWallet: string) {
  const db = getDb();
  const { data, error } = await db
    .from('memories')
    .select('id, summary, content, tags, metadata, created_at')
    .eq('owner_wallet', ownerWallet)
    .contains('tags', [PERSISTENT_TAG])
    .order('created_at', { ascending: true })
    .limit(PERSISTENT_MAX_ENTRIES + 10); // over-fetch; filter archived below

  if (error) {
    log.error({ err: error, ownerWallet }, 'Failed to fetch persistent memories');
    return [];
  }

  return (data || [])
    .filter((m: any) => !Array.isArray(m.tags) || !m.tags.includes(ARCHIVED_TAG))
    .slice(0, PERSISTENT_MAX_ENTRIES);
}

export type SavePersistentResult =
  | { ok: true; id: number; summary: string; key: string; value: string; replaced: number }
  | { ok: false; status: number; error: string };

/**
 * Save-or-replace a persistent preference for an owner. Shared between the
 * REST POST handler and the chat tool's auto-save path so behavior stays
 * identical: validation, cap check, same-key replacement, canonical store.
 *
 * Same-key replacement is a hard delete of the prior row (plus any residual
 * soft-archived siblings), keeping the table clean now that delete is hard.
 */
export async function savePersistentMemory(
  ownerWallet: string,
  input: { summary?: unknown; key?: unknown; value?: unknown },
): Promise<SavePersistentResult> {
  const { summary, key, value } = input;
  if (!summary || typeof summary !== 'string') return { ok: false, status: 400, error: 'summary is required (string)' };
  if (!key || typeof key !== 'string') return { ok: false, status: 400, error: 'key is required (string)' };
  if (!value || typeof value !== 'string') return { ok: false, status: 400, error: 'value is required (string)' };
  if (summary.length > PERSISTENT_SUMMARY_MAX) {
    return { ok: false, status: 400, error: `summary must be <= ${PERSISTENT_SUMMARY_MAX} chars` };
  }

  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 64);
  const db = getDb();

  const existing = await fetchActivePersistentMemories(ownerWallet);
  const existingWithSameKey = existing.filter(
    (m: any) => (m.metadata as any)?.preference_key === normalizedKey,
  );
  const activeOtherKeys = existing.length - existingWithSameKey.length;
  if (activeOtherKeys >= PERSISTENT_MAX_ENTRIES) {
    return {
      ok: false,
      status: 400,
      error: `You've reached the limit of ${PERSISTENT_MAX_ENTRIES} permanent preferences. Remove one first.`,
    };
  }

  if (existingWithSameKey.length > 0) {
    const ids = existingWithSameKey.map((m: any) => m.id);
    await db.from('memories').delete().in('id', ids).eq('owner_wallet', ownerWallet);
  }

  const newId = await withOwnerWallet(ownerWallet, () =>
    storeMemory({
      type: 'semantic',
      content: `User preference: ${summary}`,
      summary,
      tags: [PERSISTENT_TAG, `pref:${normalizedKey}`],
      importance: 1.0,
      source: 'chat:user-preference',
      metadata: { preference_key: normalizedKey, preference_value: value },
    }),
  );

  if (!newId) return { ok: false, status: 500, error: 'Failed to save preference' };

  log.info({ owner: ownerWallet, key: normalizedKey, id: newId, replaced: existingWithSameKey.length }, 'Persistent preference saved');
  return {
    ok: true,
    id: newId,
    summary,
    key: normalizedKey,
    value,
    replaced: existingWithSameKey.length,
  };
}

export function persistentMemoryRoutes(): Router {
  const router = Router();

  // All routes authenticated the same way as /api/chat (Cortex key or Privy JWT)
  router.use(chatAuth);

  // GET / — list active entries for this owner
  router.get('/', async (req: Request, res: Response) => {
    try {
      const owner = (req as AuthedRequest).ownerWallet;
      if (!owner) { res.status(401).json({ error: 'Authentication required' }); return; }

      const memories = await fetchActivePersistentMemories(owner);
      res.json({
        memories: memories.map((m: any) => ({
          id: m.id,
          summary: m.summary,
          key: (m.metadata as any)?.preference_key || null,
          value: (m.metadata as any)?.preference_value || null,
          created_at: m.created_at,
        })),
        count: memories.length,
        max: PERSISTENT_MAX_ENTRIES,
      });
    } catch (err) {
      log.error({ err }, 'List persistent memories failed');
      res.status(500).json({ error: 'Failed to list persistent memories' });
    }
  });

  // POST / — upsert (hard-deletes any prior entry with the same key)
  router.post('/', async (req: Request, res: Response) => {
    try {
      const owner = (req as AuthedRequest).ownerWallet;
      if (!owner) { res.status(401).json({ error: 'Authentication required' }); return; }

      const result = await savePersistentMemory(owner, req.body ?? {});
      if (!result.ok) {
        res.status(result.status).json({ error: result.error, ...(result.status === 400 && /limit/.test(result.error) ? { limit: PERSISTENT_MAX_ENTRIES } : {}) });
        return;
      }

      res.json({
        id: result.id,
        summary: result.summary,
        key: result.key,
        value: result.value,
        replaced: result.replaced,
      });
    } catch (err) {
      log.error({ err }, 'Save persistent memory failed');
      res.status(500).json({ error: 'Failed to save preference' });
    }
  });

  // DELETE /:id — hard delete. Row is removed entirely; entity_mentions,
  // memory_links, and jepa refs cascade via FK ON DELETE CASCADE. This is
  // what users expect: "delete" means the preference no longer exists and
  // can't resurface via any recall path.
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const owner = (req as AuthedRequest).ownerWallet;
      if (!owner) { res.status(401).json({ error: 'Authentication required' }); return; }

      const memoryId = parseInt(req.params.id);
      if (isNaN(memoryId)) {
        res.status(400).json({ error: 'Invalid memory ID' }); return;
      }

      const db = getDb();
      const { data: mem, error: fetchErr } = await db
        .from('memories')
        .select('id, owner_wallet, tags')
        .eq('id', memoryId)
        .single();

      if (fetchErr || !mem) {
        res.status(404).json({ error: 'Preference not found' }); return;
      }
      if (mem.owner_wallet !== owner) {
        res.status(403).json({ error: 'Not authorized to delete this preference' }); return;
      }
      if (!Array.isArray(mem.tags) || !mem.tags.includes(PERSISTENT_TAG)) {
        res.status(400).json({ error: 'Not a persistent preference' }); return;
      }

      const { error: delErr } = await db
        .from('memories')
        .delete()
        .eq('id', memoryId)
        .eq('owner_wallet', owner);

      if (delErr) {
        log.error({ err: delErr, memoryId }, 'Hard delete failed');
        res.status(500).json({ error: 'Failed to delete preference' });
        return;
      }

      log.info({ owner, memoryId }, 'Persistent preference deleted');
      res.json({ ok: true, id: memoryId });
    } catch (err) {
      log.error({ err }, 'Delete persistent memory failed');
      res.status(500).json({ error: 'Failed to delete preference' });
    }
  });

  return router;
}
