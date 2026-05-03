import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { Memory } from '../../types/memory';
import {
  CLUSTER_COLORS,
  FRAGMENTS as MOCK_FRAGMENTS,
  GRAPH_EDGES as MOCK_GRAPH_EDGES,
  GRAPH_NODES as MOCK_GRAPH_NODES,
  TOPICS as MOCK_TOPICS,
  type BondKind,
  type Cluster,
  type Fragment,
  type FragmentActor,
  type FragmentStatus,
  type GraphEdge,
  type GraphNode,
  type Topic,
} from './wiki-data';
import {
  SHOWCASE_MEMORIES,
  SHOWCASE_CONTRADICTIONS,
  SHOWCASE_TOPIC_COUNTS,
} from './showcase-data';
import { topicsFromPacks } from './wiki-packs';

export interface ContradictionPair {
  a: GraphMemoryNode;
  b: GraphMemoryNode;
  strength: number;
}

export interface GraphMemoryNode {
  id: number;
  type: string;
  summary: string;
  content: string;
  tags: string[];
  importance: number;
  source: string;
  createdAt: string;
}

export interface WikiData {
  topics: Topic[];
  fragments: Fragment[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  memories: Memory[];
  contradictions: ContradictionPair[];
  loading: boolean;
  error: string | null;
  source: 'live' | 'mock';
}

// Synthesize Memory[] from MOCK_FRAGMENTS so the article body, backlinks, and
// recent edits in `useTopicArticle` have content to render in mock mode.
const MOCK_MEMORIES: Memory[] = MOCK_FRAGMENTS.map((f, i) => {
  const minutesAgo = parseRelativeTime(f.time);
  const createdAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return {
    id: 1000 + i,
    hash_id: f.id,
    memory_type: f.actor === 'agent' ? 'episodic' : 'semantic',
    content: f.raw,
    summary: f.reframed ?? f.raw,
    tags: f.topic ? [f.topic] : [],
    concepts: [],
    emotional_valence: 0,
    importance: f.confidence,
    access_count: 0,
    source: f.source,
    source_id: null,
    related_user: null,
    related_wallet: null,
    metadata: {},
    created_at: createdAt,
    last_accessed: createdAt,
    decay_factor: f.status === 'archived' ? 0.4 : 0.9,
    evidence_ids: [],
    solana_signature: null,
    compacted: f.status === 'archived',
    compacted_into: null,
  };
});

function parseRelativeTime(s: string): number {
  const m = s.match(/(\d+)\s*([mhd])/);
  if (!m) return 60;
  const n = Number(m[1]);
  if (m[2] === 'm') return n;
  if (m[2] === 'h') return n * 60;
  return n * 60 * 24;
}

const MOCK: Omit<WikiData, 'loading' | 'error' | 'source'> = {
  topics: MOCK_TOPICS,
  fragments: MOCK_FRAGMENTS,
  graph: { nodes: MOCK_GRAPH_NODES, edges: MOCK_GRAPH_EDGES },
  memories: MOCK_MEMORIES,
  contradictions: [],
};

export interface UseWikiDataOptions {
  /** Use a richer curated dataset and skip API calls. Drives /showcase/wiki. */
  showcase?: boolean;
  /** Memory pack ids whose topics should appear in the rail. Defaults to ['workspace']. */
  installedPacks?: string[];
}

export function useWikiData(options: UseWikiDataOptions = {}): WikiData {
  const { showcase = false, installedPacks = ['workspace'] } = options;
  const [data, setData] = useState<Omit<WikiData, 'loading' | 'error' | 'source'>>(
    showcase ? buildShowcaseData(installedPacks) : MOCK,
  );
  const [loading, setLoading] = useState(!showcase);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'live' | 'mock'>(showcase ? 'live' : 'mock');

  // Re-derive when the installed-packs list changes in showcase mode.
  useEffect(() => {
    if (showcase) setData(buildShowcaseData(installedPacks));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showcase, installedPacks.join(',')]);

  useEffect(() => {
    if (showcase) return;
    let cancelled = false;
    (async () => {
      try {
        const [memResult, kg, memGraph] = await Promise.all([
          api.getMemories({ hours: 168, limit: 200 }),
          api.getKnowledgeGraph({ minMentions: 2 }).catch(() => ({ nodes: [], edges: [] })),
          api.getMemoryGraph({ limit: 200 }).catch(() => ({ nodes: [], links: [], total: 0 })),
        ]);

        if (cancelled) return;

        const memories = memResult.memories ?? [];

        const topics = kgToTopics(kg.nodes, memories);
        const graph = kgToGraph(kg.nodes, kg.edges);
        const contradictions = extractContradictions(memGraph.nodes, memGraph.links);

        const conflictIds = new Set<number>();
        for (const pair of contradictions) {
          conflictIds.add(pair.a.id);
          conflictIds.add(pair.b.id);
        }
        const fragments = memories.map((m) => memoryToFragment(m, conflictIds));

        const empty = fragments.length === 0 && topics.length === 0 && graph.nodes.length === 0;
        if (empty) {
          setData(MOCK);
          setSource('mock');
        } else {
          setData({
            topics: topics.length > 0 ? topics : MOCK.topics,
            fragments: fragments.length > 0 ? fragments : MOCK.fragments,
            graph: graph.nodes.length > 0 ? graph : MOCK.graph,
            memories,
            contradictions,
          });
          setSource('live');
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load wiki data');
        setData(MOCK);
        setSource('mock');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showcase]);

  return { ...data, loading, error, source };
}

// ─────────── Showcase mode ───────────

function buildShowcaseData(installedPacks: string[]): Omit<WikiData, 'loading' | 'error' | 'source'> {
  // Topics come from the union of installed packs. Counts derive from the
  // showcase seed where present; pack-only topics start at 0 (empty articles
  // ready to be filled).
  const topics: Topic[] = topicsFromPacks(installedPacks)
    .map((t) => ({ ...t, count: SHOWCASE_TOPIC_COUNTS[t.id] ?? 0 }));

  // Build a richer fragment list from the showcase memories — Inbox shows live
  // status diversity (synthesized / pending / archived / conflict) end-to-end.
  const conflictIds = new Set<number>();
  for (const pair of SHOWCASE_CONTRADICTIONS) {
    conflictIds.add(pair.a.id);
    conflictIds.add(pair.b.id);
  }
  const fragments: Fragment[] = SHOWCASE_MEMORIES.map((m) => memoryToFragment(m, conflictIds));

  // Brain map: 1 node per topic (sized by count) + entity nodes for the
  // most-frequent sources, using a circular layout that the force pass settles.
  const W = 1000;
  const H = 720;
  const cx = W / 2;
  const cy = H / 2;
  const radius = Math.min(W, H) / 3;
  const topicNodes: GraphNode[] = topics.map((t, i) => {
    const angle = (i / topics.length) * Math.PI * 2;
    return {
      id: t.id,
      label: t.name,
      cluster: t.cluster,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      r: 14 + Math.min(20, Math.sqrt(t.count) * 6),
      weight: t.count,
    };
  });
  // Cross-topic edges synthesized from "memory mentions another topic" — what
  // backlink-derivation already does, but flattened into graph edges.
  const edges: GraphEdge[] = [];
  for (const m of SHOWCASE_MEMORIES) {
    const ownTopic = m.tags[0];
    if (!ownTopic) continue;
    for (const other of topics) {
      if (other.id === ownTopic) continue;
      if ((m.summary || m.content || '').toLowerCase().includes(other.name.toLowerCase())) {
        edges.push({ source: ownTopic, target: other.id, kind: 'relates', weight: 0.5 });
      }
    }
  }
  // Add the contradiction pair as a contradicts edge between the topics.
  for (const pair of SHOWCASE_CONTRADICTIONS) {
    const aTopic = pair.a.tags[0];
    const bTopic = pair.b.tags[0];
    if (aTopic && bTopic && aTopic !== bTopic) {
      edges.push({ source: aTopic, target: bTopic, kind: 'contradicts', weight: 0.8 });
    }
  }

  return {
    topics,
    fragments,
    graph: { nodes: topicNodes, edges: dedupeEdges(edges) },
    memories: SHOWCASE_MEMORIES,
    contradictions: SHOWCASE_CONTRADICTIONS,
  };
}

function dedupeEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  const out: GraphEdge[] = [];
  for (const e of edges) {
    const key = e.source < e.target
      ? `${e.source}:${e.target}:${e.kind}`
      : `${e.target}:${e.source}:${e.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

// ─────────── Mappers ───────────

function memoryToFragment(m: Memory, conflictIds: Set<number>): Fragment {
  return {
    id: m.hash_id || `mem-${m.id}`,
    source: prettySource(m.source),
    actor: actorFromSource(m.source),
    time: relativeTime(m.created_at),
    status: statusFromMemory(m, conflictIds),
    raw: m.content,
    reframed: m.summary && m.summary !== m.content ? m.summary : null,
    topic: pickPrimaryTag(m.tags),
    confidence: clamp01(m.importance ?? 0.5),
    memoryId: m.id,
    memoryCreatedAt: m.created_at,
  };
}

function statusFromMemory(m: Memory, conflictIds: Set<number>): FragmentStatus {
  // Conflict wins over everything actionable — even a compacted memory
  // in an unresolved contradiction should surface as a conflict for the user.
  if (conflictIds.has(m.id)) return 'conflict';
  if (m.compacted) return 'archived';
  if (m.summary && m.summary !== m.content) return 'synthesized';
  if ((m.importance ?? 0) < 0.2) return 'archived';
  return 'pending';
}

function actorFromSource(source: string): FragmentActor {
  const s = (source || '').toLowerCase();
  if (s.startsWith('mcp:') || s.startsWith('twitter:') || s.startsWith('webhook') ||
      s.startsWith('cludebot') || s.includes(':agent')) return 'agent';
  return 'user';
}

export function prettySource(source: string): string {
  if (!source) return 'unknown';
  if (source.startsWith('mcp:')) return source.slice(4);
  return source;
}

function pickPrimaryTag(tags: string[] | undefined): string | null {
  if (!tags || tags.length === 0) return null;
  return tags[0].toLowerCase().replace(/\s+/g, '-');
}

export function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'recent';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

// Map entity types from the entity-graph to wiki clusters (color buckets).
function clusterForEntityType(t: string): Cluster {
  const k = (t || '').toLowerCase();
  if (k === 'person' || k === 'wallet') return 'self';
  if (k === 'project' || k === 'token') return 'product';
  if (k === 'concept' || k === 'event' || k === 'location') return 'research';
  return 'architecture';
}

function kgToTopics(
  nodes: Array<{ id: string; type: string; label: string; size: number }>,
  memories: Memory[],
): Topic[] {
  if (!nodes || nodes.length === 0) return [];
  // Use top-N by size as topics; entities below threshold stay as graph-only entities.
  const sorted = [...nodes].sort((a, b) => b.size - a.size);
  const top = sorted.slice(0, 12);

  return top.map((n) => {
    const cluster = clusterForEntityType(n.type);
    const summary = summaryForEntity(n.label, memories);
    return {
      id: slugify(n.id || n.label),
      name: n.label,
      cluster,
      color: CLUSTER_COLORS[cluster],
      count: n.size,
      summary,
    };
  });
}

function summaryForEntity(label: string, memories: Memory[]): string {
  const needle = label.toLowerCase();
  const hit = memories.find((m) =>
    (m.summary || m.content || '').toLowerCase().includes(needle),
  );
  if (hit) {
    const text = hit.summary || hit.content || '';
    return text.length > 180 ? `${text.slice(0, 177)}…` : text;
  }
  return `${label} — surfaced from the memory graph; no summary yet.`;
}

function kgToGraph(
  nodes: Array<{ id: string; type: string; label: string; size: number }>,
  edges: Array<{ source: string; target: string; type: string; weight: number }>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (!nodes || nodes.length === 0) return { nodes: [], edges: [] };

  const W = 1000;
  const H = 720;
  const cx = W / 2;
  const cy = H / 2;
  const radius = Math.min(W, H) / 3;
  const total = nodes.length;

  // Initial circular positions; force layout in GraphTab will re-settle them.
  const gnodes: GraphNode[] = nodes.map((n, i) => {
    const cluster = clusterForEntityType(n.type);
    const angle = (i / total) * Math.PI * 2;
    const r = 14 + Math.min(20, Math.sqrt(n.size) * 4);
    return {
      id: slugify(n.id || n.label),
      label: n.label,
      cluster,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      r,
      weight: n.size,
      kind: 'entity',
    };
  });

  const ids = new Set(gnodes.map((n) => n.id));
  const gedges: GraphEdge[] = (edges || [])
    .map((e) => ({
      source: slugify(e.source),
      target: slugify(e.target),
      kind: bondFromRelation(e.type),
      weight: clamp01(e.weight ?? 0.5),
    }))
    .filter((e) => ids.has(e.source) && ids.has(e.target));

  return { nodes: gnodes, edges: gedges };
}

// Pairs of memories with `link_type='contradicts'` where neither side has been
// pinned by a later `resolves` link. The dream cycle's resolution phase stores
// a new semantic memory with `resolves` links pointing to BOTH contradicting
// memories — so the presence of a resolves edge at A or B means "handled."
function extractContradictions(
  nodes: GraphMemoryNode[],
  links: Array<{ source_id: number; target_id: number; link_type: string; strength: number }>,
): ContradictionPair[] {
  if (!nodes || !links || nodes.length === 0) return [];

  const byId = new Map<number, GraphMemoryNode>();
  for (const n of nodes) byId.set(n.id, n);

  const resolvedIds = new Set<number>();
  for (const l of links) {
    if (l.link_type === 'resolves') {
      resolvedIds.add(l.source_id);
      resolvedIds.add(l.target_id);
    }
  }

  const seen = new Set<string>();
  const out: ContradictionPair[] = [];
  for (const l of links) {
    if (l.link_type !== 'contradicts') continue;
    if (resolvedIds.has(l.source_id) || resolvedIds.has(l.target_id)) continue;
    const a = byId.get(l.source_id);
    const b = byId.get(l.target_id);
    if (!a || !b) continue;

    const key = l.source_id < l.target_id
      ? `${l.source_id}-${l.target_id}`
      : `${l.target_id}-${l.source_id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Older first, newer second — matches the existing UI's "Older / Newer" rows.
    const aTime = new Date(a.createdAt).getTime();
    const bTime = new Date(b.createdAt).getTime();
    out.push({
      a: aTime <= bTime ? a : b,
      b: aTime <= bTime ? b : a,
      strength: l.strength ?? 0.5,
    });
  }
  return out.sort((x, y) => y.strength - x.strength);
}

function bondFromRelation(rel: string): BondKind {
  const k = (rel || '').toLowerCase();
  if (k.includes('cause')) return 'causes';
  if (k.includes('support') || k === 'works_at' || k === 'founded') return 'supports';
  if (k.includes('contradict')) return 'contradicts';
  if (k.includes('elaborat')) return 'elaborates';
  if (k.includes('follow') || k === 'happens_after' || k === 'happens_before') return 'follows';
  return 'relates';
}

function slugify(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'node';
}
