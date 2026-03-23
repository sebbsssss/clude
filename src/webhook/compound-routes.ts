import { Router, Request, Response } from 'express';
import { createChildLogger } from '../core/logger';
import { getAccuracyStats, isCompoundRunning } from '../features/compound';
import { createAdapters, fetchAllMarkets } from '../features/compound/market-adapters';
import { hydrateMemories } from '../core/memory';
import { getDb } from '../core/database';

const log = createChildLogger('compound-routes');

/** Get a time bucket key for grouping timeline stats */
function getBucketKey(date: Date, interval: string): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');

  switch (interval) {
    case 'day':
      return `${y}-${m}-${d}`;
    case 'month':
      return `${y}-${m}`;
    case 'week':
    default: {
      // ISO week: find the Monday of the week
      const day = date.getDay();
      const monday = new Date(date);
      monday.setDate(date.getDate() - ((day + 6) % 7));
      const wy = monday.getFullYear();
      const wm = String(monday.getMonth() + 1).padStart(2, '0');
      const wd = String(monday.getDate()).padStart(2, '0');
      return `${wy}-${wm}-${wd}`;
    }
  }
}

export function compoundRoutes(): Router {
  const router = Router();

  // GET /api/compound/markets — List tracked markets with Compound estimates vs market odds
  // Fetches live markets from adapters OR recent predictions from memory
  // ?source=live|memory  &category=politics  &limit=20  &minVolume=10000
  router.get('/markets', async (req: Request, res: Response) => {
    try {
      const source = (req.query.source as string) || 'memory';
      const category = req.query.category as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const minVolume = parseInt(req.query.minVolume as string) || 0;

      if (source === 'live') {
        // Fetch live markets from adapters
        const adapters = createAdapters({
          polymarketEnabled: process.env.COMPOUND_POLYMARKET !== 'false',
          manifoldEnabled: process.env.COMPOUND_MANIFOLD !== 'false',
        });

        if (adapters.length === 0) {
          res.json({ markets: [], count: 0, source: 'live', timestamp: new Date().toISOString() });
          return;
        }

        const markets = await fetchAllMarkets(adapters, {
          limit,
          category,
          minVolume,
          activeOnly: true,
        });

        res.json({
          markets: markets.map(m => ({
            sourceId: m.sourceId,
            source: m.source,
            question: m.question,
            currentOdds: m.currentOdds,
            volume: m.volume,
            liquidity: m.liquidity,
            closeDate: m.closeDate,
            category: m.category,
            active: m.active,
            url: m.url,
          })),
          count: markets.length,
          source: 'live',
          timestamp: new Date().toISOString(),
        });
      } else {
        // Fetch recent Compound predictions via direct DB query (fast, no recall pipeline)
        const db = getDb();
        let query = db.from('memories')
          .select('id, summary, metadata, created_at, tags')
          .contains('tags', ['compound', 'prediction'])
          .order('created_at', { ascending: false })
          .limit(limit);

        if (category) {
          query = query.contains('tags', [category]);
        }

        const { data: memories, error: dbErr } = await query;

        if (dbErr) {
          log.error({ err: dbErr.message }, 'Compound memory query failed');
          res.json({ markets: [], count: 0, source: 'memory', timestamp: new Date().toISOString() });
          return;
        }

        const predictions = (memories || []).map((m: any) => ({
          memoryId: m.id,
          question: m.summary,
          source: m.metadata?.source_platform,
          sourceId: m.metadata?.source_id,
          marketOdds: m.metadata?.market_odds,
          estimatedProbability: m.metadata?.estimated_probability,
          confidence: m.metadata?.confidence,
          edge: m.metadata?.edge,
          isValue: m.metadata?.is_value,
          category: m.metadata?.category,
          marketUrl: m.metadata?.market_url,
          closeDate: m.metadata?.close_date,
          analyzedAt: m.created_at,
        }));

        res.json({
          markets: predictions,
          count: predictions.length,
          source: 'memory',
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      log.error({ err }, 'Markets endpoint error');
      res.status(500).json({ error: 'Failed to fetch markets' });
    }
  });

  // GET /api/compound/accuracy — Historical accuracy stats by category
  router.get('/accuracy', async (_req: Request, res: Response) => {
    try {
      const stats = await getAccuracyStats();

      res.json({
        ...stats,
        engineRunning: isCompoundRunning(),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Accuracy endpoint error');
      res.status(500).json({ error: 'Failed to fetch accuracy stats' });
    }
  });

  // GET /api/compound/markets/:id — Single market detail with reasoning, evidence, and memory refs
  // :id is the memory ID of the prediction
  router.get('/markets/:id', async (req: Request, res: Response) => {
    try {
      const memoryId = parseInt(req.params.id, 10);
      if (isNaN(memoryId)) {
        res.status(400).json({ error: 'Invalid market ID — must be a numeric memory ID' });
        return;
      }

      const [memory] = await hydrateMemories([memoryId]);
      if (!memory) {
        res.status(404).json({ error: 'Market prediction not found' });
        return;
      }

      const meta = memory.metadata as Record<string, unknown>;
      if (meta?.compound_type !== 'prediction') {
        res.status(404).json({ error: 'Memory is not a Compound prediction' });
        return;
      }

      // Find resolution if one exists (linked via metadata.prediction_memory_id)
      const resolutions = await recallMemories({
        tags: ['compound', 'resolution'],
        limit: 50,
        trackAccess: false,
        skipExpansion: true,
      });
      const resolution = resolutions.find(r => {
        const rMeta = r.metadata as Record<string, unknown>;
        return rMeta?.prediction_memory_id === memoryId;
      });

      // Parse evidence from content
      const evidenceLines = memory.content
        .split('\n')
        .filter(line => line.startsWith('- '))
        .map(line => line.slice(2));

      // Extract reasoning from content
      const reasoningMatch = memory.content.match(/Reasoning: (.+)/);
      const reasoning = reasoningMatch ? reasoningMatch[1] : null;

      res.json({
        memoryId: memory.id,
        question: memory.summary,
        content: memory.content,
        source: meta.source_platform,
        sourceId: meta.source_id,
        marketOdds: meta.market_odds,
        estimatedProbability: meta.estimated_probability,
        confidence: meta.confidence,
        edge: meta.edge,
        isValue: meta.is_value,
        category: meta.category,
        marketUrl: meta.market_url,
        closeDate: meta.close_date,
        analyzedAt: memory.created_at,
        reasoning,
        evidence: evidenceLines,
        tags: memory.tags,
        importance: memory.importance,
        decayFactor: memory.decay_factor,
        resolution: resolution ? {
          outcome: (resolution.metadata as Record<string, unknown>)?.outcome,
          resolvedAt: (resolution.metadata as Record<string, unknown>)?.resolved_at,
          brierScore: (resolution.metadata as Record<string, unknown>)?.brier_score,
          correct: (resolution.metadata as Record<string, unknown>)?.correct,
          resolutionMemoryId: resolution.id,
        } : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err, id: req.params.id }, 'Market detail endpoint error');
      res.status(500).json({ error: 'Failed to fetch market detail' });
    }
  });

  // GET /api/compound/predictions — Historical predictions with outcomes
  // ?category=politics  &limit=20  &offset=0  &resolved=true|false
  router.get('/predictions', async (req: Request, res: Response) => {
    try {
      const category = req.query.category as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const offset = parseInt(req.query.offset as string) || 0;
      const resolvedFilter = req.query.resolved as string | undefined;

      // Fetch predictions from memory
      const tags = ['compound', 'prediction'];
      if (category) tags.push(category);

      const predictions = await recallMemories({
        query: `compound prediction ${category || ''}`.trim(),
        tags,
        limit: 50, // Fetch more to allow offset/filtering
        trackAccess: false,
        skipExpansion: true,
      });

      // Fetch all resolutions to match with predictions
      const resolutions = await recallMemories({
        tags: ['compound', 'resolution'],
        limit: 50,
        trackAccess: false,
        skipExpansion: true,
      });

      // Build a map of prediction memory ID -> resolution
      const resolutionMap = new Map<number, typeof resolutions[number]>();
      for (const r of resolutions) {
        const rMeta = r.metadata as Record<string, unknown>;
        const predId = rMeta?.prediction_memory_id as number | undefined;
        if (predId) resolutionMap.set(predId, r);
      }

      // Build prediction records with optional resolution data
      let records = predictions
        .filter(m => m.tags?.includes('prediction'))
        .map(m => {
          const meta = m.metadata as Record<string, unknown>;
          const resolution = resolutionMap.get(m.id);
          const rMeta = resolution?.metadata as Record<string, unknown> | undefined;

          return {
            memoryId: m.id,
            question: m.summary,
            source: meta?.source_platform,
            sourceId: meta?.source_id,
            marketOdds: meta?.market_odds,
            estimatedProbability: meta?.estimated_probability,
            confidence: meta?.confidence,
            edge: meta?.edge,
            isValue: meta?.is_value,
            category: meta?.category,
            marketUrl: meta?.market_url,
            closeDate: meta?.close_date,
            analyzedAt: m.created_at,
            resolution: resolution ? {
              outcome: rMeta?.outcome,
              resolvedAt: rMeta?.resolved_at,
              brierScore: rMeta?.brier_score,
              correct: rMeta?.correct,
            } : null,
          };
        });

      // Apply resolved filter
      if (resolvedFilter === 'true') {
        records = records.filter(r => r.resolution !== null);
      } else if (resolvedFilter === 'false') {
        records = records.filter(r => r.resolution === null);
      }

      // Apply pagination
      const total = records.length;
      const paginated = records.slice(offset, offset + limit);

      res.json({
        predictions: paginated,
        total,
        limit,
        offset,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Predictions endpoint error');
      res.status(500).json({ error: 'Failed to fetch predictions' });
    }
  });

  // GET /api/compound/stats/timeline — Accuracy metrics over time
  // ?from=2026-01-01  &to=2026-03-21  &interval=week|month|day
  router.get('/stats/timeline', async (req: Request, res: Response) => {
    try {
      const fromDate = req.query.from ? new Date(req.query.from as string) : null;
      const toDate = req.query.to ? new Date(req.query.to as string) : null;
      const interval = (req.query.interval as string) || 'week';

      if (fromDate && isNaN(fromDate.getTime())) {
        res.status(400).json({ error: 'Invalid "from" date' });
        return;
      }
      if (toDate && isNaN(toDate.getTime())) {
        res.status(400).json({ error: 'Invalid "to" date' });
        return;
      }

      // Fetch all resolutions
      const resolutions = await recallMemories({
        tags: ['compound', 'resolution'],
        limit: 50,
        trackAccess: false,
        skipExpansion: true,
      });

      // Fetch all predictions for counts
      const predictions = await recallMemories({
        tags: ['compound', 'prediction'],
        limit: 50,
        trackAccess: false,
        skipExpansion: true,
      });

      // Filter by date range
      const filtered = resolutions.filter(r => {
        const rMeta = r.metadata as Record<string, unknown>;
        const resolvedAt = rMeta?.resolved_at ? new Date(rMeta.resolved_at as string) : new Date(r.created_at);
        if (fromDate && resolvedAt < fromDate) return false;
        if (toDate && resolvedAt > toDate) return false;
        return true;
      });

      // Group into time buckets
      const buckets = new Map<string, {
        period: string;
        predictions: number;
        resolved: number;
        correct: number;
        totalBrier: number;
      }>();

      // Also bucket predictions by analyzedAt
      for (const p of predictions) {
        const date = new Date(p.created_at);
        if (fromDate && date < fromDate) continue;
        if (toDate && date > toDate) continue;
        const key = getBucketKey(date, interval);
        if (!buckets.has(key)) {
          buckets.set(key, { period: key, predictions: 0, resolved: 0, correct: 0, totalBrier: 0 });
        }
        buckets.get(key)!.predictions++;
      }

      for (const r of filtered) {
        const rMeta = r.metadata as Record<string, unknown>;
        const resolvedAt = rMeta?.resolved_at ? new Date(rMeta.resolved_at as string) : new Date(r.created_at);
        const key = getBucketKey(resolvedAt, interval);

        if (!buckets.has(key)) {
          buckets.set(key, { period: key, predictions: 0, resolved: 0, correct: 0, totalBrier: 0 });
        }
        const bucket = buckets.get(key)!;
        bucket.resolved++;
        if (rMeta?.correct) bucket.correct++;
        bucket.totalBrier += (rMeta?.brier_score as number) ?? 0.25;
      }

      // Convert to sorted array with computed accuracy
      const timeline = Array.from(buckets.values())
        .sort((a, b) => a.period.localeCompare(b.period))
        .map(b => ({
          period: b.period,
          predictions: b.predictions,
          resolved: b.resolved,
          correct: b.correct,
          accuracy: b.resolved > 0 ? b.correct / b.resolved : null,
          avgBrierScore: b.resolved > 0 ? b.totalBrier / b.resolved : null,
        }));

      // Compute running totals
      let runningCorrect = 0;
      let runningResolved = 0;
      let runningBrier = 0;
      const timelineWithCumulative = timeline.map(t => {
        runningCorrect += t.correct;
        runningResolved += t.resolved;
        runningBrier += t.resolved > 0 ? t.avgBrierScore! * t.resolved : 0;
        return {
          ...t,
          cumulativeAccuracy: runningResolved > 0 ? runningCorrect / runningResolved : null,
          cumulativeAvgBrier: runningResolved > 0 ? runningBrier / runningResolved : null,
        };
      });

      res.json({
        timeline: timelineWithCumulative,
        interval,
        totalPredictions: predictions.length,
        totalResolved: filtered.length,
        from: fromDate?.toISOString() || null,
        to: toDate?.toISOString() || null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Stats timeline endpoint error');
      res.status(500).json({ error: 'Failed to fetch stats timeline' });
    }
  });

  return router;
}
