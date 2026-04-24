/**
 * /api/showcase/* — public endpoints backing the hackathon Live Memory Graph
 * page (/showcase/graph on the dashboard).
 *
 * Two surfaces:
 *   POST /api/showcase/ingest   — stores memories from free text and returns
 *                                  the created memory/link events inline
 *   GET  /api/showcase/stream   — Server-Sent Events stream that emits every
 *                                  memory/link created via /ingest, to any
 *                                  number of concurrent watchers
 *
 * No auth — these are public demo endpoints. Owner-wallet is a fixed
 * `showcase-public-demo` so the Clude Cortex can multi-tenant this from other
 * users and it doesn't leak.
 *
 * Rate-limited at 20 req/min per IP on /ingest to keep costs bounded.
 */
import { Router, Request, Response } from 'express';
import { EventEmitter } from 'events';
import { storeMemory, recallMemories } from '@clude/brain/memory';
import { checkRateLimit } from '@clude/shared/utils/rate-limit';
import { withOwnerWallet } from '@clude/shared/core/owner-context';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('showcase-routes');
const SHOWCASE_OWNER = 'showcase-public-demo';

// Event bus — shared between /ingest producers and /stream consumers.
// EventEmitter is in-process; if we scale horizontally we'd swap for Redis pub/sub.
const bus = new EventEmitter();
bus.setMaxListeners(100);

interface MemoryEvent {
  id: string;
  type: 'episodic' | 'semantic' | 'procedural' | 'self_model';
  content: string;
}

interface LinkEvent {
  from: string;
  to: string;
  linkType:
    | 'supports'
    | 'contradicts'
    | 'elaborates'
    | 'causes'
    | 'follows'
    | 'relates'
    | 'resolves'
    | 'happens_before'
    | 'happens_after'
    | 'concurrent_with';
}

export function showcaseRoutes(): Router {
  const router = Router();

  /**
   * GET /api/showcase/stream
   * SSE stream of memory/link events. Connection stays open; events pushed as
   * they happen. Client closes to disconnect.
   */
  router.get('/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    res.flushHeaders();

    // Send a hello event so client knows it's connected
    res.write(`event: hello\ndata: {"at":${Date.now()}}\n\n`);

    const onMemory = (ev: MemoryEvent) => {
      res.write(`event: memory\ndata: ${JSON.stringify(ev)}\n\n`);
    };
    const onLink = (ev: LinkEvent) => {
      res.write(`event: link\ndata: ${JSON.stringify(ev)}\n\n`);
    };

    bus.on('memory', onMemory);
    bus.on('link', onLink);

    // Keepalive — a comment every 15s to prevent load balancers from timing us out
    const keepalive = setInterval(() => {
      try {
        res.write(`: keepalive ${Date.now()}\n\n`);
      } catch {
        /* ignore — cleanup on close will handle */
      }
    }, 15_000);

    req.on('close', () => {
      clearInterval(keepalive);
      bus.off('memory', onMemory);
      bus.off('link', onLink);
    });
  });

  /**
   * POST /api/showcase/ingest
   * Body: { text: string }
   * Returns: { memories: MemoryEvent[], links: LinkEvent[] }
   * Also emits every memory/link on the bus so /stream watchers see them.
   */
  router.post('/ingest', async (req: Request, res: Response) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const allowed = await checkRateLimit(`showcase:ingest:${ip}`, 20, 60);
    if (!allowed) {
      res.status(429).json({ error: 'Rate limited. 20 ingests per minute per IP.' });
      return;
    }

    const text: string = (req.body?.text ?? '').toString().trim();
    if (!text) {
      res.status(400).json({ error: 'Missing text' });
      return;
    }
    if (text.length > 2000) {
      res.status(400).json({ error: 'Text too long (max 2000 chars)' });
      return;
    }

    try {
      // Multi-tenant isolation — all showcase memories go under a fixed owner_wallet.
      const result = await withOwnerWallet(SHOWCASE_OWNER, async () => {
        const memoryId = await storeMemory({
          type: 'episodic',
          content: text,
          summary: text.slice(0, 200),
          tags: ['showcase', 'public-demo'],
          importance: 0.5,
          source: 'showcase',
        });

        if (!memoryId) return { memories: [], links: [] };

        // Query the freshly-stored memory plus anything we can pull in via
        // recall — this gives the viewer immediate graph context.
        const related = await recallMemories({
          query: text,
          limit: 5,
          tags: ['showcase'],
        });

        const memories: MemoryEvent[] = [
          {
            id: String(memoryId),
            type: 'episodic',
            content: text,
          },
          ...related
            .filter((m: any) => String(m.id) !== String(memoryId))
            .map((m: any) => ({
              id: String(m.id),
              type: (m.memory_type || 'episodic') as MemoryEvent['type'],
              content: m.content,
            })),
        ];

        // Build naive "relates" links from the new memory to each recalled one.
        // The full Clude entity-graph pipeline also creates typed links asynchronously
        // (fire-and-forget in storeMemory), but that happens out-of-band — those
        // become visible via the /stream keepalive / subsequent /ingest calls.
        const links: LinkEvent[] = memories
          .slice(1)
          .map((m) => ({
            from: String(memoryId),
            to: m.id,
            linkType: 'relates' as const,
          }));

        return { memories, links };
      });

      // Emit on the bus for any /stream listeners
      for (const m of result.memories) bus.emit('memory', m);
      for (const l of result.links) bus.emit('link', l);

      res.json(result);
    } catch (err: any) {
      log.error({ err: err?.message }, 'showcase.ingest failed');
      res.status(500).json({ error: err?.message || 'ingest failed' });
    }
  });

  /**
   * GET /api/showcase/health
   * Lightweight liveness check for the page's connection indicator.
   */
  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', listeners: bus.listenerCount('memory') });
  });

  return router;
}
