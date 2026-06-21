import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { Memory } from '../types/memory';
import { MEMORY_TYPES, typeStyle, bondColor, relTime, decayColor, pct } from '../lib/memory-ui';

/**
 * Explore — one place to navigate the brain: a force-directed graph (lenses:
 * memory / entity / topic) and a fast, filterable memories list, with the
 * Ask-Clude rail docked on the right. Replaces Timeline, Decay, Brain, Entities.
 *
 * The graph + list are built entirely from the owner-scoped cortex recent feed
 * (getKnowledgeGraph is empty in cortex mode). Nodes are memories, edges are
 * derived from shared tags/concepts; entity/topic lenses re-cluster the same
 * corpus. The force simulation is ported from the design prototype (charge
 * repulsion + link springs + centering + drag) and runs into an SVG via refs.
 */

type Tab = 'graph' | 'memories';
type Lens = 'memory' | 'entity' | 'topic';
type SortKey = 'recent' | 'health' | 'importance';
type FilterKey = 'all' | (typeof MEMORY_TYPES)[number]['key'];

// ── Force-graph viewBox (matches the design prototype coordinate space) ──
const W = 760;
const H = 470;

interface GNode {
  id: string;
  /** Underlying memory (memory lens only). */
  mem?: Memory;
  fill: string;
  /** Pill tint for the drawer. */
  tint: string;
  /** Drawer type label (e.g. "Episodic", "Entity", "Topic"). */
  typeLabel: string;
  /** Short text rendered under high-importance nodes. */
  label: string;
  /** Drawer summary line. */
  summary: string;
  imp: number;
  /** Retention 0..1. */
  decay: number;
  age: string;
  contradiction: boolean;
  /** Whether this node always shows its label (entity/topic) or only when important. */
  alwaysLabel: boolean;
  r: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number | null;
  fy: number | null;
}

interface GLink {
  s: string;
  t: string;
  kind: string;
  rest: number;
}

interface GraphData {
  nodes: GNode[];
  links: GLink[];
}

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

const EMPTY_GRAPH: GraphData = { nodes: [], links: [] };

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/** Lowercased, de-duplicated tag+concept list for a memory. */
function memTokens(m: Memory): string[] {
  const raw = [...(m.tags ?? []), ...(m.concepts ?? [])];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const k = (t || '').toLowerCase().trim();
    if (k && !seen.has(k)) { seen.add(k); out.push(k); }
  }
  return out;
}

/** Build the memory-lens graph: nodes = memories, edges = shared tags/concepts. */
function buildMemoryGraph(memories: Memory[]): GraphData {
  const nodes: GNode[] = memories.map((m) => {
    const ts = typeStyle(m.memory_type);
    const imp = typeof m.importance === 'number' ? m.importance : 0.5;
    const decay = typeof m.decay_factor === 'number' ? m.decay_factor : 0.9;
    const contradiction = Boolean(
      (m.metadata && (m.metadata as Record<string, unknown>).contradiction) ||
      (m.tags ?? []).some((t) => (t || '').toLowerCase() === 'contradiction'),
    );
    return {
      id: String(m.id),
      mem: m,
      fill: ts.color,
      tint: ts.tint,
      typeLabel: ts.label,
      label: m.summary || m.content || ts.label,
      summary: m.summary || m.content || '',
      imp,
      decay,
      age: relTime(m.created_at),
      contradiction,
      alwaysLabel: false,
      r: 7 + imp * 13,
      x: rand(180, 580),
      y: rand(110, 360),
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
    };
  });

  // Edges: any two memories sharing a tag/concept get a 'relates' link.
  // Cap fan-out per token so a single ubiquitous tag can't make a hairball.
  const byToken = new Map<string, string[]>();
  memories.forEach((m) => {
    for (const tok of memTokens(m)) {
      const arr = byToken.get(tok) ?? [];
      arr.push(String(m.id));
      byToken.set(tok, arr);
    }
  });
  const seen = new Set<string>();
  const links: GLink[] = [];
  for (const ids of byToken.values()) {
    if (ids.length < 2 || ids.length > 8) continue; // skip singletons and over-broad tags
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i];
        const b = ids[j];
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ s: a, t: b, kind: 'relates', rest: 90 });
      }
    }
  }
  return { nodes, links };
}

/** Build an entity/topic-lens graph by clustering memories on a token field. */
function buildClusterGraph(memories: Memory[], lens: 'entity' | 'topic'): GraphData {
  // Entity lens clusters on concepts (proper nouns / things); topic lens on tags.
  const counts = new Map<string, { count: number; impSum: number }>();
  memories.forEach((m) => {
    const field = lens === 'entity' ? (m.concepts ?? []) : (m.tags ?? []);
    const imp = typeof m.importance === 'number' ? m.importance : 0.5;
    for (const raw of field) {
      const k = (raw || '').toLowerCase().trim();
      if (!k) continue;
      const cur = counts.get(k) ?? { count: 0, impSum: 0 };
      cur.count += 1;
      cur.impSum += imp;
      counts.set(k, cur);
    }
  });
  const top = [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 26);

  const PALETTE = ['#4466ff', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#6b7280'];
  const nodes: GNode[] = top.map(([name, agg], i) => {
    const imp = Math.min(1, agg.impSum / Math.max(1, agg.count));
    const color = PALETTE[i % PALETTE.length];
    return {
      id: name,
      fill: color,
      tint: 'var(--accent-soft)',
      typeLabel: lens === 'entity' ? 'Entity' : 'Topic',
      label: name,
      summary: `${name} — appears in ${agg.count} ${agg.count === 1 ? 'memory' : 'memories'}`,
      imp,
      decay: 0.99,
      age: '—',
      contradiction: false,
      alwaysLabel: true,
      r: 9 + Math.min(0.85, agg.count / 6) * 12,
      x: rand(200, 560),
      y: rand(120, 350),
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
    };
  });

  // Link two clusters when they co-occur on the same memory.
  const present = new Set(top.map(([name]) => name));
  const pairCounts = new Map<string, number>();
  memories.forEach((m) => {
    const field = lens === 'entity' ? (m.concepts ?? []) : (m.tags ?? []);
    const here = [...new Set(field.map((t) => (t || '').toLowerCase().trim()).filter((t) => t && present.has(t)))];
    for (let i = 0; i < here.length; i++) {
      for (let j = i + 1; j < here.length; j++) {
        const a = here[i];
        const b = here[j];
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  });
  const links: GLink[] = [...pairCounts.entries()].map(([key]) => {
    const [s, t] = key.split('|');
    return { s, t, kind: 'relates', rest: 130 };
  });
  return { nodes, links };
}

export function ExploreScreen() {
  const [tab, setTab] = useState<Tab>('graph');
  const [lens, setLens] = useState<Lens>('memory');
  const [askOpen, setAskOpen] = useState(false);

  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);

  // Memories-tab controls
  const [memQuery, setMemQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [filter, setFilter] = useState<FilterKey>('all');

  // Graph selection + recalled-highlight set
  const [selected, setSelected] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());

  // Ask rail
  const [askLog, setAskLog] = useState<ChatTurn[]>([]);
  const [askDraft, setAskDraft] = useState('');
  const [asking, setAsking] = useState(false);

  // ── Refs for the imperative force simulation ──
  const svgRef = useRef<SVGSVGElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const graphRef = useRef<GraphData>(EMPTY_GRAPH);
  const elsRef = useRef<{ nodes: Map<string, { g: SVGGElement; c: SVGCircleElement; ring: SVGCircleElement | null; text: SVGTextElement | null }>; links: { l: GLink; el: SVGLineElement }[] }>({ nodes: new Map(), links: [] });
  const dragRef = useRef<{ node: GNode; moved: number } | null>(null);
  // Stable references to the latest selection / highlight for the rAF tick.
  const selectedRef = useRef<string | null>(null);
  const highlightRef = useRef<Set<string>>(new Set());
  const askAbort = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { highlightRef.current = highlighted; }, [highlighted]);

  // ── Data fetch ──
  useEffect(() => {
    let live = true;
    (async () => {
      const mems = await api
        .getMemories({ hours: 168, limit: 50 })
        .then((d) => d.memories)
        .catch(() => [] as Memory[]);
      if (!live) return;
      setMemories(mems);
      setLoading(false);
    })();
    return () => { live = false; };
  }, []);

  // ── Build graph data whenever memories or lens change ──
  const graphData = useMemo<GraphData>(() => {
    if (memories.length === 0) return EMPTY_GRAPH;
    if (lens === 'memory') return buildMemoryGraph(memories);
    return buildClusterGraph(memories, lens);
  }, [memories, lens]);

  // ── Physics tick (ported from design lines 766-808) ──
  const tick = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const { nodes, links } = graphRef.current;
    const sel = selectedRef.current;
    const hot = highlightRef.current;

    const neighbor = new Set<string>();
    if (sel) {
      links.forEach((l) => {
        if (l.s === sel) neighbor.add(l.t);
        if (l.t === sel) neighbor.add(l.s);
      });
    }

    // Charge repulsion (every pair).
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let ds = dx * dx + dy * dy;
        if (ds < 0.01) ds = 0.01;
        const dist = Math.sqrt(ds);
        const f = 1500 / ds;
        const ux = dx / dist;
        const uy = dy / dist;
        a.vx += ux * f; a.vy += uy * f;
        b.vx -= ux * f; b.vy -= uy * f;
      }
    }

    // Link springs.
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    links.forEach((l) => {
      const a = nodeById.get(l.s);
      const b = nodeById.get(l.t);
      if (!a || !b) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const diff = ((dist - (l.rest || 100)) / dist) * 0.025;
      a.vx += dx * diff; a.vy += dy * diff;
      b.vx -= dx * diff; b.vy -= dy * diff;
    });

    const els = elsRef.current;
    nodes.forEach((n) => {
      // Centering + damping.
      n.vx += (W / 2 - n.x) * 0.0022;
      n.vy += (H / 2 - n.y) * 0.0022;
      n.vx *= 0.86; n.vy *= 0.86;
      if (n.fx != null) { n.x = n.fx; n.y = n.fy!; n.vx = 0; n.vy = 0; }
      else { n.x += n.vx; n.y += n.vy; }
      n.x = Math.max(n.r + 8, Math.min(W - n.r - 8, n.x));
      n.y = Math.max(n.r + 8, Math.min(H - n.r - 8, n.y));

      const ref = els.nodes.get(n.id);
      if (!ref) return;
      const active = !sel || n.id === sel || neighbor.has(n.id);
      const isHot = hot.has(n.id);
      ref.c.setAttribute('cx', String(n.x));
      ref.c.setAttribute('cy', String(n.y));
      ref.c.setAttribute('fill-opacity', active ? '0.95' : '0.28');
      ref.c.setAttribute('stroke', n.id === sel ? '#ededf2' : isHot ? '#8aa0ff' : '#0a0a0f');
      ref.c.setAttribute('stroke-width', n.id === sel ? '2.5' : isHot ? '2.5' : '1.5');
      if (ref.ring) { ref.ring.setAttribute('cx', String(n.x)); ref.ring.setAttribute('cy', String(n.y)); }
      if (ref.text) {
        ref.text.setAttribute('x', String(n.x));
        ref.text.setAttribute('y', String(n.y + n.r + 12));
        ref.text.setAttribute('fill-opacity', active ? '0.85' : '0.25');
      }
    });

    els.links.forEach(({ l, el }) => {
      const a = nodeById.get(l.s);
      const b = nodeById.get(l.t);
      if (!a || !b) return;
      el.setAttribute('x1', String(a.x));
      el.setAttribute('y1', String(a.y));
      el.setAttribute('x2', String(b.x));
      el.setAttribute('y2', String(b.y));
      const hotLink = sel && (l.s === sel || l.t === sel);
      el.setAttribute('stroke-opacity', sel ? (hotLink ? '0.95' : '0.12') : '0.45');
      el.setAttribute('stroke-width', hotLink ? (l.kind === 'contradicts' ? '3' : '2.4') : (l.kind === 'contradicts' ? '2.4' : '1.6'));
    });
  }, []);

  // ── Build SVG elements imperatively, then run the rAF loop ──
  const buildGraph = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const NS = 'http://www.w3.org/2000/svg';
    const data = graphRef.current;
    const els = { nodes: new Map<string, { g: SVGGElement; c: SVGCircleElement; ring: SVGCircleElement | null; text: SVGTextElement | null }>(), links: [] as { l: GLink; el: SVGLineElement }[] };

    const eg = document.createElementNS(NS, 'g');
    svg.appendChild(eg);
    const ng = document.createElementNS(NS, 'g');
    svg.appendChild(ng);

    data.links.forEach((l) => {
      const ln = document.createElementNS(NS, 'line');
      ln.setAttribute('stroke', bondColor(l.kind));
      ln.setAttribute('stroke-width', l.kind === 'contradicts' ? '2.4' : '1.6');
      if (l.kind === 'contradicts') ln.setAttribute('stroke-dasharray', '5 4');
      ln.setAttribute('stroke-opacity', '0.45');
      eg.appendChild(ln);
      els.links.push({ l, el: ln });
    });

    data.nodes.forEach((n) => {
      const g = document.createElementNS(NS, 'g');
      g.style.cursor = 'pointer';
      let ring: SVGCircleElement | null = null;
      if (n.contradiction) {
        ring = document.createElementNS(NS, 'circle');
        ring.setAttribute('r', String(n.r + 5));
        ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', '#f59e0b');
        ring.setAttribute('stroke-width', '1.4');
        ring.setAttribute('stroke-dasharray', '3 3');
        g.appendChild(ring);
      }
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('r', String(n.r));
      c.setAttribute('fill', n.fill);
      c.setAttribute('fill-opacity', '0.9');
      c.setAttribute('stroke', '#0a0a0f');
      c.setAttribute('stroke-width', '1.5');
      g.appendChild(c);

      let text: SVGTextElement | null = null;
      const labelled = n.alwaysLabel || n.imp > 0.7;
      if (labelled) {
        text = document.createElementNS(NS, 'text');
        const label = n.label.length > 22 ? `${n.label.slice(0, 20)}…` : n.label;
        text.textContent = label;
        text.setAttribute('font-family', 'Inter, sans-serif');
        text.setAttribute('font-size', n.alwaysLabel ? '11' : '9.5');
        text.setAttribute('font-weight', '500');
        text.setAttribute('fill', '#ededf2');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('pointer-events', 'none');
        g.appendChild(text);
      }

      g.addEventListener('pointerdown', (e) => onPointerDown(e, n));
      ng.appendChild(g);
      els.nodes.set(n.id, { g, c, ring, text });
    });

    elsRef.current = els;
    tick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const startLoop = useCallback(() => {
    if (rafRef.current != null) return;
    const loop = () => {
      tick();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [tick]);

  const stopLoop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // ── Drag handling (ported from design lines 756-764) ──
  const svgPoint = (e: PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    return { x: (e.clientX - m.e) / m.a, y: (e.clientY - m.f) / m.d };
  };

  const onMove = useCallback((ev: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const q = svgPoint(ev);
    drag.moved += 1;
    drag.node.fx = q.x;
    drag.node.fy = q.y;
  }, []);

  const onUp = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    const { node, moved } = drag;
    node.fx = null;
    node.fy = null;
    if (svgRef.current) svgRef.current.style.cursor = 'grab';
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (moved < 3) setSelected(node.id);
    dragRef.current = null;
  }, [onMove]);

  const onPointerDown = useCallback((e: PointerEvent, n: GNode) => {
    e.stopPropagation();
    e.preventDefault();
    const p = svgPoint(e);
    n.fx = p.x;
    n.fy = p.y;
    dragRef.current = { node: n, moved: 0 };
    if (svgRef.current) svgRef.current.style.cursor = 'grabbing';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [onMove, onUp]);

  // Keep graphRef synced and rebuild SVG when data changes (graph tab only).
  useEffect(() => {
    graphRef.current = graphData;
    if (tab === 'graph' && svgRef.current) {
      // Selection may point at a node that no longer exists after a lens switch.
      if (selected && !graphData.nodes.some((n) => n.id === selected)) setSelected(null);
      buildGraph();
      startLoop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData, tab]);

  // Pause the loop when leaving the graph tab; clean up on unmount.
  useEffect(() => {
    if (tab !== 'graph') stopLoop();
    return () => stopLoop();
  }, [tab, stopLoop]);

  useEffect(() => () => {
    // Final unmount cleanup: loop + any in-flight drag listeners + ask stream.
    stopLoop();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    askAbort.current?.abort();
  }, [onMove, onUp, stopLoop]);

  // ── Ask Clude streaming ──
  const runAsk = useCallback((question: string) => {
    const q = question.trim();
    if (!q || asking) return;
    setAskDraft('');
    setAsking(true);
    setAskLog((prev) => [...prev, { role: 'user', text: q }, { role: 'assistant', text: '' }]);

    const history = askLog.map((t) => ({ role: t.role, content: t.text }));
    const controller = new AbortController();
    askAbort.current = controller;

    api
      .exploreChat(
        q,
        history,
        (chunk) => {
          setAskLog((prev) => {
            const next = prev.slice();
            const last = next[next.length - 1];
            if (last && last.role === 'assistant') next[next.length - 1] = { ...last, text: last.text + chunk };
            return next;
          });
        },
        (ids) => {
          // Highlight recalled memories in the graph (memory lens only).
          setHighlighted(new Set(ids.map(String)));
        },
        () => {
          setAsking(false);
          askAbort.current = null;
        },
        controller.signal,
      )
      .catch((err) => {
        if (controller.signal.aborted) return;
        setAskLog((prev) => {
          const next = prev.slice();
          const last = next[next.length - 1];
          const msg = err instanceof Error ? err.message : 'Something went wrong.';
          if (last && last.role === 'assistant' && !last.text) next[next.length - 1] = { ...last, text: `⚠ ${msg}` };
          else next.push({ role: 'assistant', text: `⚠ ${msg}` });
          return next;
        });
        setAsking(false);
        askAbort.current = null;
      });
  }, [askLog, asking]);

  // Auto-scroll the ask log as it grows.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' });
  }, [askLog]);

  const openAsk = () => setAskOpen((v) => !v);

  // ── Derived: drawer for the selected node ──
  const drawer = useMemo(() => {
    if (tab !== 'graph' || !selected) return null;
    const n = graphData.nodes.find((x) => x.id === selected);
    if (!n) return null;
    const conns = graphData.links
      .filter((l) => l.s === n.id || l.t === n.id)
      .map((l) => {
        const oid = l.s === n.id ? l.t : l.s;
        const o = graphData.nodes.find((x) => x.id === oid);
        return { kind: l.kind, color: bondColor(l.kind), name: o ? o.label : oid, oid };
      });
    return { node: n, conns };
  }, [tab, selected, graphData]);

  // ── Derived: filtered/sorted memories list (design lines 845-857) ──
  const memList = useMemo(() => {
    let list = memories.slice();
    if (filter !== 'all') list = list.filter((m) => typeStyle(m.memory_type).key === filter);
    if (memQuery) {
      const q = memQuery.toLowerCase();
      list = list.filter(
        (m) =>
          (m.summary || m.content || '').toLowerCase().includes(q) ||
          (m.tags ?? []).join(' ').toLowerCase().includes(q),
      );
    }
    if (sort === 'health') list.sort((a, b) => (a.decay_factor ?? 0) - (b.decay_factor ?? 0));
    else if (sort === 'importance') list.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
    // 'recent' keeps the server order (already newest-first).
    return list;
  }, [memories, filter, memQuery, sort]);

  const askEmpty = askLog.length === 0;

  // ── Shared inline style helpers ──
  const segBtn = (active: boolean): React.CSSProperties => ({
    fontSize: 12,
    fontWeight: 600,
    color: active ? 'var(--accent-fg)' : 'var(--fg-2)',
    background: active ? 'var(--accent)' : 'transparent',
    border: 'none',
    borderRadius: 7,
    padding: '6px 14px',
    cursor: 'pointer',
  });
  const lensBtn = (active: boolean): React.CSSProperties => ({
    fontSize: 11.5,
    fontWeight: 600,
    color: active ? 'var(--accent-fg)' : 'var(--fg-2)',
    background: active ? 'var(--accent)' : 'transparent',
    border: 'none',
    borderRadius: 7,
    padding: '5px 12px',
    cursor: 'pointer',
  });
  const chipStyle = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11.5,
    fontWeight: 500,
    color: active ? 'var(--fg)' : 'var(--fg-2)',
    background: active ? 'var(--surface-2)' : 'transparent',
    border: `1px solid ${active ? 'var(--border-2)' : 'var(--border)'}`,
    borderRadius: 8,
    padding: '6px 11px',
    cursor: 'pointer',
  });

  return (
    <div style={{ padding: '26px 32px 32px', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, marginBottom: 18, flex: 'none' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-3)', marginBottom: 9 }}>Explore</div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--fg)' }}>The brain</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 'none' }}>
          <div style={{ display: 'flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, padding: 3 }}>
            <button className="pbtn" onClick={() => setTab('graph')} style={segBtn(tab === 'graph')}>Graph</button>
            <button className="pbtn" onClick={() => setTab('memories')} style={segBtn(tab === 'memories')}>Memories</button>
          </div>
          <button className="gbtn" onClick={openAsk} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: 'var(--accent-text)', background: 'var(--accent-soft)', border: '1px solid transparent', borderRadius: 9, padding: '8px 13px', cursor: 'pointer' }}>✦ Ask Clude</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {/* GRAPH */}
          {tab === 'graph' && (
            <div style={{ position: 'relative', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', flex: 1, minHeight: 0 }}>
              <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block', cursor: 'grab', width: '100%', height: '100%' }} />

              {/* Empty / loading overlay */}
              {graphData.nodes.length === 0 && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', color: 'var(--fg-3)', fontSize: 13, lineHeight: 1.5 }}>
                  {loading ? 'Loading the brain…' : 'No memories yet. Store some from a connected agent and they appear here as a graph.'}
                </div>
              )}

              {/* Lens switch */}
              <div style={{ position: 'absolute', top: 14, left: 14, display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 9, padding: 3, boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}>
                <button className="pbtn" onClick={() => setLens('memory')} style={lensBtn(lens === 'memory')}>Memory</button>
                <button className="pbtn" onClick={() => setLens('entity')} style={lensBtn(lens === 'entity')}>Entity</button>
                <button className="pbtn" onClick={() => setLens('topic')} style={lensBtn(lens === 'topic')}>Topic</button>
              </div>

              {/* Sparse-lens note */}
              {lens !== 'memory' && graphData.nodes.length > 0 && graphData.nodes.length < 3 && (
                <div style={{ position: 'absolute', top: 58, left: 14, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--fg-3)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7, padding: '5px 9px', maxWidth: 240 }}>
                  Sparse — few {lens === 'entity' ? 'entities' : 'topics'} tagged on these memories yet.
                </div>
              )}

              {/* Legend */}
              <div style={{ position: 'absolute', bottom: 14, left: 14, display: 'flex', flexWrap: 'wrap', gap: '10px 14px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px', maxWidth: 420 }}>
                {([
                  ['supports', '#4466ff'],
                  ['causes', '#ef4444'],
                  ['elaborates', '#10b981'],
                  ['contradicts', '#f59e0b'],
                  ['relates', '#6b7280'],
                ] as const).map(([label, color]) => (
                  <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--fg-2)' }}>
                    <span style={{ width: 14, height: 2, background: color }} />{label}
                  </span>
                ))}
              </div>
              <div style={{ position: 'absolute', bottom: 14, right: 14, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--fg-3)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7, padding: '5px 9px' }}>drag · click a node</div>

              {/* DETAIL DRAWER */}
              {drawer && (
                <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 312, background: 'var(--bg)', borderLeft: '1px solid var(--border)', padding: '18px 20px', overflowY: 'auto', boxShadow: '-12px 0 40px rgba(0,0,0,0.22)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '4px 9px', borderRadius: 6, color: drawer.node.fill, background: drawer.node.tint }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: drawer.node.fill }} />{drawer.node.typeLabel}
                    </span>
                    <button onClick={() => setSelected(null)} style={{ background: 'transparent', border: 'none', color: 'var(--fg-3)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
                  </div>
                  {drawer.node.contradiction && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12, fontSize: 11.5, color: '#f59e0b', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 7, padding: '7px 10px' }}>⚠ Flagged: contradicts another memory</div>
                  )}
                  <p style={{ margin: '0 0 18px', fontSize: 15, lineHeight: 1.5, color: 'var(--fg)' }}>{drawer.node.summary || '—'}</p>
                  <div style={{ display: 'flex', gap: 18, marginBottom: 20, fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--fg-2)' }}>
                    <span>imp <span style={{ color: 'var(--fg)' }}>{drawer.node.imp.toFixed(2)}</span></span>
                    <span>decay <span style={{ color: 'var(--fg)' }}>{pct(drawer.node.decay)}</span></span>
                    <span>· {drawer.node.age}</span>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--fg-3)', marginBottom: 12 }}>Connections</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {drawer.conns.length === 0 && (
                      <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>No linked memories.</div>
                    )}
                    {drawer.conns.map((c, i) => (
                      <button key={`${c.oid}-${i}`} className="row" onClick={() => setSelected(c.oid)} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'background .12s' }}>
                        <span style={{ width: 14, height: 2, background: c.color, flex: 'none' }} />
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: c.color, flex: 'none', width: 64 }}>{c.kind}</span>
                        <span style={{ fontSize: 12.5, color: 'var(--fg)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* MEMORIES LIST */}
          {tab === 'memories' && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap', flex: 'none' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', stroke: 'var(--fg-3)', fill: 'none', strokeWidth: 1.8 }}><circle cx="11" cy="11" r="7" /><line x1="16" y1="16" x2="21" y2="21" /></svg>
                  <input
                    value={memQuery}
                    onChange={(e) => setMemQuery(e.target.value)}
                    placeholder="Search summaries and tags…"
                    style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px 9px 32px', color: 'var(--fg)', fontSize: 13, fontFamily: 'Inter, sans-serif', outline: 'none' }}
                  />
                </div>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px', color: 'var(--fg)', fontSize: 12, fontFamily: 'Inter, sans-serif', cursor: 'pointer', outline: 'none' }}
                >
                  <option value="recent">Sort: Recent</option>
                  <option value="health">Sort: Health (decay)</option>
                  <option value="importance">Sort: Importance</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 7, marginBottom: 14, flexWrap: 'wrap', flex: 'none' }}>
                <button className="chip" onClick={() => setFilter('all')} style={chipStyle(filter === 'all')}>All</button>
                {MEMORY_TYPES.map((t) => (
                  <button key={t.key} className="chip" onClick={() => setFilter(t.key)} style={chipStyle(filter === t.key)}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color, flex: 'none' }} />{t.label}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
                {memList.length === 0 && (
                  <div style={{ padding: '24px 18px', fontSize: 13, color: 'var(--fg-3)', lineHeight: 1.5 }}>
                    {loading ? 'Loading…' : memories.length === 0 ? 'No memories in the last 7 days.' : 'No memories match your filters.'}
                  </div>
                )}
                {memList.map((m, i) => {
                  const ts = typeStyle(m.memory_type);
                  const imp = typeof m.importance === 'number' ? m.importance : 0.5;
                  const retained = typeof m.decay_factor === 'number' ? m.decay_factor : 0.9;
                  const tagStr = (m.tags ?? []).map((t) => `#${t}`).join(' ');
                  const meta = `${ts.label}  ·  ${relTime(m.created_at)}  ·  imp ${imp.toFixed(2)}${tagStr ? `  ·  ${tagStr}` : ''}`;
                  const showDecay = sort === 'health';
                  return (
                    <div key={m.id ?? i} className="row" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', borderBottom: '1px solid var(--hairline)', transition: 'background .12s' }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: ts.color, flex: 'none' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, color: 'var(--fg)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.summary || m.content}</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</div>
                      </div>
                      {showDecay && (
                        <div style={{ flex: 'none', width: 110 }}>
                          <div style={{ height: 6, borderRadius: 99, background: 'var(--surface-3)', overflow: 'hidden' }}>
                            <div style={{ width: pct(retained), height: '100%', background: decayColor(retained), borderRadius: 99 }} />
                          </div>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--fg-3)', marginTop: 4, textAlign: 'right' }}>{pct(retained)} retained</div>
                        </div>
                      )}
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: ts.color, background: ts.tint, padding: '3px 8px', borderRadius: 6, flex: 'none' }}>{ts.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ASK CLUDE RAIL */}
        {askOpen && (
          <div style={{ width: 330, flex: 'none', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}><span style={{ color: 'var(--accent-text)' }}>✦</span> Ask Clude</span>
              <button onClick={openAsk} style={{ background: 'transparent', border: 'none', color: 'var(--fg-3)', cursor: 'pointer', fontSize: 17, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--fg-3)', lineHeight: 1.5 }}>Ask a question and Clude recalls the relevant memories, highlights them in the graph, then answers.</p>
              {askLog.map((turn, i) => (
                <div
                  key={i}
                  style={
                    turn.role === 'user'
                      ? { alignSelf: 'flex-end', maxWidth: '85%', background: 'var(--accent)', color: 'var(--accent-fg)', borderRadius: '10px 10px 2px 10px', padding: '8px 11px', fontSize: 12.5, lineHeight: 1.45 }
                      : { alignSelf: 'flex-start', maxWidth: '92%', background: 'var(--surface-2)', color: 'var(--fg)', border: '1px solid var(--border)', borderRadius: '10px 10px 10px 2px', padding: '9px 12px', fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre-wrap' }
                  }
                >
                  {turn.text || (asking && turn.role === 'assistant' ? '…' : '')}
                </div>
              ))}
              {askEmpty && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>Try asking</div>
                  <button className="row" onClick={() => runAsk('What do I know about pricing?')} style={{ textAlign: 'left', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px', cursor: 'pointer', fontSize: 12.5, color: 'var(--fg)', transition: 'background .12s' }}>What do I know about pricing?</button>
                  <button className="row" onClick={() => runAsk('How does Clude compare on benchmarks?')} style={{ textAlign: 'left', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px', cursor: 'pointer', fontSize: 12.5, color: 'var(--fg)', transition: 'background .12s' }}>How does Clude compare on benchmarks?</button>
                </div>
              )}
              <div ref={logEndRef} />
            </div>
            <div style={{ padding: 12, borderTop: '1px solid var(--border)', flex: 'none', display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={askDraft}
                onChange={(e) => setAskDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runAsk(askDraft); } }}
                placeholder="Ask your memory…"
                disabled={asking}
                style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px', color: 'var(--fg)', fontSize: 13, fontFamily: 'Inter, sans-serif', outline: 'none' }}
              />
              <button className="pbtn" onClick={() => runAsk(askDraft)} disabled={asking} style={{ background: 'var(--accent)', border: 'none', borderRadius: 9, width: 36, height: 36, flex: 'none', cursor: asking ? 'default' : 'pointer', opacity: asking ? 0.6 : 1, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" style={{ stroke: '#fff', fill: 'none', strokeWidth: 2 }}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
