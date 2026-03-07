/**
 * Memory Provenance — trace the ancestry and reasoning chain behind any memory.
 * 
 * Three capabilities:
 * 1. trace(id) — walk backwards through consolidation chains, evidence links, entity connections
 * 2. explain(id, question) — LLM-powered explanation using the full trace as context
 * 3. timeline(id) — chronological view of how a memory evolved
 */

import { getDb } from '../core/database';
import { scopeToOwner } from '../core/memory';
import { generateResponse } from '../core/claude-client';
import type { CognitiveFunction } from '../core/venice-client';
import { createChildLogger } from '../core/logger';

const log = createChildLogger('memory-trace');

// ── Types ──────────────────────────────────────────────────────────────

export interface TraceNode {
  id: number;
  hash_id: string;
  summary: string;
  content: string;
  memory_type: string;
  source: string;
  importance: number;
  emotional_valence: number;
  decay_factor: number;
  access_count: number;
  created_at: string;
  last_accessed: string;
  tags: string[];
  concepts: string[];
  depth: number;              // 0 = root memory, 1 = direct parent/child, etc.
  relation: string;           // how this node relates to its parent in the trace
  strength: number;           // link strength (1.0 for root)
}

export interface TraceResult {
  root: TraceNode;
  ancestors: TraceNode[];     // memories that led TO this one (consolidation sources, evidence)
  descendants: TraceNode[];   // memories derived FROM this one
  related: TraceNode[];       // entity-linked and concept-linked memories
  links: TraceLink[];         // all links in the trace
  entities: TraceEntity[];    // entities mentioned in the root memory
  timeline: TraceNode[];      // all nodes sorted chronologically
  stats: {
    total_nodes: number;
    max_depth: number;
    link_types: Record<string, number>;
    time_span_days: number;
  };
}

export interface TraceLink {
  source_id: number;
  target_id: number;
  link_type: string;
  strength: number;
}

export interface TraceEntity {
  id: number;
  name: string;
  entity_type: string;
  memory_count: number;
}

export interface ExplainResult {
  explanation: string;
  trace_summary: string;
  key_memories: Array<{ id: number; summary: string; relevance: string }>;
  reasoning_chain: string[];
}

// ── Core Trace ─────────────────────────────────────────────────────────

const MEMORY_FIELDS = 'id, hash_id, summary, content, memory_type, source, importance, emotional_valence, decay_factor, access_count, created_at, last_accessed, tags, concepts, evidence_ids, metadata';

function toTraceNode(row: Record<string, unknown>, depth: number, relation: string, strength: number): TraceNode {
  return {
    id: Number(row.id),
    hash_id: String(row.hash_id || ''),
    summary: String(row.summary || ''),
    content: String(row.content || ''),
    memory_type: String(row.memory_type || ''),
    source: String(row.source || ''),
    importance: Number(row.importance || 0),
    emotional_valence: Number(row.emotional_valence || 0),
    decay_factor: Number(row.decay_factor || 1),
    access_count: Number(row.access_count || 0),
    created_at: String(row.created_at || ''),
    last_accessed: String(row.last_accessed || ''),
    tags: (row.tags || []) as string[],
    concepts: (row.concepts || []) as string[],
    depth,
    relation,
    strength,
  };
}

/**
 * Trace the full provenance of a memory — ancestors, descendants, related.
 * Walks up to `maxDepth` hops in each direction.
 */
export async function traceMemory(memoryId: number, maxDepth = 3): Promise<TraceResult | null> {
  const db = getDb();

  // Fetch root memory
  let rootQuery = db.from('memories').select(MEMORY_FIELDS).eq('id', memoryId);
  rootQuery = scopeToOwner(rootQuery);
  const { data: rootData, error: rootErr } = await rootQuery.single();

  if (rootErr || !rootData) {
    log.warn({ memoryId, error: rootErr }, 'Memory not found for trace');
    return null;
  }

  const root = toTraceNode(rootData as Record<string, unknown>, 0, 'root', 1.0);
  const visited = new Set<number>([memoryId]);
  const ancestors: TraceNode[] = [];
  const descendants: TraceNode[] = [];
  const related: TraceNode[] = [];
  const allLinks: TraceLink[] = [];

  // ── Walk ancestors (who contributed to this memory?) ──
  // 1. evidence_ids — memories cited as evidence
  const evidenceIds = ((rootData as Record<string, unknown>).evidence_ids || []) as number[];
  if (evidenceIds.length > 0) {
    let evidenceQuery = db.from('memories').select(MEMORY_FIELDS).in('id', evidenceIds);
    evidenceQuery = scopeToOwner(evidenceQuery);
    const { data: evidenceData } = await evidenceQuery;
    if (evidenceData) {
      for (const row of evidenceData as Record<string, unknown>[]) {
        const id = Number(row.id);
        if (!visited.has(id)) {
          visited.add(id);
          ancestors.push(toTraceNode(row, 1, 'evidence', 0.9));
          allLinks.push({ source_id: id, target_id: memoryId, link_type: 'supports', strength: 0.9 });
        }
      }
    }
  }

  // 2. memory_links — walk backwards through link graph
  await walkLinks(db, memoryId, 'backward', maxDepth, visited, ancestors, allLinks);

  // ── Walk descendants (what was derived from this memory?) ──
  await walkLinks(db, memoryId, 'forward', maxDepth, visited, descendants, allLinks);

  // ── Entity-linked memories ──
  const entities = await getMemoryEntities(db, memoryId);
  for (const entity of entities) {
    let entityMemQuery = db
      .from('memories')
      .select(MEMORY_FIELDS)
      .contains('concepts', [entity.name.toLowerCase()])
      .neq('id', memoryId)
      .order('importance', { ascending: false })
      .limit(5);
    entityMemQuery = scopeToOwner(entityMemQuery);
    const { data: entityMems } = await entityMemQuery;
    if (entityMems) {
      for (const row of entityMems as Record<string, unknown>[]) {
        const id = Number(row.id);
        if (!visited.has(id)) {
          visited.add(id);
          related.push(toTraceNode(row, 1, `entity:${entity.name}`, 0.6));
        }
      }
    }
  }

  // ── Build timeline ──
  const allNodes = [root, ...ancestors, ...descendants, ...related];
  const timeline = [...allNodes].sort((a, b) => 
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  // ── Stats ──
  const linkTypeCounts: Record<string, number> = {};
  for (const link of allLinks) {
    linkTypeCounts[link.link_type] = (linkTypeCounts[link.link_type] || 0) + 1;
  }

  const dates = allNodes.map(n => new Date(n.created_at).getTime()).filter(t => !isNaN(t));
  const timeSpanDays = dates.length > 1 
    ? (Math.max(...dates) - Math.min(...dates)) / (1000 * 60 * 60 * 24) 
    : 0;

  return {
    root,
    ancestors,
    descendants,
    related,
    links: allLinks,
    entities,
    timeline,
    stats: {
      total_nodes: allNodes.length,
      max_depth: Math.max(0, ...allNodes.map(n => n.depth)),
      link_types: linkTypeCounts,
      time_span_days: Math.round(timeSpanDays * 10) / 10,
    },
  };
}

// ── Link Walking ───────────────────────────────────────────────────────

async function walkLinks(
  db: ReturnType<typeof getDb>,
  startId: number,
  direction: 'forward' | 'backward',
  maxDepth: number,
  visited: Set<number>,
  results: TraceNode[],
  allLinks: TraceLink[],
): Promise<void> {
  let frontier = [startId];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const nextFrontier: number[] = [];

    // Query links in the appropriate direction
    const sourceCol = direction === 'backward' ? 'target_id' : 'source_id';
    const targetCol = direction === 'backward' ? 'source_id' : 'target_id';

    const { data: links } = await db
      .from('memory_links')
      .select(`${targetCol}, link_type, strength`)
      .in(sourceCol, frontier)
      .order('strength', { ascending: false })
      .limit(20);

    if (!links || links.length === 0) break;

    const targetIds = (links as Record<string, unknown>[])
      .map(l => Number(l[targetCol]))
      .filter(id => !visited.has(id));

    if (targetIds.length === 0) break;

    // Fetch memory details
    let memQuery = db.from('memories').select(MEMORY_FIELDS).in('id', targetIds);
    memQuery = scopeToOwner(memQuery);
    const { data: mems } = await memQuery;

    if (mems) {
      const linkMap = new Map<number, { link_type: string; strength: number }>();
      for (const l of links as Record<string, unknown>[]) {
        const tid = Number(l[targetCol]);
        if (!linkMap.has(tid)) {
          linkMap.set(tid, { link_type: String(l.link_type), strength: Number(l.strength) });
        }
      }

      for (const row of mems as Record<string, unknown>[]) {
        const id = Number(row.id);
        if (visited.has(id)) continue;
        visited.add(id);

        const linkInfo = linkMap.get(id) || { link_type: 'relates', strength: 0.5 };
        results.push(toTraceNode(row, depth, linkInfo.link_type, linkInfo.strength));

        allLinks.push({
          source_id: direction === 'backward' ? id : startId,
          target_id: direction === 'backward' ? startId : id,
          link_type: linkInfo.link_type,
          strength: linkInfo.strength,
        });

        nextFrontier.push(id);
      }
    }

    frontier = nextFrontier;
  }
}

// ── Entity Lookup ──────────────────────────────────────────────────────

async function getMemoryEntities(db: ReturnType<typeof getDb>, memoryId: number): Promise<TraceEntity[]> {
  // Get entities from entity_relations table linked to this memory
  const { data: relations } = await db
    .from('entity_relations')
    .select('entity_id, entity:entities(id, name, entity_type)')
    .eq('memory_id', memoryId)
    .limit(10);

  if (!relations || relations.length === 0) {
    // Fallback: use concepts from the memory itself
    return [];
  }

  const entities: TraceEntity[] = [];
  for (const rel of relations as Record<string, unknown>[]) {
    const entity = rel.entity as Record<string, unknown> | null;
    if (entity) {
      // Count how many memories reference this entity
      const { count } = await db
        .from('entity_relations')
        .select('*', { count: 'exact', head: true })
        .eq('entity_id', Number(entity.id));

      entities.push({
        id: Number(entity.id),
        name: String(entity.name),
        entity_type: String(entity.entity_type || 'unknown'),
        memory_count: count || 0,
      });
    }
  }

  return entities;
}

// ── Explain ────────────────────────────────────────────────────────────

/**
 * Given a memory and a question, use the full trace to generate an explanation.
 * "Why did you think this?" → walks through the reasoning chain.
 */
export async function explainMemory(
  memoryId: number,
  question: string,
): Promise<ExplainResult | null> {
  const trace = await traceMemory(memoryId, 3);
  if (!trace) return null;

  // Build context from the trace
  const contextParts: string[] = [];
  
  contextParts.push(`## Root Memory (ID: ${trace.root.id})`);
  contextParts.push(`Created: ${trace.root.created_at}`);
  contextParts.push(`Type: ${trace.root.memory_type} | Source: ${trace.root.source}`);
  contextParts.push(`Importance: ${trace.root.importance} | Accessed: ${trace.root.access_count} times`);
  contextParts.push(`Summary: ${trace.root.summary}`);
  contextParts.push(`Content: ${trace.root.content}`);
  contextParts.push('');

  if (trace.ancestors.length > 0) {
    contextParts.push(`## Ancestor Memories (${trace.ancestors.length} memories that led to this)`);
    for (const a of trace.ancestors.slice(0, 10)) {
      contextParts.push(`- [${a.relation}] (${a.created_at}) ${a.summary}`);
      if (a.content && a.content !== a.summary) {
        contextParts.push(`  Content: ${a.content.slice(0, 300)}`);
      }
    }
    contextParts.push('');
  }

  if (trace.descendants.length > 0) {
    contextParts.push(`## Descendant Memories (${trace.descendants.length} memories derived from this)`);
    for (const d of trace.descendants.slice(0, 10)) {
      contextParts.push(`- [${d.relation}] (${d.created_at}) ${d.summary}`);
    }
    contextParts.push('');
  }

  if (trace.related.length > 0) {
    contextParts.push(`## Related Memories (${trace.related.length} connected via shared entities/concepts)`);
    for (const r of trace.related.slice(0, 10)) {
      contextParts.push(`- [${r.relation}] (${r.created_at}) ${r.summary}`);
    }
    contextParts.push('');
  }

  if (trace.entities.length > 0) {
    contextParts.push(`## Entities`);
    for (const e of trace.entities) {
      contextParts.push(`- ${e.name} (${e.entity_type}) — referenced in ${e.memory_count} memories`);
    }
    contextParts.push('');
  }

  contextParts.push(`## Timeline`);
  contextParts.push(`This memory's history spans ${trace.stats.time_span_days} days across ${trace.stats.total_nodes} connected memories.`);
  const linkSummary = Object.entries(trace.stats.link_types).map(([k, v]) => `${k}: ${v}`).join(', ');
  if (linkSummary) contextParts.push(`Link types: ${linkSummary}`);

  const traceContext = contextParts.join('\n');

  // Generate explanation via LLM
  const systemPrompt = `You are Clude, an AI agent with a molecular memory system. You are explaining your own memory and reasoning to your owner.

Given a specific memory and its full provenance trace (ancestor memories, descendants, related memories, entity connections), answer the user's question about WHY this memory exists and what led to it.

Be specific. Reference actual memories from the trace by their dates and content. Show the chain of reasoning — what happened first, what you learned, how your understanding evolved.

If the trace shows mistakes → lessons learned → updated behavior, highlight that arc explicitly.

Format your response as:
1. A direct answer to the question
2. The key memories that matter most (with dates)
3. The reasoning chain (step by step, chronological)`;

  const userPrompt = `${traceContext}

---

Question: ${question}`;

  const response = await generateResponse({
    userMessage: userPrompt,
    featureInstruction: systemPrompt,
    cognitiveFunction: 'summarize' as CognitiveFunction,
    maxTokens: 1500,
  });

  if (!response) return null;

  // Extract key memories referenced in the explanation
  const keyMemories: Array<{ id: number; summary: string; relevance: string }> = [];
  const allTraceNodes = [trace.root, ...trace.ancestors, ...trace.descendants, ...trace.related];
  
  // Pick the most important ones
  const sorted = [...allTraceNodes].sort((a, b) => {
    const scoreA = a.importance * a.strength * (a.depth === 0 ? 2 : 1 / a.depth);
    const scoreB = b.importance * b.strength * (b.depth === 0 ? 2 : 1 / b.depth);
    return scoreB - scoreA;
  });

  for (const node of sorted.slice(0, 5)) {
    keyMemories.push({
      id: node.id,
      summary: node.summary,
      relevance: node.relation,
    });
  }

  // Build reasoning chain from timeline
  const reasoningChain = trace.timeline
    .filter(n => n.depth <= 2)
    .slice(0, 8)
    .map(n => `${n.created_at.split('T')[0]}: ${n.summary.slice(0, 100)}`);

  return {
    explanation: response,
    trace_summary: `Traced ${trace.stats.total_nodes} memories across ${trace.stats.time_span_days} days with ${trace.links.length} links`,
    key_memories: keyMemories,
    reasoning_chain: reasoningChain,
  };
}
