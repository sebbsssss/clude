import { Router, Request, Response } from 'express';
import { createChildLogger } from '../core/logger';
import {
  getKnowledgeGraph,
  getGraphStats,
  findOrCreateEntity,
  getMemoriesByEntity,
  findSimilarEntities,
  type EntityType,
} from '../core/memory-graph';
import { getDb } from '../core/database';

const log = createChildLogger('graph-routes');

export function graphRoutes(): Router {
  const router = Router();

  // Get full knowledge graph for visualization
  // GET /api/graph?entityTypes=person,project&minMentions=2&includeMemories=true&limit=100
  router.get('/', async (req: Request, res: Response) => {
    try {
      const entityTypes = req.query.entityTypes
        ? String(req.query.entityTypes).split(',') as EntityType[]
        : undefined;
      const minMentions = parseInt(req.query.minMentions as string) || 1;
      const includeMemories = req.query.includeMemories === 'true';
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

      const graph = await getKnowledgeGraph({
        entityTypes,
        minMentions,
        includeMemories,
        limit,
      });

      res.json({
        ...graph,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Graph endpoint error');
      res.status(500).json({ error: 'Failed to fetch knowledge graph' });
    }
  });

  // Get graph stats
  router.get('/stats', async (_req: Request, res: Response) => {
    try {
      const stats = await getGraphStats();
      res.json({
        ...stats,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Graph stats error');
      res.status(500).json({ error: 'Failed to fetch graph stats' });
    }
  });

  // Search entities
  // GET /api/graph/search?q=Seb&types=person,project&limit=10
  router.get('/search', async (req: Request, res: Response) => {
    try {
      const query = String(req.query.q || '');
      if (!query) {
        res.status(400).json({ error: 'Query parameter q is required' });
        return;
      }

      const entityTypes = req.query.types
        ? String(req.query.types).split(',') as EntityType[]
        : undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

      const entities = await findSimilarEntities(query, { limit, entityTypes });

      res.json({
        entities: entities.map(e => ({
          id: e.id,
          type: e.entity_type,
          name: e.name,
          aliases: e.aliases,
          description: e.description,
          mentionCount: e.mention_count,
          firstSeen: e.first_seen,
          lastSeen: e.last_seen,
        })),
        count: entities.length,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Entity search error');
      res.status(500).json({ error: 'Entity search failed' });
    }
  });

  // Get entity details + related memories
  // GET /api/graph/entity/:id
  router.get('/entity/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid entity ID' });
        return;
      }

      const db = getDb();
      const { data: entity, error } = await db
        .from('entities')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !entity) {
        res.status(404).json({ error: 'Entity not found' });
        return;
      }

      // Get memories mentioning this entity
      const memories = await getMemoriesByEntity(id, { limit: 20 });

      // Get related entities (via co-occurrence)
      const { data: cooccurrence } = await db.rpc('get_entity_cooccurrence', {
        entity_id: id,
        min_cooccurrence: 1,
        max_results: 10,
      });

      // Get entity relations
      const { data: relations } = await db
        .from('entity_relations')
        .select(`
          id,
          relation_type,
          strength,
          target_entity_id,
          target:entities!target_entity_id (id, name, entity_type)
        `)
        .eq('source_entity_id', id);

      const { data: reverseRelations } = await db
        .from('entity_relations')
        .select(`
          id,
          relation_type,
          strength,
          source_entity_id,
          source:entities!source_entity_id (id, name, entity_type)
        `)
        .eq('target_entity_id', id);

      res.json({
        entity: {
          id: entity.id,
          type: entity.entity_type,
          name: entity.name,
          aliases: entity.aliases,
          description: entity.description,
          mentionCount: entity.mention_count,
          firstSeen: entity.first_seen,
          lastSeen: entity.last_seen,
          metadata: entity.metadata,
        },
        memories: memories.map(m => ({
          id: m.id,
          type: m.memory_type,
          summary: m.summary,
          importance: m.importance,
          createdAt: m.created_at,
        })),
        relatedEntities: (cooccurrence || []).map((c: any) => ({
          entityId: c.related_entity_id,
          cooccurrenceCount: c.cooccurrence_count,
          avgSalience: c.avg_salience,
        })),
        relations: [
          ...(relations || []).map((r: any) => ({
            id: r.id,
            type: r.relation_type,
            strength: r.strength,
            direction: 'outgoing',
            target: r.target,
          })),
          ...(reverseRelations || []).map((r: any) => ({
            id: r.id,
            type: r.relation_type,
            strength: r.strength,
            direction: 'incoming',
            source: r.source,
          })),
        ],
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Entity details error');
      res.status(500).json({ error: 'Failed to fetch entity details' });
    }
  });

  // Get neighborhood around an entity (for focused visualization)
  // GET /api/graph/neighborhood/:id
  router.get('/neighborhood/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid entity ID' });
        return;
      }

      const db = getDb();
      const { data, error } = await db.rpc('get_entity_neighborhood', {
        seed_entity_id: id,
        max_entities: 30,
        max_memories: 20,
      });

      if (error) {
        log.error({ error: error.message }, 'Neighborhood RPC failed');
        res.status(500).json({ error: 'Failed to fetch neighborhood' });
        return;
      }

      // Transform into graph format
      const nodes: Array<{ id: string; type: string; label: string }> = [];
      const edges: Array<{ source: string; target: string; type: string; weight?: number }> = [];
      const seenNodes = new Set<string>();

      for (const row of data || []) {
        const nodeId = `${row.node_type}-${row.node_id}`;
        if (!seenNodes.has(nodeId)) {
          nodes.push({
            id: nodeId,
            type: row.node_type,
            label: row.node_label,
          });
          seenNodes.add(nodeId);
        }

        if (row.edge_type && row.node_id !== id) {
          edges.push({
            source: `entity-${id}`,
            target: nodeId,
            type: row.edge_type,
            weight: row.edge_weight,
          });
        }
      }

      res.json({
        nodes,
        edges,
        seedEntityId: id,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Neighborhood endpoint error');
      res.status(500).json({ error: 'Failed to fetch neighborhood' });
    }
  });

  return router;
}
