import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { Memory } from '../../types/memory';
import {
  CLUSTER_COLORS,
  type Topic,
  type Contradiction,
} from './wiki-data';
import { prettySource, relativeTime, type ContradictionPair, type GraphMemoryNode } from './use-wiki-data';
import { getCuratedArticle, findCuratedBacklinks } from './showcase-articles';
import { packForTopic } from './wiki-packs';

export type ProseBlock =
  | { kind: 'p'; text: string }
  | { kind: 'reframe'; memoryHash: string }
  | { kind: 'contradiction' }
  | { kind: 'callout'; tone: 'question' | 'note'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'code'; lang?: string; text: string }
  // Empty-state placeholder: rendered when a section template has no
  // memories yet. Carries a hint about what kind of content lands here
  // and which keywords trigger auto-categorisation.
  | { kind: 'placeholder'; sectionKind: SectionKind; hintKeywords?: string[] };

// Section visual kind. Drives the left-edge accent + glyph + tint so the eye
// can scan an article and immediately spot what's working / what isn't /
// what's open / what needs doing — without having to read the headings.
export type SectionKind = 'overview' | 'highlight' | 'concern' | 'question' | 'action' | 'decision';

export interface ArticleSection {
  id: string;
  title: string;
  kind?: SectionKind;
  // Live/derived path: render each memory as a Reframe/raw block.
  memories: Memory[];
  // Curated path (showcase): render hand-authored prose with embedded refs.
  // When present, takes precedence over `memories` for rendering.
  prose?: ProseBlock[];
}

export interface TopicArticle {
  id: string;
  title: string;
  cluster: string;
  color: string;
  lede: string;
  meta: { sources: number; updated: string; contributors: number; confidence: number };
  sections: ArticleSection[];
}

export interface Backlink {
  id: string;
  title: string;
  color: string;
  snip: string;
}

export interface RecentEdit {
  icon: string;
  text: string;
  time: string;
}

export interface TopicData {
  article: TopicArticle | null;
  backlinks: Backlink[];
  recentEdits: RecentEdit[];
  contradictions: Contradiction[];
  loading: boolean;
}

export function useTopicArticle(
  topic: Topic | null,
  allTopics: Topic[],
  recentMemories: Memory[],
  contradictionPairs: ContradictionPair[],
): TopicData {
  const [recalled, setRecalled] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!topic) {
      setRecalled([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const result = await api.recall(topic.name, { limit: 25 });
        if (cancelled) return;
        setRecalled(Array.isArray(result) ? result : []);
      } catch {
        if (!cancelled) setRecalled([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Identity-based: refetch only when the topic id/name changes, not when
    // the parent's `topics.find(...)` returns a fresh object reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic?.id, topic?.name]);

  if (!topic) {
    return { article: null, backlinks: [], recentEdits: [], contradictions: [], loading: false };
  }

  // Merge recall results with the locally-fetched recent memories so we have the
  // best of both: semantic-relevant + fresh.
  const merged = mergeUnique(recalled, recentMemories.filter((m) => mentionsTopic(m, topic)));

  const article = buildArticle(topic, merged);
  applyCuratedSections(article, topic, merged);
  applyTemplateSections(article, topic);
  const curatedBacklinks = curatedBacklinksFor(topic, allTopics);
  const backlinks = curatedBacklinks.length > 0
    ? curatedBacklinks
    : buildBacklinks(topic, allTopics, recentMemories);
  const recentEdits = buildRecentEdits(merged.length > 0 ? merged : recentMemories);
  const contradictions = buildContradictions(topic, contradictionPairs);

  return { article, backlinks, recentEdits, contradictions, loading };
}

function curatedBacklinksFor(topic: Topic, allTopics: Topic[]): Backlink[] {
  const refs = findCuratedBacklinks(topic.id);
  if (refs.length === 0) return [];
  return refs
    .map((r) => {
      const fromTopic = allTopics.find((t) => t.id === r.fromTopicId);
      if (!fromTopic) return null;
      return {
        id: fromTopic.id,
        title: fromTopic.name,
        color: fromTopic.color,
        snip: r.snippet,
      } as Backlink;
    })
    .filter((b): b is Backlink => b !== null);
}

// Replace `article.sections` with hand-authored prose sections when a
// curated article exists for this topic. Memories used inside the prose
// are kept (other consumers may still want them).
function applyCuratedSections(article: TopicArticle, topic: Topic, memories: Memory[]): void {
  const curated = getCuratedArticle(topic.id);
  if (!curated) return;
  article.sections = curated.sections.map((s) => ({
    id: s.id,
    title: s.title,
    kind: s.kind,
    memories: memoriesReferencedBy(s.prose, memories),
    prose: s.prose,
  }));
}

function memoriesReferencedBy(prose: ProseBlock[], memories: Memory[]): Memory[] {
  const hashes = new Set<string>();
  for (const b of prose) if (b.kind === 'reframe') hashes.add(b.memoryHash);
  return memories.filter((m) => m.hash_id && hashes.has(m.hash_id));
}

// When a topic comes from a pack with `sectionTemplates` and the article
// has no sections yet (no curated body, no memories indexed), render the
// pack's intended structure as empty scaffolding. Each templated section
// gets a single `placeholder` ProseBlock that hints at what'll land here
// + which keywords trigger auto-categorisation. Lets installed-but-unused
// packs feel like real workspaces, not blank pages.
function applyTemplateSections(article: TopicArticle, topic: Topic): void {
  if (article.sections.length > 0) return;

  const pack = packForTopic(topic.id);
  if (!pack) return;

  const packTopic = pack.topics.find((t) => t.id === topic.id);
  const templates = packTopic?.sectionTemplates ?? [];
  if (templates.length === 0) return;

  const rule = pack.rules.find((r) => r.topicId === topic.id);
  const hintKeywords = rule?.keywords?.slice(0, 4);

  article.sections = templates.map((tpl) => {
    const sectionKind = (tpl.kind as TopicArticle['sections'][number]['kind']) ?? 'overview';
    return {
      id: tpl.id,
      title: tpl.title,
      kind: sectionKind,
      memories: [],
      prose: [{ kind: 'placeholder', sectionKind: sectionKind!, hintKeywords }],
    };
  });
}

// ─────────── Contradictions per topic ───────────

function buildContradictions(topic: Topic, pairs: ContradictionPair[]): Contradiction[] {
  if (!pairs || pairs.length === 0) return [];

  return pairs
    .filter((p) => graphNodeMentionsTopic(p.a, topic) || graphNodeMentionsTopic(p.b, topic))
    .map((p) => {
      const aText = (p.a.summary || p.a.content || '').trim();
      const bText = (p.b.summary || p.b.content || '').trim();
      const aWhen = relativeTime(p.a.createdAt);
      const bWhen = relativeTime(p.b.createdAt);
      const aSrc = `${prettySource(p.a.source)} · ${aWhen}`;
      const bSrc = `${prettySource(p.b.source)} · ${bWhen}`;
      return {
        topic: topic.name,
        a: trim(aText, 200),
        aSrc,
        b: trim(bText, 200),
        bSrc,
        suggestion: `Newer memory updated ${bWhen}; adopt unless you have evidence otherwise.`,
        aId: p.a.id,
        bId: p.b.id,
      };
    });
}

function graphNodeMentionsTopic(n: GraphMemoryNode, topic: Topic): boolean {
  const needle = topic.name.toLowerCase();
  const text = `${n.content || ''} ${n.summary || ''}`.toLowerCase();
  if (text.includes(needle)) return true;
  return (n.tags || []).some((t) => slug(t) === topic.id);
}

function trim(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// ─────────── Article assembly ───────────

/**
 * Synchronous article builder for export paths that need to construct
 * articles for every topic without hitting the recall API.
 *
 * Filters in-memory memories by `mentionsTopic`, then runs the same
 * curated-section + template-section passes the live hook does.
 */
export function buildArticleSync(topic: Topic, allMemories: Memory[]): TopicArticle {
  const matching = allMemories.filter((m) => mentionsTopic(m, topic));
  const article = buildArticle(topic, matching);
  applyCuratedSections(article, topic, matching);
  applyTemplateSections(article, topic);
  return article;
}

function buildArticle(topic: Topic, memories: Memory[]): TopicArticle {
  const synthesized = memories.filter((m) => m.summary && m.summary !== m.content && !m.compacted);
  const raw = memories.filter((m) => !m.summary || m.summary === m.content);
  const archived = memories.filter((m) => m.compacted);

  const sections: ArticleSection[] = [];
  if (synthesized.length > 0) {
    sections.push({ id: 'synthesized', title: 'Notes', memories: take(synthesized, 6) });
  }
  if (raw.length > 0) {
    sections.push({ id: 'raw', title: 'Quick captures', memories: take(raw, 6) });
  }
  if (archived.length > 0) {
    sections.push({ id: 'archived', title: 'Older', memories: take(archived, 4) });
  }

  const newest = memories.reduce<Memory | null>((acc, m) => {
    if (!acc) return m;
    return new Date(m.created_at).getTime() > new Date(acc.created_at).getTime() ? m : acc;
  }, null);

  const sources = new Set(memories.map((m) => m.source).filter(Boolean));
  const avgImportance = memories.length > 0
    ? memories.reduce((sum, m) => sum + (m.importance ?? 0.5), 0) / memories.length
    : 0.5;

  return {
    id: topic.id,
    title: topic.name,
    cluster: topic.cluster,
    color: topic.color || CLUSTER_COLORS[topic.cluster as keyof typeof CLUSTER_COLORS] || '#888',
    lede: topic.summary,
    meta: {
      sources: memories.length,
      updated: newest ? relativeTime(newest.created_at) : '—',
      contributors: sources.size,
      confidence: Number(avgImportance.toFixed(2)),
    },
    sections,
  };
}

function buildBacklinks(topic: Topic, allTopics: Topic[], memories: Memory[]): Backlink[] {
  // Memories that mention this topic but are tagged for a DIFFERENT topic.
  const others = allTopics.filter((t) => t.id !== topic.id);
  const seen = new Set<string>();
  const links: Backlink[] = [];

  for (const m of memories) {
    if (!mentionsTopic(m, topic)) continue;
    const linkedTopic = others.find((t) => memoryMatchesTopic(m, t));
    if (!linkedTopic || seen.has(linkedTopic.id)) continue;
    seen.add(linkedTopic.id);
    const snip = excerptAround(m.summary || m.content, topic.name, 80);
    links.push({
      id: linkedTopic.id,
      title: linkedTopic.name,
      color: linkedTopic.color,
      snip,
    });
    if (links.length >= 6) break;
  }
  return links;
}

function buildRecentEdits(memories: Memory[]): RecentEdit[] {
  const sorted = [...memories]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 6);

  return sorted.map((m) => {
    const time = relativeTime(m.created_at);
    if (m.compacted) {
      return { icon: '◇', text: `Consolidated by <strong>${escape(prettySource(m.source))}</strong>`, time };
    }
    if (m.summary && m.summary !== m.content) {
      return { icon: '+', text: `Reframed fragment from <strong>${escape(prettySource(m.source))}</strong>`, time };
    }
    if (m.memory_type === 'self_model') {
      return { icon: '◈', text: `<strong>${escape(prettySource(m.source))}</strong> added a self-model note`, time };
    }
    return { icon: '↗', text: `<strong>${escape(prettySource(m.source))}</strong> stored a new ${m.memory_type} memory`, time };
  });
}

// ─────────── Helpers ───────────

function mergeUnique(a: Memory[], b: Memory[]): Memory[] {
  const seen = new Set<number>();
  const out: Memory[] = [];
  for (const m of [...a, ...b]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out.sort((x, y) => (y.importance ?? 0) - (x.importance ?? 0));
}

function mentionsTopic(m: Memory, topic: Topic): boolean {
  const needle = topic.name.toLowerCase();
  const text = `${m.content || ''} ${m.summary || ''}`.toLowerCase();
  return text.includes(needle) || (m.tags || []).some((t) => slug(t) === topic.id);
}

function memoryMatchesTopic(m: Memory, topic: Topic): boolean {
  const tagMatch = (m.tags || []).some((t) => slug(t) === topic.id);
  if (tagMatch) return true;
  const needle = topic.name.toLowerCase();
  return (m.content || '').toLowerCase().includes(needle) ||
         (m.summary || '').toLowerCase().includes(needle);
}

function slug(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function take<T>(arr: T[], n: number): T[] {
  return arr.slice(0, n);
}

function excerptAround(text: string, needle: string, radius: number): string {
  if (!text) return '';
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + needle.length + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
